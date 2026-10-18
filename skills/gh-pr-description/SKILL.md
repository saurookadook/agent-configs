---
name: gh-pr-description
description: "Rewrite a GitHub PR's description: fill the repo's PR template with terse bulleted sections."
disable-model-invocation: true
---

Rewrite the description of a GitHub pull request. The argument is a PR number or URL; with none, use the PR for the current branch (`gh pr view`).

Every section is a **terse** bulleted list: one line per bullet, at most ~5 bullets, facts only. Write bullets that each carry new information, so the title is never restated and no section becomes a paragraph.

## Steps

### 1. Load the PR

`gh pr view <arg> --json number,url,title,body,baseRefName,headRefName,closingIssuesReferences,commits`.

No PR found: say so and stop.

### 2. Find the template

Look for the template GitHub would use, matching names case-insensitively: `.github/pull_request_template.md`, `pull_request_template.md` at the root, `docs/pull_request_template.md`, and `.github/PULL_REQUEST_TEMPLATE/*.md`.

- Working in the PR's repo: `git ls-files | grep -i pull_request_template` covers all of these.
- PR from another repo (a URL argument): read the same paths with `gh api repos/<owner>/<repo>/contents/<path>`.
- Several templates in `PULL_REQUEST_TEMPLATE/`: pick the one that fits the change and name it in the draft.
- None in the repo: check the owner's org-level `.github` repo (`gh api repos/<owner>/.github/contents/.github/pull_request_template.md`).
- Still none: use `## Summary`, `## Changes`, `## Testing`.

Done when you have one template, or know there is none.

### 3. Survey the change

Read `gh pr diff <n>` and the commit list from step 1. Done when every changed file is reflected in some bullet or deliberately left out as noise (lockfiles, generated code).

### 4. Draft

Fill the template:

- Keep its headings, order, and checklist items exactly; drop its HTML comments and placeholder text.
- Tick a checkbox only when the diff or the existing body shows it is true.
- If a section does not apply, write `- N/A`.
- Keep human-written content from the existing body that the diff cannot reproduce: issue links (`Closes #12`), screenshots, reviewer notes. Put each item in the matching section.

### 5. Approve

Show the full draft body and wait for approval or edits.

### 6. Apply

Write the approved body to a temp file and run `gh pr edit <n> --body-file <file>`. Show the PR URL.
