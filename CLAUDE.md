# CLAUDE.md

Context for future Claude Code sessions working in this repo.

## What this is

OctoMesh capability demo "One-Time Ticket": secrets redeemable exactly once via
HTTP. Read `README.md` first — it has the architecture, install story, demo
script and the platform gotchas. This file only adds the non-obvious bits.

## Live state (tenant `test`, local kind cluster, as of 2026-06-09)

| Thing | Id / location |
|---|---|
| Blueprint installed | `OneTimeTicket-1.0.0` (LocalFileSystemBlueprintCatalog) |
| DataFlow "One-Time Ticket API" | `077100000000000000000001` |
| Pipelines create / list / redeem | `0771…02` / `0771…03` / `0771…04` |
| Application "One-Time Ticket App" | `077100000000000000000005` |
| Mesh Adapter (System.Communication seed) | `670000000000000000000002` |
| App URL (kind ingress) | `https://one-time-ticket-test.127.0.0.1.nip.io` |
| App pod | ns `octo`, deploy `test-0771…05-property-walker` |
| CK model in local catalog | `Demo.Tickets-1.0.0` (`~/.octo/local-catalog/ck-models/v2/d/…`) |

## Editing rules

- `blueprint/OneTimeTicket/1.0.0/seed-data/entities.yaml` is the **single
  source of truth** for the dataflow + pipelines + Application. `test/dataflow-test.yaml`
  is a scratch copy for iteration only — keep them in sync manually if used.
- After changing the blueprint: copy to
  `~/.octo/local-blueprint-catalog/blueprints/v1/OneTimeTicket/1.0.0/`, **delete
  `~/.octo/blueprint-catalog/cache/local-blueprint-catalog-cache.json`**
  (the cache never refreshes while the file exists), then
  `InstallBlueprint -b OneTimeTicket-1.0.0 -f` + `DeployDataFlow`.
- After changing the app: `docker build` + tag **both**
  `meshmakers/one-time-ticket-app:0.1.0` and
  `docker.mm.cloud/meshmakers/one-time-ticket-app:0.1.0` + `kind load` both +
  `kubectl rollout restart` the deploy. The operator injects
  `image.privateRegistry=docker.mm.cloud`, hence the double tag.
- The app fulfils the **property-walker chart contract** (env `PORT`,
  `UPSTREAM_URL`; `GET /` must return 200 for the probes; container port 5055).
  Don't break that contract without also changing the chart reference.
- CI: `devops-build/azure-pipelines.yml` (see README "CI / installing on
  test-2"). **Only `main` publishes** to the shared GitHub catalogs and pushes
  the pinned `0.1.0` image tag; the `AppImageVersion` pipeline variable must
  match the tag in `seed-data/entities.yaml` (guard step enforces it).
  `octo-ckc`/`octo-bpm` syntax is `-c <Command>` style — catalog arg is
  `--catalog` (long form; `-c` is the command selector).

## Platform pitfalls (cost real time — don't rediscover)

1. `DeployDataFlow` after `ImportRt -r` on a live dataflow rotates pipeline
   registrations (removes an unchanged one). Symptom: an endpoint answers
   `200` with empty body in ~0.1 ms ("path matched, method not registered").
   Fix: fresh install path, or run `DeployDataFlow` again and verify ALL routes.
2. `SetPrimitiveValue@1` kills the pipeline if the source path is missing —
   optional CK attributes need an `If@1` guard.
3. HTTP response = final DataContext serialized; `Project@1 clear: true` as the
   last node is the only response shaping (and prevents secret leakage — the
   raw context contains `$.body.secret` and lookup results!).
4. Pipeline JSON shapes are PascalCase; `attributeName` = CK attribute name as
   declared in the type (here PascalCase: `Name`, `Secret`, `Redeemed`, `RedeemedAt`).
5. `octo-ckc` lives at
   `C:\dev\meshmakers\octo-construction-kit-engine\bin\DebugL\net10.0\octo-ckc.exe`
   (not on PATH).

## Reference material

- `zenon-dynprop-api/` repo + the `ZenonDynprop.MainLatest-1.0.0` blueprint
  (meshmakers/blueprint-libraries-build → `blueprints/v1/z/…`) — the template
  this demo was modeled on (downloaded copy: `.research/zenon-blueprint/`).
- `.research/pipeline-schema.json` — full node-config JSON schema of the live
  mesh adapter (GetPipelineSchema output).
