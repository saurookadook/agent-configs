# moon Projects and Tasks Standards

Applies to every project's `moon.yml`, the inherited task files in `.moon/tasks/`, and the
targets developers and scripts pass to `moon run`. Toolchain-specific tasks (TypeScript,
Python) are in [javascript-and-python.md](javascript-and-python.md); how CI selects and
caches tasks is in [caching-and-ci.md](caching-and-ci.md).

**Source of truth:** `.moon/tasks/*.yml` and each project's `moon.yml`.

The aim of every rule here is an honest hash: a task's hash changes exactly when its
result would.

---

## Projects

**MTASK-1 — Every project has a `moon.yml` that sets `language`, `layer`, and a `project`
block with `title`, `description`, and `owner`:**

```yaml
# frontend/moon.yml
language: 'typescript'
layer: 'application'
stack: 'frontend'
project:
  title: 'Frontend'
  description: 'React UI for users, projects, and tasks.'
  owner: 'team-web'
tasks:
  build:
    command: 'vite'
    args: ['build']
    deps: ['^:build']
    inputs: ['@group(sources)', '@group(configs)', 'index.html', 'public/**/*']
    outputs: ['dist']
  dev:
    command: 'vite'
    preset: 'server'
  test:
    command: 'vitest'
    args: ['run']
    deps: ['^:build']
    inputs: ['@group(sources)', '@group(tests)', '@group(configs)']
```

- `layer` is one of `automation`, `application`, `tool`, `library`, `scaffolding`, or
  `configuration`, never `unknown`, so MWS-9's constraint applies. Use `application` for
  `frontend` and `backend` and `library` for `shared`.
- The docs mark `description` as required and index it for search.
- `owner` names a team, not a person.
- When Compose runs the dev servers ([docker-and-environment.md](../docker-and-environment.md)
  ENV-6), the project defines no host `dev` task: the root project's `dev` starts the
  stack. A host `vite` gets none of the `env_file` variables, and the proxy does not route
  to it, so the task fails or serves a page nothing reaches. `moon run :dev` would also
  start it beside the stack. Keep the `dev` task above only where the dev server runs on
  the host.
- Set `language` explicitly. A `language` condition in `inheritedBy` matches only an
  explicit value, never a detected one.
- `stack` MAY be set. Check that `enforceLayerRelationships` still accepts the
  `frontend`/`backend` → `shared` edges on the pinned version before giving `shared` a
  stack, since the constraint compares layers within a stack.

**MTASK-2 — Project IDs come from folder names (MWS-8), and task IDs are kebab-case**
_(judgement call)_. moon allows camel, kebab, or snake case as long as an ID starts with a
letter; the repo picks one. `:` cannot appear in a task ID (it separates project from
task in a target), so the moon task behind a `lint:fix` script is `lint-fix`. This
governs moon task IDs only: `package.json` script names keep the
[monorepo.md](../monorepo.md) convention, and a `lint:fix` script MAY alias the task
(`"lint:fix": "moon run :lint-fix"`, MTASK-3). The names `dev`, `start`, and `serve`
carry behaviour (MTASK-10): use them only for long-running servers.

---

## Inherited tasks

**MTASK-3 — Define format, lint, typecheck, and test once, in `.moon/tasks/`, and run them
in each project.** The docs recommend universal tasks in `.moon/tasks` "to avoid repeating
them in each project". Running per project gives each project its own hash and its own
affected status; a single root task reruns on any change anywhere in the repository.

This replaces the root-only `format` and `lint` scripts of
[formatting-and-linting.md](../formatting-and-linting.md) FMT-11 and the per-workspace
`pnpm --filter` scripts of [monorepo.md](../monorepo.md) MONO-11 and MONO-12 as the way
checks run. The tool configuration in FMT-2 and FMT-6 still applies unchanged, and the
inherited `lint` task carries FMT-11's `--deny-warnings`. Root `package.json` scripts MAY
remain as thin aliases (`"lint": "moon run :lint"`).

**MTASK-4 — `.moon/tasks/all.yml` holds only what applies to every project; language tasks
live in a file scoped with `inheritedBy`.** A file without `inheritedBy` is inherited by
every project, so `tsc` there would run in a Python project. Scope with `toolchains`,
`stacks`, or `layers` only: the docs disagree on whether the other conditions exist
(see the [README](README.md) working assumptions).

