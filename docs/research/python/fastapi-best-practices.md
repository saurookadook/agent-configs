# Let annotations drive every FastAPI layer

As of October 2026, best-practice FastAPI means **FastAPI 0.142.x (latest 0.142.2, released 30 September 2026) pinned to a minor range, on Python 3.14, Pydantic 2 and Starlette 1.x**. The core of the approach is that **every parameter, dependency and return value is declared with `Annotated[...]` and a real return type**. FastAPI is still at 0.x and calls itself beta, and its 2025–2026 releases changed enough behaviour that most guides written before 2026 are now wrong somewhere ([FastAPI release notes](https://fastapi.tiangolo.com/release-notes/); [pyproject.toml](https://github.com/fastapi/fastapi/blob/master/pyproject.toml)). The most important shift for a typed codebase is that **the route's return annotation now does four jobs at once**: it validates output, filters out fields, generates the OpenAPI schema, and since 0.130.0 it also routes serialization through Pydantic's Rust core for roughly double the JSON throughput. An unannotated route is therefore slower as well as untyped. The sharpest traps are in three places. Since 0.118.0, **the exit code of `yield` dependencies runs after the response is sent**, so a commit placed in a dependency's teardown can fail after the client already has a 2xx. **`Depends()` returns `Any`**, so pyright never checks that a dependency provides the type the parameter declares. And **pydantic-settings models with required fields fail pyright strict** at the `Settings()` call. Where community guides diverge, the official docs win on dependency style, settings and response declaration. OWASP wins over the docs on a few security details, notably returning 403 for insufficient scope. Gunicorn's `UvicornWorker`, `ORJSONResponse` and `@app.on_event` belong to the past. The official sources leave a genuine choice on where database commits live, and this report sets out both options rather than picking one. One caveat applies to everything below: PyPI was blocked in the research environment, so **none of the code examples were executed or run through pyright**. They were written against the cloned FastAPI and Starlette sources with strict mode in mind, and should be checked in CI before they are codified.

## FastAPI 0.142 rewrote a year of advice without reaching 1.0

FastAPI's own versioning page explains the 0.x numbering: "each version could potentially have breaking changes", so it tells users to pin a minor range such as `fastapi[standard]>=0.112.0,<0.113.0` and to treat only patch releases as non-breaking ([About FastAPI versions](https://fastapi.tiangolo.com/deployment/versions/)). The current package requires **Python ≥3.10, Pydantic ≥2.9.0 and Starlette ≥0.46.0**. Its classifiers include Python 3.14 and `Typing :: Typed` ([pyproject.toml](https://github.com/fastapi/fastapi/blob/master/pyproject.toml)). The 0.129.0 announcement told users to run "ideally 3.14", the official Dockerfile starts `FROM python:3.14`, and 0.136.0 added support for free-threaded 3.14t ([FastAPI Docker docs](https://fastapi.tiangolo.com/deployment/docker/); [release notes](https://fastapi.tiangolo.com/release-notes/)). The `fastapi-slim` package was discontinued in 0.129.2. Applications should install `fastapi[standard]`, which now bundles `uvicorn[standard]`, `httpx`, `python-multipart`, `email-validator`, `pydantic-settings`, `pydantic-extra-types` and the OpenTelemetry SDK ([pyproject.toml](https://github.com/fastapi/fastapi/blob/master/pyproject.toml)).

The releases since late 2025 that invalidate older advice:

| Version (date) | Change | Older advice it retires |
|---|---|---|
| 0.118.0 (2025-09-29) | `yield`-dependency exit code runs **after** the response is sent; security tutorial moves to pwdlib + Argon2 | "Teardown runs before the response" (0.106–0.117 behaviour); passlib/bcrypt |
| 0.121.0 (2025-11-03) | `Depends(..., scope="function")` for early exit | No way to release resources before streaming |
| 0.122.0 (2025-11-24) | Security classes return **401 + `WWW-Authenticate`** when credentials are missing | 403 from `HTTPBearer`/`APIKeyHeader` |
| 0.126.0–0.128.0 (Dec 2025) | Pydantic v1 and `pydantic.v1` dropped | v1 compatibility shims, `orm_mode`, `.dict()` |
| 0.128.2 (2026-02-05) | PEP 695 `type` aliases (`TypeAliasType`) supported in parameters | `X: TypeAlias = Annotated[...]` as the only option |
| 0.129.0 (2026-02-12) | Python 3.9 dropped | `Optional[X]`/`Union` syntax |
| 0.130.0 / 0.131.0 (2026-02-22) | Rust JSON serialization when a return type or `response_model` exists; `ORJSONResponse`/`UJSONResponse` deprecated | `default_response_class=ORJSONResponse` for speed |
| 0.132.0 (2026-02-23) | **`strict_content_type` on by default**: JSON bodies need a JSON `Content-Type` | Clients posting JSON without a header |
| 0.133.0 / 0.134.0 | Starlette 1.0 supported; floor raised to 0.46.0 | — |
| 0.135.0 (2026-03-01) | Native Server-Sent Events | Third-party SSE packages |
| 0.137.0 (2026-06-14) | `include_router` keeps routers **live** (no copying); `router.routes` becomes a tree | Defining all routes before inclusion; iterating `router.routes` as a flat list |
| 0.142.0 (2026-09-29) | Native OpenTelemetry support | — |

Sources: [FastAPI release notes](https://fastapi.tiangolo.com/release-notes/); [Advanced Dependencies](https://fastapi.tiangolo.com/advanced/advanced-dependencies/).

The CLI is now the documented way to run an app. `fastapi dev` reloads on `127.0.0.1`, `fastapi run` is the production mode on `0.0.0.0`, and both run Uvicorn internally. The docs recommend declaring the app once in `pyproject.toml` under `[tool.fastapi] entrypoint = "app.main:app"` "because other tools might not be able to find it" otherwise ([FastAPI CLI](https://fastapi.tiangolo.com/fastapi-cli/)).

```toml
# pyproject.toml
[project]
requires-python = ">=3.14"
dependencies = [
  "fastapi[standard]>=0.142.2,<0.143",   # minor-range pin, per the versions page
  "starlette>=1.6",                       # FastAPI's floor is 0.46; 1.6 adds RequestBodyLimitMiddleware
  "sqlalchemy>=2.0",
  "pyjwt>=2.10",
  "pwdlib[argon2]",
]

[tool.fastapi]
entrypoint = "app.main:app"
```

**On layout, the official docs and the most-cited community guide take different approaches, and both work.** The "Bigger Applications" tutorial groups code by technical role. It has an `app/` package with `main.py`, a shared `dependencies.py`, one `APIRouter` per module under `routers/`, and `internal/`. Each router sets `prefix`, `tags`, `dependencies` and `responses` once, and the docs compare routers to Flask Blueprints ([Bigger Applications](https://fastapi.tiangolo.com/tutorial/bigger-applications/)). The zhanymkanov "fastapi-best-practices" guide (last updated May 2026) argues that grouping by file type "didn't scale well for our monolith". It instead puts each domain in its own package under `src/<domain>/`, each with its own `router.py`, `schemas.py`, `models.py`, `dependencies.py`, `service.py` and `exceptions.py` ([zhanymkanov/fastapi-best-practices](https://github.com/zhanymkanov/fastapi-best-practices)). The official docs never argue against domain packages, and `APIRouter` behaves the same either way, so this is a scaling preference rather than a conflict. The examples below use domain packages. Two official rules apply to both layouts. A router prefix must not end in `/`. And since 0.137.0, **routers are combined live rather than copied**, so routes can be added to a router after it has been included. The docs now say to "treat `router.routes` as a lower-level route tree" and never mutate it ([Bigger Applications](https://fastapi.tiangolo.com/tutorial/bigger-applications/)). The docs give no guidance on an app factory (`create_app()`) versus a module-level `app`, since every official example uses the module-level form. The factory used later in this report is a choice, not doctrine.

FastAPI's docs mention **only mypy as a type checker. The word "pyright" does not appear in the English docs.** The FastAPI repository itself runs mypy in pre-commit and added `ty` configurations to check the docs sources in 0.137.2 ([release notes](https://fastapi.tiangolo.com/release-notes/); [FastAPI docs source](https://github.com/fastapi/fastapi/tree/master/docs/en/docs)). **The official examples are not pyright-strict clean.** They leave returns unannotated (`async def read_items():`), use bare `dict`, and keep untyped module globals such as `ml_models = {}` ([docs_src/events/tutorial003_py310.py](https://github.com/fastapi/fastapi/blob/master/docs_src/events/tutorial003_py310.py)). A strict team adopts the docs' *patterns* but has to add the annotations itself.

Python 3.14's lazy annotations need one FastAPI-specific caution. FastAPI and Pydantic read annotations at runtime when a route or model is defined. The general rule against using `TYPE_CHECKING`-only names in runtime-evaluated annotations therefore applies to every route signature, dependency signature and Pydantic field. Release 0.128.1 says it fixed "TYPE_CHECKING annotations for Python 3.14 (PEP 649)" ([release notes](https://fastapi.tiangolo.com/release-notes/)), but what that fix covers was not verified. The safe convention is to import every name used in a route or model annotation normally, and to define models above the routes that use them.

## `Annotated` aliases type the dependency graph, but the checker cannot see inside `Depends`

FastAPI has recommended `Annotated` since 0.95.0, and the old default-value style (`q: str | None = Query(default=None)`) is now labelled the "(old)" style. The docs give two reasons for the switch. With `Annotated`, the Python default stays a real default. And the function stays callable outside FastAPI: with `= Depends()`, "if you call that function without FastAPI … your editor won't complain, and Python won't complain" ([Query Parameters and String Validations](https://fastapi.tiangolo.com/tutorial/query-params-str-validations/)). The docs also encourage **reusable aliases** such as `CurrentUser = Annotated[User, Depends(get_current_user)]`. They note that "the type information will be preserved" for editors and mypy ([Dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/)). Since 0.128.2, FastAPI unwraps PEP 695 aliases: `analyze_param` checks `is_typealiastype(annotation)` and reads `__value__`. As a result, `type SessionDep = Annotated[Session, Depends(get_session)]` is the idiomatic form on 3.14 ([fastapi/dependencies/utils.py](https://github.com/fastapi/fastapi/blob/master/fastapi/dependencies/utils.py)). The unwrapping is confirmed only for an alias that makes up the *whole* parameter annotation. Whether a `type` alias nested inside another `Annotated[...]` is unwrapped was not verified, so `Query()`/`Path()` metadata stays inline.

The typing gap the docs do not mention is this. **`Depends` is declared as `def Depends(...) -> Any`, and type checkers ignore `Annotated` metadata** ([fastapi/param_functions.py](https://github.com/fastapi/fastapi/blob/master/fastapi/param_functions.py)). So `Annotated[User, Depends(get_session)]` type-checks even though `get_session` yields a `Session`, and pyright strict cannot catch that mismatch. The mitigation is structural. Define each alias **in the same module as its provider**, so the declared type and the provider's return annotation sit side by side. Never write `Annotated[..., Depends(...)]` inline in route signatures. Then the only place a mismatch can happen is one line, next to the function that defines the truth. The docs' other conventions carry over unchanged. `Annotated[Pagination, Depends()]` with no argument is shorthand for depending on the class itself ([Classes as Dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/classes-as-dependencies/)). A dependency used several times in one request is called once and cached, unless `use_cache=False` is passed ([Sub-dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/sub-dependencies/)). Router-level, `include_router`-level and app-level `dependencies=[...]` run for every operation in scope but never pass a value to the function, which makes them the documented way to require authentication across a whole group of routes ([Bigger Applications](https://fastapi.tiangolo.com/tutorial/bigger-applications/)).

### Lifespan state and settings need a typed accessor

Startup and shutdown belong in `FastAPI(lifespan=...)`, written as an `@asynccontextmanager` async generator. **`@app.on_event` and `on_startup=`/`on_shutdown=` are deprecated**. FastAPI decorates `on_event` with `@deprecated`, so pyright's `reportDeprecated` flags it. The docs also say a lifespan handler and event handlers cannot be combined: "It's all `lifespan` or all events, not both" ([Lifespan Events](https://fastapi.tiangolo.com/advanced/events/); [fastapi/applications.py](https://github.com/fastapi/fastapi/blob/master/fastapi/applications.py)). The official example stores resources in an untyped module-level dict. Starlette's docs, which FastAPI links to, describe a better pattern: **yield a `TypedDict` of state, and each request receives a shallow copy of it as `request.state`** ([Starlette Lifespan](https://starlette.dev/lifespan/)).

The catch is that Starlette's typed `Request[State]` is not usable in FastAPI signatures as of 0.142.2. FastAPI detects the request parameter with an `issubclass` check, which fails for a parameterised generic. An open PR (#14863) reports exactly the `FastAPIError` this produces ([fastapi/fastapi PR #14863](https://github.com/fastapi/fastapi/pull/14863); [fastapi/dependencies/utils.py](https://github.com/fastapi/fastapi/blob/master/fastapi/dependencies/utils.py)). Meanwhile, `request.state.<name>` returns `Any`. **Wrap each state item in a small dependency with an explicit return type.** Routes then receive a typed value, and tests can replace it through `dependency_overrides`.

Settings follow the same pattern. The official recipe is a `pydantic-settings` `BaseSettings` subclass with `SettingsConfigDict(env_file=".env")`. It is exposed through an **`@lru_cache` `get_settings()` dependency** so that the `.env` file is read once, and tests swap it out with `app.dependency_overrides[get_settings]` ([Settings and Environment Variables](https://fastapi.tiangolo.com/advanced/settings/)). Environment variables override dotenv values, and matching is case-insensitive by default ([Pydantic Settings](https://pydantic.dev/docs/validation/latest/concepts/pydantic_settings/)). **Under pyright strict, `Settings()` with a required field fails as a missing-argument call.** The pydantic maintainer says there is "no way afaik" to fix this in the type system. The issue is still open, and the workarounds discussed there are field defaults, `model_validate({})`, or a targeted ignore ([pydantic/pydantic-settings#201](https://github.com/pydantic/pydantic-settings/issues/201)). Of these, a targeted ignore on the single construction site is the only one that keeps both the runtime "fail fast if missing" check and strict checking everywhere else. The rule name `reportCallIssue` used below is an inference; confirm it against your pyright version. Secrets belong in `SecretStr` fields, which render as `**********` in repr, logs and JSON dumps until `.get_secret_value()` is called ([Pydantic types](https://pydantic.dev/docs/validation/latest/api/pydantic/types/)).

```python
# app/config.py
from datetime import timedelta
from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_", env_file=".env", extra="ignore")

    database_url: str                       # required: fail fast at startup
    jwt_secret: SecretStr                   # required, masked in logs and dumps
    jwt_issuer: str = "https://api.example.com"
    jwt_audience: str = "api.example.com"
    access_token_ttl: timedelta = timedelta(minutes=30)
    api_key_sha256: SecretStr               # digest of the service API key, never the raw key
    allowed_hosts: list[str] = ["api.example.com"]
    cors_origins: list[str] = []
    openapi_url: str = "/openapi.json"      # APP_OPENAPI_URL= (empty) disables docs

    @field_validator("cors_origins")
    @classmethod
    def no_wildcard_origin(cls, value: list[str]) -> list[str]:
        if "*" in value:
            raise ValueError("list explicit CORS origins; '*' is reflected with credentials")
        return value


@lru_cache
def get_settings() -> Settings:
    # Required fields are filled from the environment, which pyright cannot see
    # (pydantic-settings#201); silence exactly this call and nothing else.
    return Settings()  # pyright: ignore[reportCallIssue]


type SettingsDep = Annotated[Settings, Depends(get_settings)]
```

```python
# app/lifespan.py
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, TypedDict

import anyio.to_thread
import httpx
from fastapi import Depends, FastAPI, Request

THREADPOOL_TOKENS: int = 40  # Starlette's default; size together with the DB pool


class State(TypedDict):
    http_client: httpx.AsyncClient


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[State]:
    limiter = anyio.to_thread.current_default_thread_limiter()  # per event loop = per worker
    limiter.total_tokens = THREADPOOL_TOKENS
    async with httpx.AsyncClient(timeout=10.0) as client:
        yield {"http_client": client}                  # shallow-copied into request.state


def get_http_client(request: Request) -> httpx.AsyncClient:
    client: httpx.AsyncClient = request.state.http_client  # State.__getattr__ returns Any
    return client


type HttpClientDep = Annotated[httpx.AsyncClient, Depends(get_http_client)]
```

Two details here are unverified. First, it is not confirmed that pyright accepts an `AsyncIterator[State]` lifespan against FastAPI's `Lifespan[AppType]` parameter type. Second, setting the thread limiter inside the lifespan rests on AnyIO's per-loop design; neither the Starlette nor the FastAPI docs say where to set it. A related consequence follows from how `lru_cache` and `dependency_overrides` work, though neither doc states it. **Overrides affect only injected dependencies.** Code that calls `get_settings()` directly, such as the app factory or engine creation, needs `get_settings.cache_clear()` plus environment changes in tests.

The main divergence on configuration is the community guide's advice to split settings by domain and instantiate them at import time, as `auth_settings = AuthConfig()` with UPPER_CASE fields ([zhanymkanov/fastapi-best-practices](https://github.com/zhanymkanov/fastapi-best-practices)). Splitting by domain is compatible with the official pattern: give each settings class its own cached getter. Creating the instance at import time is not. It reads the environment during import, and the result can only be overridden by monkeypatching.

### Yield dependencies now clean up after the response is sent

The rules for `yield` dependencies have changed four times since 2023, so the current behaviour needs to be stated precisely. **With the default `scope="request"`, exit code runs after the response has been sent to the client.** 0.106.0 had moved it before the response. 0.118.0 moved it back, because a `StreamingResponse` could not use a database session that had already been closed. **Since 0.121.0, `Depends(dep, scope="function")` ends the dependency as soon as the path operation function returns, before the response is sent** ([Dependencies with yield](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/); [Advanced Dependencies](https://fastapi.tiangolo.com/advanced/advanced-dependencies/)). Three further rules apply. A request-scoped dependency's sub-dependencies must also be request-scoped, while a function-scoped dependency may depend on either scope. **A dependency that catches an exception must re-raise it** (mandatory since 0.110.0); if it doesn't, the client gets a 500 and "the server will not have any logs" of the cause. And yield dependencies should not be decorated with `@contextmanager`, because FastAPI wraps them itself ([Dependencies with yield](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/)).

The source shows a further detail the docs omit. For a sync (`def`) yield dependency, FastAPI runs `__enter__` through `run_in_threadpool` and `__exit__` through a separate `anyio.to_thread.run_sync` call with its own `CapacityLimiter(1)`. The source comment explains that the exit is kept off the shared limiter to avoid deadlocks against connection pools ([fastapi/concurrency.py](https://github.com/fastapi/fastapi/blob/master/fastapi/concurrency.py)). **Setup and teardown can therefore run on different OS threads**, so a sync yield dependency must never rely on `threading.local` state. Annotate yield dependencies as generators: `-> Iterator[T]` for sync and `-> AsyncIterator[T]` for async. This is standard generator typing; the FastAPI examples leave these returns unannotated.

## Return annotations now validate, filter, document and accelerate responses

The response-model page now tells readers to **annotate the path operation's return type**. FastAPI uses that annotation to validate the returned data ("it means that *your* app code is broken … it will return a server error"), to emit the JSON Schema, to serialize the response in Rust, and to "limit and filter the output data", which the docs call "particularly important for **security**" ([Response Model - Return Type](https://fastapi.tiangolo.com/tutorial/response-model/)). In 0.128.1 the docs switched to preferring return annotations over `response_model=` "when possible" ([release notes](https://fastapi.tiangolo.com/release-notes/)). The performance argument is new as of 2026. With a return type or response model, FastAPI serializes "directly to JSON … without using the `JSONResponse` class", using "the same underlying Rust mechanisms as `orjson`". Declaring a JSON `response_class` instead sends the data through `jsonable_encoder` and the stdlib `json` module ([Custom Response](https://fastapi.tiangolo.com/advanced/custom-response/)). The 0.130.0 release quoted a 2x or greater speed-up ([Release 0.130.0](https://github.com/fastapi/fastapi/releases/tag/0.130.0)), and 0.131.0 deprecated `ORJSONResponse` and `UJSONResponse` as redundant ([PR #14964](https://github.com/fastapi/fastapi/pull/14964)). One exception remains: exception handlers must return a `Response`, so error bodies cannot use the new path ([Discussion #14980](https://github.com/fastapi/fastapi/discussions/14980)).

`response_model=` remains for the case where the function returns something other than the declared schema, such as a dict or an ORM row. If both are set, `response_model` takes priority. For strict checkers, the docs suggest declaring the function's return type "as `Any`" ([Response Model](https://fastapi.tiangolo.com/tutorial/response-model/)). **Under pyright strict, avoid that escape hatch.** The general typing guidance reserves `Any` for what the type system cannot express. The honest alternative is an explicit `OutModel.model_validate(orm_obj)` with `from_attributes=True`, which keeps `-> OutModel` true for both the checker and FastAPI. The docs' inheritance trick also stays strict-clean. A function annotated `-> UserBase` may return a `UserIn` subclass, the checker accepts it, and FastAPI still strips the extra `password` field ([Response Model](https://fastapi.tiangolo.com/tutorial/response-model/)). Use **separate In/Out models built on a shared base**, as in the "Extra Models" page and the SQL tutorial's `HeroBase`/`HeroCreate`/`HeroPublic`/`HeroUpdate` set. Do not use `response_model_exclude`: the docs warn that the OpenAPI schema "will still be the one for the complete model" ([Extra Models](https://fastapi.tiangolo.com/tutorial/extra-models/); [SQL Databases](https://fastapi.tiangolo.com/tutorial/sql-databases/)). Routes that return a `Response` subclass can annotate it directly. A union such as `Response | dict[str, str]` needs `response_model=None` so that FastAPI does not try to build a model from it.

On the input side, the main post-2024 addition is **parameter models**. Since 0.115.0, a group of query, header or cookie parameters can be declared as one Pydantic model, `Annotated[Filter, Query()]`. With `extra="forbid"`, an unknown key returns a 422 `extra_forbidden` error ([Query Parameter Models](https://fastapi.tiangolo.com/tutorial/query-param-models/)). The docs show `extra="forbid"` on header models too ([Header Parameter Models](https://fastapi.tiangolo.com/tutorial/header-param-models/)). In practice, though, that rejects every header the model does not list, including `Host` and `User-Agent`. Header models should normally keep the default `"ignore"`; this is an inference from how Pydantic's `extra` works. Use `Literal[...]` for small closed sets that belong to one endpoint. Use an enum for shared vocabularies. The FastAPI tutorial still writes `class ModelName(str, Enum)` ([Path Parameters](https://fastapi.tiangolo.com/tutorial/path-params/)). Following docs.python.org, prefer **`StrEnum`**, whose `__format__` returns the value, which matters below for operation IDs ([enum](https://docs.python.org/3/library/enum.html)). Since 0.132.0, **FastAPI also rejects JSON bodies without a JSON `Content-Type`**. The stated reason is CSRF: a browser `fetch()` with no Content-Type skips the CORS preflight. The check can be disabled with `strict_content_type=False`, but should stay on ([Strict Content-Type Checking](https://fastapi.tiangolo.com/advanced/strict-content-type/)).

On wire naming, FastAPI takes no position on camelCase versus snake_case. It serializes response models by alias by default (`response_model_by_alias=True`), so a Pydantic `alias_generator=to_camel` works if a client needs camelCase ([APIRouter reference](https://fastapi.tiangolo.com/reference/apirouter/); [Pydantic Alias](https://pydantic.dev/docs/validation/latest/concepts/alias/)). snake_case needs no configuration and keeps OpenAPI field names identical to the Python names. Nothing official argues against it. The docs also have **no position on response envelopes** (`{"data": ..., "meta": ...}`). Their examples return resources and `list[Item]` directly.

```python
# app/projects/schemas.py
from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ProjectStatus(StrEnum):                      # docs show `str, Enum`; StrEnum per docs.python.org
    ACTIVE = "active"
    ARCHIVED = "archived"


class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    status: ProjectStatus = ProjectStatus.ACTIVE


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):                    # PATCH: every field optional
    name: str | None = Field(default=None, min_length=1, max_length=200)
    status: ProjectStatus | None = None


class ProjectOut(ProjectBase):
    model_config = ConfigDict(from_attributes=True)  # validate from ORM rows

    id: int
    created_at: datetime


class ProjectFilter(BaseModel):
    model_config = ConfigDict(extra="forbid")      # unknown query keys -> 422

    limit: int = Field(default=50, gt=0, le=100)
    offset: int = Field(default=0, ge=0)
    order_by: Literal["created_at", "name"] = "created_at"
    status: ProjectStatus | None = None
```

### Errors: raise `HTTPException`, handle Starlette's, redact 422s

The documented error model has five parts ([Handling Errors](https://fastapi.tiangolo.com/tutorial/handling-errors/)). Code **raises** `fastapi.HTTPException` rather than returning error responses; this works from helpers and dependencies too, and `detail` accepts any JSON-able value. Custom handlers are **registered against Starlette's `HTTPException`**, so they also catch errors raised inside Starlette. Overriding `RequestValidationError` reshapes 422s. The defaults in `fastapi.exception_handlers` can be reused when a handler only needs to add logging. And a `RequestValidationError` must **never be stringified into a response**, because it "contains the information of the file name and line" of the failure. Raising rather than returning keeps the route's return annotation honest. Document the error statuses separately with `responses={404: {"model": ErrorOut}}` ([Additional Responses](https://fastapi.tiangolo.com/advanced/additional-responses/)). FastAPI's default validation handler returns `exc.errors()`, which includes the submitted `input` values ([fastapi/exception_handlers.py](https://github.com/fastapi/fastapi/blob/master/fastapi/exception_handlers.py)). On a login or signup route, that echoes passwords back to the client. **This is a real divergence between official sources.** FastAPI's docs present returning the body as acceptable while developing. OWASP says to "respond with generic error messages" and never pass technical details to the client ([OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)). For a production API, take the OWASP side and strip `input` and `ctx`. If you change the 422 shape, the auto-generated `HTTPValidationError` schema no longer matches the responses, so document the new shape yourself. With the default `debug=False`, Starlette's `ServerErrorMiddleware` returns a plain 500 and **re-raises the exception so the server logs it** ([starlette/middleware/errors.py](https://github.com/encode/starlette/blob/main/starlette/middleware/errors.py)). A catch-all handler that also logs will therefore produce duplicate log entries.

Use the decorator form (`@app.exception_handler(DomainError)`) for handlers whose `exc` parameter is narrower than `Exception`. Starlette types `add_exception_handler` handlers as taking `Exception`, so registering a narrower handler that way can fail strict checking. This comes from Starlette's typing and was not verified by a pyright run.

```python
# app/errors.py
import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

logger: logging.Logger = logging.getLogger(__name__)


class ErrorOut(BaseModel):
    detail: str


NOT_FOUND: dict[int | str, dict[str, Any]] = {404: {"model": ErrorOut, "description": "Not found"}}


class ConflictError(Exception):
    """Raised by services when a write conflicts with existing state."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message: str = message


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ConflictError)
    async def conflict(request: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": exc.message})  # curated text only

    @app.exception_handler(StarletteHTTPException)  # catches FastAPI's and Starlette's
    async def http_error(request: Request, exc: StarletteHTTPException) -> Response:
        logger.info("HTTP %d on %s %s", exc.status_code, request.method, request.url.path)
        return await http_exception_handler(request, exc)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        redacted: list[dict[str, Any]] = [   # drop "input"/"ctx": they can echo secrets
            {"loc": err["loc"], "msg": err["msg"], "type": err["type"]} for err in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": redacted})

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Path only: query strings can carry tokens. Starlette re-raises afterwards.
        logger.error("unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
        return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})
```

For OpenAPI, the generated-clients page recommends a custom **`generate_unique_id_function`**, typed `(route: APIRoute) -> str`, that returns `f"{route.tags[0]}-{route.name}"`. The default IDs are verbose names such as `createItemItemsPost` ([Generating SDKs](https://fastapi.tiangolo.com/advanced/generate-clients/)). That scheme requires every function name to be unique "even across different modules" ([Path Operation Advanced Configuration](https://fastapi.tiangolo.com/advanced/path-operation-advanced-configuration/)). Keep `separate_input_output_schemas` at its default of `True`. It gives the most accurate generated clients, at the cost of `-Input`/`-Output` suffixes on schema names ([Separate OpenAPI Schemas](https://fastapi.tiangolo.com/how-to/separate-openapi-schemas/)). Docstrings become operation descriptions, and a `\f` truncates what OpenAPI shows. Use enum tags in large apps ([Path Operation Configuration](https://fastapi.tiangolo.com/tutorial/path-operation-configuration/)).

## Plain `def` plus a session dependency is still the documented database path

FastAPI's concurrency rule is short. Declare a route `async def` only if everything it waits on is awaitable. Use plain `def` for libraries without `await` support, which includes most database drivers. **"If you just don't know, use normal `def`."** Sync routes and sync dependencies run in a threadpool ([Concurrency and async/await](https://fastapi.tiangolo.com/async/)). Starlette documents that pool as **40 tokens per event loop**, which means per worker process. Sync endpoints, sync background tasks, `FileResponse` and `UploadFile` all share it. The pool can be resized through AnyIO's default limiter, with a warning about memory cost ([Starlette Thread Pool](https://starlette.dev/threadpool/)).

The bug to guard against is **blocking inside `async def`**. A sync `session.execute()`, a `requests.get()` or an Argon2 hash inside an `async def` route stalls every request on that worker. The concurrency page implies this rule but does not state it as a sentence. In an `async def` context, offload blocking work with `await run_in_threadpool(fn, *args)` from `fastapi.concurrency`. In a codebase built on sync SQLAlchemy, **every route and dependency that touches the session should be `def`**. An `async def` route that receives a session from a `def` dependency still runs that route's queries on the event loop. And size the database pool with the threadpool in mind: 40 concurrent sync handlers, each holding a session, will queue on a pool smaller than that.

The official SQL tutorial uses SQLModel with sync `def` routes, a `get_session` yield dependency and `SessionDep = Annotated[Session, Depends(get_session)]`, and **commits inside the route** ([SQL Databases](https://fastapi.tiangolo.com/tutorial/sql-databases/)). The same tutorial still creates tables in a deprecated `@app.on_event("startup")` handler. That is an internal inconsistency in the docs; use `lifespan` instead. In production, run Alembic migrations as a step before the app starts, as the tutorial itself advises, never `create_all`. SQLAlchemy's guidance pulls in a slightly different direction. It says to keep "the lifecycle of the session separate and external" from data-access code, to use `with session.begin():` to mark transaction boundaries, and it calls `expire_on_commit=False` "usually a good idea". It also states the threading rule "Session per thread, AsyncSession per task" ([SQLAlchemy Session Basics](https://docs.sqlalchemy.org/en/20/orm/session_basics.html)). The tutorial has no async-database section, and no official page either recommends or warns against `AsyncSession`. Moving to async is a codebase-wide change, justified only by concurrency needs that the threadpool cannot meet.

**Where commits live is a genuine choice between two official positions**, and the exit-after-response semantics shape it:

| | A: commit in the route or service (FastAPI tutorial) | B: transaction in the dependency (SQLAlchemy's "external lifecycle") |
|---|---|---|
| Dependency | `with factory() as s: yield s` (default request scope) | `with factory.begin() as s: yield s` **with `scope="function"`** |
| Commit failure | Raised inside the route → 500 before any response | With `scope="function"`, raised before the response; **with the default scope, raised after the client already has a 2xx** |
| Discipline required | Every write path must remember `commit()` | None per route; rollback on exception is automatic |
| Streaming/SSE that reads the DB lazily | Works (the session stays open until the response is sent) | Breaks, because the session closes when the function returns |
| Connection hold time | Until the response is fully sent | Released before the response is sent, which helps pool pressure |
| Scope constraint | None | A request-scoped yield dependency cannot depend on it |

Option A matches the docs' examples and keeps the transaction visible where the business logic is. Option B removes a whole class of forgotten-commit bugs, but it needs `scope="function"` everywhere and a separate request-scoped session for streaming endpoints. Either is defensible. What is not defensible is option B with the default scope, because a failed commit can then no longer change the status code.

```python
# app/db.py
from collections.abc import Iterator
from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    engine = create_engine(get_settings().database_url, pool_pre_ping=True)
    return sessionmaker(engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """Option A: the route or service commits; this only closes (after the response)."""
    with get_session_factory()() as session:
        yield session


def get_tx_session() -> Iterator[Session]:
    """Option B: commit on success, roll back on exception."""
    with get_session_factory().begin() as session:
        yield session


type SessionDep = Annotated[Session, Depends(get_session)]
type TxSessionDep = Annotated[Session, Depends(get_tx_session, scope="function")]  # before the response
```

```python
# app/projects/models.py
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.projects.schemas import ProjectStatus


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[ProjectStatus]
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

```python
# app/projects/router.py
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionDep
from app.errors import NOT_FOUND
from app.projects.models import Project
from app.projects.schemas import ProjectCreate, ProjectFilter, ProjectOut, ProjectUpdate
from app.security import ProjectReader, ProjectWriter
from app.users.models import User

router: APIRouter = APIRouter(prefix="/projects", tags=["projects"])


def _owned_project(session: Session, project_id: int, user: User) -> Project:
    project = session.get(Project, project_id)
    if project is None or project.owner_id != user.id:  # object-level check (OWASP API1)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.get("")
def list_projects(
    filters: Annotated[ProjectFilter, Query()],
    session: SessionDep,
    user: ProjectReader,
) -> list[ProjectOut]:
    order_col = Project.created_at if filters.order_by == "created_at" else Project.name
    stmt = (
        select(Project)
        .where(Project.owner_id == user.id)
        .order_by(order_col)
        .limit(filters.limit)
        .offset(filters.offset)
    )
    if filters.status is not None:
        stmt = stmt.where(Project.status == filters.status)
    return [ProjectOut.model_validate(p) for p in session.scalars(stmt)]


@router.get("/{project_id}", responses=NOT_FOUND)
def get_project(
    project_id: Annotated[int, Path(ge=1)], session: SessionDep, user: ProjectReader
) -> ProjectOut:
    return ProjectOut.model_validate(_owned_project(session, project_id, user))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, session: SessionDep, user: ProjectWriter) -> ProjectOut:
    project = Project(name=body.name, status=body.status, owner_id=user.id)
    session.add(project)
    session.commit()            # option A: commit before returning, so failures become 500s
    session.refresh(project)    # load server defaults such as created_at
    return ProjectOut.model_validate(project)


@router.patch("/{project_id}", responses=NOT_FOUND)
def update_project(
    project_id: Annotated[int, Path(ge=1)],
    body: ProjectUpdate,
    session: SessionDep,
    user: ProjectWriter,
) -> ProjectOut:
    project = _owned_project(session, project_id, user)
    for field, value in body.model_dump(exclude_unset=True).items():  # tutorial's PATCH pattern
        setattr(project, field, value)
    session.commit()
    return ProjectOut.model_validate(project)
```

`BackgroundTasks` is officially meant for small jobs that run in the same process after the response, such as notification emails. For heavy or multi-server work, the docs point to Celery-class tools with a broker ([Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/)). The yield-dependency history page adds the rule that matters most here. **A background task must open its own resources, such as a new database session, and should receive IDs rather than ORM objects** ([Advanced Dependencies](https://fastapi.tiangolo.com/advanced/advanced-dependencies/)). The docs do not specify how request-scope teardown is ordered relative to background tasks.

**The official docs give no guidance on scheduled jobs.** The third-party fastapi-crons (2.5.0, August 2026) already runs plain `def` jobs through `asyncio.to_thread`, so wrapping them by hand is redundant. That call uses asyncio's default executor, not the AnyIO limiter ([fastapi-crons](https://pypi.org/project/fastapi-crons/); [asyncio.to_thread](https://docs.python.org/3/library/asyncio-task.html#asyncio.to_thread)). Every worker process runs its own scheduler, so **with more than one worker or replica each job fires once per process unless the library's distributed locking is enabled** (`CRON_ENABLE_DISTRIBUTED_LOCKING=true` plus a Redis or SQLAlchemy backend). Its dashboard "ships with no authentication of its own" ([fastapi-crons](https://pypi.org/project/fastapi-crons/)). Running the scheduler as a separate process or as a platform cron is an alternative that fits the Docker docs' one-process-per-container model, but no official page prescribes it.

**Streaming gained first-class support in 2026.** Since 0.135.0, a route declared with `response_class=EventSourceResponse` and `-> AsyncIterable[T]` (or `def ... -> Iterable[T]`) yields typed items. FastAPI JSON-encodes each one and adds 15-second keep-alives, `Cache-Control: no-cache` and `X-Accel-Buffering: no` ([Server-Sent Events](https://fastapi.tiangolo.com/tutorial/server-sent-events/)). The return annotation is therefore both FastAPI's encoding hint and fully strict-typed. `StreamingResponse` remains the tool for raw bytes ([Custom Response](https://fastapi.tiangolo.com/advanced/custom-response/)).

## Security defaults moved to PyJWT, Argon2 and 401, and OWASP asks for more

The official OAuth2/JWT tutorial changed libraries twice ([release notes](https://fastapi.tiangolo.com/release-notes/); [OAuth2 with JWT](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)). In 0.111.1 it moved to **PyJWT** after community complaints that python-jose was "nearly abandoned". In 0.118.0 it moved to **pwdlib with Argon2**, because passlib depends on the `crypt` module, which was removed in Python 3.13, and because Argon2 is memory-hard and resists GPU attacks ([PR #13917](https://github.com/fastapi/fastapi/pull/13917)). In 0.129.1 the tutorial added a defence against username enumeration by timing: **when the user does not exist, it still verifies the password against a precomputed `DUMMY_HASH`** so that both failure paths take "roughly the same amount of time". It returns one message, "Incorrect username or password", for both ([OAuth2 with JWT](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)). Since 0.122.0, all built-in security classes (`HTTPBearer`, `APIKeyHeader`, `OAuth2PasswordBearer` and the rest) return **401 with a `WWW-Authenticate` header** when credentials are missing, per RFC 7235 and RFC 9110. A how-to page explains how to restore the old 403 behaviour ([Authentication error status code](https://fastapi.tiangolo.com/how-to/authentication-error-status-code/)). `Security` is a subclass of `Depends` with one extra parameter, `scopes`. FastAPI merges the scopes it collects into `SecurityScopes` for the dependency and documents them in OpenAPI ([OAuth2 scopes](https://fastapi.tiangolo.com/advanced/security/oauth2-scopes/)).

The tutorial is a teaching example, and production code diverges from it in four places. First, **insufficient scope**: the scopes example returns **401** "Not enough permissions", whereas OWASP reserves 401 for missing or wrong credentials and uses **403** when an authenticated user lacks permission ([OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)). Use 403. Second, **requested scopes**: the docs copy whatever scopes the client requests straight into the token "for simplicity" ([OAuth2 scopes](https://fastapi.tiangolo.com/advanced/security/oauth2-scopes/)). That invites broken function-level authorization (OWASP API5:2023), so intersect the request with what the user is allowed ([OWASP API Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)). Third, **claims**: the tutorial pins `algorithms=[...]`, which defeats `alg` confusion, but does not verify `iss` or `aud`, while OWASP calls for checking `iss`, `aud`, `exp` and `nbf` and for rejecting `alg: none` ([OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)). Fourth, **secrets**: the tutorial hard-codes `SECRET_KEY` and suggests generating one with `openssl rand -hex 32`; production code loads it from settings as a `SecretStr`.

The docs themselves describe the password flow as suited to "our own application, probably with our own frontend". For third-party providers they call the code flow "the most secure" ([OAuth2 scopes](https://fastapi.tiangolo.com/advanced/security/oauth2-scopes/)). Two further typing rules apply. **Argon2 verification is CPU-bound**, so the login route should be `def`, not the tutorial's `async def`; this follows from the concurrency rule above. And `jwt.decode` returns `dict[str, Any]`, so validate the claims into a Pydantic model rather than calling `payload.get("sub")`.

For shared secrets, the HTTP Basic page sets the pattern. It compares UTF-8 **bytes** with `secrets.compare_digest`, evaluates both comparisons before branching, and explains that `==` "stops early when characters don't match" ([HTTP Basic Auth](https://fastapi.tiangolo.com/advanced/security/http-basic-auth/); [secrets.compare_digest](https://docs.python.org/3/library/secrets.html#secrets.compare_digest)). Comparing fixed-length SHA-256 digests also hides the key's length and keeps raw API keys out of config. OWASP warns that API keys alone "are relatively easy to compromise" ([OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)).

```python
# app/security.py
import hashlib
import secrets
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Annotated, Final, Literal

import jwt
from fastapi import APIRouter, Depends, HTTPException, Security, status
from fastapi.security import (
    APIKeyHeader,
    OAuth2PasswordBearer,
    OAuth2PasswordRequestForm,
    SecurityScopes,
)
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, SettingsDep
from app.db import SessionDep
from app.users.models import User

password_hash: Final[PasswordHash] = PasswordHash.recommended()   # Argon2id
DUMMY_HASH: Final[str] = password_hash.hash("dummypassword")
ROLE_SCOPES: Final[dict[str, frozenset[str]]] = {
    "viewer": frozenset({"projects:read"}),
    "editor": frozenset({"projects:read", "projects:write"}),
}
oauth2_scheme: Final[OAuth2PasswordBearer] = OAuth2PasswordBearer(
    tokenUrl="auth/token",
    scopes={"projects:read": "Read projects.", "projects:write": "Modify projects."},
)
router: APIRouter = APIRouter(prefix="/auth", tags=["auth"])


class Token(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"


class TokenClaims(BaseModel):
    sub: str
    scope: str = ""
    exp: datetime
    iss: str
    aud: str


def authenticate(session: Session, email: str, password: str) -> User | None:
    user = session.scalars(select(User).where(User.email == email)).one_or_none()
    if user is None:
        password_hash.verify(password, DUMMY_HASH)     # equalise timing (docs, 0.129.1+)
        return None
    return user if password_hash.verify(password, user.hashed_password) else None


def create_access_token(*, subject: str, scopes: Sequence[str], settings: Settings) -> str:
    now = datetime.now(UTC)
    claims: dict[str, object] = {
        "sub": subject,
        "scope": " ".join(scopes),
        "iat": now,
        "exp": now + settings.access_token_ttl,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    return jwt.encode(claims, settings.jwt_secret.get_secret_value(), algorithm="HS256")


def get_current_user(
    security_scopes: SecurityScopes,
    token: Annotated[str, Depends(oauth2_scheme)],
    settings: SettingsDep,
    session: SessionDep,
) -> User:
    challenge = f'Bearer scope="{security_scopes.scope_str}"' if security_scopes.scopes else "Bearer"
    unauthenticated = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": challenge},
    )
    try:
        raw = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],                      # never trust the header's alg
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "sub", "iss", "aud"]},
        )
        claims = TokenClaims.model_validate(raw)       # dict[str, Any] -> typed claims
    except (InvalidTokenError, ValidationError):
        raise unauthenticated from None
    user = session.scalars(select(User).where(User.email == claims.sub)).one_or_none()
    if user is None or user.disabled:
        raise unauthenticated
    if not set(claims.scope.split()).issuperset(security_scopes.scopes):
        raise HTTPException(                           # docs use 401; OWASP: 403
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
            headers={"WWW-Authenticate": challenge},
        )
    return user


type CurrentUser = Annotated[User, Security(get_current_user)]
type ProjectReader = Annotated[User, Security(get_current_user, scopes=["projects:read"])]
type ProjectWriter = Annotated[User, Security(get_current_user, scopes=["projects:write"])]


@router.post("/token")
def login(  # def, not async def: Argon2 verification is CPU-bound
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: SessionDep,
    settings: SettingsDep,
) -> Token:
    user = authenticate(session, form.username, form.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",   # one message for both failures
            headers={"WWW-Authenticate": "Bearer"},
        )
    allowed = ROLE_SCOPES.get(user.role, frozenset())
    granted = [scope for scope in form.scopes if scope in allowed]  # never trust requested scopes
    return Token(access_token=create_access_token(subject=user.email, scopes=granted, settings=settings))


api_key_header: Final[APIKeyHeader] = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_api_key(
    api_key: Annotated[str | None, Security(api_key_header)], settings: SettingsDep
) -> None:
    supplied = hashlib.sha256((api_key or "").encode("utf-8")).hexdigest().encode("utf-8")
    expected = settings.api_key_sha256.get_secret_value().encode("utf-8")  # store a digest
    if api_key is None or not secrets.compare_digest(supplied, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "APIKey"},     # FastAPI's own APIKey challenge
        )
```

(`User` is an ORM model with `id`, `email`, `hashed_password`, `role` and `disabled` columns.)

**For HTTP-level protections, Starlette's code is looser than FastAPI's docs.** The CORS page says none of `allow_origins`, `allow_methods` or `allow_headers` "can be set to `['*']` if `allow_credentials` is set to `True`" ([FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/)). Starlette's `CORSMiddleware` does not reject that configuration. With `allow_origins=["*"]` and `allow_credentials=True`, it **reflects whatever Origin the request sent, together with `Access-Control-Allow-Credentials: true`** ([starlette/middleware/cors.py](https://github.com/encode/starlette/blob/main/starlette/middleware/cors.py)). The intended "nothing with credentials" becomes "anyone, with cookies". This is why the `Settings` validator above rejects `"*"`. `TrustedHostMiddleware` returns 400 for unlisted `Host` headers and defaults to `www_redirect=True`, which APIs should normally turn off. Neither FastAPI nor Starlette ships a security-headers middleware ([Starlette Middleware](https://starlette.dev/middleware/)). OWASP's API list is `Cache-Control: no-store`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and HSTS ([OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)).

**Body size limits are new in 2026.** Starlette 1.6.0 (August 2026) added `RequestBodyLimitMiddleware`, which returns **413 Content Too Large**. It checks `Content-Length` and also counts the bytes actually received, so an understated header cannot bypass it ([Starlette Middleware](https://starlette.dev/middleware/); [Starlette release notes](https://www.starlette.io/release-notes/)). FastAPI 0.142.2 does not yet expose `max_body_size`, and its Starlette floor is 0.46, which is why the `pyproject.toml` above pins `starlette>=1.6`. Pydantic constraints bound the *parsed* data and the middleware bounds the *raw bytes*; both are needed, because FastAPI reads the whole JSON body before it validates anything. **Rate limiting is still not built in.** slowapi (0.1.10, June 2026) is the usual library, but it requires a `request: Request` parameter on every limited route and warns that its API may change ([slowapi](https://pypi.org/project/slowapi/)). Limiting at a proxy or gateway avoids both the signature intrusion and the shared-proxy-IP problem.

**Hiding `/docs` is the clearest docs-versus-OWASP disagreement.** FastAPI says hiding the docs UIs "shouldn't be the way to protect your API" and calls it "security through obscurity". It still shows how to disable them with an `openapi_url` setting ([Conditional OpenAPI](https://fastapi.tiangolo.com/how-to/conditional-openapi/)). OWASP's API9:2023 treats an exposed API inventory as attack surface ([OWASP API Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)). The two positions are compatible: disable public docs as defence in depth, and never mistake that for access control.

Browser-facing apps need two more cautions. **Starlette's `SessionMiddleware` cookie is signed, not encrypted**, so clients can read its contents; `https_only` is off by default, and the docs say to set it to `True` in production ([starlette/middleware/sessions.py](https://github.com/encode/starlette/blob/main/starlette/middleware/sessions.py)). And **FastAPI ships no CSRF middleware**. The strict Content-Type check covers only JSON, so cookie-authenticated form endpoints still need SameSite cookies plus a token. The common third-party option is fastapi-csrf-protect (1.0.7, double-submit cookie), whose README hard-codes a secret that should not be copied ([fastapi-csrf-protect](https://pypi.org/project/fastapi-csrf-protect/)). APIs that authenticate with bearer tokens in the `Authorization` header are not exposed to CSRF in the same way, because browsers do not attach that header automatically.

## Pure ASGI middleware and `fastapi run` replace older production recipes

`@app.middleware("http")` is still the documented quick form ([Middleware](https://fastapi.tiangolo.com/tutorial/middleware/)). Starlette, however, warns that `BaseHTTPMiddleware`, which the decorator form is built on, "will prevent changes to contextvars from propagating upwards". It recommends **pure ASGI middleware** typed with `ASGIApp`, `Scope`, `Receive` and `Send` ([Starlette Middleware](https://starlette.dev/middleware/)). Starlette 1.7.0 also had to fix `BaseHTTPMiddleware` running background tasks before the response was sent ([Starlette release notes](https://www.starlette.io/release-notes/)). The function form is fine for adding a header. Anything that sets request IDs or tracing context, or that sits in front of streaming or SSE, should be pure ASGI. Ordering trips people up: **each `add_middleware` call wraps the existing stack, so the last one added is the outermost** ([Middleware](https://fastapi.tiangolo.com/tutorial/middleware/)). Starlette's `add_middleware` is ParamSpec-typed, so pyright checks the keyword arguments passed to each middleware class ([starlette/applications.py](https://github.com/encode/starlette/blob/main/starlette/applications.py)). GZip compresses only responses of at least 500 bytes by default and skips `text/event-stream` ([Advanced Middleware](https://fastapi.tiangolo.com/advanced/middleware/)). `ServerErrorMiddleware` always sits outside user middleware, so unhandled 500s can lack CORS headers. For that reason Starlette suggests wrapping the entire app in `CORSMiddleware` when the 500s must carry them ([Starlette Middleware](https://starlette.dev/middleware/)).

```python
# app/middleware.py
from collections.abc import Mapping
from typing import Final

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

SECURITY_HEADERS: Final[Mapping[str, str]] = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
}


class SecurityHeadersMiddleware:
    """Pure ASGI: contextvars propagate and streaming is untouched."""

    def __init__(self, app: ASGIApp) -> None:
        self.app: ASGIApp = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":                    # pass websockets/lifespan through
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)
```

```python
# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.routing import APIRoute
from starlette.middleware.body_limit import RequestBodyLimitMiddleware  # starlette >= 1.6

from app.config import get_settings
from app.errors import install_exception_handlers
from app.lifespan import lifespan
from app.middleware import SecurityHeadersMiddleware
from app.projects.router import router as projects_router
from app.security import router as auth_router


def generate_operation_id(route: APIRoute) -> str:
    if not route.tags:                                 # fail loudly: clients need stable IDs
        raise RuntimeError(f"route {route.path} has no tags")
    return f"{route.tags[0]}-{route.name}"             # StrEnum tags format as their value


def create_app() -> FastAPI:
    settings = get_settings()                          # app-shape config is read once, here
    app = FastAPI(
        title="Projects API",
        lifespan=lifespan,
        openapi_url=settings.openapi_url or None,      # defence in depth, not access control
        generate_unique_id_function=generate_operation_id,
    )
    app.include_router(auth_router)
    app.include_router(projects_router)
    install_exception_handlers(app)
    # First added = innermost; last added = outermost.
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestBodyLimitMiddleware, max_body_size=1024 * 1024)  # 413 above 1 MiB
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts, www_redirect=False)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,           # explicit list, validated in Settings
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    return app


app: FastAPI = create_app()
```

The factory has a concrete payoff. Configuration that shapes the app itself, such as middleware, the docs URL and CORS, cannot be swapped through `dependency_overrides`. Tests that need different values can call `create_app()` again instead of reloading modules.

**Deployment advice has moved away from Gunicorn.** FastAPI's Server Workers page shows only `fastapi run --workers 4` and `uvicorn --workers 4`. It says that on Kubernetes you "will probably not want to use workers" and should instead run "a single Uvicorn process per container" ([Server Workers](https://fastapi.tiangolo.com/deployment/server-workers/)). The maintainer prefers Uvicorn's own workers because they mean "fewer moving parts" ([fastapi/fastapi PR #11855](https://github.com/fastapi/fastapi/pull/11855)). Uvicorn deprecated **`uvicorn.workers` in 0.30.0 (May 2024)**. Anyone who keeps Gunicorn should install the separate `uvicorn-worker` package ([Uvicorn Deployment](https://uvicorn.dev/deployment/)). Since then, Uvicorn's own supervisor has gained worker health checks, max-requests jitter and one-at-a-time restarts on `SIGHUP` (0.51.0, July 2026) ([Uvicorn release notes](https://uvicorn.dev/release-notes/)). That removes most of the remaining operational reasons for Gunicorn. The Docker page names `tiangolo/uvicorn-gunicorn-fastapi` as deprecated. It requires an **exec-form `CMD`** so that shutdown signals and lifespan work, and it puts migrations in a separate pre-start step or init container ([FastAPI Docker](https://fastapi.tiangolo.com/deployment/docker/)). Uvicorn trusts `X-Forwarded-*` headers only from `127.0.0.1` and `::1` unless `--forwarded-allow-ips` is set. FastAPI says `"*"` is appropriate only when "only that proxy communicates with" the server, and Uvicorn warns that over-trusting lets clients spoof their address ([Behind a Proxy](https://fastapi.tiangolo.com/advanced/behind-a-proxy/); [Uvicorn settings](https://uvicorn.dev/settings/)). No official page gives a formula for the number of workers. Remember that every worker has its own 40-token threadpool, its own database pool, its own lifespan and its own scheduler.

```dockerfile
FROM python:3.14-slim
WORKDIR /code
COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt
COPY ./app /code/app
# Orchestrated (Kubernetes): one process per container; replicas scale out.
CMD ["fastapi", "run", "app/main.py", "--port", "80", "--proxy-headers", "--forwarded-allow-ips", "10.0.0.0/8"]
# Single host / Compose: add "--workers", "4".
```

## Tests stay synchronous, override dependencies, and roll back a real database

The testing tutorial uses **plain `def` tests with `fastapi.testclient.TestClient`**, "so you can use `pytest` directly without complications" ([Testing](https://fastapi.tiangolo.com/tutorial/testing/)). Three client behaviours matter. **Lifespan runs only when the client is used in a `with` block** ([Testing Events](https://fastapi.tiangolo.com/advanced/testing-events/)), so without `with`, lifespan state such as the HTTP client above never exists. By default the client re-raises unhandled app exceptions inside the test, and `raise_server_exceptions=False` returns the 500 body instead ([Starlette TestClient](https://starlette.dev/testclient/)). The default `base_url` is `http://testserver`; an `https://` base URL makes `Secure` cookies round-trip, and a real host keeps `TrustedHostMiddleware` satisfied.

Override dependencies with `app.dependency_overrides[original] = replacement`. The key is the exact callable passed to `Depends`, which for `get_settings` means the `lru_cache` wrapper ([Testing Dependencies](https://fastapi.tiangolo.com/advanced/testing-dependencies/)). The official FastAPI example sets overrides at module level, while the SQLModel guide sets them in a fixture and calls `.clear()` afterwards ([SQLModel tests](https://sqlmodel.tiangolo.com/tutorial/fastapi/tests/)). Fixture teardown is safer than either. Restoring per key, rather than calling `.clear()`, stops one fixture from wiping another's overrides; this is an inference. `dependency_overrides` is typed at the value level as `Callable[..., Any]`, so pyright will accept a replacement that returns the wrong type. Write replacements as small named functions with return annotations.

**For databases, the FastAPI ecosystem's two official recipes serve different goals.** The SQLModel guide uses in-memory SQLite with `check_same_thread=False` and `StaticPool`, because the test client touches the database from other threads ([SQLModel tests](https://sqlmodel.tiangolo.com/tutorial/fastapi/tests/)). SQLAlchemy's documented test-suite recipe instead binds a `Session` to an outer transaction with `join_transaction_mode="create_savepoint"`. Everything the session does, "including calls to commit()", is rolled back at the end ([SQLAlchemy 2.1 session transactions](https://docs.sqlalchemy.org/en/21/orm/session_transaction.html)). SQLite cannot exercise PostgreSQL behaviour such as JSONB, `ON CONFLICT` or enum types, so **the savepoint recipe against a real PostgreSQL database is the higher-fidelity choice**. The savepoint mode is what lets option-A routes call `commit()` inside a test. Code that opens its own session, such as a background task, sees none of the test's data and is not rolled back. Route it through the overridden dependency or patch it.

```python
# tests/conftest.py
import os
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Connection, Engine, create_engine
from sqlalchemy.orm import Session

from app.db import get_session
from app.main import create_app
from app.security import get_current_user
from app.users.models import User


@pytest.fixture(scope="session")
def db_engine() -> Iterator[Engine]:
    engine = create_engine(os.environ["TEST_DATABASE_URL"])  # schema migrated beforehand
    yield engine
    engine.dispose()


@pytest.fixture
def db_connection(db_engine: Engine) -> Iterator[Connection]:
    with db_engine.connect() as connection:
        transaction = connection.begin()
        try:
            yield connection
        finally:
            transaction.rollback()                  # undoes everything, commits included


@pytest.fixture
def db_session(db_connection: Connection) -> Iterator[Session]:
    with Session(bind=db_connection, join_transaction_mode="create_savepoint") as session:
        yield session


@pytest.fixture
def owner(db_session: Session) -> User:
    user = User(email="ada@example.com", hashed_password="x", role="editor", disabled=False)
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture(scope="session")
def app() -> FastAPI:
    return create_app()


@pytest.fixture
def client(app: FastAPI, db_session: Session, owner: User) -> Iterator[TestClient]:
    def session_override() -> Session:
        return db_session

    def user_override() -> User:
        return owner

    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[get_current_user] = user_override
    try:
        with TestClient(app, base_url="https://api.example.com") as test_client:  # runs lifespan
            yield test_client
    finally:
        app.dependency_overrides.pop(get_session, None)    # per key, not .clear()
        app.dependency_overrides.pop(get_current_user, None)
```

```python
# tests/test_projects.py
from fastapi.testclient import TestClient

from app.projects.schemas import ProjectOut, ProjectStatus


def test_create_project_returns_201(client: TestClient) -> None:
    response = client.post("/projects", json={"name": "Roadmap"})
    assert response.status_code == 201
    project = ProjectOut.model_validate(response.json())  # typed, not dict[str, Any]
    assert project.status is ProjectStatus.ACTIVE


def test_unknown_filter_key_is_rejected(client: TestClient) -> None:
    response = client.get("/projects", params={"colour": "red"})
    assert response.status_code == 422
    assert [err["loc"] for err in response.json()["detail"]] == [["query", "colour"]]


def test_missing_project_returns_404(client: TestClient) -> None:
    response = client.get("/projects/999999")
    assert response.status_code == 404
    assert response.json() == {"detail": "Project not found"}
```

Assert on `loc` and `type` in 422 bodies, never on `msg` text. The handling-errors page still shows the Pydantic v1 code `type_error.integer` in its example output ([Handling Errors](https://fastapi.tiangolo.com/tutorial/handling-errors/)), so copy assertions from real responses, not from the docs. **Async tests are officially reserved for tests that must themselves `await`**, such as checking writes through an async database driver. They use `httpx.AsyncClient(transport=ASGITransport(app=app))` with `@pytest.mark.anyio`. That client does not run lifespan, so the docs point to `asgi-lifespan`'s `LifespanManager` ([Async Tests](https://fastapi.tiangolo.com/advanced/async-tests/)). AnyIO's pytest plugin conflicts with pytest-asyncio's auto mode, so choose one ([AnyIO testing](https://anyio.readthedocs.io/en/stable/testing.html)). pytest 9 makes async tests without a plugin fail instead of warn, and adds a native `[tool.pytest]` table with a single `strict = true` switch ([pytest changelog](https://docs.pytest.org/en/stable/changelog.html)). Annotate yield fixtures `-> Iterator[T]` or `-> AsyncIterator[T]`, and every test `-> None`. Use `pytest.MonkeyPatch` and `pytest_mock.MockerFixture` for the built-in fixture types. Prefer dependency overrides to `mocker.patch` for anything reachable through `Depends`, because overrides need no import-path strings.

## Where community guides, tools and the house standard diverge

The table collects every divergence found, with the position this report takes.

| Topic | Official position | Divergent source | Resolution |
|---|---|---|---|
| Dependency declaration | `Annotated[T, Depends(dep)]`, shared aliases | zhanymkanov and fastapi-csrf-protect README use `= Depends()` | `Annotated` via `type` aliases next to the provider |
| Settings | `@lru_cache` getter injected as a dependency | zhanymkanov: module-level per-domain instances | One cached getter per settings class |
| Response declaration | Return annotation; `response_model` only when types differ | zhanymkanov: `response_model=` with untyped returns; its `jsonable_encoder` pipeline description predates 0.130 | Return annotation plus explicit `model_validate`; avoid the docs' own `-> Any` escape hatch |
| JSON speed | Pydantic Rust serializer (0.130+) | Older blogs: `ORJSONResponse` | Drop custom JSON response classes |
| Project layout | By role (`routers/`, `dependencies.py`) | zhanymkanov: by domain package | Either; domain packages scale better in large monoliths |
| Enum style | `class X(str, Enum)` | docs.python.org: `StrEnum` (3.11+) | `StrEnum` |
| Missing-credential status | 401 + `WWW-Authenticate` (0.122+) | Code written before 0.122 relies on 403 | 401; restore 403 only via the documented how-to |
| Insufficient scope | Docs example: 401 | OWASP: 403 | 403 |
| Validation error bodies | Echoing the body is acceptable while developing | OWASP: generic messages | Strip `input`/`ctx` in production |
| `/docs` exposure | Hiding it is obscurity | OWASP API9: inventory is attack surface | Disable publicly as defence in depth |
| CORS wildcard + credentials | Docs: not allowed | Starlette code: reflects the Origin | Reject `*` in settings validation |
| Startup hooks | Lifespan page: `lifespan` only | SQL tutorial still uses `on_event` | `lifespan` |
| Middleware | `@app.middleware("http")` documented | Starlette: prefer pure ASGI | Pure ASGI for context and streaming; the function form for trivial headers |
| Process model | `fastapi run --workers N`, or one process per container | Older guides and images: Gunicorn + `uvicorn.workers` (deprecated) | Uvicorn workers; `uvicorn-worker` package only if Gunicorn must stay |
| Test transport | FastAPI docs: `httpx` | Starlette 1.2+: supports and type-checks against `httpx2` | Stay on `httpx` until FastAPI's docs move |
| DB tests | SQLModel: SQLite + `StaticPool` | SQLAlchemy: savepoint on a real DB | Real PostgreSQL with `create_savepoint` |
| Scheduled jobs | No guidance | fastapi-crons | Distributed locking, or a separate process |

Sources: as cited in the sections above; [Starlette release notes](https://starlette.dev/release-notes/) for the `httpx2` support.

The same evidence also bears on the current house FastAPI standard (sync routes, sync SQLAlchemy, Gunicorn, fastapi-crons, a `TestClient` fixture). Most of it holds, and four items need action.

| Current standard | Verdict |
|---|---|
| Sync `def` routes with sync SQLAlchemy 2.0 | **Still the documented path** ("if you just don't know, use normal `def`") |
| `Session` from a `yield` dependency | **Matches the tutorial.** If the dependency commits or rolls back in teardown, it **must** use `scope="function"`, or move the commit into routes (option A) |
| Gunicorn + `uvicorn.workers.UvicornWorker` | **Deprecated since Uvicorn 0.30.0.** Move to `fastapi run --workers N`, or one process per container |
| `@app.middleware("http")` | Acceptable for simple headers; pure ASGI for anything that sets contextvars |
| fastapi-crons with manual `asyncio.to_thread` wrappers | Wrappers are redundant. Enable distributed locking whenever there are multiple workers or replicas |
| `TestClient(app, base_url="https://app.dev")` without `with` | Lifespan never runs. Make that an explicit decision, or wrap the client in `with` |
| Overrides plus a real PostgreSQL rollback per test | Matches SQLAlchemy's recipe. Require `join_transaction_mode="create_savepoint"` |
| snake_case JSON | No official stance against it, and it needs no alias configuration |

## Conclusion

The main change since 2024 is that **FastAPI now rewards annotation directly**. The return type became the serialization fast path, `type` aliases became first-class dependency declarations, and the remaining untyped corners became visible. Those corners are now concentrated in three places: the `Any` returned by `Depends`, the `Any` in `request.state`, and pydantic-settings' constructor. A strict codebase should treat each one as a deliberate boundary with exactly one typed adapter: a provider-adjacent alias, a state accessor dependency, and a single ignored `Settings()` call. Spreading ignores and `Any` returns across the routes is the failure mode to avoid. The docs do not frame it this way, but that framing turns "pyright strict with FastAPI" from an aspiration into a small, auditable list of exceptions.

The second takeaway is that **timing semantics, not syntax, is now where FastAPI bugs live**. Exit-after-response teardown, function-scoped dependencies, background tasks that outlive the request session, a 40-token threadpool per worker, and per-worker schedulers all describe *when* code runs relative to the response and to other processes. None of it shows up in type signatures. A standard therefore needs explicit rules for these: which scope a transactional session uses, which process owns cron jobs, and how the threadpool and DB pool are sized together. Finally, because FastAPI is still 0.x, shipped seven releases marked breaking between December 2025 and June 2026, and documents itself only against mypy, the minor-version pin and a CI pyright run over the examples in this report are prerequisites for adopting any of it, not optional extras.
