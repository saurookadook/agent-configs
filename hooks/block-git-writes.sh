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
# GRANTS. An allow-listed skill (see skill_allows) can turn one approval into several writes.
# After showing its plan, the skill runs `~/.claude/hooks/git-grant.sh <skill> <count>`. This
# script always answers `ask` for that command, so the plan is approved by a human clicking
# approve, never by the model. The command then records a grant, and up to <count> of the
# skill's subcommands (only those, and never --amend or --no-verify) pass without a prompt.
# A grant is good for this session only, and only until the user's next message, so it cannot
# carry forward. Anything it does not cover falls back to `ask`.
#
# WHAT IT CANNOT DO. It is not a sandbox. A determined bypass (writing a wrapper script,
# invoking git through another tool, writing a grant file with the Write tool) is out of scope,
# and no PreToolUse hook can close that. It stops the absent-minded commit, which is the real
# failure mode.
#
# READS ARE NEVER TOUCHED: status, log, diff, show, blame, rev-parse, describe, ls-files,
# fetch, remote -v, config --get, worktree list, and `git checkout -- <named file>` all pass.

set -uo pipefail

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

[ -z "$COMMAND" ] && exit 0

GRANT_FILE="$HOME/.claude/state/git-grants/${SESSION_ID:-none}"

# The allow-list: each skill that may hold a grant, and the subcommands the grant covers.
skill_allows() {
  case "$1" in
    commit) echo 'commit' ;;
    *) return 1 ;;
  esac
}

decide() {
  jq -nc \
    --arg decision "$1" \
    --arg reason "$2" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: $decision, permissionDecisionReason: $reason}, systemMessage: $reason}'

  exit 0
}

# Messages the user typed, as opposed to tool results and injected skill text.
human_messages() {
  [ -f "$TRANSCRIPT" ] && grep -E '"type":"user"' "$TRANSCRIPT" | grep -E '"origin":\{"kind":"human"'
}

# Requesting a grant. Only the exact form is accepted, so the prompt the user approves says
# precisely what is being granted.
if printf '%s' "$COMMAND" | grep -qE 'git-grant|state/git-grants'; then
  GRANT_RE='^[[:space:]]*(~|\$HOME|'"$HOME"')/\.claude/hooks/git-grant\.sh[[:space:]]+([a-z0-9-]+)[[:space:]]+([1-9][0-9]?)[[:space:]]*$'

  if ! [[ "$COMMAND" =~ $GRANT_RE ]]; then
    decide deny "GIT GUARDRAIL: git grants are requested only as \`~/.claude/hooks/git-grant.sh <skill> <count>\`, alone, and the grant files are not to be touched."
  fi

  SKILL="${BASH_REMATCH[2]}"
  COUNT="${BASH_REMATCH[3]}"

  skill_allows "$SKILL" >/dev/null || decide deny "GIT GUARDRAIL: /$SKILL is not allow-listed for git grants."

  # The skill must be the one the user most recently typed, so a grant cannot be requested
  # from outside a run of it.
  LAST_SKILL=$(human_messages | grep -F '<command-name>/' | tail -1 | jq -r '.message.content | tostring' 2>/dev/null)

  case "$LAST_SKILL" in
    *"<command-name>/$SKILL</command-name>"*) ;;
    *) decide deny "GIT GUARDRAIL: a grant for /$SKILL can only be requested during a run of /$SKILL that the user started." ;;
  esac

  decide ask "GIT GUARDRAIL: approving this approves the plan above. /$SKILL may then run $COUNT \`git $(skill_allows "$SKILL")\` command(s) without asking again, until your next message. Deny it to change the plan."
fi

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

