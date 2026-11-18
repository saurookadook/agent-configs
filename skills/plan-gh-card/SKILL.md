---
name: plan-gh-card
description: Read one GitHub issue and write an implementation plan for it. Takes the issue's repo and number.
disable-model-invocation: true
---

# Plan a GitHub card

`/plan-gh-card <owner/repo> <issue-number>`, for example `/plan-gh-card acme/widgets 412`.

Read the card, ground it in this repo, and write a plan someone can execute. A **card** is a GitHub issue.

## Step 1: take the two arguments

Both are required, and neither has a default.

| Argument | Example | Notes |
|---|---|---|
| Repo | `acme/widgets` | The repo that holds the issue. Code and issues often live in different repos, so this is not inferable from the working directory. |
| Issue number | `412` | Digits only. Accept `#412` and take the digits out of it. |

A single argument that carries both also works: `acme/widgets#412`, or an issue URL `https://github.com/acme/widgets/issues/412`. Take the owner, repo, and number out of it.

If either value is absent, ask for it and stop. Do not guess a repo from the working directory, and do not guess a number from the branch name.

Done when: owner, repo, and number are held as literals, and the number is bare digits.

## Step 2: confirm the credential is live

```bash
gh api user --jq .login
```

If this fails, tell the user to run `gh auth login` and stop. Hold the login it prints; later steps compare authors against it.

## Step 3: fetch the card

One GraphQL query returns the fields, the hierarchy, and the links:

```bash
gh api graphql -F owner=<owner> -F repo=<repo> -F n=<number> -f query='
query($owner:String!,$repo:String!,$n:Int!){
  repository(owner:$owner,name:$repo){
    issue(number:$n){
      number title url state stateReason body
      issueType{name}
      assignees(first:10){nodes{login}}
      labels(first:30){nodes{name}}
      milestone{title}
      parent{number title url state repository{nameWithOwner}}
      subIssues(first:100){nodes{number title url state repository{nameWithOwner}}}
      closedByPullRequestsReferences(first:20,includeClosedPrs:true){nodes{number title url state}}
      timelineItems(first:100,itemTypes:[CROSS_REFERENCED_EVENT,REFERENCED_EVENT]){nodes{
        __typename
        ... on CrossReferencedEvent{source{__typename ... on Issue{number title url state} ... on PullRequest{number title url state}}}
        ... on ReferencedEvent{commit{oid messageHeadline}}
      }}
    }
  }
}'
```

Two gates on the response:

- `Could not resolve to an Issue` means the number is a pull request, or does not exist in that repo. Report it and stop.
- `url` must contain `<owner>/<repo>/issues/`. A different repo means the issue was transferred. Report both values and stop.

Read `title`, `issueType.name` (null when the org defines no issue types), `state`, `stateReason`, `assignees`, `labels`, `milestone`, and `body`.

GitHub has no acceptance criteria field. Take the criteria from the body: a heading named like "Acceptance criteria", or else its task list (`- [ ]` lines). If the body has neither, fall back to the whole body, and then to the title.

Follow three kinds of link and ignore the rest:

- `parent`: fetch it with the same query, using its own `repository.nameWithOwner`. The parent usually carries the goal that the child card assumes.
- `subIssues`: the children. Fetch each one in full with the same query and its own repo, and recurse: a child with its own sub-issues contributes those too. The target card and its descendants are one **tree**, and the tree is the scope of the plan. Children carry the work that the target card only summarizes, so plan the tree, not the root.
- `CrossReferencedEvent` sources that are issues: siblings. Keep title and state only, so you know what is covered elsewhere.

Prior work shows what was already tried. For each `ReferencedEvent` commit, run `git show --stat <oid>` locally. For each pull request in `closedByPullRequestsReferences` or in a `CrossReferencedEvent`, note its number, title, and state.

`state` on the target card is a gate, not a field to record. If it is `CLOSED`, stop and report `stateReason`, the title, and the prior work found on the card. The work is done or abandoned, and a plan for it wastes the user's time. The user can tell you to continue anyway.

A closed child is a note, not a gate. Keep it in the tree, and mark it as already done in the plan.

Done when: the tree is complete. You hold title, type, state, body, and acceptance criteria for the target and for every descendant, plus the parent's title, and no sub-issue is left unfetched.

## Step 4: read the comments

```bash
gh api --paginate repos/<owner>/<repo>/issues/<number>/comments \
  --jq '.[] | {user: .user.login, created_at, body}'
```

Comments hold decisions that never reached the body. Read them for scope changes and for constraints the card body does not state. Read the comments of every child too.

## Step 5: ground the card in the repo

The card names outcomes. The plan must name files. Bridge that gap here, before you write anything.

Do this for the whole tree: the target's acceptance criteria and every child's.

For each acceptance criterion, find the code it lands on:

- Search for the identifiers, paths, and settings the card names. A path the card quotes is a fact to verify, not a fact to trust: open it and confirm that it still exists and still says what the card claims.
- Read the `CLAUDE.md` or `AGENTS.md` of every component you will touch. Component rules outrank your own preferences.
- Read any contract file a component you touch declares, such as a `component.yaml`. The change must keep that contract.
- Check `git log --oneline --grep '#<number>'` for work already done against this card.

Record the criteria you could **not** ground. An ungrounded criterion is an open question in the plan, never a silent omission.

Done when: every acceptance criterion in the tree is mapped either to a named file path, or to an open question written out in words.

## Step 6: write the plan

Write to `<docs>/plans/<number>-<slug>.md`, where `<slug>` is the title lowercased with non-alphanumeric runs replaced by `-`, trimmed to 50 characters.

Take `<docs>` from the folders at the repository root. The first match wins:

1. `doc/plans/` or `docs/plans/` exists: use the folder that holds it.
2. `docs/` exists: use `docs`.
3. `doc/` exists: use `doc`.
4. Neither exists: use `doc`.

Create `<docs>/plans/` if it is absent.

The plan holds these sections, in this order:

1. **Card**: number, title, type, state, repo, parent title, and the issue URL.
2. **Child tasks**: a table of every descendant: repo and number, title, state, and the plan step that covers it. Write "None" if the target card has no sub-issues.
3. **Goal**: what the card asks for, in two sentences, in your own words.
4. **Current state**: what the code does today, with file paths and line numbers. This is the section that proves you read the repo.
5. **Steps**: one numbered step per unit of work. Each step names the files it changes, cites the card numbers it satisfies, and states the check that proves it landed. Every child task is covered by at least one step. Order the steps so that each one leaves the repository in a working state.
6. **Acceptance criteria**: a table with one row per criterion in the tree: the criterion verbatim, the number of the card it came from, and the step number that satisfies it. Every criterion gets a row.
7. **Open questions**: the ungrounded criteria from Step 5, and any decision you had to guess. Write "None" if there are none.
8. **Out of scope**: what the card could be read to include, and what this plan deliberately leaves alone.

Rules for the plan text:

- Every claim about the current code is grounded: `path:line`.
- Quote acceptance criteria verbatim. Paraphrase changes what "done" means.
- Prose follows the repo's `CLAUDE.md`.

Done when: the file exists, the acceptance criteria table has one row per criterion in the tree, and every child task in the Child tasks table names a step that covers it.

## Step 7: hand back

Report in the chat: the plan's path, the step count, the number of child tasks folded in, and every open question. Then stop.

This skill writes the plan file and nothing else. The branch, the commits, and the code stay as they are until the user decides to execute the plan.
