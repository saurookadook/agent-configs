# moonrepo (moon): Workspace and Toolchain Configuration Best Practices

Scope: workspace-wide configuration only (`.moon/workspace.*`, `.moon/toolchains.*`, `.moon/extensions.*`, proto / `.prototools`, VCS, hasher, constraints, pipeline, notifier, telemetry, schemas, env vars). Project/task config, caching/CI/Docker, and language guides are out of scope. Research date: 2026-10-18. Primary source: moonrepo.dev/docs (which now documents v2; "moon v1 docs are frozen").

## What is the current major version of moon (October 2026), and what changed between v1 and v2?

### Takeaway
moon v2 is current. v2.0 ("Phobos") shipped on 2026-02-18, and the latest release is v2.6.2 (2026-10-14). v2 renames `.moon/toolchain.*` to `.moon/toolchains.*`, moves `extensions` into its own `.moon/extensions.*` file, renames several workspace keys (`runner` became `pipeline`, `vcs.manager` became `vcs.client`, `vcs.syncHooks` became `vcs.sync`, `enforceProjectTypeRelationships` became `enforceLayerRelationships`, and so on), and adds JSON, JSONC, TOML, and HCL config formats. Any v1-era guidance using the old names is outdated.

### Cited Findings
- moon v2.0, codenamed "Phobos", was released on February 18, 2026 — [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
- Latest release is 2.6.2 (14 Oct 2026). Earlier ones: 2.6.1 (07 Oct), 2.6.0 (05 Oct), 2.5.x (Aug–Sep), 2.5.0 (14 Aug) — [GitHub releases](https://github.com/moonrepo/moon/releases)
- v2.5 (2026-08-14) turned on the `asyncGraphBuilding`, `asyncAffectedTracking`, and `nativeFileHashing` experiments by default. It also let project globs match files, not only folders — [moon v2.5 blog](https://moonrepo.dev/blog/moon-v2.5)
- The current docs cover v2, and the v1 docs are frozen — [toolchains config](https://moonrepo.dev/docs/config/toolchain)
- **Changes to config files in v2** — [Migrate to v2](https://moonrepo.dev/docs/migrate/2.0):
  - `.moon/toolchain.*` is now `.moon/toolchains.*` (plural), because several toolchains can be configured.
  - `extensions` moved out of `.moon/workspace.*` into a standalone `.moon/extensions.*` file, and was flattened.
  - `.moon/tasks.yml` was removed. Tasks inherited by every project go in `.moon/tasks/all.yml`.
  - `.moon/docker/workspace` is now `.moon/docker/configs`.
  - Git hooks are written to `.moon/hooks`, and Git is pointed there with `core.hooksPath`. In v1 they went to `.git/hooks`. Bash hook scripts no longer have a `.sh` extension.
- **Workspace keys renamed in v2** — [Migrate to v2](https://moonrepo.dev/docs/migrate/2.0):

  | v1 key | v2 key |
  |---|---|
  | `runner` | `pipeline` |
  | `vcs.manager` | `vcs.client` |
  | `vcs.syncHooks` | `vcs.sync` |
  | `constraints.enforceProjectTypeRelationships` | `constraints.enforceLayerRelationships` |
  | `unstable_remote` | `remote` |
  | `codeowners.syncOnRun` | `codeowners.sync` |
  | `codeowners.orderBy: project-name` | `codeowners.orderBy: project-id` |
  | `docker.prune.installToolchainDeps` | `docker.prune.installToolchainDependencies` |
  | `docker.scaffold.include` | `docker.scaffold.configsPhaseGlobs` |

- **Workspace keys removed in v2:** `docker.scaffold.copyToolchainFiles`, `experiments.*` (the v1 experiments), `hasher.batchSize`, `pipeline.archivableTargets`. The `experiments.gitV2` setting should be removed, because Git v2 is now the default — [Migrate to v2](https://moonrepo.dev/docs/migrate/2.0); [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
  - Note: v2 brought back an `experiments` block with new entries (`asyncAffectedTracking`, `asyncGraphBuilding`, `casOutputsCache`, `explicitTaskOutputStyle`, `nativeFileHashing`) — [workspace config](https://moonrepo.dev/docs/config/workspace)
- **Toolchain changes in v2:**
  - The legacy "platform" system was replaced by WASM-plugin toolchains — [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
  - Every toolchain except Python is stabilized, so drop the `unstable_` prefix from those. Python keeps it (`unstable_python`, `unstable_pip`, `unstable_uv`) — [Migrate to v2](https://moonrepo.dev/docs/migrate/2.0)
  - `bun`, `deno`, and `node` now require a `javascript` toolchain. Shared settings moved there (for example `node.packageManager` became `javascript.packageManager`, and `node.rootPackageOnly` became `javascript.rootPackageDependenciesOnly`).
  - Package-manager blocks are now top-level: `node.pnpm` became `pnpm`, `node.yarn` became `yarn`.
  - `node.binExecArgs` became `node.executeArgs`.
  - Removed: `node.addEnginesConstraint`, `node.packagesRoot`, `bun.packagesRoot`, `deno.depsFile`, `deno.lockfile`, `python.rootVenvOnly`.
  - Source for the last four points: [Migrate to v2](https://moonrepo.dev/docs/migrate/2.0)
- **Semantic changes with workspace-wide effect:**
  - `--affected` no longer includes graph relations by default. Use `--include-relations`/`-g` to restore them.
  - `runInCI` is respected by `moon ci`, `check`, `run`, and `exec`.
  - Tasks run in a shell by default (`unixShell: bash`, `windowsShell: pwsh`).
  - `options.inferInputs` now defaults to `false`.
  - Global task configs are deep-merged instead of shallow-merged.
  - Source for these points: [Migrate to v2](https://moonrepo.dev/docs/migrate/2.0)
- **Migration tooling:** run `moon migrate v2` to automate many changes, then review the result. `moon upgrade` does not work from a v1 install because the distribution format changed. Reinstall instead, for example with `proto install moon 2.0.0` — [Migrate to v2](https://moonrepo.dev/docs/migrate/2.0); [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
- New v2 workspace settings — [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0); [workspace config](https://moonrepo.dev/docs/config/workspace):
  - `defaultProject`: the project commands use when none is given.
  - `projects.globFormat: 'source-path'`: uses the workspace-relative path as the project ID.
  - Workspace `docker` settings now act as defaults that per-project `moon.*` overrides.

### Inferences
- Any blog post, template, or LLM-written config that uses `.moon/toolchain.yml`, `runner:`, `vcs.manager`, `vcs.syncHooks`, `node.packageManager`, or `extensions:` inside workspace.yml is v1-era. Treat it as outdated for new repos.
- moon 2.x moves quickly: there were six minor releases between Feb and Oct 2026, and feature flags are annotated per minor version. Pin the moon version (see the toolchain question) and check the version annotations in the docs.

### Gaps
- I found no official statement of v1's end-of-support date, only that the v1 docs are "frozen".

## How should projects be declared or discovered (globs vs. explicit map)?

### Takeaway
`projects` is required and accepts three forms: a map of name to path, a list of globs, or an object with both `globs` and `sources`. The docs list the options and their trade-offs but recommend none of them outright. Globs avoid hand-curating the list. A map gives explicit names and paths.

### Cited Findings
- `projects` is required in `.moon/workspace.*`. A project is not visible to moon until it is mapped there — [workspace config](https://moonrepo.dev/docs/config/workspace); [Create a project](https://moonrepo.dev/docs/create-project)
- **Map form:** keys are project names and values are paths relative to the workspace root — [Create a project](https://moonrepo.dev/docs/create-project)
  ```yaml
  # .moon/workspace.yml
  projects:
    client: 'apps/client'
    server: 'apps/server'
  ```
- **Glob form:** a list of patterns such as `'apps/*'` — [workspace config](https://moonrepo.dev/docs/config/workspace)
  - A matched folder becomes the project root. A matched file makes its parent folder the root.
  - The project name comes from the folder name unless `id` is set in `moon.*`.
  - Name collisions log a warning and the project is skipped.
- The only stated reason to use globs is to avoid manually curating the project list — [Create a project](https://moonrepo.dev/docs/create-project)
- **Mixed form:** use the `globs:` and `sources:` sub-keys together. `globFormat: 'source-path'` (new in v2) makes the workspace-relative path the project ID — [workspace config](https://moonrepo.dev/docs/config/workspace); [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
- **v2.5+:** globs can match any file type, for example `apps/*/package.json` or `src/**/*.csproj`, and the parent folder becomes the project. Earlier versions matched only `moon.*` files. This does not apply at the workspace root: a root-level project counts only if a moon config file matches — [moon v2.5 blog](https://moonrepo.dev/blog/moon-v2.5); [workspace config](https://moonrepo.dev/docs/config/workspace)
- `projects` is not merged when using `extends`. Other blocks merge recursively — [workspace config](https://moonrepo.dev/docs/config/workspace)
- The docs warn: "Projects that depend on each other and form a cycle must be avoided!" — [workspace config](https://moonrepo.dev/docs/config/workspace)
- `moon init` "should typically be ran at the root, but can be nested within a directory". `moon init --minimal` creates minimal configs for prototyping — [Setup workspace](https://moonrepo.dev/docs/setup-workspace)
- The workspace root is marked by `.moon/` or, alternatively, `.config/moon/` (the root is then the directory containing `.config`) — [Setup workspace](https://moonrepo.dev/docs/setup-workspace); [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)

### Inferences
- Globs plus `globFormat: 'source-path'` avoids folder-name collisions in large repos, where two `utils/` folders would otherwise silently drop a project. A map, or globs plus `sources`, gives stable, explicit IDs for the few projects whose folder names are poor IDs.
- Because `projects` does not merge under `extends`, a shared base workspace config cannot supply project lists.

### Gaps
- The current docs make no explicit "we recommend globs" or "we recommend a map" statement. I did not verify whether the v1 docs made one.

## How should toolchain versions be pinned (proto, `.prototools`, toolchain config), and why?

### Takeaway
Pin an explicit `version` for every toolchain. You can put it directly in `.moon/toolchains.*`, or in `.prototools`, which moon v2 reads by default through `versionFromPrototools: true`. moon then uses proto to auto-install identical tool versions on every machine. Prefer full semver versions. Partial versions are acceptable but should keep major.minor. Avoid aliases such as `latest` and `stable`. Also pin proto itself with `proto.version`.

### Cited Findings
- Defining `version` per toolchain enables automatic installation ("tier 3"). On first use moon downloads and installs the tool and sets up `PATH`. Without a `version`, binaries "must exist on `PATH`" — [Setup toolchain](https://moonrepo.dev/docs/setup-toolchain)
- Pinning addresses these problems: developers on different language versions, drift between machines, tools installed by different version managers, binaries missing from `PATH`, and shell-profile configuration — [Setup toolchain](https://moonrepo.dev/docs/setup-toolchain)
- Managing versions in the toolchain "ensures a deterministic environment across any machine". Keeping versions in `.prototools` "pairs well with" Renovate for automatic updates — [toolchains config](https://moonrepo.dev/docs/config/toolchain)
- Example from the docs — [Setup toolchain](https://moonrepo.dev/docs/setup-toolchain):
  ```yaml
  # .moon/toolchains.yml
  javascript:
    packageManager: 'yarn'
  node:
    version: '20.0.0'
  yarn:
    version: '4.0.0'
  ```
  - Each enabled language needs a block, even an empty one (`node: {}`).
  - `moon toolchain add <toolchain>` scaffolds a block.
- **Version format guidance** — [Toolchain concept](https://moonrepo.dev/docs/concepts/toolchain):
  - Full versions (`1.2.3`) "are preferred for consistency".
  - Partial versions (`1.2`, `^1.2`, `~1`) are allowed. Keeping major and minor reduces drift.
  - Aliases (`latest`, `stable`) are discouraged because they can change at any time.
  - For partial versions, moon first checks versions already installed in `~/.proto/tools/<tool>`. If none matches, it downloads the latest version that does.
- **`versionFromPrototools` (v2.0.0+, default `true`):** inherits the version from the matching identifier in `.prototools`. A string value maps to a different proto ID, for example `node: { versionFromPrototools: 'nodejs' }` with `nodejs = "~24"`. `false` disables inheritance — [toolchains config](https://moonrepo.dev/docs/config/toolchain)
- **Pinning proto itself (v1.39.0+):** set it in `.moon/toolchains.yml`. If proto or that version is missing, it is installed automatically when a task runs — [toolchains config](https://moonrepo.dev/docs/config/toolchain)
  ```yaml
  proto:
    version: '0.62.2'
  ```
- **`moon` block (v1.29.0+):** `manifestUrl` and `downloadUrl` let you self-host the moon version manifest and binaries. The default download location is GitHub releases — [toolchains config](https://moonrepo.dev/docs/config/toolchain)
- **Shared per-toolchain settings:**
  - `plugin`: a `file://`, `https://`, or `github://` WASM locator that can override a built-in plugin.
  - `installDependencies` (v2.1.0, default `true`).
  - `inheritAliases` (v2.1.0, default `true`).
  - Source: [toolchains config](https://moonrepo.dev/docs/config/toolchain)
- **Toolchain identifiers (v2):** `go`, `javascript`, `bun`, `deno`, `node`, `npm`, `pnpm`, `yarn`, `typescript`, `unstable_nub` (v2.5), `rust`, `unstable_python`, `unstable_pip`, `unstable_poetry`, `unstable_uv`, `unstable_ruby` — [toolchains config](https://moonrepo.dev/docs/config/toolchain)
  - `bun`, `deno`, and `node` require `javascript`.
  - `npm`, `pnpm`, and `yarn` require `node`.
- **How moon uses proto:**
  - moon reuses tools in `~/.proto` and installs missing ones.
  - It prepends toolchain executables to `PATH` for each task.
  - v2.6+ can also activate a toolchain's environment (for example `JAVA_HOME`), without ever overriding a task's `env`.
  - Source: [Toolchain concept](https://moonrepo.dev/docs/concepts/toolchain)
- **Overrides:**
  - `MOON_<TOOLCHAIN>_VERSION` (for example `MOON_NODE_VERSION`) overrides a toolchain's version.
  - `MOON_TOOLCHAIN_FORCE_GLOBALS=true`, or a list such as `node,yarn`, makes moon use binaries already on `PATH`. The docs describe this as suited to CI and Docker, and it is set automatically in Docker.
  - Source: [Env vars](https://moonrepo.dev/docs/env-vars); [Toolchain concept](https://moonrepo.dev/docs/concepts/toolchain)
- `extends` in `.moon/toolchains.*` accepts an HTTPS URL or a relative path to a YAML document. Local values take precedence — [toolchains config](https://moonrepo.dev/docs/config/toolchain)
- **`.prototools` (TOML):**
  - Versions can be full, partial, ranges, or aliases (`node = "16.16.0"`, `go = "~1.20"`).
  - `proto = "0.38.0"` pins proto itself (v0.39+).
  - Per-tool configuration goes under `[tools.<id>]`.
  - Recommended placement: project-specific versions in the `local` (repo) file, defaults in `global`, shared developer preferences in `user` (`~/.prototools`).
  - Source: [proto config](https://moonrepo.dev/docs/proto/config)
- **proto trust model (v0.63+):** security-sensitive `.prototools` settings are ignored until the directory is trusted with `proto trust`, `PROTO_TRUSTED_PATHS`, or CI detection. These include `[env]`, `[shell]`, plugins, most `[tools.*]` entries, the proto pin, and most `[settings]`. Built-in tool pins always apply. The docs warn against setting `CI` in shell profiles — [proto config](https://moonrepo.dev/docs/proto/config)
- **proto `[settings]`:**
  - `auto-install` defaults to `false`.
  - `pin-latest` records the resolved "latest" version.
  - `unstable-lockfile` creates `.protolock`.
  - `telemetry` defaults to `true`.
  - Source: [proto config](https://moonrepo.dev/docs/proto/config)

### Inferences
- A sound v2 pattern is a single source of truth in a committed `.prototools` (full versions, Renovate-friendly). Leave `versionFromPrototools` at its default, keep `.moon/toolchains.yml` for behavior settings only, and pin `proto.version` there.
- Because proto ignores a proto pin in an untrusted `.prototools`, pinning proto through moon's `proto.version` is the more reliable route in a fresh clone. This is my inference from the trust rules.
- v1 used per-toolchain `version` fields in `.moon/toolchain.yml`, which still work in v2. `versionFromPrototools` is v2-only.

### Gaps
- The docs give no explicit precedence order when both `toolchains.<id>.version` and `.prototools` set a version. Only the env-var override (`MOON_<TOOLCHAIN>_VERSION`) is documented. Verify this before relying on it.
- The docs don't say how to pin moon itself in the repo. `proto install moon` is documented, and `.prototools` can presumably hold `moon = "x.y.z"`, but no moon page confirms this.

## What VCS settings are recommended (default branch, remote candidates, hooks, sync)?

### Takeaway
Set `vcs.defaultBranch` explicitly: it defaults to `master`, so set it to `main` if that is your branch. Leave `client: git` and the default remotes unless you use something else. Define hooks under `vcs.hooks`, and enable them either for everyone with `vcs.sync: true`, which the docs flag as sensitive, or per developer with `moon sync hooks`.

### Cited Findings
- `vcs.client` defaults to `'git'`, the only client for now. Its v1 name was `vcs.manager` — [workspace config](https://moonrepo.dev/docs/config/workspace); [Migrate to v2](https://moonrepo.dev/docs/migrate/2.0)
- `vcs.defaultBranch` defaults to `master`. Use `main` if that is your branch. You can skip the block when the defaults fit — [workspace config](https://moonrepo.dev/docs/config/workspace); [Setup workspace](https://moonrepo.dev/docs/setup-workspace)
  ```yaml
  vcs:
    client: 'git'
    defaultBranch: 'main'
  ```
- `vcs.remoteCandidates` (git only) defaults to `['origin', 'upstream']` — [workspace config](https://moonrepo.dev/docs/config/workspace)
- `vcs.provider` (v1.8+) can be `github` (default), `gitlab`, `bitbucket`, or `other` — [workspace config](https://moonrepo.dev/docs/config/workspace)
- `MOON_VCS_REPO_SLUG` overrides the detected `owner/repo` slug — [Env vars](https://moonrepo.dev/docs/env-vars)
- **`vcs.hooks` (v1.9+):** maps hook names to lists of commands, which run as written with no interpolation. Hook arguments are available as `$ARG1…` — [VCS hooks guide](https://moonrepo.dev/docs/guides/vcs-hooks)
  ```yaml
  vcs:
    hooks:
      pre-commit:
        - 'moon run :lint :format --affected --status=staged'
    sync: true
  ```
  - The recommended pre-commit command is `moon run :lint :format --affected --status=staged`. Enable the `affectedFiles` task option so tasks run only on changed files — [VCS hooks guide](https://moonrepo.dev/docs/guides/vcs-hooks)
- **`vcs.sync`:**
  - Defaults to `false`. It was named `vcs.syncHooks` in v1.
  - When `true`, hooks are generated and linked whenever a task runs.
  - It is "considered a sensitive action" because it runs arbitrary code on teammates' machines, and it affects "_all_ users of the repository".
  - The alternative is for each developer to run `moon sync hooks`.
  - To disable, set `sync: false` and run `moon sync hooks --clean` on each machine.
  - Source: [VCS hooks guide](https://moonrepo.dev/docs/guides/vcs-hooks); [workspace config](https://moonrepo.dev/docs/config/workspace)
- `vcs.hookFormat` (v1.29+) can be `native` (default) or `bash` — [workspace config](https://moonrepo.dev/docs/config/workspace)
- **v2 hook location and caveats:**
  - Hooks are generated in `.moon/hooks` (or `.config/moon/hooks`), and moon sets git `core.hooksPath`. You can commit or ignore the folder.
  - Scripts are Bash on Unix and PowerShell on Windows.
  - Commands run from the repository root, not moon's workspace root.
  - The `moon` binary must be on `PATH` (installed globally), or be called by relative path such as `./node_modules/@moonrepo/cli/moon`.
  - Remove old hooks from `.git/hooks` manually after migrating from v1.
  - Source: [VCS hooks guide](https://moonrepo.dev/docs/guides/vcs-hooks); [workspace config](https://moonrepo.dev/docs/config/workspace); [Migrate to v2](https://moonrepo.dev/docs/migrate/2.0)

### Inferences
- A wrong `defaultBranch` breaks affected and diff calculations against the base, so setting it explicitly is cheap insurance. This is inferred: the docs say moon uses VCS for diffing and revision comparison ([Setup workspace](https://moonrepo.dev/docs/setup-workspace)).
- Setting `core.hooksPath` replaces any other hook manager (such as Husky) that relies on the same git setting. This is inferred from the hooks guide, which does not discuss coexistence.

### Gaps
- No doc discusses running hooks in CI or skipping them there.

## Which workspace-level options affect correctness or performance (hasher, constraints, telemetry, notifier, pipeline, experiments)?

### Takeaway
The defaults favor correctness: `hasher.optimization: accuracy`, `walkStrategy: vcs`, and `warnOnMissingInputs: true`. Turn on `constraints.enforceLayerRelationships` and `tagRelationships` to enforce architecture boundaries. The `pipeline` options (named `runner` in v1) control cache lifetime, auto-clean, dependency installs, and sync. Leave `notifier.webhookAcknowledge` off unless needed, because it slows the pipeline. Since v2.5 the async graph, async affected tracking, and native file hashing experiments are on by default.

### Cited Findings
- **`hasher`** — [workspace config](https://moonrepo.dev/docs/config/workspace):
  - `optimization`: `accuracy` (default, uses lockfile-resolved versions) or `performance` (uses manifest ranges).
  - `walkStrategy`: `vcs` (default) or `glob`.
  - `warnOnMissingInputs` defaults to `true`.
  - `ignorePatterns` excludes globs from input hashing.
  - `ignoreMissingPatterns` defaults to `**/.env` and `**/.env.*`. The docs suggest `**/` prefixes.
  - `hasher.batchSize` was removed in v2 ([Migrate to v2](https://moonrepo.dev/docs/migrate/2.0)).
- **`constraints`:**
  - `enforceLayerRelationships` (v1 name: `enforceProjectTypeRelationships`) enforces allowed dependencies by project `layer` and `stack`.
  - Layers are `automation`, `application`, `tool`, `library`, `scaffolding`, `configuration`, and `unknown`. Unknown or unconfigured layers are ignored.
  - `tagRelationships` maps a tag to tags its dependencies must have, for example `next: ['react']`.
  - Source: [workspace config](https://moonrepo.dev/docs/config/workspace); [Migrate to v2](https://moonrepo.dev/docs/migrate/2.0)
  ```yaml
  constraints:
    enforceLayerRelationships: true
    tagRelationships:
      next: ['react']
  ```
- **`pipeline`** (v1 name: `runner`) — [workspace config](https://moonrepo.dev/docs/config/workspace):
  - `autoCleanCache` defaults to `true`, and `cacheLifetime` defaults to `"7 days"`.
  - `installDependencies` defaults to `true`, or takes a list of toolchain IDs.
  - `syncProjects` defaults to `true`, or takes a list of project IDs. `syncWorkspace` defaults to `true`.
  - `killProcessThreshold` defaults to `2000` ms.
  - `inheritColorsForPipedTasks` defaults to `true`, and `logRunningCommand` defaults to `false`.
- **`notifier`:**
  - `terminalNotifications` (v1.38+) can be `always`, `failure`, `success`, or `task-failure`.
  - `webhookUrl` takes an HTTPS endpoint.
  - `webhookAcknowledge` defaults to `false`. The docs warn that enabling it "will slow down your pipeline".
  - Source: [workspace config](https://moonrepo.dev/docs/config/workspace)
- **`telemetry`** defaults to `true`. It checks for new moon versions and sends anonymous usage data. Override with `MOON_TELEMETRY` — [workspace config](https://moonrepo.dev/docs/config/workspace); [Env vars](https://moonrepo.dev/docs/env-vars)
  - OpenTelemetry export (v2.5) is controlled by CLI flags and env vars (`--otel`/`MOON_OTEL`, `MOON_OTEL_LOGS`, `MOON_OTEL_SERVICE_NAME`, and the standard `OTEL_EXPORTER_OTLP_*`), not by workspace keys — [moon v2.5 blog](https://moonrepo.dev/blog/moon-v2.5)
- **`experiments` (v2):**
  - `asyncGraphBuilding`, `asyncAffectedTracking`, and `nativeFileHashing` default to `true` from v2.5.
  - `casOutputsCache` (v2.3) and `explicitTaskOutputStyle` (v2.6) default to `false`.
  - The docs warn: "Experiments are a work in progress and may be buggy".
  - Source: [workspace config](https://moonrepo.dev/docs/config/workspace)
  - The v2.5 advice is to run with the new defaults, and to disable an experiment (for example `asyncGraphBuilding: false`) only if something breaks, then report it — [moon v2.5 blog](https://moonrepo.dev/blog/moon-v2.5)
- **Other workspace settings** — [workspace config](https://moonrepo.dev/docs/config/workspace):
  - `versionConstraint` (for example `'>=0.20.0'`) enforces a minimum moon version.
  - `cache.cas.maxSize` (v2.4) and `cache.cas.verifyIntegrity` (default `false`).
  - `cache.unstable_sharedWorktreeCache` (v2.5) requires `casOutputsCache`.
  - `unstable_daemon` (v2.2) defaults to `false`.
  - `remote` (v1 name: `unstable_remote`) holds the remote cache host, api (`grpc`/`http`), and TLS/mTLS settings.
  - `codeowners` (`sync` defaults to `false`).
  - `generator.templates` defaults to `./templates`.
  - `defaultProject` (v2).
- **`extends`:** `.moon/workspace.*` can extend an HTTPS URL or a relative YAML path. Blocks merge recursively, except `projects` — [workspace config](https://moonrepo.dev/docs/config/workspace)
- **`.moon/extensions.*` (v2):** each custom extension is a WASM plugin with a `plugin` locator (`file://` or `https://`) plus its own settings, run with `moon ext <name>` — [extensions config](https://moonrepo.dev/docs/config/extensions)
  ```yaml
  # .moon/extensions.yml
  example:
    plugin: 'file://./path/to/example.wasm'
    setting1: true
  ```
  - **Built-ins (`download`, `migrate-nx`, `migrate-turborepo`, `unpack`):** the docs conflict.
    - The migration guide says `download`, `migrate-nx`, and `migrate-turborepo` "must be explicitly enabled", set to `{}`, for performance — [Migrate to v2](https://moonrepo.dev/docs/migrate/2.0)
    - The extensions guide says built-ins are "configured and enabled by default" and that only custom extensions need entries — [Extensions guide](https://moonrepo.dev/docs/guides/extensions)

### Inferences
- For a new v2 repo, a good baseline:
  - Keep the hasher defaults.
  - Enable `enforceLayerRelationships`, and set `layer` on every project so the constraint actually applies, since unknown layers are ignored.
  - Set `versionConstraint` to match the pinned moon version.
  - Consider `telemetry: false` if policy requires it.
- `hasher.optimization: performance` trades cache correctness for speed. It hashes ranges instead of resolved versions, so lockfile-only upgrades may not bust caches. This is inferred from the doc's description.

### Gaps
- The default value of `constraints.enforceLayerRelationships` is not stated in the fetched reference. The example shows `false`.
- The extensions conflict above is unresolved. Test it with `moon ext download` and no config.

## Schema/IDE support, config file formats, and environment variables

### Takeaway
v2 accepts YAML, JSON, JSONC, TOML, HCL, and Pkl, where v1 accepted only YAML and Pkl, and the docs recommend no particular format. For IDE validation, set `$schema` to the locally generated schemas under `.moon/cache/schemas/`. The hosted `moonrepo.dev/schemas` URLs are deprecated. Many workspace settings can be overridden with `MOON_*` environment variables.

### Cited Findings
- **Formats:** `.json`, `.jsonc`, `.hcl`, `.pkl`, `.toml`, `.yml`, `.yaml` are supported in v2.0+. v1 supported only YAML and Pkl. No format is recommended over another — [Config overview](https://moonrepo.dev/docs/config/overview); [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
- **`$schema`:** put it at the top of each file, pointing to the local schemas. The old `moonrepo.dev/schemas` URLs are deprecated — [Config overview](https://moonrepo.dev/docs/config/overview)
  - The schemas are generated when a task runs, or manually with `moon sync config-schemas`.
  ```yaml
  # .moon/workspace.yml
  $schema: './cache/schemas/workspace.json'
  # .moon/toolchains.yml  -> './cache/schemas/toolchains.json'
  # .moon/extensions.yml  -> './cache/schemas/extensions.json'
  # .moon/tasks/all.yml   -> '../cache/schemas/tasks.json'
  ```
- **Pkl specifics** — [Config overview](https://moonrepo.dev/docs/config/overview):
  - Requires the `pkl` binary, installable through proto.
  - Configs amend or extend the generated modules in `.moon/cache/schemas/pkl`. Run `moon sync config-schemas --force` after upgrading.
  - `extends` supports only local files.
  - Each file is evaluated in isolation, so no inheritance merge applies.
  - Plugin and toolchain settings are not type-checked.
- `extends` in workspace, toolchains, and extensions files must be "an HTTPS URL _or_ relative file system path that points to a valid YAML document" — [toolchains config](https://moonrepo.dev/docs/config/toolchain); [extensions config](https://moonrepo.dev/docs/config/extensions)
- **Env vars that override workspace config** — [Env vars](https://moonrepo.dev/docs/env-vars):

  | Env var | Overrides |
  |---|---|
  | `MOON_TELEMETRY` | `telemetry` |
  | `MOON_DAEMON` | `unstable_daemon` |
  | `MOON_WEBHOOK_URL`, `MOON_WEBHOOK_ACKNOWLEDGE` | `notifier.*` |
  | `MOON_PIPELINE_AUTO_CLEAN_CACHE`, `MOON_PIPELINE_CACHE_LIFETIME`, `MOON_PIPELINE_KILL_PROCESS_THRESHOLD` | `pipeline.*` |
  | `MOON_CACHE_CAS_*`, `MOON_CACHE_SHARED_WORKTREE_CACHE` | `cache.*` |
  | `MOON_REMOTE_*` | `remote.*` |
  | `MOON_EXPERIMENT_*` | `experiments.*` |
  | `MOON_<TOOLCHAIN>_VERSION`, `MOON_TOOLCHAIN_FORCE_GLOBALS` | toolchains |

  - General variables include `MOON_CACHE` (`read`/`read-write`/`write`/`off`), `MOON_CONCURRENCY`, `MOON_LOG`, and `MOON_HOME` (default `~/.moon`).
  - moon also reads `CI` and `NO_COLOR`/`FORCE_COLOR`.

### Inferences
- Because the `$schema` paths are local and generated, run `moon sync config-schemas` once after cloning, or commit to running a task first, or editors will report a missing schema. `.moon/cache` is normally gitignored by `moon init`, so the schemas are not committed. That second point is inferred from `moon init` appending ignore patterns ([Setup workspace](https://moonrepo.dev/docs/setup-workspace)).
- YAML is still the format used in every doc example, and `extends` targets are described as YAML documents. YAML is the lowest-friction choice even though other formats are supported. This is my inference, not a stated recommendation.

### Gaps
- Not confirmed: whether `extends` can point to non-YAML formats such as TOML or JSON in v2. The reference wording still says "YAML document".
- No general editor setup guide exists beyond `$schema` and the Pkl VS Code extension.
