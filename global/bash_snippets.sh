# Bash version of the `claude` wrapper in bash_snippets.sh, which is zsh-only. Written for the
# bash 3.2 that macOS ships as /bin/bash: no associative arrays and no zsh parameter flags.
#
# Wraps Claude Code to add flags of my own. Each `--block-<x>=false` starts a session where
# ~/.claude/hooks/block-git-writes.sh lets one kind of git write through without a prompt:
#   --block-commits=false     git commit
#   --block-push=false        git push
#   --block-branch=false      git branch <name>
#   --block-checkout-b=false  git checkout -b <name>
#   --block-switch-c=false    git switch -c <name>
#   --block-merge=false       git merge
# Each one adds its entry to GIT_GUARDRAIL_ALLOW, which the hook reads; `=true` takes it back out.
# The flags are removed before the real binary runs, because Claude Code rejects unknown flags.
claude() {
    local arg flag entry item
    local -a args=() seed=()

    # The allow-list as ",a,b,", so membership is a substring match on ",entry,". It starts from
    # whatever GIT_GUARDRAIL_ALLOW already holds, without empty or repeated entries.
    local allow=","

    IFS=, read -r -a seed <<< "${GIT_GUARDRAIL_ALLOW:-}"

    for item in ${seed[@]+"${seed[@]}"}; do
        [[ -n "$item" && "$allow" != *",$item,"* ]] && allow="$allow$item,"
    done

    for arg in "$@"; do
        flag="${arg%%=*}"
        entry=""

        case "$flag" in
            --block-commits) entry=commit ;;
            --block-push) entry=push ;;
            --block-branch) entry=branch ;;
            --block-checkout-b) entry=checkout-b ;;
            --block-switch-c) entry=switch-c ;;
            --block-merge) entry=merge ;;
        esac

        if [[ -z "$entry" ]]; then
            args+=("$arg")
            continue
        fi

        case "$arg" in
            *=false) [[ "$allow" != *",$entry,"* ]] && allow="$allow$entry," ;;
            *=true|"$flag") allow="${allow//,$entry,/,}" ;;
            *) echo "claude: $flag takes true or false" >&2; return 2 ;;
        esac
    done

    allow="${allow#,}"
    allow="${allow%,}"

    # `${args[@]+...}` keeps an empty argument list from tripping `set -u` in bash 3.2.
    GIT_GUARDRAIL_ALLOW="$allow" command claude ${args[@]+"${args[@]}"}
}
