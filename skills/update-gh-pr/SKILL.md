---
name: update-gh-pr
description: "Rewrite one GitHub pull request description, filled from the repo's PR template. Takes a repo and PR number, or the PR URL."
disable-model-invocation: true
---

# Update a GitHub PR description

`/update-gh-pr <owner/repo> <pr-number>`, for example `/update-gh-pr acme/widgets 128`.

`/update-gh-pr <pr-url>`, for example `/update-gh-pr https://github.com/acme/widgets/pull/128`.

`/update-gh-pr` with no argument, for the open PR of the current branch.

Fill the repo's pull request template with what this PR actually does, and write it back over the description.

## Step 1: resolve the locator

The **locator** is one triple: owner, repo, PR number. All three call forms produce it.

| Form | How to read it |
|---|---|
| Two arguments | Repo, then PR number. `acme/widgets 128` gives owner `acme`, repo `widgets`, number `128`. |
| One URL | Take the triple out of `https://github.com/<owner>/<repo>/pull/<number>`. Trailing path segments, query strings, and anchors are noise. |
| No argument | Run `gh pr view --json url` in the working directory. GitHub returns the open PR whose head is the current branch; take the triple out of its `url`. If it finds no PR, say so and stop. |

A bare number or a repo alone is ambiguous. Ask for the missing part and stop. A PR number is unique only within its repo, so do not pair a bare number with the working directory's repo.

Done when: owner, repo and number are held as literals, and the number is bare digits.

## Step 2: confirm the credential is live

```bash
gh api user --jq .login
```

If this fails, tell the user to run `gh auth login` and stop.

## Step 3: fetch the PR and check it against the locator

```bash
gh pr view <number> -R <owner>/<repo> \
  --json number,url,title,body,state,isDraft,headRefName,baseRefName,closingIssuesReferences,commits
```

Two gates:

- `url` must be `https://github.com/<owner>/<repo>/pull/<number>`. A different owner or repo means the repo was renamed or transferred. Report both values and stop: the locator is wrong, and you are one command away from rewriting a stranger's PR.
- `state` must be `OPEN`. On `MERGED` or `CLOSED`, report the state and the PR url and stop. The user can tell you to continue anyway.

Done when: both gates pass, and the current body is held verbatim.

## Step 4: fetch the template

The template lives in the repo, on the default branch. GitHub matches template names case-insensitively, so do the same. When the working directory is the PR's repo, `git ls-files | grep -i pull_request_template` finds every candidate in one command. Otherwise try these paths in order, and take the first that exists:

```bash
gh api -H 'Accept: application/vnd.github.raw' repos/<owner>/<repo>/contents/<path>
```

1. `.github/pull_request_template.md`
2. `.github/PULL_REQUEST_TEMPLATE.md`
3. `pull_request_template.md`
4. `docs/pull_request_template.md`
5. `.github/PULL_REQUEST_TEMPLATE/`: a folder of several templates. List it, pick the one that fits the change, and name it in the draft.
6. The owner's org-level fallback: `repos/<owner>/.github/contents/.github/pull_request_template.md`.

If none exist, take the current body's own headings as the shape. If that is empty too, use `# Description`, `## Ticket(s)`, `## How to Test`.

The template's headings, ordering, list style, and checklist items are the contract. Keep them exactly, and fill only the **placeholder** lines under them (`Makes some change`, `Closes #000`, `Do a thing`). Drop the template's HTML comments.

Done when: the heading skeleton is held, and every placeholder line in it is identified as a line to replace.

## Step 5: learn what the PR does

The `commits` field from Step 3 holds every commit's full headline and body. Commit subjects alone describe intent poorly, so read the diff too: `gh pr diff <number> -R <owner>/<repo> --name-only` for shape, then the files that carry the substance.

Collect the linked issues from two places:

- `closingIssuesReferences`: issues the PR closes, whether linked by a keyword in the body or by hand in the sidebar.
- The current body: every issue reference it holds, with its keyword (`Closes #12`, `Refs acme/api#7`).

Fetch each one for its title, its state, and what it asked for:

```bash
gh issue view <n> -R <issue-owner>/<issue-repo> --json title,state,body,url
```

Done when: every changed file is reflected in some bullet you can write, or deliberately left out as noise (lock files, generated code), every change maps to the issue it serves, and no linked issue is unfetched.

## Step 6: write the draft

Write the filled template to a file in your scratchpad directory. The file is what gets applied, so it holds the exact bytes you intend.

Every section is a **terse** bulleted list: one line per bullet, at most about five bullets, facts only. Each bullet carries new information, so the title is never restated and no section becomes a paragraph. How to Test is the one exception: it is a numbered list of steps.

- **Description**: one bullet per change a reviewer must know about, in the template's list style. Ground each bullet in the code: name the service, package or file it lands in. Commit-message noise (lock file bumps, formatting) merges into one bullet or drops.
- **Ticket(s)**: one line per linked issue, in the template's link shape, with the issue's real title. Write an issue in this repo as `#12`, and an issue in another repo as `owner/repo#12`. Keep every keyword the current body uses: GitHub reads `Closes`, `Fixes`, and `Resolves` in the body as closing links, so dropping one unlinks the issue, and adding one closes the issue on merge. Write `- None` when the PR links no issues. An issue the PR links but does not deliver keeps its line and gains the reason, which is a fact the reviewer needs.
- **How to Test**: numbered steps a reviewer can run, with the real commands and paths from the repo. Steps only they can perform in the deployed environment say so.
- **Checklists**: tick a box only when the diff or the current body shows it is true.
- **A section that does not apply**: write `- N/A` under its heading.
- **Human-written content**: keep what the current body holds that the diff cannot reproduce, such as screenshots and notes for reviewers. Put each item in the matching section.

GitHub caps the body at 65,536 characters. Detail a reviewer does not need before reading the diff belongs in a PR comment. Prose follows the repo's `CLAUDE.md`.

Done when: no placeholder line survives, every template heading has content, and every bullet is traceable to a commit, a diff hunk or a linked issue.

## Step 7: get approval, then apply

Show the user the draft in full, and say what it replaces: the current body verbatim, or "the unfilled template" when that is all it holds. GitHub keeps an edit history on the description, but the user should see what goes before approving.

On approval:

```bash
gh pr edit <number> -R <owner>/<repo> --body-file <draft-file>
```

Then fetch the body and compare it with the draft:

```bash
diff <(gh pr view <number> -R <owner>/<repo> --json body --jq .body) <draft-file>
```

Done when: the fetched body equals the draft, apart from a trailing newline.

## Step 8: hand back

Report the PR url, the headings you filled, the issues you linked, and anything you could not ground and had to leave as a question. Then stop.

This skill writes the PR description only. The title, the reviewers, the labels, the state, the draft flag, and the working tree stay as they are.
