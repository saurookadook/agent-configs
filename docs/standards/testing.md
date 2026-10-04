# Testing Standards

Applies to tests in every workspace.

| Workspace | Runner         | Environment | Libraries                                                        |
| --------- | -------------- | ----------- | ---------------------------------------------------------------- |
| `frontend` | Vitest        | jsdom       | Testing Library (`react`, `user-event`, `jest-dom`), MSW         |
| `backend` | Jest + ts-jest | node        | `@nestjs/testing`, `supertest`, a real MongoDB test database     |
| `shared`  | Jest + ts-jest | node        | —                                                                |

**Run:** `pnpm frontend:test`, `pnpm shared:test`, `pnpm backend:test`. Backend tests run in a
dedicated `backend-test` Compose service against the test database.

---

## Files and naming

**TEST-1 — Test files sit next to the code they test and are named `*.test.ts(x)`**
(`projects.controller.test.ts`, `pages/ProjectDetails/index.test.tsx`). In `shared`,
tests MAY be grouped in a `__tests__/` folder inside the module they cover. Backend
end-to-end tests live in `backend/test/` as `*.e2e-test.ts`, with their own Jest config
whose `testRegex` matches that suffix.

**TEST-2 — Fixtures live in `__mocks__/` as `<entity>Mocks.ts`** (`userMocks.ts`,
`projectMocks.ts`, `commonMocks.ts`).
- Fixture values are named `mock<Thing>` (`mockFirstUser`, `mockNow`).
- Factories are named `create<Thing>Mock` (`createTaskDocumentMock`).
- Lookups are named `find<Thing>Mock`.

Fixtures used by more than one workspace live in `shared` and are exported from its
testing entry point ([monorepo.md](monorepo.md) MONO-7).

**TEST-3 — Test helpers live in `utils/testing/`:**

- `dom-element-getters/` — `get<Thing>` and `get<Thing>Container` functions that find DOM
  nodes
- `expect-helpers/` — assertion bundles named `expect<Thing>ToBeVisibleAndCorrect`
- `matchers/` — custom matchers (see TEST-19)
- page-specific helpers MAY live in `pages/<Page>/testUtils.ts`

Production code MUST NOT import from these folders.

---

## Structure

**TEST-4 — Nest `describe` blocks by subject, then by unit:**

```ts
describe('TasksService', () => {
  describe("'updateOne' method", () => {
    it('should reject a status change on an archived project', async () => { ... });
  });
});

describe('ProjectsController', () => {
  describe('/projects/:projectID (GET)', () => { ... });
});
```

Name method blocks `"'methodName' method"` (or `"'name' static method"`). Name route
blocks `'/path (VERB)'`.

**TEST-5 — Test names describe behaviour in the present tense.** Backend tests use
`it('should …')`. Frontend and `shared` tests use `it('<verb>s …')` or
`it('renders correctly')`. Use one form per file.

**TEST-6 — Mark long setup with `/* START TEST SETUP */` … `/* END TEST SETUP */`** so the
act and assert steps are easy to find.

**TEST-7 — Mark unwritten tests with `it.todo('…')`.** Do not commit `it.skip` with a
placeholder assertion. A skipped test MUST have a `// TODO:` saying why it is skipped.

**TEST-8 — Tests MUST be independent of each other.** Reset state in `beforeEach` or
`afterEach` (`deleteMany({})`, `cleanup()`, `vi.clearAllMocks()`,
`server.resetHandlers()`). Release resources in `afterAll`: close the database connection
and the Nest app, restore spies, and switch back to real timers.

---

## Backend (Jest + Nest)

**TEST-9 — Service and controller tests are integration tests against the real test
database.** Build a testing module from real modules, and resolve providers and models by
token:

```ts
const module = await Test.createTestingModule({
  imports: [RootConfigModule, DatabaseModule, ProjectsModule, UsersModule],
}).compile();

mongoConnection = await module.resolve(getConnectionToken());
projectsService = await module.resolve(ProjectsService);
userModel = await module.resolve(USER_MODEL_TOKEN);
```

Mock a collaborator only when it is external (network, clock, email) or when the test is
about the interaction itself.

**TEST-10 — Controller tests send HTTP requests through `supertest`** on
`app.getHttpServer()`. Register the global filter providers so error responses have the
production shape, and assert on both `statusCode` and `message`. Use `await` with
`supertest`, not the `done` callback.

**TEST-11 — Fake timers MUST leave the event loop running:**
`jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'], now: mockNow })`.

**TEST-12 — Compare Mongoose documents and serialized responses with shared helpers**
(`expectHydratedDocumentToMatch<T>()`, `expectSerializedDocumentToMatch<T>()`). These
ignore generated `_id`, `__v`, and timestamp values.

**TEST-13 — Never point tests at the development database.** The test script loads
`.env.test` (a separate database name and ports) and sets `NODE_ENV=test`.

---

## Frontend (Vitest + Testing Library)

**TEST-14 — Import test APIs explicitly from `vitest`** (`describe`, `it`, `expect`, `vi`,
and hooks). Do not rely on globals.

**TEST-15 — Query the DOM the way a user would.** Use `findByRole('heading', { level: 2,
name })`, `getByLabelText('Username')`, and `getByRole('button', { name })`, scoped with
`within()`. Fall back to `container.querySelector('#id')` only for structural elements
with no accessible role. Interact through `userEvent.setup()` rather than `fireEvent`,
unless user-event cannot produce the event.

**TEST-16 — Wait for async UI with `findBy*` or `waitFor`.** Never use fixed sleeps.

**TEST-17 — Render with the real store and router.** Wrap the component in the app's
store provider with an `initialState`, and in a memory router built from the app's
`routerConfig` (`<WithMemoryRouter initialEntries={['/path']} />`). When a test needs to
dispatch store actions, render a small helper component in the test file that dispatches
them.

**TEST-18 — Mock the network at the boundary.** Mock HTTP with
`vi.spyOn(window, 'fetch').mockImplementation(createFetchMock())` or MSW `http` handlers,
and mock WebSockets with MSW `ws` handlers (`server.listen()`, `resetHandlers()`,
`close()`). Restore spies in `afterAll`.

---

## Shared conventions

**TEST-19 — Use the custom matchers from `shared`:** `toBeUUID`, `toBeISODateString`,
`toBeStringIncluding`, and `toBeNullish`. Use them both as matchers
(`expect(id).toBeUUID()`) and as asymmetric matchers (`userID: expect.toBeUUID()`).
Register them in each workspace's test setup file. New matchers go in `shared`, one per
file, each with its own `declare global` type augmentation.

**TEST-20 — Fixtures MUST be deterministic.** Use fixed UUIDs and one shared `mockNow`,
never `randomUUID()` or `new Date()` when the module loads.

**TEST-21 — Build complex domain-state fixtures by replaying a list of operations**
through the real domain logic, not by writing out the resulting state by hand. Give each
generator a JSDoc `@example` showing the state it produces.

**TEST-22 — `@ts-expect-error` in tests needs a reason**, as anywhere else
([typescript.md](typescript.md) TS-36). If the same suppression keeps repeating, fix the
type (for example, with a typed mock factory) instead.

**TEST-23 — New behaviour ships with tests.** A bug fix SHOULD start with a failing test
that reproduces the bug.
