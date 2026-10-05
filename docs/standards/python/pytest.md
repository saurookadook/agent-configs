# pytest Standards

Applies to every test in a Python backend: model and facade tests, service tests, route
tests, and cron handler tests. What each layer must test is in the layer's own document
(SQLA-28, FAPI-20, SOUP-14, HTTPX-11, NLTK-12).

---

## Tools

**PYTEST-1 — Use this stack, all in the `dev` dependency group:**

| Library         | Use                                                                    |
| --------------- | ---------------------------------------------------------------------- |
| `pytest`        | runner and assertions                                                  |
| `pytest-mock`   | the `mocker` fixture, for patching at boundaries (PYTEST-17)           |
| `pytest-sugar`  | readable progress output                                               |
| `pytest-xdist`  | parallel runs with `-n` (PYTEST-21)                                    |
| `pytest-cov`    | coverage in CI (PYTEST-22)                                             |
| `factory-boy`   | test data for SQLAlchemy models and Pydantic entities (PYTEST-11)      |
| `requests-mock` | intercepting `requests` calls (PYTEST-15)                              |
| `httpx`         | the transport under `TestClient` (PYTEST-14), and httpx mocking (HTTPX-11) |

`pytest-watch` MAY be used locally for watch mode. Do not add `unittest.mock` imports
where `mocker` works, and do not add `freezegun`-style libraries without a standards
change (PYTEST-18).

**PYTEST-2 — Configure pytest in `pytest.ini` (local) and `pytest.ci.ini` (CI),** and
declare required plugins so a missing plugin fails fast:

```ini
[pytest]
addopts = -ra
          -vvv
          --color=yes
          --code-highlight=yes
          -s
log_cli = true
log_cli_level = NOTSET
norecursedirs = .*
python_files = test_*.py test.py
strict = true
required_plugins = pytest-mock>=3.14.0,<4.0.0
                   pytest-sugar>=1.0.0,<2.0.0
                   pytest-xdist>=3.5.0,<4.0.0
```

`strict = true` (pytest 9) turns unknown markers, unknown configuration keys, and
unexpectedly passing `xfail` tests into failures. The CI file drops `-vvv` and live logging and adds coverage (PYTEST-22). Every option a
CI flag needs (`--cov`) MUST come from a plugin in the dev group, or the run fails at
startup.

**PYTEST-3 — Run tests with:**

```sh
uv run pytest                                        # everything
uv run pytest models/_tests/project/test_facade.py   # one file
uv run pytest -k "test_get_one_by_id_no_result"      # by name
./scripts/admin.sh test backend                       # in the test container, as CI does
```

---

## Layout

**PYTEST-4 — Tests live in a `_tests/` package inside the package they test,** mirroring
its structure:

```txt
api/_tests/routes/test_routes_<resources>.py
api/_tests/routes/handlers/test_routes_handlers_<resources>.py
api/_tests/crons/test_handle_<job>.py
models/_tests/conftest.py                      entity fixtures (PYTEST-9)
models/_tests/<entity>/test_db.py              the mapping round-trips
models/_tests/<entity>/test_entity.py          validators and helpers
models/_tests/<entity>/test_facade.py          every facade method
services/_tests/conftest.py
services/_tests/test_<module>.py
```

**PYTEST-5 — Every test directory has an `__init__.py`.** Test file names repeat across
entities (`test_db.py`, `test_facade.py`); without packages, pytest cannot import two
modules with the same basename.

**PYTEST-6 — Shared test support lives in top-level packages that production code never
imports:**

| Package                       | Holds                                                              |
| ----------------------------- | ------------------------------------------------------------------ |
| `_factories/<entity>/db.py`   | `<Entity>DBFactory` (PYTEST-11)                                    |
| `_factories/<entity>/entity.py` | `<Entity>EntityFactory` (PYTEST-12)                              |
| `_factories/mixins/`, `base_meta.py` | timestamp factory mixins, the typed factory metaclass       |
| `_mocks/temporal.py`          | fixed instants: `get_mock_utcnow()` and named dates (PYTEST-18)    |
| `_fixtures/html/`             | saved pages, gzipped (PYTEST-16)                                   |
| `_research/` (repo root)      | captured upstream API responses, as JSON (PYTEST-16)               |

---

## Writing tests

**PYTEST-7 — Name tests as sentences about behaviour, grouped in classes by unit:**

