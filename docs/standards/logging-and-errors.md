# Logging and Error-Handling Standards

Applies to every workspace. All logging goes through one shared logger built on
`loglevel`, exported from `@app/shared` as `sharedLog`.

---

## Loggers

**LOG-1 — Create one named logger per module, at module scope:**

```ts
import { sharedLog } from '@app/shared';

const logger = sharedLog.getLogger('ProjectsService');
```

Name the logger after the class or module it lives in, using `<Thing>.name` when that
symbol is in scope (`sharedLog.getLogger(LoginForm.name)`). Suffix test loggers with
`__tests` (`'ProjectsController__tests'`). Inside `shared`, import the logger with a
relative path.

**LOG-2 — Set the log level once per process**, from `LOG_LEVEL`: in the shared logger
module, in the frontend entry point, and in script entry points. Application modules MUST
NOT call `setLevel`. You may raise a level temporarily while debugging, but do not commit
it.

**LOG-3 — Do not use `console.*` in application code;** use the logger. `console` is
acceptable only in test-runner global setup files and mock-server handlers.

**LOG-4 — Choose the level by audience:**

| Level          | Use for                                                               |
| -------------- | --------------------------------------------------------------------- |
| `trace`        | call arguments and intermediate values on hot paths                   |
| `debug`        | state before and after an operation, branch decisions                 |
| `info` / `log` | lifecycle milestones (seeding started or finished, server listening)  |
| `warn`         | unexpected situations the code can recover from                       |
| `error`        | failures, always with the error object as an argument                 |

**LOG-5 — Start each message with where it comes from, and pass data as separate
arguments** rather than interpolating it into the string:

```ts
logger.debug(`[${this.updateOne.name} method] AFTER update\n`, {
  status: task.status,
  assigneeID: task.assigneeID,
});
```

In the backend, wrap large objects in `inspect(...)` from `node:util` with a small
`depth`.

**LOG-6 — Never log secrets or personal data.** That includes passwords (hashed or
plain), session IDs, cookies, request headers, tokens, and whole `req`, `res`, or
`context` objects.

---

## Errors

**LOG-7 — Error messages start with a location tag and quote values:**
`` `[ClassName.methodName] : <what went wrong> '${value}'` ``. Free functions use
`[functionName]`. When reporting bad input, include its type:
`` `Received '${value}' (type '${typeof value}')` ``.

```ts
throw new TypeError(
  `[TaskList.addMany] : Argument 'tasks' must be an array. Received '${tasks}' (type '${typeof tasks}')`,
);
```

**LOG-8 — Throw `TypeError` for an argument of the wrong type and `Error` for an invalid
value or state.** At the HTTP boundary, throw Nest HTTP exceptions instead
([nestjs.md](nestjs.md) NEST-30).

**LOG-9 — When you catch and re-throw, keep the original error as `cause`:**

```ts
} catch (error) {
  throw new Error(
    `[TasksService.updateOne] : ERROR saving task - ${error.message}`,
    { cause: error },
  );
}
```

**LOG-10 — Do not swallow errors.** A `catch` MUST re-throw, return a fallback that the
function documents as its contract, or log at `error` level.

**LOG-11 — A function prefixed `safe` contains errors by contract**, and its JSDoc says
what it returns on failure. For example, `safeParseJSON` returns `null`; `safeFetch` calls
an `onErrorCallback` if one is given, and otherwise logs and throws a tagged error.

**LOG-12 — Normalize unknown catch values before using them:**
`const err = error instanceof Error ? error : new Error(String(error));`.
