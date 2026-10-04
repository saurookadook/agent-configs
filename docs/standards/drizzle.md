# Drizzle Standards

Applies to table definitions, relations, queries, transactions, migrations, and database
tests in `backend`. Modeling rules are in
[relational-databases.md](relational-databases.md), PostgreSQL rules in
[postgresql.md](postgresql.md), and Nest module wiring in [nestjs.md](nestjs.md).

**Stack:** `drizzle-orm` and `drizzle-kit` 1.x, `@nestjs/drizzle`, the `pg`
(node-postgres) driver, and `connect-pg-simple` for sessions.

**Database.** The backend is moving from MongoDB to PostgreSQL. This document replaces
[mongoose.md](mongoose.md). Until [nestjs.md](nestjs.md) and [testing.md](testing.md) are
updated, the rules here also replace the Mongoose-specific parts of NEST-4 (the
`MongooseModule.forFeature` import), NEST-6, NEST-13 (`ParseObjectIdPipe`), NEST-16
(`document.toJSON()`), NEST-20 (the MongoDB session store), TEST-8 (`deleteMany({})`),
TEST-9 (model and connection tokens), and TEST-12.

---

## Versions

**DRIZZLE-1 — Pin `drizzle-orm` and `drizzle-kit` to the same exact version** (no `^` or
`~`), and upgrade them together in one PR after reading the release notes. Version 1 is
published under the `rc` tag until its stable release; do not install `0.x`, whose
relations API and migration folder format differ. Both packages ship CommonJS and ESM
builds, so they load in the Nest CLI's CommonJS output.

---

## Files

**DRIZZLE-2 — Lay out database code like this:**

```txt
backend/
  drizzle.config.ts                drizzle-kit configuration (DRIZZLE-25)
  drizzle/                         generated migrations, committed
    20261004153000_create_projects/
      migration.sql
      snapshot.json
  src/
    database/
      database.module.ts           DrizzleModule registration (DRIZZLE-14)
      database.types.ts            Database, Transaction, Executor
      schema.ts                    barrel: every table and enum
      relations.ts                 defineRelations() for the whole schema
      columns.ts                   shared column helpers (DRIZZLE-5)
      custom-types.ts              customType() definitions (tsvector)
    projects/
      schemas/
        project.schema.ts          the `projects` table and its row types
        project-member.schema.ts   the `project_members` junction table
      projects.service.ts
```

Table files keep the `.schema.ts` suffix and the `schemas/` folder of NEST-1.
`database/schema.ts` MUST re-export every table and enum: `drizzle-kit` reads only that
file, so a table or enum missing from it gets no migration.

---

## Tables

**DRIZZLE-3 — Define each table with `pgTable` in
`<feature>/schemas/<entity>.schema.ts`**, one table per file, and export the table plus
its row types. The table constant is the camelCase form of the table name (`projects`,
`projectMembers`).

```ts
export const projects = pgTable(
  'projects',
  {
    id: primaryID(),
    ownerID: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    status: projectStatus('status').notNull().default(ProjectStatus.ACTIVE),
    ...timestamps,
  },
  (t) => [index('projects_owner_id_idx').on(t.ownerID)],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type NullableProject = Project | null;
```

**DRIZZLE-4 — Every column passes its SQL name explicitly, in `snake_case`:**
`uuid('owner_id')`. Object keys are camelCase with TS-4 casing (`ownerID`, `createdAt`).
Do not use Drizzle's automatic casing (`snakeCase.table`).

> Why: with explicit names, renaming a TypeScript key never renames a database column, and
> every SQL name in a migration, an error message, or a raw `sql` fragment can be found by
> searching the schema.

**DRIZZLE-5 — Build the primary key and timestamps from the helpers in
`database/columns.ts`** (PG-3, PG-4, RDB-17):

```ts
export const primaryID = () => uuid('id').primaryKey().default(sql`uuidv7()`);

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
```

`$onUpdate` runs in the application, only for updates made through Drizzle's query
builder. An update written in raw SQL (a custom migration, a `sql` statement) MUST set
`updated_at` itself.

**DRIZZLE-6 — Create enum types from the shared string enums:**
`export const projectStatus = pgEnum('project_status', ProjectStatus);`. The values then
cannot drift from the enum the frontend and DTOs use. PG-5 covers changing an enum.

**DRIZZLE-7 — Every reference declares its `onDelete` behaviour (RDB-15), and every
foreign-key column gets an index unless it leads the primary key (RDB-18).** A junction
table uses a composite primary key (RDB-2):

```ts
export const projectMembers = pgTable(
  'project_members',
  {
    projectID: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userID: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectMemberRole('role').notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    primaryKey({ name: 'project_members_pkey', columns: [t.projectID, t.userID] }),
    index('project_members_user_id_idx').on(t.userID),
  ],
);
```

