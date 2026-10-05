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
| App URL (kind ingress) | `https://one-time-ticket-test.127.0.0.1.nip.io` (pre-hostname-change install; a reinstall yields `test.127.0.0.1.nip.io`) |
| App pod | ns `octo`, deploy `test-0771…05-property-walker` |
| CK model in local catalog | `Demo.Tickets-1.0.1` (`~/.octo/local-catalog/ck-models/v2/d/…`) |

## Live state (tenant `tickets`, test-2 cluster, as of 2026-06-10)

Same seed ids as above (blueprint-pinned). Installed from the shared GitHub
catalogs (published by CI run 33932), app live at
**`https://tickets.test-2.mm.cloud`** (hostname template
`${octo.tenantId}.{{domain.default}}`). Pool/adapter were brought up with the
pool-FIRST sequence — see the octo-deploy skill in `../octo-claude-skills/`
for the order, the pool-deploy REST call, and the blueprint-catalog-cache
restart trick (`octo/octo-mesh-asset-rep-services`). kubectl context: `test-2`.

## Repo shape (production-ready, mirrors the platform repos)

- **CK model** (`ck/`): `ck/ConstructionKit/` YAML wrapped by `ck/DemoTickets.csproj`
  (+ root `Directory.Build.props`, `OneTimeTicket.sln`) — the
  `octo-construction-kit` pattern. `dotnet build OneTimeTicket.sln -c DebugL`
  compiles **and** publishes `Demo.Tickets` to the local catalog (no manual
  `octo-ckc`). CI publishes to `$(effectivePublishCatalog)` (local on dev/*,
  PrivateGitHubCatalog on main/test, PublicGitHubCatalog on r*).
- **Chart** (`src/charts/one-time-ticket-app/`): the app's own Helm chart, based
  on `octo-helm-core/src/octo-mesh-demo-app`, shipped in-repo like
  `octo-mesh-adapter`. Replaces the borrowed `property-walker` chart. Contract:
  container port **5055**, env `PORT` + `UPSTREAM_URL`, `GET /` → 200 for the
  probes, operator-injected `image.{repository,tag,privateRegistry}`. `image.tag`
  defaults to the chart `appVersion` (CI sets it to the image's build number), so
  never pin a tag in the blueprint.
- **Blueprint** — TWO variants (mirrors `System.Communication.{MainLatest,Release}`),
  because the helm repos are seeded per channel:
  - `blueprint/OneTimeTicket.MainLatest/` — requires `[dev, test]`, Application →
    HelmRepository `670…003` (meshmakers-dev).
  - `blueprint/OneTimeTicket.Release/` — requires `[staging, production]`,
    Application → HelmRepository `670…005` (meshmakers-apps).
  Both point at repos **pre-seeded by System.Communication** (don't seed your
  own). Folders are name-only; the version lives in `blueprintId`. The two
  `seed-data/entities.yaml` differ only in that one HelmRepository target — keep
  them in sync. `ChartVersion` is empty (track the channel's newest chart).
- **CI** (`azure-pipelines.yml`, root): shared `octo-pipeline-templates@tpl-v0.4.6`
  + `helm-chart-build` templates. Triggers on `dev/* , test/* , main`, and `r*`
  tags. `r*` is the production release: publishes CK → public catalog, blueprint →
  public blueprint catalog, chart → `meshmakers.github.io/apps`, image tagged with
  the build number. There is no `AppImageVersion` guard — the chart `appVersion`
  drives the image tag.

  > Cutover: this root pipeline replaces the deleted `devops-build/`. The ADO
  > pipeline definition's `yamlFilename` must be flipped to `azure-pipelines.yml`.
  > Push the `dev/*` branch first to validate the pipeline with all publishing
  > gated off, before merging to `main`.

- `blueprint/*/seed-data/entities.yaml` is the source of truth for the dataflow +
  pipelines + Application. `test/dataflow-test.yaml` is a scratch copy — keep in
  sync manually if used.

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
5. The CK model now compiles via `dotnet build` — don't reach for `octo-ckc`
   directly. The only standalone tool the CI still invokes is `octo-bpm`
   (blueprint validate/publish), installed from the private NuGet feed.

## Reference material (canonical platform repos — NOT hand-crafted demos)

- CK-model `.csproj` + MSBuild publish: `octo-construction-kit`
  (`Directory.Build.props`, `src/ConstructionKits/*`).
- In-repo chart + shared-template CI: `octo-mesh-adapter`
  (`src/charts/*`, root `azure-pipelines.yml`). Clean app-chart template:
  `octo-helm-core/src/octo-mesh-demo-app`.
- Two-variant blueprint + helm-repo seeds: `octo-communication-controller-services`
  → `System.Communication.{MainLatest,Release}`.
- Shared CI steps + `effectivePublishCatalog`: `octo-pipeline-templates`.
- `.research/pipeline-schema.json` — node-config JSON schema of the live mesh
  adapter (GetPipelineSchema output).
- Do NOT model this repo on `zenon-dynprop-api` — it is itself hand-crafted and
  was the original (divergent) template for this demo.
