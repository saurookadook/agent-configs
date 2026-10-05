# Pydantic Standards

Applies to every Pydantic model: domain entities in `models/`, request and response
models in `api/models/`, value objects in `services/`, and the settings model in
`config/`. How entities are loaded is in [sqlalchemy.md](sqlalchemy.md); how routes use
request and response models is in [fastapi.md](fastapi.md).

**Stack:** Pydantic 2.13 (`pydantic>=2.13.5,<2.14`), checked by pyright strict. pyright
understands a model only through PEP 681 `dataclass_transform`: it builds `__init__` from
the fields, sees `default`, `default_factory`, and `alias` only in assignment form, and
sees `frozen` only as a class keyword. Constraints, validators, `ConfigDict`, and alias
generators work at runtime only. The evidence behind these rules is in
[Pydantic best practices](../../research/python/pydantic-best-practices.md); where sources
disagree they follow Pydantic's and Python's official documentation.

---

## Version

**PYD-1 — Use the Pydantic 2 API only:**

| Use                                    | Not (Pydantic 1)                     |
| -------------------------------------- | ------------------------------------ |
| `model_config = ConfigDict(...)`       | `class Config:`                      |
| `Model.model_validate(obj)`            | `Model.parse_obj(obj)`, `from_orm`   |
| `instance.model_dump()`                | `instance.dict()`                    |
| `instance.model_dump(mode="json")`     | `instance.json()` then `json.loads`  |
| a typed `with_*` method (PYD-10)       | `instance.copy(update=...)`          |
| `validate_by_name` + `validate_by_alias` | `populate_by_name` (deprecated in V3) |
| `@field_validator` / `@model_validator`| `@validator` / `@root_validator`     |

---

## Where models live

**PYD-2 — Each kind of model has one home and one base class:**

| Kind              | File                                 | Base                                 | Name                          |
| ----------------- | ------------------------------------ | ------------------------------------ | ----------------------------- |
| domain entity     | `models/<entity>/entity.py`          | `BaseEntityModel` (+ mixins)         | `ProjectEntity`               |
| narrow read model | `models/<entity>/entity.py`          | `BaseEntityModel`                    | `NewestProjectEntity`         |
| request body      | `api/models/<resource>.py`           | `BaseModel`                          | `ProjectCreateRequest`        |
| response envelope | `api/models/<resource>.py`           | `BaseResponseModel`                  | `ProjectResponse`             |
| value object      | the `services/` module that uses it  | `BaseModel`, `frozen=True` (PYD-10)  | `ProjectScenario`             |
| settings          | `config/env_vars.py`                 | `BaseModel`, `frozen=True` (PYD-15)  | `EnvVars`                     |

```python
# models/base/entity.py
class BaseEntityModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID


# models/mixins/entity.py
class TimestampsEntityMixin(BaseModel):
    created_at: AwareDatetime
    updated_at: AwareDatetime


# models/project/entity.py
class ProjectEntity(BaseEntityModel, TimestampsEntityMixin):
    description: str | None = None
    name: str
    owner_id: UUID
    status: str
    tags: list[str] = Field(default_factory=list[str])

    tasks: list[TaskEntity] = Field(default_factory=list[TaskEntity])
```

---

## Entities

**PYD-3 — An entity mirrors its SQLAlchemy model**: the same field names, in the same
order (alphabetical columns, then relationships; SQLA-6), with types matching nullability
(`X | None = None` for a nullable column). Facades build entities with
`ProjectEntity.model_validate(orm_row_or_mapping)`; `from_attributes=True` on
`BaseEntityModel` makes that work for ORM objects and row mappings alike. Pydantic reads
every declared field from the ORM object, relationships included, and relationships are
`lazy="raise"` (sqlalchemy.md SQLA-10), so an unloaded one fails validation with
`get_attribute_error`. An entity that declares a relationship field therefore either has
the PYD-8 before-validator or is only validated from rows whose facade eager-loads it
(SQLA-22), and its tests include one row loaded without the relationship.

**PYD-4 — Define a narrow read model when a caller needs a fraction of an entity or
fields from a join,** and say in its docstring why the full entity is wrong for it
(payload size, an N+1 it would cause, fields from another table). Mark joined fields with
a comment naming their source table.

