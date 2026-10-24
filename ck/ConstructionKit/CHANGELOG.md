# Changelog

## 1.4.0 - 2026-10-24

_Required bump level: minor._

### Re-pin (AB#7122)

Pure version bump, no content change. Demo.Tickets 1.4.0 is the one-time re-pin from exact dependency pins
to range retention (decision D6, AB#5688): the compiled manifest carries `dependencyRanges` and
`minEngineVersion` instead of exact pins, so it no longer goes `ResolveFailed` when a newer compatible
System (for example 2.7.0) is installed on a tenant (incident AB#7403).

Compatibility: model content (types, attributes) is unchanged; runtime data and the `Secret` attribute are
unaffected. Blueprints keep their `Demo.Tickets-[1.3.0,2.0.0)` pin, which covers 1.4.0. Tenants holding
1.3.0 take 1.4.0 as a normal minor update (`RefreshCatalogs` + `FixAll`); needs a service with the CK v2 engine.

### Changed

- Dependency 'System': declared range stays `System-[2.5,3.0)`; the compiled manifest now resolves it to System-2.7.0 (was 2.5.0) _(minor — compatible dependency version change)_
- Model 'Demo.Tickets': rangeRetention changed 'false' → 'true' (separate from the resolved System version) — the one-time re-pin from exact pins to range retention (F2.6) _(minor)_
