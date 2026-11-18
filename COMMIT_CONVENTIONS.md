# Commit conventions

Commits follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), with a required scope.

```txt
<type>(<scope>): <description>

<body>

<footers>
```

## Types

| Type | Use for |
| --- | --- |
| `feat` | New or changed behavior: a new skill, hook, mod, setting, or output style, or a change to what an existing one does. |
| `fix` | Behavior that was wrong and is now right. |
| `refactor` | Restructuring with no change in behavior. |
| `docs` | Documentation for people: `docs/`, READMEs, this file. A skill or `CLAUDE.md` is behavior for an agent, so it takes `feat` or `fix`. |
| `test` | Tests only. |
| `chore` | Renames, moves, cleanup, packaging (`dist/`), and anything else with no behavior change. |
| `revert` | Reverting an earlier commit. The body names the reverted SHA. |

## Scopes

The scope names the area the commit is about. Use the narrowest one that fits:

1. One skill, mod, or docs folder: its folder name, such as `commit`, `session-switcher`, or `standards`. Supporting lines elsewhere (an allow-list entry in a hook, say) do not widen the scope.
2. Several items in one top-level folder: that folder, such as `skills`, `hooks`, `mods`, `claude`, `settings`, or `output-styles`.
3. Files at the repository root: `repo`.

## Description

- Imperative mood, lowercase first letter, no trailing period: `add`, not `Added` or `adds`.
- The whole subject line is at most 72 characters.
- Say what changes for the user of the config, not how the diff looks.

## Body

- Optional. Add one when the reason is not obvious from the subject.
- Explain why, and anything a reader of `git log` needs that the diff does not show.
- Separate paragraphs with a blank line. Each paragraph is one line, with no hard wrapping.

## Footers

- `BREAKING CHANGE: <what breaks and what to do>` when a change needs action from anyone using the config, such as a renamed skill or a removed setting. Also add `!` before the colon: `feat(skills)!: rename plan-card to plan-gh-card`.
- `Co-Authored-By: <name> <email>` for each co-author.

## Granularity

- Each commit holds one concern, and leaves the repository in a working state.
- Keep mechanical changes (moves, renames) in their own `chore` commits, apart from behavior changes.

## Examples

```txt
feat(hooks): let a session lift the git guard with GIT_GUARDRAIL_ALLOW
fix(session-switcher): keep the row number when a session turns busy
feat(skills): add GitHub issue planning skills
docs(standards): add testing standards
chore(repo): remove unused gitkeep files
```