```python
class ProjectCardEntity(BaseEntityModel):
    """Just enough of a project to render one card in a list.

    Deliberately not ``ProjectEntity``: the list renders no
    descriptions or tasks, and loading ``tasks`` for fifty cards
    would add fifty queries.
    """

    name: str
    status: str
    # ----- from `users`
    owner_name: str
```

---

## Fields

**PYD-5 — Declare fields by what they accept, with every default in assignment form:**

- required: no default (`name: str`)
- nullable: `X | None = None`; `X | None` with no default when the client must send the
  key, even as `null`
- collections: `Field(default_factory=list[str])`, with the factory parametrised: pyright
  strict infers `list[Unknown]` from a bare `list` for some element types. Never a
  literal `[]` default.
- a fixed default: the literal (`status: str = "active"`)
- a point in time: `AwareDatetime`, which rejects naive values (PY-24)
- an enum: the `StrEnum` itself; keep `use_enum_values` off, so the attribute matches its
  annotation (JSON output already uses the value)

pyright reads a default only from `= value` or `= Field(default=..., default_factory=...)`.
`Annotated[T, Field(default=...)]` and a positional `Field("x")` both make it treat the
field as required.

Do not use `Annotated[str | None, Field(default_factory=lambda: "")]` plus a validator
to turn `None` into a default. If `None` is not a valid value, the field is not
`X | None`; if it is, the default is `None`.

**PYD-6 — Put numeric and length constraints in the annotation,** not in a validator:
`down_payment_pct: Annotated[float, Field(ge=0, le=100)]`. Keep defaults outside the
`Annotated` (PYD-5). A constrained type used by several models is a `type` alias in
`utils/pydantic_types.py` (`type Percentage = Annotated[float, Field(ge=0, le=100)]`);
such an alias becomes a named `$defs` entry in the OpenAPI schema, and it holds only
type-level metadata, never an `alias` or a default. Say in a comment why a bound is
inclusive when that is a business decision ("100% down is allowed and means no loan").

---

## Validators

**PYD-7 — Prefer after validators, which are type-safe; use a `mode="before"` field
validator only to coerce raw input** into the field's type (a coordinate pair into a WKT
string, a string into a date). Never use `mode="plain"`, which skips type validation.
Stack `@classmethod` under every `@field_validator`, and never name a validator after a
`BaseModel` method (`from_orm`, `copy`). In a before validator:

- Type the raw input as `object`, which Python's typing docs prescribe for a value of any
  type; Pydantic's own examples use `Any`, which switches checking off.
- Narrow it with a `match` statement: class patterns type the elements, whereas
  `isinstance(value, (list, tuple))` leaves them unknown to pyright strict.
- Pass `json_schema_input_type` so the request schema documents what the validator
  accepts.
- Raise `ValueError` with a message that names the field and the accepted shapes.

```python
@field_validator(
    "location", mode="before", json_schema_input_type=str | tuple[float, float]
)
@classmethod
def parse_location(cls, value: object) -> object:
    """Accept a WKT string or a (lat, lng) pair."""
    match value:
        case str():
            return value
        case [int() | float() | Decimal() as lat, int() | float() | Decimal() as lng]:
            return f"POINT({format_wkt_coordinate(lng)} {format_wkt_coordinate(lat)})"
        case _:
            raise ValueError(
                "'location' must be a WKT POINT string like 'POINT(lng lat)'"
                " or a (lat, lng) pair"
            )
```

**PYD-8 — Use `@model_validator(mode="after")` for rules across fields**, as an instance
method annotated `-> Self` (`from typing import Self`) and returning `self`; a classmethod
after-validator is deprecated since 2.12. Use `@model_validator(mode="before")` on
`@classmethod`, taking `data: object`, to reshape raw input before field validation: filling a field from another one, or turning an ORM object into a dict that
includes relationships. A `mode="before"` validator handles both dicts and ORM objects
and passes through anything else unchanged. Relationships are `lazy="raise"`
(sqlalchemy.md SQLA-10), so it copies only the loaded ones: skip any name in
`sqlalchemy.inspect(obj).unloaded`.

**PYD-9 — A validator's error message tells the client how to fix the request:** which
fields are missing or conflicting and what to send instead. It never repeats the
submitted value or names internals (a class, a file, a SQL fragment): the message reaches
the client through the 422 handler (fastapi.md FAPI-23). Elsewhere, a `ValidationError`
that reaches a client is converted with
`exc.errors(include_input=False, include_context=False, include_url=False)`.
`hide_input_in_errors=True` only hides input when the error is printed, so it protects
logs, not responses.

