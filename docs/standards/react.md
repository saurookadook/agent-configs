# React Standards

Applies to `frontend/src`. General TypeScript rules are in [typescript.md](typescript.md),
styling in [css.md](css.md), and tests in [testing.md](testing.md).

**Stack:** React 19 (function components), Vite, React Router (data router), a global
store built on Context + `useReducer`, and `classnames`.

**Source of truth:** the root `.oxlintrc.json` (`react` plugin), `frontend/tsconfig.app.json`,
and `frontend/vite.config.ts`.

---

## Directory layout

**REACT-1 — Organize `frontend/src` by role:**

```txt
src/
  app/            App.tsx, router.tsx, App.css
  components/     reusable, app-wide components (LoadingState, TopNavBar)
  layouts/        structural wrappers (Root, FlexColumn, FlexRow)
  pages/          one folder per route
    ProjectDetails/
      index.tsx           page component
      index.test.tsx
      styles.css
      components/         components used only by this page
        TaskList/
          index.tsx
          styles.css
      utils/              page-specific helpers: guards.ts, hooks.ts
  store/          global state (see "State")
  utils/          framework-agnostic frontend helpers (safeFetch, WebSocketManager)
    testing/      test-only helpers
  constants/      frontend constants
  types/          frontend-wide types
  __mocks__/      fixtures and mock-server handlers
```

A component used by one page lives in that page's `components/` folder. Move it to
`src/components/` only when a second page needs it.

**REACT-2 — Each component gets its own `PascalCase` folder** containing `index.tsx`,
plus `styles.css` and `index.test.tsx` when needed. Every `components/` folder has an
`index.ts` barrel.

---

## Components

**REACT-3 — Write components as named function declarations:**

```tsx
export function LoadingState({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={classNames('loading-spinner', className)} {...props}></div>;
}
```

Do not use `React.FC`. Only the root `App` is a default export.

**REACT-4 — Type props inline or with a `<Name>Props` alias next to the component.** A
component that wraps a native element MUST accept and spread that element's props, and
MUST merge its own `className` with the caller's using `classnames`:

```tsx
export type FlexColumnProps = React.PropsWithChildren<React.HTMLProps<HTMLDivElement>>;

export function FlexColumn({ children, className, ...props }: FlexColumnProps) {
  return <div className={classNames('flex-column', className)} {...props}>{children}</div>;
}
```

**REACT-5 — Pass `ref` as a regular prop.** Do not use `forwardRef`; React 19 no longer
needs it.

**REACT-6 — Build conditional classes with `classnames`**, using object syntax for flags:
`classNames({ task: true, done: isDone, overdue: isOverdue })`. Do not build class
strings with ternaries and concatenation.

**REACT-7 — Name event handlers `handle<Event>` and declare them as local `function`s**
(`handleTaskClick`, `handleSubmit`, `handleLogoutClick`). Pass extra arguments with an
inline arrow: `onClick={(e) => handleInviteClick(e, userID)}`.

**REACT-8 — List items MUST have stable keys taken from the data** (`userID`,
`` `${row}-${col}` ``). Use an index only for fixed-size lists that are never reordered,
and prefix it (`` `col-${index}` ``).

**REACT-9 — Use semantic, accessible markup.**
- Each page renders a `<section id="...">` with an `<h2>` title.
- Use `<dl>`/`<dt>`/`<dd>` for label–value data and `<table>` for tabular data.
- Use a `<button>` for actions, never a clickable `<div>`.
- Give every form input a `<label htmlFor>`.
- An interactive element that must be a non-button needs a `role` and keyboard handling.

**REACT-10 — Do not use `window.alert`, `confirm`, or `prompt`.** Render an inline
message, status component, or dialog instead.

**REACT-11 — Lean on native form validation** (`required`, `minLength`, `maxLength`,
`pattern`), using validation patterns from `shared` so frontend and backend agree. Read form
values with a single helper (`getFormData`). Wrap native inputs in a base component
(`BaseInput`) so defaults are applied once.

---

## State

The app has one global store: React Context + `useReducer`, with each slice's state
composed field by field using a `combineReducers` helper.

**REACT-12 — Each slice lives in `store/<slice-name>/`** in three files:

| File               | Contains                                                                   |
| ------------------ | -------------------------------------------------------------------------- |
| `reducer.types.ts` | `<Slice>StateSlice`, action types, and the combined-reducer type           |
| `reducer.ts`       | `initial<Slice>StateSlice`, one reducer per field, and the combined default export |
| `actions.ts`       | action-creator functions, sync and async                                   |

