# moon Standards

These standards cover repositories that use [moon](https://moonrepo.dev) v2 as the task
runner and build system for the monorepo: the workspace and toolchain config, projects
and inherited tasks, caching and CI, Docker images, code generation, and the JavaScript
and Python toolchains. They apply only once a repository has a `.moon/workspace.yml`;
until then the other standards apply unchanged.

They were distilled from the
[moon v2 research report](../../research/moonrepo/moonrepo-best-practices.md) (October
2026, moon v2.6.2) and its notes in [../../research/moonrepo/](../../research/moonrepo/).
The report labels each finding, and the rules follow the labels:

| Report label | Meaning                                  | Becomes                                              |
| ------------ | ---------------------------------------- | ---------------------------------------------------- |
| [Doc]        | moonrepo's docs recommend it             | MUST or SHOULD                                       |
| [Default]    | moon's behaviour with no config          | a rule only where the default must be kept or overridden |
| [Inference]  | the report's own reasoning from the docs | SHOULD or MAY, marked _(judgement call)_             |

The one idea behind all of them is an **honest hash**: pinned versions, explicit inputs,
declared outputs, detected toolchains, and side-effect tasks kept out of the cache, so a
task reruns exactly when its result would change.

**Versions.** Version numbers in snippets (moon `2.6.2`, proto `0.63.0`, tool versions in
`.prototools`) are placeholders. The repository's pins live in `.prototools`,
`.moon/toolchains.yml`, and `versionConstraint` (MWS-2), and upgrading moon means
re-checking the working assumptions below.

## Documents

| Document                                                     | Prefix  | Covers                                                                 |
| ------------------------------------------------------------ | ------- | ---------------------------------------------------------------------- |
| [workspace-and-toolchains.md](workspace-and-toolchains.md)   | `MWS`   | v1 ban, version pins, `.prototools`, workspace file, VCS hooks         |
| [projects-and-tasks.md](projects-and-tasks.md)               | `MTASK` | `moon.yml`, inherited tasks, inputs and outputs, presets, targets      |
| [caching-and-ci.md](caching-and-ci.md)                       | `MCI`   | `moon ci` in GitHub Actions, remote cache, run reports, debugging      |
| [docker-and-codegen.md](docker-and-codegen.md)               | `MDOCK` | scaffold/setup/prune Dockerfiles, `.dockerignore`, `moon generate`     |
| [javascript-and-python.md](javascript-and-python.md)         | `MLANG` | `javascript`/`node`/`pnpm`/`typescript` and `unstable_python`/`uv`     |

## How these relate to the other standards

The README's rule holds: the more specific document wins. In a moon workspace a moon
document is the more specific one for how tasks are defined, selected, cached, and
built, and the existing documents stay authoritative for everything else (tool
configuration, workflow security, image hardening, code). Each overlap is named in the
rule that causes it:

| Existing rule                                         | moon rule        | Outcome in a moon workspace                                                       |
| ----------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| NODE-1 `.nvmrc`, PY-5 `.python-version`               | MWS-3, MLANG-12  | `.prototools` is the version source; keep the others only if read, and equal      |
| ENV-24 automated pin updates                          | MWS-3            | still applies; `.prototools` needs Renovate, which ENV-24 permits                 |
| MONO-11, MONO-12 workspace scripts; FMT-11 root lint  | MTASK-3          | moon tasks win; root scripts MAY alias `moon run`; FMT-2/6/7/12 unchanged         |
| GHA-6 `changes` job; CI-1, CI-5, CI-7, CI-9, CI-11    | MCI-1            | `moon ci` wins for moon tasks; GHA-7, GHA-9, GHA-13, Compose and image jobs stay  |
| GHA-5 full runs on push                               | MCI-8            | kept, via `moon run` over every CI target                                         |
| GHA-18 report-step condition                          | MCI-7            | GHA-18 wins over the moon docs' `success() \|\| failure()`                        |
| GHA-7 every job in `ci-success`'s `needs`             | MCI-7            | exception: the `moon-report` comment job is left out, like `publish`              |
| GHA-25 no elevated access for PR code                 | MCI-13           | applied to remote cache writes: only `main`/tag/dispatch runs hold the write credential |
| GHA-24 allowed actions                                | MCI-5            | GHA-24 applies; adopting moon adds the two `moonrepo/*` actions to its list       |
| ENV-17 install pattern                                | MDOCK-1          | moon's scaffold/setup wins; ENV-14/15/18/20/21/24 otherwise apply                 |
| ENV-20 `pnpm deploy` `-prod` stage                    | MDOCK-4          | ENV-20 kept as the default; a pruned workspace MAY replace it                     |
| NODE-2 no `npm` in Dockerfiles                        | MDOCK-2          | NODE-2 wins; moon is installed through proto, not the guide's `npm install -g`    |
| MONO-2 `workspace:*`                                  | MLANG-3          | MONO-2 wins over the report's `workspace-caret` suggestion                        |
| TS-3 `tsconfig.common.json`                           | MLANG-6          | TS-3 wins over moon's inconsistent shared-config names                            |
| FMT-1, FMT-13 oxfmt/oxlint; PY-8, PY-9 Ruff/pyright   | MTASK-4, MLANG-10 | the tool standards win; moon's ESLint/Prettier/mypy examples are translated      |

## Working assumptions

The moon docs contradict themselves in places. These rules take the report's working
assumption; each is unverified until checked against the pinned version:

| Topic                         | Conflict                                                     | Assumption                                         | Rule      |
| ----------------------------- | ------------------------------------------------------------ | -------------------------------------------------- | --------- |
| Task with no inputs           | `**/*` of the project vs "always runs"                       | always declare inputs                              | MTASK-6   |
| `shell` default               | always `true` vs only for system toolchain/Windows          | shell syntax goes in `script`                      | MTASK-9   |
| `inheritedBy` conditions      | six conditions vs three                                      | use `toolchains`, `stacks`, `layers` only          | MTASK-4   |
| File-group merging            | override vs merge                                            | merge (v2); `mergeStrategies.fileGroups: replace`  | MTASK-5   |
| Built-in extensions           | must be enabled vs enabled by default                        | declare them explicitly                            | MWS-12    |
| Hook sync command             | `moon sync hooks` vs `moon sync vcs-hooks`                   | `vcs-hooks`, no `.sh` extension                    | MWS-17    |
| Docker skeleton directory     | `.moon/docker/workspace` vs `.moon/docker/configs`           | `configs`                                          | MDOCK-1   |
| CI manual cache paths         | `{hashes,outputs}` vs `blobs/`, `manifests/`                 | use the remote cache instead                       | MCI-11    |
| `setup-toolchain` cache key   | names v1 `.moon/toolchain.yml`                               | bump `cache-version` on toolchain edits            | MCI-4     |
| Python key                    | `unstable_python` vs bare `python`                           | `unstable_python` in toolchains; `python` in `inheritedBy` (checked v2.6.2) | MLANG-8   |
| TS shared config name         | three different names                                        | TS-3's `tsconfig.common.json`                      | MLANG-6   |
| Version precedence            | `toolchains.<id>.version` vs `.prototools`                   | `.prototools` only                                 | MWS-3     |

## Conventions used in these documents

**Layout and IDs.** Examples use the [monorepo.md](../monorepo.md) MONO-1 layout, so the
moon projects are `frontend`, `backend`, `shared` (`@app/frontend`, `@app/backend`,
`@app/shared`), and `root`. Examples use the same **users / projects / tasks** domain as
the rest of the standards; a moon "task" is always a moon task, never the domain entity,
unless the text says so.

**Rule IDs.** Every prefix starts with `M` for moon, so it cannot collide with an
existing prefix (`WS` is the WebSocket standard).

## How to read a rule

Every rule has an ID so reviews can cite it (for example, "violates `MTASK-6`").

- **MUST / MUST NOT** — required. A review should block on a violation.
- **SHOULD / SHOULD NOT** — the default. Deviate only with a stated reason (a code comment
  or PR note).
- **MAY** — permitted; use judgement.

_(judgement call)_ marks a rule that rests on the report's inference rather than on
moon's docs; challenge it with evidence from the pinned version. moon's own validation
(`moon` refusing a config, `versionConstraint`, `enforceLayerRelationships`) is the final
authority on anything it enforces automatically.
