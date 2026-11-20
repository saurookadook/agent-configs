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
    local arg flag entry
    local -a args allow
    local -A entries

    entries=(
        --block-commits commit
        --block-push push
        --block-branch branch
        --block-checkout-b checkout-b
        --block-switch-c switch-c
        --block-merge merge
    )

    allow=(${(s:,:)GIT_GUARDRAIL_ALLOW})

    for arg in "$@"; do
        flag="${arg%%=*}"
        entry=""

        [[ "$flag" == --block-* ]] && entry="${entries[$flag]}"

        if [[ -z "$entry" ]]; then
            args+=("$arg")
            continue
        fi

        case "$arg" in
            *=false) allow+=("$entry") ;;
            *=true|"$flag") allow=(${allow:#$entry}) ;;
            *) echo "claude: $flag takes true or false" >&2; return 2 ;;
        esac
    done

    allow=(${(u)allow})

    GIT_GUARDRAIL_ALLOW="${(j:,:)allow}" command claude "${args[@]}"
}
