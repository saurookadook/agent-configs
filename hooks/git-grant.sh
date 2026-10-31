#!/bin/bash
#
# Records the user's approval of a skill's planned git writes, e.g. `git-grant.sh commit 4`.
#
# The model runs this, but it cannot approve it: block-git-writes.sh always answers `ask` for this
# exact command, so the file below is only ever written after a human clicks approve. The grant
# is then spent by block-git-writes.sh, one write at a time. See the GRANTS section there.

set -euo pipefail

SKILL="${1:-}"
COUNT="${2:-}"

case "$COUNT" in
  ''|*[!0-9]*) echo "usage: git-grant.sh <skill> <count>" >&2; exit 2 ;;
esac

[ -n "$SKILL" ] && [ -n "${CLAUDE_CODE_SESSION_ID:-}" ] || { echo "git-grant: no skill or session" >&2; exit 2; }

DIR="$HOME/.claude/state/git-grants"
mkdir -p "$DIR"

printf 'skill=%s\nremaining=%s\ngranted_at=%s\n' "$SKILL" "$COUNT" "$(date -u +%Y-%m-%dT%H:%M:%S)" \
  > "$DIR/$CLAUDE_CODE_SESSION_ID"

echo "Granted: /$SKILL may make $COUNT git write(s) without asking, until the user's next message."
