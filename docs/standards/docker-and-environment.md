# Docker and Environment Standards

Applies to environment files, `compose.yaml` and its override files, workspace
Dockerfiles, `.dockerignore`, image builds in CI, production containers, and the reverse
proxy. Node and pnpm rules live in [nodejs.md](nodejs.md).

**Source of truth:** `compose.yaml`, `compose.production.yaml`, workspace Dockerfiles,
`.dockerignore`, `docker-bake.hcl`, `.github/workflows/`, `.github/dependabot.yml`.

---

## Environment files

**ENV-1 — Configuration comes from `.env` (development) and `.env.test` (tests) at the
repository root.** Both are git-ignored. Their committed templates, `.env.example` and
`.env.test.example`, MUST list every variable with a safe placeholder. Add a variable to
the templates in the same change that starts reading it.

**ENV-2 — Never commit real secrets.** In templates, a secret gets an obvious placeholder
(`SESSION_SECRET=<generate-your-own-secret>`). Only `.env.test.example` may contain a
throwaway literal secret. Production secrets follow ENV-31.

**ENV-3 — Variable names are `SCREAMING_SNAKE_CASE`, grouped and prefixed by the service
they configure:**

```dotenv
APP_DOMAIN=app.example.dev
LOG_LEVEL=DEBUG

FRONTEND_HOST=frontend
FRONTEND_PORT=5173

BACKEND_HOST=backend
BACKEND_PORT=3000
WS_PORT=8080

DB_HOST=mongo
DB_PORT=27017
DB_NAME=app
DB_USER=app
DB_PASSWORD=<generate-your-own-secret>
```

**ENV-4 — Keep the test environment isolated from development.** It uses a different
database name (`test-app`) and runs as its own Compose project, with its own containers,
network, and volumes, so tests can run while the dev stack is up. Root scripts wrap this
(MONO-11): `docker compose -p app-test --env-file .env.test run --rm backend-test`, then
`docker compose -p app-test down -v`.

---

## Docker Compose

**ENV-5 — The Compose file is `compose.yaml` at the repository root, with a top-level
`name:` and no `version:` key** (`version` is obsolete and only triggers a warning). Use
the `docker compose` plugin, Compose 2.33.1 or later (the v5 line recommended), with
Buildx installed; never the legacy `docker-compose` v1 binary.

**ENV-6 — Each workspace and each piece of infrastructure is a Compose service**, named
to match the hostname used in env vars and proxy upstreams: `frontend`, `backend`, `mongo`,
`proxy`. Core services have no `profiles`, so `docker compose up` starts the stack. Put
optional services under a profile (`backend-test` under `test`, admin tools under
`tools`) instead of adding an aggregate service. Running a profiled service by name
enables its profile automatically.

**ENV-7 — Services load configuration with `env_file`.** Compose also reads `.env` to
interpolate `${VAR}` in `compose.yaml`, but that alone passes nothing to a container. Use
`environment` only for interpolated values (`MONGO_INITDB_DATABASE: ${DB_NAME}`), fixed
constants (`NODE_ENV: dev`), and `<NAME>_FILE` pointers to secrets. Never put a secret
literal in `environment`, and never set one key in both places: `environment` wins.

**ENV-8 — A test service `extends` its main service** and sets its own `profiles`,
build `target`, and `env_file: [.env.test]`. `extends` merges `env_file` lists rather than
replacing them, so `backend-test` loads `.env` and then `.env.test`: `.env.test` MUST
redefine every key whose test value differs, and CI creates `.env` from `.env.example`.
`extends` does not copy `depends_on`, so the test service redeclares it.

**ENV-9 — Development services SHOULD receive source changes through Compose Watch**
(`docker compose up --watch`). Dev images contain their own dependencies (ENV-17).
`develop.watch` uses `sync` for workspace `src/`, `sync+exec` with
`pnpm shared:base build` for `shared/src/`, and `rebuild` for `package.json` and
`pnpm-lock.yaml`. Never sync or bind-mount host `node_modules`. A source bind mount plus
an anonymous volume over each `node_modules` MAY replace Watch; then run
`docker compose up --build -V` after dependency changes. Turn on watcher polling only if
file watching is shown to be broken.

