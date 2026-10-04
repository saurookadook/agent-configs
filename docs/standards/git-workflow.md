# Git Workflow Standards

Applies to branches, commits, and pull requests.

---

## Branches

**GIT-1 — Branch names are `<type>/<kebab-case-summary>`:**

| Type        | Use for                                 | Example                          |
| ----------- | --------------------------------------- | -------------------------------- |
| `feat/`     | new behaviour                           | `feat/add-project-invites`       |
| `bug/`      | fixing incorrect behaviour              | `bug/fix-task-ordering`          |
| `chore/`    | renames, cleanup, tooling, dependencies | `chore/upgrade-nestjs`           |
| `refactor/` | restructuring without behaviour change  | `refactor/extract-config-module` |
| `docs/`     | documentation only                      | `docs/add-coding-standards`      |

Start the summary with a verb where it reads naturally (`add-…`, `fix-…`, `create-…`).

**GIT-2 — Do not commit directly to `main`.** Every change lands through a pull request.
The `main` ruleset enforces this ([github-actions.md](github-actions.md) GHA-26).

---

## Commits

**GIT-3 — Commit messages follow [`COMMIT_CONVENTIONS.md`](../../COMMIT_CONVENTIONS.md):**
Conventional Commits with a required scope.

```txt
feat(backend): add project invite endpoint
fix(frontend): keep task order stable after drag and drop
chore(backend): rename users service and module files
docs(standards): add testing standards
```

That file defines the allowed types and scopes, the description and body rules, and the
footers (including `BREAKING CHANGE:`).

**GIT-4 — Keep mechanical changes separate from behaviour changes.** File moves and
renames go in their own `chore(<scope>):` commits, so the substantive diff stays easy to
review.

---

## Pull requests

**GIT-5 — A PR title follows the same format as a commit subject (GIT-3):**

```txt
feat(backend): add project invites
fix(frontend): fix task ordering
refactor(backend): extract config module
```

PRs are squash-merged, so the title becomes the commit message on `main` (GitHub appends
`(#<number>)`).

**GIT-6 — Fill in the PR template** (`.github/PULL_REQUEST_TEMPLATE.md`):

- **Description** — what changed and why.
- **Other Details** — new or updated dependencies, migrations or seed changes,
  environment variables added, and links to related issues or docs.

**GIT-7 — A PR that changes a convention also updates the matching standard** in
`docs/standards/` ([README](README.md)).

**GIT-8 — Before requesting review**, confirm three things:
- Tests pass for every workspace the PR touches, and CI's `ci-success` check is green
  ([ci-pipeline.md](ci-pipeline.md) CI-14).
- Formatting and lint are clean ([formatting-and-linting.md](formatting-and-linting.md)
  FMT-12).
- Any new environment variables are in the `.example` files
  ([docker-and-environment.md](docker-and-environment.md) ENV-1).

---

## Issues

**GIT-9 — File issues from the repository's issue template**
(`.github/ISSUE_TEMPLATE/`), with three sections: Description, Steps to Reproduce (when
applicable), and Other Details.
