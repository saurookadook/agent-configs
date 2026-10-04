# SQLAlchemy Standards

Applies to the declarative base, model classes, the engine and sessions, facades, and
every query the backend runs. General modeling and query rules are in
[../relational-databases.md](../relational-databases.md) and
[../postgresql.md](../postgresql.md); migrations are in [alembic.md](alembic.md); the
Pydantic entities facades return are in [pydantic.md](pydantic.md).

**Stack:** SQLAlchemy 2.0 (synchronous ORM), the `psycopg2` driver
(`postgresql+psycopg2://`), PostgreSQL, and GeoAlchemy2 for PostGIS columns.

---

## Style

**SQLA-1 — Write SQLAlchemy 2.0 style only:** `select()` / `insert()` / `update()`
statements run through `session.execute()`, and models declared with `Mapped[...]` and
`mapped_column()`. Do not use the legacy `session.query()` API or untyped `Column()` in new
models.

---

## Base class and models

**SQLA-2 — Every model inherits from `BaseDB` in `db/base_db.py`.** It provides:

- a UUID primary key: `id: Mapped[UUID] = mapped_column(postgresql.UUID(as_uuid=True), primary_key=True, default=uuid4)`
- a derived `__tablename__`: the class name in snake_case, with the `_db` suffix
  removed, pluralized (`ProjectDB` → `projects`, `PropertyDB` → `properties`)
- the shared metadata and naming convention (SQLA-3)

Override `__tablename__` only when the derived plural is wrong (`article_data`), and say
why in a comment.

**SQLA-3 — Set the metadata naming convention on `BaseDB.metadata.naming_convention`**
(singular; the attribute `naming_conventions` is silently ignored):

```python
BaseDB.metadata.naming_convention = {
    "ix": "ix_%(column_0_N_label)s",
    "uq": "%(table_name)s_%(column_0_N_name)s_key",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "%(table_name)s_%(column_0_N_name)s_fkey",
    "pk": "%(table_name)s_pkey",
}
```

Primary, unique, and foreign keys follow PostgreSQL's default names (RDB-10). Indexes use
the `ix_<table>_<columns>` form shown here; for Python backends this replaces the index
row of RDB-10. Name a GiST or other hand-declared index the same way (`ix_listings_location`).

**SQLA-4 — One model per file, at `models/<entity>/db.py`, named `<Entity>DB`.** Mixins
come before `BaseDB` in the bases only when they must override it; otherwise
`class ProjectDB(BaseDB, TimestampsDB):`.

**SQLA-5 — Declare every column with `Mapped[...]`, `mapped_column(...)`, a PostgreSQL
dialect type, and an explicit `nullable=`.** The annotation and `nullable` MUST agree:
`Mapped[Optional[str]]` with `nullable=True`, `Mapped[str]` with `nullable=False`.

```python
class ProjectDB(BaseDB, TimestampsDB):
    archived_at: Mapped[Optional[datetime]] = mapped_column(
        postgresql.TIMESTAMP(timezone=True), nullable=True
    )
    description: Mapped[Optional[str]] = mapped_column(postgresql.TEXT, nullable=True)
    name: Mapped[str] = mapped_column(postgresql.TEXT, nullable=False)
    owner_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(
        postgresql.TEXT, nullable=False, server_default="'active'"
    )
    tags: Mapped[list[str]] = mapped_column(
        postgresql.ARRAY(postgresql.TEXT), nullable=False, server_default="{}"
    )

    tasks: Mapped[list[TaskDB]] = relationship(back_populates="project")
```

Use these types:

| Data                     | Type                                                  |
| ------------------------ | ----------------------------------------------------- |
| text of any length       | `postgresql.TEXT` (not `String(255)`)                 |
| whole numbers            | `postgresql.INTEGER`; `postgresql.BIGINT` for external IDs |
| measurements, rates      | `postgresql.REAL`; `DOUBLE_PRECISION` for coordinates |
| money                    | `postgresql.NUMERIC`                                  |
| list of strings          | `postgresql.ARRAY(postgresql.TEXT)` with `server_default="{}"` |
| point in time            | `postgresql.TIMESTAMP(timezone=True)` (SQLA-7)        |
| calendar date            | `postgresql.DATE`                                     |
| identifiers              | `postgresql.UUID(as_uuid=True)`                       |
| document-shaped data     | `postgresql.JSONB` (RDB-4)                            |

Defaults that the database applies are `server_default` SQL strings (`"'active'"`,
`"{}"`, `func.now()`); Python-side `default=` is only for the primary key.