**ENV-10 — MongoDB data lives in a named volume** (`mongo-data:/data/db`), never a bind
mount; the `mongo` image documents that Docker Desktop's macOS and Windows file sharing is
incompatible with MongoDB's memory-mapped files. Other git-ignored local files (generated
secrets, seed data) live under `.docker/`.

**ENV-11 — Every long-running service defines a `healthcheck`, and dependents wait with
`condition: service_healthy`;** otherwise Compose waits only until a container is running.
The backend waits for `mongo` (with `restart: true`) and the proxy for its upstreams. Use
exec-form checks with a binary the image has (slim images have `node`, not `curl`). The
backend exposes `GET /api/health`.

```yaml
mongo:
  healthcheck:
    test: [CMD, mongosh, --quiet, --eval, "db.adminCommand('ping').ok"]
backend:
  depends_on:
    mongo: { condition: service_healthy, restart: true }
  healthcheck:
    test: [CMD, node, -e, "fetch('http://127.0.0.1:' + process.env.BACKEND_PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
```

**ENV-12 — Only the proxy publishes host ports, and in development it binds them to
loopback** (`"127.0.0.1:443:8443"`). Docker publishes on every interface by default. Other
services are reached by service name. If you need a local MongoDB GUI, publish
`127.0.0.1:${DB_PORT}:27017` only while you use it.

**ENV-13 — MongoDB runs with authentication: MUST in production, SHOULD in development.**
The `mongo` image disables auth unless both root variables are set. Pass them as Compose
secrets through `MONGO_INITDB_ROOT_USERNAME_FILE` and `MONGO_INITDB_ROOT_PASSWORD_FILE`,
from files the setup script generates under `.docker/secrets/`. An init script in
`/docker-entrypoint-initdb.d/` creates an app user with `readWrite` on `DB_NAME` only. The
backend connects as that user; root is for administration.

---

## Dockerfiles

**ENV-14 — Each runnable workspace has one multi-stage Dockerfile** with stages
named `<pkg>-base` → `<pkg>-build` → `<pkg>-dev`, plus `<pkg>-test` and `<pkg>-prod`.
The build context is the repository root, so a stage can copy `shared`, `package.json`,
`pnpm-workspace.yaml`, and `pnpm-lock.yaml`. Shared `ARG`/`ENV` values are set once in
the base stage.

**ENV-15 — Every Dockerfile starts with `# syntax=docker/dockerfile:1` and
`# check=error=true`.** The first pins builders to the current Dockerfile frontend; the
second makes build-check violations (secrets in `ARG`/`ENV`, shell-form `CMD`, copying an
ignored file) fail the build. Skip a check only with `# check=skip=<Name>` and a comment.

**ENV-16 — A root `.dockerignore` MUST exclude** `**/node_modules`, `**/dist`,
`**/coverage`, `**/*.log`, `**/.env`, `**/.env.*`, `**/.npmrc`, `.git`, `.docker/`, and
`certs/`. Every image builds from the repository root, so anything not excluded is sent
to the builder and can be copied into a layer.

**ENV-17 — Install dependencies in a cached, lockfile-first layer, then build with a
filter.** Enable pnpm with `corepack enable` (NODE-2). Copy only the root `package.json`
(for `packageManager`), `pnpm-workspace.yaml`, and `pnpm-lock.yaml`; `pnpm fetch` with a
BuildKit cache mount; copy the source; install offline from the frozen lockfile. Source
edits then reuse the dependency layer. Build the workspace and its dependencies, `shared`
first, with one filter:

```dockerfile
# syntax=docker/dockerfile:1
# check=error=true
ARG NODE_IMAGE=node:24.21.0-bookworm@sha256:<digest>
ARG NODE_RUNTIME_IMAGE=node:24.21.0-bookworm-slim@sha256:<digest>

FROM ${NODE_IMAGE} AS backend-base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline

FROM backend-base AS backend-build
RUN pnpm --filter "@app/backend..." build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @app/backend --prod deploy --legacy /out
```

