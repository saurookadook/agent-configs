# PostgreSQL Standards

Applies to PostgreSQL-specific choices: the server version, column types, identifiers,
search, extensions, roles, connections, containers, and operations. General modeling and
query rules are in [relational-databases.md](relational-databases.md); the Drizzle code
that declares tables and runs queries is in [drizzle.md](drizzle.md).

**Stack:** PostgreSQL 18 (the official `postgres` image in development, tests, and CI; a
managed PostgreSQL 18 service in production), the `pg_trgm` extension, and the `pg`
(node-postgres) driver underneath Drizzle.

**Database.** The backend is moving from MongoDB to PostgreSQL.
[docker-and-environment.md](docker-and-environment.md) still describes the `mongo`
service; until it is updated, PG-16 to PG-19 replace ENV-10, the `mongo` example in
ENV-11, ENV-13, and the MongoDB parts of ENV-35.

---

## Version

**PG-1 — Run the same PostgreSQL major version everywhere: 18.** Development, tests, CI,
and production MUST match, and the image is pinned to an exact version
(`postgres:18.6-trixie`, ENV-24). Moving to a new major is a deliberate change made in
every environment at once, following PG-23.

> Why: these standards rely on features new in 18 (`uuidv7()`, PG-3) and on its changed
> defaults (virtual generated columns, PG-8). A managed database created on 17 would fail
> the first migration.

---

## Data types

**PG-2 — Use these column types:**

| Data                                | Use                                                          | Avoid                               |
| ----------------------------------- | ------------------------------------------------------------ | ----------------------------------- |
| primary key                         | `uuid DEFAULT uuidv7()` (PG-3)                               | `serial`, application-made IDs      |
| text of any length                  | `text`, with a `CHECK` on `char_length` when a limit matters | `varchar(n)`, `char(n)`             |
| whole numbers                       | `integer`; `bigint` if it can pass 2³¹                       | `smallint` to save space            |
| exact decimals (money, scores)      | `numeric(p, s)`                                              | `real`, `double precision`, `money` |
| measurements where rounding is fine | `double precision`                                           | `numeric` (slower, no benefit)      |
| a point in time                     | `timestamptz` (PG-4)                                         | `timestamp` without time zone       |
| a calendar date                     | `date`                                                       | `timestamptz` at midnight           |
| true or false                       | `boolean NOT NULL` with a default                            | nullable booleans                   |
| a small fixed set                   | an enum type (PG-5)                                          | magic strings with no constraint    |
| document-shaped data (RDB-4)        | `jsonb`                                                      | `json`                              |

**PG-3 — Primary keys are `uuid` columns with `DEFAULT uuidv7()`.** The database generates
the value, so every insert path gets one. UUIDv7 values sort by creation time, so new rows
land at the end of the primary-key index instead of at random positions as with UUIDv4,
and they stay valid for `ParseUUIDPipe` and the shared `isUUID`. Tests MAY insert fixed
UUIDs (TEST-20).

A UUIDv7 encodes the time it was created. If an entity's creation time must not be exposed
through its ID, use `DEFAULT uuidv4()` for that table instead.

**PG-4 — Store points in time as `timestamptz` with precision 3, and default them to
`now()`.** PostgreSQL stores `timestamptz` in UTC and keeps microseconds by default;
JavaScript `Date` has milliseconds, so precision 3 makes values round-trip exactly and
keeps test comparisons stable. Keep the server and session time zone at `UTC`.

**PG-5 — Use an enum type only for a small, stable set** that mirrors a string enum in
`shared` (`project_status` for `ProjectStatus`). Name enum types in singular `snake_case`.
Adding a value is a simple migration, but it cannot be used in the same transaction that
adds it ([drizzle.md](drizzle.md) DRIZZLE-30). Renaming or removing a value means creating
a new type and converting the column. If a set changes often, use a lookup table instead
(RDB-6).

**PG-6 — Enforce case-insensitive uniqueness with a unique index on an expression:**
`CREATE UNIQUE INDEX users_lower_email_idx ON users (lower(email))`, and compare with
`lower(email) = lower($1)` so queries use it. Store the value as the user typed it.

