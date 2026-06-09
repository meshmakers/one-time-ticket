#!/usr/bin/env node
// One-Time Ticket — BFF proxy
//
// Run:  node server/server.js
// Env:  PORT=5055                                      (default)
//       UPSTREAM_URL=https://localhost:5020/test        (default)
//
// Routing:
//   GET  /                    → serves client/index.html (liveness probe)
//   GET|POST|DELETE /api/<rest>  → proxied to UPSTREAM_URL/<rest>
//
// TLS: upstream certificate errors are intentionally ignored (dev mesh adapter
//      uses a self-signed cert, same pattern as property-walker).

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { URL } = require('url');

const CLIENT_DIR = path.resolve(__dirname, '..', 'client');
const PORT       = Number(process.env.PORT) || 5055;
const UPSTREAM   = (process.env.UPSTREAM_URL || 'https://localhost:5020/test').replace(/\/$/, '');

// ---------------------------------------------------------------------------
// response helpers
// ---------------------------------------------------------------------------

function send(res, status, body) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  const ct   = typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8';
  res.writeHead(status, {
    'content-type':   ct,
    'content-length': Buffer.byteLength(data),
    'access-control-allow-origin':  '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(data);
}

function sendJson(res, status, obj) { send(res, status, obj); }

// ---------------------------------------------------------------------------
// body reader
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('body too large'));
    });
    req.on('end',   () => resolve(data));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// upstream proxy (generic — pass-through method, path, query, body)
// ---------------------------------------------------------------------------

function proxyRequest(method, upstreamPath, rawBody, contentType) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(UPSTREAM + upstreamPath);
    } catch (e) {
      return reject(new Error('bad upstream URL: ' + e.message));
    }

    const lib     = url.protocol === 'https:' ? https : http;
    const payload = rawBody && rawBody.length > 0 ? rawBody : null;

    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        accept: 'application/json',
        ...(payload != null && {
          'content-type':   contentType || 'application/json',
          'content-length': Buffer.byteLength(payload),
        }),
      },
      rejectUnauthorized: false, // mesh adapter uses a self-signed cert
    };

    const req = lib.request(opts, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data',  c  => { data += c; });
      res.on('end',   () => resolve({ status: res.statusCode, text: data }));
    });

    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const started = Date.now();

  // CORS pre-flight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin':  '*',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    console.log(`${new Date().toISOString()}  OPTIONS  ${req.url}  204  ${Date.now()-started}ms`);
    return;
  }

  const parsed   = new URL(req.url, 'http://x');
  const pathname = parsed.pathname;

  // -----------------------------------------------------------------------
  // Static: serve the client SPA
  // -----------------------------------------------------------------------
  if (pathname === '/' || pathname === '/index.html') {
    try {
      const html = fs.readFileSync(path.join(CLIENT_DIR, 'index.html'));
      res.writeHead(200, {
        'content-type':   'text/html; charset=utf-8',
        'content-length': html.length,
      });
      res.end(html);
      console.log(`${new Date().toISOString()}  GET      /  200  ${Date.now()-started}ms`);
    } catch (e) {
      sendJson(res, 500, { error: 'client_missing', detail: e.message });
      console.log(`${new Date().toISOString()}  GET      /  500  client/index.html not found`);
    }
    return;
  }

  // Keep browser consoles clean — answer the automatic favicon probe.
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  // -----------------------------------------------------------------------
  // Proxy: /api/<rest> → UPSTREAM/<rest>
  // -----------------------------------------------------------------------
  if (pathname.startsWith('/api/') || pathname === '/api') {
    // Strip the /api prefix; keep query string
    const upstreamPath = pathname.slice(4) + parsed.search; // e.g. /tickets?foo=bar

    let rawBody      = '';
    let contentType  = req.headers['content-type'] || 'application/json';

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      try       { rawBody = await readBody(req); }
      catch (e) {
        sendJson(res, 400, { error: 'bad_request', detail: e.message });
        return;
      }
    }

    try {
      const r = await proxyRequest(req.method, upstreamPath, rawBody, contentType);
      const status = r.status || 200;

      // Parse or pass through as-is
      let body;
      try { body = r.text ? JSON.parse(r.text) : {}; }
      catch { body = r.text; }

      console.log(`${new Date().toISOString()}  ${req.method.padEnd(6)}  ${req.url}  → upstream ${upstreamPath}  ${status}  ${Date.now()-started}ms`);
      sendJson(res, status, body);
    } catch (e) {
      console.log(`${new Date().toISOString()}  ${req.method.padEnd(6)}  ${req.url}  502  ${e.message}`);
      sendJson(res, 502, { error: 'upstream_unreachable' });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // 404 for everything else
  // -----------------------------------------------------------------------
  sendJson(res, 404, { error: 'not_found' });
  console.log(`${new Date().toISOString()}  ${req.method.padEnd(6)}  ${req.url}  404  ${Date.now()-started}ms`);
});

server.listen(PORT, () => {
  console.log(`one-time-ticket proxy  →  ${UPSTREAM}`);
  console.log(`open UI:               http://localhost:${PORT}/`);
});
