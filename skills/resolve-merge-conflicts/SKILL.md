---
name: resolve-merge-conflicts
description: "Resolve the conflicts of the merge in progress, commit that resolution as a chore, then fix what the merge broke in separate commits."
disable-model-invocation: true
---

Resolve the merge in progress in the current repository in two phases that never mix: first the conflicts, committed alone as a `chore`, then whatever the merged tree fails on, committed by concern. The split is the point. A reviewer reads the chore commit as "both sides, joined" and the later commits as "what joining them broke".

Typing this skill is the ask for the commits, so the global working agreement's ban is lifted for this run: for the commits this skill plans, and for nothing else in git. Each phase requests its own grant.

## Phase 1: the resolution

### 1. Find the merge

Run `git status -sb`. A merge is in progress when `.git/MERGE_HEAD` exists; the file holds the commit being merged in.

No merge in progress: say so and ask the user to start it (`git merge <ref>`), naming the ref they mentioned if they named one. Starting a merge is a git write this skill does not make.

On the repo's default branch: stop and ask before touching anything.

### 2. Survey both sides

Done when you can say, for every conflicted file, what each side changed and why.

- The conflicted files: `git diff --name-only --diff-filter=U`, and `git status --porcelain` for the shape of each (`UU` both changed, `DU` or `UD` one side deleted it, `AA` both added it). A file the user already resolved by hand is not in this list; leave it alone.
- What the other side brought: `git log --oneline HEAD..MERGE_HEAD`. What ours brought: `git log --oneline MERGE_HEAD..HEAD`. The subjects say which side holds the newer work on a file, and which side moved or renamed things.
- The three versions of a file when a hunk is unclear: `git show :1:<path>` is the base, `:2:` ours, `:3:` theirs.

### 3. Resolve each hunk by intent

Read every conflicted file whole, not only its hunks. Then, for each hunk, decide which side's intent survives:

- **The side with the newer work on that file wins the hunk.** Usually ours on a feature branch merging in the base; usually theirs when the base refactored the file after our branch forked.
- **A move or rename on the other side is taken, with our additions carried onto the new path.** An import whose module the other side moved, a helper the other side extracted into an imported module, a folder the other side dissolved. Keeping our side here leaves a second copy or a dead path: after resolving, search the whole file for a symbol declared twice and for an import of a path that no longer exists.
- **A hunk resolved by keeping both sides is suspect.** Both sides rarely belong; read the base version to see what each side replaced.
- **A deleted file (`DU`, `UD`) follows the side that deleted it** unless our side changed it for a reason the deletion does not cover; then keep it and say so.
- **A generated file is regenerated, not merged by hand.** Resolve its sources first, then run the generator (an OpenAPI document from its routes, a lockfile from its manifest) and take the output.
- **Our own earlier resolution in the same file stays.** The user may have resolved some hunks before asking.

A file the permission settings deny: report it with the exact refusal and stop on that file. Reading its sides through git to get around the denial is not resolution.

Done when `git diff --name-only --diff-filter=U` prints nothing, no file holds `<<<<<<<`, `=======` or `>>>>>>>`, and every edited path is one the survey listed.

### 4. Check the resolution, and nothing else

Run the repository's check tier (`./go check`, or the lint and typecheck the repo names) for information. Then sort each failure:

- **In a conflicted file**: a resolution error. Fix it now; it belongs in the chore commit.
- **In any other file**: the merge's doing, not the resolution's. Leave it for phase 2, and name it in the report.

Done when every failure that remains is in a file the survey did not list.

### 5. Commit the resolution as a chore

Stage exactly the conflicted files. Show the plan as one item, the subject in backticks and the body in a `text` block, exactly as it will be committed. The subject is `chore: merge <ref> into <branch>` under the repo's `COMMIT_CONVENTIONS.md` (resolve the file as `/commit` does). The body says what each side brought and the rule each resolution followed, in short sentences: a reviewer of the merge commit has no other account of it.

Then request the grant, alone:

```
~/.claude/hooks/git-grant.sh resolve-merge-conflicts 1
```

Approved, commit with the message as shown. Denied, revise the plan, show it again, and request a fresh grant. `--amend`, `--no-verify` and every other git write stay outside the grant.

## Phase 2: what the merge broke

### 6. Run the full gate

Run the repository's verify tier (`./go verify`, or the full test suites and builds the repo names) on the committed merge. Done when every failure is listed with its file and its first error line, verbatim.

No failure: report that and stop. The merge needed only its chore.

### 7. Fix by concern

Group the failures by cause, not by file: one moved module that several files still import is one concern; a test asserting a count the merge changed is another. Fix each concern in the files it touches, running the narrowest test that proves it after each fix.

Done when the full gate is green again.

### 8. Commit the fixes

One commit per concern, typed by its nature under the conventions (`fix` for broken behavior, `test` for a test the merge invalidated, `refactor` for a path moved to where the other side put it). Show the plan as `/commit` does: a numbered list, each subject in backticks, each body in a `text` block, each item's paths. Then request the grant with N the number of commits:

```
~/.claude/hooks/git-grant.sh resolve-merge-conflicts N
```

Stage exactly each commit's paths, confirm `git diff --staged` matches the plan, commit with the message as shown. Leave anything outside the plan unstaged.

### 9. Report

Show `git log --oneline` for the new commits, the gate's final lines verbatim, and `git status` for what remains. Say plainly which files phase 2 changed that phase 1 did not. Done when the chore commit holds only conflicted files and every later commit holds one concern.
