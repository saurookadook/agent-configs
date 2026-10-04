# CI Pipeline Standards

Applies to what CI checks and publishes: the `ci.yml` entry workflow, the shared setup
action, the reusable workflow for each area, and how results are reported. How workflows
are laid out, triggered, and secured lives in [github-actions.md](github-actions.md).
Image scanning and publishing rules live in
[docker-and-environment.md](docker-and-environment.md) (ENV-24 to ENV-30).

**Source of truth:** `.github/workflows/ci.yml`, the reusable workflows it calls,
`.github/actions/node-setup/action.yml`, and the root `package.json` scripts.

**Database.** The backend is moving from MongoDB to PostgreSQL. Backend examples here use
a `postgres` Compose service. [docker-and-environment.md](docker-and-environment.md) and
[testing.md](testing.md) still describe MongoDB until they are updated.

---

## What runs

**CI-1 — CI runs these jobs:**

| `ci.yml` job | Runs on                                       | Reusable workflow   | Does                                                          |
| ------------ | --------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| `changes`    | PRs                                           | —                   | detects which areas the PR touches (GHA-6)                    |
| `repo`       | every run                                     | `repo-lint.yml`     | format check, lint, workflow lint and audit, dependency review |
| `shared`     | PRs touching `shared`; every push             | `shared-test.yml`   | build, typecheck, tests with coverage                         |
| `frontend`   | PRs touching `frontend`; every push           | `frontend-test.yml` | typecheck, tests with coverage, coverage report               |
| `backend`    | PRs touching `backend`; every push            | `backend-test.yml`  | typecheck on the runner; tests in Compose against PostgreSQL  |
| `docker`     | PRs touching images                           | `docker-build.yml`  | builds and scans production images without pushing            |
| `ci-success` | every run                                     | —                   | the only required check (GHA-7)                               |
| `publish`    | pushes to `main` and `v*` tags, after success | `docker-build.yml`  | builds, pushes, and attests production images (CI-13)        |

Outside `ci.yml`, `scan.yml` scans the published images weekly (ENV-26), and CodeQL
default setup scans JavaScript, TypeScript, and workflow files on every PR (GHA-26).

**CI-2 — CI runs the scripts developers run** (ENV-29). Each check is one root script
call, so a red check reproduces locally with the same command. If CI needs a new command,
add it as a script first. Every workspace defines a `typecheck` script that type-checks
without emitting. Every workspace whose tests run on the runner (`frontend`, `shared`)
also defines `test:cov`. The backend `test` job is the one exception (CI-9): it runs the
root `backend:test` script's Compose commands one at a time, so each phase gets its own
log section.

**CI-3 — Checks run cheapest first, and a PR gets its result within ten minutes.**
Within a job, the order is setup, 🏗️ build, 🔎 typecheck, 🖊️ tests, then 📊 reports, and
the job stops at the first failure. The slowest area job on a PR SHOULD finish within ten
minutes, the feedback budget recommended by Martin Fowler and DORA _(non-GitHub)_. When it
doesn't, make it faster (caching, splitting jobs) before adding checks.

---

## The entry workflow

**CI-4 — `ci.yml` follows this shape.** Area filters follow GHA-6, and every CI job
appears in `ci-success`'s `needs` (GHA-7):

