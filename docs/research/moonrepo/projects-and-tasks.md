# moonrepo (moon): Configuring Projects and Tasks

Research date: 2026-10-18. Primary source: moonrepo.dev/docs (currently documents moon v2). Frozen v1 docs: https://moonrepo.github.io/website-v1/ — [File groups](https://moonrepo.dev/docs/concepts/file-group).

Key URLs used:
- Project config reference: https://moonrepo.dev/docs/config/project
- Workspace tasks config reference: https://moonrepo.dev/docs/config/tasks
- Task inheritance: https://moonrepo.dev/docs/concepts/task-inheritance
- Tasks concept: https://moonrepo.dev/docs/concepts/task
- Projects concept: https://moonrepo.dev/docs/concepts/project
- Targets: https://moonrepo.dev/docs/concepts/target
- Tokens: https://moonrepo.dev/docs/concepts/token
- Create a task guide: https://moonrepo.dev/docs/create-task
- Workspace config (constraints, projects): https://moonrepo.dev/docs/config/workspace
- Root-level project guide: https://moonrepo.dev/docs/guides/root-project
- v2 migration guide: https://moonrepo.dev/docs/migrate/2.0
- Blog: https://moonrepo.dev/blog/archive, https://moonrepo.dev/blog/moon-v2.0

## Current major version and v1 → v2 changes to project/task config

### Takeaway
As of October 2026, moon is on **v2** (v2.0 "Phobos" shipped 2026-02-18; latest is **v2.6**, 2026-10-05). v2 renamed several project/task keys (`type`→`layer`, `platform`→`toolchains`, `local`→`preset: 'server'`), removed `.moon/tasks.yml` in favour of `.moon/tasks/all.yml`, replaced filename-based inheritance with an `inheritedBy` setting, flipped `inferInputs` to `false`, made `shell` default `true`, and restricted `command` to simple commands (complex shell goes in `script`). Any v1 tutorial or blog snippet should be checked against the list below.

### Cited Findings

