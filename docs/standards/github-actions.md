# GitHub Actions Standards

Applies to everything under `.github/`: workflows, composite actions, Dependabot
configuration, CODEOWNERS, and the repository settings that govern Actions. What each
workflow checks lives in [ci-pipeline.md](ci-pipeline.md). Image builds, scanning, and
publishing live in [docker-and-environment.md](docker-and-environment.md) (ENV-24 to
ENV-30).

**Source of truth:** `.github/workflows/`, `.github/actions/`, `.github/dependabot.yml`,
`.github/CODEOWNERS`, and the repository's Actions settings and `main` ruleset on GitHub
(GHA-26).

**Basis.** The structure started from the workflows in `aoam-property-plan`, then was
checked against GitHub's documentation in October 2026
([research report](../research/github-actions-cicd-best-practices.md)). GitHub's guidance
wins wherever it gives any; rules marked _(non-GitHub)_ come from other sources. The
repository is **public**, which makes rulesets, environments with required reviewers,
artifact attestations, CodeQL, dependency review, and secret scanning free. Several rules
below depend on that.

---

## Layout and naming

**GHA-1 — One entry workflow, `ci.yml`, runs CI. Reusable workflows hold the work.**

```txt
.github/
  CODEOWNERS
  dependabot.yml
  actions/
    node-setup/action.yml     composite: pnpm, Node, install
  tools/
    actionlint/Dockerfile     pins the actionlint image so Dependabot updates it
  workflows/
    ci.yml                    entry: pull_request, push to main and v* tags, manual
    scan.yml                  entry: weekly schedule, manual (ENV-26)
    repo-lint.yml             reusable (on: workflow_call)
    shared-test.yml
    frontend-test.yml
    backend-test.yml
    docker-build.yml
```

An entry workflow decides _when_ work runs, _which_ areas run, and _with what
permissions_. Its jobs either call a reusable workflow or are short coordination jobs
(`changes`, `ci-success`). A reusable workflow decides _what_ runs, and it is the only
place check steps live. A new trigger is a new event on `ci.yml`, or a new entry workflow
that calls the same reusable workflows. It is never a copy of their steps.

`aoam-property-plan` gave each area its own pair of path-filtered trigger workflows.
GitHub leaves a workflow that a path filter skips in a "Pending" state, which blocks any
PR that requires it. So none of those workflows could be required checks, and change
detection moved into jobs (GHA-6, GHA-7).

**GHA-2 — An area is a commit scope that has something to check**
([COMMIT_CONVENTIONS.md](../../COMMIT_CONVENTIONS.md)): `repo` (repo-wide formatting,
lint, and workflow checks), `shared`, `frontend`, `backend`, and `docker` (production
images).

**GHA-3 — File names are kebab-case and end in `.yml`:**

| File              | Pattern                                   | Example                                 |
| ----------------- | ----------------------------------------- | --------------------------------------- |
| entry workflow    | `<purpose>.yml`                           | `ci.yml`, `scan.yml`                    |
| reusable workflow | `<area>-<task>.yml`                       | `frontend-test.yml`, `docker-build.yml` |
| composite action  | `.github/actions/<kebab-name>/action.yml` | `.github/actions/node-setup/action.yml` |

Use `.yml`, never `.yaml`, for every file under `.github/`.

**GHA-4 — Names follow one pattern**, because the Actions tab and the PR checks list show
them. Entry workflows are named by purpose (`name: "CI"`, `name: "Scan"`), and reusable
workflows are named `"<Area> <Task>"` (`name: "Frontend Test"`). Quote every `name:`
value. Job IDs are kebab-case and say what the job does (`test`, `typecheck`, `lint`,
`build`). In `ci.yml`, the job that calls an area's workflow is named after the area
(`frontend`), so each area's checks are grouped under its name.

---

## Triggers and change detection

**GHA-5 — `ci.yml` triggers on `pull_request` (no branch filter), `push` to `main` and
to `v*` tags, and `workflow_dispatch`. It has no `paths` filters.** A PR runs only the
areas it changes (GHA-6). Pushes and manual runs run every area. That gives `main` a full
result for every commit, and it keeps the dependency caches warm, because every PR branch
can read the default branch's caches.

