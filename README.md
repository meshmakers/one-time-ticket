# One-Time Ticket

A complete OctoMesh demo app: a developer creates a **ticket** holding a secret
(e.g. an API key) and shares a redeem link. The secret can be fetched over HTTP
**exactly once** — after that the ticket is burned (redeemed flag set, secret
cleared in the data mesh).

The point of this repo is not the ticket app — it's **how little it takes** to
ship a full-stack app on OctoMesh:

| OctoMesh capability | Where it shows up here |
|---|---|
| **Construction Kit / data model** | `Demo.Tickets` CK model — one `Ticket` type, 4 attributes, ~30 lines of YAML |
| **Dataflows / pipelines** | 3 HTTP pipelines on the tenant's Mesh Adapter — create / list / redeem. No backend code, just pipeline YAML |
| **Blueprints** | One `InstallBlueprint` command seeds the CK model, the DataFlow + pipelines, and the web-app workload into any tenant |
| **Operator / deployments / apps** | The web UI is an `Application` entity; the Communication Operator rolls it out to Kubernetes as a Helm release with ingress |

```
browser ── https://one-time-ticket-test.127.0.0.1.nip.io   (ingress, kind)
              │
              ▼
   One-Time Ticket App  (Application entity 0771…05, Helm-deployed by the operator)
   Node proxy + static SPA: /api/* ──► Mesh Adapter (in-cluster, :80/test)
                                          │  POST /tickets   ── ott-create-ticket
                                          │  GET  /tickets   ── ott-list-tickets
                                          │  GET  /redeem    ── ott-redeem-ticket
                                          ▼
                                   Demo.Tickets/Ticket entities (data mesh)
```

## Repo layout

| Path | Purpose |
|---|---|
| `ck/ConstructionKit/` | `Demo.Tickets` CK model source (YAML) |
| `ck/DemoTickets.csproj` | Wraps the model so `dotnet build` compiles + publishes it (octo-construction-kit pattern). Built via `OneTimeTicket.sln` |
| `blueprint/OneTimeTicket.MainLatest/` | Blueprint variant for **dev/test** (Application → meshmakers-dev Helm repo `…003`). Manifest + seed data (DataFlow, 3 pipelines, Application) |
| `blueprint/OneTimeTicket.Release/` | Blueprint variant for **staging/production** (Application → meshmakers-apps release Helm repo `…005`). Seed differs from MainLatest only in that one association |
| `src/charts/one-time-ticket-app/` | The app's own Helm chart (based on octo-mesh-demo-app), published to the dev + apps channels by CI |
| `app/` | The web app: zero-dependency Node proxy (`server/server.js`), single-file SPA (`client/index.html`), `Dockerfile` |
| `azure-pipelines.yml` | CI using the shared `octo-pipeline-templates` + `helm-chart-build` templates |
| `test/dataflow-test.yaml` | Scratch dataflow used for pipeline iteration (temp rtIds/paths) — not part of the install |

## The install story (what the customer sees)

Prerequisites on the tenant: communication enabled (the service-managed
`System.Communication` blueprint provides Pool `…001`, Mesh Adapter `…002`,
Helm repo `…003`).

```powershell
# 1. Install the blueprint — imports the Demo.Tickets CK model from the
#    catalog and seeds DataFlow + pipelines + Application into the tenant.
#    Pick the variant for the target environment:
#      dev/test          -> OneTimeTicket.MainLatest
#      staging/production -> OneTimeTicket.Release
octo-cli -c InstallBlueprint -b OneTimeTicket.MainLatest-1.0.0

# 2. Deploy the pipelines to the Mesh Adapter
octo-cli -c DeployDataFlow --identifier 077100000000000000000001

# 3. Let the operator roll out the web app (Helm release + ingress)
octo-cli -c DeployWorkload -id 077100000000000000000005
```

≈30 seconds later: **https://one-time-ticket-test.127.0.0.1.nip.io** (the
hostname is `one-time-ticket-<tenant>.<cluster default domain>` — resolved by
the communication controller at deploy time, `127.0.0.1.nip.io` on kind).

### Demo walkthrough (2 minutes)

1. Open the app → *Issue New Ticket*: name `API key for ACME`, secret
   `sk-live-…` → **Create Ticket** → copy the redeem link.
