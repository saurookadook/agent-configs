# moon Caching and CI Standards

Applies to how CI runs moon (`moon ci` in GitHub Actions), the remote cache, run reports,
and how to debug a cache miss or a skipped task. Workflow layout, triggers, permissions,
and action pinning stay in [github-actions.md](../github-actions.md); what CI checks
outside moon (images, workflow lint, dependency review) stays in
[ci-pipeline.md](../ci-pipeline.md).

**Source of truth:** `.github/workflows/ci.yml`, the `remote` block of
`.moon/workspace.yml`, and the repository secrets that configure the remote cache.

---

## How CI runs moon

**MCI-1 — Runner-side checks run through `moon ci`, and moon decides what is affected.**
`moon ci` is `moon exec` with `--affected --ci --on-failure=continue --summary=detailed
--upstream=deep --downstream=direct`, filtered by each task's `runInCI` (MTASK-12).

This replaces, for moon-managed tasks, the `dorny/paths-filter` `changes` job and its
area filters ([github-actions.md](../github-actions.md) GHA-6) and the per-area
`shared-test.yml` and `frontend-test.yml` jobs and the backend `typecheck` job
([ci-pipeline.md](../ci-pipeline.md) CI-1, CI-7, CI-9, CI-11), because a hand-kept filter
list duplicates the project graph and drifts from it. It also replaces the
`node-setup` composite action (CI-5) in moon jobs, since proto installs Node and pnpm
from `.prototools` (MWS-3). Everything else in those documents still applies: the
`ci-success` aggregator (GHA-7) MUST list every moon job in `needs`; jobs that test in
Compose (CI-9's backend `test`), build images (CI-13), or lint the repository (CI-12)
stay as they are until they are moon tasks.

**MCI-2 — A moon CI job follows this shape:**

```yaml
# ci.yml, under jobs:
moon:
  runs-on: ubuntu-24.04
  timeout-minutes: 20
  permissions:
    contents: read
  strategy:
    matrix:
      index: [0, 1]
  env:
    MOON_REMOTE_HOST: ${{ secrets.MOON_REMOTE_HOST }}
  steps:
    - name: "Check out"
      uses: actions/checkout@<sha> # v6.x.y
      with:
        fetch-depth: 0
        filter: "blob:none"
        persist-credentials: false

    - name: "Set up proto and moon"
      uses: moonrepo/setup-toolchain@<sha> # v0.x.y
      with:
        auto-install: true
        cache-base: "main"
        moon-version: "2.6.2" # placeholder: the pinned version (MWS-2)

    - name: "🖊️ Run affected tasks"
      id: moon
      run: moon ci --job "${{ matrix.index }}" --job-total 2

    - name: "📊 Upload run report"
      if: ${{ !cancelled() && steps.moon.outcome != 'skipped' }}
      uses: actions/upload-artifact@<sha> # vX.Y.Z
      with:
        name: "moon-ci-report-${{ matrix.index }}"
        path: ".moon/cache/ciReport.json"

# Posts the PR comment (MCI-7). Not in ci-success's needs.
moon-report:
  needs: moon
  if: >-
    ${{ !cancelled() && needs.moon.result != 'skipped'
    && github.event_name == 'pull_request'
    && github.event.pull_request.head.repo.full_name == github.repository }}
  runs-on: ubuntu-24.04
  timeout-minutes: 5
  permissions:
    pull-requests: write # run-report-action's comment; not documented, verify (MCI-7)
  strategy:
    matrix:
      index: [0, 1] # same matrix as `moon`, so each shard keeps its own comment
  steps:
    - name: "📥 Download run report"
      uses: actions/download-artifact@<sha> # vX.Y.Z
      with:
        name: "moon-ci-report-${{ matrix.index }}"
        path: ".moon/cache"

    - name: "📊 Report moon results"
      uses: moonrepo/run-report-action@<sha> # v1.x.y
      with:
        access-token: ${{ secrets.GITHUB_TOKEN }}
        matrix: ${{ toJSON(matrix) }}
```

Runner, timeout, step names, and shell defaults follow GHA-11, GHA-14, and GHA-16.

**MCI-3 — Check out with full history: `fetch-depth: 0` and `filter: "blob:none"`.** A
shallow clone breaks merge-base detection, and moon then cannot tell what is affected.
The rest of GHA-13 (default `ref`, `persist-credentials: false`) still applies.

**MCI-4 — Install proto and moon with `moonrepo/setup-toolchain`**, with `auto-install: true`
(installs the `.prototools` tools), `cache-base: "main"` (other refs restore the
default branch's `~/.proto` cache), and `moon-version` set to the pinned version. Its
README still keys the cache on the v1 `.moon/toolchain.yml`, so bump its `cache-version`
input whenever `.moon/toolchains.yml` changes _(judgement call)_. Python workspaces also
set `auto-setup: true` (MLANG-11).

**MCI-5 — Pin `moonrepo/setup-toolchain` and `moonrepo/run-report-action` by full commit
SHA** (GHA-24). They are not on GHA-24's list of allowed community actions, so the PR
that adopts moon adds them to that list and to the allowed-actions setting (GHA-26).
Repositories without moon leave GHA-24's list as it is.

**MCI-6 — Leave base and head to moon's CI detection on pull requests.** moon reads them
from the CI environment and falls back to `vcs.defaultBranch` (MWS-7). Set
`MOON_BASE`/`MOON_HEAD` (highest precedence) only to fix a detection you have seen fail.

**MCI-7 — Keep every moon run's report, and comment it on pull requests from a separate
job.** The `moon` job uploads `.moon/cache/ciReport.json` as an artifact, because later
runs overwrite it; the docs' `if: success() || failure()` becomes GHA-18's
`!cancelled()` form, which behaves the same. A `moon-report` job then downloads the
artifact and runs `run-report-action` with `matrix: ${{ toJSON(matrix) }}`, so shards do
not overwrite each other's comment:

- It runs only on `pull_request`, because the action reports to a PR and push runs
  (MCI-8) write `runReport.json`, not the `ciReport.json` it reads.
- It skips fork PRs, whose token cannot comment.
- It checks out nothing and runs no PR code, so it is the only job holding
  `pull-requests: write` (GHA-9). The action does not document its `permissions`; verify
  that scope on the PR that adopts moon, and remove anything it turns out not to need.
- It is deliberately left out of `ci-success`'s `needs`, an exception to GHA-7 like
  `publish`. It reports results and is not a check, so a failed comment never blocks a
  merge. The `moon` job, which is in `needs`, still decides pass or fail.

**MCI-8 — Pushes to `main` and manual runs run every CI task, not only affected ones**
_(judgement call)_. GHA-5 requires a full result for every commit on `main`, and the
docs do not cover base detection for `push` events. Run
`moon run :build :format :lint :test :typecheck` on those events; the remote cache
(MCI-11) turns unchanged tasks into cache hits. `moon run` writes
`.moon/cache/runReport.json` rather than `ciReport.json`, so upload that file on these
events.

**MCI-9 — Shard a slow moon job with a matrix and `--job`/`--job-total`** (0-based), and
MAY split by target across jobs (`moon ci :build` in one, `moon ci :lint :test` in
another). Targets still run only if affected. Shard before adding checks when the job
breaks CI-3's ten-minute budget.

**MCI-10 — Do not rely on `--affected` alone to include dependents.** v2 removed graph
relations from `--affected`. `moon ci` adds `--upstream=deep --downstream=direct`; a local
`moon run --affected` needs `-g/--include-relations` (or `--downstream`) to check what a
change breaks downstream.

---

## Remote cache

**MCI-11 — Share task outputs through a remote cache, never by saving `.moon/cache` with
`actions/cache`.** The CI guide recommends remote caching, most of `.moon/cache` is not
portable, and its manual-cache paths are out of date since v2.6 moved hash manifests.
Plain `moon ci` without a remote cache is an acceptable starting point.

**MCI-12 — The remote cache speaks the Bazel Remote Execution v2 API**: self-hosted
`bazel-remote`, or Depot or Namespace (moonrepo's hosted moonbase is gone). Configure it
in `.moon/workspace.yml` and turn it on per environment with `MOON_REMOTE_HOST`, so local
runs stay local unless a developer opts in:

```yaml
# .moon/workspace.yml (remote cache portion)
remote:
  host: 'grpcs://cache.depot.dev'
  auth:
    token: 'DEPOT_TOKEN' # name of the env var holding the token, not the token
    headers:
      'X-Depot-Org': '<org-id>'
```

- Secrets (tokens, hosts that embed credentials) come from repository secrets through
  `env:` (GHA-17), never from the committed file.
- A self-hosted cache SHOULD NOT depend on moon's custom `tls`/`mtls` client settings,
  which the docs call "very unstable".
- `api: 'http'` retries failed requests (`remote.cache.retryCount`, default 3); gRPC does
  not. Prefer HTTP if the cache is flaky.
- moon stores outputs and logs, never source, and applies no encryption; the provider's
  storage must be acceptable for build outputs.

**MCI-13 — Only trusted runs write to the remote cache; pull request runs read at most**
(GHA-25). A cache entry is keyed by the task's hash, not by what the job actually ran, so
a PR job holding a write credential can upload a doctored output under a hash that `main`
later computes and restores. That is cache poisoning: PR code reaching `main`'s builds
without review. moon has no client-side read-only mode (the remote-cache guide documents
none), and any setting in the job is under the PR's control anyway, so the cache server
enforces it:

- Keep the write credential in a GitHub environment (for example `moon-cache-write`) whose
  deployment branches are limited to `main` and `v*` tags. Only the `push` and
  `workflow_dispatch` jobs of MCI-8 name that environment, so PR jobs cannot read its
  secret.
- PR jobs (MCI-2) get a credential the server accepts for reads only, such as a
  provider's read-only token or `bazel-remote` with `--allow_unauthenticated_reads` and
  write credentials required. If the cache cannot give a read-only credential, leave
  `MOON_REMOTE_HOST` unset on `pull_request` and run PRs without the remote cache.
- Fork PRs receive no secrets, so they read only from a cache that allows unauthenticated
  reads, or run without one.

---

## Debugging the hash

**MCI-14 — When a task misses the cache or runs unexpectedly, debug in this order** (the
docs' debug-task guide):

1. Read the resolved task: `moon task <target> --json`, and
   `.moon/cache/states/<project>/snapshot.json`. Check that tokens resolved, inputs
   expanded (`inputFiles`, `inputGlobs`, `inputVars`), and `inherited.layers` is what
   you expect.
2. Rerun with full tracing:
   `MOON_DEBUG_PROCESS_ENV=true MOON_DEBUG_PROCESS_INPUT=true moon run <target> --log trace --force`.
3. Inspect the hash with `moon hash <hash>`, or diff two runs with `moon hash <a> <b>`.

`--log debug` covers most diagnostics. `MOON_DEBUG_REMOTE` shows remote-cache connection
errors. With the daemon on (v2.5+), archive and hydration failures are in the
`.moon/cache/daemon/` logs, not the CLI output.

**MCI-15 — When a task is skipped in CI, check, in order** _(judgement call)_: its
`runInCI` (MTASK-12), base and head detection (fetch depth, MCI-3; `MOON_BASE`, MCI-6),
and v2's removal of graph relations from `--affected` (MCI-10). `moon query affected`,
`moon query changed-files`, and `moon action-graph` show what moon decided.

**MCI-16 — Compare a local and a CI hash with `--output-style hash`** (v2.6) when the same
task misses the remote cache in one place and hits it in the other. Audit hash inputs
whenever a task's inputs change, as the cache concept page recommends.
