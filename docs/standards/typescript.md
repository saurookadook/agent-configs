# TypeScript Standards

Applies to every `.ts` / `.tsx` file in every workspace. Framework-specific rules live in
[react.md](react.md) and [nestjs.md](nestjs.md); formatting is enforced by oxfmt
([formatting-and-linting.md](formatting-and-linting.md)).

**Source of truth:** `tsconfig*.json` in each workspace and the root `.oxlintrc.json`.

---

## Compiler settings

**TS-1 — Every workspace MUST compile with `"strict": true`.** Do not turn off
individual strict flags (`noImplicitAny`, `strictNullChecks`) in production or test
configs. Also enable `noFallthroughCasesInSwitch`, `isolatedModules`, and
`forceConsistentCasingInFileNames`.

**TS-2 — Each workspace MUST define the `@/*` path alias to its own `src/`.** Import
in-workspace modules as `@/store` or `@/projects/dtos`, never as `../../../store`. Mirror
the alias in every tool that resolves modules (Vite `resolve.alias`, Jest
`moduleNameMapper`). Extra aliases SHOULD be rare.

**TS-3 — Split tsconfigs by purpose:** a `tsconfig.json` containing only `references`,
plus `tsconfig.app.json` or `tsconfig.build.json` (source, excluding tests),
`tsconfig.test.json` (source, tests, and test setup files), and `tsconfig.node.json`
(tool configs such as `vite.config.ts`). Shared options go in `tsconfig.common.json`.

---

## Naming

**TS-4 — Acronyms and initialisms MUST be fully capitalized** inside identifiers:
`userID`, `projectID`, `CreateProjectDTO`, `safeParseJSON`, `buildConnectionURI`,
`BASE_API_URL`, `isUUID`. When the acronym starts a camelCase identifier, it is all
lowercase: `wsManager`, `uuidPattern`, `dbConn`.

> Why: one spelling per concept keeps search and automated refactors reliable. Mixing
> `userId` and `userID` breaks both.

**TS-5 — Use these casings:**

| Kind                                      | Casing                   | Example                                       |
| ----------------------------------------- | ------------------------ | --------------------------------------------- |
| Variables, functions, methods             | `camelCase`              | `createProject`, `handleTaskUpdate`           |
| Classes, types, interfaces, enums         | `PascalCase`             | `ProjectRules`, `TaskUpdate`, `ProjectStatus` |
| Module-level constants (primitive/config) | `SCREAMING_SNAKE_CASE`   | `MAX_TASKS`, `SESSION_LS_KEY`, `UPDATE_TASK`  |
| Enum members                              | `SCREAMING_SNAKE_CASE`   | `ProjectStatus.ARCHIVED`                      |
| Type parameters                           | `PascalCase` word or `T` | `ExtraData`, `T`                              |

**TS-6 — String enums MUST use values identical to their member names.**

```ts
export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  COMPLETED = 'COMPLETED',
}
```

**TS-7 — Boolean names SHOULD read as predicates** (`isPublic`, `hasAccess`,
`requestInProgress`). Predicate functions start with `is`, `has`, or `can`
(`isTestEnv`, `canUserEditTask`).

**TS-8 — Constant suffixes carry meaning and MUST be used consistently:** `_LS_KEY` for
`localStorage` keys, `_TOKEN` for dependency-injection tokens, a unit for durations and
sizes (`_TTL_SECONDS`, `_MAX_BYTES`), and `mock`/`Mock` for test fixtures (see
[testing.md](testing.md)).

**TS-9 — Name variables after where their value came from:** `foundProject`,
`createdUser`, `parsedDetails`, `updatedTask`. A parameter the function mutates in place
SHOULD end in `Ref` (`projectRef`).

---

## Types

**TS-10 — Prefer `type` aliases.** Use `interface` only when a shape `extends` another
interface, when a class `implements` it, or when global declaration merging is required
(for example, custom test matchers).

**TS-11 — Derive related types instead of restating them.** Use indexed access and
utility types so a change in one place propagates:

```ts
projectID: TaskDTO['projectID'];
username: UserDTO['username'];
project: Omit<ProjectStateSlice, 'requestInProgress'>;
members: Pick<UserDTO, 'userID' | 'username'>[];
```

**TS-12 — Use a shared `Nullable<T>` alias** (`T | null`) for values that are
intentionally `null`. Reserve `?:` and `undefined` for "not provided".