2. Show the ticket list: status **Open**. (Optionally: show the same entity in
   OctoMesh Studio — it's a plain `Demo.Tickets/Ticket` runtime entity.)
3. Open the redeem link (incognito makes the point nicely) → **Reveal Secret**
   → the secret appears, with the "shown exactly once" warning.
4. Reload, click again → **Already Redeemed**. Back on the dashboard the
   ticket is now *Redeemed* with timestamp; the secret has been **cleared** in
   the mesh (not just hidden).
5. The API is curl-able too:
   ```bash
   curl -sk -X POST https://one-time-ticket-test.127.0.0.1.nip.io/api/tickets \
        -H "Content-Type: application/json" -d '{"name":"cli ticket","secret":"hello"}'
   curl -sk "https://one-time-ticket-test.127.0.0.1.nip.io/api/redeem?id=<ticketId>"
   ```

### Talking points

- **No backend service was written.** The entire ticket logic (lookup,
  conditional redeem, burn) is declarative pipeline YAML executed by the stock
  Mesh Adapter.
- **One artifact installs everything.** The blueprint carries the data model
  (via `ckModelDependencies`, resolved from the CK catalog), the dataflow and
  the app workload — versioned, updatable (`UpdateBlueprint`), uninstallable.
- **The platform deploys the app itself.** The `Application` entity + operator
  = Helm release, ingress, TLS. The same seed works on any cluster (hostname
  template `{{domain.default}}`).

## Developer workflow (how this was built)

```powershell
# 1. CK model: dotnet build compiles AND publishes Demo.Tickets into the local
#    CK catalog (no manual octo-ckc).
dotnet build OneTimeTicket.sln -c DebugL

# 2. Blueprint: copy a variant into the local blueprint catalog (pick MainLatest
#    for a dev/test tenant). The catalog layout is version-foldered:
$dst = "$HOME\.octo\local-blueprint-catalog\blueprints\v1\OneTimeTicket.MainLatest\1.0.0"
New-Item -ItemType Directory -Force "$dst\seed-data" | Out-Null
Copy-Item .\blueprint\OneTimeTicket.MainLatest\blueprint.yaml $dst -Force
Copy-Item .\blueprint\OneTimeTicket.MainLatest\seed-data\entities.yaml "$dst\seed-data" -Force
# the catalog cache only refreshes when the cache file is missing:
Remove-Item "$HOME\.octo\blueprint-catalog\cache\local-blueprint-catalog-cache.json" -Force

# 3. App image: build + load into kind (no registry needed; the operator
#    injects docker.mm.cloud as registry prefix, so tag both names)
docker build -t meshmakers/one-time-ticket-app:dev .\app
docker tag meshmakers/one-time-ticket-app:dev docker.mm.cloud/meshmakers/one-time-ticket-app:dev
kind load docker-image meshmakers/one-time-ticket-app:dev docker.mm.cloud/meshmakers/one-time-ticket-app:dev

# 4. Install + deploy (see "install story" above)
```

To iterate on the **app** only: rebuild + `kind load` + restart the pod
(`kubectl rollout restart deploy/<tenant>-077100000000000000000005-one-time-ticket-app -n octo`).

To iterate on **pipelines**: edit the seed, re-apply with
`octo-cli -c InstallBlueprint -b OneTimeTicket.MainLatest-1.0.0 -f`, then `DeployDataFlow`.

### Resetting the demo

```powershell
# wipe all tickets (they're plain runtime entities — Studio or GraphQL delete works too)
# the blueprint entities themselves stay untouched
```
Tickets are ordinary `Demo.Tickets/Ticket` entities; delete them via Studio or
the asset-repo GraphQL `runtime.runtimeEntities.delete` mutation.

For the full wow-effect live install: `UninstallBlueprint -n OneTimeTicket.MainLatest`
(or `OneTimeTicket.Release`) then re-run the 3 install commands. (Rehearse before the demo — uninstall also
removes the seeded Application entity; undeploy the workload first:
`octo-cli -c UndeployWorkload -id 077100000000000000000005 -y`.)

## CI / releasing

`azure-pipelines.yml` (root, pool `meshmakers-ci-agents`) uses the shared
`octo-pipeline-templates` + `helm-chart-build` templates — the same shape as
`octo-mesh-adapter` and `octo-construction-kit`. The CK model and both blueprints
go through the shared `validate-and-publish-ck-versions` / `validate-and-publish-blueprints`
steps, which take their catalogs from the shared `update-build-number` routing and never
replace a published version — a content change needs a version bump:

| Trigger | CK model | Blueprints | Chart | Image |
|---|---|---|---|---|
| `dev/*` | validate only | validate only | — | build (no publish) |
| `main` | `PrivateGitHubCatalog` | `PrivateGitHubBlueprintCatalog` | dev channel | push `<buildnumber>` |
| `test/<X.Y>-*` | validate only | validate only | — | push `<buildnumber>` |
| `r<X.Y.Z>` tag | `PrivateGitHubCatalog` **and `PublicGitHubCatalog`** | `PrivateGitHubBlueprintCatalog` **and `PublicGitHubBlueprintCatalog`** | **apps release channel** (`meshmakers.github.io/apps`) | push `<X.Y.Z>` |

**Managed environments (staging/prod) read the public CK catalog + the apps
release Helm channel**, so cutting an `r*` tag is what makes the app installable
there. The chart `appVersion` is set to the image build number, so the chart's
`image.tag` default resolves to the matching image — no pinned tag, no guard.

One-time ADO setup:
1. Point the pipeline definition's `yamlFilename` at `azure-pipelines.yml`
   (this replaces the deleted `devops-build/`).
2. Authorize variable groups `ApiKeys-mm-cloud` + `OctoDefault`, the docker
   registry service connection, and the `helm-chart-build` GitHub token
   (`HelmChartBuildGhToken`). `GitHubPAT` needs contents-write on
   `construction-kit-libraries-build`, `blueprint-libraries-build`,
   `meshmakers.github.io` and `meshmakers.github.io` (apps).
3. Push a `dev/*` branch first — it runs build + validate + image build with all
   publishing gated off — then merge to `main`, then cut `r<X.Y.Z>` to release.

Install on any environment (per tenant, communication enabled first). Pick the
variant for the environment — `OneTimeTicket.MainLatest` on dev/test,
`OneTimeTicket.Release` on staging/production:

```powershell
octo-cli -c InstallBlueprint -b OneTimeTicket.Release-1.0.0   # resolves blueprint + CK model from the GitHub catalogs
octo-cli -c DeployDataFlow --identifier 077100000000000000000001
octo-cli -c DeployWorkload -id 077100000000000000000005       # pulls the one-time-ticket-app chart + image
```

## Known limitations (by design — it's a demo)

- **No auth on the endpoints.** Anyone with the URL can create/list/redeem.
- **Redeem is not atomic.** Two perfectly concurrent redeems could both read
  `redeemed=false` before either write lands. Fine for a demo; a real
  implementation would want a check-and-set primitive in `ApplyChanges`.
- **Errors return HTTP 200** with `{"error": …}` — the adapter's HTTP trigger
  doesn't expose status-code control.
- On clusters other than local kind, the image must be pushed to a registry the
  cluster can pull from (`docker.mm.cloud/meshmakers/one-time-ticket-app`); the
  operator injects `image.privateRegistry=docker.mm.cloud`.

## Gotchas learned while building (platform notes)

- The **local blueprint catalog cache** (`~/.octo/blueprint-catalog/cache/
  local-blueprint-catalog-cache.json`) is only rebuilt when the file is
  *missing* — `ListBlueprints` does not refresh a stale cache. Delete the file
  after adding a blueprint.
- **`ImportRt -r` (replace) + repeated `DeployDataFlow` on a live dataflow can
  rotate pipeline registrations** (an unchanged pipeline gets removed while a
  changed one is re-registered; the next deploy flips them). Fresh
  blueprint-install + single `DeployDataFlow` is reliable. See adapter log
  `Removing pipeline …` / `Re-registering changed pipeline …`.
- `SetPrimitiveValue@1` **fails the whole pipeline on a missing source path** —
  guard optional attributes (e.g. `RedeemedAt`) with an `If@1` on a discriminator.
- `SetPipelineExecutionResult@1` does **not** shape the HTTP response of a
  `FromHttpRequest@1` pipeline — the response is the full final DataContext.
  Use `Project@1` with `clear: true` as the last node to control (and sanitize!)
  the response.
- Pipeline result-set shapes are **PascalCase** (`$.lookup.TotalCount`,
  `$.lookup.Items[0].Attributes.Secret`); `attributeName` in
  `CreateUpdateInfo@1` matches the CK attribute name as declared (`Secret`,
  `Redeemed`, …).
