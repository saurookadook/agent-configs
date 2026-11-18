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

**Sessions where I lifted the block.** I can start a session with the block off for some
git writes, using flags on `claude` that each add one entry to `GIT_GUARDRAIL_ALLOW`:

| Flag | Entry | Command it unblocks |
| --- | --- | --- |
| `--block-commits=false` | `commit` | `git commit` |
| `--block-push=false` | `push` | `git push` |
| `--block-branch=false` | `branch` | `git branch <name>` |
| `--block-checkout-b=false` | `checkout-b` | `git checkout -b <name>` |
| `--block-switch-c=false` | `switch-c` | `git switch -c <name>` |
| `--block-merge=false` | `merge` | `git merge` |

Before you Checkpoint in place of a git write, run `printenv GIT_GUARDRAIL_ALLOW`. If it
prints a list such as `commit` or `commit,push,switch-c`, then for the commands those entries
unblock only, in that session only:

- Run them where you would naturally have, without waiting to be asked, and run a workflow's
  commit step instead of skipping it.
- Follow the repository's commit conventions, and stay off the default branch unless I say
  otherwise. That includes merging: do not merge into the default branch.
- A branch entry covers creating a branch, in that one form, and nothing else. Deleting,
  renaming, or force-resetting a branch (`-d`, `-m`, `-B`, `-C`) still follows the rule at the
  top. If only one of the three forms is listed, use that form.
- `--amend`, `--no-verify`, force pushes, and every command not in the list still follow
  the rule at the top.

If it prints nothing, the rule at the top applies in full.
