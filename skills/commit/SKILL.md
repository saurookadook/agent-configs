---
name: commit
description: "Commit the current work as a series of atomic commits, each following the repo's COMMIT_CONVENTIONS.md."
disable-model-invocation: true
---

Commit the work in the current repository. Split it into several **atomic** commits: each one a single logical chunk that stands on its own, with a message that follows the repo's `COMMIT_CONVENTIONS.md`.

Typing this skill is the ask for a commit, so the global working agreement's ban is lifted for this run — for these commits only, and for nothing else in git.

## Steps

### 1. Resolve the conventions

Look for a cached path first: read `COMMIT_CONVENTIONS.md` at the path recorded in the `commit-conventions-path` memory for this repo, if one exists.

Cache miss, stale path, or no memory: find the file with `git ls-files | grep -i commit_conventions`, read it, then write the repo-relative path to memory as a `project` memory named `commit-conventions-path` so later runs skip the search.

No such file anywhere in the repo: say so and ask the user which convention to follow before going further.

### 2. Check the branch

Run `git status -sb`. On the repo's default branch, stop and ask the user before committing.

### 3. Survey every change

Read the full working state: `git status --porcelain`, `git diff`, `git diff --staged`, and `git log --oneline -10` for the message style actually in use. Done when every changed, added, and deleted path is accounted for — including untracked files.

### 4. Partition into chunks

Group the changes into atomic commits. Each hunk belongs to exactly one commit, and each commit holds one concern: a refactor and the feature riding on it are two commits, not one. Order them so each commit leaves the tree in a working state.

Write the message for each chunk against `COMMIT_CONVENTIONS.md`, not against habit.

### 5. Show the plan

Present the plan as one numbered list, in commit order. Each item starts with the commit's subject line in backticks. If the commit has a body, put the body under the item in a `text` code block, exactly as it will be committed. End the item with the paths (or hunks) it covers:

~~~md
1. `feat(frontend): add the contact fields to the create form`

   ```text
   The body, word for word as it will be committed.
   ```

   Paths: `frontend/src/a.ts`, `frontend/src/b.tsx`
2. `refactor(backend): share the phone pattern`

   Paths: `backend/api/models/tickets.py`
3. `chore: bump the lockfile`

   Paths: `pnpm-lock.yaml`
~~~

A commit with no body has no code block. Do not summarize a body ("the body says why"). Show the text itself.

Then, in the same turn, request the grant, with N the number of commits in the plan:

```
~/.claude/hooks/git-grant.sh commit N
```

Run it exactly as written, alone. Its permission prompt is the user's approval of the plan: approved, it lets the `block-git-writes` hook pass those N `git commit` commands without asking again. Denied, the user wants changes: revise the plan, show it again, and request a fresh grant. `--amend` and `--no-verify` are never covered, and neither is any other git write. The grant ends at the user's next message.

### 6. Commit

For each chunk in order: stage exactly its paths, confirm `git diff --staged` matches the plan, then commit with the message exactly as the plan showed it. If a message must change after approval, stop, show the new message, and request a fresh grant.

Interactive staging (`git add -p`, `git add -i`) does not work here, because nothing can answer its prompts. When a file splits across commits, stage a prepared copy of the file instead, and leave the working-tree file as it is:

1. Write the file as it must be after this commit to a scratch path. Start from `git show HEAD:<path>` and apply only this chunk's hunks.
2. Store the copy: `blob=$(git hash-object -w <scratch-path>)`.
3. Stage it: `git update-index --cacheinfo 100644,$blob,<path>`. Use `100755` for an executable file.
4. Confirm with `git diff --staged -- <path>` that only this chunk's hunks are staged. Then confirm with `git diff -- <path>` that the later chunks' hunks are still unstaged.

Leave everything outside the plan unstaged and untouched.

### 7. Report

Show `git log --oneline` for the new commits and `git status` for what remains uncommitted. Done when every chunk from the approved plan is a commit and nothing unplanned was committed.