**GHA-6 — A `changes` job detects which areas a PR touches, and each area's job is gated
with `if:`.** The job uses `dorny/paths-filter` _(non-GitHub)_, pinned by SHA (GHA-24). On
`pull_request`, it reads the PR's file list through the API, so it needs
`pull-requests: read` and no checkout. The filters are inline in `ci.yml`
([ci-pipeline.md](ci-pipeline.md) CI-4). An area's filter lists everything that area's
result depends on:

- the area's own workspace: `<area>/**`
- every workspace it depends on ([monorepo.md](monorepo.md) MONO-3): `shared/**` for
  `frontend` and `backend`
- root files that change installs or tooling: `package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `.nvmrc`, and root `tsconfig*.json`
- for areas built or tested in Docker: `compose.yaml`, `.dockerignore`,
  `docker-bake.hcl`, and the `.env*.example` templates
- its own CI files: `.github/workflows/<area>-*.yml`, plus `.github/actions/<name>/**`
  for every composite action it uses

Watch directories (`backend/**`), not file extensions. An extension list misses new file
types; in `aoam-property-plan`, a `backend/Dockerfile` change ran no backend tests. Use
positive patterns only, and sort them alphabetically.

An area job's condition is
`${{ !cancelled() && (github.event_name != 'pull_request' || needs.changes.outputs.<area> == 'true') }}`.
The status function is required. `changes` is skipped on pushes, and GitHub skips any job
whose `needs` was skipped unless the job's condition calls a status function. A skipped
area job reports "Success", which is what lets a single required check cover every area.

**GHA-7 — One aggregator job, `ci-success`, is the only required check.** It `needs`
every other CI job in `ci.yml` (everything except `publish`), runs with `if: always()`,
and fails unless every result is `success` or `skipped`. GitHub's guidance for required
checks is to "use `always()` with `needs` for required checks that depend on other jobs".
Here `always()` is correct where `!cancelled()` (GHA-18) would be wrong. If `ci-success`
were skipped because the run was cancelled, it would report "Success", and the required
check would pass. Every new CI job MUST be added to its `needs`; a job missing from that
list is not enforced.

**GHA-8 — Scheduled workflows set a minute other than `0` and a `timezone`, and say the
schedule in words in a comment.** GitHub warns that scheduled runs can be delayed or
dropped at the start of every hour. Schedules run only from the default branch. In a
public repository, GitHub disables scheduled workflows after 60 days without repository
activity, so re-enable `scan.yml` if that happens. Every scheduled workflow also has
`workflow_dispatch`, so it can be run by hand.

---

## Permissions

**GHA-9 — Entry workflows set `permissions: {}` at the top, and every job grants exactly
what it needs.** Comment every grant beyond `contents: read`:

| Job                                   | Grant                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `changes`                             | `pull-requests: read`                                                      |
| `repo`, `shared`, `backend`, `docker` | `contents: read`                                                           |
| `frontend`                            | `contents: read`, `pull-requests: write` (coverage comment, CI-8)          |
| `ci-success`                          | none                                                                       |
| `publish`                             | `contents: read`, `packages: write`, `attestations: write`, `id-token: write` |
| `scan.yml` job                        | `contents: read`, `security-events: write` (SARIF upload, ENV-26)          |

A job that calls a reusable workflow MUST set `permissions`; otherwise the called workflow
gets the repository's default token. Reusable workflows do not declare `permissions`: a
called workflow can only keep or narrow what its caller grants, so the caller's list is
the one that counts. Fork PRs and Dependabot PRs always run with a read-only token and no
secrets, whatever a job grants, so a step that writes (a PR comment, a SARIF upload)
skips itself in those runs (CI-8).

**GHA-10 — Reusable workflows take explicit inputs and secrets.** They are triggered by
`on: workflow_call` only, and declare typed `inputs` and `secrets`. Callers pass secrets
by name and never use `secrets: inherit`. Three limits of `workflow_call` shape them:

- a caller's workflow-level `env` does not reach the called workflow, so pass values as
  `inputs`
- a calling job can set only `name`, `uses`, `with`, `secrets`, `strategy`, `needs`,
  `if`, `concurrency`, and `permissions`, so `runs-on`, `timeout-minutes`, `defaults`,
  and `environment` live in the reusable workflow
- environment secrets cannot be passed through `workflow_call`, so a job that needs an
  environment declares it inside the reusable workflow (GHA-27)

---

## Jobs

**GHA-11 — Every job that runs steps sets `runs-on: ubuntu-24.04` and
`timeout-minutes`.** Pin the image version rather than `ubuntu-latest`. GitHub moves that
label to newer images (`ubuntu-26.04` is already available), so pin it and upgrade
deliberately, in its own PR. Check jobs use `timeout-minutes: 15`, and coordination jobs
(`changes`, `ci-success`) use `5`. A job that needs longer gets a higher value with a
comment. Without a timeout, a hung job runs for the 360-minute default. Calling jobs
cannot set either key (GHA-10).

**GHA-12 — Concurrency is set only on entry workflows and on publish or deploy jobs.**

```yaml
concurrency:
  group: ci-${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

A new push to a PR cancels that PR's superseded run. Each push to `main` gets its own
group and is never cancelled. Reusable workflows MUST NOT set concurrency keyed on
`${{ github.workflow }}`: the `github` context belongs to the caller, so the called
workflow's group would match the caller's and cancel it. Publish and deploy jobs use a
fixed group (`publish`, `deploy-production`) with `cancel-in-progress: false`.
`queue: max` (added 7 May 2026) MAY be used once actionlint accepts it.

---

## Steps

**GHA-13 — Check out with `actions/checkout` v6 or later (v7 is current), its default
`ref`, and `persist-credentials: false`.** On `pull_request`, the default is the merge of
the PR into its base, so CI tests what would land. Do not override it with
`ref: ${{ github.head_ref || github.ref_name }}` as `aoam-property-plan` did. That tests
the branch tip without newer commits on `main`, and it cannot find a branch that lives in
a fork. Since v6, checkout stores the token in a file under `$RUNNER_TEMP` instead of
`.git/config`, but by default it is still on disk for later steps, uploaded artifacts,
and Docker build contexts. Turn persistence off unless a later step pushes.

**GHA-14 — Every step has a `name:`, in sentence case.** A step that runs a check starts
with its phase emoji, so a failure is easy to find in the log:

| Emoji | Phase                            | Example                     |
| ----- | -------------------------------- | --------------------------- |
| 🏗️    | build a package                  | `"🏗️ Build shared"`         |
| 🐳    | build images                     | `"🐳 Build images"`         |
| 🐘    | start or prepare PostgreSQL      | `"🐘 Start database"`       |
| 🔎    | typecheck                        | `"🔎 Typecheck"`            |
| 🧹    | format, lint, or audit           | `"🧹 Audit workflows"`      |
| 🖊️    | run tests                        | `"🖊️ Run tests"`            |
| 📊    | report results or coverage       | `"📊 Report coverage"`      |
| 📦    | publish or attest                | `"📦 Attest image"`         |
| 🚀    | deploy                           | `"🚀 Deploy"`               |

Setup steps (checkout, Node setup, creating env files) have no emoji.

**GHA-15 — Run commands from the repository root through root scripts**
([monorepo.md](monorepo.md) MONO-11): `pnpm frontend:base typecheck`, not
`cd frontend && pnpm typecheck`. Use a step's `working-directory:` only for a tool that
has to run inside a workspace, and never `cd` inside `run:`.

**GHA-16 — Shell steps run in bash with errors on.** Every workflow with `run` steps sets:

```yaml
defaults:
  run:
    shell: bash
```

Without it, GitHub runs `bash -e {0}`, which has no `pipefail`. With an explicit
`shell: bash`, it runs `bash --noprofile --norc -eo pipefail {0}`, so a failing command,
even mid-pipe, fails the step. Use `run: |` for more than one command. Never turn errors
off (`set +e`) except around a bounded retry loop (GHA-22).

**GHA-17 — Keep untrusted input out of scripts.** PR titles, branch names, commit
messages, and other event payload fields are attacker-controlled. GitHub's first
preference is to pass such a value to an action as a `with:` input. In a script, pass it
through `env:` and read it as a double-quoted shell variable (`"$PR_TITLE"`). Never
interpolate it with `${{ }}` inside `run:`. Declare an `env` value only where something
reads it.

**GHA-18 — Use `if:` conditions precisely, and never `continue-on-error` on a check.**

- A step that reports on another step runs when that step ran, pass or fail: give the
  reported step an `id` and use
  `if: ${{ !cancelled() && steps.<id>.outcome != 'skipped' }}`. GitHub advises against
  `always()` for steps that follow a possibly failing setup step.
- `always()` is only for the required aggregator (GHA-7), and for cleanup that must run
  even when a run is cancelled. GitHub-hosted runners are discarded after each job, so
  teardown steps there are optional.
- A check that may fail without failing the job is not a check. Do not use
  `continue-on-error: true` or `|| true` on one.

**GHA-19 — Do not set up toolchains a job does not use.** A job that tests in Docker needs
only Docker, which the runner already has. `aoam-property-plan`'s backend job installed
Python on the runner even though its tests ran in a container.

---

## Composite actions

**GHA-20 — Composite actions hold setup only, never checks.** GitHub logs a composite
action "as one step even if it contains multiple steps", so a check hidden inside one
loses its own log section and emoji. Setup that two or more workflows repeat goes in a
composite action under `.github/actions/<name>/`, used after checkout
(`uses: ./.github/actions/node-setup`). Its `name:` and `description:` say exactly what
it does.

**GHA-21 — Inside a composite action:**

- every step has a `name:`
- every `run` step sets `shell: bash` (composite actions require it, and they do not read
  workflow `defaults`)
- a value that differs between callers is an input with a default, not a hard-coded path
- inputs reach scripts through `env:`, not `${{ inputs.* }}` inside `run:` (GHA-17)

**GHA-22 — Retries are a last resort, bounded, and verified.** Only a step known to fail
for transient reasons (a dependency install) may retry, and never a test or check. Make
at most three attempts, and clean up state between attempts. Check that the step
actually worked, not just its exit code: `aoam-property-plan` found that pnpm could exit
`0` after crashing. After the last failed attempt, print an error to stderr and `exit 1`.

---

## References and third-party actions

**GHA-23 — Reference this repository's workflows and actions with `./` until actionlint
supports `$/`.** Since 30 July 2026, GitHub has recommended the self-repository syntax
(`uses: $/.github/workflows/frontend-test.yml`, with no `@ref`) for same-repository
reusable workflows and actions. It needs no checkout, and it resolves against the file's
own repository at the running commit. actionlint 1.7.12 (30 March 2026), the latest
release in October 2026, predates it, and CI-12 runs actionlint on every PR. Switch every
`./` reference to `$/` in one PR once an actionlint release accepts it.

**GHA-24 — Pin every third-party action to a full commit SHA, with its release in a
comment, and let Dependabot update the pins** (ENV-24, ENV-27). GitHub calls a full SHA
"the only way to use an action as an immutable release". Take the SHA from the action's
own repository, never a fork. Tags can be moved: in March 2025 the tags of
`tj-actions/changed-files` were repointed to a secret-dumping commit, and on 19 March
2026 76 of 77 `trivy-action` tags were force-pushed to a credential stealer. Dependabot
raises no security _alerts_ for SHA-pinned actions, only update PRs, so zizmor's online
audits in CI-12 cover known-vulnerable actions _(non-GitHub)_.

Prefer actions from the tool's owner (`actions/*`, `github/*`, `docker/*`, `pnpm/*`).
The community actions allowed today are `dorny/paths-filter`,
`davelosert/vitest-coverage-report-action`, `zizmorcore/zizmor-action`, and
`aquasecurity/trivy-action` at v0.35.0 or later (ENV-26). Adding another action means
updating this list and the allowed-actions setting (GHA-26) in the same PR.

**GHA-25 — Never run PR code with elevated access.** Do not use `pull_request_target` or
`workflow_run`: both run with the base repository's secrets and a writable token, and
checking out PR code in them "can be exploited to take over a repository". GitHub has
added backstops:

- since 8 December 2025, `pull_request_target` always runs the default branch's workflow
- since 20 July 2026, `actions/checkout` refuses a fork's code under those triggers
- from 2 November 2026, public repositories without an event policy have
  `pull_request_target` disabled by default

None of these change the rule; they limit the damage if it is broken.

---

## Repository settings

**GHA-26 — The repository's GitHub settings are part of this standard.** Change them only
deliberately, and update this list in the same PR.

**Actions** (Settings → Actions → General):

- Workflow permissions: **Read repository contents and packages permissions**, with
  **Allow GitHub Actions to create and approve pull requests** off.
- Allowed actions: allow actions created by GitHub, plus the third-party actions listed
  in GHA-24. If the policy to require full-length commit SHAs (added 15 August 2025) is
  offered for this repository, turn it on.
- Fork pull request workflows: **Require approval for all external contributors**.

**`main` ruleset** (Settings → Rules → Rulesets), active, targeting the default branch,
with no bypass list:

- restrict deletions, block force pushes, require linear history
- require a pull request before merging, with 0 required approvals (a solo author cannot
  approve their own PR) and **squash** as the only allowed merge method
  ([git-workflow.md](git-workflow.md) GIT-5)
- require status checks to pass: `ci-success`, from GitHub Actions. GitHub only offers a
  check in the picker after it has run in the last seven days, so add the rule after the
  first CI run.
- MAY require code scanning results (CodeQL)

**Code security** (Settings → Advanced Security), all free for public repositories:

- dependency graph, Dependabot alerts, and Dependabot security updates on; version
  updates come from `.github/dependabot.yml` (ENV-24)
- CodeQL **default setup** on, covering `javascript-typescript` and `actions` (CodeQL has
  scanned workflow files since April 2025)
- secret scanning and push protection on
- private vulnerability reporting on, with a root `SECURITY.md` saying how to report
- MAY run the OpenSSF Scorecard action from `scan.yml` _(non-GitHub tool; GitHub's
  security guidance recommends it)_

**CODEOWNERS:** `.github/CODEOWNERS` assigns `* @saurookadook`, so outside PRs request a
review automatically. Code-owner review is not required, because a solo owner cannot
review their own PRs.

---

## Deployments

**GHA-27 — Deploys run from `ci.yml` after `publish`, through a reusable `deploy.yml`.**
No deploy target has been chosen yet; when one is, the deploy workflow:

- declares `environment: production` inside the reusable workflow (GHA-10); the
  environment allows deploys only from `main` and holds the deploy secrets
- MAY add the owner as a required reviewer, so production deploys wait for a click
  (continuous delivery rather than continuous deployment)
- authenticates with OIDC when the target supports it, trusting the token's
  `environment` claim; otherwise, with an SSH key stored as a `production` environment
  secret and a pinned host key
- verifies the image's attestation (`gh attestation verify`, ENV-26), then deploys by
  digest (ENV-30)
- uses `concurrency: { group: deploy-production, cancel-in-progress: false }` (GHA-12)
- ends with 🚀 a smoke check against `GET /api/health`; rollback is redeploying the
  previous digest

---

## Changing CI

**GHA-28 — A CI change is tested by CI.** `ci.yml` has no path filter, so every PR runs
the `repo` area, including actionlint and zizmor (CI-12). Area workflows run when their
own files change (GHA-6). Commit CI changes with type `ci`, scoped to the area the
workflow serves (`ci(frontend): report coverage on main`); changes to `ci.yml`, shared
actions, settings, or more than one area use `repo`. When a rule is re-checked against
GitHub's documentation, update the month in **Basis** above.
