#!/usr/bin/env python3
"""Apply a table of Python identifier renames, rewriting NAME tokens only.

String literals and comments are left alone, so a JSON key, a log field, a metric
name or a SQL alias that happens to spell a renamed identifier survives untouched.

Table format: TSV, three tab-separated fields. A line starting `#` is a comment.

    *<TAB>old<TAB>new                  every file under the roots
    <dir>/<TAB>old<TAB>new             every file under that directory
    <path><TAB>old<TAB>new             that file only
    <path>::<name><TAB>old<TAB>new     inside that function only
    expr:<path><TAB>old<TAB>new        literal text, that file only
    expr:*<TAB>old<TAB>new             literal text, every file

`<name>` is a function or a dotted `Class.method`, and names the symbol as it is
BEFORE this table runs: spans are parsed from the file on disk. A bare method name
resolves when exactly one class defines it.

Rows are tried in table order, so list narrower scopes above wider ones.

Default is a dry run. Pass --apply to write. Exit 1 if any row matched nothing:
a row that matches nothing is a row whose assumption about the code is wrong.
"""

from __future__ import annotations

import argparse
import ast
import io
import re
import sys
import tokenize
from pathlib import Path


def python_files(roots: list[Path], excludes: list[str]) -> list[Path]:
    found: list[Path] = []
    for root in roots:
        if root.is_file():
            found.append(root)
            continue
        for path in root.rglob("*.py"):
            if not any(path.match(pattern) for pattern in excludes):
                found.append(path)
    return sorted(set(found))


def function_spans(source: str) -> dict[str, tuple[int, int]]:
    """Every function and method, by dotted name, as a 1-based inclusive line span."""
    spans: dict[str, tuple[int, int]] = {}

    def walk(node: ast.AST, prefix: str) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.ClassDef):
                walk(child, f"{prefix}{child.name}.")
            elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                start = min([child.lineno] + [d.lineno for d in child.decorator_list])
                spans[f"{prefix}{child.name}"] = (start, child.end_lineno or child.lineno)
                walk(child, f"{prefix}{child.name}.")

    walk(ast.parse(source), "")
    return spans


def resolve_span(spans: dict[str, tuple[int, int]], name: str) -> tuple[int, int] | None:
    if name in spans:
        return spans[name]
    matches = [key for key in spans if key.rsplit(".", 1)[-1] == name]
    return spans[matches[0]] if len(matches) == 1 else None


def load_table(path: Path) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for number, raw in enumerate(path.read_text().splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        parts = raw.split("\t")
        if len(parts) != 3:
            sys.exit(f"{path}:{number}: want 3 tab-separated fields, got {len(parts)}")
        scope, old, new = (part.strip() for part in parts)
        if not scope.startswith("expr:") and not (old.isidentifier() and new.isidentifier()):
            sys.exit(f"{path}:{number}: not an identifier pair: {old!r} -> {new!r}")
        rows.append((scope, old, new))

    seen: dict[tuple[str, str], str] = {}
    for scope, old, new in rows:
        if (scope, old) in seen:
            sys.exit(f"{path}: {scope} renames {old} twice: {seen[(scope, old)]} and {new}")
        seen[(scope, old)] = new

    # A new name that is also some other row's old name chains in a single pass.
    identifiers = [row for row in rows if not row[0].startswith("expr:")]
    chained = sorted({new for _, _, new in identifiers} & {old for _, old, _ in identifiers})
    if chained:
        sys.exit(f"{path}: these new names are also old names, so they would chain: {chained}")
    return rows


def applies(scope: str, relative: str) -> bool:
    if scope in ("*", "expr:*"):
        return True
    if scope.startswith("expr:"):
        return scope[len("expr:") :] == relative
    target = scope.split("::", 1)[0]
    return relative.startswith(target) if target.endswith("/") else target == relative


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("table", type=Path)
    parser.add_argument("--root", action="append", type=Path, default=None, help="repeatable; default .")
    parser.add_argument("--exclude", action="append", default=[], help="glob of files to leave alone; repeatable")
    parser.add_argument("--apply", action="store_true", help="write the changes; default is a dry run")
    args = parser.parse_args()

    table = load_table(args.table)
    roots = args.root or [Path(".")]
    base = Path.cwd()
    matched: set[tuple[str, str, str]] = set()
    total = 0

    for path in python_files(roots, args.exclude):
        relative = str(path.relative_to(base)) if path.is_absolute() else str(path)
        rows = [row for row in table if applies(row[0], relative)]
        if not rows:
            continue

        source = path.read_text()
        edits = 0

        identifier_rows = [row for row in rows if not row[0].startswith("expr:")]
        if identifier_rows:
            by_old: dict[str, list[tuple[str, str]]] = {}
            for scope, old, new in identifier_rows:
                by_old.setdefault(old, []).append((scope, new))
            spans = function_spans(source) if any("::" in s for s, _, _ in identifier_rows) else {}

            lines = source.splitlines(keepends=True)
            starts = [0]
            for line in lines:
                starts.append(starts[-1] + len(line))

            pieces: list[str] = []
            cursor = 0
            for token in tokenize.generate_tokens(io.StringIO(source).readline):
                if token.type != tokenize.NAME or token.string not in by_old:
                    continue
                chosen = None
                for scope, new in by_old[token.string]:
                    if "::" not in scope:
                        chosen = new
                        break
                    span = resolve_span(spans, scope.split("::", 1)[1])
                    if span and span[0] <= token.start[0] <= span[1]:
                        chosen = new
                        break
                if chosen is None:
                    continue
                start = starts[token.start[0] - 1] + token.start[1]
                end = starts[token.end[0] - 1] + token.end[1]
                pieces.append(source[cursor:start])
                pieces.append(chosen)
                cursor = end
                edits += 1
                for scope, new in by_old[token.string]:
                    if new == chosen:
                        matched.add((scope, token.string, new))
                        break
            if edits:
                pieces.append(source[cursor:])
                source = "".join(pieces)

        for scope, old, new in rows:
            if scope.startswith("expr:") and old in source:
                edits += source.count(old)
                source = source.replace(old, new)
                matched.add((scope, old, new))

        if edits:
            total += edits
            print(f"{relative}: {edits}")
            if args.apply:
                path.write_text(source)

    unmatched = [row for row in table if row not in matched]
    if unmatched:
        print("\nMATCHED NOTHING:")
        for scope, old, new in unmatched:
            print(f"  {scope}\t{old} -> {new}")
    print(f"\n{'changed' if args.apply else 'would change'} {total} occurrence(s)")
    return 1 if unmatched else 0


if __name__ == "__main__":
    sys.exit(main())