**Release timeline**
- 2026 releases: v2 Alpha (Jan 1), Beta (Jan 13), RC (Jan 26), v2.0 "Phobos" (Feb 18), v2.1 (Mar 16, execution plans, target dependency scopes), v2.2 (Apr 13, daemon, AI skills), v2.3 (Jun 1, task tags, dep cache strategies), v2.4 (Jul 5, task checks), v2.5 (Aug 14, async engine default), v2.6 (Oct 5, cleanup and wait task deps). Last v1 release was v1.41 (2025-09-28). — [Blog archive](https://moonrepo.dev/blog/archive)
- v2.0 is described as the largest release yet with breaking changes; v1 users should not use `moon upgrade` to move to it. — [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0) (via search excerpt)
- The docs at moonrepo.dev are "currently for moon v2"; v1 docs are frozen and hosted separately. — [Migration guide](https://moonrepo.dev/docs/migrate/2.0); [Tasks concept](https://moonrepo.dev/docs/concepts/task)

**Project config (`moon.yml`) renames/removals in v2** — [Migration guide](https://moonrepo.dev/docs/migrate/2.0)
- `project.name` → `project.title`
- `type` → `layer`
- `toolchain` → `toolchains`; `platform` → `toolchains.default`
- `docker.scaffold.include` → `docker.scaffold.sourcesPhaseGlobs`
- `project.metadata` removed: "all custom metadata fields can now be defined at the root of the `project` setting."
- `toolchain.*.disabled` removed; set the toolchain to `null`/`false` (e.g. `typescript: null`).
- Language detection now comes from toolchains; "languages that don't have a toolchain yet, like PHP or Ruby, will not be detected and must be explicitly configured."

**Task config renames/removals in v2** — [Migration guide](https://moonrepo.dev/docs/migrate/2.0)
- `tasks.*.local` → `tasks.*.preset: 'server'`
- `tasks.*.platform` → `tasks.*.toolchains`
- `options.affectedPassInputs` → `options.affectedFiles.passInputsWhenNoMatch`; `affectedFiles` now accepts an object.
- Preset value `watcher` removed.
- `deps.*.args` no longer accepts a string; use a list.
- `command` supports only simple commands; piping, redirection, chaining and `KEY=value` prefixes must move to `script`. The blog says the old parser "split on spaces and mishandled quotes and escapes". — [Migration guide](https://moonrepo.dev/docs/migrate/2.0); [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
- Token renames: `$projectName` → `$projectTitle`, `$projectType` → `$projectLayer`, `$taskPlatform` → `$taskToolchain`.
- Env var substitution changed: `$VAR` becomes an empty string when the var is empty; `${VAR:-default}` and `${VAR:+alt}` are not supported.
- `.env` files now load just before task execution, so task `env` values can no longer reference them. With `envFile: true`, moon loads `.env`, `.env.local`, `.env.<task_id>` and `.env.<task_id>.local`; `*.local` files load only outside CI. — [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
- `MOON_AFFECTED_FILES` is now joined with the OS path separator, not a comma.
- `runInCI` is now respected by `moon run`/`moon exec`, not only `moon ci` (`moon exec --ignore-ci-checks` turns this off).
- New defaults: `options.inferInputs` = `false` (was `true`); `options.shell` = `true`; `unixShell` = `bash`; `windowsShell` = `pwsh`; `envFile: true` means a list of files.
- Avoid setting `toolchains` on tasks directly. A bare `node` no longer implies JavaScript or the package manager; if you must set it, use `['node', 'javascript', 'npm']`, or omit it so detection runs.

**Inheritance layout changes in v2**
- `.moon/tasks.yml` was removed. Put tasks that every project inherits in `.moon/tasks/all.yml` and do not set `inheritedBy` on that file. — [Migration guide](https://moonrepo.dev/docs/migrate/2.0)
- v1 inheritance "is based entirely on file naming conventions"; v2 uses the `inheritedBy` setting inside `.moon/tasks/**/*`. — [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
- **v1 only:** files were shallow-merged "from widest scope to narrowest" in this order: `.moon/tasks.yml` → `tasks/<language>.yml` → `<stack>.yml` → `<language>-<stack>.yml` → `<stack>-<layer>.yml` → `<language>-<layer>.yml` → `<language>-<stack>-<layer>.yml` → `tag-<name>.yml`. JS/TS also looked up `<toolchain>[-<stack>][-<layer>].yml` (e.g. `node.yml`). — [v1 Task inheritance (frozen)](https://moonrepo.github.io/website-v1/docs/concepts/task-inheritance)
- v2: "Global configs are now deep merged in sequence, rather than shallow merged into one config." The guide's example is a v1 `build` task that lost its `command` and `mutex` under shallow merge. — [Migration guide](https://moonrepo.dev/docs/migrate/2.0)
- v2: inherited file groups are now merged (e.g. `sources` gets both `src/**` and `docs/**`), where v1 kept only the last definition. — [Migration guide](https://moonrepo.dev/docs/migrate/2.0)
- v2 adds `mergeToolchains`, and tasks can belong to multiple toolchains. — [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
- v2.0 adds the `utility` preset, the `data` stack value, and custom fields under `project`. — [Project config](https://moonrepo.dev/docs/config/project)

**Post-2.0 additions relevant to tasks** — [Project config](https://moonrepo.dev/docs/config/project)
- v2.1: `runInSyncPhase`
- v2.3: task `tags`, `mergeTags`, dep `cacheStrategy`, and the task-tag target `app:#quality` ([Targets](https://moonrepo.dev/docs/concepts/target))
- v2.4: `checks` and project-level `taskOptions`
- v2.5: `workspace.mergeStrategies.env` and `.fileGroups`, and `env` in `.moon/tasks` ([Tasks config](https://moonrepo.dev/docs/config/tasks))
- v2.6: dep `type` (`required` | `wait` | `cleanup`), `envOverride` and `expectFailure`

### Inferences
- Treat any snippet with `type:`, `platform:`, `local: true`, `.moon/tasks.yml`, `.moon/tasks/node.yml` naming, or `&&`/pipes in `command` as v1 and port it.
- Because v2 deep-merges inherited configs, layered inheritance files are safer than in v1, where a narrower file could silently drop keys.

### Gaps
- I did not find an official v2 date for when the v1 docs were frozen, or any end-of-life date for v1.
- The full v2.0.0 changelog was not reviewed line by line; only the migration guide and blog were read.

## Inputs and outputs for correct caching

### Takeaway
If a task has no `inputs` (neither set nor inherited), moon treats **all files in the project (`**/*`)** as inputs. That is correct but coarse: any change in the project invalidates the cache. Root-level tasks are the exception and default to no inputs. Declare explicit, granular inputs, usually through file groups, plus any env vars that matter. Declare `outputs` for build tasks so moon can hydrate artifacts from cache. Watch the env-var, gitignore and glob-output pitfalls below.

### Cited Findings
- Default: if `inputs` is not defined or inherited, "all files within a project are considered an input" (`**/*`). Root-level tasks are excluded from this default. — [Project config](https://moonrepo.dev/docs/config/project)
- The "Create a task" guide says that without inputs a task "always runs" regardless of what changed, wasting time in CI and locally. — [Create a task](https://moonrepo.dev/docs/create-task). Note: this wording conflicts with the reference's `**/*` default. The likely reading is that any change in the project re-runs the task; see Inferences.
- Root-level project inputs used to default to `**/*`, which the guide calls "a very expensive operation!" Since v1.24, root-level tasks default to no inputs. For a one-off root task, the guide uses `inputs: []` with `cache: false`. — [Root-level project](https://moonrepo.dev/docs/guides/root-project)
- Input paths are relative to the project root; a leading `/` makes them workspace-root relative. Changes outside the declared inputs do not trigger a run. The guide's advice on granularity: "Be as granular or open as you want, the choice is yours!" — [Create a task](https://moonrepo.dev/docs/create-task)
  ```yaml
  tasks:
    build:
      command: 'webpack build --mode production --no-stats'
      inputs: ['src/**/*', 'webpack.config.js', '/webpack-shared.config.js']
  ```
- Accepted input forms: env vars (`$FOO`, wildcard `$FOO_*`), file paths (`file://`, `/` for workspace-relative), file groups (`@group(x)`, `group://`), globs with `!` negation, tokens, and other projects' groups via `project://shared?group=sources`. File inputs accept `optional` and `content` (regex) options; glob inputs accept `cache` (default `true`). — [Project config](https://moonrepo.dev/docs/config/project)
- Caution: env-var inputs are assumed undefined by default and mark the task affected when set. If a variable is always set, "then the task will always run and bypass the cache." — [Project config](https://moonrepo.dev/docs/config/project)
- Caution: files matched by a glob but excluded by `.gitignore` are not inputs. Use explicit file paths for them. — [Project config](https://moonrepo.dev/docs/config/project)
- `inferInputs` (default `false` in v2) infers inputs from file-group tokens and env vars substituted in `command`, `script`, `args` or `env`. — [Project config](https://moonrepo.dev/docs/config/project); [Migration guide](https://moonrepo.dev/docs/migrate/2.0)
- `implicitInputs` in `.moon/tasks/*.yml` are added to every inherited task, always, regardless of `mergeInputs` (e.g. `package.json`). — [Tasks config](https://moonrepo.dev/docs/config/tasks)
- Outputs are files or folders a task creates and are "required for hydration from cache". On a cache hit moon "hydrates all necessary outputs from the cache, then immediately exits." The `@out(0)` token references a declared output. — [Project config](https://moonrepo.dev/docs/config/project); [Create a task](https://moonrepo.dev/docs/create-task)
  ```yaml
  tasks:
    build:
      command: 'webpack build --mode production --no-stats --output-path @out(0)'
      outputs: ['build']
  ```
- **Danger:** with a glob output, a cache hit deletes every file in the output location that does not match the glob. — [Project config](https://moonrepo.dev/docs/config/project)
- Output files and globs accept an `optional` option (default `false`). — [Project config](https://moonrepo.dev/docs/config/project)
- Dep `cacheStrategy` (v2.3): `hash` (default when the dep declares outputs), `ignored` (default otherwise), or `outputs` (invalidate only when the dep's outputs change). — [Project config](https://moonrepo.dev/docs/config/project)
- Other cache controls: `cache` (`true` | `false` | `local` | `remote`), `cacheKey` (extra hash seed), `cacheLifetime` (e.g. `'1 day'`), and `checks` of type `fingerprint` (output hashed into the cache key, e.g. `node --version`). — [Project config](https://moonrepo.dev/docs/config/project)
- The guide recommends file groups with `@globs`/`@files` tokens to reduce repeated inputs and keep file layouts consistent. — [Create a task](https://moonrepo.dev/docs/create-task)

### Inferences
- The two docs disagree on what "no inputs" means. The reference states the `**/*` default; the guide says "always runs", which probably means "re-runs whenever anything in the project changes". In both readings the practical advice is the same: list explicit inputs.
- `inputs: []` (empty) is different from omitting inputs: it opts out of file-based invalidation. It is used in the docs for root one-off tasks.
- Avoid always-set env vars (such as `CI`) as inputs unless you intend to bust the cache.

### Gaps
- I found no doc text that explicitly reconciles "always runs" with the `**/*` default.

## Task inheritance vs per-project tasks; keeping it DRY yet overridable

### Takeaway
Define common tasks (format, lint, test, typecheck) once in `.moon/tasks/*.yml`, scoped with `inheritedBy`. Each project then:
- merges overrides into a same-named local task using `merge*` strategies (default `append`),
- tunes what it inherits with `workspace.inheritedTasks` (include, exclude, rename),
- or uses `extends` to derive a variant task.

Put tasks that only one project needs in that project's `moon.yml`.

### Cited Findings
- Global tasks in `.moon/tasks/**/*` are inherited by matching projects. The tasks config page recommends defining common tasks such as format, lint, test and typecheck there "to avoid repeating them in each project". Relative paths and globs resolve against the inheriting project's root. — [Tasks config](https://moonrepo.dev/docs/config/tasks)
  ```yaml
  # .moon/tasks/all.yml
  tasks:
    format:    { command: 'prettier --check .' }
    lint:      { command: 'eslint --no-error-on-unmatched-pattern .' }
    test:      { command: 'jest --passWithNoTests' }
    typecheck: { command: 'tsc --build' }
  ```
- `inheritedBy` (v2.0): if omitted or empty, all projects inherit. Conditions are ANDed; each condition takes a single value or an array (array = any of). `tags` and `toolchains` support `and`/`or` (default `or`)/`not` clauses. — [Task inheritance](https://moonrepo.dev/docs/concepts/task-inheritance)
  ```yaml
  inheritedBy:
    toolchains: { or: ['javascript', 'typescript'], not: ['ruby'] }
    stacks: ['frontend', 'backend']
    layers: ['library', 'tool']
  ```
- Supported conditions: `file(s)` (no globs), `language(s)`, `layer(s)`, `stack(s)`, `tag(s)` and `toolchain(s)`. The `language` condition matches only a `language` set explicitly in `moon.*`, not a detected one. — [Task inheritance](https://moonrepo.dev/docs/concepts/task-inheritance); [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0). The tasks config reference lists only `toolchains`, `stacks` and `layers` as keys. — [Tasks config](https://moonrepo.dev/docs/config/tasks). The two pages are inconsistent; the concept page and blog list more conditions.
- Global + local merge: a local task with the same name merges onto the global base, per field (`args`, `deps`, `env`, `inputs`, `outputs`, `toolchains`, plus `checks` and `tags`). Strategies:
  - `append` (default): good for toggling flag arguments.
  - `prepend`: for option args that must precede positional args.
  - `replace`: for full control.
  - `preserve` (v1.29): keeps the global values. The docs say it "should rarely be used"; it is meant for very long inheritance chains.

  Set `options.merge` for a default across all fields, or `mergeArgs`, `mergeDeps`, `mergeEnv`, `mergeInputs`, `mergeOutputs`, `mergeToolchains`, `mergeTags`, `mergeChecks` per field. — [Task inheritance](https://moonrepo.dev/docs/concepts/task-inheritance); [Project config](https://moonrepo.dev/docs/config/project)
  ```yaml
  # project moon.yml overriding a global `build`
  tasks:
    build:
      args: '--no-color --no-stats'
      deps: ['reactHooks:build']
      inputs: ['webpack.config.js']
      options: { mergeArgs: 'append', mergeDeps: 'prepend', mergeInputs: 'replace' }
  ```
- `script` never merges; it always replaces. Only `command`/`args` merge via `mergeArgs`. — [Tasks concept](https://moonrepo.dev/docs/concepts/task)
- Exclude, include and rename inherited tasks in `moon.yml`. The steps apply in order: include, then exclude, then rename.
  - `include`: undefined inherits all; `[]` inherits none.
  - `exclude`: names of global tasks to skip.
  - `rename`: map of original name to new name.

  — [Project config](https://moonrepo.dev/docs/config/project)
  ```yaml
  workspace:
    inheritedTasks:
      exclude: ['test']
      rename: { buildApplication: 'build' }
    mergeStrategies: { env: 'replace' }   # v2.5; also fileGroups
  ```
- `extends` (v1.12) on a task inherits from a sibling task or a global task, for variants such as `build-prod`. — [Project config](https://moonrepo.dev/docs/config/project)
- `extends` at the top of a `.moon/tasks` file pulls in other task files by HTTPS URL or relative path, for sharing across repos. For `env`, `fileGroups` and `tasks`, local entries win and maps are merged shallowly. — [Tasks config](https://moonrepo.dev/docs/config/tasks)
- `taskOptions` in `.moon/tasks/*.yml` (v1.20) sets default options for the file's tasks and for inherited project tasks; it is the first link in the chain. Since v2.4, `taskOptions` in `moon.yml` sets per-project defaults and takes precedence over the workspace ones. — [Tasks config](https://moonrepo.dev/docs/config/tasks); [Project config](https://moonrepo.dev/docs/config/project)
- `implicitDeps` (e.g. `'^:build'`) is added to every inherited task regardless of `mergeDeps`. Exceptions: persistent tasks don't inherit `cleanup` deps, and self-references are skipped. — [Tasks config](https://moonrepo.dev/docs/config/tasks)
- `env` in `.moon/tasks` (v2.5) merges into project `env`; project values win. Task `env` wins over project `env`. — [Tasks config](https://moonrepo.dev/docs/config/tasks); [Project config](https://moonrepo.dev/docs/config/project)
- The root-level project inherits every global task like any other project. Limit this with `workspace.inheritedTasks.include: []`. — [Root-level project](https://moonrepo.dev/docs/guides/root-project)

### Inferences
- A practical pattern: put universal tasks in `all.yml` and add scoped files (for example `js-frontend-library.yml` with `inheritedBy`). Projects then mostly override with `args`/`inputs` using the default `append`, and switch to `replace` only when needed.
- Set `language` explicitly in `moon.yml` if inheritance depends on it, because detected languages don't count.

### Gaps
- The docs don't spell out how multiple matching `.moon/tasks/*.yml` files are ordered in v2 (file order versus specificity). The migration guide says only "deep merged in sequence."
- There is a docs inconsistency on `inheritedBy` keys (see above). Test against the installed version.

## Recommended task options and when to use them

### Takeaway
Defaults: cache on, `runInCI: affected`, deps run in parallel, `shell: true` (v2), run from the project root, `append` merge. Change them as follows:
- Dev servers: `preset: 'server'`.
- One-off local commands (migrations and similar): `preset: 'utility'` (v2).
- Tasks that need stdin: `interactive`.
- Helper tasks that should only run as dependencies: `internal`.
- Tasks that can't run concurrently: `mutex`.
- Lint-only-changed-files flows: `affectedFiles`.
- Sequential dependencies: `runDepsInParallel: false`.

### Cited Findings
All rows in the options table below are from [Project config](https://moonrepo.dev/docs/config/project) unless noted.

| Option | Default | Use / caveat |
|---|---|---|
| `cache` | `true` | Values: `false`, `local`, `remote`. `false` skips hashing and output persistence. |
| `runInCI` | `affected` (`true`) | `always`, `false`, `only`, `skip`. Persistent tasks default to `false`. A CI task can't depend on a non-CI task; use `skip` on the dep. In v2 it's also respected by `moon run` ([Migration](https://moonrepo.dev/docs/migrate/2.0)). |
| `persistent` | `false` | Long-running; runs in parallel and never blocks later tasks. Non-persistent tasks can't depend on it except via a `wait` dep. Can't have cleanup deps. |
| `interactive` | `false` | Needs stdin; runs in isolation, one at a time; disables cache and CI. |
| `internal` | `false` | Hidden; can't be run from the CLI, but can be a dependency. |
| `outputStyle` | pipeline default | `buffer`, `buffer-only-failure`, `hash`, `none`, `stream`. Applies to non-primary targets unless `experiments.explicitTaskOutputStyle` is set. |
| `runDepsInParallel` | `true` | `false` runs deps serially, including their subtrees. |
| `merge` / `mergeX` | `append` | See inheritance section. |
| `affectedFiles` | off | `true`, `args`, `env`, or an object `{pass, filter, ignoreProjectBoundary:false, passDotWhenNoResults:true, passInputsWhenNoMatch:false}`. Used with `--affected`. Don't also put explicit files in `args`. |
| `shell` | `true` in v2 ([Migration](https://moonrepo.dev/docs/migrate/2.0)) | The project reference says `true` for system toolchain or Windows, `false` otherwise. This conflicts with the migration guide; see Gaps. `unixShell` defaults to `bash`, `windowsShell` to `pwsh`. |
| `runFromWorkspaceRoot` | `false` | Tasks run from the project root by default. |
| `mutex` | none | Tasks sharing a mutex name never run concurrently, even across projects. |
| `retryCount` | `0` | Not retried after an abort or interrupt. |
| `timeout` | none | Seconds. |
| `priority` | `normal` | `critical`, `high`, `low`. Respects topological order. |
| `allowFailure` / `expectFailure` (v2.6) | `false` | Mutually exclusive. Other tasks can't depend on an `allowFailure` task (except as cleanup). Exit codes 126, 127 and 129–192 never count as an expected failure. |
| `envFile` / `envOverride` (v2.6) | off | By default, system env vars win over task `env`. |
| `os` | all | The task is a no-op on other OSes. |
| `cacheKey`, `cacheLifetime`, `runInSyncPhase` (v2.1) | — | — |

- Presets (v1.28):
  - `server`: cache off, `outputStyle: stream`, persistent, `runInCI: false`.
  - `utility` (v2.0): cache off, interactive, stream, not persistent, `runInCI: skip`.
  - Tasks named `dev`, `start` or `serve` get `server` automatically.

  — [Project config](https://moonrepo.dev/docs/config/project)
- The v2.0 blog describes `utility` as "designed for simple one-off tasks that primarily run locally" (migrations, data validation). — [moon v2.0 blog](https://moonrepo.dev/blog/moon-v2.0)
- Command vs script: `command` + `args` support inheritance merging and CLI passthrough args, and don't always run in a shell. `script` (a string only) supports `&&`, `;`, pipes and redirects, always runs in a shell, and always replaces on inheritance. — [Tasks concept](https://moonrepo.dev/docs/concepts/task)
- In array-form `args`, put each flag and its value in separate items (`'--maxWorkers', '3'`, not `'--maxWorkers 3'`). — [Project config](https://moonrepo.dev/docs/config/project)
- Task `env` doesn't override system variables unless `envOverride` is set; it supports `${VAR}` substitution. — [Project config](https://moonrepo.dev/docs/config/project)
- `checks` (v2.4) run before the task:
  - `requirement` (the default for a plain string): must exit 0.
  - `condition`: skips the task if all such checks exit 0.
  - `fingerprint`: hashed into the cache key.

  — [Project config](https://moonrepo.dev/docs/config/project)
- Task types are derived from settings: `build` if it has `outputs`, `run` if `persistent`, otherwise `test` (the default, which covers lint, typecheck and tests). — [Tasks concept](https://moonrepo.dev/docs/concepts/task)

### Inferences
- Prefer `command`/`args` over `script` for anything that should be inheritable or accept passthrough args. Use `script` only for real shell composition.
- Use `preset` rather than hand-setting cache, persistent and runInCI. The presets bundle the right combination.

### Gaps
- Conflict on the `shell` default: the [migration guide](https://moonrepo.dev/docs/migrate/2.0) says `true`, while the [project config](https://moonrepo.dev/docs/config/project) fetch summarised it as "`true` for system toolchain or Windows, `false` otherwise." Verify against the installed v2.x.

## Layers, tags, and constraints for architectural boundaries

### Takeaway
Give each project a `layer` (application, automation, tool, library, scaffolding, configuration), a `stack` (frontend, backend, data, infrastructure, systems) and `tags`. Then set workspace `constraints.enforceLayerRelationships` (layer and stack based) and `constraints.tagRelationships` (tag → required dependency tags). moon then fails on boundary violations when it builds the project graph or runs tasks.

### Cited Findings
- `layer` values: `application`, `automation` (v1.16), `configuration` (v1.22), `library`, `scaffolding` (v1.22), `tool`, `unknown` (default). `layer` is used by inheritance, constraints and editors. — [Project config](https://moonrepo.dev/docs/config/project)
- `stack` (v1.22) values: `backend`, `data` (v2.0), `frontend`, `infrastructure`, `systems`, `unknown`. `tags` is a list of strings used for querying, constraints and inheritance. — [Project config](https://moonrepo.dev/docs/config/project)
  ```yaml
  id: 'web-app'
  language: 'typescript'
  layer: 'application'
  stack: 'frontend'
  tags: ['react', 'prisma']
  ```
- Constraints are "project boundaries" enforced during project graph generation. — [Workspace config](https://moonrepo.dev/docs/config/workspace)
- `enforceLayerRelationships` (v2 name; v1 key was `enforceProjectTypeRelationships`; see Gaps):
  - A layer may depend on lower layers in the same stack, not higher ones.
  - A layer may depend on its own layer, except `automation` and `application`.
  - Listed order, top to bottom: automation, application, tool, library, scaffolding, configuration, unknown.
  - Projects with an unknown or unconfigured layer are ignored.
  - With `stack` set, the rules shift: for example, a frontend application may depend on a backend application, but not on another frontend application.
  - A violation raises a layering violation error.

  — [Workspace config](https://moonrepo.dev/docs/config/workspace)
- `tagRelationships` maps a tag to the tags its dependencies must have. For example, `next: ['react']` means projects tagged `next` may depend only on projects tagged `react`; a missing tag is an error. — [Workspace config](https://moonrepo.dev/docs/config/workspace)
  ```yaml
  # .moon/workspace.yml
  constraints:
    enforceLayerRelationships: true
    tagRelationships:
      next: ['react']
  ```
- `dependsOn` entries are strings or `{id, scope}`. Scopes: `production` (default), `development`, `build`, `peer`. — [Project config](https://moonrepo.dev/docs/config/project)
  ```yaml
  dependsOn:
    - 'apiClients'
    - { id: 'designSystem', scope: 'peer' }
  ```
- Implicit dependencies are discovered by moon by scanning the repo; this depends on `language`/toolchain ecosystem (e.g. `package.json`). Explicit dependencies come from `dependsOn`. — [Projects concept](https://moonrepo.dev/docs/concepts/project)
- `owners` (`defaultOwner`, `paths`, `requiredApprovals` default 1, `optional`, `customGroups`) generates code-owners files. moon provides "no validation or guarantees that these are correct." — [Project config](https://moonrepo.dev/docs/config/project)
- `project` metadata: `title`, `description` (marked required; make it detailed because it is indexed for search), `owner` (team or org, avoid individuals), `maintainers`, `channel` (with `#`), and v2 custom fields readable via `@meta(key)`. — [Project config](https://moonrepo.dev/docs/config/project); [Tokens](https://moonrepo.dev/docs/concepts/token)

### Inferences
- Unknown-layer projects escape enforcement. To make constraints meaningful, set `layer` on every project, perhaps checked in review or by a lint.

### Gaps
- The docs page didn't state defaults for `enforceLayerRelationships` or `tagRelationships`.
- I did not confirm the v1 key name `enforceProjectTypeRelationships` from the v1 docs. It is plausible given the `type`→`layer` rename, but unverified.

## Naming conventions for project IDs and task names

### Takeaway
The docs don't prescribe a case style. IDs and task names may be camelCase, kebab-case or snake_case, using Unicode letters, digits, `_`, `-`, `/` and `.`, and must start with a letter. The docs' own examples mostly use camelCase (`designSystem`, `apiClients`, `typecheck`). For glob-discovered projects, avoid ID collisions with `globFormat: 'source-path'` or an explicit `id`.

### Cited Findings
- Project IDs: camel, kebab or snake case; allowed characters are alphabetic Unicode, `0-9`, `_`, `-`, `/`, `.`; must start with a character. Set in `.moon/workspace` `projects`. — [Projects concept](https://moonrepo.dev/docs/concepts/project)
- Task IDs follow the same rules; ID + scope = target. — [Tasks concept](https://moonrepo.dev/docs/concepts/task)
- Aliases can't be configured; they are derived from the toolchain (e.g. the `package.json` `name`). On referencing by ID or alias: "Choose the pattern that makes the most sense for your company or team!" — [Projects concept](https://moonrepo.dev/docs/concepts/project)
- Glob-discovered IDs come from the folder name. Collisions are likely; moon warns and skips the duplicate. `globFormat: 'source-path'` uses the workspace-relative path instead. `id` in `moon.yml` (v1.18) overrides the ID, and all references must then use the new ID. — [Workspace config](https://moonrepo.dev/docs/config/workspace); [Project config](https://moonrepo.dev/docs/config/project)
- Root project via globs: the name is inferred from the repo folder name, which varies by checkout. Prefer the map form `root: '.'`. — [Root-level project](https://moonrepo.dev/docs/guides/root-project)
- Task names `dev`, `start` and `serve` automatically get the `server` preset, so these names carry behaviour. — [Project config](https://moonrepo.dev/docs/config/project)

### Inferences
- Pick one case convention repo-wide. Note that the reserved-behaviour names (`dev`, `start`, `serve`) imply `server`.

### Gaps
- I found no official "we recommend camelCase/kebab-case" statement.

## Targets, tokens, and file groups (reference)

### Cited Findings
- Target scopes. — [Targets](https://moonrepo.dev/docs/concepts/target)

  | Scope | Example | Where |
  |---|---|---|
  | project | `app:lint` | CLI + config |
  | project tag (v1.4) | `'#frontend:lint'` | CLI + config |
  | task tag (v2.3) | `app:#quality` | CLI + config |
  | all projects | `:lint` | CLI only |
  | closest project (v1.33) | `'~:lint'` | CLI only |
  | dependencies | `'^:build'` | config deps only |
  | owning project | `~:typecheck` or bare `typecheck` | config deps only |

  - Quote `#` and `~` targets in shells.
  - Use the owning-project shorthand in `.moon/tasks` files, where the project is unknown.
  - `^` expands to all dependencies; list them explicitly if you don't want all of them.
- Dep objects: `target`, `args` (a list in v2), `env`, `optional` (for deps that may not exist after inheritance), `cacheStrategy`, and `type` (v2.6) `required` | `wait` | `cleanup`. `wait` and `cleanup` deps don't contribute to the hash. `wait` deps can't be interactive. `cleanup` deps can't be persistent and don't run after Ctrl+C. — [Project config](https://moonrepo.dev/docs/config/project)
- Token functions (each must be the whole value):
  - `@group`, `@dirs`, `@files`, `@globs`, `@root`: usable in args, env, inputs and outputs. Prefer `@group` in outputs, since `@files`/`@dirs` drop missing paths.
  - `@envs`: inputs only.
  - `@in(i)` and `@out(i)`: script and args.
  - `@meta(key)`: project metadata.

  — [Tokens](https://moonrepo.dev/docs/concepts/token)
- Token variables (can sit inside a larger value): `$project`, `$projectRoot`, `$projectSource`, `$projectLayer`, `$projectStack`, `$projectTitle`, `$language`, `$workspaceRoot`, `$target`, `$task`, `$taskToolchain(s)`, `$taskType`, `$os`/`$arch`, `$vcsBranch`/`$vcsRevision`, `$date`/`$timestamp`. Unset enum values resolve to `unknown`. — [Tokens](https://moonrepo.dev/docs/concepts/token)
- File groups are named globs, paths or env vars, relative to the project. Defining them in `.moon/tasks` "is useful for enforcing layout conventions" (e.g. `sources: ['src/**/*']`, `tests: ['tests/**/*']`). — [Tasks config](https://moonrepo.dev/docs/config/tasks)
- File group merge behaviour conflicts between pages. The concept page says a project-level group overrides a same-named workspace group. — [File groups](https://moonrepo.dev/docs/concepts/file-group). The migration guide and project config say inherited groups are merged in v2, with local entries appended by default, and `workspace.mergeStrategies.fileGroups: replace` (v2.5) restores override behaviour. — [Migration guide](https://moonrepo.dev/docs/migrate/2.0); [Project config](https://moonrepo.dev/docs/config/project). Treat the concept page as likely stale.

## Long-running/dev-server tasks and build → test → lint pipelines

### Takeaway
Model dev servers with `preset: 'server'` (or by naming the task `dev`/`start`/`serve`). Model one-off local commands with `preset: 'utility'`. Chain work with `deps`: for example, `build` with `outputs`, `^:build` via `implicitDeps`, and `test`/`lint`/`typecheck` depending on build outputs with `cacheStrategy: 'outputs'` where useful. For e2e-style flows (v2.6), use `wait` deps to start a server and `cleanup` deps to tear it down.

### Cited Findings
- `server` preset: cache off, stream output, persistent, not run in CI. It is meant for development servers, and output is not captured. — [Tasks concept](https://moonrepo.dev/docs/concepts/task); [Project config](https://moonrepo.dev/docs/config/project)
  ```yaml
  tasks:
    dev:
      command: 'vite'
      preset: 'server'
  ```
- Persistent tasks run in parallel, don't block later actions, and guarantee their deps completed. A non-persistent task "cannot" depend on a persistent one (an error at task build time); use a `wait` dep instead. — [Tasks concept](https://moonrepo.dev/docs/concepts/task)
- "Servers (persistent tasks) don't run in CI by default." A CI task can't wait on a non-CI task, so enable `runInCI` on a server that a CI task waits on. — [Create a task](https://moonrepo.dev/docs/create-task)
  ```yaml
  tasks:
    e2e:
      deps:
        - { target: 'web:serve', type: 'wait' }
        - { target: 'web:stop', type: 'cleanup' }
  ```
- `implicitDeps: ['^:build']` in `.moon/tasks` builds shared dependencies first, for every inherited task. — [Tasks config](https://moonrepo.dev/docs/config/tasks)
- Deps run in parallel by default; set `runDepsInParallel: false` for serial order. — [Project config](https://moonrepo.dev/docs/config/project)
- Dep `cacheStrategy: 'outputs'` invalidates a dependent only when the dep's outputs change. — [Project config](https://moonrepo.dev/docs/config/project)
- Interactive tasks run one at a time, in isolation. Internal tasks act as pipeline building blocks hidden from the CLI. — [Tasks concept](https://moonrepo.dev/docs/concepts/task)
- The v1 `local: true` setting is now `preset: 'server'`, and the `watcher` preset was removed in v2. — [Migration guide](https://moonrepo.dev/docs/migrate/2.0)

### Inferences
- A typical v2 layout:
  - `.moon/tasks/all.yml` defines `lint`, `typecheck` and `test` with file-group inputs and `implicitDeps: ['^:build']`.
  - Each library's `moon.yml` defines `build` with `outputs`.
  - Apps add `dev` (server preset) and `e2e` (`wait`/`cleanup` deps).

### Gaps
- The docs offer no single canonical "build → test → lint" pipeline example; the layout above is assembled from the reference pages.
