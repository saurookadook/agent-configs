---
name: renaming-symbols
description: Rename identifiers across a codebase without breaking call sites or contracts. Use when asked to improve or clarify naming, make names more descriptive, or rename a symbol through every call site. Covers scope choice, capture (keyword arguments, imports, attributes), and which strings must and must not move with a name.
---

A rename is **capture-avoiding substitution**: substituting one name for another everywhere it means the same thing, and nowhere it does not. The substitution is trivial. Avoiding **capture** — the rename landing on something that merely spells the same — is the entire job, and it is what silently breaks a wire format, a dashboard query, or a migration.

When a semantic rename tool covers the language (LSP `rename`, `gopls rename`, `rust-analyzer`, an IDE refactor), use it for a single symbol: it resolves through the type graph and cannot capture. Reach here for what those tools do not do — many names at once, the judgement about _which_ names, mixed or dynamic languages, and the contract strings no rename tool knows to leave alone.

## The rule the rest follows from

**Rewrite identifier tokens.** Parse, and substitute only tokens the parser calls a name. Strings and comments hold contracts — log fields, wire keys, SQL, config keys — and a text-level find-and-replace rewrites them indistinguishably from code. [`rename.py`](rename.py) does this for Python; for other languages use the language's own tokenizer rather than a regex.

Two kinds of string are the exception, because they are a spelling of an identifier and must move with it: export lists (`__all__`), and any string the runtime resolves back to a name (test parameter labels, `getattr`, DI keys). Move those by an explicit rule, never by a blanket string pass — see [`PYTEST.md`](PYTEST.md) for how that bites in tests.

## Process

1. **Bound the target and record a baseline.** List the files in scope and exclude generated or vendored code (protobuf stubs, `_pb2.py`, lockfiles). Run the type checker, the test suite and any contract check now, and write the numbers down. Done when you can state the pre-change pass counts.

2. **Propose the map.** One row per rename: scope, old name, new name. Above ~10 files, fan out read-only subagents to propose per module and merge their tables yourself — they must not edit, because call sites are shared and their edits would collide. Ask each for collision risks and for names it deliberately left alone. Done when every proposed name has a scope.

3. **Audit every wide row.** Dry-run each `*`-scoped and directory-scoped row on its own and read the file list it reports. A row that names a file with nothing to do with the symbol has captured something: narrow its scope until the list is only files the symbol lives in. Done when every wide row's file list has been read and is explainable. This step is where the expensive mistakes die; do not fold it into step 4.

4. **Apply, then format and lint.** Longer names push lines over the limit and reorder imports. Done when the linter is clean.

5. **Repair captures and stragglers.** Run the type checker first — it names asymmetric renames (a definition moved, a call site did not) far faster than tests do. Then the suite. Every failure is one of two things, and the catalogue below gives the fix and its direction. Expect several rounds. Done when the type checker is clean and the suite is at its baseline count, not merely "mostly passing".

6. **Prove the contracts held.** Tests do not cover a log field name or a JSON key no assertion reads. Extract the set of string literals (and of log-call keyword names) before and after, and diff them. Done when every added or removed string is one you can name as a deliberate export-list or label move. A surprise in that diff is a broken contract, whatever the suite says.

**A tier that does not run is not verified.** Docker-gated, integration, or otherwise deselected tests will happily carry a broken call for months. Check them statically instead: enumerate the methods they call on a renamed type and assert every one exists.

## Scope ladder

The more generic the name, the narrower the scope must be. `row`, `found`, `held`, `first`, `key`, `value`, `entry`, `page` mean different things three functions apart, and each meaning wants its own new name.

| Scope | Use for |
| --- | --- |
| Whole tree | A distinctive, audited name — a class, a module-level constant |
| Subtree | A name whose meaning is local to one tree; a test fixture must not sweep `src/` |
| File | Module-private helpers and constants |
| Function | Any generic name, always |
| Literal expression | `obj.attr` forms a token pass cannot tell apart |

Scope by the symbol's name **before** the table runs — spans are parsed from the file on disk, so `Connector.poll_once` is the scope even when the same table renames `Connector`.

## Captures and stragglers

A **capture** is the rename landing where it should not. A **straggler** is a reference left behind. Both are ordinary; finding them cheaply is the skill.

| Symptom | What happened | Fix |
| --- | --- | --- |
| `f() got an unexpected keyword argument` | `f(old=old)` — the token pass cannot tell the local from the keyword, so it renamed both | Callee is code you are not renaming: restore the keyword, keep the new local (`f(old=new_local)`). Callee is your own helper: rename its parameter too |
| `No module named pkg.new_name` | A local shadowed an imported module name | Restore the module path in the import and its uses |
| `'Foo' object has no attribute 'new_name'` | A local named `name`/`body`/`payload` also matched `.name` on a foreign object | Restore the attribute; it belongs to the other type |
| Doubled prefix (`change_event_change_event_ids`) | Two literal rules overlapped, the second matching the first's output | Order literal rules longest-first, or express them as identifier rules |
| Table refused for chaining | A new name is another row's old name | Pick a distinct target; a single pass cannot order them |
| Definition renamed, callers untouched | A literal or narrow rule moved only what you listed | Widen that row, or add the call sites |
| `Undefined name X in __all__` | Export lists are strings | Move them explicitly |

The keyword-argument case dominates by volume. Its fix has a **direction**: revert toward the callee when the callee is not yours to rename, propagate outward when it is.

## Judgement about which names

Improving names is not the same as changing them. Leave a name that is already specific — churn costs review attention and buys nothing. Rename the vague noun (`row`, `data`, `result`, `held`), the adjective standing in for a thing (`ordered`, `recorded`, `placed`), the abbreviation, and the name that is actively wrong (`without()` that adds an override; a `page` that holds a distribution).

Hold two categories still, because they are contracts rather than names: anything crossing a wire or a schema (env vars, config keys, DB columns, JSON fields, metric and log field names, route operation ids, serialized enum members), and anything a user types (CLI subcommands, flags). Sharpen the internals around them instead. Where a dataclass field mirrors a config key one-for-one, renaming the field alone splits one vocabulary into two — move both or neither.
