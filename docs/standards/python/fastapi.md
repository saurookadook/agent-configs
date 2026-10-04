# FastAPI Standards

Applies to the application object, routers, routes, dependencies, middleware, error
responses, and scheduled jobs in `api/`. Request and response models are in
[pydantic.md](pydantic.md); data access is in [sqlalchemy.md](sqlalchemy.md); route tests
are in [pytest.md](pytest.md).

**Stack:** FastAPI on Starlette, served by gunicorn with uvicorn workers;
`fastapi-crons` for scheduled jobs.

---

## Application

**FAPI-1 — Build the app once, in `api/app/main.py`, with a lifespan context manager:**

```python
logger = init_logging(app_name="app-api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting API server...")
    yield
    logger.info("Shutting down API server...")


app = FastAPI(lifespan=lifespan)
```

Do not use the deprecated `@app.on_event("startup")` hooks. `main.py` configures logging,
adds middleware, registers exception handlers, and includes routers; it holds no route
logic beyond the health check.

**FAPI-2 — Serve with gunicorn and `uvicorn.workers.UvicornWorker`,** configured in
`gunicorn_config.py` from environment variables (`WORKERS`, `HOST`, `PORT`, `TIMEOUT`,
`LOG_LEVEL`, `RELOAD`). The app entry point is `api.app.main:app` in every environment.

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
own verb for actions (`archive_project`). The name becomes the OpenAPI operation ID.

**FAPI-7 — Every route decorator declares `response_model=`, and `status_code=` when it
is not 200**, using `fastapi.status` constants rather than bare numbers:

```python
@projects_router.post(
    "/projects",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_project(request_body: ProjectCreateRequest, api_db_session: API_DB_SessionDependency):
    ...
```

**FAPI-8 — Define a route with `def` when it does blocking work** (synchronous
SQLAlchemy, `requests`, Beautiful Soup, CPU-bound calculation). FastAPI runs `def` routes
in a thread pool. Use `async def` only when every I/O call inside it is awaited. A
blocking call inside `async def` stalls every request on that worker.

**FAPI-9 — Get the database session from the `API_DB_SessionDependency` dependency**,
never from a module-level session:

```python
# api/dependencies/db_session.py
def db_session_generator() -> DBSessionGenerator:
    session = DBSessionManager().scoped_session.session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def api_db_session() -> DBSessionGenerator:
    yield from db_session_generator()


API_DB_SessionDependency = Annotated[Session, Depends(api_db_session)]
```

The dependency builds a session from the factory and closes that object. It MUST NOT use
`scoped_session()` / `scoped_session.remove()`: FastAPI runs a sync dependency's setup and
teardown on different threads, so `remove()` would close another request's session. The
route never commits (SQLA-15). Tests override `api_db_session`, so keep it a separate
function from the generator.

**FAPI-10 — Type every parameter, and put constraints and descriptions on query
parameters with `Annotated` and `Query`:**

```python
def read_project_tasks(
    project_id: UUID,
    api_db_session: API_DB_SessionDependency,
    assignee_id: Annotated[Optional[UUID], Query(description="Only tasks assigned to this user.")] = None,
    sort: Annotated[
        Optional[Literal["due_date", "priority"]],
        Query(description="Order tasks by this field, highest first."),
    ] = None,
    limit: Annotated[
        Optional[int], Query(ge=1, le=MAX_PROJECT_TASKS, description="Maximum tasks to return.")
    ] = None,
):
```

Bounds come from module constants (`MAX_PROJECT_TASKS = 200`). Do not name a parameter
`status`; it shadows `fastapi.status`, which routes use for status codes. Path IDs SHOULD be typed
`UUID`, so a malformed ID is a 422 from validation instead of a database error.

**FAPI-11 — Request bodies are Pydantic models from `api/models/<resource>.py`**
(pydantic.md PYD-12), named `request_body` in the signature. An optional body is
`request_body: Optional[ProjectArchiveRequest] = None`, and the route says what omitting
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

Routes return a dict (`return {"data": project}`) and let `response_model` validate and
filter it. JSON keys are `snake_case`, matching the entity and column names
(pydantic.md PYD-13). When a parent exists but has nothing to report yet, return 200 with
`{"data": null}` or `{"data": []}`; reserve 404 for a parent that does not exist.

**FAPI-13 — Translate exceptions to HTTP errors in the route, from most to least
specific,** and always chain with `from e`:

| Raised                                              | Status | `detail`                        |
| --------------------------------------------------- | ------ | ------------------------------- |
| `<Entity>Facade.NoResultFound`                      | 404    | `"<Entity> not found"`          |
| a caller mistake the service detects (`ValueError`) | 422    | the error message               |
| unsupported input (`UnsupportedSource`)             | 400    | the error message               |
| an upstream we depend on failed (`FetchError`, an API client's error) | 502 | a fixed sentence naming the upstream |
| no data available to compute a required answer      | 503    | a fixed sentence                |
| anything else (`Exception`)                         | 500    | a fixed `"Error <doing what>"`  |

```python
try:
    project = ProjectFacade(db_session=api_db_session).get_one_by_id(project_id)
except ProjectFacade.NoResultFound as e:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found") from e
except Exception as e:
    error_detail = "Error fetching project"
    logger.error(f"{error_detail}: {e}")
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=error_detail
    ) from e
```

A 500 or 502 `detail` never contains the exception text, SQL, or upstream response;
those go to the log. A 4xx `detail` MAY carry the message of an exception the code raised
for the client. Never swallow an error and return 200 with empty data.

**FAPI-14 — Keep routes thin.** A route validates input, calls one facade or service, maps
errors, and shapes the envelope. Anything more (combining several facades, deriving
values, a shared error mapping) lives in `api/routes/handlers/<resource>.py`. When
several routes map the same exceptions, wrap the mapping in one handler helper:

```python
def run_analysis(operation: Callable[[], T], *, error_detail: str, logger: logging.Logger) -> T:
    """Maps what ``services.project_analysis`` raises onto status codes."""
    try:
        return operation()
    except ProjectFacade.NoResultFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found") from e
    ...
```

**FAPI-15 — Give every route a docstring** saying what it returns, whether it calls an
external or metered API, whether it writes, and why it chose a non-obvious status code.
FastAPI publishes it as the OpenAPI description.

---

## Middleware and cross-cutting concerns

**FAPI-16 — Write middleware as functions in `api/middlewares/`** and register them with
`app.middleware("http")(add_process_time_header)`. Middleware runs in reverse order of
registration (the last added runs first); keep a `# NOTE:` comment at the registration
site saying so.

**FAPI-17 — Configure `TrustedHostMiddleware` and `CORSMiddleware` with explicit lists**
of hosts, origins, and methods. Never combine `allow_origins=["*"]` with
`allow_credentials=True`. Add the test client's host (`base_url`) to the trusted hosts.

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
- The decorated jobs live in `api/crons/job_registry.py` and call the handler through
  `asyncio.to_thread(...)`, so a blocking handler never runs on the event loop.
- Each schedule has a comment giving the cron expression in UTC and local time, and any
  ordering dependency on another job.
- `main.py` imports the registry only in production
  (`if is_prod(): import api.crons.job_registry  # noqa: F401`).
- `api/crons/manual_run.py` runs any handler by name, for backfills and debugging.

---

## Testing

**FAPI-20 — Test routes through `TestClient` with the database dependency overridden**
(pytest.md PYTEST-14). Test the handler helpers in `api/_tests/routes/handlers/` directly,
and test each cron handler in `api/_tests/crons/test_handle_<job>.py`.
