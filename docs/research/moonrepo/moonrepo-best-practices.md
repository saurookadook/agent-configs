# Configure moon v2 for correct caching

moon v2 is the only version the official docs now cover. v2.0 ("Phobos") shipped on 18 February 2026, and the current release is **v2.6.2 (14 October 2026)**. Its best practices come down to one idea: **make every hash honest**. In practice that means six things. Pin every tool version in a committed `.prototools`. Define universal tasks (format, lint, typecheck, test) once in `.moon/tasks/*.yml` and run them per project. Give every task explicit file-group `inputs`, and give every build task `outputs`. Let toolchain detection choose a task's toolchains rather than setting them by hand. In CI, run `moon ci` on a full-history checkout, backed by a Bazel-API remote cache, not by `actions/cache`. Build Docker images with `moon docker scaffold`, `setup` and `prune`. The stakes are practical. Much of the material still in circulation is v1-era, including moonrepo's own `examples` repo, the FAQ and the `setup-toolchain` README, and v1 keys (`.moon/toolchain.yml`, `runner`, `node.packageManager`, `type`, `platform`, `local`) either fail or silently mean something else in v2. v2 also changed four behaviours that affect correctness. `inferInputs` now defaults to `false`. Tasks run in a shell by default. `--affected` no longer includes graph relations. Inherited task configs are deep-merged, not shallow-merged. The docs disagree with themselves in several places, and Python support is still `unstable_`. A standard built on this report should therefore pin a moon version and re-check the flagged items against it. Every recommendation below carries one of three labels: **[Doc]** is an explicit recommendation in moonrepo's docs, **[Default]** is behaviour moon gives with no configuration, and **[Inference]** is this report's own reasoning from the docs.

## v2 renamed the vocabulary, so v1 snippets are now hazards

