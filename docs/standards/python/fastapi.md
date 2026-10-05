# FastAPI Standards

Applies to the application object, routers, routes, dependencies, middleware, error
responses, and scheduled jobs in `api/`. Request and response models are in
[pydantic.md](pydantic.md); data access is in [sqlalchemy.md](sqlalchemy.md); route tests
are in [pytest.md](pytest.md).

**Stack:** FastAPI on Starlette, pinned to a minor release (FAPI-22) and served by
Uvicorn's own worker processes; `fastapi-crons`, with distributed locking, for scheduled
jobs. The evidence behind these rules is in
[FastAPI best practices](../../research/python/fastapi-best-practices.md); where sources
disagree they follow FastAPI's and Python's official documentation.

---

## Application

**FAPI-1 — Build the app once, in `api/app/main.py`, with a lifespan context manager:**

```python
logger = init_logging(app_name="app-api")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("Starting API server...")
    yield
    logger.info("Shutting down API server...")


app = FastAPI(lifespan=lifespan)
```

Do not use the deprecated `@app.on_event("startup")` hooks. `main.py` configures logging,
adds middleware, registers exception handlers, and includes routers; it holds no route
logic beyond the health check.

**FAPI-2 — Serve with the `uvicorn` command and its own worker processes,** not gunicorn:
Uvicorn deprecated `uvicorn.workers.UvicornWorker` in 0.30.0, and FastAPI's deployment
docs run Uvicorn's own `--workers`. Configure it with `UVICORN_*` environment variables
(`UVICORN_HOST`, `UVICORN_PORT`, `UVICORN_WORKERS`, `UVICORN_LOG_LEVEL`,
`UVICORN_FORWARDED_ALLOW_IPS`), and start it in exec form so shutdown signals reach it:

```dockerfile
CMD ["uvicorn", "api.app.main:app", "--no-server-header"]
```

- `--no-server-header` drops the `server: uvicorn` banner, which a security review flags
  as technology disclosure. This is why the image runs `uvicorn` rather than
  `fastapi run`, which wraps the same server without that option.
- Uvicorn trusts `X-Forwarded-*` headers only from `127.0.0.1` by default. Set
  `UVICORN_FORWARDED_ALLOW_IPS` to the proxy's address; use `*` only when nothing but the
  proxy can reach the server.
- Where an orchestrator scales by replicas, run one worker per container
  (`UVICORN_WORKERS=1`). On a single host, set the worker count there. Every worker has
  its own thread pool, database pool, lifespan, and cron scheduler (FAPI-19).
- Locally, run `uv run fastapi dev api/app/main.py`, which reloads on change
  (`--reload` and `--workers` cannot be combined).

The app entry point is `api.app.main:app` in every environment.

**FAPI-3 — Expose `GET /api/health-check`**, returning 200 with a small JSON body and
touching nothing else (no database, no upstream call), so platform health checks stay
cheap.

---

## Routers and routes

**FAPI-4 — One router per resource, in `api/routes/<resources>.py`,** created as
`projects_router = APIRouter(prefix="/api")` and included in `main.py` in alphabetical
order. Nested and action routes for a resource live in the same router.

**FAPI-5 — Paths are plural, kebab-case nouns;** sub-resources nest under their parent,
and an operation that is not CRUD is a `POST` to a verb under the resource:

| Purpose              | Path                                       |
| -------------------- | ------------------------------------------ |
| collection           | `GET /api/projects`                        |
| one item             | `GET /api/projects/{project_id}`           |
| sub-resource         | `GET /api/projects/{project_id}/tasks`     |
| derived, cached read | `GET /api/projects/{project_id}/report`    |
| action with effects  | `POST /api/projects/{project_id}/archive`  |
| multi-word resource  | `GET /api/exchange-rate`                   |

**FAPI-6 — Name route functions `<verb>_<resource>`:** `read_projects_list`,
`read_project`, `create_project`, `update_project`, `delete_project`, and the action's
own verb for actions (`archive_project`). FastAPI builds each route's default OpenAPI
operation ID from this name, so generated clients use it as the method name.