**DRIZZLE-8 — Name every index, unique constraint, check constraint, and composite key
explicitly**, following RDB-10:

```ts
(t) => [
  uniqueIndex('users_lower_email_idx').on(sql`lower(${t.email})`),
  check('tasks_parent_task_id_check', sql`${t.parentTaskID} <> ${t.id}`),
];
```

**DRIZZLE-9 — Give every `jsonb` column a type with `.$type<T>()`**
(`jsonb('preferences').$type<UserPreferences>()`). The type is compile-time only, so the
value MUST be validated (by a DTO) before it is written.

**DRIZZLE-10 — Declare search columns with a custom `tsvector` type and a generated
expression** (PG-8, PG-9), and index them in the table's extra config:

```ts
// database/custom-types.ts
export const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

// tasks/schemas/task.schema.ts
export const tasks = pgTable(
  'tasks',
  {
    // ...
    searchVector: tsvector('search_vector')
      .notNull()
      .generatedAlwaysAs(
        (): SQL => sql`setweight(to_tsvector('english', ${tasks.title}), 'A')
          || setweight(to_tsvector('english', coalesce(${tasks.description}, '')), 'B')`,
      ),
  },
  (t) => [
    index('tasks_search_vector_idx').using('gin', t.searchVector),
    index('tasks_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
  ],
);
```

The `(): SQL =>` return type is required: without it, TypeScript cannot infer the type of
a table whose definition refers to itself. The `pg_trgm` extension must already exist
(DRIZZLE-28).

**DRIZZLE-11 — Table definitions and row types never leave `backend`.** `shared` and
`frontend` MUST NOT import `drizzle-orm` (MONO-5). Domain types that both sides need are
written by hand in `shared`, and DTOs stay the API boundary (NEST-22 to NEST-24); do not
replace them with schemas generated from tables (`drizzle-orm/zod`).

---

## Relations and the database type

**DRIZZLE-12 — Declare relations for the whole schema once, in `database/relations.ts`,
with `defineRelations`.** Model many-to-many relations through the junction table with
`.through()`. Relations only shape relational queries; foreign keys come from
`.references()` (DRIZZLE-7).

```ts
export const relations = defineRelations(schema, (r) => ({
  projects: {
    owner: r.one.users({ from: r.projects.ownerID, to: r.users.id }),
    members: r.many.users({
      from: r.projects.id.through(r.projectMembers.projectID),
      to: r.users.id.through(r.projectMembers.userID),
    }),
    tasks: r.many.tasks(),
  },
  // ...
}));
```

If the file grows too large, split it with `defineRelationsPart`, and spread the main
relations first when combining them.

**DRIZZLE-13 — Inject the database as the `Database` type from
`database/database.types.ts`**, never as a bare `NodePgDatabase`, which loses the typing
of `db.query`:

```ts
export type Database = NodePgDatabase<typeof relations>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;
```

```ts
constructor(@InjectDrizzle() private readonly db: Database) {}
```

---

## Module wiring

**DRIZZLE-14 — Register the database once, in `DatabaseModule`, with
`DrizzleModule.forRootAsync`**, reading settings through `ConfigService` (NEST-8, NEST-9).
`buildPoolConfig(configService)` in `config/` returns the `pg` pool options of PG-14; it
replaces `buildConnectionURI`.

```ts
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        drizzle,
        connection: buildPoolConfig(configService),
        relations,
      }),
    }),
  ],
})
export class DatabaseModule {}
```

Only `AppModule` (and test modules) import `DatabaseModule`. The database is injectable
everywhere without further imports, so there is no per-feature registration step. Keep
`autoCloseConnection` at its default (`true`), so closing the app closes the pool
(ENV-33).

**DRIZZLE-15 — Sessions are stored by `connect-pg-simple` on the same pool, in a table
that the Drizzle schema declares.** Pass `pool: this.db.$client`,
`tableName: 'user_sessions'`, and `createTableIfMissing: false`. The table matches the
library's `table.sql`, so it is exempt from the type and naming rules of
[postgresql.md](postgresql.md):

```ts
export const userSessions = pgTable(
  'user_sessions',
  {
    sid: varchar('sid').primaryKey(),
    sess: json('sess').notNull(),
    expire: timestamp('expire', { precision: 6 }).notNull(),
  },
  (t) => [index('user_sessions_expire_idx').on(t.expire)],
);
```

Declaring it here means migrations create it and the application role never needs DDL
rights (PG-13). Call the store's `close()` on shutdown to stop its pruning timer, and set
`pruneSessionInterval: false` under test so the timer does not keep Jest running.

**DRIZZLE-16 — Only the feature that owns a table writes to it.** Inserts, updates, and
deletes go through the owning feature's service. Other features MAY import the table to
reference it, relate it, or join it in a read. This replaces NEST-6.

---

## Queries

