# Monorepo Standards

Applies to repository structure, workspace boundaries, and the `shared` package.

---

## Workspaces

**MONO-1 — The repository is a pnpm workspace** with one package per deployable or shared
unit:

```txt
<repo>/
  frontend/   @app/frontend React UI
  backend/    @app/backend  NestJS API + WebSocket gateway
  shared/     @app/shared   framework-free code used by both
  package.json              root scripts, shared tooling, packageManager
  pnpm-workspace.yaml       workspace packages and pnpm settings
  pnpm-lock.yaml
  tsconfig.json             project references only
  compose.yaml
```

Workspace packages are listed in `pnpm-workspace.yaml`, not in a `workspaces` field in
`package.json`:

```yaml
packages:
  - frontend
  - backend
  - shared
onlyBuiltDependencies:
  - bcrypt
  - esbuild
```

Package names share one scope: `@app/frontend`, `@app/backend`, `@app/shared`.

**MONO-2 — Depend on sibling workspaces with `"workspace:*"`.** Never import across
workspaces with relative paths (`../../shared/src/...`); import the package by name.

**MONO-3 — Dependencies flow one way:** `frontend → shared` and `backend → shared`. `shared`
MUST NOT import from `frontend` or `backend`, and `frontend` and `backend` MUST NOT import from
each other.

---

## The `shared` package

**MONO-4 — Put code in `shared` when frontend and backend both need the same
definition:**

- pure domain logic (rules, state machines, calculations)
- domain types (`UserID`, `TaskUpdate`, `Nullable`)
- constants and enums (`ProjectStatus`, limits)
- validation patterns used by both forms and DTOs (`usernamePattern`)
- the WebSocket event contract ([websockets.md](websockets.md))
- the logger (`sharedLog`) and small utilities (`safeParseJSON`, `deeplyMerge`, `isUUID`)
- test matchers, fixtures, and state generators (in the testing entry point; see MONO-7)

**MONO-5 — `shared` stays framework-free and environment-agnostic.** Its runtime code uses
no React, Nest, Mongoose, DOM-only APIs, or Node-only APIs
([nodejs.md](nodejs.md) NODE-7). Its runtime `dependencies` list only what that code
imports.

**MONO-6 — `shared/src/index.ts` is the package's only runtime entry point.** Every export
that consumers rely on goes through it. Re-export type-only modules with
`export type * from './types'`.

**MONO-7 — Export test-only code from a separate `@app/shared/testing` entry point**
(declared in the `exports` map), so production bundles never include matchers, fixtures,
or generators.

**MONO-8 — Build `shared` with tsup to both ESM (`dist/esm`) and CommonJS
(`dist/commonjs`), with type declarations**, and describe both in the `exports` map in
its `package.json`. After changing `shared`, rebuild it (`pnpm shared:base build`) before
running or testing a workspace that depends on it. Dockerfiles build `shared` first.

**MONO-9 — Do not duplicate a definition that already exists in `shared`.** If a workspace
needs a variant, extend the shared type locally
(`type MockUser = Omit<User, 'password'> & { ... }`).

**MONO-10 — Keep framework versions aligned across workspaces.** Any package used by more
than one workspace (`react`, `typescript`, test runners) MUST resolve to the same major
everywhere. Use a pnpm `catalog` in `pnpm-workspace.yaml` to pin shared versions in one
place.

---

## Root scripts

**MONO-11 — The root `package.json` exposes per-workspace scripts with a consistent
prefix:**

| Script       | Purpose                                                                |
| ------------ | ---------------------------------------------------------------------- |
| `<pkg>:base` | `pnpm --filter @app/<pkg>`: runs any script in that workspace          |
| `<pkg>:test` | runs that workspace's tests                                            |
| `all:<task>` | runs a task in every workspace in dependency order (`pnpm -r run <task>`) |
| `dcr`        | `docker compose run --rm --remove-orphans`                             |
| `backend:ncs` | runs a nest-commander script in the backend container                 |

Add a root alias for a workspace script that is run often; otherwise use
`pnpm <pkg>:base <script>`.

- `pnpm -r` runs workspaces in dependency order, so `shared` builds first.
- Long-running watchers (`all:start:dev`) need `pnpm -r --parallel run start:dev`, since
  each watcher never exits.
- To run a task for one workspace plus the workspaces it depends on, use
  `pnpm --filter "@app/backend..." build`.

**MONO-12 — Every workspace defines `build`, `test`, and `typecheck` scripts**, and
runnable apps also define `start:dev`. Workspaces whose tests run on the CI runner also
define `test:cov` ([ci-pipeline.md](ci-pipeline.md) CI-2). Formatting and linting are root-only scripts (`format`,
`format:check`, `lint`, `lint:fix`) that cover every workspace
([formatting-and-linting.md](formatting-and-linting.md) FMT-11); workspaces do not define
their own. A script that needs an environment file loads it from the root rather than
keeping a separate copy.
