# Type everything, then make tools enforce it

As of 4 October 2026, best-practice Python means **targeting Python 3.14** (the current stable release; 3.15.0 final is scheduled for 9 October 2026), treating **3.11 as the oldest supported floor**, and writing every signature in modern annotation syntax: built-in generics, `X | None`, PEP 695 `type` aliases and `def f[T]` type parameters, `Self`, `@override`, and `TypeIs`. Enforcement is a two-layer stack. **Ruff formats and lints, including checking that annotations are present, and a strict type checker (mypy `--strict` or pyright strict) is the CI gate.** **Python 3.14's lazy annotation evaluation (PEP 649/749) means forward references no longer need quotes.** `from __future__ import annotations` therefore becomes a legacy pattern that is officially headed for deprecation. Around the type system, the official documentation already sets most of the house style. PEP 8 and PEP 257 cover layout and docstrings. The tutorial and library docs cover exceptions, `with`, logging and dataclasses. The Python Packaging User Guide (PyPUG) covers `pyproject.toml`, src layout, dependency groups and `pylock.toml`. Third-party tools mostly agree with this canon but depart from it in specific, nameable places. Formatters default to 88 columns and double quotes. Ruff 0.16 quietly dropped several PEP 8 checks from its default rule set. typing.python.org's guides lag the `typing` docs on alias syntax. PyPUG's tool-recommendations page still does not mention uv. The one hazard full annotation does not remove is that **annotations are never enforced at runtime**, so untrusted data still needs validation at the boundaries.

## Python 3.14 is the baseline, and 3.10 is already end-of-life

The devguide's status table, fetched on 4 October 2026, lists **3.14 in bugfix, 3.13, 3.12 and 3.11 in security-only, and 3.10 and older as end-of-life**. 3.11 reaches end-of-life in October 2027 ([Python Devguide](https://devguide.python.org/versions/)). 3.15 was at rc3 on 2 October. Its final release was postponed one week to **9 October 2026** because of "last-minute lazy-import release blockers" ([python.org: 3.15.0rc3](https://www.python.org/downloads/release/python-3150rc3/)). New projects should therefore set `requires-python` to at least `>=3.11`. In practice the floor that matters for a typed codebase is **3.12**, because that release introduced PEP 695 syntax (`def f[T]`, `class C[T]`, `type X = ...`) ([PEP 695](https://peps.python.org/pep-0695/)). Applications that control their runtime should run 3.14, which is also the version the examples below assume. PyPUG warns against capping `requires-python` with an upper bound ([PyPUG: Writing your pyproject.toml](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/)).