```python
raise ValueError(
    f"Manual entry requires all of [{', '.join(MANUAL_FIELDS)}] - missing "
    f"[{', '.join(missing)}]. Omit them all to import from 'source_url' instead."
)
```

---

## Value objects

**PYD-10 — Make calculation inputs frozen value objects, declared with the class
keyword:** `class ProjectScenario(BaseModel, frozen=True):` with
`model_config = ConfigDict(validate_default=True)`. pyright reads `frozen` only from the
class keyword, so assigning to a field becomes a type error instead of a runtime
`ValidationError`. It also applies dataclass rules: every ancestor up to `BaseModel` and
every subclass of a frozen model repeats `frozen=True`, so a value object never inherits
from a mutable base. Frozen is shallow, so collection fields are `tuple[...]` or
`frozenset[...]`. `validate_default=True` checks default constants against the field
bounds too, so a bad edit to a default fails loudly. Because a frozen model cannot assign
in an `after` validator, derive defaults from other fields in a `mode="before"` validator.

Build a variant through a typed method that revalidates. `model_copy(update=...)` does
not validate its updates, and its `update` mapping accepts any key:

```python
def with_annual_revenue(self, revenue: Decimal) -> Self:
    """Return a revalidated copy with a new ``annual_revenue``."""
    return type(self).model_validate(self.model_dump() | {"annual_revenue": revenue})
```

Value objects keep the default `extra="ignore"`, so the computed fields in the dump are
dropped on revalidation.

**PYD-11 — Expose derived outputs with `@computed_field` on a `@property`,** so they are
included in `model_dump()` and in API responses:

```python
@computed_field
@property
def total_monthly_cost(self) -> float:
    return self.hosting_cost + self.license_cost
```

pyright accepts `@computed_field` over `@property` as written. The
`# type: ignore[prop-decorator]` in Pydantic's docs is for mypy; under pyright it is an
unnecessary suppression, which PY-9's configuration reports. Do not stack
`@computed_field` on `@cached_property` in a model that is ever copied: the copy keeps the
stale cached value.

---

## Request and response models

**PYD-12 — A request model owns the interpretation of its own body.** Group field names
that travel together in module constants (`MANUAL_FIELDS`, `OVERRIDE_FIELDS`), and give
the model methods that turn the body into what the service needs (`is_manual`,
`manual_payload()`, `overrides()`). Test explicit values with `is not None`, not
truthiness, so an explicit empty list or `0` counts as supplied.

**PYD-13 — Response envelopes subclass `BaseResponseModel`:**

```python
class BaseResponseModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=alias_generators.to_camel,
        from_attributes=True,
        serialize_by_alias=True,
        validate_by_alias=True,
        validate_by_name=True,
    )
```

API JSON is `snake_case`: the entities inside `data` have no alias generator, so their
keys are their field names. The camelCase alias generator applies only to the envelope's
own fields, so envelope models MUST use single-word field names (`data`, `report`,
`expenses`). Do not mix an entity into a `BaseResponseModel` subclass, which would
camelCase that entity's keys in one endpoint only. `validate_by_name` and
`validate_by_alias` replace `populate_by_name`, which Pydantic deprecates for V3.

---

## Serialization

**PYD-14 — Convert with the model's own methods:** `Entity.model_validate(obj)` in,
`model_dump()` out (with `exclude={...}` to drop relationship fields before a database
write), and `model_dump(mode="json")` whenever the result must be JSON-safe (cookies,
queue payloads, files). Compare two models in tests with `==` or via `model_dump()`.

- Build a model from untyped data (a decoded body, a `dict[str, Any]`, another model's
  `model_dump()`) with `Model.model_validate(data)`, never `Model(**data)`: the spread
  switches pyright's checks off and hides the coercion that happens at runtime.
- `model_construct()` skips all validation, `extra="forbid"` included, so it only ever
  receives data that has already been validated.
- Build a `TypeAdapter` for a non-model type once, at module scope, annotated
  (`PROJECTS: TypeAdapter[list[ProjectEntity]] = TypeAdapter(list[ProjectEntity])`):
  each construction builds a new validator.

---

## Settings

**PYD-15 — Environment configuration is one frozen `EnvVars` model in
`config/env_vars.py`, validated from `os.environ`,** and read through
`EnvVarManager().env_vars` (PY-26). Each field names its variable with
`validation_alias` and has a development default in assignment form. Pydantic parses the
strings, so a bad `DATABASE_PORT` or `LOG_SQL` fails at startup with a
`ValidationError`; a `default_factory` that calls `os.getenv` is never validated.

