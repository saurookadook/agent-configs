# WebSocket Standards

Applies to real-time messaging between the frontend and the backend: the event constants and
types in `shared`, the Nest gateway in `backend`, and the connection manager in `frontend`.

**Stack:** `ws` via `@nestjs/platform-ws` (`WsAdapter`) in the backend, the browser
`WebSocket` API in the frontend, and MSW `ws` handlers in frontend tests.

---

## Contract

**WS-1 — Event names are constants in `shared/src/constants/ws-events.ts`.** Each constant
is `SCREAMING_SNAKE_CASE`, and its value is the kebab-case equivalent:

```ts
export const JOIN_PROJECT = 'join-project';
export const UPDATE_TASK = 'update-task';
export const SEND_PROJECT = 'send-project';
export const SEND_TASK = 'send-task';
```

Both sides MUST import these constants. Never write an event name as a string literal.

**WS-2 — Name events by direction:**

| Direction       | Pattern            | Examples                      |
| --------------- | ------------------ | ----------------------------- |
| client → server | imperative request | `JOIN_PROJECT`, `UPDATE_TASK` |
| server → client | `SEND_<payload>`   | `SEND_PROJECT`, `SEND_TASK`   |

**WS-3 — Every message is a JSON string of `{ event, data }`.** Its type extends a shared
`BaseWebSocketMessageEvent` and narrows `event` with `typeof`:

```ts
export interface SendTaskMessageEvent extends BaseWebSocketMessageEvent {
  event: typeof SEND_TASK;
  data: TaskMessageData;
}
```

Add a new message type to `shared` before using it on either side.

**WS-4 — Server-to-client payloads carry the full current state of whatever changed**, so
the client can replace its slice of state instead of merging deltas. Switch to deltas only
when payload size is a measured problem.

**WS-5 — Identify users from the authenticated session, not from client-supplied
parameters.** Room or resource identifiers MAY travel as query parameters on the
connection URL; use full names (`projectID`), per [typescript.md](typescript.md) TS-4.

---

## Backend gateway

**WS-6 — Each gateway is a `@WebSocketGateway()` class in
`<feature>/events/<feature>-events.gateway.ts`**, registered in its own module. That
module imports the feature module whose services the gateway calls.

**WS-7 — Handlers are `@SubscribeMessage(CONSTANT)` methods named `on<Event>`**
(`onJoinProject`, `onUpdateTask`). They take `@MessageBody()` data typed with shared
types, validate it as untrusted input, and delegate all domain logic to services.

**WS-8 — Validate the connection in `handleConnection`** and close invalid connections
with an explicit close code. Track clients per room in a private map:
`#rooms: Map<roomID, Map<userID, WebSocket>>`.

**WS-9 — Broadcast only to clients in the affected room**, and check
`client.readyState === WebSocket.OPEN` before each `send`.

**WS-10 — Implement `OnGatewayDisconnect`, and remove clients from room maps when they
disconnect**, so the maps do not grow without bound.

**WS-11 — Gateway ports and URLs come from configuration**, never from literals in the
gateway file.

---

## Frontend connection manager

**WS-12 — One `WebSocketManager` singleton (`wsManager`) owns the connection.** Components
call its methods to open, get, and close the connection. They never call `new WebSocket`
directly.

**WS-13 — Components subscribe in an effect and unsubscribe in that effect's cleanup.**
Add the `message` listener, then remove it and close the connection on unmount. Wrap the
handler in `useCallback`.

**WS-14 — Message handlers parse with `safeParseJSON` and return early on `null`**, then
`switch` on `messageData.event`. The `default` branch logs the unhandled event. Each case
dispatches a store action rather than setting component state directly.

**WS-15 — Send only after the socket is `OPEN`.** Wait for the `open` event (or a promise
the manager exposes); do not poll `readyState` on an interval.

**WS-16 — Reconnect with backoff.** The manager reconnects with exponential backoff and a
cap, then re-sends any join/subscribe messages for the current room.

---

## Testing

**WS-17 — Gateway tests call handler methods directly**, put mocked client sockets in the
room map, and assert on their `send` calls with `JSON.stringify(expectedEvent)`. Frontend
tests use MSW `ws.link(url)` handlers in `__mocks__/`. See [testing.md](testing.md).
