# Python Standards

Applies to every Python module in a backend: application code, scripts, migrations, and
tests. Library-specific rules are in the other documents in this folder.

**Stack:** CPython 3.14, [uv](https://docs.astral.sh/uv/) for environments and
dependencies, hatchling as the build backend, [Ruff](https://docs.astral.sh/ruff/) to
format, lint, and sort imports, and [pyright](https://microsoft.github.io/pyright/) in
`strict` mode to type-check, in CI and (as Pylance) in the editor.

Where sources disagree, these rules follow Python's official documentation
(docs.python.org and the PEPs) over tool defaults and third-party guides. The evidence is
in [Python best practices](../../research/python/python-best-practices.md).

---

## Version and dependencies

**PY-1 — Target Python 3.14,** the current bugfix release (3.11 to 3.13 get security
fixes only). Pin it in four places that MUST agree: `.python-version` (`3.14`),
`requires-python = ">=3.14"` in `pyproject.toml` (Ruff takes its target version from it;
never add an upper bound), pyright's `pythonVersion` (PY-9), and the base image and
`actions/setup-python` version. Upgrade them all in one PR.

**PY-2 — Manage the environment with uv.** Runtime dependencies go in
`[project] dependencies`; tools and test libraries go in `[dependency-groups] dev`. Use
`uv add <pkg>` / `uv add --dev <pkg>` rather than editing versions by hand, and commit
`uv.lock` with the change.

```toml
[project]
requires-python = ">=3.14"
dependencies = [
    "alembic>=1.20,<1.21",
    "fastapi[standard]>=0.142.2,<0.143",  # minor-range pin (fastapi.md FAPI-22)
    "psycopg[binary]>=3.3",
    "pydantic>=2.13.5,<2.14",
    "sqlalchemy>=2.1.3,<2.2",
]

[dependency-groups]
dev = [
    "factory-boy>=3.3.3",
    "pyright[nodejs]>=1.1.414",
    "pytest>=9.0.3",
    "pytest-mock>=3.15.1",
    "requests-mock>=1.12.1",
    "ruff>=0.16.10",
]
```

**PY-3 — Images and CI install from the lockfile:** `uv sync --locked`. Run tools with
`uv run <tool>` so they use the project environment. Never `pip install` into a project
environment.

**PY-4 — Do not add a library that duplicates one already in use** (a second HTTP client,
a second date library, a second ORM). `arrow` was used in the earlier project; new code
uses the standard library `datetime` (PY-24).

---

## Layout

**PY-5 — Lay out a backend as top-level packages under `backend/`:**

```txt
backend/
  pyproject.toml  uv.lock  .python-version
  alembic.ini  pytest.ini  pytest.ci.ini
  conftest.py                     root fixtures (pytest.md)
  api/
    app/main.py                   the FastAPI app (fastapi.md)
    crons/                        scheduled job handlers and their registry
    dependencies/                 FastAPI dependencies
    middlewares/
    models/<resource>.py          request and response models
    routes/<resource>.py          one router per resource
    routes/handlers/<resource>.py logic a route needs beyond one facade call
    _tests/
  config/                         EnvVars and EnvVarManager (PY-26)
  constants/                      module-level constants, grouped by topic
  db/
    base_db.py                    declarative base (sqlalchemy.md)
    db_session_manager.py         engine and session factory
    migrations/                   Alembic (alembic.md)
  models/
    base/                         BaseEntityModel, BaseFacade
    mixins/                       column and field mixins
    <entity>/db.py                SQLAlchemy model
    <entity>/entity.py            Pydantic entity
    <entity>/facade.py            data access for the entity
    _tests/<entity>/
  services/                       integrations and domain logic
    exceptions.py                 the service exception hierarchy (PY-20)
    _tests/
  scripts/                        one-off and operational commands
  utils/                          framework-free helpers
  _factories/  _mocks/  _fixtures/   test support (pytest.md)
```

Every package directory has an `__init__.py`. List the top-level packages under
`[tool.hatch.build.targets.wheel] packages` so the project installs into its environment.

**PY-6 — Import from the package roots** (`from models.project.facade import ...`,
`from services.exceptions import ...`). Never import through a `backend.` prefix and never
use relative imports outside an `__init__.py`.

**PY-7 — Dependencies point one way:** `api` → `services` → `models` → `db`, with
`config`, `constants`, and `utils` importable from anywhere. `models` MUST NOT import from
`services` or `api`, and nothing outside `_tests/` imports from `_factories`, `_mocks`, or
`_fixtures`.

---

## Formatting, linting, and type checking

**PY-8 — Ruff formats and lints every Python file, and pyright type-checks it.** Do not
hand-format code the formatter will rewrite. Locally, `uv run ruff check --fix` sorts
imports and applies safe fixes; run it before `ruff format`, since a fix can leave code
the formatter has to tidy. CI runs all three checks and fails on any finding:

```sh
uv run ruff format --check .
uv run ruff check .
uv run pyright
```

**PY-9 — Configure both tools in `pyproject.toml` and nowhere else.** A `ruff.toml`,
`.ruff.toml`, or `pyrightconfig.json` silently overrides the `pyproject.toml` table.
Pylance reads the same `[tool.pyright]` table, so the editor reports what CI enforces.

```toml
[tool.ruff]
line-length = 88                 # formatter width, inside PEP 8's 99-column allowance

[tool.ruff.lint]
extend-select = [
    "ANN",                       # annotations present (PY-18)
    "B",                         # likely bugs, such as mutable defaults
    "D", "D401",                 # docstrings (PY-29), imperative summary (PEP 257)
    "E501", "W505",              # code and comment/docstring line length
    "G004",                      # no f-strings in log calls (PY-40)
    "I",                         # import order (PY-12)
    "N",                         # PEP 8 naming, including the Error suffix (PY-15)
    "RUF",
    "UP",                        # current syntax: `X | None`, built-in generics
    # PEP 8 recommendations that Ruff 0.16 dropped from its defaults:
    "E402", "E711", "E712", "E713", "E714", "E721", "E731", "E741", "F403", "F405",
]

[tool.ruff.lint.per-file-ignores]
"__init__.py" = ["F401"]         # explicit re-exports (PY-13)
"**/_tests/**" = ["D"]           # test docstrings follow pytest.md PYTEST-8
"**/conftest.py" = ["D"]
"_factories/**" = ["D"]
"_mocks/**" = ["D"]

[tool.ruff.lint.pycodestyle]
max-line-length = 99             # PEP 8's ceiling, for lines the formatter cannot split
max-doc-length = 72              # PEP 8's limit for comments and docstrings

[tool.ruff.lint.pydocstyle]
convention = "google"

[tool.ruff.lint.flake8-annotations]
allow-star-arg-any = true        # pass-through **kwargs (httpx.md HTTPX-4)

[tool.ruff.lint.flake8-type-checking]
# Classes whose annotations are read at runtime (PY-14). Ruff does not follow
# inheritance across modules, so list each project base class as well.
runtime-evaluated-base-classes = [
    "pydantic.BaseModel",
    "sqlalchemy.orm.DeclarativeBase",
    "db.base_db.BaseDB",
    "models.base.entity.BaseEntityModel",
]
# Pydantic also evaluates validator and serializer signatures at runtime.
runtime-evaluated-decorators = [
    "pydantic.field_serializer",
    "pydantic.field_validator",
    "pydantic.model_serializer",
    "pydantic.model_validator",
    "pydantic.validate_call",
]

[tool.pyright]
pythonVersion = "3.14"
typeCheckingMode = "strict"
venvPath = "."
venv = ".venv"
reportImplicitOverride = "error"              # @override on every override (PY-44)
reportUnnecessaryTypeIgnoreComment = "error"  # stale suppressions fail (PY-10)
```

The formatter's 88 columns and double quotes are compatible with PEP 8, which allows up
to 99 columns by team agreement and any consistent quote style. Formatters do not wrap
comments or docstrings, so `W505` enforces PEP 8's 72 columns for them. Ruff 0.16
removed several PEP 8 checks from its defaults (comparing to `None` with `==`, assigning
a lambda, wildcard imports, ambiguous names like `l`), and pyright's strict mode leaves
`reportImplicitOverride` and `reportUnnecessaryTypeIgnoreComment` off, so the
configuration turns them back on.

**PY-10 — Suppress a finding only on the line where it occurs, naming the rule and giving
a reason:** `import api.crons.job_registry  # noqa: F401 - registers cron decorators` for
Ruff, and `# pyright: ignore[reportUnknownMemberType]` for pyright, with the reason on
the line above. Never use a bare `# noqa` or `# type: ignore`, which silence every rule
on the line, and never suppress a whole file in application code. A test-support module
built on a library without type information MAY turn off specific pyright rules in a
file-level `# pyright:` comment (pytest.md PYTEST-23).

---

## Imports

**PY-11 — Do not use `from __future__ import annotations`.** Since 3.14, annotations are
evaluated lazily (PEP 649 and PEP 749), so forward references need no quotes and the
import adds nothing. The language reference says it will be deprecated once 3.13 reaches
end of life, and while it is in place, runtime readers of annotations
(`typing.get_type_hints()`, `annotationlib.get_annotations()`) are less likely to
succeed. Pydantic, FastAPI, and `dataclasses` all read annotations at runtime. Remove the
import from a module when the module moves to 3.14 (PY-1).

**PY-12 — Group imports as standard library, third party, then first party,** separated
by one blank line and sorted alphabetically within each group (`import x` lines before
`from x import y` lines of the same group). Ruff's `I` rules enforce the order and
`ruff check --fix` applies it (PY-8).

```python
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.project.entity import ProjectEntity
from services.exceptions import ProjectSyncError
```

**PY-13 — No wildcard imports** (`from .env_vars import *`). Re-export explicitly and list
the names in `__all__`.

**PY-14 — Import inside a function only to break a genuine import cycle or to defer a
heavy optional import** (`from rich.logging import RichHandler` in development only), and
say which in a comment. Type-only imports go under `if TYPE_CHECKING:`, but never for a
name used in an annotation that is evaluated at runtime (a Pydantic field, a FastAPI
parameter, a dataclass field, a `functools.singledispatch` signature, a SQLAlchemy
`Mapped[...]` column): there the name is undefined and raises `NameError`. The one
exception is a SQLAlchemy relationship target from another module, which stays quoted and
under `TYPE_CHECKING` (`Mapped[list["TaskDB"]]`, sqlalchemy.md SQLA-10), because
SQLAlchemy looks it up by class name. Ruff's `runtime-evaluated-base-classes` setting
(PY-9) keeps its import fixes from breaking these rules.

---

## Naming

**PY-15 — Use these name patterns:**

| Thing                         | Pattern                          | Example                                |
| ----------------------------- | -------------------------------- | -------------------------------------- |
| module, package, function     | `snake_case`                     | `exchange_rate.py`, `resolve_host()`   |
| class                         | `PascalCase`                     | `SingletonMeta`                        |
| SQLAlchemy model              | `<Entity>DB`                     | `ProjectDB`                            |
| Pydantic entity               | `<Entity>Entity`                 | `ProjectEntity`, `NewestProjectEntity` |
| data-access class             | `<Entity>Facade`                 | `ProjectFacade`                        |
| request / response model      | `<Entity><Action>Request`, `<Entity>Response`, `<Entities>ListResponse` | `ProjectCreateRequest` |
| router                        | `<resources>_router`             | `projects_router`                      |
| constant                      | `UPPER_SNAKE_CASE`               | `REQUEST_TIMEOUT`                      |
| type alias                    | `PascalCase`, with `type`        | `type Coords = tuple[float, float]`    |
| type parameter                | short `PascalCase` (PEP 8)       | `T`, `EntityT`                         |
| module-private name           | leading underscore               | `_send()`, `_DOM_SELECTORS`            |
| exception                     | `<Failure>Error` (PEP 8)         | `FetchError`, `UnsupportedSourceError` |

**PY-16 — Name a value after what it holds, including its unit or currency** when it has
one: `distance_km`, `purchase_price_cop`, `REQUEST_TIMEOUT` (seconds, stated in a
comment), `ttm_revenue`. Do not shadow built-ins other than `id`, which facades accept as
a keyword argument by convention.

**PY-17 — Order a module as: docstring, imports, constants, public classes and functions,
then private helpers.** Private helpers (`_parse_dom`, `_drop_empty`) go at the bottom,
after the public functions that call them.

---

## Functions and types

**PY-18 — Annotate every parameter and every return type, everywhere,** except `self` and
`cls`: application code, scripts, migrations, and tests and fixtures too (pytest.md
PYTEST-23). A function that returns nothing is annotated `-> None`. Also annotate class
and instance attributes (`self._rates: dict[date, Decimal] = {}`) and any module-level
variable whose type pyright cannot infer. Local variables and literal constants MAY be
annotated where it helps the reader, but it is not required: pyright infers them, and
the official typing guide exempts literal constants. Write annotations in current
syntax:

- `X | None`, with `None` last, never `Optional[X]`; `A | B`, never `Union[A, B]`
  (`id: UUID | str`).
- Built-in generics (`list[str]`, `dict[str, Any]`, `tuple[float, float, int]`), never
  `typing.List`, `Dict`, or `Tuple`.
- `Callable`, `Iterable`, `Iterator`, `Sequence`, `Mapping`, and `Generator` from
  `collections.abc`; the `typing` versions are deprecated.
- `Self` (from `typing`) for a method that returns its own instance.

Ruff's `ANN` and `UP` rules flag a missing annotation or an outdated form (PY-9), and
pyright strict rejects code whose types it cannot work out. The other typing rules are
PY-41 to PY-46.

**PY-19 — Make parameters keyword-only (`*`) when a function takes optional flags,
several values of the same type, or a payload:**

```python
def get_revenue_estimate(
    *, latitude: float, longitude: float, bedrooms: int, baths: float, guests: int
) -> dict[str, Any]: ...

def create_or_update(self, *, payload: dict[str, Any]) -> ProjectEntity: ...

def get_one_by_id(
    self, id: UUID | str, *, include_tasks: bool = False
) -> ProjectEntity: ...
```

Mutable defaults are never used (`variables: list = []`); default to `None` or use a
factory.

---

## Errors

**PY-20 — Each area defines its own exception hierarchy in one module**, with a base
class derived from `Exception` (never `BaseException`), names ending in `Error` (PEP 8,
PY-15), and a docstring on every class saying when it is raised:

```python
class ScrapeError(Exception):
    """Base for any failure while sourcing a record from a web page."""


class FetchError(ScrapeError):
    """Raised when a page could not be retrieved."""


class UnsupportedSourceError(ScrapeError):
    """Raised when no parser is registered for a URL's host."""
```

Keep unrelated failures in separate hierarchies so callers can map them differently (a
route turns `ScrapeError` into a 4xx and an upstream API error into a 502).

**PY-21 — Facades raise their own nested `NotFoundError`**, with a message naming the key
that missed (sqlalchemy.md SQLA-17). Do not let SQLAlchemy's exception escape a facade.

**PY-22 — Wrap and re-raise with `from exc`,** and include what failed in the message
(`f"AirROI request to '{url}' failed: {exc}"`). Never re-raise a bare `Exception`, never
use a bare `except:`, and never swallow an error without logging it.

**PY-23 — Catch the most specific exception first, and comment when the order matters**
because of an inheritance you would not guess:

```python
# ``JSONDecodeError`` subclasses ``RequestException``, so it has to
# be caught first or a malformed body is reported as a transport
# failure.
except requests.exceptions.JSONDecodeError as exc: ...
except requests.RequestException as exc: ...
```

`except Exception` is allowed only at a boundary that must keep going or translate
everything: a route (fastapi.md FAPI-13), one iteration of a batch loop, or a cron job.
It always logs.

---

## Dates and times

**PY-24 — Every `datetime` is timezone-aware UTC.** Create with
`datetime.now(timezone.utc)`; never call `datetime.utcnow()` or `datetime.now()` without a
zone. Normalize parsed values: attach UTC to a naive value only when the source is known
to be UTC, otherwise convert with `.astimezone(timezone.utc)`. Serialize with
`.isoformat()`.

**PY-25 — Code that needs "now" for a calculation takes it as an argument** (or reads it
in one place at the edge) so it can be tested without patching. Pure calculation modules
take no clock at all (PY-33).

---

## Configuration

**PY-26 — Read environment variables only in `config/env_vars.py`**, in one frozen
Pydantic model validated from `os.environ` (pydantic.md PYD-15). Everything else reads
`EnvVarManager().env_vars`. No other module calls `os.getenv` or `os.environ[...]`,
except test setup. Uvicorn reads its own `UVICORN_*` variables (fastapi.md FAPI-2). This
deliberately differs from FastAPI's documented settings pattern (a pydantic-settings class
behind an `lru_cache` dependency): the same configuration serves scripts, cron handlers,
and Alembic outside any request.

**PY-27 — Read configuration when it is used, not at import time,** for values that may
change between import and use (an API key, a database name the test suite overrides):

```python
def _headers() -> dict[str, str]:
    # Read per call, so tests and scripts see the current key.
    return {"x-api-key": EnvVarManager().env_vars.airroi_api_key.get_secret_value()}
```

**PY-28 — Process-wide managers (`EnvVarManager`, `DBSessionManager`) use
`SingletonMeta`** from `utils/singleton_meta.py`, which is thread-safe. Do not add other
singletons without a reason in the class docstring.

---

## Docstrings and comments

**PY-29 — Every public module, class, function, and method has a docstring** (PEP 8),
every route included; tests follow pytest.md PYTEST-8 instead. Use triple double quotes
and start the summary on the first line, in the imperative mood for a function or method
("Return an owner's projects", not "Returns…"; PEP 257). The summary is enough when the
name and signature say the rest. Otherwise, after a blank line, explain why rather than
what: the alternative and why it was rejected, the upstream quirk the code works around.
Never restate types, which are in the signature (PY-18). Wrap docstrings and comments at
72 columns (PEP 8). Refer to identifiers with double backticks (``` ``source_url`` ```).

**PY-30 — Use Google-style sections when they add information:** `Args:`, `Returns:`,
`Yields:`, `Raises:`. Omit a section that would only repeat the signature. An `Args:`
section, when there is one, lists every parameter (Ruff `D417`).

```python
def get_all_by_owner_id(
    self, owner_id: UUID | str, *, status: str | None = None, limit: int | None = None
) -> list[ProjectEntity]:
    """Return an owner's projects, newest first.

    Every filter is pushed into the query; filtering in Python after
    fetching would make ``limit`` describe the page rather than the
    owner's projects.

    Raises:
        ValueError: For an unrecognised ``status``.
    """
```

**PY-31 — Document a non-obvious constant or column with an attribute docstring**
directly below it:

```python
MATCH_RADIUS_KM = 50.0
"""How far a project site may sit from a region's centroid and still
belong to it: wider than any one region's footprint, narrower than the
gap between regions.
"""
```

**PY-32 — Mark comments with `NOTE:` for a surprising behaviour and `TODO:` for known
follow-up work**, and say what the follow-up is. Do not commit commented-out code; delete
it (git keeps it).

---

## Module design

**PY-33 — Keep domain arithmetic in pure modules:** no database session, no HTTP, no
clock. Callers pass in rates, dates, and inputs; the module returns values. The module
docstring states that it is pure.

**PY-34 — Talk to each external system from exactly one module** (`services/<system>.py`)
that owns its base URL, headers, timeouts, and error wrapping (httpx.md). Other modules
call its functions; they never build requests to that system themselves.

**PY-35 — Use a registry dict to dispatch on a key** instead of an `if`/`elif` chain when
new cases will be added (`_PARSERS: dict[str, Callable[[str], dict[str, Any]]]` keyed by
host). Adding a case is then one new module and one entry.

**PY-36 — Scripts are runnable modules** with a typed `main() -> int` that parses its
arguments with `argparse` and returns the exit status, called as `sys.exit(main())` from
an `if __name__ == "__main__":` block (the pattern in the `__main__` docs). Return `0` or
an error code, never a string: `sys.exit("text")` prints the text and exits with status
1. Configure logging once at the top (PY-38). Scripts own their session and commit
(sqlalchemy.md SQLA-15).

```python
def main(argv: Sequence[str] | None = None) -> int:
    """Rebuild the reports of projects changed since a date."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", type=date.fromisoformat, required=True)
    args = parser.parse_args(argv)
    ...
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

---

## Logging

**PY-37 — Create one logger per module, at module scope, named after the module:**
`logger = logging.getLogger(__name__)`. When the module uses `ExtendedLogger` helpers
(`log_centered`, `log_pretty`), cast it:
`logger = cast(ExtendedLogger, logging.getLogger(__name__))`. Do not name loggers after
`__file__`. That `cast` is the standing exception to PY-45: `getLogger()` cannot say
which logger class it returns.

**PY-38 — Configure logging once per process,** in the entry point (`api/app/main.py`, a
script's top, a spider's settings) with `init_logging(app_name=...)` from
`utils/logging/init.py`. It installs `RichHandler` outside production and a plain
`StreamHandler` in production, and sets the level from `LOG_LEVEL`. Library modules never
call `basicConfig` or add handlers.

**PY-39 — Use the level for its audience:** `debug` for state while developing, `info`
for lifecycle and progress of a job, `warning` for a recoverable surprise (a missing
optional block, a fallback taken), `error` for a failure, with the exception attached
(`logger.exception(...)` inside `except`, or `exc_info=True`).

**PY-40 — Pass values to a log call as %-style arguments, not in an f-string,** quoting
each value and naming its key:
`logger.warning("Could not fetch exchange rate for date='%s': %s", target_date, exc)`.
The logging module formats the message only when a handler emits the record (Logging
HOWTO, "Optimization"), and the unformatted message stays constant, so log tools can
group records by it. The reference codebases use f-strings; the official guidance wins
here, and Ruff's `G004` flags them (PY-9). Never log secrets, tokens, API keys, or full
request headers, and do not commit `print()` or `rich.inspect()` calls in application
code.

---

## Typing

**PY-41 — Use `object`, not `Any`, for a value that may be anything.** `Any` turns
checking off for everything it touches. Reserve it for what the type system cannot
describe (a decoded JSON body before validation, a validator's raw input, pass-through
`**kwargs`), and annotate a callback whose result is ignored as `Callable[..., object]`.

**PY-42 — Accept abstract types and return concrete ones.** Parameters take `Iterable`,
`Sequence`, `Mapping`, or a `Protocol`, so callers can pass any fitting value; return
values are `list`, `dict`, or an entity, so callers get every method. When the return
type depends on an argument's value, write `@overload`s rather than returning a union
that makes every caller check with `isinstance`:

```python
def lengths(words: Iterable[str]) -> list[int]:
    return [len(word) for word in words]


@overload
def read_blob(path: Path, *, raw: Literal[True]) -> bytes: ...
@overload
def read_blob(path: Path, *, raw: Literal[False] = False) -> str: ...
def read_blob(path: Path, *, raw: bool = False) -> str | bytes:
    data = path.read_bytes()
    return data if raw else data.decode("utf-8")
```

**PY-43 — Write generics in the 3.12 syntax:** type parameters in brackets
(`def first[T](items: Sequence[T]) -> T`, `class Page[T]:`, bounded as
`[E: BaseEntityModel]`) and aliases with the `type` statement
(`type Coords = tuple[float, float]`). Do not declare a `TypeVar` or a `TypeAlias`: the
bracket syntax replaces the first, and the typing docs deprecate the second. A `type`
alias exists only for annotations, so never pass it to `isinstance()` or call it. Type
`**kwargs` whose keys are known as `Unpack[SomeTypedDict]`, and a decorator that keeps
its function's signature with a parameter specification:

```python
def logged[**P, R](fn: Callable[P, R]) -> Callable[P, R]:
    @functools.wraps(fn)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        logger.debug("Calling %s", fn.__qualname__)
        return fn(*args, **kwargs)

    return wrapper
```

**PY-44 — Mark every method that overrides a base-class method with `@override`**
(`from typing import override`). pyright's `reportImplicitOverride` (PY-9) fails an
unmarked override, so renaming a base method cannot silently orphan the methods that
overrode it. A closed set of values is a `Literal[...]` or a `StrEnum`, and a module
constant MAY be marked `Final` (`MAX_PROJECT_TASKS: Final = 200`).

**PY-45 — Narrow types instead of casting.** `cast()` is never checked at runtime, so a
wrong cast hides the bug it was meant to rule out. Narrow with `isinstance()`, a `match`
statement, or a function returning `TypeIs[X]` (prefer it to `TypeGuard`, which narrows
only on `True`). End a `match` over an enum or a union with `assert_never`, so a new
member without a case is a type error, and match members by their dotted name, since a
bare name captures the value instead of comparing it:

```python
def status_label(status: ProjectStatus) -> str:
    match status:
        case ProjectStatus.ACTIVE:
            return "Active"
        case ProjectStatus.ARCHIVED:
            return "Archived"
        case _:
            assert_never(status)
```

A `cast` that remains needs a comment saying why the checker cannot see the type (PY-37's
logger is the standing example).

**PY-46 — Annotations are not checked at runtime** (the typing docs say so plainly), so
data from outside the process is validated where it enters: request bodies, environment
variables, files, upstream responses, scraped pages. Validate with a Pydantic model
(pydantic.md) or `isinstance()` narrowing; an annotation such as `-> dict[str, Any]` on
a decoded body describes it but proves nothing.

---

## Files and resources

**PY-47 — Acquire every resource in a `with` block** (files, sessions, clients, locks).
In a `@contextmanager`, put the release in `try`/`finally` around the `yield`, because an
exception in the managed block is re-raised at the `yield`. Use `pathlib.Path` for new
path code, and pass `encoding="utf-8"` to every text-mode `open()`, `read_text()`, and
`write_text()`: until 3.15 the default encoding depends on the machine's locale
(PEP 686).

---

## Security

**PY-48 — Never hand external input to a shell or an evaluator.** Run commands with
`subprocess.run()` and an argument list, never `shell=True`, with `check=True`, a
`timeout`, and the executable resolved by `shutil.which()`. Never call `eval()` or
`exec()` on anything that came from outside the process.

**PY-49 — Use the standard library's safe options,** as listed in the docs' Security
Considerations index:

- `secrets`, never `random`, for tokens, passwords, and anything an attacker must not
  guess.
- Never unpickle (`pickle`, `shelve`) data from outside the process; it can run
  arbitrary code.
- Extract archives with `tarfile`'s `filter="data"`, stated explicitly even though it is
  the 3.14 default, and still inspect untrusted archives first.
- Create temporary files with `tempfile.mkstemp()`, `NamedTemporaryFile`, or
  `mkdtemp()`, never the deprecated `mktemp()`.

**PY-50 — CI SHOULD audit the locked dependencies for known vulnerabilities** with
`pip-audit` (maintained by the PyPA), alongside the checks in PY-8.

---

## Concurrency

**PY-51 — In `async def` code, use structured concurrency** (and use `async def` only
where fastapi.md FAPI-8 allows it):

- Run concurrent work in an `asyncio.TaskGroup` rather than `asyncio.gather`; a failure
  cancels the sibling tasks.
- Bound waits with `async with asyncio.timeout(...)`.
- Keep a reference to every task from `create_task()`; the event loop holds only weak
  references, so an unreferenced task can be garbage-collected mid-run.
- Never swallow `asyncio.CancelledError`; clean up, then re-raise it.
- Hand blocking calls to `asyncio.to_thread()`, as the cron jobs do (FAPI-19).
- Give async types their arguments: `asyncio.Task[ProjectEntity]`, `asyncio.Queue[str]`.
