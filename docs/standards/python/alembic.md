# Alembic Standards

Applies to `alembic.ini`, `db/migrations/env.py`, the revision template, and every
migration in `db/migrations/versions/`. General schema-change rules are in
[../relational-databases.md](../relational-databases.md) (RDB-31 to RDB-35); the models
autogenerate reads are in [sqlalchemy.md](sqlalchemy.md).

**Stack:** Alembic 1.20 (`alembic>=1.20,<1.21`) with autogenerate against
`BaseDB.metadata`, and GeoAlchemy2's Alembic helpers when the schema has PostGIS columns.
The evidence behind these rules is in
[SQLAlchemy and Alembic best practices](../../research/python/sqlalchemy-alembic-best-practices.md).

---

## Configuration

**ALEM-1 — `alembic.ini` sits at the backend root and sets:**

```ini
[alembic]
script_location = db/migrations
file_template = %%(year)d_%%(month).2d_%%(day).2d_%%(hour).2d%%(minute).2d-%%(rev)s_%%(slug)s
path_separator = os
timezone = UTC

[post_write_hooks]
hooks = ruff_fix, ruff_format
ruff_fix.type = module
ruff_fix.module = ruff
ruff_fix.options = check --fix REVISION_SCRIPT_FILENAME
ruff_format.type = module
ruff_format.module = ruff
ruff_format.options = format REVISION_SCRIPT_FILENAME
```

- The file template produces sortable names
  (`2026_08_21_1018-7d3ea6c4b915_add_owner_id_to_projects_table.py`), stamped in UTC.
- `path_separator` replaces `version_path_separator` (Alembic 1.16); without it Alembic
  keeps its legacy path splitting.
- The Ruff hooks fix and format each new revision (python.md PY-8), including removing the
  unused imports of an empty one.
- The file has no `sqlalchemy.url`: `env.py` builds its engine from the application's URL
  (ALEM-2), so no credentials or placeholders live here.

**ALEM-2 — `db/migrations/env.py` takes its URL and metadata from the application:**

```python
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata: MetaData = BaseDB.metadata


def run_migrations_online() -> None:
    """Migrate through a dedicated connection with a short lock wait."""
    engine = create_engine(DBSessionManager.build_psql_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        connection.execute(text("SET lock_timeout = '5s'"))
        connection.commit()  # a session-level SET outlives each migration's commit
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_server_default=True,
            transaction_per_migration=True,
            include_object=alembic_helpers.include_object,
            process_revision_directives=alembic_helpers.writer,
            render_item=alembic_helpers.render_item,
        )
        with context.begin_transaction():
            context.run_migrations()
```

- Import every model module (SQLA-13); a model that is not imported is invisible to
  autogenerate.
- Pass `disable_existing_loggers=False`: the test suite runs migrations from inside a
  process whose application loggers already exist, and the default would silence them.
- Build the engine from the URL; do not pass it through
  `config.set_main_option("sqlalchemy.url", ...)`, whose config parser treats `%` as
  interpolation, so a URL-encoded password breaks it.
- Connect with `poolclass=pool.NullPool` in online mode.
- Pass `compare_server_default=True` so autogenerate notices changed defaults (type
  comparison is on by default). On PostgreSQL it compares on the server and raised no
  false positives in testing.
- Pass `transaction_per_migration=True`, in offline mode too. Each revision then commits
  on its own, so an enum value one migration adds is usable in the next (ALEM-11), and a
  failure leaves the earlier revisions applied and recorded.
- `SET lock_timeout` makes a DDL statement fail after five seconds instead of queuing
  behind a long transaction while application queries queue behind it; rerun the step.
- With PostGIS, also pass GeoAlchemy2's `include_object`, `process_revision_directives`
  (`alembic_helpers.writer`), and `render_item`, in both offline and online mode, so
  spatial indexes are not generated twice.