```yaml
name: "CI"

on:
  pull_request:
  push:
    branches: ["main"]
    tags: ["v*.*.*"]
  workflow_dispatch:

permissions: {}

concurrency:
  group: ci-${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

defaults:
  run:
    shell: bash

jobs:
  changes:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      pull-requests: read # list the PR's changed files
    outputs:
      shared: ${{ steps.filter.outputs.shared }}
      frontend: ${{ steps.filter.outputs.frontend }}
      backend: ${{ steps.filter.outputs.backend }}
      docker: ${{ steps.filter.outputs.docker }}
    steps:
      - name: "Detect changed areas"
        id: filter
        uses: dorny/paths-filter@<sha> # v4.x.y
        with:
          filters: |
            shared:
              - ".github/actions/node-setup/**"
              - ".github/workflows/shared-*.yml"
              - ".nvmrc"
              - "package.json"
              - "pnpm-lock.yaml"
              - "pnpm-workspace.yaml"
              - "shared/**"
              - "tsconfig.json"
            frontend:
              - ".github/actions/node-setup/**"
              - ".github/workflows/frontend-*.yml"
              - ".nvmrc"
              - "frontend/**"
              - "package.json"
              - "pnpm-lock.yaml"
              - "pnpm-workspace.yaml"
              - "shared/**"
              - "tsconfig.json"
            backend:
              - ".dockerignore"
              - ".env.example"
              - ".env.test.example"
              - ".github/actions/node-setup/**"
              - ".github/workflows/backend-*.yml"
              - ".nvmrc"
              - "backend/**"
              - "compose.yaml"
              - "package.json"
              - "pnpm-lock.yaml"
              - "pnpm-workspace.yaml"
              - "shared/**"
              - "tsconfig.json"
            docker:
              - ".dockerignore"
              - ".github/workflows/docker-*.yml"
              - "backend/**"
              - "docker-bake.hcl"
              - "frontend/**"
              - "package.json"
              - "pnpm-lock.yaml"
              - "pnpm-workspace.yaml"
              - "shared/**"

  repo:
    permissions:
      contents: read
    uses: ./.github/workflows/repo-lint.yml

  shared:
    needs: changes
    if: ${{ !cancelled() && (github.event_name != 'pull_request' || needs.changes.outputs.shared == 'true') }}
    permissions:
      contents: read
    uses: ./.github/workflows/shared-test.yml

  frontend:
    needs: changes
    if: ${{ !cancelled() && (github.event_name != 'pull_request' || needs.changes.outputs.frontend == 'true') }}
    permissions:
      contents: read
      pull-requests: write # coverage comment (CI-8)
    uses: ./.github/workflows/frontend-test.yml

  backend:
    needs: changes
    if: ${{ !cancelled() && (github.event_name != 'pull_request' || needs.changes.outputs.backend == 'true') }}
    permissions:
      contents: read
    uses: ./.github/workflows/backend-test.yml

  docker:
    needs: changes
    # Pushes build images in `publish` instead.
    if: ${{ !cancelled() && github.event_name == 'pull_request' && needs.changes.outputs.docker == 'true' }}
    permissions:
      contents: read
    uses: ./.github/workflows/docker-build.yml
    with:
      push: false

  ci-success:
    needs: [changes, repo, shared, frontend, backend, docker]
    # Must report even when a needed job fails or the run is cancelled (GHA-7).
    if: always()
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - name: "Check job results"
        env:
          RESULTS: ${{ join(needs.*.result, ' ') }}
        run: |
          for result in $RESULTS; do
            if [[ "$result" != "success" && "$result" != "skipped" ]]; then
              echo "::error::A CI job finished with result '$result'"
              exit 1
            fi
          done

  publish:
    needs: ci-success
    if: github.event_name == 'push'
    concurrency:
      group: publish
      cancel-in-progress: false
    permissions:
      contents: read
      packages: write # push images to GHCR
      attestations: write # store build provenance
      id-token: write # sign build provenance
    uses: ./.github/workflows/docker-build.yml
    with:
      push: true
```

---

## Setup

**CI-5 — Every job that needs Node uses the `node-setup` composite action**, and no job
installs Node or pnpm any other way. The action:

1. Installs pnpm with `pnpm/action-setup` and no `version` input, so it reads the
   `packageManager` field of the root `package.json` ([nodejs.md](nodejs.md) NODE-2).
2. Sets up Node with `actions/setup-node` from the root `.nvmrc` (NODE-1), with an
   explicit `cache: pnpm` keyed on `pnpm-lock.yaml`. setup-node's automatic caching from
   `packageManager` covers only npm, and pnpm has to be installed before setup-node runs,
   because the cache step calls it to find its store.
3. Installs every workspace once, from the root, with `pnpm install --frozen-lockfile`.
   pnpm already freezes the lockfile in CI; the flag states the intent. Install scripts
   are limited to `onlyBuiltDependencies` (NODE-3). If installs prove flaky, wrap this
   step in the bounded, verified retry of GHA-22; do not add the retry preemptively.

```yaml
name: "Node.js setup"
description: "Install pnpm and Node.js, then install workspace dependencies"

runs:
  using: "composite"
  steps:
    - name: "Install pnpm"
      uses: pnpm/action-setup@<sha> # vX.Y.Z (version comes from packageManager)

    - name: "Set up Node.js"
      uses: actions/setup-node@<sha> # vX.Y.Z
      with:
        node-version-file: ".nvmrc"
        cache: "pnpm"
        cache-dependency-path: "pnpm-lock.yaml"

    - name: "Install dependencies"
      shell: bash
      run: pnpm install --frozen-lockfile
```