```yaml
# .moon/tasks/javascript.yml
$schema: '../cache/schemas/tasks.json'
inheritedBy:
  toolchains: { or: ['javascript', 'typescript'] }
fileGroups:
  sources: ['src/**/*']
  tests: ['tests/**/*', 'src/**/*.test.ts', 'src/**/*.test.tsx']
  configs: ['package.json', 'tsconfig*.json', '*.config.ts']
tasks:
  format:
    command: 'oxfmt'
    args: ['--check']
    inputs: ['@group(sources)', '@group(tests)', '@group(configs)', '/.oxfmtrc.json']
    options:
      affectedFiles: true
  lint:
    command: 'oxlint'
    args: ['--type-aware', '--deny-warnings']
    deps: ['^:build']
    inputs: ['@group(sources)', '@group(tests)', '@group(configs)', '/.oxlintrc.json']
    options:
      affectedFiles:
        pass: 'args'
        filter: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'] # MTASK-6
  typecheck:
    command: 'tsc'
    args: ['--build']
    deps: ['^:build']
    inputs: ['@group(sources)', '@group(tests)', '@group(configs)']
  format-write:
    command: 'oxfmt'
    preset: 'utility'
  lint-fix:
    command: 'oxlint'
    args: ['--type-aware', '--fix']
    preset: 'utility'
```

`format` checks and never writes, so CI and the pre-commit hook (MWS-16) can run it.
`format-write` and `lint-fix` are the local fixers. Add `deps: ['^:build']` to tasks that
read a dependency's built output (type-aware lint, typecheck, tests, `shared`'s `dist` per
MONO-8), rather than `implicitDeps`, which would also make `format` wait on builds.

**MTASK-5 — Adjust an inherited task deliberately.** A same-named task in `moon.yml` merges
field by field onto the inherited one, and v2 deep-merges every matching config in
sequence.

- The default merge strategy is `append`, which suits extra flags (`args: ['--cache']`).
  Use `prepend` for options that must precede positional arguments and `replace` for full
  control. Do not use `preserve`, which the docs say "should rarely be used".
- `script` never merges; it always replaces.
- Use `workspace.inheritedTasks` (`include`, then `exclude`, then `rename`) to drop or
  rename inherited tasks, and a task's `extends` to make a variant (`build-prod`).
- File groups merge in v2 (the concept page that says "override" is stale). Do not reuse a
  workspace group name in a project with a different meaning; set
  `workspace.mergeStrategies.fileGroups: replace` only when a project must override.
- A negated glob in a file group applies to every input of a task that uses the group,
  not just to that group (checked on v2.6.2). Build groups from positive globs, and use
  negations only to drop files no task input needs.

---

## Inputs and outputs

**MTASK-6 — Every task declares its `inputs`, through file groups where they exist.** A task
with no inputs defaults to every file in the project (`**/*`), or, by another page's
account, always runs; either way its hash is wrong. Reference workspace-level files
(`.oxlintrc.json`, a root tsconfig) with a leading `/`. Tasks used by the pre-commit hook
set `options.affectedFiles`.

`affectedFiles: true` passes every affected file that matches the inputs, config files
included, so a commit that touches only a config file hands the tool that file alone.
When the tool cannot take every input type, set `affectedFiles.filter` to the files it
accepts (globs start with `**`). Config files stay inputs, so they still invalidate the
cache, and when nothing passes the filter moon passes `.` (`passDotWhenNoResults`) and
the tool checks the whole project, which is right after a config change. Verified on
v2.6.2:

- Ruff parses any file it is given as Python: `uv.lock` fails with hundreds of
  `invalid-syntax` errors, so filter to `**/*.py` (MLANG-10). `pyproject.toml` happens
  to pass.
- oxlint given only `package.json` or `tsconfig.json` reports "No files found to lint"
  and exits 1, so filter to JS/TS extensions. oxfmt formats JSON and needs no filter.

