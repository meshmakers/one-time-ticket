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
| `ck/ConstructionKit/` | `Demo.Tickets` CK model source (compile with `octo-ckc`) |
| `ck/out/` | Compiled model (generated) |
| `blueprint/OneTimeTicket/` | The blueprint: manifest + seed data (DataFlow, 3 pipelines, Application). Name-only folder; version lives in `blueprint.yaml`'s `blueprintId`. **Single source of truth** for everything installed into a tenant |
| `app/` | The web app: zero-dependency Node proxy (`server/server.js`), single-file SPA (`client/index.html`), `Dockerfile` |
| `test/dataflow-test.yaml` | Scratch dataflow used for pipeline iteration (temp rtIds/paths) — not part of the install |

## The install story (what the customer sees)

Prerequisites on the tenant: communication enabled (the service-managed
`System.Communication` blueprint provides Pool `…001`, Mesh Adapter `…002`,
Helm repo `…003`).

```powershell
# 1. Install the blueprint — imports the Demo.Tickets CK model from the
#    catalog and seeds DataFlow + pipelines + Application into the tenant
octo-cli -c InstallBlueprint -b OneTimeTicket-1.0.1

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
$ckc = "C:\dev\meshmakers\octo-construction-kit-engine\bin\DebugL\net10.0\octo-ckc.exe"

# 1. CK model: author YAML → compile → publish into the local CK catalog
& $ckc -c Compile -p .\ck\ConstructionKit -o .\ck\out
& $ckc -c Publish -f .\ck\out\ck-demo.tickets.yaml -r       # → ~/.octo/local-catalog

# 2. Blueprint: copy into the local blueprint catalog
$dst = "$HOME\.octo\local-blueprint-catalog\blueprints\v1\OneTimeTicket\1.0.0"
New-Item -ItemType Directory -Force "$dst\seed-data" | Out-Null
Copy-Item .\blueprint\OneTimeTicket\1.0.0\blueprint.yaml $dst -Force
Copy-Item .\blueprint\OneTimeTicket\1.0.0\seed-data\entities.yaml "$dst\seed-data" -Force
# the catalog cache only refreshes when the cache file is missing:
Remove-Item "$HOME\.octo\blueprint-catalog\cache\local-blueprint-catalog-cache.json" -Force

# 3. App image: build + load into kind (no registry needed; the operator
#    injects docker.mm.cloud as registry prefix, so tag both names)
docker build -t meshmakers/one-time-ticket-app:0.1.0 .\app
docker tag meshmakers/one-time-ticket-app:0.1.0 docker.mm.cloud/meshmakers/one-time-ticket-app:0.1.0
kind load docker-image meshmakers/one-time-ticket-app:0.1.0 docker.mm.cloud/meshmakers/one-time-ticket-app:0.1.0

# 4. Install + deploy (see "install story" above)
```

To iterate on the **app** only: rebuild + `kind load` + restart the pod
(`kubectl rollout restart deploy/test-077100000000000000000005-property-walker -n octo`).

To iterate on **pipelines**: edit the seed, bump nothing, re-apply with
`octo-cli -c InstallBlueprint -b OneTimeTicket-1.0.1 -f`, then `DeployDataFlow`.

### Resetting the demo

```powershell
# wipe all tickets (they're plain runtime entities — Studio or GraphQL delete works too)
# the blueprint entities themselves stay untouched
```
Tickets are ordinary `Demo.Tickets/Ticket` entities; delete them via Studio or
the asset-repo GraphQL `runtime.runtimeEntities.delete` mutation.

For the full wow-effect live install: `UninstallBlueprint -n OneTimeTicket`
then re-run the 3 install commands. (Rehearse before the demo — uninstall also
removes the seeded Application entity; undeploy the workload first:
`octo-cli -c UndeployWorkload -id 077100000000000000000005 -y`.)

## CI / installing on test-2

`devops-build/azure-pipelines.yml` (Azure DevOps, pool `meshmakers-ci-agents`,
modeled on the energy-community demo pipeline) publishes everything the shared
**test-2** cluster needs:

| Branch | What happens |
|---|---|
| any push | compile CK model (`octo-ckc`), validate blueprint (`octo-bpm`), docker build |
| `test/*` | + push image `docker.mm.cloud/meshmakers/one-time-ticket-app:<buildnumber>` |
| `main` | + push image (`<buildnumber>` **and** the blueprint-pinned `0.1.0`), publish `Demo.Tickets` to `PrivateGitHubCatalog` and `OneTimeTicket-1.0.1` to `PrivateGitHubBlueprintCatalog` |

Only `main` writes to the shared GitHub catalogs and the pinned image tag —
dev/test branches can never change what `InstallBlueprint` resolves on test-2.
A guard step fails the build if `AppImageVersion` (pipeline) and the image tag
in `seed-data/entities.yaml` drift apart.

One-time setup after pushing the repo to GitHub (`meshmakers` org):
1. Azure DevOps → New pipeline → GitHub → this repo → existing YAML
   `devops-build/azure-pipelines.yml`.
2. Authorize it for variable groups `ApiKeys-mm-cloud` + `OctoDefault` and the
   docker registry service connection. (`GitHubPAT` needs contents-write on
   `construction-kit-libraries-build` and `blueprint-libraries-build`.)
3. Run once from a `dev/*` branch to verify the no-publish gating, then merge
   to `main`.

Install on test-2 (per tenant, communication must be enabled first):

```powershell
# against the test-2 environment (connect.test-2.mm.cloud)
octo-cli -c InstallBlueprint -b OneTimeTicket-1.0.1      # resolves blueprint + CK model from the GitHub catalogs
octo-cli -c DeployDataFlow --identifier 077100000000000000000001
octo-cli -c DeployWorkload -id 077100000000000000000005   # pulls docker.mm.cloud/meshmakers/one-time-ticket-app:0.1.0
```

## Known limitations (by design — it's a demo)

- **No auth on the endpoints.** Anyone with the URL can create/list/redeem.
- **Redeem is not atomic.** Two perfectly concurrent redeems could both read
  `redeemed=false` before either write lands. Fine for a demo; a real
  implementation would want a check-and-set primitive in `ApplyChanges`.
- **Errors return HTTP 200** with `{"error": …}` — the adapter's HTTP trigger
  doesn't expose status-code control.
- **Chart reuse:** the Application uses the existing `property-walker` Helm
  chart (the app intentionally fulfils the same contract: `PORT`,
  `UPSTREAM_URL`, probe on `/`) with the image overridden in `ValuesYaml`.
  Publishing a dedicated `one-time-ticket-app` chart via the standard CI would
  make `chartName` self-describing.
- On clusters other than local kind, the image must be pushed to a registry
  the cluster can pull from (`docker.mm.cloud/meshmakers/one-time-ticket-app:0.1.0`).

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