pnpm's documentation now recommends its own `pnpm/setup` action _(non-GitHub)_, which
installs pnpm and Node and runs the install in one step. It is not used here because it
takes the Node version as an input, which would be a second copy of `.nvmrc`. Re-evaluate
it if that changes.

**CI-6 — A job that imports `shared` builds it in its own `🏗️ Build shared` step**
(`pnpm shared:base build`), right after setup. Typecheck, tests, and type-aware lint all
import its built output ([monorepo.md](monorepo.md) MONO-8). Building it inside the
composite action would fold a possible failure into the single "Node.js setup" log entry
(GHA-20).

---

## Frontend

**CI-7 — `frontend-test.yml` runs one `test` job:**

```yaml
name: "Frontend Test"

on:
  workflow_call:

defaults:
  run:
    shell: bash

jobs:
  test:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - name: "Check out code"
        uses: actions/checkout@<sha> # vX.Y.Z
        with:
          persist-credentials: false

      - name: "Set up Node.js and dependencies"
        uses: ./.github/actions/node-setup

      - name: "🏗️ Build shared"
        run: pnpm shared:base build

      - name: "🔎 Typecheck"
        run: pnpm frontend:base typecheck

      - name: "🖊️ Run tests"
        id: tests
        run: pnpm frontend:base test:cov

      - name: "📊 Report coverage"
        # Report whether the tests passed or failed, but not if they never ran (GHA-18).
        if: ${{ !cancelled() && steps.tests.outcome != 'skipped' }}
        uses: davelosert/vitest-coverage-report-action@<sha> # v2.x.y
        with:
          working-directory: ./frontend
          # Comment only where the token can write: same-repo PRs not opened by Dependabot.
          comment-on: ${{ (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.actor != 'dependabot[bot]') && 'pr' || 'none' }}
```

If the frontend has more than one `tsconfig`, its `typecheck` script checks all of them,
and CI still calls it once.

**CI-8 — Frontend coverage is reported with `davelosert/vitest-coverage-report-action`**
_(non-GitHub)_. The Vitest config MUST set `coverage.reporter` to include `json-summary`
and `json`, and `coverage.reportOnFailure: true`, so a report exists even when tests fail.
On same-repo PRs, the action comments on the PR, which is why the `frontend` job grants
`pull-requests: write` (GHA-9). Fork PRs and Dependabot PRs get a read-only token, so
`comment-on` is `none` there, and the report goes to the job summary instead. Coverage is
a signal, not a target: thresholds, if any, live in the Vitest config, not the workflow.

---

## Backend

**CI-9 — `backend-test.yml` runs two jobs in parallel:** `typecheck` on the runner and
`test` in Compose.

- `typecheck`: checkout, `node-setup`, 🏗️ build shared, then
  🔎 `pnpm backend:base typecheck`.
- `test`: needs only Docker (GHA-19). It runs the root `backend:test` script's Compose
  commands one at a time, against the isolated `app-test` project
  ([docker-and-environment.md](docker-and-environment.md) ENV-4). These commands MUST
  match that script; change both in the same PR.

```yaml
jobs:
  # typecheck: checkout, node-setup, 🏗️ Build shared, 🔎 Typecheck (as in CI-7)

  test:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - name: "Check out code"
        uses: actions/checkout@<sha> # vX.Y.Z
        with:
          persist-credentials: false

      - name: "Create env files from templates"
        run: |
          cp .env.example .env
          cp .env.test.example .env.test

      - name: "🐳 Build images"
        run: docker compose -p app-test --env-file .env.test build backend-test

      - name: "🐘 Start database"
        run: docker compose -p app-test --env-file .env.test up -d --wait postgres

      - name: "🖊️ Run tests"
        run: docker compose -p app-test --env-file .env.test run --rm backend-test
```

The runner is discarded after the job, so there is no teardown step (GHA-18). GitHub's own
pattern for databases in CI is a `services:` container. Compose is a deliberate departure,
so CI tests against the same database setup developers run (CI-2, ENV-29).

**CI-10 — The test job waits for PostgreSQL through its Compose healthcheck**
(`up --wait`, ENV-11), not a polling loop like `aoam-property-plan`'s `pg_isready` loop.
The `postgres` service's healthcheck runs `pg_isready` inside the container:

```yaml
postgres:
  healthcheck:
    test: [CMD-SHELL, 'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"']
    interval: 2s
    timeout: 5s
    retries: 15
```

If the stack needs generated local files (database secrets, certificates), the job runs
the same setup script developers run, before it builds.

---

## Shared

**CI-11 — `shared-test.yml` runs one `test` job:** checkout, `node-setup`,
🏗️ `pnpm shared:base build` (a check in its own right here), 🔎
`pnpm shared:base typecheck`, and 🖊️ `pnpm shared:base test:cov`. Jest coverage stays in
the log; the Vitest report action (CI-8) does not apply to it.

---

## Repository-wide

**CI-12 — `repo-lint.yml` runs three jobs in parallel:**

- `lint`: checkout, `node-setup`, 🏗️ build shared (the type-aware linter resolves
  `@app/shared` through its built types), 🧹 `pnpm format:check`, and
  🧹 `pnpm lint --deny-warnings` ([formatting-and-linting.md](formatting-and-linting.md)
  FMT-11).
- `workflows`: checkout, then 🧹 actionlint and 🧹 zizmor. actionlint runs from the image
  pinned in `.github/tools/actionlint/Dockerfile`, so Dependabot's `docker` updates keep
  it current (ENV-24). zizmor runs through `zizmorcore/zizmor-action` with
  `advanced-security: false`, so findings fail the job instead of going to code scanning.
  That keeps fork PRs, which cannot upload results, working the same way. Pin zizmor's
  `version` input; it defaults to `latest`.
- `dependencies` (PRs only): 🧹 `actions/dependency-review-action` with
  `fail-on-severity: high`, which fails a PR that adds a dependency with a known
  vulnerability. It is free for public repositories.

```yaml
jobs:
  # lint and dependencies: see the list above

  workflows:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - name: "Check out code"
        uses: actions/checkout@<sha> # vX.Y.Z
        with:
          persist-credentials: false

      - name: "🧹 Lint workflows"
        run: |
          docker build --quiet --tag actionlint .github/tools/actionlint
          docker run --rm --volume "$PWD:/repo" --workdir /repo actionlint -color

      - name: "🧹 Audit workflows"
        uses: zizmorcore/zizmor-action@<sha> # vX.Y.Z
        with:
          advanced-security: false
          version: "<zizmor version>"
```

---

## Images

**CI-13 — `docker-build.yml` builds each production image, and pushes and attests only
when `push` is `true`.** It takes a boolean `push` input and runs one job per image with
a matrix (`image: [backend, frontend]`):

1. checkout, then Buildx through `docker/setup-buildx-action`
2. when pushing: log in to GHCR with `docker/login-action`, `GITHUB_TOKEN`, and
   `${{ github.actor }}`
3. `docker/metadata-action` for tags and OCI labels (ENV-30)
4. 🐳 `docker/build-push-action`: root context, the image's Dockerfile, target
   `<image>-prod`, and `type=gha` cache scoped to the image. Only pushing runs write the
   cache (ENV-28). PR builds `load` the image for the next step.
5. on PRs: 🧹 scan the loaded image (ENV-26)
6. when pushing: 📦 attest the pushed digest with `actions/attest`
   (`subject-name`, `subject-digest`, `push-to-registry: true`)

`publish` grants the extra permissions this needs (GHA-9). If the images move to
`docker-bake.hcl` (ENV-28), `docker/bake-action` replaces step 4.

---

## Failures and changes

**CI-14 — A red check blocks the merge.** The `main` ruleset requires `ci-success`
(GHA-26), and `ci-success` fails when any CI job fails (GHA-7). Fix the failure or revert
the change that caused it. A flaky test is fixed, or skipped with a `// TODO:` that says
why ([testing.md](testing.md) TEST-7), in its own PR. Never get a check to pass by
weakening the workflow.

**CI-15 — Adding a workspace or area** means doing all of these in one PR:

- a reusable workflow for it (GHA-1)
- a filter in the `changes` job, with its path added to the filter of every area that
  depends on it (GHA-6)
- a calling job in `ci.yml`, added to `ci-success`'s `needs` (GHA-7)
- a row in the CI-1 table
- a `typecheck` script, plus `test:cov` if its tests run on the runner (CI-2)