**ENV-18 — Base images: full Debian for building, minimal for production.** Base, build,
dev, and test stages use `node:24-bookworm` (NODE-1), which has the toolchain native
addons need. `backend-prod` uses `node:24-bookworm-slim` (same Debian release, so native
binaries still run) and MUST NOT use the full image. The backend SHOULD NOT use
`-alpine`. Declare each base image once, as an `ARG` before the first `FROM`.

**ENV-19 — In dev and test stages, `ENTRYPOINT` runs the root workspace alias and `CMD`
names the script** (`ENTRYPOINT ["pnpm", "backend:base"]`, `CMD ["start:dev"]`), so
`docker compose run backend <script>` works for any script. These services set
`init: true` in Compose, because `pnpm` is PID 1. Dev and test stages MAY run as root.

**ENV-20 — A `-prod` stage contains only built output and production dependencies, and
runs as a non-root user.** Produce it with `pnpm deploy --prod` (ENV-17); on pnpm 10 that
needs `--legacy` unless `injectWorkspacePackages` is on. Deploy selects files by the
`files` field, then `.npmignore`, then `.gitignore`, so `backend` and `shared` declare
`"files": ["dist"]`. Set `NODE_ENV=prod` (NODE-11) only here, never where `pnpm install`
runs. Leave files root-owned unless the app writes to them, and listen above port 1024.

**ENV-21 — `CMD` and `ENTRYPOINT` use exec form everywhere, and production runs `node`
directly under a minimal init.** `pnpm start` or a shell can swallow `SIGTERM`, and Node is
not designed to run as PID 1. The image SHOULD include `tini` or `dumb-init`; Compose
`init: true` is acceptable while Compose is the only runtime.

```dockerfile
FROM ${NODE_RUNTIME_IMAGE} AS backend-prod
RUN apt-get update && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=prod
WORKDIR /app
COPY --from=backend-build /out ./
USER node
EXPOSE 3000 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
```

**ENV-22 — `frontend-prod` serves the Vite build from `nginxinc/nginx-unprivileged`**
(non-root, port 8080), with only `frontend/dist` and its NGINX config copied in. Never
serve production traffic from `vite preview` or the dev server.

---

## Image security and supply chain

**ENV-23 — Secrets never enter an image or its build history.** Never `COPY` `.env*`
files, `.npmrc` files with tokens, keys, or certificates into any stage, build stages
included. Never pass a secret through `ARG` or `ENV`; both persist, and CI provenance
records build-arg values. A step that needs a credential mounts it for that one `RUN`
(`RUN --mount=type=secret,id=npmrc,target=/root/.npmrc pnpm install …`). Keep tokens out
of the environment while `pnpm install` runs; NODE-3 governs install scripts.

**ENV-24 — Pin every image to an exact version, and let Dependabot update every pin.**
`FROM` lines and Compose `image:` entries MUST name a full version tag
(`node:24.21.0-bookworm-slim`), never `latest`, `lts`, or a bare major, and SHOULD add the
digest. A pin without automated updates stops security fixes, so
`.github/dependabot.yml` covers every ecosystem that holds pins: `npm` (the pnpm
lockfile), `docker` (every directory with a Dockerfile, including `.github/tools/*`),
`docker-compose`, and `github-actions` (workflows and `.github/actions/*`). Updates run
weekly, minor and patch updates are grouped, and each update waits a 7-day cooldown after
release. That is longer than GitHub's 3-day default (since 14 July 2026), so a compromised
release is more likely to be pulled before it reaches this repository. Security updates
ignore the cooldown. Renovate MAY replace Dependabot.

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule: { interval: "weekly" }
    cooldown: { default-days: 7 }
    groups:
      npm-minor-and-patch: { update-types: ["minor", "patch"] }
  - package-ecosystem: "github-actions"
    directories: ["/", "/.github/actions/*"]
    schedule: { interval: "weekly" }
    cooldown: { default-days: 7 }
    groups:
      actions-minor-and-patch: { update-types: ["minor", "patch"] }
  - package-ecosystem: "docker"
    directories: ["/backend", "/frontend", "/.github/tools/*"]
    schedule: { interval: "weekly" }
    cooldown: { default-days: 7 }
  - package-ecosystem: "docker-compose"
    directory: "/"
    schedule: { interval: "weekly" }
    cooldown: { default-days: 7 }