```python
class TestProjectFacade:
    def test_get_one_by_id(
        self,
        project_facade: ProjectFacade,
        project_record: ProjectDB,
        expected_project_dict: dict[str, Any],
    ) -> None: ...

    def test_get_one_by_id_no_result(self, project_facade: ProjectFacade) -> None: ...


class TestCreateProjectFromTemplate:
    def test_copies_the_template_tasks(
        self, test_app_client: TestClient, template_record: ProjectDB
    ) -> None: ...

    def test_resubmitting_the_same_template_updates_in_place(self, ...) -> None: ...
```

Test classes (`Test<Unit>`, `Test<Unit><Aspect>`) have no `__init__` and no state; put
setup in fixtures, which MAY be defined on the class when only that class uses them.
Facade tests name each test after the method (`test_<method>`,
`test_<method>_<case>`).

**PYTEST-8 — Give a test a docstring when the expected value needs a reason** (why this
number, why this status code, which upstream quirk it pins down). Keep each test to one
behaviour: arrange, act, then assert, without branching.

**PYTEST-9 — Organize fixtures by reach:**

| File                          | Fixtures                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------- |
| root `conftest.py`            | environment setup, `test_db_session`, `test_app_client`, `http_requests_mock`, `mock_utcnow`, saved pages and captures |
| `<package>/_tests/conftest.py`| data for that layer (`expected_project_dict`, `project_record`)              |
| the test module or class      | fixtures only that module or class uses                                      |

Pair a literal dict with the record built from it, so tests can compare against known
values:

```python
@pytest.fixture
def expected_project_dict(owner_record: UserDB) -> dict[str, Any]:
    return dict(
        id=UUID("44cf56a4-1f14-4a08-915f-dc40b7ef657e"),
        name="Test Project",
        owner_id=owner_record.id,
        status="active",
        tags=["alpha", "beta"],
    )


@pytest.fixture
def project_record(
    expected_project_dict: dict[str, Any], test_db_session: Session
) -> ProjectDB:
    project = ProjectDBFactory(**expected_project_dict)
    test_db_session.commit()
    return project
```

A fixture that tests need to vary returns a function (`override_next_data(html,
**overrides)`). A fixture's scope is never wider than the fixtures it uses; `session`
scope is for immutable data loaded from disk.

---

## Database

**PYTEST-10 — Tests run against a real PostgreSQL test database, migrated once and rolled
back after every test:**

```python
# conftest.py
os.environ["DATABASE_NAME"] = "test_app"
EnvVarManager().reload()  # the frozen EnvVars is re-validated, never assigned to


def pytest_sessionstart(session: pytest.Session) -> None:
    alembic_config = config.Config(os.path.join(os.path.abspath("."), "alembic.ini"))
    command.upgrade(alembic_config, "head")


@pytest.fixture(autouse=True)
def test_db_session() -> Iterator[Session]:
    db_session_manager = DBSessionManager()
    scoped = db_session_manager.scoped_session

    with db_session_manager.engine.connect() as db_connection:
        with db_connection.begin() as transaction:
            yield scoped(bind=db_connection, join_transaction_mode="create_savepoint")
            transaction.rollback()
    scoped.remove()
```

- The test database name is set before any module reads configuration, at the top of the
  root `conftest.py`, and `EnvVarManager().reload()` re-validates the configuration in
  case an import already read it (pydantic.md PYD-15).
- The session is bound to a connection inside an outer transaction, so
  `test_db_session.commit()` in a test makes rows visible to later queries in that test
  without persisting them.
