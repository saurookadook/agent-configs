# Relational Database Standards

Applies to how the backend models, constrains, queries, and changes relational data,
whatever the engine or library. PostgreSQL-specific rules are in
[postgresql.md](postgresql.md), and the Drizzle code that implements these rules is in
[drizzle.md](drizzle.md).

**Database.** The backend is moving from MongoDB to PostgreSQL. These rules replace the
modeling and query rules in [mongoose.md](mongoose.md); the table below maps the most
common MongoDB habits to their relational equivalents.

| MongoDB habit                         | Relational equivalent                                                 |
| ------------------------------------- | --------------------------------------------------------------------- |
| embedded subdocument                  | a child table with a foreign key (RDB-1)                              |
| array of `ObjectId` references        | a junction table (RDB-2)                                              |
| `.populate()`                         | a join or a relational query (RDB-24)                                 |
| `_id` plus a separate public `userID` | one `id` column, also used publicly (RDB-12)                          |
| validation in the schema only         | `NOT NULL`, `UNIQUE`, `FOREIGN KEY`, and `CHECK` constraints (RDB-14) |
| `@Schema({ timestamps: true })`       | `created_at` and `updated_at` columns (RDB-17)                        |
| TTL index                             | an `expires_at` column and a scheduled delete                         |
| changing a schema class               | a versioned migration (RDB-31)                                        |

---

## Modeling

**RDB-1 — Store each fact in one place.** Model one entity per table and normalize to
third normal form: a column depends on its table's key and nothing else. Data that belongs
to another entity (a task's project name, a member's username) is read through a join, not
copied. Denormalize only to fix a measured read problem, say why in the PR, and keep the
copy derived by the database (a generated column, view, or materialized view) rather than
written by application code.

**RDB-2 — Model many-to-many relationships with a junction table**, named after both sides
(`project_members`), with a composite primary key of the two foreign keys. Attributes of
the relationship itself (`role`, `created_at`) are columns on the junction table. Never
store a list of foreign keys in an array or JSON column; the database cannot enforce or
index it as a reference.

**RDB-3 — One value per column.** Do not pack several values into one column (`'a,b,c'`,
`first_name + ' ' + last_name`). An array column MAY hold simple values that have no
identity of their own and are never joined on (alternate spellings of a name, for
example).

