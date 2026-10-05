# SQLAlchemy Standards

Applies to the declarative base, model classes, the engine and sessions, facades, and
every query the backend runs. General modeling and query rules are in
[../relational-databases.md](../relational-databases.md) and
[../postgresql.md](../postgresql.md); migrations are in [alembic.md](alembic.md); the
Pydantic entities facades return are in [pydantic.md](pydantic.md).

**Stack:** SQLAlchemy 2.1 (synchronous ORM, `sqlalchemy>=2.1.3,<2.2`), the psycopg 3
driver named in every URL (`postgresql+psycopg://`, `psycopg[binary]>=3.3`), PostgreSQL,
and GeoAlchemy2 for PostGIS columns. A bare `postgresql://` URL changed driver between
2.0 and 2.1, so the driver is always explicit. The evidence behind these rules is in
[SQLAlchemy and Alembic best practices](../../research/python/sqlalchemy-alembic-best-practices.md);
where sources disagree they follow SQLAlchemy's, PostgreSQL's, and Python's official
documentation.

---

## Style

**SQLA-1 — Write SQLAlchemy 2.x style only:** `select()` / `insert()` / `update()`
statements run through `session.execute()` or `session.scalars()`, and models declared
with `Mapped[...]` and `mapped_column()`. Do not use the legacy `session.query()` API,
untyped `Column()` (it types the attribute as `Column[T]`, not `T`), `backref`, or
`lazy="dynamic"` (use `WriteOnlyMapped` for a collection too large to load). pyright reads
SQLAlchemy's inline types directly; no mypy plugin or stub package is needed (the plugin
was removed in 2.1).

---

## Base class and models

**SQLA-2 — Every model inherits from `BaseDB` in `db/base_db.py`.** It provides:

- a UUID primary key that the database generates (PG-3):
  `id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=func.uuidv7())`.
  `Mapped[uuid.UUID]` maps to SQLAlchemy's `Uuid`, PostgreSQL's native `uuid`, and the
  ORM reads the generated value back with `INSERT ... RETURNING`. Factories and tests MAY
  still pass fixed or `uuid.uuid7()` IDs.
- a derived `__tablename__`: the class name in snake_case, with the `_db` suffix
  removed, pluralized (`ProjectDB` → `projects`, `PropertyDB` → `properties`)
- the shared metadata and naming convention (SQLA-3) and the type map (SQLA-5)

Override `__tablename__` only when the derived plural is wrong (`article_data`), and say
why in a comment.

**SQLA-3 — Give `BaseDB`'s `MetaData` the naming convention in the class body**, as
SQLAlchemy's docs show, so every constraint has its name before any table is defined (the
keyword is `naming_convention`, singular):

```python
NAMING_CONVENTION: Final[dict[str, str]] = {
    "ix": "ix_%(column_0_N_label)s",
    "uq": "%(table_name)s_%(column_0_N_name)s_key",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "%(table_name)s_%(column_0_N_name)s_fkey",
    "pk": "%(table_name)s_pkey",
}


class BaseDB(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
```

Name every `CheckConstraint` (`CheckConstraint("priority BETWEEN 1 AND 5",
name="priority_range")`): the `ck` template needs `%(constraint_name)s`.

Primary, unique, and foreign keys follow PostgreSQL's default names (RDB-10). Indexes use
the `ix_<table>_<columns>` form shown here; for Python backends this replaces the index
row of RDB-10. Name a GiST or other hand-declared index the same way (`ix_listings_location`).

**SQLA-4 — One model per file, at `models/<entity>/db.py`, named `<Entity>DB`.** Mixins
come before `BaseDB` in the bases only when they must override it; otherwise
`class ProjectDB(BaseDB, TimestampsDB):`.

**SQLA-5 — Declare every column as `name: Mapped[T]`, and let the annotation and
`BaseDB`'s type map decide the column.** The annotation sets nullability (`Mapped[str]` is
`NOT NULL`, `Mapped[str | None]` is nullable, a primary key is never null), and
`type_annotation_map` turns each Python type into its PostgreSQL type once, for every
model. Pass `mapped_column(...)` only for what the annotation cannot say: a foreign key,
an index, a server default, or a type with no Python equivalent. Never pass `nullable=`
to restate the annotation. Pass it only where the column must deliberately differ, with a
comment saying why, because pyright cannot see a `nullable=` that contradicts the
annotation.

