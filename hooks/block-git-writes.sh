#!/bin/bash
#
# Guardrail: no git command that WRITES history runs without the user approving it here.
#
# WHY THIS EXISTS. ~/.claude/CLAUDE.md already says, in plain words, "Do not write to git ...
# unless I ask for it in the message you are answering. Approval in an earlier message does not
# carry forward." On 2026-08-27 the assistant committed twice anyway, at the end of a task
# where commits had been approved two turns earlier. A rule the model can forget has to become
# a rule the harness enforces, so this script is the enforcement.
#
# HOW IT DECIDES. Every match returns `ask`, which makes Claude Code raise a permission prompt.
# It is deliberately not a flat `deny`:
#   - the user DOES direct commits, and a hard block would make every legitimate one a fight;
#   - `ask` cannot be satisfied by the model. Only a human clicking approve clears it.
# So the default becomes "stops and asks", which is exactly the failure this addresses.
#
# WHAT IT CANNOT DO. It is not a sandbox. A determined bypass (writing a wrapper script,
# invoking git through another tool) is out of scope, and no PreToolUse hook can close that.
# It stops the absent-minded commit, which is the real failure mode.
#
# READS ARE NEVER TOUCHED: status, log, diff, show, blame, rev-parse, describe, ls-files,
# fetch, remote -v, config --get, worktree list, and `git checkout -- <named file>` all pass.

set -uo pipefail

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

[ -z "$COMMAND" ] && exit 0

# Strip git's GLOBAL options before matching, so a flag that takes a value cannot hide the
# subcommand behind it. Found by testing: `git -C /repo commit` slipped through the first
# version of this guard, because the pattern assumed every option was a bare `-x`.
#
# Looped rather than done in one pass, because these stack: `git -C /a -c user.name=x commit`.
NORMALIZED="$COMMAND"

while :; do
  STRIPPED=$(printf '%s' "$NORMALIZED" | sed -E \
    -e 's/(^|[[:space:]])git[[:space:]]+(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix)[[:space:]]+[^[:space:]]+[[:space:]]+/\1git /g' \
    -e 's/(^|[[:space:]])git[[:space:]]+(--git-dir|--work-tree|--namespace|--exec-path|--super-prefix)=[^[:space:]]+[[:space:]]+/\1git /g' \
    -e 's/(^|[[:space:]])git[[:space:]]+(--no-pager|--paginate|-p|-P|--bare|--no-replace-objects|--literal-pathspecs|--no-optional-locks)[[:space:]]+/\1git /g')

  [ "$STRIPPED" = "$NORMALIZED" ] && break

  NORMALIZED="$STRIPPED"
done

# Every subcommand that writes history or moves refs. `git commit` is first because it is the
# one that actually went wrong.
#
# Anchored on a git invocation rather than grepped as a bare substring, so a commit message or
# a filename that happens to contain the word "push" does not trip the guard. `(^|[;&|(]|&&)`
# catches the compound forms: `cd x && git commit`, `foo; git push`, `$(git tag)`.
GIT_WRITE='(^|[;&|(]|&&|\|\|)[[:space:]]*(sudo[[:space:]]+)?git([[:space:]]+-[^[:space:]]+)*[[:space:]]+'

BLOCKED_SUBCOMMANDS='(commit|push|reset|revert|rebase|merge|tag|stash|cherry-pick|am|apply|rm|mv|filter-branch|gc|prune|reflog[[:space:]]+delete|update-ref|symbolic-ref|fast-import|replace|notes[[:space:]]+(add|remove|edit))'

REASON=""

if printf '%s' "$NORMALIZED" | grep -qE "${GIT_WRITE}${BLOCKED_SUBCOMMANDS}([[:space:]]|$)"; then
  REASON="it writes git history or moves a ref"
fi

# Branch and checkout are read AND write depending on the flag, so they are judged separately.
if printf '%s' "$NORMALIZED" | grep -qE "${GIT_WRITE}branch([[:space:]]+-[^[:space:]]+)*[[:space:]]+(-d|-D|-m|-M|--delete|--move)"; then
  REASON="it deletes or renames a branch"
fi

if printf '%s' "$NORMALIZED" | grep -qE "${GIT_WRITE}(branch|checkout|switch)[[:space:]]+(-b|-B|-c|-C|--orphan)"; then
  REASON="it creates a branch"
fi

# `git checkout .` and `git restore .` discard uncommitted work wholesale. A named path is
# fine: restoring one file the assistant itself dirtied is ordinary tidying.
if printf '%s' "$NORMALIZED" | grep -qE "${GIT_WRITE}(checkout|restore)[[:space:]]+(\.|--[[:space:]]+\.|-f|--force|--hard)([[:space:]]|$)"; then
  REASON="it discards uncommitted work"
fi

if printf '%s' "$NORMALIZED" | grep -qE "${GIT_WRITE}clean[[:space:]]+-[a-zA-Z]*[fdx]"; then
  REASON="it deletes untracked files"
fi

if [ -z "$REASON" ]; then
  exit 0
fi

MESSAGE="GIT GUARDRAIL: this command needs the user's approval, because ${REASON}."
MESSAGE="${MESSAGE} The working agreement in ~/.claude/CLAUDE.md permits a git write ONLY when the user asked"
MESSAGE="${MESSAGE} for it in the message being answered; approval from an earlier message does not carry"
MESSAGE="${MESSAGE} forward, and neither does the work being finished. If the user did not ask in this message,"
MESSAGE="${MESSAGE} do not retry and do not reword the command: Checkpoint instead. Say what changed, what was"
MESSAGE="${MESSAGE} verified and how, and what is left, leave the tree exactly as it is, and hand back."

jq -nc \
  --arg reason "$MESSAGE" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $reason}, systemMessage: $reason}'

exit 0