- `join_transaction_mode="create_savepoint"` (SQLAlchemy's documented test-suite recipe)
  turns each commit and rollback made by the code under test, including a route's own
  commit and the session dependency's rollback (fastapi.md FAPI-9), into a savepoint, so
  the test's outer transaction and its fixture rows survive until the final rollback.
- Factories write through the same `scoped_session` (PYTEST-11), which is why they land
  in the test's transaction.
- Never truncate tables, call `create_all`, or mock the session.

---

## factory-boy

**PYTEST-11 — Each SQLAlchemy model has `<Entity>DBFactory` in
`_factories/<entity>/db.py`:**

```python
# pyright: reportIncompatibleVariableOverride=false
class ProjectDBFactory(
    TimestampsDBMixinFactory,
    factory.alchemy.SQLAlchemyModelFactory,
    metaclass=BaseMetaFactory[ProjectDB],
):
    class Meta:
        model = ProjectDB
        sqlalchemy_session = DBSessionManager().scoped_session

    id = factory.LazyFunction(uuid7)
    external_id = factory.Sequence(lambda n: n + 1)
    description = factory.Faker("text")
    name = factory.Faker("sentence", nb_words=3)
    owner_id = None  # a real foreign key: pass an existing user's id
    status = "active"
    tags = factory.List([factory.Faker("word"), factory.Faker("word")])
```

- `metaclass=BaseMetaFactory[ProjectDB]` makes `ProjectDBFactory(...)` type as
  `ProjectDB`.
- `TimestampsDBMixinFactory` sets `created_at` and `updated_at` to `get_mock_utcnow()`.
- Unique columns use `factory.Sequence`; IDs use `factory.LazyFunction(uuid7)`, matching the time-ordered IDs the database
  generates (PG-3).
- Fields derived from other fields use `factory.LazyAttribute`.
- After creating records, call `test_db_session.commit()` before querying.

**PYTEST-12 — Each Pydantic entity used as test input or expected output has
`<Entity>EntityFactory(factory.Factory)` in `_factories/<entity>/entity.py`**, with the
same field definitions. Build a database row from an entity with
`ProjectDBFactory(**entity.model_dump(exclude={"tasks"}))` when a test needs both.

**PYTEST-13 — Factory defaults must produce valid rows on their own,** except for
foreign keys:

- Never default a foreign key to a random UUID; the insert fails. Default it to `None`
  when the column is nullable, or leave it to the test to pass a real parent's ID.
- Bound Faker values to the domain (`factory.Faker("random_int", min=1, max=10)`,
  `factory.Faker("pyfloat", positive=True, min_value=1, max_value=5, right_digits=1)`).
- Values a test asserts on are passed explicitly, not read back from Faker.

---

## API tests

**PYTEST-14 — Test routes through the `test_app_client` fixture,** which overrides the
database dependency with the test session:

```python
@pytest.fixture
def test_app_client(test_db_session: Session) -> TestClient:
    app.dependency_overrides[api_db_session] = lambda: test_db_session
    return TestClient(app, base_url="https://app.dev")
```

Assert the status code first, using `fastapi.status` constants, then the body under
`["data"]`. When the behaviour under test is about what was stored (an upsert, a count),
also query the database directly:

```python
def test_resubmitting_the_same_url_updates_in_place(
    self, test_app_client: TestClient, test_db_session: Session
) -> None:
    first = test_app_client.post("/api/projects", json={"source_url": SOURCE_URL})
    second = test_app_client.post("/api/projects", json={"source_url": SOURCE_URL})

    assert first.status_code == status.HTTP_201_CREATED
    assert first.json()["data"]["id"] == second.json()["data"]["id"]
    assert test_db_session.execute(
        select(func.count()).select_from(ProjectDB).where(ProjectDB.source_url == SOURCE_URL)
    ).scalar_one() == 1
```

Cover each status code a route can return (FAPI-13), including the 500 path by making a
collaborator raise with `mocker.patch(..., side_effect=RuntimeError(...))`.

---

## HTTP mocking

**PYTEST-15 — Intercept `requests` with the `http_requests_mock` fixture, with real HTTP
turned off:**

```python
@pytest.fixture
def http_requests_mock() -> Iterator[requests_mock.Mocker]:
    with requests_mock.Mocker(real_http=False) as mock:
        yield mock
```

`real_http=False` makes any unregistered call fail instead of reaching the network (and a
paid API). Register responses in the test or in a named fixture
(`tasks_api_summary_mock`), and assert on what was sent:

```python
mocked = http_requests_mock.get(SUMMARY_URL, json=captured_summary)

tasks_api.get_project_summary(external_id="p-1", months=6)

assert parse_qs(mocked.last_request.query) == {"months": ["6"]}
assert mocked.last_request.headers["x-api-key"]
```

Simulate failures with `status_code=503`, `text="not json"`, and
`exc=requests.exceptions.ConnectTimeout`. When the response depends on the request, pass
a callback as `json=` that reads `request.qs` and sets `context.status_code`.

**PYTEST-16 — Use real captured data for upstream responses and pages.** Save API
responses as JSON under `_research/<endpoint>/` and pages as gzipped HTML under
`_fixtures/html/`, and load them in session-scoped fixtures whose docstrings say where
the data came from and how files are keyed. Hand-written payloads are for edge cases the
captures do not cover.

---

## Mocks and time

**PYTEST-17 — Patch only at boundaries, with `mocker`,** patch the name where it is
looked up, and pass `autospec=True` so a call with the wrong signature fails the way it
would in production (the `unittest.mock` docs, "Where to patch" and "Autospeccing"):

```python
mocker.patch(
    "api.routes.exchange_rate.resolve_rate", autospec=True, return_value=None
)
```

Prefer real collaborators: the test database over a mocked facade, `requests-mock` over a
mocked client function. Mock to inject a failure or to stand in for something the test
cannot control.

**PYTEST-18 — Use the fixed instants in `_mocks/temporal.py`** (`get_mock_utcnow()` is
`2026-04-20T11:15:00Z`) for factory timestamps and expected values, through the
`mock_utcnow` fixture. To control "now" inside code under test, prefer passing the time
in (PY-25); otherwise patch the `datetime` name in the module under test
(`mocker.patch("services.billing.datetime")`). Patching `datetime.datetime` globally does
not affect modules that ran `from datetime import datetime`.

---

## Parametrize and assertions

**PYTEST-19 — Use `@pytest.mark.parametrize` for cases of one behaviour,** with comments
grouping the cases and boundary values on both sides of every threshold:

```python
@pytest.mark.parametrize(
    "value, expected",
    [
        # whole numbers lose the trailing `.0`
        (36.0, "36"),
        (90, "90"),
        # never scientific notation
        (1e-07, "0.0000001"),
    ],
)
def test_matches_postgis_rendering(self, value: float, expected: str) -> None: ...


@pytest.mark.parametrize("status_code", [400, 404, 429, 500, 503])
def test_http_errors_raise_tasks_api_error(
    self, http_requests_mock: requests_mock.Mocker, status_code: int
) -> None: ...
```

**PYTEST-20 — Assert with plain `assert`,** and:

- compare floats with `pytest.approx(expected, rel=1e-6)`
- expect errors with `pytest.raises(Error, match="part of the message")`; expect a
  Pydantic `ValidationError` by its error `type` (`string_too_short`,
  `extra_forbidden`), not its message, which changes between Pydantic versions
- compare Pydantic models with `==` or `model_dump()`
- sort both sides by a key before comparing lists whose order is not part of the contract
- compare timestamps as aware datetimes or ISO strings, never as naive values

---

## Parallel runs and CI

**PYTEST-21 — `pytest-xdist` MAY run the suite in parallel (`-n auto`).** Each worker has
its own connection and rolled-back transaction, but each worker also runs
`pytest_sessionstart`; migrate the test database once (`alembic upgrade head`) before a
parallel run so workers do not race to apply the same migration.

**PYTEST-22 — CI runs the suite in the test container with `pytest -c pytest.ci.ini`**,
reporting coverage with `--cov=. --cov-report=term-missing` (excluding `_tests`,
`_factories`, `_mocks`, and `.venv` in the coverage configuration). The test image copies
both ini files and installs the dev group.

---

## Types

**PYTEST-23 — Type tests, fixtures, and test support like production code** (PY-18):

- Every test returns `-> None`.
- A fixture is annotated with what it provides. A `yield` fixture returns `Iterator[T]`
  (`Iterator[Session]`, `Iterator[requests_mock.Mocker]`), and a fixture that returns a
  function is annotated with `Callable[...]`.
- pytest's own fixtures use their public types: `mocker: MockerFixture` (from
  `pytest_mock`), `monkeypatch: pytest.MonkeyPatch`, `tmp_path: Path`,
  `request: pytest.FixtureRequest`, `caplog: pytest.LogCaptureFixture`.
- Parametrized arguments take the type of their values.

pyright checks `_tests/`, `_factories/`, `_mocks/`, and every `conftest.py` with the
same strict settings as application code (PY-9). A factory module built on a library
without type information MAY turn off the specific `reportUnknown…` rules it triggers
in a file-level `# pyright:` comment, the way PYTEST-11's factory turns off
`reportIncompatibleVariableOverride` (PY-10). Test docstrings follow PYTEST-8, not PY-29.
