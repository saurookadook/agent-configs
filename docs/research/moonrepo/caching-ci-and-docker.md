# moonrepo (moon): Caching, CI, Affected Detection, Docker, and Operational Workflows

Research date: 2026-10-18. Primary source: moonrepo.dev/docs, which now documents **moon v2** (v1 docs are frozen on a separate site). Unless marked, "docs" means the official v2 docs. Page content was retrieved via a summarizing fetch tool, so quoted snippets are faithful to what the pages returned but should be spot-checked before being copied verbatim into standards.

## What is the current major version of moon (v1 vs v2), and what changed for caching/CI/docker/codegen/hooks?

### Takeaway
moon **v2** is current. v2.0 ("Phobos") shipped in early 2026, and the latest release is **v2.6.2 (14 Oct 2026)**. v2 renamed or removed many CLI flags and config keys in this area: `--update-cache`→`--force`, `--remote`→`--affected remote`, `unstable_remote`→`remote`, `moon query hash*`→`moon hash`, new `moon exec`, hooks moved to `.moon/hooks` + `core.hooksPath`, `moon generate <id> --to <dest>`, and Docker skeleton/config key renames. Treat any v1-era blog or community snippet as suspect.

### Cited Findings
- The docs state they cover moon v2 and the latest proto. moon v1 docs are frozen and linked separately — [CI guide](https://moonrepo.dev/docs/guides/ci); [Cache concept](https://moonrepo.dev/docs/concepts/cache)
- v2.0 announcement post, codename "Phobos". The blog archive dates it Feb 18, 2026 (this date comes from a search-result summary). `moon upgrade` does not work from v1 because the distribution format changed, so install via proto or the shell scripts. New commands include `moon exec`, `moon hash`, `moon projects`, `moon tasks`, `moon query affected`, and `moon template` — [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0); alpha and beta posts at [v2 alpha](https://moonrepo.dev/blog/moon-v2-alpha) and [v2 beta](https://moonrepo.dev/blog/moon-v2-beta)
- Latest release is v2.6.2 (14 Oct 2026). Before it: 2.6.1 (7 Oct), 2.6.0 (5 Oct), 2.5.x (Aug–Sep 2026) — [GitHub releases](https://github.com/moonrepo/moon/releases)
- Breaking changes from the v2 migration guide, limited to this scope — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0):
  - `--update-cache, -u` → `--force, -f` on `moon run`, `moon ci`, and `moon check`.
  - `--remote` removed; use `--affected remote`. `--no-bail` removed; use `moon exec` (`--on-failure`). `--profile` removed.
  - `--dependents` now requires a value (`deep` or `direct`). `--platform` → `--toolchain`. All flags are kebab-case (`--logLevel` → `--log-level`).
  - **Affected calculation no longer includes graph relations by default.** Use `--include-relations` / `-g` to restore v1 behavior.
  - `moon run build` → `moon run ~:build` for the closest project. Unscoped targets now resolve to the default project. `moon check` needs `--closest`.
  - `moon query hash` and `moon query hash-diff` removed; use `moon hash`. `moon query touched-files` → `moon query changed-files`. `moon query projects --dependents` removed. `moon action-graph --json` has a new structure.
  - MQL fields renamed: `projectName`→`projectId`, `projectType`→`projectLayer`, `taskPlatform`→`taskToolchain`.
  - Remote cache: `unstable_remote` → `remote`.
  - Docker: `.moon/docker/workspace` → `.moon/docker/configs`. `docker.scaffold.include` → `docker.scaffold.configsPhaseGlobs` (workspace) / `docker.scaffold.sourcesPhaseGlobs` (project). `docker.prune.installToolchainDeps` → `docker.prune.installToolchainDependencies`. `docker.scaffold.copyToolchainFiles` removed. `moon docker file` uses the first toolchain image found, else `scratch`; set `docker.file.image` to be explicit.
  - Codegen: `moon generate <id> ./dist` → `moon generate <id> --to ./dist`.
  - VCS hooks are no longer written to `.git/hooks`. They go to `.moon/hooks`, with Git's `core.hooksPath` pointed there. Bash hook scripts no longer end in `.sh`. `vcs.manager`→`vcs.client`, `vcs.syncHooks`→`vcs.sync`. Old scripts in `.git/hooks` may need manual removal.
  - Sync: `codeowners.syncOnRun`→`codeowners.sync`. `node.syncPackageManagerField`→`javascript.syncPackageManagerField`.
  - Config file rename: `.moon/toolchain.yml` → `.moon/toolchains.yml` (from release-note summary) — [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
- New `moon exec` (v2.0.0) is the low-level action-pipeline command. `moon check`, `moon ci`, and `moon run` are built on top of it — [moon exec](https://moonrepo.dev/docs/commands/exec)
- v2.x cache-related changes:
  - v2.3: experimental CAS layer replaces the tarball local cache (`experiments.casOutputsCache`).
  - v2.5: with the daemon, archiving and hydration run in the background, and failures go to daemon logs. `cache.unstable_sharedWorktreeCache` shares `blobs/` and `manifests/` across worktrees.
  - v2.6: hash manifests are stored under `.moon/cache/blobs`, replacing `.moon/cache/hashes/<hash>.json`.
  - Source: [Cache concept](https://moonrepo.dev/docs/concepts/cache); [Debug task guide](https://moonrepo.dev/docs/guides/debug-task)
- v2.6.0 release notes: "local cache is always enabled". HTTP remote gets retries (`remote.cache.retryCount`, default 3) and is disabled when the host is unreachable. A new `--output-style` flag applies to `ci`/`run`/`check`/`exec`. 2.5.6: glob outputs are no longer deleted and restored on every cached run, and a dependency's hash no longer changes when outputs hydrate from CAS. 2.6.2: SIGINT/SIGTERM exit with 130/143 — [GitHub releases](https://github.com/moonrepo/moon/releases)
- moonbase (moonrepo's hosted remote cache) was **sunset**. moon adopted the Bazel Remote Execution API instead (v1.30) — [moonbase sunset blog](https://moonrepo.dev/blog/moonbase-sunset); [moon v1.30 blog](https://moonrepo.dev/blog/moon-v1.30)

### Inferences
- Any guidance mentioning `moonbase`, `unstable_remote`, `--remote`, `-u/--update-cache`, `moon query hash-diff`, `.git/hooks`, `.moon/cache/hashes`, or `.moon/docker/workspace` is v1-era and should be rewritten for v2.
- Because v2 no longer includes graph relations in affected checks by default, CI pipelines ported from v1 may run *fewer* tasks than before. `moon ci` itself pre-fills `--upstream=deep --downstream=direct` (see next section), which partly compensates.

### Gaps
- The exact v2.0.0 GA date was not confirmed from the post body (only from a search summary).
- The migration guide content retrieved did not cover changes to `--status`, `--job`, or `template.yml`.

## What does the doc recommend for a GitHub Actions pipeline using moon (fetch-depth, base ref, caching, sharding, reports)?

### Takeaway
Check out with full history (`fetch-depth: 0`, optionally `filter: 'blob:none'`), install with `moonrepo/setup-toolchain@v0` (it caches `~/.proto`), run `moon ci` (affected-only, `runInCI`-filtered), shard with a matrix plus `--job`/`--job-total`, and post results with `moonrepo/run-report-action@v1` under `if: success() || failure()`. For task artifacts, use **remote caching** rather than persisting `.moon/cache` with `actions/cache`.

### Cited Findings
**How `moon ci` works and what it pre-fills**
- `moon ci` steps: find changed files (HEAD vs base) → select affected targets plus their deps and dependents → build the action graph → install toolchain and deps → run actions in a thread pool → report pass/fail/invalid stats — [CI guide](https://moonrepo.dev/docs/guides/ci)
- `moon ci` inherits most options from `moon exec` and pre-fills `--affected --ci --on-failure=continue --summary=detailed --upstream=deep --downstream=direct`. Positional targets are still filtered by `runInCI` — [moon ci command](https://moonrepo.dev/docs/commands/ci)

**Base/head detection**
- Base and head are auto-detected from CI provider env (via the `ci_env` crate). Fallbacks are `vcs.defaultBranch` and `HEAD`. Override with `--base`/`--head` or `MOON_BASE`/`MOON_HEAD`; the env vars take highest precedence — [CI guide](https://moonrepo.dev/docs/guides/ci)
- Full history is required to find the merge base. Shallow clones (depth 1) make affected detection inaccurate or fail. A blobless partial clone (`git clone --filter=blob:none`, or `filter: 'blob:none'` on `actions/checkout`) is the documented alternative — [CI guide](https://moonrepo.dev/docs/guides/ci)

**Affected flags (from `moon exec`, usable on `run`/`ci`)**
- `--affected [local|remote]`, `--base`, `--head`, `-g/--include-relations`, `--status <STATUS>` (filter changed files by status, e.g. `staged`), `--stdin` (read changed files from stdin), `--downstream none|direct|deep` (alias `--dependents`, default none), `--upstream none|direct|deep` (alias `--dependencies`, default deep), `--job`, `--job-total`, `--on-failure`, `--query`, `--ignore-ci-checks`, `--ci`, `-f/--force`, `--summary`, `--output-style` (v2.6), `-p/--plan <json>` (v2.1) — [moon exec](https://moonrepo.dev/docs/commands/exec)
- Introspect affectedness with `moon query affected [--upstream ...] [--downstream ...]` (v2.0). It returns JSON maps of `projects` and `tasks` keyed by ID/target — [query affected](https://moonrepo.dev/docs/commands/query/affected)

**`runInCI`**
- All tasks run in CI by default. Long-running tasks (dev servers) must set `runInCI: false`. Persistent tasks and tasks named `dev`, `start`, or `serve` default to `false`. Persistent tasks run only as a dependency or when passed explicitly — [CI guide](https://moonrepo.dev/docs/guides/ci)
- `runInCI` values: `affected`/`true` (default; run only if affected), `always` (v1.31), `false`, `only` (v1.41; CI only), `skip` (v1.41; skipped in CI but still valid for relationships) — [project config](https://moonrepo.dev/docs/config/project)
- Snippet — [CI guide](https://moonrepo.dev/docs/guides/ci):
  ```yaml
  tasks:
    dev:
      command: 'webpack server'
      options:
        runInCI: false
  ```

**Reference workflow**
- Snippet — [CI guide](https://moonrepo.dev/docs/guides/ci):
  ```yaml
  name: 'Pipeline'
  on:
    push:
      branches: ['master']
    pull_request:
  jobs:
    ci:
      name: 'CI'
      runs-on: 'ubuntu-latest'
      steps:
        - uses: 'actions/checkout@v4'
          with:
            fetch-depth: 0
            filter: 'blob:none'
        - uses: 'moonrepo/setup-toolchain@v0'
        - run: 'moon ci'
  ```

**`moonrepo/setup-toolchain@v0`**
- Installs proto globally. Installs moon if `.moon` exists or `moon-version` is set. Caches `~/.proto`, keyed on a hash of `.prototools` and `.moon/toolchain.yml`, and cleans stale tools before caching — [setup-toolchain README](https://github.com/moonrepo/setup-toolchain)
- Inputs: `auto-install` (run `proto install`, default false), `auto-setup` (run `moon setup`, default false), `cache` (default true), `cache-base` (warm-up cache ref that other refs restore from), `cache-version` (bump to invalidate), `moon-version`, `proto-version`, `workspace-root` — [setup-toolchain README](https://github.com/moonrepo/setup-toolchain)
- Note: the README still references `.moon/toolchain.yml`, which v2 renamed to `.moon/toolchains.yml`. This is possibly stale; verify that the cache key still picks up the v2 file — [setup-toolchain README](https://github.com/moonrepo/setup-toolchain) vs [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)

**Splitting work and sharding**
- Split by target across jobs, e.g. `moon ci :build` in one job and `moon ci :test :lint` in another (v1.14+). Targets still run only if affected — [CI guide](https://moonrepo.dev/docs/guides/ci)
- Sharding: `--job` (0-based) plus `--job-total`. GitHub has no native parallelism, so emulate it with a matrix — [CI guide](https://moonrepo.dev/docs/guides/ci):
  ```yaml
  strategy:
    matrix:
      index: [0, 1]
  steps:
    - run: moon ci --job ${{ matrix.index }} --job-total 2
  ```
  - Buildkite and CircleCI use native `parallelism` env vars (`BUILDKITE_PARALLEL_JOB[_COUNT]`, `CIRCLE_NODE_INDEX`/`CIRCLE_NODE_TOTAL`).

**Caching artifacts in CI**
- The CI guide recommends remote caching. Manual persistence of `.moon/cache/{hashes,outputs}` is possible, but other `.moon/cache` content is not portable, and you must handle invalidation yourself, since hashes change every run — [CI guide](https://moonrepo.dev/docs/guides/ci)
  - Conflict: in v2.3+ and v2.6+, the cache layout is `blobs/`, `manifests/`, and `outputs/`, and hash manifests moved out of `hashes/` — [Cache concept](https://moonrepo.dev/docs/concepts/cache). The CI guide's `{hashes,outputs}` path appears outdated.
- For PRs, plain `moon ci` (affected-only) "may be a sufficient starting point" before adding a remote cache — [Remote cache guide](https://moonrepo.dev/docs/guides/remote-cache)

**Remote cache configuration (v2 `remote` key)**
- Source for this group: [Remote cache guide](https://moonrepo.dev/docs/guides/remote-cache).
- Uses the Bazel Remote Execution v2 API. The server must support action result cache, CAS, SHA256 digests, and gRPC.
- Self-hosting with `bazel-remote`:
  ```
  bazel-remote --dir /path/to/moon-cache --max_size 10 --storage_mode uncompressed --grpc_address 0.0.0.0:9092
  ```
  Use `--storage_mode zstd` when `remote.cache.compression: 'zstd'`.
- gRPC client config:
  ```yaml
  remote:
    host: 'grpc://your-host.com:9092'
  ```
- HTTP client config, with retries (v2.6):
  ```yaml
  remote:
    api: 'http'
    host: 'https://your-host.com:8080'
    cache:
      retryCount: 5
  ```
  - Only `host` is required.
  - `MOON_REMOTE_HOST` enables remote caching conditionally, e.g. only in CI.
  - HTTP retries cover connection failures, timeouts, 5xx, 408, and 429. gRPC has no retries.
- TLS/mTLS (`grpcs://` plus `tls: {cert, domain}` or `mtls: {caCert, clientCert, clientKey, domain}`) is "very unstable" and not thoroughly tested.
- Depot (v1.32):
  ```yaml
  remote:
    host: 'grpcs://cache.depot.dev'
    auth:
      token: 'DEPOT_TOKEN'   # name of env var holding token
      headers:
        'X-Depot-Org': '<org-id>'
  ```
- What is stored: task outputs plus stdout/stderr, keyed by hash. Source is not stored, no PII is collected, and moon applies no encryption (that depends on the provider).
- Third-party: Namespace also advertises moon compatibility (vendor source) — [Namespace docs](https://namespace.so/docs/integrations/moonrepo); [Depot docs](https://depot.dev/docs/cache/reference/moonrepo)
- Debug remote caching with `MOON_DEBUG_REMOTE` — [Commands overview](https://moonrepo.dev/docs/commands/overview)

**Run reports**
- `moon ci` writes `.moon/cache/ciReport.json`. Other run commands write `.moon/cache/runReport.json`. These live in `.moon/cache` and may be overwritten, so upload them as a CI artifact to keep them — [moon ci command](https://moonrepo.dev/docs/commands/ci)
- `moonrepo/run-report-action@v1` posts a PR comment and a workflow summary. It must run after `moon ci`. Inputs: `access-token` (required), `matrix` (`${{ toJSON(matrix) }}`, prevents comments overwriting each other), `slow-threshold` (default 120s), `sort-by` (`label`|`time`), `sort-dir`, `workspace-root` — [run-report-action README](https://github.com/moonrepo/run-report-action)
  ```yaml
  - run: moon ci
  - uses: moonrepo/run-report-action@v1
    if: success() || failure()
    with:
      access-token: ${{ secrets.GITHUB_TOKEN }}
  ```
- Community actions (not official): `appthrust/moon-ci-retrospect` and `kymckay/moon-ci-booster` (posts failing task logs as PR comments) — [CI guide](https://moonrepo.dev/docs/guides/ci)
- Renovate: moon publishes a shared preset, and `.prototools` versions update out of the box — [CI guide](https://moonrepo.dev/docs/guides/ci)

### Inferences
- Recommended GHA shape: checkout (`fetch-depth: 0`, `filter: blob:none`) → `setup-toolchain@v0` (with `auto-install: true` if proto tools are needed, and `cache-base: main`) → `moon ci [--job/--job-total]` with `MOON_REMOTE_HOST` or a `remote` config plus secrets → `run-report-action` → upload `.moon/cache/ciReport.json` as an artifact.
- Avoid `actions/cache` on `.moon/cache` unless you engineer invalidation. The docs explicitly warn that it "won't work" naively.

### Gaps
- No official guidance found on setting `MOON_BASE` for `push` events to `main` (e.g. `github.event.before`). The docs rely on `ci_env` auto-detection.
- `run-report-action` does not document a `permissions:` block. `pull-requests: write` is likely needed, but this was not confirmed.
- No guidance on remote cache sizing or eviction beyond the `bazel-remote --max_size` example.

## How do you make tasks cache-correct (deterministic outputs, inputs including env vars, avoiding caching side-effect tasks)?

### Takeaway
A task's hash covers command/args, inputs, outputs, `env`, deps, toolchains, and toolchain-specific data (runtime version, lockfile and manifest deps, tsconfig). To make a task cache-correct:
- Declare explicit `inputs`; the default `**/*` is greedy.
- Declare every produced file in `outputs` so hydration works.
- List env vars that affect the result as `$VAR` inputs.
- Disable `cache` for side-effecting or long-running tasks.
- Use `cacheKey` or `cacheLifetime` for invalidation that moon cannot see.

### Cited Findings
- Hash contents: `command`, `args`, `inputs`, `outputs`, `env`, project `dependsOn` and task `deps` (tunable via `cacheStrategy`; `cleanup` and `wait` deps never contribute), `toolchains`. Node/Bun add runtime version, `package.json` deps, and tsconfig options. Deno adds version, imports/import maps, and tsconfig — [Cache concept](https://moonrepo.dev/docs/concepts/cache)
- Caution: the default `**/*` input includes everything in the project. VCS-ignored files and the task's own outputs are excluded, but others slip in. The docs recommend explicit `inputs` and regular hash-file audits — [Cache concept](https://moonrepo.dev/docs/concepts/cache)
- Gitignored files that match a glob are *not* inputs; list them as explicit file inputs to include them — [project config](https://moonrepo.dev/docs/config/project)
- Env var inputs start with `$`, and wildcards like `$FOO_*` work (v1.22). "If the environment variable always exists, then the task will always run and bypass the cache." Vars are assumed undefined by default — [project config](https://moonrepo.dev/docs/config/project)
- `outputs` are required for incremental caching and hydration. On hydration from a glob output, files not matching the glob are deleted, so include every file the build needs — [project config](https://moonrepo.dev/docs/config/project)
- `options.cache`: `true` (default) | `false` | `local` | `remote` (v1.40). Disabling it also disables output persistence — [project config](https://moonrepo.dev/docs/config/project)
- `options.cacheKey` (v1.35): a custom value mixed into the hash. Changing it invalidates local and remote caches. `options.cacheLifetime` (v1.29): e.g. `'1 day'`. Without it, the cache lives "forever, or until the task inputs are touched" — [project config](https://moonrepo.dev/docs/config/project)
- Persistent tasks never complete. Tasks that `wait` on long-running dependencies should disable `cache`, otherwise the dependency is stopped right after starting — [project config](https://moonrepo.dev/docs/config/project)
- `options.envFile`: `.env` loaded before run. `env` and system vars take precedence — [project config](https://moonrepo.dev/docs/config/project)
- Hydration: on a hit, the outputs tarball or CAS entry is restored. If the hash matches the last run and outputs exist, moon skips hydration ("cached"). Glob outputs re-hydrate only when matched files were added or removed — [Cache concept](https://moonrepo.dev/docs/concepts/cache)
- Cache modes via `--cache` / `MOON_CACHE`: `off` (everything fresh, including dep installs), `read`, `read-write` (default), `write` — [Commands overview](https://moonrepo.dev/docs/commands/overview)
- `-f/--force` runs regardless of cache and affected checks (v1 equivalent: `-u/--update-cache`) — [moon exec](https://moonrepo.dev/docs/commands/exec); [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)
- Cache layout (`.moon/cache`, git-ignore it) — [Cache concept](https://moonrepo.dev/docs/concepts/cache):
  - `blobs/`: CAS, plus hash manifests as of v2.6.
  - `manifests/`: hash → outputs.
  - `outputs/`: `<hash>.tar.gz`.
  - `states/<project>/snapshot.json` and `states/<project>/<task>/{lastRun.json, stdout.log, stderr.log}`.
  - `daemon/`, `locks/`, `schemas/`.

### Inferences
- Anti-patterns:
  - Relying on the default `**/*` inputs.
  - Listing a CI-only env var that is always set (e.g. `$CI`) as an input when it does not change output. Per the docs, an always-set var makes the task always run, which defeats caching.
  - Caching deploy/publish/migrate tasks, or anything whose value is a side effect. Set `cache: false` (and usually `runInCI: false`).
  - Forgetting `outputs` on build tasks, so cache hits restore nothing.
  - Nondeterministic outputs such as timestamps or absolute paths. The docs do not address these explicitly.
- Use `cache: 'local'` for tasks whose outputs are machine-specific or too large to upload.

### Gaps
- The docs pages retrieved did not discuss output determinism (timestamps, embedded paths) explicitly.
- No explicit doc statement was found on whether `env` *values* or only keys are hashed for `inputs: [$VAR]`.

## What is the recommended Dockerfile pattern for monorepos with moon, and why (layer caching via scaffold)?

### Takeaway
Use a multi-stage build from the workspace root:
- **base** stage: install moon.
- **skeleton** stage: `COPY . .` and `moon docker scaffold <project>`.
- **build** stage: copy the configs/manifests skeleton, run `moon docker setup` (install toolchain and deps), copy the sources skeleton, run the build task, then run `moon docker prune`.
- **start** stage.

Dependency layers are reused until manifests or lockfiles change. Scaffold computes the file lists automatically (O(1) maintenance instead of hand-written per-package `COPY` lines). `moon docker file` can generate this Dockerfile.

### Cited Findings
- Requirements:
  - Add `.moon/cache` to `.dockerignore`, because not all of it is portable.
  - Run `docker build` from the workspace root (use `-f` for per-project Dockerfiles).
  - Either exclude `.git` (recommended; smaller, but some features such as caching are disabled) or install git and copy `.git` (full features, larger image).
  - Source: [Docker guide](https://moonrepo.dev/docs/guides/docker)
- `moon docker scaffold <project>` produces a configs/workspace skeleton (manifests, lockfiles, config for dependency install) and a sources skeleton (sources for the project plus its deps). `moon docker setup` installs the toolchain and deps inside the image. `moon docker prune` removes `node_modules` outside the focus and installs production-only deps — [Docker guide](https://moonrepo.dev/docs/guides/docker)
- Skeleton directory name: the docker guide text still references `.moon/docker/workspace`, while the v2 migration guide says it was renamed to `.moon/docker/configs`. Verify against the installed version — [Docker guide](https://moonrepo.dev/docs/guides/docker) vs [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)
- Pattern below is a reconstruction of the guide's example; the stages and commands match, but the text is not verbatim — [Docker guide](https://moonrepo.dev/docs/guides/docker):
  ```dockerfile
  FROM node:latest AS base
  WORKDIR /app
  RUN npm install -g @moonrepo/cli

  FROM base AS skeleton
  COPY . .
  RUN moon docker scaffold <project>

  FROM base AS build
  COPY --from=skeleton /app/.moon/docker/configs .   # "workspace" in v1
  RUN moon docker setup
  COPY --from=skeleton /app/.moon/docker/sources .
  RUN moon run <project>:build
  RUN moon docker prune
  # start stage / CMD ...
  ```
- Why: manifests are installed before sources, so dependency layers are reused until manifests change. Scaffold removes the O(n) hand-maintained `COPY`s; the example shrinks from 35 to 18 lines — [Docker guide](https://moonrepo.dev/docs/guides/docker)
- Alpine: set `ENV MOON_TOOLCHAIN_FORCE_GLOBALS=true`, since Node has no prebuilt Alpine binaries — [Docker guide](https://moonrepo.dev/docs/guides/docker)
- Config: workspace `docker.scaffold.configsPhaseGlobs` and `docker.prune.*`; project `docker.scaffold.sourcesPhaseGlobs` and `docker.file.{buildTask,startTask,image}` — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0); [docker file](https://moonrepo.dev/docs/commands/docker/file)
- `moon docker file <project> [dest]` (v1.27). Flags: `--defaults`, `--build-task`, `--start-task`, `--image`, `--no-prune`, `--no-toolchain`, `--no-setup` (v2.0), `--template` (v2.0, custom template path). It generates 4 stages (base, skeleton, build, start), intended for production rather than dev. The base stage requires Bash — [docker file](https://moonrepo.dev/docs/commands/docker/file)
- Recent fixes: 2.6.2 fixed prune on some Rust crate kinds and the empty `main.rs` left by scaffold. 2.5.5 copies `.gitignore`. 2.5.4 fixed `docker setup` on Python-only projects — [GitHub releases](https://github.com/moonrepo/moon/releases)

### Inferences
- Pin the base image and moon version rather than using `node:latest` plus an unpinned `@moonrepo/cli`. This is standard Docker hygiene, not stated in the docs.
- Because `.git` is usually excluded, moon's own task cache is largely inert inside Docker. Docker layer caching (via scaffold) is the caching mechanism that matters there.

### Gaps
- The verbatim current Dockerfile from the guide could not be captured.
- No doc guidance was found on using BuildKit cache mounts or remote cache inside `docker build`.

## How should code generators/templates be organized? (plus VCS hooks and `moon sync`)

### Takeaway
Put templates in one or more directories registered under `generator.templates` (local paths, globs, `git://`, `npm://`, or archive URLs). Each template is a folder with a `template.yml` (title, description, variables, destination, id) and Tera-rendered files (`.tera`, `.raw`, partials, frontmatter). Run templates with `moon generate <id> --to <dest> [--defaults] -- --var value`. Define hooks in `vcs.hooks` and install them via `vcs.sync: true` or `moon sync vcs-hooks`.

### Cited Findings
**Codegen**
- Source for this group: [Codegen guide](https://moonrepo.dev/docs/guides/codegen).
- `generator.templates` in `.moon/workspace.yml` lists locations, searched in order. Supported location types:
  - Local: `./templates`, `file://...`
  - Glob (v1.31): `./templates/*`, `glob://projects/*/templates/*`
  - Git (v1.23): `git://github.com/moonrepo/templates#master`, cloned to `~/.moon/templates/git`
  - npm (v1.23): `npm://@moonrepo/templates#1.2.3`
  - Archive URL (v1.36)
- Shared git/npm sources need one folder per template, each with its own `template.*`. The folder name or `id` becomes the template name.
- `template.yml` example:
  ```yaml
  title: 'npm package'
  description: '...'
  variables:
    name:
      type: 'string'
      required: true
      prompt: 'Package name?'
  ```
  `destination` and `id` are also supported.
- Templating:
  - Tera engine. Prefer the `.tera` extension (or `.twig`), which is stripped on output.
  - Path interpolation like `src/[type].ts`.
  - Any path containing `partial` is a partial: not emitted, no frontmatter.
  - `.raw` (v1.11) skips rendering.
  - YAML frontmatter supports `force: true` and `to:`.
  - Binary assets are copied as-is.
  - Built-in vars: `dest_dir`, `dest_rel_dir`, `working_dir`, `workspace_root`. A `variables()` function exists (v1.23).
- Commands:
  - `moon generate <name> --template` scaffolds a new template.
  - `moon generate npm-package --to ./packages/example --defaults -- --name '@company/example' --private` runs one.
  - Arrays take repeated flags, booleans accept `--no-<arg>`, and objects cannot be passed on the CLI.
- v2: the destination must be given via `--to`. The v1 positional form `moon generate <id> ./dist` changed — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)
- `moon templates` lists templates as a table in v2 — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)

**VCS hooks**
- Source for this group: [VCS hooks guide](https://moonrepo.dev/docs/guides/vcs-hooks).
- `vcs.hooks` maps hook names to command lists. Commands run as-is from the repo root and must be on `PATH`. Arguments arrive as `$ARG1..n` (v1.40.3).
  ```yaml
  vcs:
    hooks:
      pre-commit:
        - 'moon run :lint :format --affected --status=staged'
      commit-msg:
        - 'pre-commit run --hook-stage commit-msg --commit-msg-filename $ARG1'
  ```
- Enable via `vcs.sync: true`, which regenerates hooks on every task run. The guide warns this "enables the execution of arbitrary code on the computers of the team members". Alternatively, each developer runs the sync command manually.
- To disable, set `vcs.sync: false` and run the sync command with `--clean`.
- Scripts are generated in `.moon/hooks`, and Git's `core.hooksPath` is pointed there. Unix hooks are Bash, Windows hooks are PowerShell `.ps1`.
- For local moon installs, use repo-relative paths (`./node_modules/@moonrepo/cli/moon`).
- `affectedFiles` task option passes changed files as args and/or `MOON_AFFECTED_FILES`. Its object form is v2.1 — [project config](https://moonrepo.dev/docs/config/project)
- Inconsistencies:
  - The hooks guide shows `moon sync hooks`, but the sync command index lists `moon sync vcs-hooks` — [VCS hooks guide](https://moonrepo.dev/docs/guides/vcs-hooks) vs [moon sync](https://moonrepo.dev/docs/commands/sync).
  - The hooks guide says Unix scripts are `.sh`, while the migration guide says v2 scripts no longer end in `.sh` — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0).

**`moon sync`**
- Subcommands: `code-owners`, `config-schemas` (JSON schemas into `.moon/cache/schemas`), `projects` (forces a sync of all projects), `vcs-hooks` — [moon sync](https://moonrepo.dev/docs/commands/sync)
- `--no-actions` on `exec` skips sync and setup actions — [moon exec](https://moonrepo.dev/docs/commands/exec)

### Inferences
- Recommended organization: a single `./templates/<id>/template.yml` tree in-repo for org-specific generators, or a versioned `git://...#tag` / `npm://...@ver` source for cross-repo sharing. Pin a ref so generator output is reproducible.
- Prefer manual hook sync (`vcs.sync: false` plus documented onboarding) in security-sensitive repos, given the docs' arbitrary-code warning.

### Gaps
- `extends`, the full variable type list, and the frontmatter `skip` key were not captured. See [template config](https://moonrepo.dev/docs/config/template) (not fetched).
- Flags for `moon generate --dry-run` were not confirmed on the guide page.

## What debugging/introspection commands and log levels does the doc recommend when tasks unexpectedly miss cache or run?

### Takeaway
Follow the official debug-task flow:
1. Inspect the resolved task with `moon task <target> --json` and `.moon/cache/states/<project>/snapshot.json`.
2. Run with `--log trace --force` plus `MOON_DEBUG_PROCESS_ENV`/`MOON_DEBUG_PROCESS_INPUT`.
3. Grab the 64-char hash from the logs, inspect it with `moon hash <hash>`, and diff two runs with `moon hash <a> <b>`.

Use `--log debug` for general diagnostics. Use `moon query affected`/`changed-files` and `moon action-graph` to see why something is affected or scheduled.

### Cited Findings
- Debug-task steps and commands — [Debug task guide](https://moonrepo.dev/docs/guides/debug-task):
  - `moon task <target> --json`
  - `MOON_DEBUG_PROCESS_ENV=true MOON_DEBUG_PROCESS_INPUT=true moon run <target> --log trace --force`
  - `moon hash <hash>`
  - `moon hash <hash-left> <hash-right>` (diff)
- Snapshot checks: confirm that `command`/`args` tokens resolved, `inputs` expanded to `inputFiles`/`inputGlobs`/`inputVars`, `outputs` expanded to `outputFiles`/`outputGlobs`, `toolchains` are correct (else set `toolchain` explicitly), and `options`/`state` look right. Inspect `inherited.config` and `inherited.layers` for task-inheritance surprises — [Debug task guide](https://moonrepo.dev/docs/guides/debug-task)
- Trace logs show changed-file detection, the project file listing, `git hash-object` hashing, and the final SHA256 task hash. `MOON_DEBUG_PROCESS_INPUT` makes logs very large — [Debug task guide](https://moonrepo.dev/docs/guides/debug-task)
- Hash manifest: the first item is the task (check `deps`/`implicitDeps`, `inputs`/`implicitInputs`). Later items are toolchain data (versions, lockfile dep hashes). Manifests are in `.moon/cache/blobs` as of v2.6 — [Debug task guide](https://moonrepo.dev/docs/guides/debug-task)
- An AI skill exists: `npx skills add moonrepo/moon --skill debug-task`. It targets stale results, unexpected misses, and CI-vs-local differences — [Debug task guide](https://moonrepo.dev/docs/guides/debug-task)
- Log levels via `--log` / `MOON_LOG`: `off, error, warn, info (default), debug, trace, verbose`. Also `--log-file` / `MOON_LOG_FILE`. The docs say `--log debug` "includes the majority of useful diagnostic information" — [Commands overview](https://moonrepo.dev/docs/commands/overview)
- Other env and flags — [Commands overview](https://moonrepo.dev/docs/commands/overview):
  - `--dump` / `MOON_DUMP`: trace profile for `chrome://tracing` or Perfetto.
  - `MOON_DEBUG_REMOTE`: remote cache connection errors.
  - `MOON_DEBUG_PROTO_INSTALL`, `MOON_DEBUG_WASM`.
  - `--concurrency` / `MOON_CONCURRENCY`.
  - OpenTelemetry export: `--otel`, `--otel-logs` (v2.5).
- Graph introspection:
  - `moon action-graph [target]` (alias `ag`) serves an interactive graph; also `--dependents`, `--dot`, `--json`, `--host`/`--port` (v1.36). Nodes include `SetupToolchain`, `InstallWorkspaceDeps`, `SyncProject`, and `RunTask` — [action-graph](https://moonrepo.dev/docs/commands/action-graph)
  - `project-graph` and `task-graph` are sibling commands — [query affected](https://moonrepo.dev/docs/commands/query/affected)
- `moon query affected` (v2.0) and `moon query changed-files` (v1's `touched-files`) show what moon considers affected or changed — [query affected](https://moonrepo.dev/docs/commands/query/affected); [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)
- `--output-style hash` (v2.6) shows only generated hashes, which is useful for quickly comparing CI vs local — [moon exec](https://moonrepo.dev/docs/commands/exec)
- Since 2.5, with the daemon enabled, archive and hydration failures appear in daemon server logs (`.moon/cache/daemon/`), not the CLI — [Cache concept](https://moonrepo.dev/docs/concepts/cache)

### Inferences
- Triage for "unexpectedly ran / missed cache":
  1. `moon query affected` / `changed-files`: was it affected?
  2. `--output-style hash` on two runs.
  3. `moon hash a b` diff.
  4. Fix the inputs, env, or toolchain causing drift.
- Triage for "unexpectedly skipped in CI": check `runInCI`, the base/head detection (`MOON_BASE`/`MOON_HEAD`, fetch depth), and the v2 change that dropped graph relations from affected checks by default (`-g`).

### Gaps
- No doc page covers `moon project-graph`/`task-graph` flags in this research; only the action-graph page was fetched.
- v1-era `moon query hash-diff` usage is removed in v2 and was not researched further.
