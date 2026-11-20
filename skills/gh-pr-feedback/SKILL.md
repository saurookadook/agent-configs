---
name: gh-pr-feedback
description: "Work through a GitHub PR's open review threads with the user, then implement, commit, push, and reply to each thread."
disable-model-invocation: true
---

Respond to review feedback on a GitHub pull request. The argument is a PR number or URL; with none, use the PR for the current branch (`gh pr view`).

The user is the decision-maker for every thread. Each step that ends on the user's word waits for it.

Typing this skill is the ask for the commits and the push in steps 5 and 6, approved once at the end of step 4, so the global working agreement's ban is lifted for those writes only and for nothing else in git.

## Steps

### 1. Review the open threads, one at a time

Load the PR with `gh pr view <arg> --json number,url,headRefName,headRepository,headRepositoryOwner`, then its threads:

```sh
gh api graphql -F owner=<owner> -F repo=<repo> -F number=<n> -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line
          comments(first: 100) { nodes { author { login } body url diffHunk } }
        }
      }
    }
  }
}'
```

An open thread is one with `isResolved: false`. No open threads: say so and stop.

For each open thread, in file order, present:

- **Location**: `path:line`, the comment URL, and a note if `isOutdated`.
- **Full text**: every comment in the thread, author first, body **verbatim** inside a four-backtick fence, so the text is exactly as written: no paraphrase, no trimming, no reflowed markdown.
- **Evaluation**: read the code the thread points at (the current file, not just `diffHunk`) and judge the suggestion's legitimacy: correct, partly correct, mistaken, or a matter of taste, with the reason grounded in the code.
- **Next steps**: the concrete options, e.g. apply as suggested, apply a variant, no change (with the reason to give the reviewer). Recommend one.

Then wait for the user's decision on that thread before presenting the next. Record each decision: the thread `id`, whether it needs a change, and what the change or the reasoning is. Done when every open thread has a recorded decision.

### 2. Confirm the decisions

Present every decision in one table: thread location, first line of the comment, decision, change (or "none"). The user may reopen any thread: re-present it as in step 1 and record the new decision. Proceed only when the user says to.

### 3. Implement

Make each approved change. Run the checks that cover the touched code (tests, type checks, linters, whatever the repo uses). Done when every decision that needs a change is in the working tree and the checks pass, or a failure has been reported to the user and they have said how to proceed.

Changes that were in the working tree before this run are not part of it: leave them unstaged and untouched through step 5.

### 4. Plan the commits and replies

Read `~/.claude/skills/commit/SKILL.md` and follow its steps 1–4 (conventions, branch check, survey, partition) over this run's changes. Group them into the **minimal** number of commits that keeps each one a single logical concern.

Also check the branch is the PR's: `git branch --show-current` must equal `headRefName`, and `git rev-parse --abbrev-ref @{u}` must name that branch on the remote of `headRepository`. Either fails: say so and stop.

Present, in one message:

- **Commits**, in order: subject line, the paths (or hunks) it covers, and the threads it addresses.
- **Replies**: the draft reply for every thread from step 2, in the step 7 template, with `<sha>` standing in for the commit it will cite.

Then, in the same turn, request the grant, with N the number of commits plus 1 for the push:

```
~/.claude/hooks/git-grant.sh gh-pr-feedback N
```

Run it exactly as written, alone. Its permission prompt is the user's single approval of the commits, the push, and the replies. Denied: revise as the user asks, present again, and request a fresh grant. The grant covers only `git commit` and `git push`, never `--amend`, `--no-verify`, a force push, or a deleting refspec, and it ends at the user's next message.

### 5. Commit

Follow steps 6–7 of `~/.claude/skills/commit/SKILL.md` for the approved plan. Its step 5 grant is replaced by the one from step 4 here. Done when every planned commit exists and nothing unplanned was committed.

### 6. Push

Run `git push`, bare. Done when `git status -sb` shows the branch level with its upstream.

### 7. Reply to each thread

Post the approved reply on every thread from step 2, filling in the real commit:

```md
<brief description of review decision>

Addressed in [<first_8_chars_of_commit_sha>](<URL_for_commit_in_GitHub>)
```

- The commit URL is `https://github.com/<headRepositoryOwner>/<headRepository>/commit/<full_sha>`.
- A decision with no change ends after the description: no "Addressed in" line.
- A change spread over several commits lists each: `Addressed in [a1b2c3d4](…), [e5f6a7b8](…)`.

Write each body to a temp file and post it:

```sh
gh api graphql -F threadId=<thread id> -F body=@<file> -f query='
mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) {
    comment { url }
  }
}'
```

Done when every thread from step 2 has a reply. Report each reply's URL and the PR URL.
