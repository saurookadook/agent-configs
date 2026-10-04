# Coding Standards

These standards define how code in this repository is written, organized, tested, and
shipped. They assume a TypeScript monorepo with a React frontend, a NestJS backend on
PostgreSQL with Drizzle, real-time messaging over WebSockets, and a framework-free
`shared` package used by both sides. The backend is moving from MongoDB to PostgreSQL;
some documents still describe MongoDB, and the database documents say which of their
rules they replace.

## Documents

| Document                                               | Covers                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| [typescript.md](typescript.md)                         | Types, naming, functions, classes, imports, comments             |
| [nodejs.md](nodejs.md)                                 | Runtime, pnpm, modules, env vars, async, crypto                  |
| [react.md](react.md)                                   | Components, state store, hooks, routing, client-side data access |
| [nestjs.md](nestjs.md)                                 | Modules, controllers, services, DTOs, guards, pipes, filters     |
| [relational-databases.md](relational-databases.md)     | Modeling, keys, constraints, indexes, queries, migrations        |
| [postgresql.md](postgresql.md)                         | Version, types, IDs, search, roles, connections, containers      |
| [drizzle.md](drizzle.md)                               | Tables, relations, queries, transactions, drizzle-kit, tests     |
| [mongoose.md](mongoose.md)                             | Being replaced by the three documents above                      |
| [websockets.md](websockets.md)                         | Event names, message shapes, gateway and client manager          |
| [css.md](css.md)                                       | CSS / SCSS: file layout, nesting, tokens, selectors              |
| [testing.md](testing.md)                               | Jest, Vitest, Testing Library, MSW, fixtures, custom matchers    |
| [logging-and-errors.md](logging-and-errors.md)         | Shared logger, log levels, error messages, error wrapping        |
| [formatting-and-linting.md](formatting-and-linting.md) | oxfmt, oxlint, suppression comments                              |
| [monorepo.md](monorepo.md)                             | pnpm workspace, the `shared` package, root scripts               |
| [docker-and-environment.md](docker-and-environment.md) | `.env` files, Compose, Dockerfiles, image security, CI, proxy    |
| [github-actions.md](github-actions.md)                 | Workflow layout, change detection, permissions, repo settings    |
| [ci-pipeline.md](ci-pipeline.md)                       | `ci.yml`, per-area checks, setup action, image publishing        |
| [git-workflow.md](git-workflow.md)                     | Branch names, commit messages, PR titles and template            |

## Conventions used in these documents

**Example domain.** Examples use one illustrative domain so they read consistently:
**users**, **projects**, and **tasks** (`User`, `Project`, `Task`, `ProjectStatus`,
`userID`, `projectID`). They are placeholders; apply the same patterns to the real
entities.

**Package scope.** Workspace packages are shown as `@app/frontend`, `@app/backend`, and
`@app/shared`. Replace `app` with the repository's actual scope.

## How to read a rule

Every rule has an ID so reviews can cite it (for example, "violates `NEST-7`").

- **MUST / MUST NOT** — required. A review should block on a violation.
- **SHOULD / SHOULD NOT** — the default. Deviate only with a stated reason (a code comment
  or PR note).
- **MAY** — permitted; use judgement.

When two documents seem to conflict, the more specific one wins (for example, `nestjs.md`
over `typescript.md` for a DTO class). Tooling configuration (oxfmt, oxlint, `tsconfig`)
is the final authority on anything it enforces automatically.

## Changing a standard

Standards describe how the code _should_ look, so update the document in the same PR that
deliberately changes a convention. If code and standard disagree and nobody chose that,
fix the code.