**RDB-4 — Use JSON columns only for document-shaped data that is read and written as a
whole** (a third-party payload, a user's UI preferences). Anything you filter, sort, join,
or constrain on is a real column.

**RDB-5 — Never build a generic key-value table** (`entity_id`, `attribute`, `value`). Add
columns, or add a table for the new entity.

**RDB-6 — Choose between an enum type and a lookup table by how the set changes.** A small
set that is fixed at compile time and has no attributes of its own (`ProjectStatus`) is an
enum ([postgresql.md](postgresql.md) PG-5). A set that grows without a code change, or
whose members have their own attributes (a name, a sort order, a description), is a lookup
table referenced by foreign key.

**RDB-7 — Model hierarchies with a self-referencing foreign key** (`tasks.parent_task_id`
→ `tasks.id`). Make the column nullable for root rows, and add a `CHECK` that a row is not
its own parent.

---

## Naming

**RDB-8 — Identifiers are `snake_case`. Tables are plural nouns (`users`,
`project_members`); columns are singular.** Never use a quoted or mixed-case identifier,
and never use an SQL reserved word as a name (`user`, `order`, `group`).

**RDB-9 — Columns follow these name patterns:**

| Kind          | Pattern                                  | Example                     |
| ------------- | ---------------------------------------- | --------------------------- |
| primary key   | `id`                                     | `id`                        |
| foreign key   | `<referenced entity>_id`, or `<role>_id` | `project_id`, `owner_id`    |
| boolean       | `is_<adjective>`, `has_<noun>`           | `is_archived`, `has_avatar` |
| point in time | `<verb>_at`                              | `created_at`, `expires_at`  |
| calendar date | `<noun>_date`                            | `due_date`                  |
| count         | `<noun>_count`                           | `member_count`              |

The application maps these to camelCase with the casing rules of
[typescript.md](typescript.md) TS-4 (`owner_id` → `ownerID`).

**RDB-10 — Name every constraint and index with PostgreSQL's default pattern**, so names
are predictable in error messages and migrations:

| Object            | Pattern                   | Example                      |
| ----------------- | ------------------------- | ---------------------------- |
| primary key       | `<table>_pkey`            | `projects_pkey`              |
| unique constraint | `<table>_<columns>_key`   | `users_email_key`            |
| foreign key       | `<table>_<columns>_fkey`  | `tasks_project_id_fkey`      |
| check constraint  | `<table>_<columns>_check` | `tasks_parent_task_id_check` |
| index             | `<table>_<columns>_idx`   | `tasks_project_id_idx`       |
| expression index  | `<table>_<purpose>_idx`   | `users_lower_email_idx`      |

---

## Keys

**RDB-11 — Every table has a primary key.** An entity table has a single surrogate key
named `id`. A junction table's key is its foreign-key pair (RDB-2).

**RDB-12 — A row has one identifier, and the application uses it everywhere:** in foreign
keys, URLs, DTOs, and events. Its type is set in [postgresql.md](postgresql.md) PG-3. This
replaces the separate `_id` and public `userID` of MONGO-7. A table MAY also have a
unique, human-readable `slug` for URLs; a slug is a lookup key and is never the target of
a foreign key.

**RDB-13 — Natural keys are unique constraints, not primary keys.** An email address, a
slug, or a code that should not repeat gets a `UNIQUE` constraint. Surrogate keys are
never derived from business data and never reused.

---

## Constraints

**RDB-14 — The database enforces every invariant it can.** Columns are `NOT NULL` unless
"unknown" or "not applicable" is a real state. Every natural key is `UNIQUE`, every
reference is a `FOREIGN KEY`, and simple value rules (ranges, non-empty strings) are
`CHECK` constraints. DTO validation exists to give the user a helpful message; constraints
exist so that data stays correct when two requests race or a script bypasses the API.

> Why: two sign-up requests with the same email can both pass a "does this email exist?"
> check in the service. Only a unique constraint stops the second insert.

**RDB-15 — Every foreign key states its `ON DELETE` behaviour, even when it is the
default:**

| Relationship                                   | `ON DELETE` | Example                                    |
| ---------------------------------------------- | ----------- | ------------------------------------------ |
| the child cannot exist without the parent      | `CASCADE`   | a project's tasks; junction rows           |
| the parent must not disappear while referenced | `RESTRICT`  | a project's owner                          |
| the link is optional                           | `SET NULL`  | a task's assignee (the column is nullable) |

**RDB-16 — Delete rows for real by default.** Add soft deletes (`deleted_at`) only when a
feature needs undo or an audit trail. A soft-deleted table then needs partial unique
indexes (`WHERE deleted_at IS NULL`) and a filter on every query, so it is a design
decision for the PR, not a default.

**RDB-17 — Every entity table has `created_at` and `updated_at`**, both `NOT NULL` and
defaulting to the current time. A junction table has `created_at` only.

---

## Indexes

**RDB-18 — Index every foreign-key column** unless it is the leading column of the primary
key or of a unique constraint. PostgreSQL does not index foreign keys automatically, and
without the index, joins and `ON DELETE` checks scan the whole child table.

**RDB-19 — Add other indexes for real query patterns, not speculatively.** Index the
columns a frequent query filters, joins, or sorts on. In a multi-column index, put the
columns compared with `=` first and the range or sort column last. Check the plan with
`EXPLAIN` ([postgresql.md](postgresql.md) PG-21). Every index slows writes and takes
space.

**RDB-20 — A unique constraint already creates an index.** Do not add a second index on
the same columns.

---

## Queries

**RDB-21 — Select only the columns the caller needs, and never select credential columns
outside the authentication path** (this replaces MONGO-11). Never send a row straight to
the client; services return rows and controllers convert them to DTOs
([nestjs.md](nestjs.md) NEST-16).

**RDB-22 — Every read that returns many rows has an `ORDER BY` that ends in a unique
column** (`ORDER BY updated_at DESC, id DESC`). Without `ORDER BY`, row order is
undefined, and without the unique tiebreaker, pages can repeat or skip rows. This replaces
MONGO-13.

**RDB-23 — Every list endpoint is paginated with a capped page size.** Use
`LIMIT`/`OFFSET` for short, bounded lists that show page numbers. Use keyset pagination
(`WHERE (updated_at, id) < ($1, $2)`) for long or frequently changing lists, where deep
offsets get slow and rows shift between pages.

**RDB-24 — Never query inside a loop over rows (the N+1 problem).** Load related rows in
the same query (a join or a relational query), or in one batched query
(`WHERE project_id = ANY($1)`).

**RDB-25 — Pass every value as a query parameter.** Never build SQL by concatenating or
interpolating input. Identifiers that come from input (a `sortBy` query parameter) are
looked up in an allowlist map of permitted columns; an unknown value is a
`BadRequestException`.

**RDB-26 — Write in sets, not row by row.** Insert many rows with one multi-row `INSERT`,
and change many rows with one `UPDATE ... WHERE`. Use an upsert (`INSERT ... ON CONFLICT`)
for find-or-create and other idempotent writes instead of a read followed by a write.

---

## Transactions and concurrency

**RDB-27 — Wrap writes that must succeed or fail together in one transaction.** A single
statement is already atomic and needs no explicit transaction.

**RDB-28 — Keep transactions short.** Do the reads and validation that do not need
isolation first, then open the transaction. Never make network calls (HTTP, email,
WebSocket broadcasts) or wait on anything slow inside one; send notifications after it
commits.

**RDB-29 — Do not rely on read-then-write checks for correctness.** Use a constraint
(RDB-14), an atomic update (`SET member_count = member_count + 1`), or a row lock
(`SELECT ... FOR UPDATE`). Treat a constraint violation as an expected outcome and map it
to an HTTP error ([drizzle.md](drizzle.md) DRIZZLE-24).

**RDB-30 — Use the default `READ COMMITTED` isolation level.** Use `SERIALIZABLE` only for
logic that needs it, and only together with retry handling for serialization failures.

---

## Schema changes

**RDB-31 — Every schema change is a versioned migration, committed in the same PR as the
code that needs it.** Nobody runs DDL by hand against a shared database (test, CI,
production).

**RDB-32 — Never edit, rename, or delete a migration once it has been merged.** Other
databases have already applied it. Fix a mistake with a new migration.

**RDB-33 — Migrations only move forward.** To undo a change, write a new migration that
reverses it. Take a backup ([postgresql.md](postgresql.md) PG-22) before a migration that
drops or rewrites data in production.

**RDB-34 — Make breaking schema changes in steps (expand, migrate, contract).** To rename
or retype a column: add the new column, backfill it, switch the code to it, and drop the
old column in a later release. Never drop or rename a column that the currently deployed
code still reads. A deploy that stops the app before migrating MAY combine the steps.

**RDB-35 — Separate the kinds of data changes:**

| Data                                                  | Where it lives                              |
| ----------------------------------------------------- | ------------------------------------------- |
| rows the app needs in every environment (lookup rows) | a migration                                 |
| a one-off fix or backfill of existing data            | a migration, or an ad hoc command (NEST-33) |
| sample data for development                           | the `seed_db` command, never a migration    |