**FAPI-7 — Declare the response with the route's return annotation, and `status_code=`
when it is not 200**, using `fastapi.status` constants rather than bare numbers. FastAPI
uses the return type to validate, filter, and document the response, and to serialize it
through Pydantic's fast path; its docs prefer this to `response_model=`, which is only
for a function that returns something other than the declared model. Return the declared
model itself (FAPI-12), and never annotate a route `-> Any` to quiet the type checker:

```python
@projects_router.post("/projects", status_code=status.HTTP_201_CREATED)
def create_project(
    request_body: ProjectCreateRequest, api_db_session: DBSessionDep
) -> ProjectResponse:
    """Create a project from the request body."""
    try:
        project = ProjectFacade(db_session=api_db_session).create_or_update(
            payload=request_body.model_dump()
        )
        api_db_session.commit()  # before returning, so a failure is still a 500
    except Exception as e:
        error_detail = "Error creating project"
        logger.exception(error_detail)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=error_detail
        ) from e
    return ProjectResponse(data=project)
```

**FAPI-8 — Define a route with `def` when it does blocking work** (synchronous
SQLAlchemy, `requests`, Beautiful Soup, CPU-bound calculation). FastAPI runs `def` routes
in a thread pool. Use `async def` only when every I/O call inside it is awaited. A
blocking call inside `async def` stalls every request on that worker. The thread pool
runs at most 40 `def` routes and dependencies at once per worker (Starlette's default),
so size the engine's pool (sqlalchemy.md SQLA-14) with it in mind, and keep
`workers × (pool_size + max_overflow)` below PostgreSQL's `max_connections`.

**FAPI-9 — Get the database session from the `DBSessionDep` dependency**, never from a
module-level session. The dependency opens the session, rolls it back if the route
raises, and closes it. It does not commit:

```python
# api/dependencies/db_session.py
def db_session_generator() -> Iterator[Session]:
    session = DBSessionManager().scoped_session.session_factory()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def api_db_session() -> Iterator[Session]:
    yield from db_session_generator()


type DBSessionDep = Annotated[Session, Depends(api_db_session)]
```

Since FastAPI 0.118, the code after a dependency's `yield` runs after the response has
been sent, so a commit there could fail after the client already has a 2xx. The route
therefore commits its own writes before it returns (FAPI-7, SQLA-15), and only cleanup
stays in the dependency. A dependency that catches an exception MUST re-raise it. The
dependency builds a session from the factory and closes that object; it MUST NOT use
`scoped_session()` / `scoped_session.remove()`, because FastAPI runs a sync dependency's
setup and teardown on different threads, so `remove()` would close another request's
session. Tests override `api_db_session`, so keep it a separate function from the
generator.

**FAPI-10 — Type every parameter and the return value (PY-18), and put constraints and
descriptions on query parameters with `Annotated` and `Query`:**

```python
def read_project_tasks(
    project_id: UUID,
    api_db_session: DBSessionDep,
    assignee_id: Annotated[
        UUID | None, Query(description="Only tasks assigned to this user.")
    ] = None,
    sort: Annotated[
        Literal["due_date", "priority"] | None,
        Query(description="Order tasks by this field, highest first."),
    ] = None,
    limit: Annotated[
        int | None, Query(ge=1, le=MAX_PROJECT_TASKS, description="Maximum tasks to return.")
    ] = None,
) -> dict[str, list[TaskEntity]]:
```

Bounds come from module constants (`MAX_PROJECT_TASKS = 200`). Do not name a parameter
`status`; it shadows `fastapi.status`, which routes use for status codes. Path IDs SHOULD be typed
`UUID`, so a malformed ID is a 422 from validation instead of a database error.

**FAPI-11 — Request bodies are Pydantic models from `api/models/<resource>.py`**
(pydantic.md PYD-12), named `request_body` in the signature. An optional body is
`request_body: ProjectArchiveRequest | None = None`, and the route says what omitting
it means.

---

## Responses

**FAPI-12 — Wrap every success body in a `data` envelope,** declared as a response model
in `api/models/<resource>.py`:

```python
class ProjectResponse(BaseResponseModel):
    data: ProjectEntity


class ProjectsListResponse(BaseResponseModel):
    data: list[ProjectEntity]
```

Routes return the envelope model, which is also their return annotation
(`return ProjectResponse(data=project)`, FAPI-7). JSON keys are `snake_case`, matching the entity and column names
(pydantic.md PYD-13). When a parent exists but has nothing to report yet, return 200 with
`{"data": null}` or `{"data": []}`; reserve 404 for a parent that does not exist.

**FAPI-13 — Translate exceptions to HTTP errors in the route, from most to least
specific,** and always chain with `from e`:

| Raised                                              | Status | `detail`                        |
| --------------------------------------------------- | ------ | ------------------------------- |
| `<Entity>Facade.NotFoundError`                      | 404    | `"<Entity> not found"`          |
| a caller mistake the service detects (`ValueError`) | 422    | the error message               |
| unsupported input (`UnsupportedSourceError`)        | 400    | the error message               |
| an upstream we depend on failed (`FetchError`, an API client's error) | 502 | a fixed sentence naming the upstream |
| no data available to compute a required answer      | 503    | a fixed sentence                |
| anything else (`Exception`)                         | 500    | a fixed `"Error <doing what>"`  |

```python
try:
    project = ProjectFacade(db_session=api_db_session).get_one_by_id(project_id)
except ProjectFacade.NotFoundError as e:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found") from e
except Exception as e:
    error_detail = "Error fetching project"
    logger.exception(error_detail)  # attaches the traceback (PY-39)
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=error_detail
    ) from e
```

A 500 or 502 `detail` never contains the exception text, SQL, or upstream response;
those go to the log. A 4xx `detail` MAY carry the message of an exception the code raised
for the client. Never swallow an error and return 200 with empty data.

**FAPI-14 — Keep routes thin.** A route validates input, calls one facade or service, maps
errors, commits if it wrote (FAPI-9), and shapes the envelope. Anything more (combining several facades, deriving
values, a shared error mapping) lives in `api/routes/handlers/<resource>.py`. When
several routes map the same exceptions, wrap the mapping in one handler helper:

```python
def run_analysis[T](
    operation: Callable[[], T], *, error_detail: str, logger: logging.Logger
) -> T:
    """Map ``services.project_analysis`` errors onto status codes."""
    try:
        return operation()
    except ProjectFacade.NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        ) from e
    ...
```

**FAPI-15 — Give every route a docstring** saying what it returns, whether it calls an
external or metered API, whether it writes, and why it chose a non-obvious status code.
FastAPI publishes it as the OpenAPI description.

---

## Middleware and cross-cutting concerns

**FAPI-16 — Write middleware in `api/middlewares/`.** A middleware that only reads or sets
headers MAY be a function registered with
`app.middleware("http")(add_process_time_header)`. One that sets context variables
(request IDs, logging context) or wraps streaming responses MUST be a pure ASGI class,
registered with `app.add_middleware(...)`, because the function form runs on Starlette's
`BaseHTTPMiddleware`, which does not propagate context-variable changes:

```python
class RequestIDMiddleware:
    """Bind a request ID to the logging context for one request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app: ASGIApp = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Pass non-HTTP traffic through; tag HTTP requests."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        token = request_id_var.set(uuid4().hex)
        try:
            await self.app(scope, receive, send)
        finally:
            request_id_var.reset(token)
```

Middleware runs in reverse order of registration (the last added runs first); keep a
`# NOTE:` comment at the registration site saying so.

**FAPI-17 — Configure `TrustedHostMiddleware` and `CORSMiddleware` with explicit lists**
of hosts, origins, and methods. Never combine `allow_origins=["*"]` with
`allow_credentials=True`: FastAPI's docs forbid it, but Starlette does not enforce it and
instead reflects any request's `Origin` with credentials allowed, so reject `"*"` where
the origin list is loaded. Pass `www_redirect=False` to `TrustedHostMiddleware`, since an
API has no `www.` host. Add the test client's host (`base_url`) to the trusted hosts.

**FAPI-18 — Register an exception handler for a library error that should become one
fixed response** (`@app.exception_handler(CsrfProtectError)` → 403) rather than catching
it in every route.

---

## Scheduled jobs

**FAPI-19 — Scheduled jobs use `fastapi-crons`:**

- Handlers are plain synchronous functions in `api/crons/handlers.py`, named
  `handle_<job>`. Each opens its own session (`DBSessionManager().scoped_session()`),
  commits per unit of work, and on a per-item failure rolls back, logs with
  `exc_info`, and continues (SQLA-27).
- The decorated jobs live in `api/crons/job_registry.py` as plain `def` functions that
  call the handler. fastapi-crons already runs a sync job with `asyncio.to_thread`, so a
  blocking handler never runs on the event loop and needs no wrapping of its own.
- Every worker process runs its own scheduler, so distributed locking MUST be on
  (`CRON_ENABLE_DISTRIBUTED_LOCKING=true`) with a lock backend on the existing
  PostgreSQL database (fastapi-crons ships `SQLAlchemyLockBackend` and
  `PostgreSQLAdvisoryLockBackend`). Without it, each job runs once per worker and per
  container (FAPI-2).
- Never mount fastapi-crons' `/crons` router or dashboard where clients can reach it;
  it has no authentication of its own.
- Each schedule has a comment giving the cron expression in UTC and local time, and any
  ordering dependency on another job.
- `main.py` imports the registry only in production
  (`if is_prod(): import api.crons.job_registry  # noqa: F401`).
- `api/crons/manual_run.py` runs any handler by name, for backfills and debugging.

---

## Testing

**FAPI-20 — Test routes through `TestClient` with the database dependency overridden**
(pytest.md PYTEST-14), against a session that turns the route's commit into a savepoint
(pytest.md PYTEST-10). Test the handler helpers in `api/_tests/routes/handlers/` directly,
and test each cron handler in `api/_tests/crons/test_handle_<job>.py`.

---

## Dependencies and versions

**FAPI-21 — Declare each dependency as a `type` alias next to its provider,** named
`<Thing>Dep` (`type DBSessionDep = Annotated[Session, Depends(api_db_session)]`), and use
only the alias in route signatures. `Depends()` returns `Any` and type checkers ignore
`Annotated` metadata, so pyright cannot check that the provider returns the declared
type; keeping the alias directly below the provider leaves one line to review. Never
write `Annotated[..., Depends(...)]` inline in a route, and never the old
`= Depends(...)` default style. Annotate every provider's return type, `-> Iterator[T]`
for one that yields. Replacements in `app.dependency_overrides` are named functions with
return annotations, since that mapping accepts any callable.

**FAPI-22 — Pin FastAPI to a minor range** in `pyproject.toml`
(`"fastapi[standard]>=0.142.2,<0.143"`) and upgrade one minor release at a time, reading
its release notes. FastAPI is still 0.x, and its versioning page says any minor release
may break: 0.118 moved dependency teardown after the response, 0.122 made the security
classes return 401, and 0.132 started rejecting JSON bodies without a JSON
`Content-Type`. `uv.lock` pins the exact version (PY-2).

---

## Validation errors

**FAPI-23 — Return 422s that expose nothing a security review would flag.** FastAPI's
default handler returns every Pydantic error in full, including `input` (the submitted
value, a password on a login or signup route), `ctx` (internal constraint objects), and
`url` (a link into the docs of the installed Pydantic version). Register a handler in
`main.py` that keeps only `loc`, `msg`, and `type`:

```python
@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Return a 422 without echoing input, context, or library links."""
    errors: list[dict[str, object]] = [
        {"loc": err["loc"], "msg": err["msg"], "type": err["type"]}
        for err in exc.errors()
    ]
    logger.info(
        "Rejected %s %s: %s",
        request.method,
        request.url.path,
        [(error["loc"], error["type"]) for error in errors],
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, content={"detail": errors}
    )
```

- A message MUST NOT carry the submitted value or anything internal: custom validator
  messages (pydantic.md PYD-9) name the fields and the accepted shapes, never the value
  received, a file path, a SQL fragment, or a class name.
- Log a rejected request with its method, path, and each error's `loc` and `type`, never
  its input. Never put `str(exc)` in a response; FastAPI's docs warn it contains the file
  name and line of the failure.
- The same standard holds for every error response: 500 and 502 bodies are fixed
  sentences (FAPI-13), a 4xx `detail` is a message written for the client, the server
  banner is off (FAPI-2), and the app never runs with `debug=True` outside local
  development, since debug mode returns tracebacks.