**DRIZZLE-17 — Pick the query API by the shape of the result:**

| Need                                              | API                                                            |
| ------------------------------------------------- | -------------------------------------------------------------- |
| an entity with nested related rows                | relational queries: `db.query.projects.findFirst({ with })`    |
| writes, aggregates, search, joins shaped like SQL | the query builder: `db.select()`, `insert`, `update`, `delete` |
| an expression Drizzle has no operator for         | a `sql` template fragment inside a builder query               |

`sql` template values are always sent as parameters. Never pass input to `sql.raw()`, and
map input that names a column through an allowlist (RDB-25).

**DRIZZLE-18 — `findOne*` methods return `null` when nothing matches.** Drizzle returns
`undefined` from `findFirst` and from destructuring an empty result, so convert it
(NEST-27):

```ts
async findOneById(projectID: ProjectID): Promise<NullableProject> {
  const project = await this.db.query.projects.findFirst({ where: { id: projectID } });
  return project ?? null;
}
```

**DRIZZLE-19 — Never select credential columns by default** (this replaces MONGO-11).
Export a column map without them from the table's file, and use it in every query outside
the authentication path:

```ts
const { passwordHash: _passwordHash, ...userColumns } = getColumns(users);
export { userColumns };

await this.db.select(userColumns).from(users).where(eq(users.id, userID));
await this.db.query.users.findFirst({
  columns: { passwordHash: false },
  where: { id: userID },
});
```

**DRIZZLE-20 — Writes return the written rows with `.returning()`** instead of reading
them again (this replaces MONGO-12). Build the `.set()` or `.values()` object from named
DTO fields; never spread a DTO into it. `.set()` skips `undefined` values, so optional
fields the client left out stay unchanged; pass `null` to clear a column.

```ts
async updateOne(
  projectID: ProjectID,
  project: UpdateProjectDTO,
): Promise<NullableProject> {
  const [updatedProject] = await this.db
    .update(projects)
    .set({ name: project.name, status: project.status })
    .where(eq(projects.id, projectID))
    .returning();
  return updatedProject ?? null;
}
```

**DRIZZLE-21 — Write find-or-create and other idempotent inserts as upserts** with
`.onConflictDoNothing()` or `.onConflictDoUpdate({ target, set })` (RDB-26).

**DRIZZLE-22 — Services return rows; controllers convert them to DTOs** with
`plainToInstance(ProjectDTO, project)`. Rows are plain objects, so there is no `toJSON()`
step (this replaces the document conversion in NEST-16).

---

## Transactions

**DRIZZLE-23 — Run a transaction with `this.db.transaction(async (tx) => { ... })`, and
send every query inside it through `tx`.** A query sent through `this.db` runs on another
pool connection, outside the transaction. A service method that a caller may need to run
inside its own transaction takes an `Executor` as its last parameter, defaulting to the
injected database:

```ts
async createOne(task: CreateTaskDTO, executor: Executor = this.db): Promise<Task> {
  const [createdTask] = await executor.insert(tasks).values({ ... }).returning();
  return createdTask;
}
```

If passing executors becomes common across many services, propose the `nestjs-cls`
transactional plugin with its Drizzle adapter as a change to this standard rather than
adopting it in one feature.

---

## Errors

**DRIZZLE-24 — Map expected constraint violations to HTTP exceptions, and keep query
parameters out of error messages.** A failed query throws a `DrizzleQueryError` whose
message contains the SQL **and every parameter value**, which can include password hashes
and email addresses (LOG-6). The driver's `DatabaseError` is its `cause`, with the
PostgreSQL error `code` and the `constraint` name. Keep the helpers in
`utils/database-errors.ts`:

| `code`  | Meaning               | Usual response                               |
| ------- | --------------------- | -------------------------------------------- |
| `23505` | unique violation      | `ConflictException`                          |
| `23503` | foreign-key violation | `NotFoundException` or `BadRequestException` |
| `23514` | check violation       | `BadRequestException`                        |

```ts
export function getDriverError(error: unknown): unknown {
  return error instanceof DrizzleQueryError && error.cause ? error.cause : error;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const driverError = getDriverError(error);
  return (
    driverError instanceof DatabaseError &&
    driverError.code === '23505' &&
    (constraint === undefined || driverError.constraint === constraint)
  );
}
```

When wrapping an unexpected error (NEST-31), build the message from
`getDriverError(error)` and pass that as the `cause`, never the `DrizzleQueryError`
itself.

---

## Migrations

**DRIZZLE-25 — `backend/drizzle.config.ts` points `drizzle-kit` at the schema barrel and
connects as the owner role** (PG-13):

```ts
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  dbCredentials: { url: buildMigrationURL(process.env) },
});
```