```

**ENV-25 — Containers run with least privilege.** Never mount the Docker socket or use
`privileged: true`. Production services MUST set `cap_drop: [ALL]` and
`security_opt: ["no-new-privileges:true"]`, and SHOULD set `read_only: true` with a
`tmpfs` for `/tmp` (verify per image, especially `mongo`) and memory, CPU, and `pids`
limits. Development services SHOULD drop capabilities too unless a tool breaks. On a PaaS,
use the platform's equivalents.

**ENV-26 — CI scans images, and published images carry a GitHub attestation.**

- **Scanning.** The `docker` CI area scans each image it builds on a PR
  ([ci-pipeline.md](ci-pipeline.md) CI-13). `scan.yml` scans the published images
  weekly and uploads the results as SARIF to code scanning (free for public
  repositories; `security-events: write`). Use one free scanner. Trivy through
  `aquasecurity/trivy-action` MUST be pinned by SHA at v0.35.0 or later: on 19 March 2026,
  76 of 77 earlier tags were force-pushed to a credential stealer _(non-GitHub: Aqua
  Security, Microsoft)_. Grype or Docker Scout are alternatives. Fail on fixable `HIGH`
  and `CRITICAL` findings. Each accepted finding goes in the ignore file with a reason and
  an expiry date.
- **Attestation.** The `publish` job attests each pushed digest with GitHub's
  `actions/attest` (free for public repositories), in addition to
  `build-push-action`'s default provenance with `sbom: true`. That meets SLSA Build Level
  2. A deploy verifies it first:
  `gh attestation verify oci://ghcr.io/<owner>/<repo>/<image>@<digest> --repo <owner>/<repo>`
  ([github-actions.md](github-actions.md) GHA-27). An attestation shows where and how an
  image was built, not that it is safe.

Do not use Docker Content Trust; it shuts down on 2026-12-08.

---

## Build and CI

**ENV-27 — Pin every GitHub Action to a full commit SHA, with its version in a comment**
(`uses: docker/build-push-action@<sha> # v7.x.y`), and give each job the least
`permissions` it needs ([github-actions.md](github-actions.md) GHA-9, GHA-24). In March
2026 attackers force-pushed the tags of Trivy's actions to steal CI secrets. A job that
builds images gets no secret beyond its registry credential.

**ENV-28 — Production images are built only in CI**, by the `publish` job on pushes to
`main` and `v*` tags ([ci-pipeline.md](ci-pipeline.md) CI-13); never on a laptop and
pushed by hand. PRs build without pushing. CI uses Buildx through Docker's official
actions with the GitHub Actions cache (`type=gha`, `mode=max`) and one cache `scope` per
image, or each image's build overwrites the others' cache. Only pushing runs set
`cache-to`, so PR builds read `main`'s cache without evicting it. The cache backend has
required Buildx 0.21+ and BuildKit 0.20+ since 15 April 2025; current
`setup-buildx-action` releases provide them. Each image SHOULD be a target in a root
`docker-bake.hcl`. Build for the deployment target's platform; `linux/arm64` MAY use
GitHub's arm64 runners, which are free for public repositories.

**ENV-29 — CI runs tests the way developers do:** unit tests on the runner, backend tests
in the `backend-test` Compose service ([testing.md](testing.md)). Never test in a `-prod`
stage. [ci-pipeline.md](ci-pipeline.md) defines the jobs, and
[github-actions.md](github-actions.md) how workflows are written.

**ENV-30 — Images are published to GHCR and deployed by immutable tag or digest.**

- **Login.** The `publish` job logs in with `GITHUB_TOKEN`, and it is the only job granted
  `packages: write` ([github-actions.md](github-actions.md) GHA-9).
- **Tags and labels.** `docker/metadata-action` tags `main` builds `sha-<short>` and
  `vX.Y.Z` git tags `X.Y.Z`, and adds OCI labels, including
  `org.opencontainers.image.source`. Images pushed from a workflow are linked to the
  repository automatically.
- **Visibility.** New GHCR packages start private. Set each package to public, matching
  the repository, so a deploy target can pull without credentials. Outside Actions, GHCR
  accepts only a classic personal access token for private packages.