```python
# db/base_db.py
def enum_values(enum_cls: type[enum.Enum]) -> list[str]:
    """Persist each member's value ("in_progress"), not its name."""
    return [str(member.value) for member in enum_cls]


class BaseDB(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)  # SQLA-3
    type_annotation_map = {
        datetime: postgresql.TIMESTAMP(timezone=True),
        dict[str, Any]: postgresql.JSONB,
        enum.Enum: Enum(enum.Enum, values_callable=enum_values),
        float: postgresql.DOUBLE_PRECISION,
        list[str]: postgresql.ARRAY(postgresql.TEXT),
        str: postgresql.TEXT,
    }
```

```python
# models/project/db.py
if TYPE_CHECKING:
    from models.task.db import TaskDB


class ProjectDB(BaseDB, TimestampsDB):
    archived_at: Mapped[datetime | None]
    budget: Mapped[Decimal | None] = mapped_column(postgresql.NUMERIC(12, 2))
    description: Mapped[str | None]
    name: Mapped[str]
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    status: Mapped[ProjectStatus] = mapped_column(
        PROJECT_STATUS_DB_TYPE, server_default=ProjectStatus.ACTIVE.value
    )
    tags: Mapped[list[str]] = mapped_column(server_default="{}")

    tasks: Mapped[list["TaskDB"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="raise",
        passive_deletes=True,
    )
```

Use these types:

| Data                      | Annotation       | Column (from the type map unless shown)                |
| ------------------------- | ---------------- | ------------------------------------------------------ |
| text of any length        | `str`            | `TEXT` (not `String(255)`)                             |
| whole numbers             | `int`            | `INTEGER`; `mapped_column(BIGINT)` past 2³¹            |
| measurements, coordinates | `float`          | `DOUBLE PRECISION`, never `REAL` (PG-2)                |
| money, exact decimals     | `Decimal`        | `mapped_column(postgresql.NUMERIC(p, s))`              |
| list of strings           | `list[str]`      | `TEXT[]`, with `server_default="{}"`                   |
| point in time             | `datetime`       | `TIMESTAMP(timezone=True)` (SQLA-7)                    |
| calendar date             | `date`           | `DATE`                                                 |
| true or false             | `bool`           | `BOOLEAN`, with a server default (PG-2)                |
| identifiers               | `uuid.UUID`      | native `uuid`                                          |
| document-shaped data      | `dict[str, Any]` | `JSONB` (RDB-4)                                        |
| a small fixed set         | the `StrEnum`    | its named type from `constants/db_types.py` (SQLA-11)  |

The ORM does not notice in-place changes to a `JSONB` or `ARRAY` value: reassign the
attribute, or declare the column `MutableDict.as_mutable(postgresql.JSONB)` when code
mutates it in place.

Defaults that the database applies are `server_default`s, so every insert path and Alembic
see them. A plain string is rendered as a quoted SQL literal (`server_default="active"`,
`server_default="{}"`), so never pre-quote it: `"'active'"` stores the quotes. Write an
expression as `func.now()` or `text(...)`. Python-side `default=` is not used for
columns.

**SQLA-6 — List columns alphabetically, then relationships, then `__table_args__`.**
`id`, `created_at`, and `updated_at` come from `BaseDB` and the mixin. Give a column an
attribute docstring when its type, nullability, or source is not obvious:

```python
baths: Mapped[float | None]
"""A float rather than an integer, because half-baths are common."""
```

**SQLA-7 — Timestamps come from the `TimestampsDB` mixin** in `models/mixins/db.py`, and
every timestamp column in every table is `TIMESTAMP(timezone=True)`:

```python
class TimestampsDB:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        onupdate=func.now(), server_default=func.now()
    )
```

A column mixin needs no `declared_attr` (SQLAlchemy 2.0+), and the type map makes both
columns `TIMESTAMP(timezone=True)`. On PostgreSQL the ORM loads server defaults back with
`INSERT ... RETURNING`, so `created_at` is readable right after `flush()`.

