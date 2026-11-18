---
name: review-gh-pr-feedback
description: "Work through the unresolved review threads on a GitHub PR: judge each one, record your decision, apply the fixes, commit and push them under one approval, then reply on every thread."
argument-hint: "[PR URL or number]"
disable-model-invocation: true
---

# Review GitHub PR feedback

Take every unresolved review thread on a pull request from feedback to reply. The user decides each thread. You do the analysis, the edits, the commits, the push and the replies.

Typing this skill is the ask for the commits and the push in step 6. The global working agreement's ban on git writes is lifted for those writes only. One approval covers all of them: the grant prompt in step 5.

## Step 1: find the PR and its unresolved threads

The argument is a PR URL, a PR number, or nothing. Read the owner and repo from the URL, or from `gh repo view --json nameWithOwner` when the argument does not give them. With no argument, find the open PR whose head branch is the current branch:

```bash
gh api user --jq .login
gh pr view [<pr>] --json number,url,state,headRefName,baseRefName
```

If the first command fails, tell the user to run `gh auth login` and stop. Hold the login it prints. If `gh pr view` finds no PR, or the PR is not `OPEN`, say so and ask which PR.

Fetch the review threads with the GraphQL query in `~/.claude/skills/reply-gh-pr-threads/SKILL.md` Step 1, paging until `hasNextPage` is false.

A thread is unresolved when both hold:

- `isResolved` is false.
- Its latest comment is by someone other than the user. Compare that comment's `author.login` with the held login, ignoring case. A thread whose latest comment is the user's own waits on the reviewer. An earlier reply leaves the thread unresolved, so `isResolved` alone does not show this.

Name the threads that wait on the reviewer in the ledger, by root comment id, on one line, and leave them out of every later step.

Review summaries and top-level conversation comments are not threads, and they have no resolved state. List those from reviewers in the ledger under one "Not threads" line, with their links, so the user sees them. Later steps leave them alone.

Check the working copy before any analysis. Run `git fetch`, then `git status -sb`. The current branch must be the PR's `headRefName`, not behind its remote, and clean. A dirty tree would put the user's unrelated work into the commit plan. If any check fails, say which and stop.

Start a ledger at `<scratchpad>/pr-<pr>-feedback.md`, with one section per unresolved thread. Each section holds the thread node id, the root comment id and its `url`, `path` and line, the reviewer, and the comment chain. Later steps add the verdict, the decision, the user's comment, the changed paths and the commit. The ledger is the record. Write to it as each fact arrives, so a compacted context loses nothing.

Done when: every unresolved thread has a ledger section, no other thread does, and the ledger names each thread that waits on the reviewer.

## Step 2: judge each thread

Take the threads in file order. For each one:

1. Read the full comment chain, including any replies already posted.
2. Read the code at the thread's file and line on the current branch. An outdated thread (`isOutdated` true) has a null `line`. Its `originalLine` points into the commit the reviewer saw, so find the code by its content.
3. Test the claim. Is it true of the code? Does a repo rule, the linked issue, or the design support or contradict it? When the reviewer cites a rule, read that rule.
4. Give a verdict: **valid**, **partly valid**, **not valid**, **question** (the reviewer asks for an answer, not a change), or **already addressed** (a later commit on the branch fixed it). Support it with one or two sentences of evidence: a `file:line`, or a rule id with what the rule says.
5. Offer two to four next actions, the recommended one first. Make each one concrete enough to act on without a follow-up question: name the file and the change, or the point the reply will make. Typical actions are a fix as suggested, a different fix, a reply that explains or pushes back, a new issue for later, or no action.
6. Ask with `AskUserQuestion`, one thread per call. The user may see only the dialog, so the question text carries the root comment id, the `file:line`, the reviewer's point in one sentence, the reviewer's comment word for word, and the verdict with its evidence. On a thread with earlier replies, quote the reviewer's latest comment. Put the code change an option implies in that option's `preview`.

   Lay the question text out as three blocks separated by blank lines, so it reads as a short card rather than one bold run-on line:

   ```md
   **Thread <root comment id> (<reviewer>) at `<file>:<line>`: <the reviewer's point in one sentence>.**

   <reviewer>'s comment:
   > "<the comment word for word>"

   **Verdict:** <verdict>, <evidence>. How do you want to handle it?
   ```

   Bold only the header line and the `Verdict:` label. Keep the reviewer's own markdown (`**bold**`, `` `code` ``, ```` ```suggestion ```` blocks) as they wrote it, with no escaping. When the comment has several paragraphs, start each line of it with `> ` so the whole comment stays inside the quote.
7. Record the answer in the ledger at once. The user's "Other" text and notes are clarifying comments: record them word for word, and act on them in later steps.

Done when: every ledger section has a verdict and a decision.

## Step 3: confirm all decisions

Show one table with a row per thread: root comment id, `file:line`, the reviewer's point, the verdict, the decision, and the user's comment. Then ask with `AskUserQuestion`: confirm all, or revisit some. The user names the threads to revisit in "Other".

For each thread to revisit, run step 2 again and update its ledger section. Then show the whole table again and ask again.

Done when: the user confirms the whole table.

## Step 4: apply the decisions

Make the code change for each thread whose decision needs one, exactly as decided. Record the changed paths in that thread's ledger section. If a decision proves unworkable during the edit, stop and ask about that thread. Do not substitute a different fix on your own.

Then run the repo's verification for the touched scopes, as its `CLAUDE.md` names it. Fix any failure your edits caused.

Done when: every code decision is in the working tree, every changed path maps to a thread in the ledger, and the checks pass or fail only as they failed before your edits. Report any such pre-existing failure by name.

## Step 5: plan the commits

Read `~/.claude/skills/commit/SKILL.md` and follow its steps 1 to 5, with three changes:

- Partition into the fewest commits that each still hold one logical concern. Threads that ask for the same concern share a commit.
- Under each plan item, list the thread root comment ids that the commit addresses.
- Request this skill's grant instead of `/commit`'s, alone, with N the number of commits plus one for the push:

  ```
  ~/.claude/hooks/git-grant.sh review-gh-pr-feedback N
  ```

  Say in the plan that the grant includes one `git push`. The prompt for this command is the user's approval of the plan. If the user denies it, revise the plan, show it again, and request a fresh grant.

You read `/commit` rather than invoke it for two reasons. It is user-invoked only, so no skill can run it. Also, the git hook gives a grant only to the skill the user typed, which is this one.

Done when: the user approves the grant.

## Step 6: commit and push

Do all of this in the turn the grant was approved. The grant ends at the user's next message.

1. Make the commits as step 6 of `/commit` describes.
2. Run `git push`, with no flags. The PR's branch already tracks its remote.
3. If the push is rejected, stop and report the error in full. The remote has moved. Never rebase or force push to get past it.
4. Run `git status -sb` and confirm the branch is not ahead of its remote.
5. Record each commit's full SHA in the ledger sections of the threads it addresses.

If the hook asks for approval during this step, the grant has run out. Stop and hand back.

Done when: every planned commit is on the remote and each code-change thread in the ledger has its SHA.

## Step 7: reply on the threads

Invoke the `reply-gh-pr-threads` skill. Pass the PR URL and, for each thread in the ledger: the thread node id, its commit SHAs or the reason no change was made, and the user's comment. The reason for a thread without a change comes from its decision, such as the explanation, the pushback, or the new issue.

Done when: `reply-gh-pr-threads` reports every thread posted.

Hand back with one row per thread: the root comment id, the commit cited, and the reply status. Give the ledger path, and say that the threads are still unresolved.
