---
description: Audit and tidy this project's persistent memory — find contradictions, stale facts, broken [[links]], frontmatter drift, and index desync, then fix them.
disable-model-invocation: true
---

Review the current project's persistent memory for problems and fix them. Memory
is durable user state, so the default is **report first, apply on confirm** —
except trivially-safe fixes, which you apply directly (see Apply policy).

## 1. Locate the memory directory

Use the memory path the harness gave you **this session** — the line "You have a
persistent file-based memory at `<path>`" in your context. Operate on that
directory. Do not hardcode a path; it differs per project.

If for some reason no path was provided, derive it: it lives under
`~/.claude/projects/<project-slug>/memory/`, where `<project-slug>` is the
current working directory's absolute path with drive colons dropped and every
path separator replaced by `-`. Confirm the directory exists before proceeding;
if it doesn't, tell the user there's no memory for this project yet and stop.

## 2. Inventory

Read `MEMORY.md` (the index) and **every** memory file in the directory. Build a
map of: filename → `name:` slug, `metadata.type`, description, the `[[links]]` it
contains, and its `MEMORY.md` index line (if any).

## 3. Checks

Run each check across all memories. Light verification only — check things that
are cheap and deterministic; **flag** judgement calls for the user rather than
deciding them.

- **Contradictions.**
  - Memory vs memory: two files asserting incompatible facts.
  - Index hook vs file: does each `MEMORY.md` line's summary actually match the
    file it points to? (A hook that says the opposite of its file is the classic
    bug — e.g. an index reading "X-only" over a file that says "never X".)
  - Memory vs the user's global instructions (`~/.claude/CLAUDE.md`): if a memory
    contradicts current global rules, flag it. Do **not** edit `CLAUDE.md` or
    global memories — out of scope.
- **Staleness (light).** For facts citing a path, directory, file, version, or
  `file:line`: verify existence/current value against the live repo (Glob, Read,
  `git`). Fix or flag what's wrong. Memories also carry an age note in their
  system-reminder — treat old + code-behavior claims as "flag for review," not
  "assume wrong." Do **not** grep source to adjudicate nuanced behavioral claims
  (that's the deep mode the user opted out of) — list them for human review.
- **Broken `[[links]]`.** Every `[[slug]]` must resolve to some memory whose
  `name:` equals `slug`. A link to a not-yet-written memory is allowed (it's a
  marker); a link whose target *exists under a different slug* is a real break —
  fix the link or the target's `name:`.
- **Frontmatter health.** Each file should have: `name:` as a kebab-case slug
  **matching its filename** (sans `.md`); a `metadata:` block with a valid
  `type:` (`user` | `feedback` | `project` | `reference`); and a one-line
  `description:`. Normalize legacy shapes (top-level `type:`, human-readable
  `name:`, stray fields like `originSessionId`) to the current format. Note:
  renaming a `name:` slug means updating any `[[links]]` that point to it.
- **Index integrity.** Every memory file has exactly one `MEMORY.md` line; no
  orphan lines pointing at deleted files; no memory missing from the index. Each
  line is `- [Title](file.md) — hook` with an accurate hook.
- **Duplication / bloat.** Two files covering the same fact → propose a merge.
  A single file holding many unrelated facts → note it (splitting is optional,
  ask before doing it). Content the repo already records (code structure, git
  history, CLAUDE.md) → flag as a deletion candidate.

## 4. Report

Print findings grouped by severity, each as a one-liner naming the file and the
concrete problem:

- 🔴 **Contradiction** — must resolve; may need a user judgement call.
- 🟡 **Stale / needs review** — likely wrong, or a behavioral claim to verify.
- 🟢 **Auto-fixable** — frontmatter normalization, index hook/line sync, broken
  link repair. Mechanical and safe.

If nothing's wrong, say so in one line and stop.

## 5. Apply policy

- **Auto-apply** the 🟢 fixes directly (frontmatter normalization, index sync,
  link repair). State what you changed.
- **Confirm before applying** 🔴 and 🟡 fixes — anything that rewrites a fact,
  merges files, deletes a memory, or resolves a contradiction one way. Present
  the proposed change and let the user pick. For contradictions where you can't
  tell which side is right, ask.
- After any edits, **re-sync `MEMORY.md`**: every remaining file has one accurate
  line; removed files have their lines deleted.
- Keep edits surgical (use Edit, not wholesale rewrites). Never invent facts to
  fill gaps. When you delete a memory, say why.

## Scope

Project memory only. Never edit `~/.claude/CLAUDE.md` or global memories — flag
conflicts with them, but leave them to the user. Don't change repo source as part
of this audit; the repo is read-only reference for verifying memory claims.
