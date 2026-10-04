# Node.js Standards

Applies to the runtime, the package manager, tooling, and backend code (`backend`,
`shared`, scripts, and config files). NestJS specifics live in [nestjs.md](nestjs.md);
environment files and containers in [docker-and-environment.md](docker-and-environment.md).

**Source of truth:** `.nvmrc`, root `package.json` (`engines`, `packageManager`),
`pnpm-workspace.yaml`, Dockerfiles.

---

## Runtime and package manager

**NODE-1 — Use the active Node.js LTS line.** Pin it in `.nvmrc` by codename
(`lts/krypton` for Node 24) and set a matching `engines.node` in `package.json`
(`">=24"`). Docker base images use the same major (`node:24-bookworm`). Upgrade all
three together.

**NODE-2 — Use pnpm through Corepack.** Pin the exact version in `packageManager`
(`"packageManager": "pnpm@<version>"`). Contributors run `corepack enable` once, and
Corepack then provides that pnpm version automatically. Corepack ships with Node 24; on
later Node lines that no longer bundle it, install it once per machine with
`npm install -g corepack`.

- Commit only `pnpm-lock.yaml`. Do not commit `package-lock.json` or `yarn.lock`.
- Do not invoke `npm` or `yarn` in scripts or Dockerfiles.
- Run one-off package binaries with `pnpm dlx`, not `npx`.

**NODE-3 — Keep pnpm's default isolated `node_modules` layout.** Do not set
`node-linker=hoisted` or `shamefully-hoist`. If a tool fails because a package it imports
is undeclared, add that package to the workspace that imports it. If the undeclared
import is inside a third-party package, add a narrow `publicHoistPattern` entry in
`pnpm-workspace.yaml` with a comment saying which tool needs it.

List the dependencies that may run install scripts under `onlyBuiltDependencies` in
`pnpm-workspace.yaml`; pnpm skips all other dependency build scripts. Packages with
native or downloaded binaries (for example `bcrypt` and `esbuild`) need this, or they
fail at runtime. Review new requests with `pnpm approve-builds`, and do not allow a
package without knowing why it needs a build step.

**NODE-4 — Add each dependency to the workspace that uses it**
(`pnpm --filter @app/backend add bcrypt`), not to the root. pnpm only lets a package
import what it declares, so every workspace MUST declare everything it imports. The root
`package.json` holds only tooling shared by every workspace (TypeScript, oxlint, oxfmt,
test runners), added with `pnpm add -D -w <pkg>`. `@types/*` packages and test tools go
in `devDependencies`.

---

## Modules

**NODE-5 — Import Node built-in modules with the `node:` prefix:**
`import { inspect } from 'node:util'`, `import { randomUUID } from 'node:crypto'`,
`import { type IncomingMessage } from 'node:http'`.

**NODE-6 — Write source as ES modules everywhere and let each build choose the output
format:**

| Workspace | Source                   | Emitted                                 |
| --------- | ------------------------ | --------------------------------------- |
| root      | ESM (`"type": "module"`) | —                                       |
| `frontend` | ESM                     | ESM bundle (Vite)                       |
| `backend` | ESM syntax in TS         | CommonJS via the Nest CLI               |
| `shared`  | ESM (`"type": "module"`) | ESM + CommonJS via tsup (`exports` map) |

A config file that a tool loads as CommonJS MAY use `module.exports`.

**NODE-7 — Runtime code in `shared` MUST run in both Node and the browser.** Guard any
Node-only global (`typeof process === 'undefined' ? fallback : process.env.X`). Do not
import `node:*` modules from `shared` runtime code; type-only imports such as
`type UUID` are fine.

---

## Environment variables

**NODE-8 — Read `process.env` in one place per concern:** the NestJS config factory for
the backend, and Vite `define` for the frontend. Pass typed values onward from there. Do not
scatter `process.env.X` reads through services, gateways, or components.

**NODE-9 — Destructure env vars at the top of the function that needs them**, then parse
each one and give it an explicit default:

```ts
const { DB_HOST, DB_NAME, DB_PORT, BACKEND_PORT } = process.env;

const safeSetInt = (val: unknown, fallback: number): number =>
  typeof val === 'string' ? parseInt(val, 10) : fallback;

return {
  port: safeSetInt(BACKEND_PORT, 3000),
  database: { host: DB_HOST || 'localhost', name: DB_NAME || 'app', port: safeSetInt(DB_PORT, 27017) },
};
```

Always pass radix `10` to `parseInt`.

**NODE-10 — Required secrets MUST fail fast.** If a required value (such as
`SESSION_SECRET`) is missing, throw at startup with the variable's name. Never fall back
to a default secret.

**NODE-11 — `NODE_ENV` is one of `dev`, `test`, or `prod`, everywhere:** scripts,
Dockerfiles, and code. Check it only through predicate helpers
(`isProdEnv`, `isTestEnv`), never by comparing strings inline.

---

## Async code and process lifecycle

**NODE-12 — Use `async`/`await`.** Do not mix `.then()` chains into `async` functions,
except for a short final transformation. Run independent work concurrently with
`Promise.all`; use `Promise.allSettled` when each result must be reported individually
(for example, bulk seeding).

**NODE-13 — Every promise MUST be awaited, returned, or explicitly discarded with
`void`.** Entry points follow this shape:

```ts
async function bootstrap() { ... }

void bootstrap();
```

Fire-and-forget work MUST attach a `.catch` that logs:
`void syncIndexes(conn).catch((reason) => logger.error(reason));`

**NODE-14 — Do not call `process.exit()` from commands or services.** Set
`process.exitCode` and let the event loop drain.

**NODE-15 — Use `process.nextTick` only to defer a callback that a library expects to run
asynchronously** (for example, Passport's `serializeUser` and `deserializeUser`).

---

## Crypto and security

**NODE-16 — Generate UUIDs with `randomUUID()` from `node:crypto`.** Do not add a UUID
package.

**NODE-17 — Hash passwords with `bcrypt` using the async API** (`genSalt` + `hash`,
`compare`) and a named salt-rounds constant (`static readonly SALT_ROUNDS = 10`). The
`*Sync` variants are allowed only in test fixtures and seed data.

**NODE-18 — Never log, return, or serialize secrets or credentials.** That includes
passwords (hashed or plain), session secrets, cookies, and whole `req`/`res` objects.
Exclude password fields from database reads by default, and select them explicitly only
in the authentication path (see [mongoose.md](mongoose.md)).

---

## Debug output

**NODE-19 — Format structured debug output in the backend with `inspect` from
`node:util`**, and pass it to the logger rather than to `console`:

```ts
logger.debug(
  `[${this.updateTask.name} method] AFTER update\n`,
  inspect({ status, assigneeID }, { colors: true, compact: false, depth: 2 }),
);
```

Keep `depth` small (1–3), and never inspect a full request. See
[logging-and-errors.md](logging-and-errors.md).
