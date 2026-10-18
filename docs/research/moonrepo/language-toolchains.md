# moon (moonrepo) language toolchains: JS/TS, Python, Rust/Bun/Deno, and migration

Researched 2026-10-18. Primary sources: moonrepo.dev/docs (v2 docs), the docs source in `moonrepo/moon` (`website/docs/**`), and toolchain plugin source in `moonrepo/plugins` (`toolchains/*/src/config.rs`). The rendered `/docs/config/toolchain` page now holds only the shared settings. Per-toolchain settings are discovered with `moon toolchain info <id>`. Because of that, the default values below come from the plugin config source code.

Source shorthand used below:
- DOCS = `https://github.com/moonrepo/moon/blob/master/website/docs/...`
- PLUG = `https://github.com/moonrepo/plugins/blob/master/toolchains/...`

## Q1. What is the current moon version, and how are language toolchains configured in v2? Every v1 vs v2 difference

### Takeaway
moon v2 is current. v2.0 shipped 2026-02-18, and the latest release is v2.6.2 (2026-10-14). In v2, toolchains are WASM plugins configured in `.moon/toolchains.*` (plural), and the JS stack is split into separate top-level blocks: `javascript` (shared settings) + runtime (`node`/`bun`/`deno`) + package manager (`npm`/`pnpm`/`yarn`/`bun`). Python is still `unstable_`-prefixed. Much v1-era material is still in circulation (the moonrepo/examples repo, some doc partials, the FAQ) and uses v1 keys.

### Cited Findings
- moon v2.0 "Phobos" was released 2026-02-18. — [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
- The latest GitHub releases are v2.6.2 (2026-10-14), v2.6.1 (2026-10-07) and v2.6.0 (2026-10-05). — [GitHub releases](https://github.com/moonrepo/moon/releases)
- The docs banner says "Documentation is currently for moon v2 and latest proto", and the v1 docs have been frozen. — [Node.js handbook](https://moonrepo.dev/docs/guides/javascript/node-handbook)
- The v2.0 blog calls this "the biggest change in moon v2": toolchains replace the legacy *platform* system and are powered by WASM plugins, not hard-coded in core. A task can now belong to several toolchains (e.g. `javascript`, `node`, `npm`), and the `mergeToolchains` task option controls how they combine. — [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
- The config file was renamed from `.moon/toolchain.*` to `.moon/toolchains.*`. — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)
- All toolchains are stabilized except Python, so remove the `unstable_` prefix for the others. Python still requires it: `python.pip` → `unstable_pip`, `python.uv` → `unstable_uv`. `python.rootVenvOnly` was removed. — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)
- `bun`, `deno` and `node` now require the `javascript` toolchain. Shared settings moved from `node.*` (and `bun.*`) to `javascript.*`:
  - `packageManager`, `inferTasksFromScripts`, `dependencyVersionFormat`, `syncProjectWorkspaceDependencies`, `syncPackageManagerField` and `dedupeOnLockfileChange` keep their names.
  - `node.rootPackageOnly` → `javascript.rootPackageDependenciesOnly`.
  - Package-manager blocks became top level: `node.pnpm` → `pnpm`, `node.npm` → `npm`, `node.yarn` → `yarn`, `node.bun` → `bun`.
  - `node.binExecArgs` → `node.executeArgs`.
  - Removed: `node.addEnginesConstraint`, `node.packagesRoot`, `bun.packagesRoot`, `deno.depsFile`, `deno.lockfile`.
  — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)
- Project and task keys also changed:
  - Project `platform` → `toolchains.default`, project `toolchain` → `toolchains`.
  - `tasks.*.platform` → `tasks.*.toolchains`, `$taskPlatform` → `$taskToolchain`.
  - `toolchain.*.disabled` was removed: set the toolchain to `null` instead.
  - Language detection now comes from toolchains, so languages without a toolchain (PHP, Ruby) must be set explicitly.
  — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)
