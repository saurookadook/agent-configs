# moon JavaScript and Python Standards

Applies to the language blocks of `.moon/toolchains.yml` (`javascript`, `node`, `pnpm`,
`typescript`, and the `unstable_` Python blocks) and the language-scoped task files in
`.moon/tasks/`. General task rules are in [projects-and-tasks.md](projects-and-tasks.md);
versions are pinned in `.prototools` (MWS-3).

**Source of truth:** `.moon/toolchains.yml`, `.moon/tasks/javascript.yml`,
`.moon/tasks/python.yml`. Where the rendered docs no longer list a default, the plugin
source (`moonrepo/plugins`, `toolchains/<id>/src/config.rs`) is the reference.

---

## JavaScript and TypeScript

**MLANG-1 — Declare `javascript`, `node`, `pnpm`, and `typescript`, and set
`javascript.packageManager: 'pnpm'`.** v2 splits the stack into shared settings, a
runtime, and a package manager; `typescript` and `node` require `javascript`, and `pnpm`
requires `node`. `packageManager` defaults to `npm`, so it MUST be set
([nodejs.md](../nodejs.md) NODE-2):

```yaml
# .moon/toolchains.yml (JS/TS portion)
javascript:
  packageManager: 'pnpm'
  inferTasksFromScripts: false
node: {}
pnpm: {}
typescript:
  syncProjectReferences: true
  routeOutDirToCache: false
```

**MLANG-2 — Keep `javascript.syncPackageManagerField` on (the default).** It writes the
pinned pnpm version into the root `package.json` `packageManager` field, which Corepack
(NODE-2) and `pnpm/action-setup` (CI-5) read, so every tool uses the version moon pins.

**MLANG-3 — Keep `dependencyVersionFormat: 'workspace'` (the default, `workspace:*`).**
That is what [monorepo.md](../monorepo.md) MONO-2 requires. The research report suggests
`workspace-caret` to match the Node handbook's examples; MONO-2 wins. Keep
`syncProjectWorkspaceDependencies` on and `rootPackageDependenciesOnly` off; one version
per dependency comes from MONO-10's pnpm catalog.

**MLANG-4 — Tasks come from `moon.yml` and `.moon/tasks/`, never from inferred
`package.json` scripts.** Set `inferTasksFromScripts: false` explicitly. The FAQ asks
"everyone to define tasks in a `moon.*` file", and inferred tasks default to `**/*`
inputs, miss root config changes, have no outputs to hydrate, and run in CI unless a name
heuristic catches them. `moon migrate from-package-json` is gone; port scripts by hand,
one task at a time, and test each one.

**MLANG-5 — Every JavaScript project is listed in `pnpm-workspace.yaml`** (MONO-1). A
project missing from it, or listed wrongly, causes a double install. Universal tools
(oxlint, oxfmt, TypeScript, test runners) are root `devDependencies` with root config, as
FMT-7 already requires; framework dependencies belong to the project that uses them.

**MLANG-6 — Use TypeScript project references, synced by moon.** moon recommends them
"as it ensures that only affected projects are built". Keep `syncProjectReferences` and
`createMissingConfig` on.

- Keep [typescript.md](../typescript.md) TS-3's file layout and its shared options file,
  `tsconfig.common.json`. The moon guide names this file inconsistently
  (`tsconfig.options.json`, `tsconfig.workspaces.json`, `tsconfig.projects.json`); TS-3's
  name wins.
- Keep `routeOutDirToCache` off. `shared` publishes `dist` through its `exports` map
  (MONO-8), which breaks if moon moves the output directory.
- Gitignore `*.tsbuildinfo`.
- moon's advice to prefix path aliases with `:` does not apply. TS-2's `@/*` alias is
  in-project, and MONO-2 already bans path imports across workspaces.
- Turn `syncProjectReferences` off only for a repository with no project references
  _(judgement call)_.

**MLANG-7 — Commit an `.editorconfig` that matches FMT-2.** moon rewrites `package.json`
and `tsconfig.json` during sync, with no switch to turn the formatting off, and respects
`.editorconfig`. Match oxfmt's settings (2-space indent, 4 for `*.json`) so a sync does
not fight the formatter.

---

## Python

**MLANG-8 — Configure Python with `unstable_python` and `unstable_uv`, and set
`packageManager: 'uv'`** ([python.md](../python/python.md) PY-2). Python is the one
toolchain v2 still marks unstable. The default package manager is `pip`. A v2.1 blog
example uses a bare `python:` key; the setup docs use `unstable_python`, and so does this
standard. Treat the keys as provisional: re-check them on every moon upgrade (MWS-2).
The configuration key and the toolchain ID differ: `.moon/toolchains.yml` takes
`unstable_python`, but `inheritedBy.toolchains` matches the ID without the prefix,
`python` (MLANG-10; checked on v2.6.2).

**MLANG-9 — Install from the lockfile:**

```yaml
# .moon/toolchains.yml (Python portion)
unstable_python:
  packageManager: 'uv'
  venvName: '.venv'
unstable_uv:
  syncArgs: ['--locked']
```

`--locked` matches PY-3 (`uv sync --locked`). `venvLocation` exists in the plugin source
but is commented out, so the venv location cannot be configured.

**MLANG-10 — Python tasks live in `.moon/tasks/python.yml`, run tools through `uv run`
(PY-3), and declare explicit inputs** including `pyproject.toml` and `uv.lock`, since
Ruff and pyright are configured there (PY-8, PY-9):

```yaml
# .moon/tasks/python.yml
$schema: '../cache/schemas/tasks.json'
inheritedBy:
  toolchains: ['python'] # the ID, not the `unstable_python` key (MLANG-8)
fileGroups:
  python-sources: ['**/*.py', '!tests/**/*']
  python-tests: ['tests/**/*.py']
  python-configs: ['pyproject.toml', 'uv.lock']
tasks:
  format:
    command: 'uv'
    args: ['run', 'ruff', 'format', '--check']
    inputs: ['@group(python-sources)', '@group(python-tests)', '@group(python-configs)']
    options:
      affectedFiles: true
  lint:
    command: 'uv'
    args: ['run', 'ruff', 'check']
    inputs: ['@group(python-sources)', '@group(python-tests)', '@group(python-configs)']
    options:
      affectedFiles: true
  typecheck:
    command: 'uv'
    args: ['run', 'pyright']
    inputs: ['@group(python-sources)', '@group(python-tests)', '@group(python-configs)']
  test:
    command: 'uv'
    args: ['run', 'pytest']
    inputs: ['@group(python-sources)', '@group(python-tests)', '@group(python-configs)']
```

The task names match the JavaScript file, so `moon run :lint` and the pre-commit hook
cover both languages. The group names carry a `python-` prefix so they do not merge with
the JavaScript groups (MTASK-5).

- `inheritedBy.toolchains: ['unstable_python']` matches nothing on v2.6.2, so no project
  inherits the tasks and `moon run :lint` silently skips Python. Use `['python']`, and
  confirm with `moon task backend:lint` after a moon upgrade.

**MLANG-11 — Create the shared venv before tasks fan out in parallel.** On a cold
workspace, parallel `moon ci` can race on a shared root `.venv` ("A virtual environment
already exists"; open as of v2.5.0). In CI, set `auto-setup: true` on `setup-toolchain`
(MCI-4) so `moon setup` runs first; locally, run `moon setup` once after cloning.

**MLANG-12 — Pin Python and uv in `.prototools`** (MWS-3) at PY-1's version, and keep
`.python-version` equal to it while uv reads that file.