The v2 migration guide works as a checklist of words that no longer belong in a config. `.moon/toolchain.*` became **`.moon/toolchains.*`**, because more than one toolchain can be configured. `extensions` moved out of the workspace file into its own `.moon/extensions.*`. `.moon/tasks.yml` was removed in favour of **`.moon/tasks/all.yml`**. Filename-based task inheritance gave way to an explicit **`inheritedBy`** key. Toolchains are now WASM plugins instead of the hard-coded "platform" system ([Migrate to v2](https://moonrepo.dev/docs/migrate/2.0); [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)). Upgrading takes a reinstall: `moon upgrade` cannot move a v1 install to v2 because the distribution format changed. The guide's route is `proto install moon 2.x`, followed by `moon migrate v2` and a review of its output ([Migrate to v2](https://moonrepo.dev/docs/migrate/2.0)). v2 has moved quickly since, with six minor releases between February and October. v2.1 added execution plans, v2.2 the daemon, v2.3 task tags and the CAS cache experiment, v2.4 task `checks`, v2.5 made the async engine the default, and v2.6 added `wait` and `cleanup` deps ([Blog archive](https://moonrepo.dev/blog/archive)). **[Inference]** A standard should name a minimum v2 minor and enforce it with `versionConstraint`. Many keys are annotated with the minor that introduced them.

The table below merges every rename the notes recorded. A standard can use it directly as a list of banned keys.

| Area | v1 | v2 |
|---|---|---|
| Files | `.moon/toolchain.*` | `.moon/toolchains.*` |
| Files | `extensions:` in workspace | `.moon/extensions.*` (flattened) |
| Files | `.moon/tasks.yml`, `.moon/tasks/node.yml` naming | `.moon/tasks/all.yml` + `inheritedBy` |
| Files | `.moon/docker/workspace` | `.moon/docker/configs` |
| Files | hooks in `.git/hooks/*.sh` | `.moon/hooks` via `core.hooksPath`, no `.sh` |
| Workspace | `runner` | `pipeline` |
| Workspace | `vcs.manager` / `vcs.syncHooks` | `vcs.client` / `vcs.sync` |
| Workspace | `constraints.enforceProjectTypeRelationships` | `constraints.enforceLayerRelationships` |
| Workspace | `unstable_remote` | `remote` |
| Workspace | `codeowners.syncOnRun`, `orderBy: project-name` | `codeowners.sync`, `orderBy: project-id` |
| Workspace | `docker.scaffold.include` | `docker.scaffold.configsPhaseGlobs` (workspace) / `sourcesPhaseGlobs` (project) |
| Workspace | `docker.prune.installToolchainDeps` | `docker.prune.installToolchainDependencies` |
| Workspace | `hasher.batchSize`, `pipeline.archivableTargets`, `docker.scaffold.copyToolchainFiles`, v1 `experiments.*` | removed |
| Toolchain | `node.packageManager`, `node.inferTasksFromScripts`, `node.syncPackageManagerField` | `javascript.*` |
| Toolchain | `node.rootPackageOnly` | `javascript.rootPackageDependenciesOnly` |
| Toolchain | `node.pnpm` / `node.yarn` / `node.npm` | top-level `pnpm` / `yarn` / `npm` |
| Toolchain | `node.binExecArgs` | `node.executeArgs` |
| Toolchain | `unstable_` on non-Python toolchains | dropped; Python keeps `unstable_python`, `unstable_pip`, `unstable_uv`, `unstable_poetry` |
| Toolchain | `node.addEnginesConstraint`, `node.packagesRoot`, `bun.packagesRoot`, `deno.depsFile`, `deno.lockfile`, `python.rootVenvOnly` | removed |
| Project | `project.name`, `project.metadata` | `project.title`; custom fields at the root of `project` |
| Project | `type` | `layer` |
| Project | `platform` / `toolchain` | `toolchains.default` / `toolchains` |
| Project | `toolchain.*.disabled` | set the toolchain to `null` |
| Task | `local: true` | `preset: 'server'` |
| Task | `platform` | `toolchains` |
| Task | `options.affectedPassInputs` | `options.affectedFiles.passInputsWhenNoMatch` |
| Task | `preset: watcher`, string `deps.*.args` | removed; args must be a list |
| Tokens | `$projectName`, `$projectType`, `$taskPlatform` | `$projectTitle`, `$projectLayer`, `$taskToolchain` |
| CLI | `-u/--update-cache` | `-f/--force` |
| CLI | `--remote`, `--no-bail`, `--profile` | `--affected remote`, `moon exec --on-failure`, removed |
| CLI | `--platform`, camelCase flags | `--toolchain`, kebab-case flags |
| CLI | `moon run build` (closest project) | `moon run ~:build` |
| CLI | `moon query hash`, `hash-diff`, `touched-files` | `moon hash`, `moon hash a b`, `moon query changed-files` |
| CLI | `moon generate <id> ./dest` | `moon generate <id> --to ./dest` |
| CLI | `moon migrate from-package-json`, `from-turborepo` | removed; `migrate-turborepo` / `migrate-nx` extensions |
| MQL | `projectName`, `projectType`, `taskPlatform` | `projectId`, `projectLayer`, `taskToolchain` |

Sources: [Migrate to v2](https://moonrepo.dev/docs/migrate/2.0), [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0).

Four semantic changes matter more than any rename, because the old config still parses and then behaves differently. **`--affected` no longer includes graph relations**, and `-g/--include-relations` restores them. **`options.inferInputs` now defaults to `false`**. **Tasks run in a shell by default** (`unixShell: bash`, `windowsShell: pwsh`), while `command` accepts only simple commands, so pipes, `&&`, redirects and `KEY=value` prefixes must move to `script`. **Inherited task configs are now deep-merged in sequence**. The guide's own example is a v1 `build` task that lost its `command` and `mutex` under shallow merge. Smaller changes follow the same pattern. `runInCI` is now honoured by `moon run` and `moon exec`, not only by `moon ci`. `.env` files load just before execution, so task `env` can no longer reference them. `$VAR` substitution no longer supports `${VAR:-default}`. `MOON_AFFECTED_FILES` is now joined with the OS path separator instead of commas ([Migrate to v2](https://moonrepo.dev/docs/migrate/2.0); [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)). v2.6 also made a task's resolved toolchain list part of its hash. Tasks with several toolchains therefore miss the cache once after the upgrade ([moon v2.6 blog](https://moonrepo.dev/blog/moon-v2.6)).

## One pinned toolchain and a strict workspace keep every machine identical

**[Doc]** Give every toolchain a version. With a version set, moon installs the exact tool through proto on first use and puts it on `PATH`. Without one, the binary "must exist on `PATH`" ([Setup toolchain](https://moonrepo.dev/docs/setup-toolchain)). The docs state the format rules directly: full versions (`1.2.3`) "are preferred for consistency", partial versions should keep major.minor, and aliases such as `latest` or `stable` are discouraged because they move ([Toolchain concept](https://moonrepo.dev/docs/concepts/toolchain)). **[Default]** Since v2.0 every toolchain reads its version from the root `.prototools` (`versionFromPrototools: true`), and the docs say `.prototools` "pairs well with" Renovate ([toolchains config](https://moonrepo.dev/docs/config/toolchain)). **[Inference]** Use `.prototools` as the single place for versions and keep `.moon/toolchains.yml` for behaviour only. Pin proto itself through moon's `proto.version` (v1.39+), not through `proto = "…"` in `.prototools`. proto v0.63's trust model ignores the proto pin and most `[tools.*]` and `[settings]` entries in an untrusted `.prototools` until someone runs `proto trust`, sets `PROTO_TRUSTED_PATHS` or CI is detected. Built-in tool pins always apply ([proto config](https://moonrepo.dev/docs/proto/config)). Two gaps remain open. The docs give **no precedence order** for when `toolchains.<id>.version` and `.prototools` disagree; only the `MOON_<TOOLCHAIN>_VERSION` env-var override is documented. And no moon page confirms that `.prototools` can pin moon itself.

```toml
# .prototools  (single source of truth for versions; numbers are illustrative)
node = "24.11.0"
pnpm = "10.20.0"
python = "3.12.7"
uv = "0.9.5"
```

```yaml
# .moon/toolchains.yml  (behaviour only; versions come from .prototools)
$schema: './cache/schemas/toolchains.json'
proto:
  version: '0.63.0'
javascript:
  packageManager: 'pnpm'
node: {}
pnpm: {}
typescript: {}
```

**[Default]** The workspace defaults favour correctness. `hasher.optimization: accuracy` hashes lockfile-resolved versions; `performance` hashes manifest ranges. `walkStrategy: vcs` and `warnOnMissingInputs: true` are also on by default ([workspace config](https://moonrepo.dev/docs/config/workspace)). **[Inference]** Keep them. `performance` lets a lockfile-only upgrade leave caches unbusted. The one default to override is **`vcs.defaultBranch`, which is `master`**. moon diffs against the base branch to compute affected projects, so a repo on `main` must say so ([workspace config](https://moonrepo.dev/docs/config/workspace); [Setup workspace](https://moonrepo.dev/docs/setup-workspace)). Leave `pipeline` at its defaults unless you have a reason: `autoCleanCache: true`, `cacheLifetime: "7 days"`, `installDependencies`, `syncProjects` and `syncWorkspace` all `true`, and `killProcessThreshold: 2000`. The docs warn that `notifier.webhookAcknowledge` "will slow down your pipeline". `telemetry` defaults to `true` and can be turned off with `MOON_TELEMETRY`. **[Doc]** The v2.5 advice on experiments is to keep the new defaults (`asyncGraphBuilding`, `asyncAffectedTracking` and `nativeFileHashing` are all on), and to switch one off only if something breaks, then report it ([moon v2.5 blog](https://moonrepo.dev/blog/moon-v2.5)). `casOutputsCache` (v2.3) and `explicitTaskOutputStyle` (v2.6) stay off by default, and the docs warn that experiments "may be buggy".

The docs list three ways to declare `projects`: a name→path map, a list of globs, or `{globs, sources}` together. They recommend none, beyond saying that globs avoid hand-curating a list. Two hazards shape the choice. Glob-derived IDs come from folder names, and a collision "log[s] a warning and the project is skipped". **`projects` does not merge under `extends`** ([workspace config](https://moonrepo.dev/docs/config/workspace); [Create a project](https://moonrepo.dev/docs/create-project)). Since v2.5 globs can match manifest files such as `apps/*/package.json`, but a root-level project still needs a moon config file ([moon v2.5 blog](https://moonrepo.dev/blog/moon-v2.5)). **[Inference]** Use globs with `globFormat: 'source-path'` so IDs cannot collide. Use `sources` for a root project (`root: '.'`), because a glob-inferred root ID takes the checkout's folder name ([Root-level project](https://moonrepo.dev/docs/guides/root-project)). Set `versionConstraint` to match the pinned moon. Turn on `constraints.enforceLayerRelationships`. That constraint ignores projects with an unknown `layer`, so it only means something once every project declares one. The docs show `false` in their example and never state the default, so set it explicitly.

```yaml
# .moon/workspace.yml
$schema: './cache/schemas/workspace.json'
versionConstraint: '>=2.6.0'
projects:
  globs: ['apps/*/moon.yml', 'packages/*/moon.yml']
  sources:
    root: '.'
  globFormat: 'source-path'
vcs:
  client: 'git'
  defaultBranch: 'main'
  hooks:
    pre-commit:
      - 'moon run :lint :format --affected --status=staged'
  sync: false
constraints:
  enforceLayerRelationships: true
  tagRelationships:
    next: ['react']
```

**[Doc]** The recommended pre-commit hook is `moon run :lint :format --affected --status=staged`, with the `affectedFiles` task option turned on ([VCS hooks guide](https://moonrepo.dev/docs/guides/vcs-hooks)). The guide calls `vcs.sync: true` "a sensitive action": it regenerates hooks on every task run, for all users, and "enables the execution of arbitrary code on the computers of the team members". The alternative is for each developer to run the sync command. **[Inference]** Keep `sync: false` and put manual sync in the onboarding docs. Note that pointing `core.hooksPath` at `.moon/hooks` takes that slot from Husky or any other manager that uses it, and the docs never discuss coexistence. Hook commands run from the repository root, and `moon` must be on `PATH` or called by a relative path. The docs also contradict themselves on the command name. The guide says `moon sync hooks`, the command index lists `moon sync vcs-hooks`, and the guide still describes `.sh` scripts that the migration guide says v2 no longer creates ([moon sync](https://moonrepo.dev/docs/commands/sync); [Migrate to v2](https://moonrepo.dev/docs/migrate/2.0)).

**[Doc]** For editor validation, point `$schema` at the locally generated schemas (`./cache/schemas/workspace.json`, and `../cache/schemas/tasks.json` from `.moon/tasks/`). The hosted `moonrepo.dev/schemas` URLs are deprecated. moon writes the schemas when a task runs, or when you run `moon sync config-schemas` ([Config overview](https://moonrepo.dev/docs/config/overview)). **[Inference]** `.moon/cache` is gitignored, so a fresh clone needs `moon sync config-schemas` before editors stop reporting a missing schema. A v1-era issue showed "Property typescript is not allowed" errors coming from this exact setup ([Issue #1893](https://github.com/moonrepo/moon/issues/1893)). v2 accepts YAML, JSON, JSONC, TOML, HCL and Pkl without preferring any of them. **[Inference]** Standardise on YAML. Every doc example uses it, and `extends` targets are still described as "a valid YAML document". Pkl files are evaluated in isolation, without inheritance merging.

## Inherited universal tasks with explicit inputs make caching precise

**[Doc]** The tasks reference recommends defining format, lint, test and typecheck in `.moon/tasks/**/*` "to avoid repeating them in each project". The ESLint, Prettier and TypeScript example pages each call their tool "a universal workflow" and show it as one inherited task. Each project runs it in its own directory with project-scoped inputs, while the root config and ignore files are pulled in with a leading `/` ([Tasks config](https://moonrepo.dev/docs/config/tasks); [ESLint example](https://moonrepo.dev/docs/guides/examples/eslint); [Prettier example](https://github.com/moonrepo/moon/blob/master/website/docs/guides/examples/prettier.mdx)). The root-level project serves "one-off, organization, maintenance, or process oriented tasks". Its guide warns that whole-repo inputs are "a very expensive operation!" ([Root-level project](https://moonrepo.dev/docs/guides/root-project)). **[Inference]** Running per project is what gives each project its own hash and its own affected status. A single root lint task reruns on any change anywhere in the repo, which defeats both. The docs imply this reasoning but never state the comparison outright.

**[Default]** If a task has no inputs, set or inherited, **moon treats every file in the project (`**/*`) as an input**. Root-level tasks are the exception: since v1.24 they default to no inputs ([Project config](https://moonrepo.dev/docs/config/project)). The "Create a task" guide instead says such a task "always runs" ([Create a task](https://moonrepo.dev/docs/create-task)). The pages conflict, but the fix is the same either way. **[Doc]** Declare explicit inputs, ideally through file groups. The cache concept page also recommends regular audits of hash files ([Cache concept](https://moonrepo.dev/docs/concepts/cache)). Three documented traps follow. An env-var input that is always set means "the task will always run and bypass the cache". A file matched by a glob but gitignored is *not* an input, so list it as an explicit path. A glob output deletes every file in the output location that does not match on a cache hit ([Project config](https://moonrepo.dev/docs/config/project)). Build tasks need `outputs`, because moon "hydrates all necessary outputs from the cache, then immediately exits". **[Inference]** `inputs: []` is not the same as omitting inputs: it opts out of file-based invalidation. Never use `$CI` or any other always-set variable as an input unless the output really depends on it.

```yaml
# .moon/tasks/all.yml   (no inheritedBy: every project inherits)
$schema: '../cache/schemas/tasks.json'
fileGroups:
  sources: ['src/**/*']
  tests: ['tests/**/*']
implicitDeps: ['^:build']
tasks:
  typecheck:
    command: 'tsc'
    args: ['--build', '--pretty']
    inputs: ['@group(sources)', '@group(tests)', 'tsconfig.json', '/tsconfig.options.json']
  lint:
    command: 'eslint'
    args: ['.']
    inputs: ['@group(sources)', '@group(tests)', '/eslint.config.js']
    options:
      affectedFiles: true
```

```yaml
# .moon/tasks/js-library.yml   (scoped inheritance, v2)
inheritedBy:
  toolchains: { or: ['javascript', 'typescript'] }
  layers: ['library']
tasks:
  build:
    command: 'tsc'
    args: ['--build']
    inputs: ['@group(sources)', 'tsconfig.json']
    outputs: ['lib']
```

A project adjusts what it inherits in three ways. First, a same-named local task merges field by field onto the inherited one. The default strategy is **`append`**, which suits flag arguments. `prepend` suits options that must come before positional arguments, and `replace` gives full control. The docs say `preserve` "should rarely be used". Second, `workspace.inheritedTasks` applies `include`, then `exclude`, then `rename`. Third, a task can `extends` a sibling or global task to make a variant such as `build-prod` ([Task inheritance](https://moonrepo.dev/docs/concepts/task-inheritance); [Project config](https://moonrepo.dev/docs/config/project)). `script` never merges; it always replaces. `implicitInputs` and `implicitDeps` are added to every inherited task regardless of the merge strategy. Since v2.4, `taskOptions` in a project's `moon.yml` overrides the workspace defaults. The docs leave two things unclear. They never say how several matching `.moon/tasks/*.yml` files are ordered, beyond "deep merged in sequence". They also disagree on which `inheritedBy` conditions exist. The concept page and the v2 blog list `files`, `languages`, `layers`, `stacks`, `tags` and `toolchains`, while the config reference lists only `toolchains`, `stacks` and `layers`. A `language` condition matches only a `language` set explicitly in `moon.yml`, never a detected one ([moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)). File-group merging is contested too. The concept page says a project group *overrides* a workspace group of the same name, while the migration guide and project reference say v2 *merges* them, and `workspace.mergeStrategies.fileGroups: replace` (v2.5) restores override behaviour ([File groups](https://moonrepo.dev/docs/concepts/file-group)). Treat the concept page as stale.

**[Doc]** Use `command` plus array `args` for anything that should merge or accept passthrough arguments. Put each flag and its value in separate items (`'--maxWorkers', '3'`). Reserve `script` for real shell composition ([Tasks concept](https://moonrepo.dev/docs/concepts/task)). Use presets rather than setting option combinations by hand. `server` is for dev servers: cache off, streamed output, persistent, `runInCI: false`. Tasks named `dev`, `start` or `serve` get it automatically. `utility` (v2.0) is for local one-off tasks such as migrations: cache off, interactive, `runInCI: skip`. The other options, briefly. `internal` hides a building-block task from the CLI. `mutex` serialises tasks that share a resource. `runDepsInParallel: false` makes ordering serial. `checks` (v2.4) run before the task as gates (`requirement`, `condition`) or as hash seeds (`fingerprint`, e.g. `node --version`). For end-to-end tests, v2.6 dep types let a test start a server with a `wait` dep and stop it with a `cleanup` dep. Neither dep type affects the hash. A CI task cannot wait on a non-CI task, so the server it waits on needs `runInCI` turned on ([Create a task](https://moonrepo.dev/docs/create-task); [Project config](https://moonrepo.dev/docs/config/project)). One more conflict: the migration guide says `shell` defaults to `true`, while the project reference summary says `true` only for the system toolchain or Windows.

```yaml
# apps/web/moon.yml
language: 'typescript'
layer: 'application'
stack: 'frontend'
tags: ['react']
project:
  title: 'Web app'
  description: 'Customer-facing React SPA served from the edge.'
  owner: 'team-web'
tasks:
  dev:
    command: 'vite'
    preset: 'server'
  e2e:
    command: 'playwright'
    args: ['test']
    deps:
      - { target: 'web:serve', type: 'wait' }
      - { target: 'web:stop', type: 'cleanup' }
  lint:
    args: ['--cache']        # appended to the inherited lint args
```

Boundaries come from metadata. **[Doc]** `layer` takes one of `automation`, `application`, `tool`, `library`, `scaffolding`, `configuration` or `unknown`, and a layer may depend only on lower layers in the same stack. `stack` takes `frontend`, `backend`, `data`, `infrastructure`, `systems` or `unknown`. `tagRelationships` makes dependencies carry required tags ([Workspace config](https://moonrepo.dev/docs/config/workspace)). The docs mark `project.description` as required and indexed for search, and advise that `owner` name a team rather than a person. No case style is prescribed for IDs and task names. camel, kebab and snake case are all allowed, as long as the name starts with a letter, and the docs' own examples are camelCase (`designSystem`, `apiClients`) ([Projects concept](https://moonrepo.dev/docs/concepts/project)). **[Inference]** Choose one style for the whole repo. Remember that `dev`, `start` and `serve` carry behaviour. Use the owning-project shorthand (`~:typecheck`, or a bare `typecheck`) inside `.moon/tasks` files, and quote `#` and `~` targets in shells ([Targets](https://moonrepo.dev/docs/concepts/target)).

## CI, Docker and debugging all hinge on affected detection and the hash

**[Doc]** The reference GitHub Actions pipeline has three steps. Check out with `fetch-depth: 0` and `filter: 'blob:none'`, because a shallow clone breaks merge-base detection. Run `moonrepo/setup-toolchain@v0`, which installs proto and moon and caches `~/.proto`. Then run `moon ci` ([CI guide](https://moonrepo.dev/docs/guides/ci)). `moon ci` is `moon exec` with these flags pre-filled: `--affected --ci --on-failure=continue --summary=detailed --upstream=deep --downstream=direct` ([moon ci](https://moonrepo.dev/docs/commands/ci)). That partly makes up for v2 dropping graph relations from `--affected`. moon detects base and head from the CI environment, and `MOON_BASE`/`MOON_HEAD` override it with the highest precedence. To shard, use a matrix with `--job`/`--job-total`. To post results, run `moonrepo/run-report-action@v1` under `if: success() || failure()`, passing `matrix: ${{ toJSON(matrix) }}` so shards do not overwrite each other's comments ([run-report-action](https://github.com/moonrepo/run-report-action)). The report file `.moon/cache/ciReport.json` can be overwritten, so upload it as an artifact. **[Doc]** For artifacts that persist between runs, the guide recommends **remote caching** over saving `.moon/cache` by hand. Its own manual-cache path (`{hashes,outputs}`) is out of date, because v2.6 moved hash manifests into `blobs/` ([Cache concept](https://moonrepo.dev/docs/concepts/cache)).

```yaml
# .github/workflows/ci.yml
jobs:
  ci:
    runs-on: ubuntu-latest
    strategy:
      matrix: { index: [0, 1] }
    env:
      MOON_REMOTE_HOST: ${{ secrets.MOON_REMOTE_HOST }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0, filter: 'blob:none' }
      - uses: moonrepo/setup-toolchain@v0
        with: { auto-install: true, cache-base: main }
      - run: moon ci --job ${{ matrix.index }} --job-total 2
      - uses: moonrepo/run-report-action@v1
        if: success() || failure()
        with:
          access-token: ${{ secrets.GITHUB_TOKEN }}
          matrix: ${{ toJSON(matrix) }}
```

The remote cache speaks the **Bazel Remote Execution v2 API** (action cache, CAS, SHA256, gRPC). moonrepo's hosted moonbase was sunset ([moonbase sunset blog](https://moonrepo.dev/blog/moonbase-sunset)). Self-host `bazel-remote`, or use Depot or Namespace. Only `remote.host` is required. Setting `MOON_REMOTE_HOST` turns remote caching on per environment. HTTP mode retries failed requests (`remote.cache.retryCount`, default 3 since v2.6); gRPC does not. The guide calls TLS and mTLS "very unstable". moon stores outputs and logs, never source, and applies no encryption ([Remote cache guide](https://moonrepo.dev/docs/guides/remote-cache)). **[Default]** A task's hash covers command, args, inputs, outputs, `env`, deps, `dependsOn` and toolchains, plus toolchain data such as the runtime version, lockfile dependencies and tsconfig options ([Cache concept](https://moonrepo.dev/docs/concepts/cache)). **[Inference]** Set `cache: false` (usually with `runInCI: false`) on deploy, publish and migrate tasks, whose value is a side effect. Use `cache: 'local'` for outputs that are machine-specific or too large to upload. The docs say nothing about nondeterministic outputs such as timestamps and absolute paths, and those still break cache sharing. A few CI details remain undocumented: `setup-toolchain`'s cache key still names the v1 `.moon/toolchain.yml`, setting `MOON_BASE` on `push` events is never covered, and the `permissions:` that `run-report-action` needs are not stated.

**[Doc]** The Docker guide builds from the workspace root in four stages. A base stage installs moon. A skeleton stage runs `COPY . .` and `moon docker scaffold <project>`. A build stage copies the configs skeleton, runs `moon docker setup`, copies the sources skeleton, runs the build task and then `moon docker prune`. A final stage starts the app. Dependency layers are reused until a manifest or lockfile changes, and scaffold computes the file lists instead of a hand-maintained `COPY` per package ([Docker guide](https://moonrepo.dev/docs/guides/docker)). The guide also requires adding `.moon/cache` to `.dockerignore`. It recommends excluding `.git`, which disables some features such as caching. It sets `MOON_TOOLCHAIN_FORCE_GLOBALS=true` on Alpine, because Node has no prebuilt Alpine binaries. `moon docker file <project>` generates this four-stage, production-oriented file. In v2 you should set `docker.file.image`, because otherwise moon uses the first toolchain image it finds, or `scratch` ([docker file](https://moonrepo.dev/docs/commands/docker/file)). The guide's prose still says `.moon/docker/workspace` where v2 uses `configs`. **[Inference]** Pin the base image and moon version instead of copying the guide's `node:latest` and unpinned `npm install -g @moonrepo/cli`. Inside an image with `.git` excluded, Docker layer caching does the real work, not moon's task cache. The docs do not cover BuildKit cache mounts or using the remote cache inside `docker build`.

```dockerfile
FROM node:24.11.0-trixie-slim AS base
WORKDIR /app
RUN npm install -g @moonrepo/cli@2.6.2

FROM base AS skeleton
COPY . .
RUN moon docker scaffold web

FROM base AS build
COPY --from=skeleton /app/.moon/docker/configs .
RUN moon docker setup
COPY --from=skeleton /app/.moon/docker/sources .
RUN moon run web:build && moon docker prune
```

Templates for code generation live in directories listed under `generator.templates` (default `./templates`). A location can be a local path, a glob, `git://…#ref` or `npm://…#version`. Each template has a `template.yml` with `title`, `description` and typed `variables`, plus files rendered with Tera. `.tera` is the preferred extension; `.raw` files skip rendering, and paths containing `partial` are never emitted. Run one with `moon generate <id> --to <dest> [--defaults] -- --var value` ([Codegen guide](https://moonrepo.dev/docs/guides/codegen)). **[Inference]** Pin git and npm template sources to a tag so the generated output is reproducible.

**[Doc]** The debug-task guide sets out a fixed sequence for when a task misses the cache or runs unexpectedly. First, read the resolved task with `moon task <target> --json` and check `.moon/cache/states/<project>/snapshot.json`: tokens resolved, inputs expanded into `inputFiles`/`inputGlobs`/`inputVars`, and `inherited.layers` as expected. Second, rerun with `MOON_DEBUG_PROCESS_ENV=true MOON_DEBUG_PROCESS_INPUT=true moon run <target> --log trace --force`. Third, inspect the 64-character hash with `moon hash <hash>`, or diff two runs with `moon hash <a> <b>` ([Debug task guide](https://moonrepo.dev/docs/guides/debug-task)). `--log debug` "includes the majority of useful diagnostic information". `--dump` produces a Perfetto or `chrome://tracing` profile, and `MOON_DEBUG_REMOTE` shows remote-cache connection errors ([Commands overview](https://moonrepo.dev/docs/commands/overview)). `moon query affected` and `moon query changed-files` explain affectedness, and `moon action-graph` shows the plan. With the daemon on (v2.5+), archive and hydration failures go to `.moon/cache/daemon/` logs, not the CLI. **[Inference]** If a task is unexpectedly skipped in CI, check three things in order: `runInCI`, base/head detection (fetch depth, `MOON_BASE`), and v2's removal of graph relations from `--affected`. `--output-style hash` (v2.6) on a local run and a CI run is the quickest way to spot drift between them.

## JS/TS gets first-class plugins; Python works but stays unstable

The v2 JavaScript stack is split into **three top-level blocks**: `javascript` for shared settings, a runtime (`node`, `bun` or `deno`) and a package manager (`npm`, `pnpm`, `yarn`). `typescript` and the runtimes require `javascript`, and npm, pnpm and yarn require `node` ([toolchains config](https://moonrepo.dev/docs/config/toolchain)). **[Doc]** Do not set `toolchains` on tasks. A bare `node` no longer brings in JavaScript or the package manager. A maintainer answered a user who lost `node_modules/.bin` from `PATH`, and with it vitest, tsc and tsx: "I suggest not setting `toolchains` for a task" ([Migrate to v2](https://moonrepo.dev/docs/migrate/2.0); [Issue #2391](https://github.com/moonrepo/moon/issues/2391)). The one documented exception is Bun. moon defaults an ambiguous `package.json` to Node, so set `bun` at the project or task level when running a `node_modules` binary ([Bun handbook](https://github.com/moonrepo/moon/blob/master/website/docs/guides/javascript/bun-handbook.mdx)).

The plugin source documents the `javascript` defaults that the rendered docs no longer list. `packageManager` defaults to **`npm`**. `syncPackageManagerField: true` writes the pinned version into the root `package.json` `packageManager` field. `syncProjectWorkspaceDependencies: true` writes moon's project dependencies into each `package.json`. `dependencyVersionFormat` defaults to `workspace` (`workspace:*`). `dedupeOnLockfileChange` is `true`. `rootPackageDependenciesOnly` is `false`, and setting it `true` enforces a one-version policy. `inferTasksFromScripts` is `false` ([javascript config.rs](https://github.com/moonrepo/plugins/blob/master/toolchains/javascript/src/config.rs)). A maintainer explains the `packageManager` sync this way: it "ensures other tools that rely on that field are also using the same version that the repo expects" ([Issue #1533](https://github.com/moonrepo/moon/issues/1533)). **[Doc]** The Node handbook puts universal tools (ESLint, Prettier, TypeScript, Jest) in the root `devDependencies` with their config at the root, and framework dependencies in each project. It warns to "proceed with caution" without package-manager workspaces, and says apps may depend on packages but never the reverse ([Node.js handbook](https://moonrepo.dev/docs/guides/javascript/node-handbook)). **[Inference]** Set `dependencyVersionFormat: 'workspace-caret'` to match the handbook's `workspace:^` examples. The FAQ says a double install means a project is missing from, or wrongly listed in, `pnpm-workspace.yaml` or `workspaces` ([FAQ](https://github.com/moonrepo/moon/blob/master/website/docs/faq.mdx)).

**[Doc]** Do not rely on inferred `package.json` scripts beyond a migration. The FAQ encourages "everyone to define tasks in a `moon.*` file". The migration partial lists what goes wrong with inferred scripts. Inputs default to `**/*`. Changes to root config files are not detected. Outputs are empty, so builds never hydrate. Tasks run in CI unless a name heuristic catches them ([migrate scripts partial](https://github.com/moonrepo/moon/blob/master/website/docs/__partials__/migrate/node/scripts.mdx)). The migration path in v2 is as follows. `from-package-json` is gone. The `migrate-turborepo` extension converts `turbo.json`. The experimental `migrate-nx` extension maps `targetDefaults`, `namedInputs` and `project.json`, and its docs say "some manual patching will most likely be required! We suggest testing each converted task 1-by-1" ([Extensions guide](https://github.com/moonrepo/moon/blob/master/website/docs/guides/extensions.mdx)). The docs conflict on whether these extensions are enabled by default. The migration guide says they "must be explicitly enabled" (`migrate-turborepo: {}`), while the extensions guide calls built-ins "configured and enabled by default". **[Inference]** Declaring them explicitly is harmless and works under either reading.

**[Doc]** For TypeScript, moon recommends project references "as it ensures that only affected projects are built, and not the entire repository". The layout has three parts. The root `tsconfig.json` holds only `references`. A root `tsconfig.options.json` holds the shared compiler options. Each project's `tsconfig.json` extends those options. Packages use `emitDeclarationOnly` and apps use `noEmit`. Prefer `include` to `exclude`. Gitignore `lib/` and `*.tsbuildinfo`. Prefix path aliases with `:` instead of `@` so they cannot collide with npm scopes ([TS project references guide](https://moonrepo.dev/docs/guides/javascript/typescript-project-refs)). **[Default]** `syncProjectReferences` and `createMissingConfig` are on. `syncProjectReferencesToPaths`, `includeProjectReferenceSources`, `includeSharedTypes`, `routeOutDirToCache` and `pruneProjectReferences` (v2.1) are off ([typescript config.rs](https://github.com/moonrepo/plugins/blob/master/toolchains/typescript/src/config.rs)). Plugin 1.1.2 started writing references with a leading `./`, "in preparation for the removal of `baseUrl` in TypeScript v7" ([typescript CHANGELOG](https://github.com/moonrepo/plugins/blob/master/toolchains/typescript/CHANGELOG.md)). **[Doc]** moon rewrites `package.json` and `tsconfig.json` with no switch to turn the formatting off, but it respects `.editorconfig`, so the FAQ says to commit one. **[Inference]** Turn `syncProjectReferences` off for repos without project references (bundler-only `noEmit` apps, Deno). Leave `routeOutDirToCache` off whenever publishing or `exports` paths depend on `outDir`. The docs have no "when to disable" section. They also contradict themselves on the shared config name: the prose says `tsconfig.workspaces.json` while the snippet uses `tsconfig-moon/tsconfig.projects.json`.

```yaml
# .moon/toolchains.yml (JS/TS portion)
javascript:
  packageManager: 'pnpm'
  dependencyVersionFormat: 'workspace-caret'
  inferTasksFromScripts: false
node: {}
pnpm: {}
typescript:
  syncProjectReferences: true
  pruneProjectReferences: false
  routeOutDirToCache: false
```

Python remains **`unstable_python`**, paired with one of `unstable_pip`, `unstable_uv` or `unstable_poetry` ([Migrate to v2](https://moonrepo.dev/docs/migrate/2.0)). **[Default]** `packageManager` defaults to `pip`, with `uv`, `uv-pip` (v2.3) and `poetry` (v2.4) as the alternatives, and `venvName` defaults to `.venv`. A `venvLocation` enum exists in the plugin source but is commented out, so you cannot configure it ([python config.rs](https://github.com/moonrepo/plugins/blob/master/toolchains/python/src/config.rs)). `unstable_uv` takes `syncArgs` and `venvArgs`. In `uv-pip` mode, install args come from `unstable_pip` while sync and venv args come from `unstable_uv` ([moon v2.3 blog](https://moonrepo.dev/blog/moon-v2.3)). The plugin changelog records the following behaviour. uv workspaces infer project dependencies from `[tool.uv.sources] workspace = true`. Production installs use `uv sync --no-dev`. An existing venv is not recreated unless you pass `--clear`. Package names are normalised to PEP 503 ([python CHANGELOG](https://github.com/moonrepo/plugins/blob/master/toolchains/python/CHANGELOG.md)). The docs do **not** recommend uv over pip; the blog only says uv is "gaining traction for their speed". There is no rendered Python handbook, so the rules for where the venv goes are undocumented. One live hazard: on a cold workspace, parallel `moon ci` can race on a shared root `.venv`, and concurrent `uv venv` and `uv sync` fail with "A virtual environment already exists". This was reproduced on v2.5.0 and was still open when the notes were written ([Issue #2653](https://github.com/moonrepo/moon/issues/2653)). There is also a source conflict. The setup partials use `unstable_python`, but a v2.1 blog example uses a bare `python:` key ([moon v2.1 blog](https://moonrepo.dev/blog/moon-v2.1)). **[Inference]** Use the `unstable_` keys. Pin Python and uv in `.prototools`. On a uv workspace, run `moon setup` before a parallel CI fan-out so the shared venv already exists. Give Python tasks the same explicit inputs as JS tasks: sources, tests, `pyproject.toml` and each tool's config file. The migration example's Flask tasks (black, pylint, mypy) do this ([Python migrate partial](https://github.com/moonrepo/moon/blob/master/website/docs/__partials__/migrate/python/migrate.mdx)).

```yaml
# .moon/toolchains.yml (Python portion)
unstable_python:
  packageManager: 'uv'
  venvName: '.venv'
unstable_uv:
  syncArgs: ['--locked']
```

```yaml
# .moon/tasks/python.yml
inheritedBy:
  toolchains: ['unstable_python']
fileGroups:
  sources: ['src/**/*.py']
  tests: ['tests/**/*.py']
tasks:
  lint:
    command: 'ruff'
    args: ['check', '.']
    inputs: ['@group(sources)', '@group(tests)', 'pyproject.toml', '/ruff.toml']
  typecheck:
    command: 'mypy'
    args: ['.']
    inputs: ['@group(sources)', 'pyproject.toml']
  test:
    command: 'pytest'
    inputs: ['@group(sources)', '@group(tests)', 'pyproject.toml']
```

Two parts of this Python example are this report's own choices, not doc examples. The `inheritedBy` toolchain ID and the ruff and pytest commands are illustrative: the docs' only Python task example uses black, pylint, mypy and unittest. Test that `inheritedBy.toolchains` matches `unstable_python` on the installed version before standardising on it.

### Doc inconsistencies to verify before enforcing

| Topic | Source A | Source B | Working assumption |
|---|---|---|---|
| Task with no inputs | Reference: `**/*` of the project | Create-task guide: "always runs" | Always declare inputs |
| `shell` default | Migration: `true` | Project reference: `true` only for system toolchain/Windows | Use `script` for shell syntax; test locally |
| `inheritedBy` keys | Concept page/blog: six conditions | Tasks reference: three | Use `toolchains`/`stacks`/`layers` until verified |
| File-group merge | Concept page: override | Migration/reference: merge (v2) | Merge; `mergeStrategies.fileGroups: replace` to override |
| Built-in extensions | Migration: must enable | Extensions guide: enabled by default | Declare `{}` explicitly |
| Hook sync command | Hooks guide: `moon sync hooks` | Command index: `moon sync vcs-hooks` | Use `vcs-hooks` |
| Hook script extension | Hooks guide: `.sh` | Migration: no `.sh` in v2 | No extension |
| Docker skeleton dir | Docker guide: `.moon/docker/workspace` | Migration: `.moon/docker/configs` | `configs` |
| CI manual cache paths | CI guide: `{hashes,outputs}` | Cache concept: `blobs/`, `manifests/` (v2.6) | Use remote cache |
| setup-toolchain cache key | README: `.moon/toolchain.yml` | v2: `.moon/toolchains.yml` | Bump `cache-version` on toolchain edits |
| Python key | Partials: `unstable_python` | v2.1 blog: `python` | `unstable_python` |
| TS shared config name | Prose: `tsconfig.workspaces.json` | Snippet: `tsconfig.projects.json` | Name it explicitly in your own config |
| Version precedence | `toolchains.<id>.version` | `.prototools` | Set versions in one place only |

Sources for the table are cited in the sections above. The last column is this report's inference, not doc guidance. The "Bump `cache-version`" entry is an inference from the `setup-toolchain` README's `cache-version` input ([setup-toolchain](https://github.com/moonrepo/setup-toolchain)).

## Conclusion

The common thread is that a moon v2 standard is mainly a standard for **hash hygiene**. Explicit inputs, declared outputs, pinned versions, detected toolchains and side-effect tasks kept out of the cache all serve to make a task's hash change exactly when its result would. Remote caching, sharding and Docker layer reuse then pay off automatically. The rules that are easiest to enforce mechanically are also the ones with the most value: ban v1 keys (the rename table), require `inputs` on every task and `outputs` on every task that builds, ban task-level `toolchains` outside Bun, require `layer` on every project, and require `defaultBranch: main` and `fetch-depth: 0`. A schema check or a short lint script can cover all of them.

The less obvious implication is how much the docs themselves need managing. moon ships a minor release roughly every six weeks. The rendered docs lag the plugin source, and the official examples repo is still on v1. Thirteen documented contradictions remain open. The standard should therefore pin a moon minor, cite the plugin `config.rs` files as the source of defaults, and record each item from the inconsistency table as a "verified on vX.Y" assertion. For Python the advice is narrower: adopt moon for orchestration, but treat the `unstable_` toolchain as provisional, set the venv up before running work in parallel, and expect key names to change when it stabilises.
