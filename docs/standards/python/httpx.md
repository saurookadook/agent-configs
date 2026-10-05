# httpx Standards

Applies to outbound HTTP calls (API clients and page fetchers in `services/`) and to the
in-process HTTP client used in API tests. Scraping-specific fetch rules are in
[beautiful-soup.md](beautiful-soup.md); test fixtures are in [pytest.md](pytest.md).

**Stack:** `httpx` (the transport under Starlette's `TestClient`, and the client for new
outbound modules) and `requests` (the client in existing outbound modules, mocked with
`requests-mock`).

---

## Choosing the client

**HTTPX-1 — One HTTP library per module, and httpx for new modules.** The reference
backends call every upstream with `requests`, and their tests mock it with
`requests-mock`; those modules MAY stay on `requests`. A new client module SHOULD use
httpx: it has the same synchronous API, a default timeout, and an async client for
`async def` code. A module never mixes the two. Moving a module to httpx is one PR that
also moves its tests from `requests-mock` to httpx mocking (HTTPX-11).

Everything below applies to both libraries; examples use httpx.

---

## Client modules

**HTTPX-2 — Talk to each upstream from exactly one module** (`services/<upstream>.py`,
PY-34) whose docstring says what the upstream is, which currency, units, or defaults it
assumes, and how it fails. The module owns the base URL, headers, timeout, and error
wrapping; it exposes one keyword-only function per endpoint and routes them through
private `_get` / `_post` / `_send` helpers:

```python
"""The one place the Tasks API is spoken to.

Each function returns the decoded body untouched. Reshaping a
response is the caller's job; this module's only opinion is that a
failed call raises ``TasksAPIError`` rather than returning something
falsy.
"""

BASE_URL = "https://api.tasks.example.com"
REQUEST_TIMEOUT = httpx.Timeout(30.0, connect=5.0)  # seconds


def get_project_summary(*, external_id: str, months: int = 12) -> dict[str, Any]:
    return _get(f"/projects/{external_id}/summary", {"months": months})


def search_tasks(*, external_id: str, offset: int, page_size: int = 10) -> dict[str, Any]:
    """Search a project's tasks, one page at a time.

    ``offset`` counts records, not pages: pass
    ``page_index * page_size``.
    """
    return _post(
        "/tasks/search",
        {"project": external_id, "pagination": {"offset": offset, "page_size": page_size}},
    )
```

**HTTPX-3 — Every request has a timeout,** set from a module constant. httpx defaults to
five seconds and `requests` to none, so always pass it explicitly. Use an
`httpx.Timeout` with a short connect timeout and a longer read timeout for slow
endpoints.

**HTTPX-4 — Check the status, decode, and wrap every failure in the module's own error**
(PY-20), naming the URL. Catch decode errors separately so a malformed body is not
reported as a transport failure:

```python
def _send(method: str, path: str, **kwargs: Any) -> dict[str, Any]:
    url = f"{BASE_URL}{path}"
    try:
        response = _client().request(method, path, headers=_headers(), **kwargs)
        response.raise_for_status()
        return response.json()
    except json.JSONDecodeError as exc:
        raise TasksAPIError(f"Tasks API returned a malformed body for '{url}': {exc}") from exc
    except httpx.HTTPError as exc:
        raise TasksAPIError(f"Tasks API request to '{url}' failed: {exc}") from exc
```

In httpx, `response.json()` raises the standard library `json.JSONDecodeError`, and
`HTTPStatusError` (4xx/5xx) and `RequestError` (connect, timeout, protocol) both
subclass `httpx.HTTPError`. In `requests`, `requests.exceptions.JSONDecodeError`
subclasses `RequestException`, so it MUST be caught first.

**HTTPX-5 — Return the decoded body, or raise.** Never return `None`, `{}`, or `[]` for a
failed call, which a caller can mistake for an empty result. A caller that can carry on
without the data catches the module's error, logs it, and decides.

**HTTPX-6 — Pass query strings with `params=` and bodies with `json=`.** Do not build
query strings by hand (`f"{URL}?base=USD&date={day}"`), and never put a secret (a client
secret, a token) in a URL, where proxies and logs record it; send it in a header or a
form body.

**HTTPX-7 — Build headers per call from configuration** (PY-27), so the current API key
is used:

```python
def _headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "x-api-key": EnvVarManager().env_vars.tasks_api_key.get_secret_value(),
    }
```

Log the method and path of each call at `info`, and parameters only when they contain no
secrets or personal data. Never log headers or tokens.

**HTTPX-8 — Reuse one client per upstream, from a private `_client()` function,** so
connections are pooled and tests have one seam to replace (HTTPX-11):

```python
@functools.cache
def _client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=REQUEST_TIMEOUT)


def close() -> None:
    """Close the pooled client (called by the lifespan on shutdown)."""
    if _client.cache_info().currsize:
        _client().close()
        _client.cache_clear()
```

Never mutate the shared client after creating it (pass per-call headers to `request`), so
the threads FastAPI runs `def` routes on can share it. A one-off script MAY use
`with httpx.Client(...) as client:` instead.

**HTTPX-9 — Use `httpx.AsyncClient` only from `async def` code, and the sync client only
from `def` code** (fastapi.md FAPI-8). A cron job that wraps a sync handler in
`asyncio.to_thread` uses the sync client.

**HTTPX-10 — Do not retry metered or non-idempotent calls automatically.** A retry on a
paid API spends money, and a retried `POST` can write twice. For a free, idempotent
endpoint, retries MAY be enabled for connection failures only with
`httpx.HTTPTransport(retries=2)`.

---

## Testing outbound calls

**HTTPX-11 — Tests never reach a real upstream.**

- `requests` modules are tested with the `http_requests_mock` fixture (pytest.md
  PYTEST-15).
- httpx modules are tested by patching their `_client()` (HTTPX-8) to return a client
  built on `httpx.MockTransport`:

```python
def test_wraps_server_errors(mocker: MockerFixture) -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(503, json={}))
    mocker.patch(
        "services.tasks_api._client",
        return_value=httpx.Client(transport=transport, base_url=tasks_api.BASE_URL),
    )

    with pytest.raises(TasksAPIError, match="failed"):
        tasks_api.get_project_summary(external_id="p-1")
```

The `respx` library MAY replace `MockTransport` if many tests need route matching; add it
to the dev group in its own PR.

**HTTPX-12 — Assert on what was sent, not only on what came back:** the query
(`parse_qs(request.url.query)`), the JSON body, and the authentication header, plus one
test per failure class (each 4xx/5xx status, a malformed body, a connect timeout) that
expects the module's error.

---

## API tests with `TestClient`

**HTTPX-13 — `TestClient` is an httpx client.** Create it with a `base_url` whose host is
in the app's trusted hosts (fastapi.md FAPI-17): `TestClient(app,
base_url="https://app.dev")`. Use it as a context manager when the test needs the
lifespan to run. Send bodies with `json=`, query strings with `params=`, and read
`result.status_code`, `result.json()`, and `result.headers` from the returned
`httpx.Response`. Fixture details are in pytest.md PYTEST-14.