**PG-7 — If a table genuinely needs an integer key, use `GENERATED ALWAYS AS IDENTITY`,
never `serial`.** Identity columns are standard SQL, have their sequence owned by the
column, and reject accidental manual values.

---

## Generated columns

**PG-8 — Declare generated columns as `STORED`, explicitly.** Since PostgreSQL 18, a
generated column without a keyword is `VIRTUAL`: computed on every read, and unable to use
user-defined functions. A column you index, such as a search vector, MUST be `STORED`.
Drizzle writes `STORED` into the migration; check for it when reviewing (DRIZZLE-27).

---

## Search

**PG-9 — Full-text search uses a stored, generated `tsvector` column with a GIN index.**
Build the vector from the searchable columns with `setweight` (`A` for titles and names,
`B` for longer text), and wrap nullable columns in `coalesce(column, '')`. Use the
`english` configuration for prose, which stems words (`running` → `run`), and the `simple`
configuration for names, codes, and model numbers, which must match exactly as written
(`RX-78-2` must not be split or stemmed).

```sql
search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(code, '')), 'A') ||
  setweight(to_tsvector('english', title), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B')
) STORED
```

**PG-10 — Turn user input into a query with `websearch_to_tsquery`**, never `to_tsquery`.
`websearch_to_tsquery` accepts free text, quoted phrases, `or`, and `-word`, and never
fails on bad syntax; `to_tsquery` throws on input such as `zaku (`. Sort matches with
`ts_rank(search_vector, query)`, then by a unique column (RDB-22).

**PG-11 — Use `pg_trgm` for typo-tolerant and partial matching of short text** such as
names. Index the column with `gin_trgm_ops`, and filter with `%` (similarity above
`pg_trgm.similarity_threshold`, 0.3 by default), `<%` (word similarity, for a term that
matches part of a longer name), or `ILIKE '%term%'`, all of which the GIN index serves.
Sort by `similarity(name, $1) DESC`. A GIN index cannot speed up ordering by the `<->`
distance operator; add a GiST (`gist_trgm_ops`) index only if a query needs that. Combine
with full-text search by `OR`-ing the two conditions and ordering by the greater of
`ts_rank` and `similarity`.

**PG-12 — Create extensions in migrations**, with
`CREATE EXTENSION IF NOT EXISTS pg_trgm;` in a custom migration ([drizzle.md](drizzle.md)
DRIZZLE-28), so every environment, including a managed database, gets them. Use only
extensions available on the production provider. `pg_trgm`, `unaccent`, and
`fuzzystrmatch` are widely available; `unaccent()` is not `IMMUTABLE`, so using it in a
generated column or index requires an immutable wrapper function, created in the same
migration. Do not add AGPL-licensed extensions.

---

## Roles and privileges

**PG-13 — The backend connects as a role that can only read and write rows.** Use two
login roles: an owner role (`app_owner`) that owns the database and every object in it and
runs migrations, and an application role (`app`, the `DB_USER` of ENV-3) with only
`SELECT`, `INSERT`, `UPDATE`, and `DELETE`. Grant these through default privileges, so
tables created by later migrations are covered automatically. MUST in production, SHOULD
in development; the `postgres` superuser is for administration only.

```sql
-- run once as a superuser: by an init script locally (PG-19),
-- and in the provider's console in production
CREATE ROLE app_owner LOGIN PASSWORD '<owner password>';
CREATE ROLE app LOGIN PASSWORD '<app password>';
-- since PostgreSQL 15, the database owner also owns the `public` schema
ALTER DATABASE app OWNER TO app_owner;
GRANT USAGE ON SCHEMA public TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app;
```

Passwords come from secret files, as in ENV-13. The test database also grants `TRUNCATE`
on tables to `app`, so the test reset helper can run (DRIZZLE-33).

---

## Connections

**PG-14 — Each backend process opens one connection pool**, created by `DrizzleModule` and
shared with the session store ([drizzle.md](drizzle.md) DRIZZLE-15). Configure it
explicitly:

| `pg` pool option                      | Value                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `max`                                 | 10 by default; all instances together stay well below the server's connection limit |
| `application_name`                    | `app-backend` (`app-backend-test` under test), so connections are identifiable      |
| `statement_timeout`                   | 10 seconds; a slow query fails instead of piling up                                 |
| `idle_in_transaction_session_timeout` | 30 seconds; a stuck transaction releases its locks                                  |
| `connectionTimeoutMillis`             | 5 seconds                                                                           |
| `ssl`                                 | required for any database outside the Compose network                               |

**PG-15 — Know which connection string goes through a pooler.** Managed providers offer a
direct connection and a transaction-mode pooler (PgBouncer, Supavisor). A long-running
NestJS server MAY use either, but over a transaction-mode pooler it MUST NOT rely on
session state (`SET`, `LISTEN`, temporary tables, session advisory locks). Migrations,
`pg_dump`, and `pg_restore` MUST use the direct connection.

---

## Containers

**PG-16 — The Compose service is named `postgres`, pinned to an exact image, with its data
in a named volume mounted at `/var/lib/postgresql`.** From PostgreSQL 18, the image keeps
its data in a version-specific folder under that path; mounting the old
`/var/lib/postgresql/data` path makes the container fail to start or silently lose data.
The healthcheck runs `pg_isready` (CI-10), and dependents wait for it (ENV-11).

```yaml
postgres:
  image: postgres:18.6-trixie
  environment:
    POSTGRES_USER: postgres
    POSTGRES_DB: ${DB_NAME}
    POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
  secrets: [postgres_password, db_owner_password, db_app_password]
  volumes:
    - postgres-data:/var/lib/postgresql
    - ./.docker/postgres/initdb:/docker-entrypoint-initdb.d:ro
  shm_size: 128mb
  healthcheck:
    test: [CMD-SHELL, 'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"']
    interval: 2s
    timeout: 5s
    retries: 15
backend:
  depends_on:
    postgres: { condition: service_healthy, restart: true }
```

**PG-17 — The test database keeps its data in memory and MAY trade durability for speed.**
In the test Compose project (ENV-4), mount a `tmpfs` at `/var/lib/postgresql` instead of
the volume, and MAY start the server with `-c fsync=off`, `-c synchronous_commit=off`, and
`-c full_page_writes=off`. These settings MUST NOT be used in any database whose data
matters.

**PG-18 — The database publishes no host port** (ENV-12). To use a local GUI, publish
`127.0.0.1:5432:5432` only while you use it.

**PG-19 — Init scripts in `/docker-entrypoint-initdb.d` only bootstrap a local server:**
they create the roles and grants of PG-13 (and, for the test server, the extra `TRUNCATE`
grant). They run only when the data folder is empty, so anything every environment needs,
including extensions, belongs in a migration (PG-12).

---

## Operations

**PG-20 — Run `ANALYZE` after loading or deleting a lot of data** (the `seed_db` command,
a large backfill), so the planner has current statistics. Leave autovacuum on with its
defaults.

**PG-21 — Check the plan of every new query on a large table, and of every search query,
with `EXPLAIN (ANALYZE, BUFFERS)`.** Look for sequential scans of large tables and for row
estimates that are far from the actual counts. Production MAY enable `pg_stat_statements`
to find slow queries.

**PG-22 — Production data is backed up, and a restore has been tested.** Use the managed
provider's automated backups with point-in-time recovery, or, for a self-hosted server, a
scheduled `pg_dump --format=custom` to off-host storage. A self-hosted database is never
publicly reachable; a managed one requires TLS and strong, unique passwords.

**PG-23 — Treat a major-version upgrade as a migration of its own.** Upgrade a copy first,
run `ANALYZE` afterwards, and rebuild full-text and trigram indexes (`REINDEX INDEX ...`)
if the collation provider changed. PostgreSQL 18 changed which collation provider
full-text search and `pg_trgm` use.