Slice folders use kebab-case (`project`, `task-list`). Register every slice in
`store/reducer.ts` (`AppState`, `initialAppState`, combined reducer), and re-export its
actions from `store/actions.ts`.

**REACT-13 — Action type constants are `SCREAMING_SNAKE_CASE` strings in
`store/actionTypes.ts`**, grouped under one comment per feature, each value equal to its
name.

**REACT-14 — Field reducers `switch` on `action.type`, return new values, and return the
current state in `default`.** Copy arrays and objects with spread rather than mutating
them:

```ts
const tasks: CombinedProjectStateSlice['tasks'] = [
  (stateSlice, action) => {
    switch (action.type) {
      case RESET_PROJECT:
        return [...initialProjectStateSlice.tasks];
      case SET_PROJECT:
      case UPDATE_PROJECT:
        return [...action.payload.project.tasks];
      default:
        return stateSlice;
    }
  },
  initialProjectStateSlice.tasks,
];
```

Reducers and initial-state builders MUST be pure: no `localStorage`, network calls, or
logging. Hydrate stored state with an effect or action after mount.

**REACT-15 — Namespace action payloads by slice:**
`dispatch({ type: SET_PROJECT, payload: { project: { ... } } })`.

**REACT-16 — Action creators take a named-arguments object that includes `dispatch`**
(typed with a shared `BaseAction` type) and return the result of dispatching. Async
action creators own the side effect — fetch, then dispatch — so components never call
`fetch` directly:

```ts
export async function fetchProject({
  dispatch,
  projectID,
}: BaseAction & { projectID: string }) {
  dispatch({ type: REQUEST_PROJECT });
  const responseData = await safeFetch.call(
    { name: fetchProject.name },
    { requestPathname: `/api/projects/${projectID}`, fetchOpts: { method: 'GET' } },
  );
  return setProject({ dispatch, project: responseData.project });
}
```

**REACT-17 — Track in-flight requests with a `<thing>RequestInProgress` boolean.** The
`REQUEST_*` action sets it, and the matching `SET_*` action (or failure action) clears it.

**REACT-18 — Components read and write the store only through a `useAppStore()` hook**,
which returns `{ appState, appDispatch }`. Destructure the slice you need near the top of
the component.

**REACT-19 — Keep component-local UI state in `useState`.** Do not put transient UI state
(open panels, form drafts) in the global store.

---

## Hooks and effects

**REACT-20 — Name custom hooks `use<Thing>`.** App-wide hooks live in `store/hooks.ts`;
page-specific hooks live in `pages/<Page>/utils/hooks.ts`.

**REACT-21 — Effect and memo dependency arrays MUST be complete**; oxlint's
`react/rules-of-hooks` and `react/exhaustive-deps` rules enforce this. Wrap callbacks
passed to effects in `useCallback` so they stay stable.

**REACT-22 — An effect that subscribes MUST clean up.** Remove listeners, close sockets,
and clear timers in the function the effect returns.

**REACT-23 — Use `useMemo` only when a derived value is expensive or feeds a dependency
array.** Do not memoize everything.

---

## Routing

**REACT-24 — Define routes once, as an exported `routerConfig: RouteObject[]`** in
`app/router.tsx`, and build the browser router from it. Tests build a memory router from
the same config.

**REACT-25 — Route paths are kebab-case** (`/project-history`, `/projects/:projectID`).
Path parameters are camelCase and end in `ID` when they identify something.

**REACT-26 — Put redirects and access checks in route `loader`s** (`return
redirect('/account/login')`), not in component render bodies. Use `useNavigate` only to
navigate in response to a user action.

**REACT-27 — Type route params with one shared `AppParams` type:**
`useParams<AppParams>()`.

---

## Data access and browser APIs

**REACT-28 — Make every HTTP call through one fetch wrapper (`safeFetch`)** that resolves
paths under `/api/...` against a single base URL constant. Give each call a name for its
error messages: `safeFetch.call({ name: fn.name }, { ... })`.

**REACT-29 — Put fetch options on the `RequestInit` object, not in headers:**
`{ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } }`.

**REACT-30 — `localStorage` key names are constants in `constants/index.ts`.** Each
name ends in `_LS_KEY`, and each value starts with a short app-specific prefix. Always
read stored values with `safeParseJSON`. Never store credentials or tokens in
`localStorage`.

**REACT-31 — Build-time configuration reaches the frontend through Vite `define`**
(`import.meta.env.LOG_LEVEL`), declared in `vite.config.ts`. Do not infer the
environment from `window.location`.

**REACT-32 — A long-lived connection is owned by one module-level singleton**
(`wsManager`). Never create one inside a render. See [websockets.md](websockets.md).