**ALEM-3 — Keep the revision template (`script.py.mako`) typed and documented,** in the
same syntax as application code (PY-18): `X | None` unions, with `Sequence` imported from
`collections.abc`, in place of the `typing.Union` form Alembic's template generates:

```python
revision: str = ${repr(up_revision)}
down_revision: str | Sequence[str] | None = ${repr(down_revision)}
branch_labels: str | Sequence[str] | None = ${repr(branch_labels)}
depends_on: str | Sequence[str] | None = ${repr(depends_on)}


def upgrade() -> None:
    """Upgrade schema."""
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    """Downgrade schema."""
    ${downgrades if downgrades else "pass"}
```

---

## Creating a migration

**ALEM-4 — Change the model first, then generate the migration with autogenerate:**

```sh
uv run alembic revision --autogenerate -m "Add owner_id to projects table"
# or, inside the Compose network:
docker compose run --rm backend-migrations revision --autogenerate -m "..."
```

Commit the model change and the migration in the same commit (RDB-31).

**ALEM-5 — Write the message as a sentence-case summary of the change**, which becomes the
file slug and the docstring:

| Change                       | Message                                       |
| ---------------------------- | --------------------------------------------- |
| new table                    | `Create projects table`                       |
| new column(s)                | `Add owner_id to projects table`              |
| change to existing columns   | `Alter columns on tasks table`                |
| dropped column(s)            | `Remove legacy_code from projects table`      |
| constraint or index          | `Add index on tasks due_date column`          |
| behaviour of several columns | `Make timestamp columns timezone-aware`       |

One migration covers one logical change. Do not bundle unrelated tables.

**ALEM-6 — Read and edit every autogenerated migration before committing it.** Check for:

- unexpected `drop_table` / `drop_column` (a model that is not imported, or a rename that
  autogenerate saw as drop-and-add; rewrite a rename as `op.alter_column(...,
  new_column_name=...)`)
- constraint and index names wrapped in `op.f(...)`, which marks them as already
  following the naming convention (SQLA-3)
- enum types created before the tables that use them and dropped after (ALEM-11). An
  enum type that `create_table` creates implicitly is not dropped by the autogenerated
  `downgrade()`, and the next upgrade then fails with "type already exists"
- changes autogenerate cannot see, which you write by hand: renamed tables and columns,
  added or removed enum values, an edited `CHECK` expression, sequences, and constraints
  without names
- a type change on a column with data that needs `postgresql_using=` to cast
- a `NOT NULL` column added to a table with rows, which needs a `server_default` or a
  backfill step (ALEM-12)
- leftover `# ### commands auto generated by Alembic ###` comments, which you delete

**ALEM-7 — Comment the reasoning for any non-obvious decision in `upgrade()`** (why a
column is nullable, why a default exists, why an index is partial). The migration is
where a reviewer meets the schema change.

**ALEM-8 — Every migration implements `downgrade()` as the exact reverse of `upgrade()`,
in reverse order.** Downgrades are for undoing an unmerged migration in development and
for recovering a test database. In shared environments the schema only moves forward:
fix a merged migration with a new one (RDB-32, RDB-33).

**ALEM-9 — Migrations do not import application models, facades, or services.** A
migration is a snapshot: if it imports `ProjectDB` or a column type from the app, a later
change to that code silently changes or breaks an old migration. Write column types with
`sa.` and `postgresql.` types, and enum values as literal lists. Shared helpers that only
wrap `op` calls MAY live in `db/migrations/alembic_utilities.py`.

**ALEM-10 — Keep one head.** Before merging, rebase on `main` and run
`uv run alembic heads`. If there are two, regenerate your unmerged migration on top of the
new head (or edit its `down_revision` if it is otherwise unchanged); do not leave a
`merge` revision for a conflict that never reached a shared database. Squash churn on your
branch (add a column, drop it, re-add it) into one migration before merging.

---

## Enums and data

**ALEM-11 — Create and drop PostgreSQL enum types explicitly** with the helpers in
`alembic_utilities.py`, so the type exists before the table and is removed after it:

```python
PROJECT_STATUS_VALUES = ["active", "archived", "draft"]


def upgrade() -> None:
    project_status = create_pg_enum("project_status", PROJECT_STATUS_VALUES)
    op.add_column(
        "projects",
        sa.Column("status", project_status, nullable=False, server_default="draft"),
    )


def downgrade() -> None:
    op.drop_column("projects", "status")
    drop_pg_enum("project_status", PROJECT_STATUS_VALUES)
```

- Name types in singular snake_case (PG-5). Refer to an existing type as
  `PROJECT_STATUS: sa.Enum = postgresql.ENUM(name="project_status", create_type=False)`;
  the annotation gives pyright a known type, since `postgresql.ENUM`'s constructor is
  unannotated.
- To add a value, call a helper that runs
  `ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'paused'` inside
  `op.get_context().autocommit_block()`. PostgreSQL cannot use a new value until the
  transaction that added it commits; the block commits it, so a backfill after it can use
  the value. The block also commits everything before it in that migration, and
  `IF NOT EXISTS` makes a rerun safe if a later step fails. Alembic requires
  `transaction_per_migration=True` with it (ALEM-2).
- To remove or rename values, rename the old type to `<name>_old`, create the new type,
  then for each column drop its default, `ALTER COLUMN ... TYPE <name> USING
  <column>::text::<name>` (with a `CASE` mapping for renamed values), restore the default,
  and finally drop `<name>_old`. A default typed with the old enum cannot be cast, so the
  `ALTER` fails unless the default is dropped first.
- Do not add the third-party alembic-postgresql-enum: it automates the above, but its
  generated calls need type-checker suppressions (PY-10).

**ALEM-12 — Separate schema changes from data changes** (RDB-34, RDB-35). A data backfill
is its own migration using `op.execute(sa.text(...))` with bound parameters, or
`op.bulk_insert(sa.table(...), rows)` against a table literal declared in the migration.
Development sample data belongs in `scripts/db/seeding/`, never in a migration.

- A table literal types an enum column as the enum (ALEM-11's `sa.Enum` variable), never
  `sa.String`: psycopg 3 sends a string-typed value as `varchar`, and PostgreSQL refuses to
  compare it with the enum, although `alembic upgrade --sql` output looks correct.
- A backfill too large to run inside one deploy step is a script run outside the
  migration chain (Alembic's cookbook: migrations are designed for schema changes).

---

## Running migrations

**ALEM-13 — Apply migrations as a separate step, never at application startup.** Alembic
takes no lock on its version table, so exactly one process migrates a database at a
time:

| Database    | How                                                                  |
| ----------- | -------------------------------------------------------------------- |
| development | `./scripts/admin.sh db up-head` (the `backend-migrations` Compose service) |
| test        | `pytest_sessionstart` runs `command.upgrade(config, "head")` (PYTEST-10) |
| production  | `alembic upgrade head` from the release image before the new version starts |

A fresh database is built with `alembic upgrade head`, as the test suite does, so the
migrations themselves are what create the schema. An initialization script MAY use
`BaseDB.metadata.create_all()` for speed only if it immediately runs
`alembic stamp head`, and the test suite's `upgrade head` remains the check that the
migration chain produces the same schema.

**ALEM-14 — CI checks the migration chain against a real PostgreSQL database:**

- `uv run alembic check` against a migrated test database exits non-zero when
  autogenerate would produce a new migration. It shares autogenerate's blind spots
  (ALEM-6), so it does not replace review.
- A test asserts one head:
  `len(ScriptDirectory.from_config(config).get_heads()) == 1` (ALEM-10).
- A test runs `command.downgrade(config, "base")` then `command.upgrade(config, "head")`
  on the test database. The round trip catches a downgrade that leaves an enum type or
  another object behind (ALEM-8), which neither pyright nor `alembic check` can see.