`buildMigrationURL(env)` lives in `src/config/` and builds the URL from `DB_HOST`,
`DB_PORT`, `DB_NAME`, `DB_OWNER_USER`, and `DB_OWNER_PASSWORD`, adding
`sslmode=verify-full` outside the Compose network. It is the one other place that reads
`process.env` (an exception to NODE-8), because `drizzle-kit` and migration commands run
outside Nest. Add the owner variables to the env templates (ENV-1).

**DRIZZLE-26 — Change the schema, then generate a migration, in that order:**

1. Edit the table files.
2. Run `pnpm backend:base db:generate --name <what_changed>` (`add_project_members`),
   which runs `drizzle-kit generate`. It needs no database.
3. Review the migration (DRIZZLE-27).
4. Apply it with `db:migrate` (`drizzle-kit migrate`). It runs inside the Compose network,
   since only containers can reach `postgres` (PG-18).
5. Commit the schema change and the new migration folder in the same commit.

The backend defines the `db:generate`, `db:migrate`, and `db:check` scripts; the root MAY
alias the ones run often (MONO-11).

**DRIZZLE-27 — Read every generated `migration.sql` before committing it.** Answer
`generate`'s rename prompts deliberately: choosing "create" for a renamed column drops the
old column and its data. Look for unexpected `DROP` statements, check that generated
columns say `STORED` (PG-8), and check enum changes (DRIZZLE-30). Never edit a generated
migration's SQL: `snapshot.json` records what was generated, so hand edits make the next
diff wrong. Put extra SQL in a custom migration instead.

**DRIZZLE-28 — Use a custom migration
(`pnpm backend:base db:generate --custom --name <what>`) for anything the schema cannot
express:** extensions, functions, triggers, grants, data backfills, and reference rows
(RDB-35). Use `IF NOT EXISTS` where the statement supports it. Create a custom migration
before the schema change that depends on it; for example, generate the
`CREATE EXTENSION IF NOT EXISTS pg_trgm;` migration before adding a `gin_trgm_ops` index.

**DRIZZLE-29 — Never edit, rename, or delete a migration folder once it is merged**
(RDB-32). There are no down migrations; fix a mistake with a new migration. Before merging
a branch with migrations, merge or rebase the latest `main` and run `db:check`, which
detects migrations from different branches that conflict. If yours conflict, delete your
unmerged migration folders and generate them again on top of `main`.

**DRIZZLE-30 — The migrator applies all pending migrations in one transaction.** So:

- Do not use `.concurrently()` on indexes; `CREATE INDEX CONCURRENTLY` cannot run in a
  transaction.
- A new enum value cannot be used by a later migration in the same run. Ship the migration
  that uses it in a later deploy.
- If any migration fails, the whole run rolls back, and nothing is applied.

**DRIZZLE-31 — `drizzle-kit push` MUST NOT be run against any database that receives
migrations** (development, test, CI, production). It changes the schema without recording
a migration. It MAY be used on a throwaway scratch database while prototyping; afterwards,
delete that database and generate a real migration.

**DRIZZLE-32 — Migrations run as their own step, never during application startup:**

| Environment | How                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| development | `db:migrate` inside the Compose network                                                                                                                                                     |
| tests       | Jest `globalSetup` calls `migrate()` from `drizzle-orm/node-postgres/migrator` once                                                                                                         |
| CI          | the test job migrates as above; a check job runs `db:check` and fails if `db:generate` creates files (the schema and migrations have drifted)                                               |
| production  | a `migrate_db` nest-commander command (NEST-33) that calls `migrate()` as the owner role over a direct connection (PG-15), run once from the production image before the new version starts |

The production image therefore includes `backend/drizzle/`.

> Why: the migrator takes no lock, so several app instances migrating at startup can race.
> A separate step also lets a failed migration stop the release before new code runs.

---

## Testing

**DRIZZLE-33 — Database tests run against the real test database (TEST-9, TEST-13) and
reset it between tests.** Migrations run once in `globalSetup` (DRIZZLE-32). Resolve the
database with `module.get<Database>(getDrizzleToken())`, which replaces the model and
connection tokens of MONGO-16 and TEST-9. Reset state in `beforeEach` with a helper in
`utils/testing/` that truncates every table in `public` in one statement:

```ts
export async function truncateAllTables(db: Database): Promise<void> {
  const { rows } = await db.$client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (rows.length === 0) {
    return;
  }
  const tableList = rows.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
  await db.$client.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}
```

The table names come from the system catalog, not from input. The migrations table lives
in the `drizzle` schema, so it survives the reset. Do not mock Drizzle's chained query
builder in service tests; test against the database instead.

Rows are plain objects with no `_id` or `__v`, so compare them with `toEqual`, using
`expect.toBeUUID()` for generated IDs (TEST-19) and `expect.any(Date)` for timestamps the
database sets; fake timers do not reach the database clock. This replaces the Mongoose
comparison helpers of TEST-12.
