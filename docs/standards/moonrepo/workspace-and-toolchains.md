# moon Workspace and Toolchain Standards

Applies to the files that configure moon for the whole repository: `.moon/workspace.yml`,
`.moon/toolchains.yml`, `.moon/extensions.yml`, the root `.prototools`, and moon's VCS
hooks. Task files under `.moon/tasks/` are in [projects-and-tasks.md](projects-and-tasks.md);
language toolchain settings are in [javascript-and-python.md](javascript-and-python.md).

**Source of truth:** `.prototools`, `.moon/workspace.yml`, `.moon/toolchains.yml`,
`.moon/extensions.yml`.

---

## Version and vocabulary

**MWS-1 — Use moon v2 vocabulary only. v1 files, keys, tokens, and flags MUST NOT appear in
config, scripts, workflows, or docs.** Much of the material still in circulation
(moonrepo's `examples` repo, the FAQ, the `setup-toolchain` README) is v1-era, and v1 keys
either fail to parse or silently mean something else. Before copying a snippet, check it
against this table, condensed from the
[research report](../../research/moonrepo/moonrepo-best-practices.md):

| Area      | Banned (v1)                                                       | Use (v2)                                                     |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| Files     | `.moon/toolchain.yml`, `.moon/tasks.yml`, `.moon/tasks/node.yml`  | `.moon/toolchains.yml`, `.moon/tasks/all.yml` + `inheritedBy` |
| Files     | `extensions:` in the workspace file                               | `.moon/extensions.yml`                                       |
| Files     | `.moon/docker/workspace`, `.git/hooks/*.sh`                       | `.moon/docker/configs`, `.moon/hooks` (no extension)         |
| Workspace | `runner`, `vcs.manager`, `vcs.syncHooks`, `unstable_remote`       | `pipeline`, `vcs.client`, `vcs.sync`, `remote`               |
| Workspace | `constraints.enforceProjectTypeRelationships`, `codeowners.syncOnRun` | `constraints.enforceLayerRelationships`, `codeowners.sync`   |
| Workspace | `docker.scaffold.include`, `docker.prune.installToolchainDeps`    | `docker.scaffold.configsPhaseGlobs` / `sourcesPhaseGlobs`, `docker.prune.installToolchainDependencies` |
| Toolchain | `node.packageManager`, `node.inferTasksFromScripts`, `node.pnpm`  | `javascript.packageManager`, `javascript.inferTasksFromScripts`, top-level `pnpm` |
| Toolchain | `node.rootPackageOnly`, `node.binExecArgs`                        | `javascript.rootPackageDependenciesOnly`, `node.executeArgs` |
| Project   | `type`, `platform`, `toolchain`, `project.name`, `project.metadata` | `layer`, `toolchains`, `project.title`, fields at the root of `project` |
| Project   | `toolchain.<id>.disabled`                                         | set the toolchain to `null`                                  |
| Task      | `local: true`, `platform`, `options.affectedPassInputs`, string `deps.*.args` | `preset: 'server'`, `toolchains` (but see MTASK-13), `options.affectedFiles.passInputsWhenNoMatch`, list args |
| Tokens    | `$projectName`, `$projectType`, `$taskPlatform`                   | `$projectTitle`, `$projectLayer`, `$taskToolchain`           |
| CLI       | `-u/--update-cache`, `--remote`, `--platform`, camelCase flags    | `-f/--force`, `--affected remote`, `--toolchain`, kebab-case flags |
| CLI       | `moon query hash`, `hash-diff`, `touched-files`                   | `moon hash`, `moon hash <a> <b>`, `moon query changed-files` |
| CLI       | `--no-bail`, `--profile`                                          | `moon exec --on-failure`, removed                            |
| CLI       | `moon generate <id> ./dest`, `moon run build` (closest project)   | `moon generate <id> --to ./dest`, `moon run ~:build`         |
| MQL       | `projectName`, `projectType`, `taskPlatform`                      | `projectId`, `projectLayer`, `taskToolchain`                 |

Removed outright, with no replacement: `hasher.batchSize`, `pipeline.archivableTargets`,
`docker.scaffold.copyToolchainFiles`, `preset: watcher`, `node.addEnginesConstraint`,
`node.packagesRoot`, and v1 `experiments.*`. Python is the one toolchain that keeps the
`unstable_` prefix (MLANG-8).

**MWS-2 — Pin moon to one minor and enforce it with `versionConstraint`.** moon ships a
minor release roughly every six weeks, and many keys only exist from a given minor. The
CLI itself is pinned in `.prototools` (`moon = "2.6.2"`, placeholder), the method the
[install guide](https://moonrepo.dev/docs/install) recommends; Dockerfiles install moon
from that pin (MDOCK-2). The constraint, the `.prototools` pin, and the `moon-version`
input of `setup-toolchain` (MCI-4) MUST name the same version, and are upgraded together
in one PR. Upgrading moon re-checks the working assumptions in the [README](README.md)
against the new version.

---

## Toolchain versions

**MWS-3 — Pin every tool version in the root `.prototools`, and nowhere else.** Since v2.0
every toolchain reads its version from `.prototools` (`versionFromPrototools: true`).
Use full versions (`24.21.0`), never aliases (`latest`, `stable`, `lts`), which move. Do
not set `version` in `.moon/toolchains.yml`: the docs give no precedence order when the
two disagree.

```toml
# .prototools  (versions are placeholders)
node = "24.21.0"
pnpm = "10.20.0"
python = "3.14.0"
uv = "0.9.5"
```

In a moon workspace this replaces `.nvmrc` ([nodejs.md](../nodejs.md) NODE-1) and
`.python-version` ([python.md](../python/python.md) PY-5) as the source of versions. Keep
either file only while something outside moon reads it (a non-moon CI job, `uv`), and then
it MUST name the same exact version. [docker-and-environment.md](../docker-and-environment.md)
ENV-24 requires every pin to be updated automatically; its Dependabot ecosystems do not
include `.prototools`, and the moon docs name Renovate for it, which ENV-24 permits.

**MWS-4 — Pin proto through moon's `proto.version`, not `proto = "…"` in `.prototools`.**
proto's trust model ignores the proto pin and most `[tools.*]` and `[settings]` entries in
an untrusted `.prototools` until someone runs `proto trust` (or CI is detected). Plain
tool pins (MWS-3) always apply.

**MWS-5 — `.moon/toolchains.yml` holds behaviour only, and declares only the toolchains the
repository uses:**

```yaml
# .moon/toolchains.yml
$schema: './cache/schemas/toolchains.json'
proto:
  version: '0.63.0' # placeholder
javascript:
  packageManager: 'pnpm'
node: {}
pnpm: {}
typescript: {}
```

Language-specific settings for each block are in
[javascript-and-python.md](javascript-and-python.md).

---

## Workspace file

**MWS-6 — `.moon/workspace.yml` follows this shape:**

```yaml
# .moon/workspace.yml
$schema: './cache/schemas/workspace.json'
versionConstraint: '>=2.6.0' # placeholder: the pinned minor (MWS-2)
projects:
  globs: ['*/moon.yml']
  sources:
    root: '.'
  globFormat: 'source-path'
vcs:
  client: 'git'
  defaultBranch: 'main'
  sync: false
  hooks:
    pre-commit:
      - 'moon run :lint :format --affected --status=staged'
constraints:
  enforceLayerRelationships: true
```

**MWS-7 — `vcs.defaultBranch` MUST be set to `main`.** Its default is `master`, and moon
diffs against the default branch to decide what is affected, so an unset value breaks
affected detection everywhere (MCI-1).

**MWS-8 — Discover projects with globs and `globFormat: 'source-path'`, and add the root
project through `sources`** _(judgement call)_. Glob-derived IDs otherwise come from
folder names, and a collision logs a warning and skips the project. A glob-inferred root
project takes the checkout's folder name as its ID, so name it explicitly (`root`). With
the [monorepo.md](../monorepo.md) MONO-1 layout, the IDs are `frontend`, `backend`,
`shared`, and `root`. Never share `projects` through `extends`: it does not merge.

**MWS-9 — Turn on `constraints.enforceLayerRelationships` explicitly** _(judgement call)_.
The docs never state its default. It ignores projects whose `layer` is `unknown`, so it
only works because every project declares one (MTASK-1). With `frontend` and `backend` as
`application` and `shared` as `library`, it enforces MONO-3's one-way dependencies.

**MWS-10 — Keep the hashing and pipeline defaults** _(judgement call)_: `hasher.optimization:
accuracy` (hashes lockfile-resolved versions; `performance` lets a lockfile-only upgrade
keep stale caches), `hasher.walkStrategy: vcs`, `hasher.warnOnMissingInputs: true`, and
the `pipeline` defaults. Do not set `notifier.webhookAcknowledge`, which the docs warn
slows the pipeline.

**MWS-11 — Keep the default experiments, and do not enable optional ones without a stated
reason.** The v2.5 guidance is to leave `asyncGraphBuilding`, `asyncAffectedTracking`, and
`nativeFileHashing` on, and to turn one off only if something breaks (and report it).
`casOutputsCache` and `explicitTaskOutputStyle` stay off; the docs warn experiments "may be
buggy".

**MWS-12 — Declare any extension you use in `.moon/extensions.yml`**, including built-ins
(`migrate-turborepo: {}`). The docs disagree on whether built-ins are enabled by default;
declaring them works under either reading.

**MWS-13 — Write moon config in YAML** _(judgement call)_. v2 also accepts JSON, JSONC,
TOML, HCL, and Pkl, but every doc example is YAML, `extends` targets are described as YAML
documents, and Pkl files are evaluated without inheritance merging.

**MWS-14 — Point `$schema` at the locally generated schemas**
(`./cache/schemas/workspace.json`, `../cache/schemas/tasks.json` from `.moon/tasks/`), not
the deprecated hosted `moonrepo.dev/schemas` URLs. `.moon/cache` is gitignored, so
onboarding runs `moon sync config-schemas` after a fresh clone.

**MWS-15 — Telemetry MAY be turned off** with the `MOON_TELEMETRY` environment variable
(`telemetry` defaults to `true`).

---

## VCS hooks

**MWS-16 — The pre-commit hook runs `moon run :lint :format --affected --status=staged`**,
the docs' recommended command, against tasks that set `options.affectedFiles: true`
(MTASK-6). Hook commands run from the repository root, so `moon` must be on `PATH`.

**MWS-17 — Keep `vcs.sync: false`; each developer installs hooks with
`moon sync vcs-hooks`** _(judgement call)_. The docs call `vcs.sync: true` "a sensitive
action" that regenerates hooks on every run for every user and "enables the execution of
arbitrary code" on their machines. The hooks guide says `moon sync hooks` and the command
index says `moon sync vcs-hooks`; this standard uses `vcs-hooks` until verified on the
pinned version. Put the command in the onboarding docs.

Gitignore `.moon/hooks/` _(judgement call, loosely held)_. The docs leave committing the
generated scripts to each repository ("Whether or not you commit or ignore these script
files is your choice"). `vcs.hooks` in `.moon/workspace.yml` is already the committed,
reviewable source, and committing the generated copy only adds a file that must be
regenerated whenever `vcs.hooks` changes, churns on moon upgrades, and differs on Windows
(`.ps1`). A committed copy would not install anything either: `core.hooksPath` is local
to each clone, so every developer still runs `moon sync vcs-hooks`. This choice is weakly
held: revisit it if stronger evidence turns up, such as moon guidance that favours
committing the scripts, or tooling that reviews or runs them from the repository.

**MWS-18 — Do not install a second hook manager (Husky, lefthook) alongside moon's hooks**
_(judgement call)_. moon points `core.hooksPath` at `.moon/hooks`, which takes the slot
those tools use, and the docs never discuss coexistence.
