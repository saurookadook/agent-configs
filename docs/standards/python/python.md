# Python Standards

Applies to every Python module in a backend: application code, scripts, migrations, and
tests. Library-specific rules are in the other documents in this folder.

**Stack:** CPython 3.12, [uv](https://docs.astral.sh/uv/) for environments and
dependencies, hatchling as the build backend, black (formatter), flake8 (linter), and
Pylance/Pyright in `standard` mode for editor type checking.

---

## Version and dependencies

**PY-1 — Target Python 3.12.** Pin it in three places that MUST agree:
`.python-version` (`3.12`), `requires-python = ">=3.12"` in `pyproject.toml`, and the base
image and `actions/setup-python` version. Upgrade all three in one PR.

**PY-2 — Manage the environment with uv.** Runtime dependencies go in
`[project] dependencies`; tools and test libraries go in `[dependency-groups] dev`. Use
`uv add <pkg>` / `uv add --dev <pkg>` rather than editing versions by hand, and commit
`uv.lock` with the change.

```toml
[project]
requires-python = ">=3.12"
dependencies = [
    "alembic>=1.18.4",
    "fastapi>=0.136.1",
    "pydantic>=2.13.4",
    "sqlalchemy>=2.0.49",
]

[dependency-groups]
dev = [
    "black>=26.3.1",
    "factory-boy>=3.3.3",
    "flake8>=7.3.0",
    "pytest>=9.0.3",
    "pytest-mock>=3.15.1",
    "requests-mock>=1.12.1",
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
  alembic.ini  pytest.ini  pytest.ci.ini  gunicorn_config.py
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

## Formatting and linting

**PY-8 — black formats every Python file with its defaults** (line length 88). Do not
hand-format code black will rewrite. Check with `uv run black --check .`.

**PY-9 — flake8 runs with `--max-line-length=120` and ignores `F401` only in
`__init__.py`.** Keep this in a committed `.flake8` file rather than only in editor
settings, and exclude `.venv`:

```ini
[flake8]
max-line-length = 120
per-file-ignores = __init__.py: F401
extend-exclude = .venv,.pytest_cache
```

**PY-10 — Suppress a warning on the line, with the code and a reason:**
`import api.crons.job_registry  # noqa: F401 - registers cron decorators`. Never use a
bare `# noqa` or a file-wide suppression in application code. `# type: ignore[...]` names
its error code too.

---

## Imports

**PY-11 — Every module starts with `from __future__ import annotations`**, after the
module docstring and before any other import.

**PY-12 — Group imports as standard library, third party, then first party,** separated
by one blank line and sorted alphabetically within each group (`import x` lines before
`from x import y` lines of the same group).

```python
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional
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
say which in a comment. Type-only imports go under `if TYPE_CHECKING:`.

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
| module-private name           | leading underscore               | `_send()`, `_DOM_SELECTORS`            |
| exception                     | describes the failure            | `FetchError`, `UnsupportedSource`      |

**PY-16 — Name a value after what it holds, including its unit or currency** when it has
one: `distance_km`, `purchase_price_cop`, `REQUEST_TIMEOUT` (seconds, stated in a
comment), `ttm_revenue`. Do not shadow built-ins other than `id`, which facades accept as
a keyword argument by convention.

**PY-17 — Order a module as: docstring, imports, constants, public classes and functions,
then private helpers.** Private helpers (`_parse_dom`, `_drop_empty`) go at the bottom,
after the public functions that call them.

---

## Functions and types

**PY-18 — Annotate every function's parameters and return type**, except `self`, `cls`,
and pytest fixtures and tests. Use built-in generics (`list[str]`, `dict[str, Any]`,
`tuple[float, float, int]`), `Optional[X]` for a value that may be `None`, and `A | B` for
a value that may be one of several real types (`id: UUID | str`). Import `Callable`,
`Iterable`, and `Generator` from `collections.abc` or `typing`, and `Self` from `typing`.

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
class and a docstring on every class saying when it is raised:

```python
class ScrapeError(Exception):
    """Base for any failure while sourcing a record from an external page."""


class FetchError(ScrapeError):
    """Raised when a page could not be retrieved."""


class UnsupportedSource(ScrapeError):
    """Raised when no parser is registered for a URL's host."""
```

Keep unrelated failures in separate hierarchies so callers can map them differently (a
route turns `ScrapeError` into a 4xx and an upstream API error into a 502).

**PY-21 — Facades raise their own nested `NoResultFound`**, with a message naming the key
that missed (sqlalchemy.md SQLA-17). Do not let SQLAlchemy's exception escape a facade.

**PY-22 — Wrap and re-raise with `from exc`,** and include what failed in the message
(`f"AirROI request to '{url}' failed: {exc}"`). Never re-raise a bare `Exception`, never
use a bare `except:`, and never swallow an error without logging it.

**PY-23 — Catch the most specific exception first, and comment when the order matters**
because of an inheritance you would not guess:

```python
# ``JSONDecodeError`` subclasses ``RequestException``, so it has to be caught
# first or a malformed body is reported as a transport failure.
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

**PY-26 — Read environment variables only in `config/env_vars.py`**, in one Pydantic
model whose fields have typed defaults (pydantic.md PYD-15). Everything else reads
`EnvVarManager().env_vars`. No other module calls `os.getenv` or `os.environ[...]`,
except `gunicorn_config.py`, which gunicorn loads on its own, and test setup.

**PY-27 — Read configuration when it is used, not at import time,** for values that may
change between import and use (an API key, a database name the test suite overrides):

```python
def _headers() -> dict[str, str]:
    # Read per call so tests and scripts see the current EnvVarManager value.
    return {"x-api-key": EnvVarManager().env_vars.airroi_api_key}
```

**PY-28 — Process-wide managers (`EnvVarManager`, `DBSessionManager`) use
`SingletonMeta`** from `utils/singleton_meta.py`, which is thread-safe. Do not add other
singletons without a reason in the class docstring.

---

## Docstrings and comments

**PY-29 — Docstrings explain why, not what.** Write them for every module in `services/`,
every public class and function whose behaviour is not obvious from its name, and every
route. Use triple double quotes, a one-line summary, then the reasoning: what the
alternative was and why it was rejected, what upstream quirk the code works around.
Refer to identifiers with double backticks (``` ``source_url`` ```).

**PY-30 — Use Google-style sections when they add information:** `Args:`, `Returns:`,
`Yields:`, `Raises:`. Omit a section that would only repeat the signature.

```python
def get_all_by_owner_id(
    self, owner_id: UUID | str, *, status: Optional[str] = None, limit: Optional[int] = None
) -> list[ProjectEntity]:
    """
    An owner's projects, newest first.

    Every filter is pushed into the query; filtering in Python after fetching
    would make ``limit`` describe the page rather than the owner's projects.

    Raises:
        ValueError: for an unrecognised ``status``.
    """
```

**PY-31 — Document a non-obvious constant or column with an attribute docstring**
directly below it:

```python
MATCH_RADIUS_KM = 50.0
"""
How far a project site may sit from a region's centroid and still belong to it.
Wider than any one region's footprint, narrower than the gap between regions.
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

**PY-36 — Scripts are runnable modules:** an `if __name__ == "__main__":` block that calls
one function, arguments parsed with `argparse`, and logging configured once at the top
(PY-38). Scripts own their session and commit (sqlalchemy.md SQLA-15).

---

## Logging

**PY-37 — Create one logger per module, at module scope, named after the module:**
`logger = logging.getLogger(__name__)`. When the module uses `ExtendedLogger` helpers
(`log_centered`, `log_pretty`), cast it:
`logger = cast(ExtendedLogger, logging.getLogger(__name__))`. Do not name loggers after
`__file__`.

**PY-38 — Configure logging once per process,** in the entry point (`api/app/main.py`, a
script's top, a spider's settings) with `init_logging(app_name=...)` from
`utils/logging/init.py`. It installs `RichHandler` outside production and a plain
`StreamHandler` in production, and sets the level from `LOG_LEVEL`. Library modules never
call `basicConfig` or add handlers.

**PY-39 — Use the level for its audience:** `debug` for state while developing, `info`
for lifecycle and progress of a job, `warning` for a recoverable surprise (a missing
optional block, a fallback taken), `error` for a failure, with the exception attached
(`logger.exception(...)` inside `except`, or `exc_info=True`).

**PY-40 — Write log messages as f-strings that quote values and name the key:**
`f"Could not fetch exchange rate for date='{target_date}': {exc}"`. Never log secrets,
tokens, API keys, or full request headers, and do not commit `print()` or
`rich.inspect()` calls in application code.