- **Deploys.** Deploy configuration MUST reference a `sha-…` tag or a digest, never
  `latest`. Rollback is redeploying the previous digest.
- **Cleanup.** Old untagged versions MAY be pruned with `actions/delete-package-versions`
  (in limited maintenance). Never delete an untagged child manifest of a multi-platform
  image that a tag still references.

---

## Production runtime

**ENV-31 — Production configuration comes from the runtime environment; secrets come from
files or the platform's secret store.** Use an untracked env file on a VPS or the
platform's settings on a PaaS. Secrets SHOULD be mounted files (Compose `secrets:`) or
platform secrets rather than plain env vars, which every process can read and logs can
leak. The config factory (NODE-8) reads `<NAME>_FILE` when set and still fails fast
(NODE-10).

**ENV-32 — On Compose, production uses an override file**
(`docker compose -f compose.yaml -f compose.production.yaml up -d`) that drops Watch and
bind mounts, runs the `-prod` images by SHA tag, publishes the proxy publicly, sets
`restart: unless-stopped`, and applies ENV-25. Never run the dev configuration in
production.

**ENV-33 — Containers shut down cleanly.** The backend MUST call
`app.enableShutdownHooks()`; otherwise NestJS skips its shutdown hooks on `SIGTERM`. Node
services SHOULD set `stop_grace_period: 30s` (the default is 10 s), with the app's
shutdown timeout below it. On shutdown the gateway SHOULD close clients with code 1001;
clients reconnect (WS-16), so a deploy MAY drop WebSocket connections briefly.

**ENV-34 — Containers log to stdout and stderr only, and the host rotates logs.** Never
write log files inside a container. Docker's default `json-file` driver does not rotate,
so any Docker host we run MUST use `logging: { driver: local }` or set `max-size` and
`max-file` (for example `"10m"` and `"3"`).

**ENV-35 — Production data is backed up, and the database is never publicly reachable.**
MongoDB publishes no port, uses auth (ENV-13), and SHOULD sit on a network the proxy
cannot reach. Atlas M0 MUST NOT hold production data; it has no backups. A self-hosted
container uses a pinned image, a named volume, and a scheduled `mongodump` to off-host
storage. Test a restore before relying on any backup.

---

## Reverse proxy and TLS

**ENV-36 — A reverse proxy (NGINX) is the single public entry point.** It terminates TLS
for `APP_DOMAIN` (unless the platform does) and routes traffic to upstreams named by role:

- `/api` → `backend` (the NestJS app)
- WebSocket traffic → `websocket`, the gateway on `WS_PORT`
- everything else → `frontend` (the Vite dev server, or `frontend-prod`)

**ENV-37 — Proxy WebSockets explicitly and keep them open.** Set `Upgrade` and
`Connection` on the WebSocket location and on `/`, which carries Vite's HMR socket. NGINX
closes a connection after 60 s with no data, so raise `proxy_read_timeout` well above the
server's ping interval:

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

location /ws/ {
  proxy_pass http://websocket;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_read_timeout 1h;
}
```

**ENV-38 — The proxy SHOULD run as `nginxinc/nginx-unprivileged`**, listening on 8080 and
8443 inside the container, so it can run under ENV-25. Set `server_tokens off;`, allow only
TLS 1.2 and 1.3, and mount certificates read-only.

**ENV-39 — TLS certificates are generated or renewed by tooling, never committed.**
Locally, a setup script runs `mkcert` into a git-ignored `certs/` directory. Never mount
mkcert's `rootCA-key.pem`; a Node container that calls the proxy over HTTPS gets
`NODE_EXTRA_CA_CERTS` pointing at `rootCA.pem`. In production, a PaaS terminates TLS, or
the VPS edge renews via ACME (certbot or Caddy). Never renew certificates by hand.

**ENV-40 — Frontend and backend code MUST NOT hard-code `localhost` URLs or ports.**
Derive them from configuration (`APP_DOMAIN`, `window.location`) and route traffic through
the proxy. The Vite dev server sets `server.host: true`, `server.strictPort: true`, and
`server.allowedHosts: [APP_DOMAIN]`, never `allowedHosts: true`.