**SQLA-6 — List columns alphabetically, then relationships, then `__table_args__`.**
`id`, `created_at`, and `updated_at` come from `BaseDB` and the mixin. Give a column an
attribute docstring when its type, nullability, or source is not obvious:

```python
baths: Mapped[Optional[float]] = mapped_column(postgresql.REAL, nullable=True)
"""``REAL`` rather than ``INTEGER`` because half-baths are common."""
```

**SQLA-7 — Timestamps come from the `TimestampsDB` mixin** in `models/mixins/db.py`, and
every timestamp column in every table is `TIMESTAMP(timezone=True)`:

```python
class TimestampsDB:
    created_at = Column(
        postgresql.TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        postgresql.TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
```

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

**SQLA-10 — Declare relationships with `Mapped[...]` and `back_populates` on both sides.**
Leave them lazy; eager-load in the facade method that needs the related rows (SQLA-22).
A one-way relationship (no `back_populates`) gets a docstring saying why nothing needs the
reverse.

**SQLA-11 — Map a Python `Enum` to a PostgreSQL enum type once, in
`constants/db_types.py`,** storing the values rather than the member names:

```python
ProjectStatusEnumDB = postgresql.ENUM(
    ProjectStatusEnum,
    values_callable=lambda e: [member.value for member in e],
    name=ProjectStatusEnum.db_type_name(),
    metadata=BaseDB.metadata,
)
```

Use an enum type only for a small, stable set (PG-5); otherwise use `TEXT` with a check
constraint or a lookup table.

**SQLA-12 — Store geographic points as GeoAlchemy2
`Geography(geometry_type="POINT", srid=4326)` with a GiST index,** keep plain
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
    cls.build_psql_url(**kwargs),
    connect_args={"options": "-c timezone=utc"},
    echo=env_vars.log_sql,
    max_overflow=30,
    plugins=["geoalchemy2"],
)
sessionmaker(autoflush=False, bind=self.engine)
```

and exposes `scoped_session` for scripts, cron jobs, and the test suite. The URL is built
from `EnvVarManager().env_vars` by `DBSessionManager.build_psql_url()`, which Alembic
also uses. No other module calls `create_engine` or `sessionmaker`, and no application
module creates a session at import time.

**SQLA-15 — Whoever opens a session commits or rolls it back; nothing else does:**

| Caller            | Gets its session from                                        | Commits                         |
| ----------------- | ------------------------------------------------------------ | ------------------------------- |
| a route           | the `API_DB_SessionDependency` dependency (fastapi.md FAPI-9) | the dependency, after the route |
| a cron handler    | `DBSessionManager().scoped_session()`                        | the handler, per unit of work   |
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
| `get_one_by_<key>(value, *, include_...)` | one entity, or raises `NoResultFound`    |
| `get_all()`                               | a list of entities, in a defined order   |
| `get_all_by_<key>(value, *, filters...)`  | a list, possibly empty                   |
| `get_latest_<...>(...)`                   | one entity or `None`, documented as such |
| `create_or_update(*, payload)`            | the written entity                       |
| `update(*, payload)`                      | the updated entity                       |

Private helpers (`_build_select_clause`, `_find_one_if_exists`,
`_strip_non_column_fields`) live on the facade.

**SQLA-17 — Each facade declares `class NoResultFound(Exception)` inside itself** and
raises it with the key that missed:

```python
try:
    project = self.db_session.execute(
        select(ProjectDB).where(ProjectDB.id == id)
    ).scalar_one()
except NoResultFound:
    raise ProjectFacade.NoResultFound(f"Project record with ``id='{id}'`` not found")
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
| rows from an explicit column list          | `.mappings().one()` / `.mappings().all()`  |

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
`.options(selectinload(ProjectDB.tasks))` for collections, in the facade method that
returns them, behind a keyword flag (`include_tasks=False`).

**SQLA-23 — Select an explicit column tuple when a column needs a SQL function to be
readable** (`func.ST_AsText(SiteDB.location).label("location")`). Keep the tuple as a
module constant (`_SITE_COLUMNS`) next to the facade and read results with
`.mappings()`.

**SQLA-24 — Write raw SQL only with `text()` and bound parameters:**
`session.execute(text("SELECT ... WHERE id = :id"), {"id": project_id})`. Never build SQL
with f-strings or `%` formatting, including in migrations and scripts.

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
site = self.db_session.execute(stmt).scalar_one()
self.db_session.flush()
return SiteEntity.model_validate(site)
```

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

---

## Testing

**SQLA-28 — Test models and facades against the real test database** (pytest.md
PYTEST-10). Each entity has `models/_tests/<entity>/test_db.py` (the mapping round-trips)
and `test_facade.py` (every public method, including its not-found case). Do not mock
`Session.execute`.