```python
class EnvVars(BaseModel, frozen=True):
    model_config = ConfigDict(
        extra="ignore", hide_input_in_errors=True, validate_default=True
    )

    # Database
    database_name: Annotated[str, Field(validation_alias="DATABASE_NAME")] = "app"
    database_port: Annotated[int, Field(gt=0, validation_alias="DATABASE_PORT")] = 5432
    log_sql: Annotated[bool, Field(validation_alias="LOG_SQL")] = False
    """Accepts true/false, 1/0, yes/no or on/off, in any case."""

    # Hosts
    base_domain: Annotated[str, Field(validation_alias="BASE_DOMAIN")] = "app.dev"

    # Upstream APIs
    tasks_api_key: Annotated[SecretStr, Field(validation_alias="TASKS_API_KEY")] = (
        SecretStr("UNSET")
    )

    @property
    def base_api_url(self) -> str:
        """Derive the API URL; a frozen model cannot store it."""
        return f"https://{self.base_domain}/api"

    @classmethod
    def from_environ(cls, environ: Mapping[str, str] | None = None) -> Self:
        """Validate the process environment, or a test's mapping."""
        return cls.model_validate(dict(os.environ if environ is None else environ))


class EnvVarManager(metaclass=SingletonMeta):
    """Hold the validated configuration for the process (PY-28)."""

    def __init__(self) -> None:
        self.env_vars: EnvVars = EnvVars.from_environ()

    def reload(self, environ: Mapping[str, str] | None = None) -> EnvVars:
        """Re-read the configuration after a test changes it."""
        self.env_vars = EnvVars.from_environ(environ)
        return self.env_vars
```

- Pydantic parses booleans itself (`true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`, in
  any case) and rejects anything else, so no `_parse_bool` helper is needed.
- Secrets are `SecretStr`, which prints as `**********` in reprs, logs, and dumps; read the
  value with `.get_secret_value()` where it is used (PY-27). A placeholder default such as
  `SecretStr("UNSET")` makes a missing secret obvious in failures.
- `hide_input_in_errors=True` keeps a bad value, such as a password inside a URL, out of
  the startup error message.
- `extra="ignore"`, because the environment holds many unrelated variables.
- Tests set environment variables and call `EnvVarManager().reload()` (pytest.md
  PYTEST-10); assigning to a field of the frozen model is a type error.
- Group fields under comments by concern (`# Auth`, `# Session cache`).

**PYD-16 — Prefer standard library types in fields** (`datetime`, `date`, `UUID`,
`Decimal`). If a third-party type (a GeoAlchemy2 `WKBElement`, say) is unavoidable,
define it once in `utils/pydantic_helpers.py` as a `type` alias, climbing Pydantic's
documented ladder only as far as needed: `Annotated` hooks such as `AfterValidator` and
`PlainSerializer` first; then a `@dataclass(frozen=True)` marker class in
`Annotated[ThirdParty, Marker()]` whose `__get_pydantic_core_schema__` gives the
validation and `mode="json"` serialization and whose `__get_pydantic_json_schema__`
describes it. Never set `arbitrary_types_allowed`, which skips validation and leaves
the JSON schema empty.

---

## Boundaries

**PYD-17 — Responses carry entities, unless an entity holds something sensitive.** An
envelope's `data` is the entity itself (fastapi.md FAPI-12). When an entity has a field a
client must never see (a password hash, a token, an internal note), the resource gets a
separate `<Entity>Out` model in `api/models/<resource>.py` listing only the public
fields, built with `UserOut.model_validate(user, from_attributes=True)`. Do not hide such
a field with `Field(exclude=True)` on the shared entity: the value still travels with
every object, and one `model_dump()` in the wrong place exposes it.

**PYD-18 — Request models reject what they do not expect.** They set
`model_config = ConfigDict(extra="forbid")`, so an unknown key is a 422
(`extra_forbidden`) instead of being dropped silently, and put a `max_length` on every
string and collection the client controls
(`tags: Annotated[list[str], Field(max_length=20)] = Field(default_factory=list[str])`).
Entities and response envelopes keep the default `extra="ignore"`. Limit the overall body
size in front of the app, because Pydantic only sees the parsed body.