**TS-13 — Give IDs semantic type aliases** (`type UserID = UUID`). Where an ID is a plain
`string`, say which kind it is in a `/** @note */` comment (for example, "string form of a
MongoDB ObjectId").

**TS-14 — Do not use `any`.** Use `unknown` and narrow it with a type guard. Values that
come from outside the program (setters, parsed JSON, request bodies, socket messages) MUST
be typed `unknown` until they are validated:

```ts
set ownerID(value: unknown) {
  if (!isUUID(value)) {
    throw new TypeError(`Invalid ownerID: '${String(value)}' (type '${typeof value}')`);
  }
  this.#ownerID = value as UserID;
}
```

**TS-15 — Import types with the `type` modifier.** In a mixed import, mark each type
inline and list it last: `import { logger, type UserID } from '@app/shared'`. When every
imported name is a type, use `import type { ... }`.

**TS-16 — Exported functions and public methods SHOULD declare return types**, and async
service methods MUST (`Promise<Nullable<ProjectDocument>>`). Local helpers and React
components MAY rely on inference.

**TS-17 — A type assertion (`as`) MUST NOT hide a possible `null`.** Prefer a guard that
throws. When an assertion follows a lookup that cannot fail, keep the code that
guarantees it on the line before:

```ts
if (!this.#rooms.has(roomID)) this.#rooms.set(roomID, new Map());
const room = this.#rooms.get(roomID) as RoomMembers;
```

The non-null operator `!` SHOULD NOT appear outside tests.

**TS-18 — Extend library types properly instead of suppressing errors.** If a library
object needs extra fields (for example, a route definition with a `label`), declare a
type that extends the library type.

---

## Functions

**TS-19 — Functions with more than one parameter SHOULD take a single named-arguments
object**, typed inline and destructured in the signature:

```ts
assignTask({
  assigneeID, // force formatting
  taskID,
}: {
  assigneeID: UserID;
  taskID: string;
}): TaskDocument { ... }
```

Exceptions: hot-path pure functions with a fixed positional contract, framework
callbacks, and NestJS handler parameters.

**TS-20 — Use `function` declarations for top-level named functions.** Use arrow
functions for callbacks, one-line helpers (`const isProdEnv = (env: unknown) => ...`),
and inline handlers.

**TS-21 — An immediately-invoked function MAY compute a `const` from branching logic**,
instead of declaring a `let` and reassigning it in `if`/`else`:

```ts
const { endpoint, errorMessage } = (function () {
  if (mode === 'register') return { endpoint: '/api/auth/register', errorMessage: '...' };
  ...
})();
```

---

## Classes

**TS-22 — Private state MUST use ECMAScript `#private` fields.** Expose it through `get`
and `set` accessors when outside code needs it. Setters MUST validate their input
(TS-14).

**TS-23 — Prefix internal helper methods with `_`** (`_findOrCreateSettings`,
`_validateMembers`). They stay public in TypeScript so tests can spy on them, but other
modules MUST NOT call them.

**TS-24 — Put static factory and utility methods on the class they relate to**
(`TaskList.createEmpty()`, `PasswordService.hash()`).

---

## Values and control flow

**TS-25 — Check for null and undefined with loose equality against `null`:** `x == null`
and `x != null`. Do not write `x === null || x === undefined`. Do not use a truthiness
check when `0`, `''`, or `false` is a valid value.

**TS-26 — Use `??` for defaults.** Use `||` only when you deliberately want falsy values
replaced too.

**TS-27 — Every `switch` MUST have a `default` branch.** Every non-empty `case` MUST end
in `return`, `break`, or `throw`; grouped empty cases are fine. If a case declares a
variable, wrap the case body in braces.

**TS-28 — Prefer immutable updates:** spread into new arrays and objects
(`[...state.tasks, task]`). A class that owns its data MAY mutate its own private state.

**TS-29 — Prefer `for...of`, `.map`, `.filter`, `.some`, `.find`, `.at(-1)`, and
`.findLastIndex`** over index arithmetic. Classic `for (let i...)` loops are fine for
grids and fixed-size structures.

---

## Modules and exports

**TS-30 — Prefer named exports.** Default exports are reserved for config factories,
module-level singleton instances, the root `App` component, and values whose framework
requires a default export.

**TS-31 — Give each directory imported as a unit an `index.ts` barrel** that re-exports
with `export * from './file'`. Code outside the directory imports from the barrel
(`@/projects/dtos`), not from individual files.

**TS-32 — Order imports in groups separated by one blank line:**

1. Node built-ins (always with the `node:` prefix), then third-party packages
2. Workspace packages (`@app/shared`), then `@/` aliases, then relative imports (`./`,
   `../`)
3. Side-effect imports (`import './styles.css'`) last

oxfmt sorts the statements within each group
([formatting-and-linting.md](formatting-and-linting.md) FMT-3). Keep the names inside
each `{ }` alphabetical by hand, with `type` imports last.

---

## Comments and documentation

**TS-33 — Use JSDoc on exported functions, classes, and non-obvious types**, with these
tags: `@description`, `@note`, `@todo`, `@see {@link https://… | label}`, `@param`,
`@returns`, `@example`. Use fenced ` ```txt ` blocks inside `@example` for diagrams.

**TS-34 — Start inline comments with `// TODO:` for planned work or `// NOTE:` for a
non-obvious reason.** A `TODO` says what is missing, not just "fix this".

**TS-35 — Do not commit commented-out code**; git keeps the history.

**TS-36 — `@ts-expect-error` MUST state a reason after a colon**, for example
`// @ts-expect-error: library types omit the documented 'enum' option`. Never use
`@ts-ignore`.