# Prints why the command in $1 needs approval, or nothing if it does not.
find_reason() {
  local text="$1" reason=""

  if printf '%s' "$text" | grep -qE "${GIT_WRITE}${BLOCKED_SUBCOMMANDS}([[:space:]]|$)"; then
    reason="it writes git history or moves a ref"
  fi

  # Branch and checkout are read AND write depending on the flag, so they are judged separately.
  if printf '%s' "$text" | grep -qE "${GIT_WRITE}branch([[:space:]]+-[^[:space:]]+)*[[:space:]]+(-d|-D|-m|-M|--delete|--move)"; then
    reason="it deletes or renames a branch"
  fi

  if printf '%s' "$text" | grep -qE "${GIT_WRITE}(branch|checkout|switch)[[:space:]]+(-b|-B|-c|-C|--orphan)"; then
    reason="it creates a branch"
  fi

  # `git checkout .` and `git restore .` discard uncommitted work wholesale. A named path is
  # fine: restoring one file the assistant itself dirtied is ordinary tidying.
  if printf '%s' "$text" | grep -qE "${GIT_WRITE}(checkout|restore)[[:space:]]+(\.|--[[:space:]]+\.|-f|--force|--hard)([[:space:]]|$)"; then
    reason="it discards uncommitted work"
  fi

  if printf '%s' "$text" | grep -qE "${GIT_WRITE}clean[[:space:]]+-[a-zA-Z]*[fdx]"; then
    reason="it deletes untracked files"
  fi

  printf '%s' "$reason"
}

REASON=$(find_reason "$NORMALIZED")

if [ -z "$REASON" ]; then
  exit 0
fi

# Spending a grant. Every condition must hold, or the command falls through to `ask`.
if [ -f "$GRANT_FILE" ]; then
  G_SKILL=$(sed -n 's/^skill=//p' "$GRANT_FILE")
  G_LEFT=$(sed -n 's/^remaining=//p' "$GRANT_FILE")
  G_AT=$(sed -n 's/^granted_at=//p' "$GRANT_FILE")
  LAST_HUMAN=$(human_messages | tail -1 | jq -r '.timestamp // empty' 2>/dev/null | cut -c1-19)

  # A message from the user since the grant ends it: approval does not carry forward.
  if [ -z "$LAST_HUMAN" ] || [[ "$LAST_HUMAN" > "$G_AT" ]]; then
    rm -f "$GRANT_FILE"
  elif ALLOWED=$(skill_allows "$G_SKILL"); then
    # Blank out the granted invocations; whatever is left must need no approval at all.
    SCRUBBED=$(printf '%s' "$NORMALIZED" | sed -E "s/${GIT_WRITE}(${ALLOWED})([[:space:]]|$)/\1 granted-write\5/g")
    USES=$(printf '%s' "$NORMALIZED" | grep -oE "${GIT_WRITE}(${ALLOWED})([[:space:]]|$)" | wc -l | tr -d ' ')

    if [ -z "$(find_reason "$SCRUBBED")" ] \
      && [ "$USES" -ge 1 ] && [ "$USES" -le "${G_LEFT:-0}" ] \
      && ! printf '%s' "$NORMALIZED" | grep -qE '(^|[[:space:]])(--amend|--no-verify|-n)([[:space:]=]|$)'; then
      LEFT=$((G_LEFT - USES))

      if [ "$LEFT" -le 0 ]; then
        rm -f "$GRANT_FILE"
      else
        sed -i '' "s/^remaining=.*/remaining=${LEFT}/" "$GRANT_FILE"
      fi

      decide allow "GIT GUARDRAIL: allowed under the approved /${G_SKILL} plan (${LEFT} grant(s) left)."
    fi
  fi
fi

MESSAGE="GIT GUARDRAIL: this command needs the user's approval, because ${REASON}."
MESSAGE="${MESSAGE} The working agreement in ~/.claude/CLAUDE.md permits a git write ONLY when the user asked"
MESSAGE="${MESSAGE} for it in the message being answered; approval from an earlier message does not carry"
MESSAGE="${MESSAGE} forward, and neither does the work being finished. If the user did not ask in this message,"
MESSAGE="${MESSAGE} do not retry and do not reword the command: Checkpoint instead. Say what changed, what was"
MESSAGE="${MESSAGE} verified and how, and what is left, leave the tree exactly as it is, and hand back."

decide ask "$MESSAGE"