**MTASK-7 — Inputs MUST NOT include an always-set environment variable** (`$CI`, `$HOME`)
unless the result really depends on it. The docs warn that such a task "will always run
and bypass the cache". A file that a glob matches but git ignores is not an input; list
it by explicit path. `inputs: []` opts out of file-based invalidation, so use it only for
a task whose result depends on no file, with a comment saying so.

**MTASK-8 — Every task that produces files declares `outputs`.** On a cache hit moon
"hydrates all necessary outputs from the cache, then immediately exits"; without
`outputs` there is nothing to hydrate. Prefer directory outputs (`dist`): a glob output
deletes every non-matching file in its location on a cache hit. Outputs SHOULD be
deterministic (no build timestamps or absolute paths) _(judgement call)_, because the docs
do not cover nondeterminism and it breaks cache sharing.

---

## Commands and options

**MTASK-9 — Use `command` with list `args`, one item per flag and per value
(`'--maxWorkers', '3'`); use `script` only for shell composition.** Tasks run in a shell by
default in v2, but `command` accepts only a simple command, so pipes, `&&`, redirects, and
`KEY=value` prefixes go in `script`. `script` neither merges (MTASK-5) nor accepts
passthrough arguments.

**MTASK-10 — Use presets instead of hand-set option combinations:**

| Preset    | For                                     | Sets                                                        |
| --------- | --------------------------------------- | ----------------------------------------------------------- |
| `server`  | dev servers (`dev`, `start`, `serve`)   | cache off, streamed output, persistent, `runInCI: false`    |
| `utility` | local one-offs: fixers, migrations      | cache off, interactive, `runInCI: skip`                     |

Tasks named `dev`, `start`, or `serve` get `server` automatically.

**MTASK-11 — A task whose value is a side effect sets `cache: false` and usually
`runInCI: false`** _(judgement call)_: deploy, publish, and migrate tasks. Use
`cache: 'local'` for outputs that are machine-specific or too large to upload to the
remote cache (MCI-11).

**MTASK-12 — Set `runInCI` on every task that is not a CI check.** Every task runs in CI by
default (`affected`). Use `false` for local-only tasks, `only` for CI-only tasks, `skip`
for tasks that must stay valid as relationships, and `always` only when a task must run
on every CI run regardless of changes. In v2, `moon run` and `moon exec` honour `runInCI`
too, not only `moon ci`.

**MTASK-13 — Do not set `toolchains` on a task.** Toolchain detection chooses them. A bare
`toolchains: ['node']` no longer brings in the JavaScript toolchain or the package
manager, so `node_modules/.bin` drops off `PATH` and `tsc` and `vitest` disappear. The one
documented exception is Bun, which this repository does not use.

**MTASK-14 — Serialise tasks that share a resource with `mutex`** (one Compose database,
one port), and use `runDepsInParallel: false` only when dependency order matters.
Mark building-block tasks `internal` so they do not appear in the CLI.

**MTASK-15 — End-to-end tests MAY start and stop their server with `wait` and `cleanup`
deps** (v2.6). Neither dep type changes the hash. A CI task cannot wait on a non-CI task,
so the server task it waits on needs `runInCI` on.

**MTASK-16 — Tasks MAY use `checks` (v2.4)** as gates (`requirement`, `condition`) or to
seed the hash with something moon cannot see (`fingerprint`, such as a system tool's
`--version`).

---

## Targets and the root project

**MTASK-17 — Inside `.moon/tasks/` files, refer to the owning project's tasks as
`~:<task>`; on the command line, quote targets that contain `#` or `~`.**
`moon run build` no longer means "the closest project"; use `moon run ~:build` or
`moon run frontend:build`.

**MTASK-18 — The root project holds only repository-level tasks, with narrow inputs.** It
opts out of the universal tasks and checks only the files no other project owns. Root
tasks default to no inputs, and the docs call whole-repo inputs "a very expensive
operation":

```yaml
# moon.yml  (root project)
layer: 'automation'
project:
  title: 'Repository root'
  description: 'Checks for root-level files that belong to no workspace.'
  owner: 'team-platform'
workspace:
  inheritedTasks:
    include: []
tasks:
  format:
    command: 'oxfmt'
    args: ['--check', 'README.md', 'package.json', '.github']
    inputs: ['/README.md', '/package.json', '/.github/**/*', '/.oxfmtrc.json']
```
