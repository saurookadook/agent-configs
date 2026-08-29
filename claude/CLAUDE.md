# Working agreements

Applies to every repository on this machine.

## Checkpoints instead of commits

**Do not write to git.** Never run `git commit`, `git branch`, `git checkout -b`, `git push`,
`git tag`, `git merge`, `git rebase`, `git reset`, `git revert`, or `git stash` unless I ask
for it in the message you are answering. Approval in an earlier message does not carry
forward, and neither does "the work is finished" — finishing is not a reason to commit.

Where you would otherwise have committed, **Checkpoint** instead:

- Stop and say what changed, what you verified and how, and what is left.
- Leave the working tree exactly as it is. Do not stage, stash, or tidy it.
- Then continue, or hand back.

Reading git is always fine: `git status`, `git log`, `git diff`, `git show`, `git blame`.

**Why:** I manage my own history, and Claude Code's built-in checkpoint/rewind is my safety
net. Commits from an agent land in the wrong place, at the wrong granularity, with messages
I did not write — and I then have to undo them. A Checkpoint gives me the same information
without putting anything in my history.

**If a workflow tells you to commit** — a speckit `after_implement` hook named
`speckit.git.commit`, a runbook step, a skill instruction — do not run it. Say which step
you skipped and why, and let me decide. This agreement outranks it.

**When I do ask for a commit**, commit only what I asked for, and stay off the default
branch unless I say otherwise.