`onupdate` runs only for ORM and Core `update()` statements; an upsert MUST set
`updated_at` itself (SQLA-25). The engine pins the session time zone to UTC (SQLA-14).

**SQLA-8 — Every foreign key declares `ondelete` (RDB-15) and has an index (RDB-18)**
unless it leads a composite unique constraint or key: `ForeignKey("projects.id",
ondelete="CASCADE"), index=True`.

**SQLA-9 — Declare composite constraints and special indexes in `__table_args__` as a
tuple**, and let the naming convention name them:

```python
__table_args__ = (
    UniqueConstraint("project_id", "user_id"),
    Index("ix_sites_location", "location", postgresql_using="gist"),
)
```

Single-column uniqueness uses `unique=True` on the column. Natural keys (an external ID,
a source URL, a date) MUST have a unique constraint (RDB-13); upserts depend on it
(SQLA-25).

**SQLA-10 — Declare relationships with `Mapped[...]`, `back_populates` on both sides, and
`lazy="raise"`** (SQLA-5's `tasks`). An unloaded relationship then raises instead of
quietly running a query, so an N+1 or a hidden query during conversion to a Pydantic
entity fails its test; the facade method that needs the related rows eager-loads them
(SQLA-22). Quote a target class defined in another module and import it under
`if TYPE_CHECKING:` (`Mapped[list["TaskDB"]]`): SQLAlchemy resolves relationship targets by
class name in its registry, whereas every other type in a `Mapped[...]` annotation must be
imported at runtime (PY-14). For a collection the parent owns, pair
`cascade="all, delete-orphan"` and `passive_deletes=True` with `ondelete="CASCADE"` on the
foreign key, so the database deletes the children without the ORM loading them first. A
one-way relationship (no `back_populates`) gets a docstring saying why nothing needs the
reverse.

**SQLA-11 — Map a Python `StrEnum` to a PostgreSQL enum type once, in
`constants/db_types.py`,** storing the values rather than the member names (SQLAlchemy
stores names by default):

```python
PROJECT_STATUS_DB_TYPE: Final[Enum] = Enum(
    ProjectStatus,
    name="project_status",
    values_callable=enum_values,
    metadata=BaseDB.metadata,
)
```

Use `sqlalchemy.Enum`, which creates the same native type on PostgreSQL; the constructor
of `postgresql.ENUM` is unannotated and leaves the column's type unknown to pyright. Name
the type in singular snake_case (PG-5). The type map's `enum.Enum` entry (SQLA-5) stores
values for an enum column that forgets its named type, but names the type after the
lowercased class, so always pass the named type.

Use an enum type only for a small, stable set (PG-5); otherwise use `TEXT` with a check
constraint or a lookup table.

**SQLA-12 — Store geographic points as GeoAlchemy2
`Geography(geometry_type="POINT", srid=4326, spatial_index=False)`, typed
`Mapped[WKBElement]`, with a GiST index named in `__table_args__` (SQLA-9).** GeoAlchemy2
otherwise creates its own unnamed spatial index, which would duplicate the named one and
escape the naming convention. Keep plain
`latitude`/`longitude` columns beside it for cheap reads, and read the point back with
`func.ST_AsText(...)`. Pass `plugins=["geoalchemy2"]` to `create_engine`.

**SQLA-13 — A new model is imported in `db/migrations/env.py` and
`scripts/db/initialize.py`.** A model that is not imported is missing from the metadata,
so autogenerate drops or ignores its table. Rename or remove a model in both lists in the
same commit.

---

## Engine and sessions

**SQLA-14 — Only `DBSessionManager` (`db/db_session_manager.py`) creates the engine and
session factory.** It is a singleton (PY-28) that builds:

```python
create_engine(
    cls.build_psql_url(**kwargs),  # postgresql+psycopg://
    connect_args={
        "application_name": "app-backend",
        "options": (
            "-c timezone=utc -c statement_timeout=10s"
            " -c idle_in_transaction_session_timeout=30s"
        ),
    },
    echo=env_vars.log_sql,
    max_overflow=30,
    plugins=["geoalchemy2"],
    pool_pre_ping=True,
)
sessionmaker(autoflush=False, bind=self.engine, expire_on_commit=False)
```

- `pool_pre_ping=True` replaces connections the server has dropped, the approach
  SQLAlchemy's docs call the simplest and most reliable.
- The `options` set per-connection timeouts that match PG-14, rather than server-wide
  settings in `postgresql.conf`, which PostgreSQL's docs advise against.
- `expire_on_commit=False` is the Session FAQ's advice for web requests: objects stay
  readable after the route commits (FAPI-9).
- The singleton builds the engine on first use, never at import (PY-27), so each worker
  process opens its own connections. Code that must create the engine before forking
  calls `engine.dispose(close=False)` in the child.

It exposes `scoped_session` for scripts, cron jobs, and the test suite only, never for
request handling (fastapi.md FAPI-9): SQLAlchemy discourages the thread-local registry
where one request can run on more than one thread. Whoever calls `scoped_session()` calls
`scoped_session.remove()` in a `finally`. The URL is built
from `EnvVarManager().env_vars` by `DBSessionManager.build_psql_url()`, which Alembic
also uses. No other module calls `create_engine` or `sessionmaker`, and no application
module creates a session at import time.

**SQLA-15 — The owner of a unit of work commits it; facades and services never do:**

| Caller            | Gets its session from                                        | Commits                         |
| ----------------- | ------------------------------------------------------------ | ------------------------------- |
| a route           | the `DBSessionDep` dependency (fastapi.md FAPI-9)            | the route, before it returns    |
| a cron handler    | `DBSessionManager().scoped_session()`, removed in `finally`  | the handler, per unit of work   |
| a script          | `DBSessionManager().scoped_session()`                        | the script                      |
| a test            | the `test_db_session` fixture (pytest.md)                    | never (rolled back)             |

Facades and services MUST NOT call `commit()` or `rollback()` on a session they were
given; they call `flush()` when they need database-generated values.

---

## Facades

**SQLA-16 — Data access for an entity goes through `<Entity>Facade(BaseFacade)` in
`models/<entity>/facade.py`.** The constructor takes the session as a keyword argument
(`ProjectFacade(db_session=session)`); `BaseFacade` falls back to the scoped session only
for scripts. Facade methods follow these names:

| Method                                    | Returns                                  |
| ----------------------------------------- | ---------------------------------------- |
| `get_one_by_<key>(value, *, include_...)` | one entity, or raises `NotFoundError`    |
| `get_all()`                               | a list of entities, in a defined order   |
| `get_all_by_<key>(value, *, filters...)`  | a list, possibly empty                   |
| `get_latest_<...>(...)`                   | one entity or `None`, documented as such |
| `create_or_update(*, payload)`            | the written entity                       |
| `update(*, payload)`                      | the updated entity                       |

Private helpers (`_build_select_clause`, `_find_one_if_exists`,
`_strip_non_column_fields`) live on the facade.

**SQLA-17 — Each facade declares `class NotFoundError(Exception)` inside itself** and
raises it with the key that missed, chained from SQLAlchemy's `NoResultFound` (PY-22).
The name takes PEP 8's `Error` suffix (PY-15) rather than echoing SQLAlchemy's:

```python
try:
    project = self.db_session.execute(
        select(ProjectDB).where(ProjectDB.id == id)
    ).scalar_one()
except NoResultFound as exc:
    raise ProjectFacade.NotFoundError(
        f"Project record with ``id='{id}'`` not found"
    ) from exc
```

**SQLA-18 — Facades return Pydantic entities, never ORM objects:**
`ProjectEntity.model_validate(row)`. ORM instances do not leave `models/`.

---

## Queries

**SQLA-19 — Pick the result method by the shape you need:**

| Need                                       | Call                                       |
| ------------------------------------------ | ------------------------------------------ |
| exactly one ORM row                        | `.scalar_one()`                            |
| zero or one ORM row                        | `.scalar_one_or_none()`                    |
| many ORM rows                              | `.scalars().all()`                         |
| many ORM rows with a joined collection     | `.scalars().unique().all()`                |
| one ORM row by primary key                 | `session.get(Model, id)`; `get_one` raises |
| column tuples, typed                       | unpack: `for id_, name in session.execute(stmt)` |
| rows from an explicit column list          | `.mappings().one()` / `.mappings().all()`  |

`.all()` returns a `Sequence`, not a `list`. Unpacked rows are typed under pyright on 2.1;
do not use `Result.tuples()` or `Row._t`, which 2.1 deprecates. `.mappings()` values are
`Any`, so pass them straight to `model_validate` (SQLA-18, SQLA-23), which checks them.

**SQLA-20 — Push filtering, sorting, and limits into the query,** never into Python after
fetching. Every query that returns a list has an `ORDER BY` that ends in a unique column,
so `limit` selects a defined set (RDB-22):

```python
stmt = self._build_select_clause().where(ProjectDB.owner_id == owner_id)
if status is not None:
    stmt = stmt.where(ProjectDB.status == status)
stmt = stmt.order_by(ProjectDB.created_at.desc(), ProjectDB.id.asc())
if limit is not None:
    stmt = stmt.limit(limit)
```

**SQLA-21 — Map a caller-supplied sort key through an allowlist dict** and raise
`ValueError` for an unknown key; never pass a client string to `getattr` or `text`
unchecked. Put `nullslast()` on descending sorts over nullable columns. Reach "the latest
child row" through a `LATERAL ... LIMIT 1` subquery rather than a plain join, which would
repeat the parent once per child.

**SQLA-22 — Never load related rows in a loop (N+1, RDB-24).** Use
`.options(selectinload(ProjectDB.tasks))` for collections and `joinedload(...)` for a
many-to-one, as SQLAlchemy's loading guide advises, in the facade method that returns
them, behind a keyword flag (`include_tasks=False`). With `lazy="raise"` (SQLA-10), a
forgotten loader option fails loudly instead of running one query per row.

**SQLA-23 — Select an explicit column tuple when a column needs a SQL function to be
readable** (`func.ST_AsText(SiteDB.location).label("location")`). Keep the tuple as a
module constant (`_SITE_COLUMNS`) next to the facade and read results with
`.mappings()`.

**SQLA-24 — Write raw SQL only with `text()` and bound parameters:**
`session.execute(text("SELECT ... WHERE id = :id"), {"id": project_id})`. Never build SQL
with f-strings or `%` formatting, including in migrations and scripts. Write a cast as
`CAST(:value AS integer)`: in `:value::integer` the parameter is not recognised.

---

## Writes

**SQLA-25 — Write create-or-update as one PostgreSQL upsert on the natural key**, setting
`updated_at` explicitly and returning the row:

```python
stmt = (
    insert(SiteDB)
    .values(**payload)
    .on_conflict_do_update(
        index_elements=[SiteDB.external_id],
        set_={**payload, "updated_at": datetime.now(timezone.utc)},
    )
    .returning(SiteDB)
)
site = self.db_session.scalars(
    stmt, execution_options={"populate_existing": True}
).one()
return SiteEntity.model_validate(site)
```

`populate_existing` refreshes a row the session already holds; without it the identity
map hands back its stale copy.

Do not decide between insert and update by reading first (`_find_one_if_exists` then
`update`): two requests can both see "missing" and both insert (RDB-29). Use the
read-first form only when the natural key is not unique in the schema yet, and add the
constraint.

**SQLA-26 — Build insert and update values from known column names.** Strip fields that
are not columns (relationships, computed fields) before `.values(**payload)`, and never
spread a request body straight into a statement. Remove `polymorphic_source`-style
relationship keys in one helper, not at each call site.

**SQLA-27 — Isolate per-item failures with savepoints.** Inside a request, wrap each item
of a batch in `with db_session.begin_nested():` so one bad item rolls back alone without
losing the rest of the request's work. In a cron job or script that owns its session,
commit after each unit of work, and on failure `rollback()`, log, and continue.
`begin_nested()` flushes pending changes first, so an unrelated pending error surfaces at
the savepoint. When the only expected failure is a duplicate, one set-based
`on_conflict_do_nothing()` insert is cheaper than a savepoint per row.

---

## Testing

**SQLA-28 — Test models and facades against the real test database** (pytest.md
PYTEST-10). Each entity has `models/_tests/<entity>/test_db.py` (the mapping round-trips)
and `test_facade.py` (every public method, including its not-found case). Do not mock
`Session.execute`.