- The migration guide recommends toolchain detection and discourages setting `toolchains` on tasks, because `toolchains: 'node'` applies only Node.js, not JavaScript or the package manager. — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)
- `moon migrate from-package-json` was removed in v2. `migrate-nx` and `migrate-turborepo` are now extensions that must be enabled in `.moon/extensions.*`. `moon migrate v2` automates part of the config migration. — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)
- `moon upgrade` does not work from v1 because the distribution format changed. Reinstall via the install scripts or proto. — [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
- The toolchain dependency graph:
  - `bun`, `deno`, `node` and `typescript` require `javascript`.
  - `npm`, `pnpm` and `yarn` require `node`.
  - `unstable_nub` requires `javascript` but not `node`.
  - `unstable_pip`, `unstable_poetry` and `unstable_uv` require `unstable_python`.
  - `rust` and `go` have no dependencies.
  — [Toolchain config](https://moonrepo.dev/docs/config/toolchain)
- Settings shared by every toolchain in v2:
  - `versionFromPrototools` (v2.0, default `true`): inherits the version from the root `.prototools`.
  - `inheritAliases` (v2.1, default `true`): aliases come from the manifest `name`.
  - `installDependencies` (v2.1, default `true`): auto-installs when the lockfile, manifest or environment changes.
  - `plugin`: a WASM locator (`file://`, `https://`, `github://`) to override a built-in plugin.
  — [Toolchain config](https://moonrepo.dev/docs/config/toolchain); [moon v2.1 blog](https://moonrepo.dev/blog/moon-v2.1)
- v2 Node setup example (from the docs partials), with versions pinned either in `.prototools` or inline:
  ```yaml
  # .moon/toolchains.yml
  javascript:
    packageManager: 'yarn'
  node:
    version: '20.0.0'
  yarn:
    version: '4.0.0'
  ```
  — [DOCS setup-toolchain/node/tier3.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/__partials__/setup-toolchain/node/tier3.mdx)
- Releases after v2.0 that affect languages:
  - v2.3: unstable `uv-pip` Python package manager; Deno v2.8 support.
  - v2.4: Poetry for Python.
  - v2.5: unstable Nub JS package manager (`javascript.packageManager: 'nub'` + `unstable_nub: {}`); the async engine becomes the default.
  - v2.6: toolchain environment activation (proto's `activate_environment`, so moon tasks see env vars and `PATH` the same way `proto activate` would).
  — [v2.3](https://moonrepo.dev/blog/moon-v2.3), [v2.4](https://moonrepo.dev/blog/moon-v2.4), [v2.5](https://moonrepo.dev/blog/moon-v2.5), [v2.6](https://moonrepo.dev/blog/moon-v2.6)
- v2.6 upgrade note: a task's resolved `toolchains` list is now deterministic and part of the task hash. Tasks with several toolchains (e.g. `node` + `npm`) miss the cache once after upgrading. — [moon v2.6 blog](https://moonrepo.dev/blog/moon-v2.6)
- Stale v1 material still in circulation:
  - The official `moonrepo/examples` repo still uses v1 config: `.moon/toolchain.yml` with `node.packageManager`, nested `node.pnpm`, `addEnginesConstraint` and `syncVersionManagerConfig`. — [moonrepo/examples .moon/toolchain.yml](https://github.com/moonrepo/examples/blob/master/.moon/toolchain.yml)
  - The FAQ and the migrate-scripts partial still say `node.inferTasksFromScripts`. — [DOCS faq.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/faq.mdx), [DOCS migrate/node/scripts.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/__partials__/migrate/node/scripts.mdx)

### Inferences
- A canonical v2 pnpm + TypeScript repo needs these blocks: `javascript: { packageManager: 'pnpm' }`, `node: {}`, `pnpm: {}` and `typescript: {...}`. Versions go in `.prototools`, which `versionFromPrototools: true` picks up by default.
- Treat any snippet with `node.packageManager`, `node.pnpm:`, `platform:`, `.moon/toolchain.yml` or `$taskPlatform` as v1-only. Note that the moonrepo examples repo is not a reliable v2 reference.

### Gaps
- I found no explicit doc on whether `.moon/toolchains.yml` accepts `typescript` without an explicit `javascript` block. The dependency list says `typescript` requires `javascript`.
- The Python-prefix status conflicts between sources. The migration guide and setup partials use `unstable_python`, but the v2.1 blog example uses a bare `python: installDependencies: false`. I could not confirm whether a bare `python` is accepted as of v2.6.

## Q2. Per-project vs single root-level tasks for linters, formatters and typecheckers

### Takeaway
The official examples (ESLint, Prettier, TypeScript) define the tool once as a shared task in `.moon/tasks/*.yml`. Every project inherits it and runs it in its own directory with project-scoped `inputs`, with per-project `args` overrides in `moon.yml`. The docs call these "universal workflows". The tool, its config and its ignore file live once at the repo root. The root-level project pattern is reserved for one-off or maintenance tasks, and its docs warn about the cost of inputs. They do not recommend running linters from the root.

### Cited Findings
- ESLint: "linting is a universal workflow", so add one `lint` task to `.moon/tasks/**/*`.
  - Inputs are project sources/tests and config, plus root files (`/.eslintignore`, `/.eslintrc.*`). It uses `--ignore-path @in(4)` to reuse the root ignore file.
  - Projects add args per project, e.g. `--cache`. The root `.eslintrc` must set `root: true`, and project configs should not `extends` the root config, because ESLint merges configs while traversing upward.
  - Project-level configs are preferred over root `overrides`.
  — [ESLint example](https://moonrepo.dev/docs/guides/examples/eslint)
- Prettier: "Since code formatting is a universal workflow, add a `format` task to `.moon/tasks/**/*`."
  - It uses `prettier --config @in(4) --ignore-path @in(3) --check .`, with inputs `src/**/*`, `tests/**/*`, `**/*.{md,mdx,yml,yaml,json}`, `/.prettierignore` and `/.prettierrc.*`.
  - The root config is required. Only one `.prettierignore` can exist, so it lives at the root.
  — [DOCS examples/prettier.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/guides/examples/prettier.mdx)
- TypeScript: "Since typechecking is a universal workflow, add a `typecheck` task to `.moon/tasks/**/*`."
  - It runs `tsc --build --pretty --verbose`. Inputs are `src/**/*`, `tests/**/*`, `types/**/*`, `tsconfig.json`, `tsconfig.*.json` and `/tsconfig.options.json`. Outputs are `lib`, matching `outDir`.
  - Projects may add args like `--force`.
  - Project references are used "as it ensures that only affected projects are built, and not the entire repository."
  — [DOCS examples/typescript.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/guides/examples/typescript.mdx)
- The Node handbook recommends installing universal tooling (Babel, ESLint, Jest, Prettier, TypeScript) in the root `devDependencies` for consistency and single-point upgrades. Framework or product dependencies go in each project's `dependencies`.
  - Universal tools keep their config at the root, and projects may override it. Jest-like tools need per-project config. One-off tools (Astro, Next, Nuxt, Remix, Tailwind) get config only where used.
  — [Node.js handbook](https://moonrepo.dev/docs/guides/javascript/node-handbook)
- The migration example `moon.yml` shows per-project `format` (prettier), `lint` (eslint), `test` (jest) and `typecheck` (`tsc --build`) tasks. Each declares explicit inputs, including root config files with a leading `/`. — [DOCS migrate/node/migrate.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/__partials__/migrate/node/migrate.mdx)
- Root-level project guide:
  - It is for "one-off, organization, maintenance, or process oriented tasks". Configure it via `projects: { root: '.' }` + a root `moon.yml`, and run with `moon run root:<task>`.
  - Default `**/*` inputs mean "scanning _all_ files in the repository. This will be a very expensive operation!", so set `inputs: []` or a short list. Since v1.24, root-level tasks default to no inputs.
  - The root project inherits all `.moon/tasks/**/*` tasks unless limited with `workspace.inheritedTasks` (e.g. `include: []`).
  - The guide's example is a `versionCheck` task with `inputs: []` and `cache: false`.
  — [Root-level project](https://moonrepo.dev/docs/guides/root-project)
- The TypeScript project-refs guide says `tsc --build --verbose` from the root for all projects is appropriate for TS upgrades, global `@types` changes, shared-type changes or build-process changes. For CI, typecheck only affected projects; it notes this "isn't entirely possible with `tsc`" alone and leans on moon's affected detection. — [TS project references guide](https://moonrepo.dev/docs/guides/javascript/typescript-project-refs)

### Inferences
- Why per-project: each project gets its own hash from narrow inputs, so it can be cached, restored and selected as "affected". A single root task with whole-repo inputs reruns on any change and defeats this. The docs imply this through the "only affected projects" wording and the root-project warning about inputs. They never state it as an explicit comparison.
- Recommended pattern: tool installed once at the root, config once at the root, task defined once in `.moon/tasks/<tool>.yml`, executed per project.

### Gaps
- No page states the per-project vs root-level trade-off in so many words. The rationale above is inferred.
- I did not fetch the Vitest, Jest, Vite, Next or Storybook pages in detail. Jest's per-project config guidance comes from the Node handbook. The examples index lists angular, astro, eslint, jest, nest, next, nuxt, packemon, prettier, react, remix, solid, storybook, sveltekit, typescript, vite and vue ([DOCS examples/](https://github.com/moonrepo/moon/tree/master/website/docs/guides/examples)). A Vitest task preset exists in moon-configs (`tag-vitest`), mentioned in [issue #2391](https://github.com/moonrepo/moon/issues/2391) (community).

## Q3. TypeScript project references and tsconfig syncing, and when to disable syncing

### Takeaway
moon recommends TypeScript project references, laid out as follows:
- Root `tsconfig.json`: only `extends`/`files: []`/`references`.
- Shared `tsconfig.options.json`: compiler options.
- Per-project `tsconfig.json`: extends the options, with `outDir`, `include` and `references`.

moon's `typescript` toolchain keeps `references` (and optionally `paths`, `include` and `outDir`) in sync from the project graph. `syncProjectReferences` and `createMissingConfig` default to on. The other sync settings are opt-in.

### Cited Findings
- `typescript` toolchain settings and defaults, from the plugin schema:
  | Setting | Default | What it does |
  | --- | --- | --- |
  | `syncProjectReferences` | `true` | Syncs project dependencies as `references` |
  | `createMissingConfig` | `true` | Creates a `tsconfig.json` in referenced projects when references are synced |
  | `syncProjectReferencesToPaths` | `false` | Syncs dependencies as `compilerOptions.paths` |
  | `includeProjectReferenceSources` | `false` | Appends reference sources to `include` |
  | `includeSharedTypes` | `false` | Appends `<root>/types` to `include` |
  | `routeOutDirToCache` | `false` | Rewrites `outDir` into moon's cache |
  | `pruneProjectReferences` | `false` | Removes non-moon-managed references (v2.1) |
  | `root` | `.` | |
  | `rootConfigFileName` | `tsconfig.json` | |
  | `rootOptionsConfigFileName` | `tsconfig.options.json` | |
  | `projectConfigFileName` | `tsconfig.json` | |
  — [PLUG typescript/src/config.rs](https://github.com/moonrepo/plugins/blob/master/toolchains/typescript/src/config.rs); [moon v2.1 blog](https://moonrepo.dev/blog/moon-v2.1)
- Recent typescript plugin changes:
  - 1.1.2: project references now start with `./`, "in preparation for the removal of `baseUrl` in TypeScript v7".
  - 1.1.1: TypeScript v6 support.
  - 1.1.6: fixed `pruneProjectReferences` removing references from the root `tsconfig.json`.
  — [PLUG typescript/CHANGELOG.md](https://github.com/moonrepo/plugins/blob/master/toolchains/typescript/CHANGELOG.md)
- Guide recommendations:
  - The root `tsconfig.json` lists all references and holds no compiler options.
  - Shared options go in a root `tsconfig.options.json`.
  - Packages use `emitDeclarationOnly`, apps use `noEmit`.
  - Prefer `include` over `exclude`.
  - Gitignore `lib/` and `*.tsbuildinfo`.
  — [TS project references guide](https://moonrepo.dev/docs/guides/javascript/typescript-project-refs)
- Guide pitfalls:
  - Missing references cause errors about importing outside the project boundary.
  - Referenced projects need their sources in `include` for editor intellisense and auto-imports.
  - Circular references are unsupported: extract shared code into a third project.
  - `exports` overrides `types`: use `moduleResolution: nodenext` or `bundler`, with the `types` condition first.
  - Publishing needs `tsconfig.build.json` added as a reference.
  - Prefix path aliases with `:` rather than `@` to avoid npm scope collisions.
  - Point VS Code `typescript.tsdk` at the repo's `node_modules/typescript/lib`.
  — [TS project references guide](https://moonrepo.dev/docs/guides/javascript/typescript-project-refs)
- The TypeScript example extends `tsconfig-moon` in `tsconfig.options.json`. The prose names `tsconfig.workspaces.json`, but the snippet uses `tsconfig-moon/tsconfig.projects.json`, a docs inconsistency.
  - The docs say multiple root-level configs are "required": shared compiler options plus a list of all project references.
  - "We suggest using the same version [of typescript] across the entire repository."
  — [DOCS examples/typescript.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/guides/examples/typescript.mdx)
- moon rewrites `package.json` and `tsconfig.json` constantly, and there is no switch to stop that formatting. It respects `.editorconfig`, so the FAQ says to create one. — [DOCS faq.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/faq.mdx)
- The v1-era official examples repo enabled `routeOutDirToCache: true` and `syncProjectReferences: true`. — [moonrepo/examples .moon/toolchain.yml](https://github.com/moonrepo/examples/blob/master/.moon/toolchain.yml) (v1 config)

### Inferences
- Disable or skip syncing in these cases:
  - Repos that don't use project references, e.g. bundler-only apps with `noEmit`, or Deno: set `syncProjectReferences: false`.
  - Hand-curated references that moon must not touch: keep `pruneProjectReferences: false`, which is the default.
  - Tools that can't read moon-rewritten files.
  - `routeOutDirToCache` is off by default because it moves `lib/` outputs out of the project. Only enable it when nothing outside moon (publishing, `exports` paths) relies on `outDir`.
  
  These cases come from the semantics of the settings. The docs have no explicit "when to disable" section.
- `syncProjectReferencesToPaths` is useful when bundlers or tests need source aliases without a build. The handbook separately recommends bundler aliases that point package names at source.

### Gaps
- The docs have no explicit guidance on when to disable syncing.
- The guide says the shared-types workflow "will be automated" in the future, while the plugin already ships `includeSharedTypes`. The docs page appears to lag the plugin.

## Q4. Pinning package-manager and Node versions with the `packageManager` field and `.prototools`

### Takeaway
Pin `node` and the package manager in the root `.prototools`, which toolchains inherit by default, or in `node.version` / `pnpm.version`. moon downloads exactly those versions through proto. `javascript.syncPackageManagerField` (default `true`) then writes the pinned package-manager version into the root `package.json` `packageManager` field, so corepack and other tools agree.

### Cited Findings
- `javascript` toolchain settings and defaults:
  | Setting | Default | What it does |
  | --- | --- | --- |
  | `packageManager` | `npm` | Choices: `bun`, `deno`, `npm`, `nub`, `pnpm`, `yarn` |
  | `syncPackageManagerField` | `true` | "Automatically syncs the configured package manager version to the root `packageManager` field in `package.json`" |
  | `syncProjectWorkspaceDependencies` | `true` | "Automatically syncs moon project-to-project relationships as dependencies for each `package.json`" |
  | `dependencyVersionFormat` | `workspace` (`workspace:*`) | Other values: `file`, `link`, `star`, `version`, `version-caret`, `version-tilde`, `workspace-caret`, `workspace-tilde`; downgraded to a supported format per package manager |
  | `dedupeOnLockfileChange` | `true` | "Automatically dedupes the lockfile when dependencies have changed. This will run locally after dependencies have been installed." |
  | `rootPackageDependenciesOnly` | `false` | Enforces the "one version policy" |
  | `inferTasksFromScripts` | `false` | |
  
  Each package-manager block has `version` and `installArgs`.
  — [PLUG javascript/src/config.rs](https://github.com/moonrepo/plugins/blob/master/toolchains/javascript/src/config.rs)
- `node` settings: `version`, `executeArgs`, `profileExecution` (debug only), and `syncVersionManagerConfig` (syncs the version to nvm/nodenv config). — [PLUG node/src/config.rs](https://github.com/moonrepo/plugins/blob/master/toolchains/node/src/config.rs)
- `versionFromPrototools` (default `true`) inherits each toolchain's version from the root `.prototools`. — [Toolchain config](https://moonrepo.dev/docs/config/toolchain)
- The handbook shows pins in `.prototools` (`node = "24.0.0"`, `pnpm = "7.29.0"`) or via `node.version`. Pinning means the exact version runs on every machine, not whatever is on `PATH`. Its own examples disagree on versions (24.0.0 vs '18.0.0'), so they are illustrative only. — [Node.js handbook](https://moonrepo.dev/docs/guides/javascript/node-handbook)
- Maintainer rationale for syncing `packageManager`: "This ensures other tools that rely on that field are also using the same version that the repo expects."
  - A user reported that setting `packageManager` without a `version` made moon *remove* the `packageManager` field. The opt-out (`syncPackageManagerField`) shipped in v1.27.
  — [Issue #1533](https://github.com/moonrepo/moon/issues/1533) (community/maintainer)
- `node.addEnginesConstraint` (which wrote `engines.node`) was removed in v2. — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)
- In the handbook, internal deps use `workspace:^` for pnpm/Yarn and `*` for npm. — [Node.js handbook](https://moonrepo.dev/docs/guides/javascript/node-handbook)

### Inferences
- Use `.prototools` as the single source of truth for node and pnpm, keep `syncPackageManagerField: true`, and let corepack or CI read the synced `packageManager` field.
- If another tool must own `packageManager`, set `javascript.syncPackageManagerField: false`.
- `dependencyVersionFormat` defaults to `workspace:*`. Set `workspace-caret` to match the handbook's `workspace:^` advice.

### Gaps
- I found no v2 doc on whether moon can read the version *from* `packageManager`. Sync appears to run one way only: config → `package.json`.

## Q5. Python projects: uv vs pip, venv location, inputs

### Takeaway
Python support is still unstable in v2: `unstable_python` plus one of `unstable_pip`, `unstable_uv` or `unstable_poetry`. Settings:
- `packageManager`: defaults to `pip`; also `uv`, `uv-pip` (v2.3) and `poetry` (v2.4).
- `venvName`: defaults to `.venv`.

The venv is created per project or at the workspace root depending on manifest and lockfile layout; a uv workspace shares the root `.venv`. Task inputs should list sources, tests, `pyproject.toml` and tool config files explicitly.

### Cited Findings
- Setup example:
  ```yaml
  unstable_python:
    packageManager: 'pip'   # or 'poetry', 'uv', 'uv-pip'
    version: '3.11.10'      # optional
  unstable_pip: {}
  ```
  — [DOCS setup-toolchain/python/tier2.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/__partials__/setup-toolchain/python/tier2.mdx), [tier3.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/__partials__/setup-toolchain/python/tier3.mdx)
- Config schema:
  - `unstable_python` has `packageManager` (enum `pip` (default) | `poetry` | `uv` | `uv-pip`), `venvName` (default `.venv`) and `version`.
  - A `venvLocation` (`project` | `workspace`) enum exists, but the setting is commented out, so it is not user-configurable.
  - `unstable_uv` has `syncArgs` (appended to `uv sync`), `venvArgs` (appended to `uv venv`) and `version`.
  - `unstable_pip` has `installArgs`, `venvArgs` and `version`.
  — [PLUG python/src/config.rs](https://github.com/moonrepo/plugins/blob/master/toolchains/python/src/config.rs), [python-uv](https://github.com/moonrepo/plugins/blob/master/toolchains/python-uv/src/config.rs), [python-pip](https://github.com/moonrepo/plugins/blob/master/toolchains/python-pip/src/config.rs)
- `uv-pip` is configured split-wise: install args come from `unstable_pip`, and sync and venv args come from `unstable_uv`. Example: `unstable_pip.installArgs: ['--group','dev']`, `unstable_uv.syncArgs: ['--check']`, `unstable_uv.venvArgs: ['--clear']`. — [moon v2.3 blog](https://moonrepo.dev/blog/moon-v2.3)
- The blogs present pip as the default, with uv "gaining traction for their speed". No doc explicitly recommends uv over pip. — [moon v2.3 blog](https://moonrepo.dev/blog/moon-v2.3)
- Python plugin changelog highlights:
  - `uv sync` uses `--no-dev` for production-only installs.
  - Venv creation is skipped if the directory already exists; pass `--clear` to force it.
  - Project dependencies are inferred from `[tool.uv.sources]` `workspace = true`.
  - Names are normalized to PEP 503 (v2.1).
  - Package-manager toolchains are installed before environment setup (v2.5).
  - Docker prune removes `.venv` of non-focused projects (v2.5).
  — [PLUG python/CHANGELOG.md](https://github.com/moonrepo/plugins/blob/master/toolchains/python/CHANGELOG.md); [moon v2.5 blog](https://moonrepo.dev/blog/moon-v2.5)
- `python.rootVenvOnly` was removed in v2. — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)
- `installDependencies: false` can disable auto-install for Python. — [moon v2.1 blog](https://moonrepo.dev/blog/moon-v2.1)
- The migration example tasks for a Flask app:
  - `dev`: `flask run`, `preset: server`.
  - `format`: `black --check .`, with inputs sources, tests and `pyproject.toml`.
  - `lint`: `pylint .`, with `pyproject.toml` and `.pylintrc` among its inputs.
  - `test`: `python -m unittest`.
  - `typecheck`: `mypy .`, with `mypy.ini` and `pyproject.toml` among its inputs.
  
  Sources are file groups (`flaskr/**/*`, `setup.py`).
  — [DOCS migrate/python/migrate.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/__partials__/migrate/python/migrate.mdx)
- Open bug (2026-08, reproduced on v2.5.0, open at the time of reading): on a cold workspace, parallel `moon ci` can race on the shared workspace `.venv`. Concurrent `uv venv .venv` and `uv sync` produce "A virtual environment already exists at: .venv". — [Issue #2653](https://github.com/moonrepo/moon/issues/2653) (community)

### Inferences
- With uv workspaces, the venv is shared at the workspace root, and the race in #2653 is a current hazard. Possible workarounds: pre-create the venv (`moon setup`) before parallel CI, or pass `venvArgs: ['--clear']`. These are inferred, not documented.
- Pin Python in `.prototools` as with Node; `versionFromPrototools` applies to every toolchain.

### Gaps
- No rendered v2 Python handbook exists. The docs tree has only `guides/javascript/*` and `guides/rust/handbook`, so the venv-location rules are not documented anywhere I found.
- I found no explicit uv vs pip recommendation.

## Q6. Pitfalls for JS/TS monorepos, plus brief Bun/Deno/Rust notes and migration from other tools

### Takeaway
Common pitfalls:
- Relying on inferred `package.json` scripts, which lose granular inputs and outputs.
- Projects missing from `workspaces`, which causes double installs.
- Hand-setting task `toolchains` in v2, which drops the `javascript` toolchain and its `node_modules/.bin` lookup.
- Stale v1 examples.
- moon's automatic rewrites of `package.json` and `tsconfig.json`.

For migration: `from-package-json` is gone in v2. `migrate-turborepo` and `migrate-nx` are opt-in extensions, and the Nx one is experimental.

### Cited Findings
- `inferTasksFromScripts`: the docs discourage it as a long-term pattern. The FAQ says "We encourage everyone to define tasks in a `moon.*` file, as it allows for additional metadata like `inputs`, `outputs`, `options`". The handbooks call inference fit "to prototype moon, or reduce the migration effort". — [DOCS faq.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/faq.mdx); [Bun handbook](https://moonrepo.dev/docs/guides/javascript/bun-handbook); [Node.js handbook](https://moonrepo.dev/docs/guides/javascript/node-handbook)
- Documented risks of inferring from scripts (each inferred task runs `npm run <script>`):
  - Inputs default to `**/*`, so any project file marks the task affected.
  - Changes to workspace-root files are *not* detected, e.g. `/prettier.config.js` for `npm run format`.
  - Outputs are empty unless guessed from `--out`/`--outDir`-style args, so builds aren't cached or hydrated.
  - Tasks always run in CI unless heuristics catch `dev`/`start`/`serve`/`--watch`.
  
  — [DOCS migrate/node/scripts.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/__partials__/migrate/node/scripts.mdx)
- Plugin caveats for inference:
  - Lifecycle `pre`/`post` scripts are not inferred.
  - `:` in script names becomes `-`.
  - Names containing `dev`, `start`, `serve` or `preview` become local-only.
  - It also infers from `deno.json` tasks.
  — [PLUG javascript/src/config.rs](https://github.com/moonrepo/plugins/blob/master/toolchains/javascript/src/config.rs)
- Double installs: if npm/pnpm/yarn install runs twice, a project is either missing from root `workspaces` / `pnpm-workspace.*`, or wrongly listed. Packages excluded from the workspace need their own lockfile. — [DOCS faq.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/faq.mdx)
- Workspaces aren't required, but the docs warn to "proceed with caution" without them, citing module resolution, duplicate packages and interop issues.
  - Apps may depend on packages; packages must not depend on apps.
  - Use bundler aliases to source for HMR.
  — [Node.js handbook](https://moonrepo.dev/docs/guides/javascript/node-handbook)
- v2 lookup pitfall: a user with pnpm hand-set task `toolchains` and lost `node_modules/.bin` on `PATH`, so tools like vitest, tsc and tsx failed. The maintainer: "You need the `javascript` toolchain in the task... I suggest not setting `toolchains` for a task." — [Issue #2391](https://github.com/moonrepo/moon/issues/2391) (maintainer)
- Editor schema pitfall: "Property typescript is not allowed" in VS Code came from schema setup, not invalid config. Schemas are generated dynamically from cache (`moon sync config-schemas`). — [Issue #1893](https://github.com/moonrepo/moon/issues/1893) (v1-era)
- Bun:
  - Enable `javascript.packageManager: 'bun'` + `bun: {}`.
  - moon can't always tell Node from Bun for a `package.json` and defaults to Node. Set `toolchains` to bun at the project or task level, but only when executing a `node_modules` binary, because the `bun` binary sets it automatically.
  
  — [DOCS bun-handbook.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/guides/javascript/bun-handbook.mdx)
- Deno:
  - Enable `javascript.packageManager: 'deno'` + `deno: {}`, or pin `deno` in `.prototools`.
  - Relationships come from `imports`, `importMap` and `deps.ts` (experimental).
  - The handbook is incomplete ("Coming soon!"), and its prose contains a typo saying "configured to use Bun".
  - The JS plugin added Deno v2.8 and v2.9 support.
  
  — [DOCS deno-handbook.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/guides/javascript/deno-handbook.mdx); [PLUG javascript/CHANGELOG.md](https://github.com/moonrepo/plugins/blob/master/toolchains/javascript/CHANGELOG.md)
- Rust:
  - "moon is not a build system and does _not_ replace Cargo"; it orchestrates `cargo` commands.
  - Cargo workspaces are "highly preferred" for incremental caching.
  - `moon.*` can live per crate or once next to `Cargo.lock`. Per-crate tasks contend on Cargo's "wait for build lock".
  - `rust` settings: `version` (channel), `components`, `targets`, `bins` (installed via `cargo binstall`), `binstallVersion`, `syncToolchainConfig` (writes `rust-toolchain.toml` `toolchain.channel`) and `addMsrvConstraint` (writes `rust-version`).
  
  — [DOCS rust/handbook.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/guides/rust/handbook.mdx); [PLUG rust/src/config.rs](https://github.com/moonrepo/plugins/blob/master/toolchains/rust/src/config.rs)
- Migration from Turborepo (`moon ext migrate-turborepo`, since v1.21):
  - Converts root and nested `turbo.json`. `pipeline` (Turbo v1) and `tasks` (Turbo v2) become global tasks in `.moon/tasks/node.yml` (or `bun.yml`), and project tasks go to `moon.*`.
  - Commands still run `package.json` scripts through the package manager.
  - `global*` settings become `implicitInputs`.
  - Flags: `--bun`, `--cleanup`.
  
  — [DOCS guides/extensions.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/guides/extensions.mdx)
- Migration from Nx (`moon ext migrate-nx`, since v1.22, *experimental*):
  - `targetDefaults` become global tasks, `namedInputs` become file groups, and `project.json` becomes `moon.yml`.
  - Executors are mapped to commands, e.g. `@nx/webpack:build` → `webpack build`; `options` become `args`; `{projectRoot}` and `{workspaceRoot}` become moon tokens.
  - Unsupported: most of `nx.json`, some named-input variants, `configurations` (converted to `extends` tasks), `root`/`sourceRoot`.
  - "some manual patching will most likely be required! We suggest testing each converted task 1-by-1."
  
  — [DOCS guides/extensions.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/guides/extensions.mdx)
- In v2, extensions must be enabled in `.moon/extensions.*` (e.g. `migrate-turborepo: {}`), and `moon migrate from-package-json` was removed. The guide's suggested replacement is the `migrate-turborepo` extension. There is no `moon migrate from-turborepo` command; the extension replaced it. — [Migrate to 2.0](https://moonrepo.dev/docs/migrate/2.0)
- Migrating from plain `package.json` scripts: the docs show converting scripts to an explicit per-project `moon.yml`:
  - `build` with `outputs`.
  - `dev` with `preset: 'server'`.
  - `format`, `lint`, `test` and `typecheck` with inputs that include root configs.
  
  The intermediate step is `javascript.inferTasksFromScripts: true`.
  — [DOCS migrate/node/migrate.mdx](https://github.com/moonrepo/moon/blob/master/website/docs/__partials__/migrate/node/migrate.mdx)

### Inferences
- A practical migration path in v2:
  1. Enable `inferTasksFromScripts`, or run `migrate-turborepo` / `migrate-nx`, to get running quickly.
  2. Progressively replace inferred or wrapper tasks with native tool commands (`eslint`, `tsc --build`) defined once in `.moon/tasks/*.yml`, with explicit inputs and outputs, to get correct caching and affected detection.
  3. Then disable inference.
- Keep a root `.editorconfig`, because moon rewrites `package.json` and `tsconfig.json`.

### Gaps
- I could not find which rendered URL hosts the "migrate to moon" partials, likely the `/docs/migrate-to-moon` page with language tabs, so I cited the source files.
- I did not read the GitHub Discussions in depth; the pitfalls above come from issues only.
