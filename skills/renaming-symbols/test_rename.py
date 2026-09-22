#!/usr/bin/env python3
"""
Tests for rename.py. Standard library only: run `python3 -m unittest test_rename`.
"""

from __future__ import annotations

import contextlib
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))

import rename


class CliCase(unittest.TestCase):
    """
    A temporary tree as the working directory, since main() paths are cwd-relative.
    """

    def setUp(self) -> None:
        self.origin = Path.cwd()
        self.tmp = tempfile.TemporaryDirectory()
        os.chdir(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(os.chdir, self.origin)

    def run_cli(
        self, files: dict[str, str], table: str, *flags: str
    ) -> tuple[int, str]:
        for name, text in files.items():
            path = Path(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        Path("table.tsv").write_text(table)

        argv = ["rename.py", "table.tsv", "--root", ".", *flags]
        out = io.StringIO()
        with mock.patch.object(sys, "argv", argv), contextlib.redirect_stdout(out):
            code = rename.main()
        return code, out.getvalue()


class TestLoadTable(unittest.TestCase):
    def load(self, text: str):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "table.tsv")
            path.write_text(text)
            return rename.load_table(path)

    def test_comments_and_blank_lines_are_skipped(self) -> None:
        rows = self.load("# a comment\n\n*\told\tnew\n")
        self.assertEqual(rows, [("*", "old", "new")])

    def test_wrong_field_count_exits(self) -> None:
        with self.assertRaises(SystemExit):
            self.load("*\told\n")

    def test_non_identifier_pair_exits(self) -> None:
        with self.assertRaises(SystemExit):
            self.load("*\told name\tnew\n")

    def test_expr_scope_skips_the_identifier_check(self) -> None:
        rows = self.load("expr:*\ta.b(c)\ta.d(c)\n")
        self.assertEqual(rows, [("expr:*", "a.b(c)", "a.d(c)")])

    def test_duplicate_scope_and_old_exits(self) -> None:
        with self.assertRaises(SystemExit):
            self.load("*\told\tone\n*\told\ttwo\n")

    def test_chaining_new_name_exits(self) -> None:
        with self.assertRaises(SystemExit):
            self.load("*\ta\tb\n*\tb\tc\n")


class TestCli(CliCase):
    def test_dry_run_reports_without_writing(self) -> None:
        source = "value = 1\nprint(value)\n"
        code, out = self.run_cli({"mod.py": source}, "*\tvalue\tamount\n")
        self.assertEqual(code, 0)
        self.assertEqual(Path("mod.py").read_text(), source)
        self.assertIn("mod.py: 2", out)
        self.assertIn("would change 2 occurrence(s)", out)

    def test_apply_writes_names_but_not_strings_or_comments(self) -> None:
        source = '# value stays\nvalue = {"value": 1}  # value\n'
        code, out = self.run_cli({"mod.py": source}, "*\tvalue\tamount\n", "--apply")
        self.assertEqual(code, 0)
        self.assertEqual(
            Path("mod.py").read_text(),
            '# value stays\namount = {"value": 1}  # value\n',
        )
        self.assertIn("changed 1 occurrence(s)", out)

    def test_row_matching_nothing_exits_one(self) -> None:
        code, out = self.run_cli(
            {"mod.py": "value = 1\n"}, "*\tvalue\tamount\n*\tabsent\tgone\n"
        )
        self.assertEqual(code, 1)
        self.assertIn("MATCHED NOTHING:", out)
        self.assertIn("absent -> gone", out)
        self.assertNotIn("value -> amount", out)

    def test_narrow_function_scope_beats_a_wider_row_below_it(self) -> None:
        source = "def inner():\n    value = 1\n\n\ndef outer():\n    value = 2\n"
        code, _ = self.run_cli(
            {"mod.py": source},
            "mod.py::inner\tvalue\tinner_value\nmod.py\tvalue\touter_value\n",
            "--apply",
        )
        self.assertEqual(code, 0)
        self.assertEqual(
            Path("mod.py").read_text(),
            "def inner():\n    inner_value = 1\n\n\ndef outer():\n    outer_value = 2\n",
        )

    def test_expr_row_replaces_literal_text_everywhere(self) -> None:
        code, out = self.run_cli(
            {"mod.py": 'log("a.b")\nx = a.b\n'}, "expr:*\ta.b\ta.c\n", "--apply"
        )
        self.assertEqual(code, 0)
        self.assertEqual(Path("mod.py").read_text(), 'log("a.c")\nx = a.c\n')
        self.assertIn("changed 2 occurrence(s)", out)

    def test_rows_sharing_a_new_name_are_each_credited_to_their_own_scope(self) -> None:
        # Both rows fire in the same file and agree on the new name, so crediting by new
        # name alone reports the second one as having matched nothing.
        source = "def first():\n    value = 1\n\n\ndef second():\n    value = 2\n"
        code, out = self.run_cli(
            {"mod.py": source},
            "mod.py::first\tvalue\tamount\nmod.py::second\tvalue\tamount\n",
            "--apply",
        )
        self.assertEqual(
            Path("mod.py").read_text(),
            "def first():\n    amount = 1\n\n\ndef second():\n    amount = 2\n",
        )
        self.assertNotIn("MATCHED NOTHING", out)
        self.assertEqual(code, 0)


class TestFileRewriter(unittest.TestCase):
    def rewrite(self, source: str, *rows: tuple[str, str, str]) -> rename.FileRewriter:
        rewriter = rename.FileRewriter(source, list(rows))
        rewriter.rewrite_identifiers()
        rewriter.rewrite_expressions()
        return rewriter

    def test_only_name_tokens_change(self) -> None:
        rewriter = self.rewrite('value = "value"  # value\n', ("*", "value", "amount"))
        self.assertEqual(rewriter.source, 'amount = "value"  # value\n')
        self.assertEqual(rewriter.edits, 1)

    def test_matched_records_the_row_that_actually_fired(self) -> None:
        source = "def inner():\n    value = 1\n"
        narrow = ("mod.py::inner", "value", "inner_value")
        wide = ("mod.py", "value", "outer_value")
        rewriter = self.rewrite(source, narrow, wide)
        self.assertEqual(rewriter.source, "def inner():\n    inner_value = 1\n")
        self.assertEqual(rewriter.matched, {narrow})

    def test_bare_method_name_resolves_when_one_class_defines_it(self) -> None:
        source = "class One:\n    def run(self):\n        value = 1\n"
        rewriter = self.rewrite(source, ("mod.py::run", "value", "amount"))
        self.assertEqual(
            rewriter.source, "class One:\n    def run(self):\n        amount = 1\n"
        )

    def test_bare_method_name_is_declined_when_two_classes_define_it(self) -> None:
        source = (
            "class One:\n    def run(self):\n        value = 1\n\n\n"
            "class Two:\n    def run(self):\n        value = 2\n"
        )
        rewriter = self.rewrite(source, ("mod.py::run", "value", "amount"))
        self.assertEqual(rewriter.source, source)
        self.assertEqual(rewriter.matched, set())

    def test_a_table_without_a_function_scope_never_parses_the_file(self) -> None:
        rewriter = self.rewrite("value = 1\n", ("*", "value", "amount"))
        self.assertEqual(rewriter.source, "amount = 1\n")
        self.assertIsNone(rewriter._spans)

    def test_expr_pass_counts_every_occurrence(self) -> None:
        rewriter = self.rewrite('a.b\nlog("a.b")\n', ("expr:mod.py", "a.b", "a.c"))
        self.assertEqual(rewriter.source, 'a.c\nlog("a.c")\n')
        self.assertEqual(rewriter.edits, 2)


if __name__ == "__main__":
    unittest.main()