Two third-party defaults still point at the dead release. **Ruff's default `target-version` is still `py310`**, although Ruff infers the target from `requires-python` when that is set ([Ruff docs: Configuration](https://docs.astral.sh/ruff/configuration/)). uv's GitHub Actions example matrix still lists `3.10` ([uv docs: GitHub Actions](https://docs.astral.sh/uv/guides/integration/github/)). The fix is to declare `requires-python` explicitly and treat it as the single source of truth for every tool.

The deprecations that most affect everyday code are already in force:

| Deprecated | Since | Replacement |
|---|---|---|
| `datetime.utcnow()` and `utcfromtimestamp()` | 3.12 | `datetime.now(UTC)` and `fromtimestamp(ts, tz=UTC)` ([What's New 3.12](https://docs.python.org/3/whatsnew/3.12.html)) |
| The asyncio policy system | pending removal in 3.16 | `asyncio.run(main(), loop_factory=...)` ([Deprecations index](https://docs.python.org/3/deprecations/index.html)) |
| Keyword-argument `NamedTuple("P", x=int)` | pending removal in 3.15 | class syntax |
| `typing.AnyStr` | 3.13, removal planned in 3.18 | constrained type parameter `[S: (str, bytes)]` ([typing docs](https://docs.python.org/3/library/typing.html)) |

Python 3.14 also changed two behaviours:

* `return`, `break` or `continue` that exits a `finally` block now emits a `SyntaxWarning` (PEP 765) ([PEP 765](https://peps.python.org/pep-0765/)).
* Using `NotImplemented` in a boolean context now raises `TypeError` ([What's New 3.14](https://docs.python.org/3/whatsnew/3.14.html)).

**PEP 686 makes UTF-8 mode the default in 3.15** ([PEP 686](https://peps.python.org/pep-0686/)). Passing `encoding="utf-8"` explicitly is therefore correct on every supported version.

## Modern annotations: `type`, `def f[T]` and `X | None`, never `typing.List`

The official "Typing best practices" guide sets out a small set of rules ([Typing best practices](https://typing.python.org/en/latest/reference/best_practices.html)):

* Use **`object`, not `Any`, for "accepts anything"**. Reserve `Any` for types the type system cannot express, because `Any` switches checking off.
* Annotate a callback whose result you ignore as `Callable[..., object]`.
* **Accept abstract types (`Iterable`, `Sequence`, `Mapping`) and protocols, and return concrete types (`list`, `dict`).**
* **Avoid union return types**, because callers then need `isinstance()` checks.
* Write `X | Y` with `None` last, and use `float` rather than `int | float`.
* Use built-in generics and `collections.abc` instead of the `typing` aliases.

The `typing` module docs go further. They mark `typing.List`, `Dict`, `Tuple`, `Callable`, `Iterable`, `Sequence` and related aliases as deprecated (the change dates to [PEP 585](https://peps.python.org/pep-0585/)). They also state that **`typing.TypeAlias` has been deprecated since 3.12 in favour of the `type` statement** ([typing docs](https://docs.python.org/3/library/typing.html)). The libraries guide supplies the remaining rules ([Libraries guide](https://typing.python.org/en/latest/guides/libraries.html)):

* Use `@overload` when the return type depends on an argument's value.
* Use `Final` for constants.
* Use `Literal` for closed sets of values.
* Use `NamedTuple`, `dataclass` or `TypedDict` instead of untyped containers.
* Always give type arguments to generic bases, because a bare `list` is "partially unknown".

The first set of examples puts those rules together for 3.14. Each feature requires the following minimum Python version, per the `typing` docs and the cited PEPs.

| Feature | Minimum Python |
|---|---|
| `Self` | 3.11 |
| PEP 695 syntax (`def f[T]`, `class C[T]`, `type X = ...`) | 3.12 |
| `@override` | 3.12 |
| `Unpack` for `**kwargs` | 3.12 |
| `TypeIs` | 3.13 |
| `ReadOnly` | 3.13 |
| `warnings.deprecated` | 3.13 |

```python
import logging
from collections.abc import Callable, Iterable, Sequence
from typing import Final, Literal, TypeIs, overload

logger: logging.Logger = logging.getLogger(__name__)

MAX_RETRIES: Final = 3
type UserId = int                          # not: UserId: TypeAlias = int
type Pair[T] = tuple[T, T]


# Don't: from typing import List, Optional, TypeVar; T = TypeVar("T")
def first[T](items: Sequence[T]) -> T:
    if not items:
        raise IndexError("empty sequence")
    return items[0]


def concat[S: (str, bytes)](a: S, b: S) -> S:  # replaces deprecated AnyStr
    return a + b


def describe(value: object) -> str:            # "anything" is object, not Any
    return repr(value)


def lengths(words: Iterable[str]) -> list[int]:  # abstract in, concrete out
    return [len(word) for word in words]


def notify(callback: Callable[[int], object]) -> None:  # result ignored
    callback(MAX_RETRIES)


def is_str(value: object) -> TypeIs[str]:      # 3.13+; prefer over TypeGuard
    return isinstance(value, str)


# Overloads instead of a `str | bytes` return that forces isinstance() on callers
@overload
def read_blob(path: str, *, raw: Literal[True]) -> bytes: ...
@overload
def read_blob(path: str, *, raw: Literal[False] = False) -> str: ...
def read_blob(path: str, *, raw: bool = False) -> str | bytes:
    with open(path, "rb") as fh:
        data: bytes = fh.read()
    return data if raw else data.decode("utf-8")
```

The second set covers class-level and structural features.

```python
import functools
import logging
from collections.abc import Callable, Iterable
from enum import StrEnum, auto
from typing import (
    LiteralString, NotRequired, Protocol, ReadOnly, Self,
    TypedDict, Unpack, assert_never, override,
)
from warnings import deprecated

logger: logging.Logger = logging.getLogger(__name__)


class ConnectOptions(TypedDict):
    timeout: float
    retries: NotRequired[int]
    client_id: ReadOnly[str]                   # 3.13+


def connect(host: str, **options: Unpack[ConnectOptions]) -> None:  # not **options: Any
    logger.info("connecting to %s (timeout=%s)", host, options["timeout"])


class SupportsClose(Protocol):                 # structural: no inheritance needed
    def close(self) -> None: ...


def close_all(resources: Iterable[SupportsClose]) -> None:
    for resource in resources:
        resource.close()


class QueryBuilder:
    def __init__(self) -> None:
        self._clauses: list[LiteralString] = []

    def where(self, clause: LiteralString) -> Self:  # LiteralString rejects f-string SQL
        self._clauses.append(clause)
        return self


class AuditedQueryBuilder(QueryBuilder):
    @override                                  # checker verifies a base method exists
    def where(self, clause: LiteralString) -> Self:
        logger.debug("adding clause %s", clause)
        return super().where(clause)


def logged[**P, R](fn: Callable[P, R]) -> Callable[P, R]:  # not Callable[..., Any]
    @functools.wraps(fn)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        logger.debug("calling %r", fn)
        return fn(*args, **kwargs)
    return wrapper


class TaskStatus(StrEnum):
    TODO = auto()
    DONE = auto()


def label(status: TaskStatus) -> str:
    match status:
        case TaskStatus.TODO:
            return "To do"
        case TaskStatus.DONE:
            return "Done"
        case _:
            assert_never(status)               # a new member without a case is a type error


@deprecated("Use read_text_file() instead")    # 3.13+; checkers flag callers
def load(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()
```

`TypeIs` and `TypeGuard` narrow differently:

* **`TypeIs`** narrows a true result to the *intersection* of the input type and the guarded type, and narrows a false result to *exclude* the guarded type.
* **`TypeGuard`** narrows only on true, and narrows to exactly the guarded type. That lets it narrow to a type that is not a subtype of the input, such as `list[object]` to `list[str]`.

New code should therefore use `TypeIs` by default and reserve `TypeGuard` for that non-subtype case ([typing docs](https://docs.python.org/3/library/typing.html); [PEP 742](https://peps.python.org/pep-0742/)).

`cast` is never checked at runtime, and the official tooling only flags casts that are redundant. Avoiding `cast` in favour of `isinstance`, `TypeIs` or `match` is therefore a team rule that review has to enforce. It is not something a checker gives you automatically ([mypy command line](https://mypy.readthedocs.io/en/stable/command_line.html); [pyright configuration](https://raw.githubusercontent.com/microsoft/pyright/main/docs/configuration.md)).

**Where official sources disagree with each other:** typing.python.org's best-practices and libraries guides still show the pre-3.12 forms, `_IntList: TypeAlias = list[int]` and `TypeVar("_F", bound=Callable[..., Any])` ([Typing best practices](https://typing.python.org/en/latest/reference/best_practices.html); [Libraries guide](https://typing.python.org/en/latest/guides/libraries.html)). The `typing` docs deprecate `TypeAlias` in favour of the `type` statement. The two positions do not actually conflict: the guides are written for code that must still run on Python versions before 3.12. A 3.12+ codebase should follow the `typing` docs, and a library that supports 3.11 keeps the `TypeVar` and `TypeAlias` forms. A `type` alias produces a `TypeAliasType` object, not the underlying class. Use it only inside annotations, never with `isinstance` or for instantiation.

PEP 8's own annotation examples are also out of date. They still use `Tuple[int, int]` and implicit-Optional defaults such as `sep: AnyStr = None` ([PEP 8](https://peps.python.org/pep-0008/)). Use PEP 8 for annotation *spacing* only, not for annotation *style*. The Google guide likewise says implicit Optional "is no longer the preferred behavior" ([Google Python Style Guide](https://google.github.io/styleguide/pyguide.html)).

There is also an official preference between `Protocol` and ABCs. The best-practices guide says to prefer protocols and abstract types for parameters. The libraries guide says to use `ABC` with `@abstractmethod` for abstract class hierarchies. Taken together: **use protocols for consumer-side interfaces, and use ABCs for producer-side hierarchies that share implementation.** "Composition over inheritance" is a common community heuristic, but no official page states it.

## Lazy annotations in 3.14 retire the `__future__` import

Since Python 3.14, annotations "are no longer evaluated eagerly". They are stored in annotate functions and evaluated only when something asks for them, and "it is no longer necessary to enclose annotations in strings if they contain forward references" ([What's New 3.14](https://docs.python.org/3/whatsnew/3.14.html)). The language reference states that `from __future__ import annotations` **"will be deprecated and removed in a future version of Python, but not before Python 3.13 reaches its end of life"**. It also warns that while the import is in use, introspection through `annotationlib.get_annotations()` and `typing.get_type_hints()` is "less likely" to succeed ([Language reference §8.11](https://docs.python.org/3/reference/compound_stmts.html#annotations)). PEP 749 lays out the sequence: once 3.13 reaches end-of-life, compiling the import emits a `DeprecationWarning`, and the import is removed "after at least two releases" ([PEP 749](https://peps.python.org/pep-0749/)). 3.13 reaches end-of-life in October 2029 ([Devguide](https://devguide.python.org/versions/)).

**Code that targets 3.14 or later should not add the import, and code that must support 3.13 or earlier may keep it.** One older piece of advice now conflicts with this. The packaging notes and much community material recommend `from __future__ import annotations` together with `TYPE_CHECKING` to break import cycles that exist only because of annotations. On 3.14, the `TYPE_CHECKING` block alone is enough.

```python
# Python 3.14+: no quotes, no `from __future__ import annotations`
import annotationlib
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.billing import Invoice            # only the checker needs this import


class Node:
    def __init__(self, parent: Node | None = None) -> None:   # forward ref, unquoted
        self.parent: Node | None = parent


def invoice_total(invoice: Invoice) -> float:
    return invoice.amount


# Runtime readers (decorators, frameworks): use annotationlib, pick a Format
def field_types(cls: type) -> dict[str, object]:
    return annotationlib.get_annotations(cls, format=annotationlib.Format.FORWARDREF)
```

`annotationlib.get_annotations()` is now officially "best practice for accessing the annotations dict of any object". It supports three formats ([annotationlib docs](https://docs.python.org/3/library/annotationlib.html)):

* **`Format.VALUE`** evaluates the annotations and raises if a name is undefined.
* **`Format.FORWARDREF`** substitutes `ForwardRef` proxies for undefined names. The docs say it is usually the best choice inside metaclasses and other class-creation hooks.
* **`Format.STRING`** returns the annotations as source-like strings.

The docs add a security rule: never pass strings from untrusted input to the annotation-introspection APIs.

The practical consequence is a rule about where `TYPE_CHECKING` imports can be used. Static checkers resolve names imported under `if TYPE_CHECKING:` without trouble, and on 3.14 those names no longer fail when the function or class is defined. **Any library that evaluates annotations at runtime with `Format.VALUE` will still raise `NameError` on them.** Do not use `TYPE_CHECKING`-only names in annotations that `dataclasses`, `functools.singledispatch` or a validation framework must evaluate. The language reference names `dataclasses` and `singledispatch` as the standard-library consumers whose behaviour depends on annotation content. The same reasoning applies to validation frameworks, although their 3.14 support was not researched for this report.

The same consumers define where runtime validation belongs. The `typing` docs state plainly that "the Python runtime does not enforce function and variable type annotations" ([typing docs](https://docs.python.org/3/library/typing.html)). Static checking covers the code you control. Data that arrives from outside, such as HTTP bodies, configuration, environment variables and files, still needs explicit parsing and validation at the edge, either by hand with `isinstance` narrowing as in the `load_config` example below, or with a runtime validation library.

## Enforcement takes two layers: Ruff for presence, a strict checker for correctness

### mypy and pyright both leave useful checks off in strict mode

mypy's **`--strict`** enables the following flags ([mypy command line](https://mypy.readthedocs.io/en/stable/command_line.html)):

* `--disallow-untyped-defs`, which rejects functions with missing or partial annotations
* `--disallow-incomplete-defs`
* `--disallow-untyped-calls`
* `--disallow-any-generics`
* `--disallow-untyped-decorators`
* `--warn-redundant-casts`
* `--warn-unused-ignores`
* `--warn-return-any`
* `--no-implicit-reexport`
* `--strict-equality`
* `--extra-checks`

It does **not** enable `--warn-unreachable`, `--disallow-any-explicit` or `--disallow-any-expr`. A team that is serious about typing should add `warn_unreachable`, and should consider `disallow_any_explicit` if it wants `Any` to require a written justification. mypy also has opt-in error codes, documented on a separate page ([mypy optional error codes](https://mypy.readthedocs.io/en/stable/error_code_list2.html)), that cover things like requiring `@override`. The exact code names were not verified for this report.

**pyright's strict mode** turns these checks into errors, among others ([pyright configuration](https://raw.githubusercontent.com/microsoft/pyright/main/docs/configuration.md)):

* `reportMissingParameterType`
* `reportUnknownParameterType`, `reportUnknownArgumentType`, `reportUnknownMemberType` and `reportUnknownVariableType`
* `reportMissingTypeArgument`
* `reportUnnecessaryCast`, `reportUnnecessaryIsInstance` and `reportUnnecessaryComparison`
* `reportDeprecated`
* `reportMatchNotExhaustive`
* `reportPrivateUsage`

Some checks stay off even in strict mode. **`reportImplicitOverride`** (which requires `@override` on every override), **`reportUnnecessaryTypeIgnoreComment`**, **`reportUnreachable`**, **`reportUninitializedInstanceVariable`** and **`reportImportCycles`** must all be enabled explicitly.

Neither checker requires an explicit annotation on every module-level variable. Both infer the type instead, and pyright strict reports an error only when the inferred type is unknown. The official libraries guide also exempts literal constants, enum members, type aliases and module dunders from needing annotations ([Libraries guide](https://typing.python.org/en/latest/guides/libraries.html)). If the user's rule is literally "annotate everything", the remaining module-level variables have to be policed by review.

### mypy and pyright are the gates; Pyrefly is ready and ty is not

| Checker | Status on 4 Oct 2026 | Recommended role |
|---|---|---|
| mypy (docs at 2.4.0) | Mature; `--strict` is the reference configuration | Primary CI gate |
| pyright | Mature; strict mode via config or a per-file `# pyright: strict` comment | CI gate and editor checker |
| Pyrefly (Meta) | **v1.0 released 12 May 2026**; default checker for Instagram developers; adopted by PyTorch, NumPy and JAX; reads existing mypy and pyright config ([Pyrefly v1.0](https://pyrefly.org/blog/v1.0/)) | A credible gate for large codebases |
| ty (Astral) | **0.0.84 (24 Sep 2026), beta**; "not yet recommended for production use"; diagnostics may change between any two versions ([ty README](https://github.com/astral-sh/ty); [ty on PyPI](https://pypi.org/project/ty/)) | Fast editor or secondary check only |

No primary-source conformance results comparing these checkers against the typing spec were found, so this report does not rank them on accuracy. It also has no current information on basedpyright.

### Ruff adds the fast presence check

Ruff's `ANN` (flake8-annotations) rules fail fast in pre-commit when a function is missing annotations. The strict checker then verifies that the annotations are correct. Ruff removed `ANN101` and `ANN102` in 0.8.0, so it no longer asks for annotations on `self` and `cls` ([Ruff rules](https://docs.astral.sh/ruff/rules/)). `UP` (pyupgrade) rewrites `Optional`, `List` and similar to the modern syntax. One recent change matters here: **Ruff 0.16.0 (23 July 2026) expanded the default rule set from 59 to 413 rules, but also removed 18 "opinionated" rules from it.** The removed rules include `E711` (comparison to `None`), `E712`, `E713`, `E714`, `E721`, `E731` (assigning a lambda), `E741` (ambiguous names such as `l`), `E402`, `F403` and `F405` (wildcard imports) ([Ruff 0.16.0 release](https://github.com/astral-sh/ruff/releases/tag/0.16.0); [Simon Willison](https://simonwillison.net/2026/Jul/25/ruff/)). The removals were not recorded in Ruff's BREAKING_CHANGES file ([ruff#27199](https://github.com/astral-sh/ruff/issues/27199)). A PEP 8-first standard must therefore re-select these rules explicitly.

### A complete `pyproject.toml` configuration

The following configuration combines the cited Ruff, mypy and pytest docs:

```toml
[project]
requires-python = ">=3.12"          # drives Ruff's target-version; no upper cap

[tool.ruff]
line-length = 88

[tool.ruff.lint]
extend-select = [
  "I", "UP", "ANN", "B", "N", "D", "TID", "RUF",
  # PEP 8 recommendations Ruff 0.16 dropped from its defaults:
  "E402", "E711", "E712", "E713", "E714", "E721", "E731", "E741", "F403", "F405",
  "W505",                           # doc/comment line length
]

[tool.ruff.lint.pycodestyle]
max-doc-length = 72                 # PEP 8's limit for comments and docstrings

[tool.ruff.lint.pydocstyle]
convention = "google"

[tool.mypy]
strict = true
warn_unreachable = true             # not part of --strict
files = ["src", "tests"]            # type-check the tests too

[[tool.mypy.overrides]]
module = ["some_untyped_lib.*"]     # third-party only, never first-party code
ignore_missing_imports = true

[tool.pytest]                       # native TOML table, pytest >= 9.0
testpaths = ["tests"]
addopts = ["--import-mode=importlib", "-ra"]
strict = true
```

**Configuration location matters.** Ruff reads `.ruff.toml` before `ruff.toml` before `pyproject.toml`, and mypy reads `mypy.ini` and `.mypy.ini` before `pyproject.toml`. A forgotten standalone file therefore silently overrides the `pyproject.toml` settings ([Ruff docs: Configuration](https://docs.astral.sh/ruff/configuration/); [mypy config file](https://mypy.readthedocs.io/en/stable/config_file.html)). Keep each tool's configuration in exactly one place. In pre-commit, `ruff-check --fix` must run before `ruff-format` ([astral-sh/ruff-pre-commit](https://github.com/astral-sh/ruff-pre-commit)).

### Distributing and testing the types

A library that ships inline types must include a **`py.typed` marker file** (PEP 561). Without it, type checkers ignore the package's annotations ([Typing spec: Distributing type information](https://typing.python.org/en/latest/spec/distributing.html)). Two related rules govern what counts as public API. An imported name is public only if it is re-exported as `import X as X`, re-exported through `from Y import *`, or listed in `__all__`. Any name starting with `_` is private. Both rules matter for `__init__.py` files in typed packages.

The official type-quality guide recommends testing the types themselves ([typing.python.org: Testing and Ensuring Type Annotation Quality](https://typing.python.org/en/latest/reference/quality.html)):

* **Positive cases:** `typing.assert_type` checks that an expression has the expected type.
* **Negative cases:** a narrowly scoped `# type: ignore[code]` combined with `--warn-unused-ignores` turns into an error if the bad call ever starts type-checking.
* **Type completeness:** `pyright --verifytypes` checks that a library's public API is fully typed.

```python
# tests/typing/check_parse_types.py  -- checked by mypy, never executed
from typing import assert_type

from app.parse import parse_ids


def check_parse_ids_types() -> None:
    assert_type(parse_ids("1,2"), list[int])
    parse_ids(42)  # type: ignore[arg-type]   # errors if this ever stops failing
```

## Style follows PEP 8, but formatters overrule it in three places

PEP 8 (last modified April 2025) sets its own top rule: be consistent locally ([PEP 8](https://peps.python.org/pep-0008/)). Its concrete requirements:

* 4-space indents.
* **79-character code lines.** A team may agree on up to 99, "provided that comments and docstrings are still wrapped at 72 characters".
* Imports grouped as standard library, then third-party, then local.
* Absolute imports preferred, with explicit relative imports acceptable.
* No wildcard imports.
* `snake_case` for functions and variables, `CapWords` for classes, `UPPER_CASE` for constants.
* A leading underscore for non-public names. Use `__name` mangling only to avoid clashes in classes designed for subclassing.

PEP 8 also has a rule written specifically for annotations. The `=` of a default value normally has no surrounding spaces, but when a parameter has both an annotation and a default, **the `=` takes a space on each side** (`limit: int = 100`). It also requires a space after the colon and around `->`. In a fully annotated codebase, every defaulted parameter takes the spaced form, while keyword arguments at call sites stay unspaced (`fetch(limit=10)`).

Docstrings follow PEP 257 ([PEP 257](https://peps.python.org/pep-0257/)):

* Always use triple double quotes.
* The summary line is in the imperative mood ("Return…", not "Returns…").
* The summary is followed by a blank line and then the details.
* Function docstrings cover behaviour, arguments, return value, side effects and exceptions.
* A one-line docstring must not restate the signature.

PEP 8 requires docstrings on all public modules, functions, classes and methods. The tutorial adds that the summary "should not explicitly state the object's name or type, since these are available by other means" ([Python 3.14 tutorial](https://docs.python.org/3/tutorial/controlflow.html)). Google's guide puts types in its `Args` section only "if not annotated in the signature" ([Google Python Style Guide](https://google.github.io/styleguide/pyguide.html)), and Sphinx Napoleon treats PEP 484 annotations as the preferred place for types ([Sphinx Napoleon](https://www.sphinx-doc.org/en/master/usage/extensions/napoleon.html)). The rule follows: **types belong in the signature, and the docstring describes meaning, units, ordering and errors.** No PEP states this rule word for word; it is the consistent conclusion of PEP 257, the tutorial and the major third-party guides. PEP 257 does not prescribe any section markup. Napoleon describes the choice between Google and NumPy styles as "largely aesthetic, but the two styles should not be mixed."

```python
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class User:
    id: int
    project_id: int
    created_at: datetime
    archived: bool = False


def recent_users(
    users: Iterable[User],
    project_id: int,
    *,
    limit: int = 100,
    include_archived: bool = False,
) -> list[User]:
    """Return the project's users, newest first.

    Args:
        users: Candidate users to filter.
        project_id: ID of the project to match.
        limit: Maximum number of users to return.
        include_archived: Whether archived users are included.

    Returns:
        At most ``limit`` users, ordered by creation time, newest first.
    """
    matching: list[User] = [
        u for u in users
        if u.project_id == project_id and (include_archived or not u.archived)
    ]
    matching.sort(key=lambda u: u.created_at, reverse=True)
    return matching[:limit]
```

Black and the Ruff formatter produce identical output on more than 99.9% of lines ([Ruff formatter](https://docs.astral.sh/ruff/formatter/)). Black describes its style as following PEP 8 "in spirit" while enforcing only "a consistent subset" of it ([Black code style](https://black.readthedocs.io/en/stable/the_black_code_style/current_style.html)). In practice the formatter decides most layout questions. The table shows each place where tools and other guides depart from PEP 8:

| Topic | PEP 8 / PEP 257 (official) | Tool or guide | How it diverges |
|---|---|---|---|
| Code line length | 79; up to 99 by team agreement | Black/Ruff 88; Google 80 | 88 falls within PEP 8's team allowance, so it is compliant |
| Comment and docstring length | 72, even when code is 99 | Formatters do not wrap prose | Enforce with Ruff `W505` and `max-doc-length = 72` |
| String quotes | No preference; "pick a rule and stick to it" | Black/Ruff enforce double quotes | Compatible: the formatter picks for you |
| Line breaks around binary operators | Either, consistently; break-before suggested | pycodestyle `W503` flags break-before | The linter is *less* faithful to PEP 8 than Black ([Using Black with other tools](https://black.readthedocs.io/en/stable/guides/using_black_with_other_tools.html)) |
| Spacing around a complex slice colon | Treated like a binary operator | pycodestyle `E203` flags it | Disable `E203` |
| Docstring mood | Imperative (PEP 257) | Google allows descriptive if consistent within a file | A documented divergence from PEP 257 |
| Imports | `from m import Class` is "usually okay"; explicit relative imports acceptable | Google: import modules only (except typing names); Ruff `TID252` bans parent (`..`) imports when enabled | Stricter than PEP 8 |
| `== None`, lambda assignment, `import *`, names `l`/`O`/`I` | Discouraged | Ruff 0.16 defaults no longer flag them | Must be re-selected explicitly |

## Errors, resources, logging and data modelling already have an official house style

### Exceptions

The tutorial and PEP 8 agree on how to handle exceptions ([Tutorial: Errors](https://docs.python.org/3/tutorial/errors.html); [PEP 8](https://peps.python.org/pep-0008/)):

* **Catch the narrowest exception, around the least code**, and put the success path in `else`.
* Never write a bare `except:` unless you re-raise, because it catches `KeyboardInterrupt` and `SystemExit`.
* When translating an exception, chain it with `raise X from err`.
* Derive custom exceptions from `Exception`, never `BaseException`, and give them an `Error` suffix.
* Design an exception hierarchy around what the *catching* code needs to tell apart.

The Python glossary describes EAFP (try the operation and handle the exception) as the clean, fast Python style, and notes that LBYL (check first, then act) can race in threaded code ([Glossary](https://docs.python.org/3/glossary.html)). Several newer tools fill gaps:

* `add_note()` (3.11) attaches context to an exception without wrapping it.
* `ExceptionGroup` and `except*` (3.11) handle multiple failures from concurrent work.
* On 3.14, `except A, B:` without parentheses is legal, but only when there is no `as` clause ([What's New 3.14](https://docs.python.org/3/whatsnew/3.14.html)).

### Resources and files

**Every acquire/release pair belongs in a `with` block** ([PEP 8](https://peps.python.org/pep-0008/)). In a `@contextmanager` generator, the release must sit in `try/finally`, because exceptions from the managed block are re-raised at the `yield` ([contextlib](https://docs.python.org/3/library/contextlib.html)). Use `ExitStack` when the number of resources is dynamic.

The pathlib docs say to "start with `Path`" but warn that it is "not a drop-in replacement" for `os.path` ([pathlib](https://docs.python.org/3/library/pathlib.html)). For example, `Path` normalizes away a leading `./`, and `Path.absolute()` keeps `..` components where `os.path.abspath()` collapses them.

### Logging

The logging HOWTO sets these rules ([Logging HOWTO](https://docs.python.org/3/howto/logging.html)):

* Create one `logger = logging.getLogger(__name__)` per module.
* **Libraries add only a `NullHandler`** and never configure handlers or log to the root logger.
* Applications configure logging once, at their entry point.
* Pass message arguments %-style, because formatting is "deferred until it cannot be avoided". Passing an f-string defeats that deferral.
* Call `logger.exception()` only from inside an exception handler.

The cookbook adds two patterns to avoid: storing loggers on classes, and creating loggers per request ([Logging Cookbook](https://docs.python.org/3/howto/logging-cookbook.html)).

```python
import json
import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum, auto
from pathlib import Path

logger: logging.Logger = logging.getLogger(__name__)


class ConfigError(Exception):
    """Raised when configuration cannot be loaded."""


def load_config(path: Path) -> dict[str, object]:
    try:
        raw: str = path.read_text(encoding="utf-8")       # always pass encoding
    except FileNotFoundError as err:
        raise ConfigError(f"config missing: {path}") from err
    try:
        data: object = json.loads(raw)
    except json.JSONDecodeError as err:
        err.add_note(f"while parsing {path}")              # 3.11+
        raise
    else:
        if not isinstance(data, dict):                     # validate at the boundary
            raise ConfigError(f"expected a JSON object in {path}")
        logger.info("loaded %d keys from %s", len(data), path)  # not an f-string
        return data


@contextmanager
def timed(label: str) -> Iterator[None]:
    start: float = time.perf_counter()
    try:
        yield
    finally:                                               # release even on error
        logger.debug("%s took %.3fs", label, time.perf_counter() - start)


class TaskStatus(StrEnum):                                 # values cross I/O as strings
    TODO = auto()
    DONE = auto()


def utc_now() -> datetime:
    return datetime.now(UTC)                               # not datetime.utcnow()


@dataclass(slots=True, kw_only=True)
class Task:
    id: int
    title: str
    status: TaskStatus = TaskStatus.TODO
    tags: list[str] = field(default_factory=list)          # never `= []`
    created_at: datetime = field(default_factory=utc_now)


def add_tag(tag: str, tags: list[str] | None = None) -> list[str]:
    result: list[str] = [] if tags is None else list(tags)  # `is None`, not falsiness
    result.append(tag)
    return result
```

### Data modelling and idioms

The dataclasses docs provide the main options for record types ([dataclasses](https://docs.python.org/3/library/dataclasses.html)):

* **`frozen=True`** makes instances immutable and, together with `eq`, hashable.
* **`slots=True`** (3.10) saves memory and catches attribute typos.
* **`kw_only=True`** suits records with many fields.

Mutable defaults are rejected outright, so use `default_factory` instead. `slots=True` cannot be combined with `functools.cached_property`, because that requires an instance `__dict__` ([functools](https://docs.python.org/3/library/functools.html)). `StrEnum` (3.11) is the right choice for values persisted or sent over the wire as strings. Plain `Enum` is the right choice when accidental equality with a raw string or int would hide a bug ([enum](https://docs.python.org/3/library/enum.html)).

PEP 8's programming recommendations interact with annotations in two places:

* Use **`is None` rather than truthiness** when `None` is what you mean. An empty list is also falsy, so a truthiness check conflates the two.
* **Return statements should be consistent:** either every return in a function returns an expression or none does. A function annotated `-> float | None` should write `return None` explicitly ([PEP 8](https://peps.python.org/pep-0008/)).

A few idioms carry over from earlier versions:

* Use `zip(strict=True)` (3.10), and from 3.14 `map(strict=True)`, when lengths must match ([What's New 3.14](https://docs.python.org/3/whatsnew/3.14.html)).
* Use `match` to destructure shapes. Use dotted constants such as `case TaskStatus.DONE:` rather than bare names, which bind a new variable instead of comparing.
* Use the walrus operator (`:=`) only where it removes duplicated computation ([PEP 572](https://peps.python.org/pep-0572/); [PEP 636](https://peps.python.org/pep-0636/)).

## Packaging has converged on `pyproject.toml`, src layout and lock files, and PyPUG trails the tooling

### What PyPUG standardizes

PyPUG treats `pyproject.toml` as the single source of project metadata ([PyPUG: Writing your pyproject.toml](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/)). It calls a `[build-system]` table "strongly recommended" for every project. Core metadata lives in the standard `[project]` table (PEP 621), and the `license` field takes an SPDX expression (PEP 639). PyPUG lists concrete advantages only for the src layout ([PyPUG: src layout vs flat layout](https://packaging.python.org/en/latest/discussions/src-layout-vs-flat-layout/)). The src layout "requires installation" to run the code, which prevents accidentally importing the in-development copy. It also stops tooling and config files from becoming importable, which in a flat layout can make imports work in development and fail in production.

Dependency groups (PEP 735, `[dependency-groups]`) hold test, lint and type-checking tools. **Build backends "MUST NOT" publish them as package metadata**, which is what separates them from extras ([PyPUG spec: Dependency groups](https://packaging.python.org/en/latest/specifications/dependency-groups/)). `pylock.toml` (PEP 751) is the standard lock-file format, and it requires a hash for every package ([PyPUG spec: pylock.toml](https://packaging.python.org/en/latest/specifications/pylock-toml/)). For single-file scripts, PEP 723 inline metadata (a `# /// script` comment block) declares dependencies and `requires-python` ([Inline script metadata](https://packaging.python.org/en/latest/specifications/inline-script-metadata/)).

### Where PyPUG lags the tools

PyPUG is internally inconsistent about uv. Its pyproject guide shows a `uv_build` backend example. But its **"Tool recommendations" page, updated 2 October 2026, does not mention uv at all.** It still names pip for installing, pip-tools and Pipenv as the "recognized" tools for creating lock files, and flit, hatch, nox, pdm, Pipenv, poetry and tox as workflow tools ([PyPUG: Tool recommendations](https://packaging.python.org/en/latest/guides/tool-recommendations/)). uv's own documentation goes further:

* It calls `uv_build` "recommended for most Python projects" and makes it the default for `uv init`.
* `uv_build` supports pure-Python code only.
* It recommends capping the build backend's version (`uv_build>=0.12.23,<0.13`) ([uv docs: Build backend](https://docs.astral.sh/uv/concepts/build-backend/)).
* It writes dev tools into the standard `dev` dependency group ([uv docs: Managing dependencies](https://docs.astral.sh/uv/concepts/projects/dependencies/)).
* Its CI guide uses `uv sync --locked`, so CI fails when `uv.lock` is out of date ([uv docs: GitHub Actions](https://docs.astral.sh/uv/guides/integration/github/)).

**uv is widely used and documented on PyPUG's pyproject page, but PyPUG's own recommendations page does not endorse it.** Hatchling, setuptools, Flit and PDM-backend remain equally valid backends, and extension modules need setuptools, meson-python, scikit-build-core or Maturin.

PyPUG's warning about capping `requires-python` supports the usual split on version pins. **Applications commit a lock file with exact versions. Libraries declare lower-bound ranges and avoid upper caps on runtime dependencies.** The uv recommendation to cap the build backend is a different case, because the backend is a build-time tool that can break builds, not a runtime dependency.

### Virtual environments

Environments follow the `venv` docs ([Python docs: venv](https://docs.python.org/3/library/venv.html)):

* Use one disposable `.venv` per project.
* Never commit it to source control.
* Never move or copy it; recreate it at the new location.
* Never put project code inside it.

On distribution-managed interpreters, PEP 668's `EXTERNALLY-MANAGED` marker makes pip refuse system-wide installs. The specification says the `--break-system-packages` override "should carry some connotation that its use is risky". Use a venv instead, or pipx for command-line applications ([PyPUG spec: Externally managed environments](https://packaging.python.org/en/latest/specifications/externally-managed-environments/)).

### Command-line entry points

The `__main__` docs specify the entry-point pattern ([Python docs: `__main__`](https://docs.python.org/3/library/__main__.html)):

* Put the logic in a typed **`main() -> int`** and call it as `sys.exit(main())`. The wrappers that console scripts generate do the same.
* `main()` should return an int, not a string, because `sys.exit("text")` treats the string as an error message and exits with status 1.
* A package's `__main__.py` stays short, does not use the `if __name__ == "__main__":` guard, and imports the function it runs.

```python
# src/myproject/cli.py   (pyproject: [project.scripts] myproject = "myproject.cli:main")
import argparse
from collections.abc import Sequence


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="myproject")
    parser.add_argument("path")
    args: argparse.Namespace = parser.parse_args(argv)
    print(args.path)
    return 0


# src/myproject/__main__.py   (enables `python -m myproject`)
from myproject.cli import main

raise SystemExit(main())
```

## Tests, security and concurrency each come down to a few non-negotiable rules

### Testing: patch where a name is looked up, with autospec

**pytest** (9.1.1, June 2026) is the de facto test runner, even though the standard library ships `unittest`. pytest 9.0 added a native `[tool.pytest]` TOML table and a single **`strict = true`** option. That option turns on `strict_config`, `strict_markers`, `strict_parametrization_ids` and `strict_xfail` ([pytest changelog](https://docs.pytest.org/en/stable/changelog.html)). pytest's good-practices page recommends the src layout and `--import-mode=importlib` for new projects ([pytest good practices](https://docs.pytest.org/en/stable/explanation/goodpractices.html)). Turning warnings into errors with `filterwarnings = ["error"]` is a common practice, but neither pytest nor the Python docs make it a default.

For test doubles, the official `unittest.mock` rule applies whichever runner you use: **"patch where an object is *looked up*, which is not necessarily the same place as where it is defined"** ([unittest.mock: Where to patch](https://docs.python.org/3/library/unittest.mock.html#where-to-patch)). Pass `autospec=True` or use `create_autospec` so that a mock "will fail in the same way as your production code if [it is] used incorrectly" ([unittest.mock: Autospeccing](https://docs.python.org/3/library/unittest.mock.html#autospeccing)). A bare `MagicMock` accepts any attribute and any call, so tests built on it keep passing after a refactor breaks the real code. pytest's `monkeypatch` fixture undoes its changes automatically but performs no autospec checking. Pair it with a typed fake function so the type checker can still catch signature drift. Test code is type-checked like production code.

```python
# src/app/clock.py
from datetime import UTC, datetime


def now() -> datetime:
    return datetime.now(UTC)


# src/app/report.py
from app.clock import now                  # `now` is looked up in app.report


def stamp(message: str) -> str:
    return f"{now():%Y-%m-%d} {message}"


# tests/test_report.py
from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from app import report

FIXED: datetime = datetime(2026, 10, 4, tzinfo=UTC)


def test_stamp_patches_lookup_site() -> None:
    with patch("app.report.now", autospec=True, return_value=FIXED) as mock_now:
        assert report.stamp("hi") == "2026-10-04 hi"
    mock_now.assert_called_once_with()


def test_stamp_with_typed_fake(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_now() -> datetime:
        return FIXED

    monkeypatch.setattr(report, "now", fake_now)
    assert report.stamp("hi") == "2026-10-04 hi"
```

### Security: follow the official Security Considerations index

The Python docs keep a **Security Considerations** index of 13 modules with explicit warnings ([Security Considerations](https://docs.python.org/3/library/security_warnings.html)). The rules that matter most in practice:

* **Never unpickle untrusted data.** `pickle`, `shelve` and `multiprocessing.Connection.recv` all run on pickle, and unpickling can execute arbitrary code.
* **Use `secrets`, not `random`, for anything security-related.**
* **Never pass user input to a shell.** `subprocess` does not invoke a shell unless you pass `shell=True`, and with `shell=True` quoting becomes "the application's responsibility". Use `shutil.which()` to resolve executables to a fully qualified path ([subprocess: Security Considerations](https://docs.python.org/3/library/subprocess.html#security-considerations)).
* **Do not use `http.server` in production.** The index calls it unsuitable for production use.
* **Do not use `tempfile.mktemp`.** It is deprecated because of race conditions.

Python 3.14 made `tarfile`'s extraction filter default to `'data'`. The docs still warn that the filter "will not prevent *all* unintended or insecure behavior" ([tarfile](https://docs.python.org/3/library/tarfile.html#tarfile-extraction-filter)). Passing `filter="data"` explicitly also protects code that runs on versions before 3.14. For the supply chain, run **pip-audit** (2.10.1) in CI ([pip-audit](https://pypi.org/project/pip-audit/)) and publish through **PyPI Trusted Publishing**, which exchanges OIDC identities for API tokens that last only 15 minutes ([PyPI Trusted Publishers](https://docs.pypi.org/trusted-publishers/)).

```python
import secrets
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path


def git_log(repo: Path, ref: str) -> str:
    git: str | None = shutil.which("git")
    if git is None:
        raise RuntimeError("git not found on PATH")
    result: subprocess.CompletedProcess[str] = subprocess.run(
        [git, "-C", str(repo), "log", "--oneline", "--end-of-options", ref],
        capture_output=True, text=True, check=True, timeout=30,   # argv list, no shell
    )
    return result.stdout


def new_api_token() -> str:
    return secrets.token_urlsafe(32)


def safe_extract(archive: Path) -> Path:
    dest: Path = Path(tempfile.mkdtemp(prefix="extract-"))
    with tarfile.open(archive) as tf:
        tf.extractall(dest, filter="data")     # explicit: default only from 3.14
    return dest
```

### Concurrency: use structured concurrency

The asyncio docs set four rules:

* **Use `asyncio.TaskGroup` and `asyncio.timeout`** (both 3.11). The docs say TaskGroup gives "stronger safety guarantees than *gather*", because it cancels sibling tasks when one fails ([Coroutines and Tasks](https://docs.python.org/3/library/asyncio-task.html#asyncio.TaskGroup)).
* **Keep a strong reference to any task started with `create_task`.** The event loop holds only weak references, so an unreferenced task "may get garbage collected at any time".
* **Never swallow `CancelledError`.** TaskGroup and timeout are built on cancellation and "might misbehave" if it is suppressed ([asyncio-task: Task Cancellation](https://docs.python.org/3/library/asyncio-task.html#task-cancellation)).
* **Never block the event loop.** Hand blocking calls to `asyncio.to_thread` or an executor ([Developing with asyncio](https://docs.python.org/3/library/asyncio-dev.html)).

For CPU-bound work, 3.14 adds two options. `ProcessPoolExecutor` now defaults to the `forkserver` start method on Linux. `InterpreterPoolExecutor` (PEP 734) runs work in subinterpreters, which isolate state like processes do, but still has limits: few third-party extensions support it, and starting an interpreter is slow ([What's New 3.14](https://docs.python.org/3/whatsnew/3.14.html)). The free-threaded (no-GIL) build is **officially supported but optional** in 3.14 (PEP 779). The two official sources give different overhead figures: What's New quotes a single-thread penalty of "roughly 5-10%", while the free-threading HOWTO measures about 1% on macOS aarch64 and 8% on x86-64 Linux ([free-threading HOWTO](https://docs.python.org/3/howto/free-threading-python.html)). The difference comes from how each measured. The JIT is still experimental in both 3.14 and 3.15. Performance work should therefore still begin with measurement: `timeit`, `cProfile` and `tracemalloc` today, and in 3.15 the new `profiling.sampling` profiler, which can attach to a running process ([What's New 3.15](https://docs.python.org/3.15/whatsnew/3.15.html)). Every asyncio and futures type is generic, so annotate them with their type arguments (`asyncio.Task[T]`, `asyncio.Queue[T]`).

```python
import asyncio
from collections.abc import Iterable


async def fetch_one(url: str) -> bytes:
    await asyncio.sleep(0.1)                   # stand-in for real async I/O
    return url.encode()


async def fetch_all(
    urls: Iterable[str], *, limit: int = 10, deadline_s: float = 30.0
) -> dict[str, bytes]:
    sem: asyncio.Semaphore = asyncio.Semaphore(limit)

    async def bounded(url: str) -> tuple[str, bytes]:
        async with sem:
            return url, await fetch_one(url)

    async with asyncio.timeout(deadline_s):    # bound the whole operation
        async with asyncio.TaskGroup() as tg:  # failure cancels siblings
            tasks: list[asyncio.Task[tuple[str, bytes]]] = [
                tg.create_task(bounded(u)) for u in urls
            ]
    return dict(t.result() for t in tasks)


async def worker(queue: asyncio.Queue[str]) -> None:
    try:
        while True:
            item: str = await queue.get()
            try:
                print(item)
            finally:
                queue.task_done()
    except asyncio.CancelledError:
        raise                                  # clean up, then always re-raise
```

## Conclusion

A fully typed Python codebase in late 2026 depends less on picking one style guide than on knowing which source has authority on each question. The `typing` docs on docs.python.org are now the most current statement of typing practice. typing.python.org's guides lag them on alias and type-variable syntax. PEP 8's examples lag its own rules. A standard written today should therefore cite the `typing` docs for syntax, PEP 8 for spacing and naming, and PEP 257 for docstring form. It should also record each tool divergence explicitly, because three of the most consequential ones arrived silently: Ruff 0.16 removed PEP 8 checks from its defaults, Ruff's default target is still the end-of-life 3.10, and PyPUG's tool recommendations do not mention uv.

The bigger shift is that 3.14's lazy annotations change what "correct" annotation code looks like. Unquoted forward references and `TYPE_CHECKING` imports without the `__future__` import are now the right pattern. The same change makes runtime consumers of annotations the main remaining source of typing bugs: dataclasses, `singledispatch`, and validation frameworks that evaluate annotations. Teams moving to a 3.14 baseline should audit those call sites first. Until ty reaches a stable release, they should keep mypy `--strict` or pyright strict as the CI gate, with Pyrefly 1.0 as a credible alternative for large codebases.
