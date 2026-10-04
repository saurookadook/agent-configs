# Pydantic Standards

Applies to every Pydantic model: domain entities in `models/`, request and response
models in `api/models/`, value objects in `services/`, and the settings model in
`config/`. How entities are loaded is in [sqlalchemy.md](sqlalchemy.md); how routes use
request and response models is in [fastapi.md](fastapi.md).

**Stack:** Pydantic 2.

---

## Version

**PYD-1 — Use the Pydantic 2 API only:**

| Use                                    | Not (Pydantic 1)                     |
| -------------------------------------- | ------------------------------------ |
| `model_config = ConfigDict(...)`       | `class Config:`                      |
| `Model.model_validate(obj)`            | `Model.parse_obj(obj)`, `from_orm`   |
| `instance.model_dump()`                | `instance.dict()`                    |
| `instance.model_dump(mode="json")`     | `instance.json()` then `json.loads`  |
| `instance.model_copy(update={...})`    | `instance.copy(update=...)`          |
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
| value object      | the `services/` module that uses it  | `BaseModel`, usually frozen (PYD-10) | `ProjectScenario`             |
| settings          | `config/env_vars.py`                 | `BaseModel`                          | `EnvVars`                     |

```python
# models/base/entity.py
class BaseEntityModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID


# models/mixins/entity.py
class TimestampsEntityMixin(BaseModel):
    created_at: datetime
    updated_at: datetime


# models/project/entity.py
class ProjectEntity(BaseEntityModel, TimestampsEntityMixin):
    description: Optional[str] = None
    name: str
    owner_id: UUID
    status: str
    tags: list[str] = Field(default_factory=list)

    tasks: list[TaskEntity] = Field(default_factory=list)
```

---

## Entities

**PYD-3 — An entity mirrors its SQLAlchemy model**: the same field names, in the same
order (alphabetical columns, then relationships; SQLA-6), with types matching nullability
(`Optional[X] = None` for a nullable column). Facades build entities with
`ProjectEntity.model_validate(orm_row_or_mapping)`; `from_attributes=True` on
`BaseEntityModel` makes that work for ORM objects and row mappings alike.

**PYD-4 — Define a narrow read model when a caller needs a fraction of an entity or
fields from a join,** and say in its docstring why the full entity is wrong for it
(payload size, an N+1 it would cause, fields from another table). Mark joined fields with
a comment naming their source table.

```python
class ProjectCardEntity(BaseEntityModel):
    """
    Just enough of a project to render one card in a list.

    Deliberately not ``ProjectEntity``: the list renders no descriptions or tasks,
    and loading ``tasks`` for fifty cards would add fifty queries.
    """

    name: str
    status: str
    # ----- from `users`
    owner_name: str
```

---

## Fields

**PYD-5 — Declare fields by what they accept:**

- required: no default (`name: str`)
- nullable: `Optional[X] = None`
- collections: `Field(default_factory=list)` or `dict`; never a literal `[]` default
- a fixed default: the literal (`status: str = "active"`)

Do not use `Annotated[Optional[str], Field(default_factory=lambda: "")]` plus a validator
to turn `None` into a default. If `None` is not a valid value, the field is not
`Optional`; if it is, the default is `None`.

**PYD-6 — Put numeric and length constraints on the field,** not in a validator:
`Field(gt=0)`, `Field(ge=0, le=100)`, `Field(min_length=1)`. Say in a comment why a bound
is inclusive when that is a business decision ("100% down is allowed and means no loan").

---

## Validators

**PYD-7 — Write field validators as `@field_validator(..., mode="before")` stacked on
`@classmethod`,** for coercing raw input into the field's type (a coordinate pair into a
WKT string, a string into a date). Raise `ValueError` with a message that names the field
and the accepted shapes, chained with `from exc`:

```python
@field_validator("location", mode="before")
@classmethod
def parse_location(cls, data_val: Sequence[Decimal] | str | Any) -> str:
    if isinstance(data_val, str):
        return data_val
    try:
        return f"POINT({format_wkt_coordinate(data_val[1])} {format_wkt_coordinate(data_val[0])})"
    except (TypeError, ValueError, IndexError) as exc:
        raise ValueError(
            "'location' must be a WKT POINT string like 'POINT(lng lat)' or a (lat, lng) pair"
        ) from exc
```

**PYD-8 — Use `@model_validator(mode="after")` for rules across fields**, annotated
`-> Self` (`from typing import Self`) and returning `self`. Use
`@model_validator(mode="before")` on `@classmethod` to reshape raw input before field
validation: filling a field from another one, or turning an ORM object into a dict that
includes relationships. A `mode="before"` validator handles both dicts and ORM objects
and passes through anything else unchanged.

**PYD-9 — A validator's error message tells the client how to fix the request:** which
fields are missing or conflicting and what to send instead.

```python
raise ValueError(
    f"Manual entry requires all of [{', '.join(MANUAL_FIELDS)}] - missing "
    f"[{', '.join(missing)}]. Omit them all to import from 'source_url' instead."
)
```

---

## Value objects

**PYD-10 — Make calculation inputs frozen value objects:**
`model_config = ConfigDict(frozen=True, validate_default=True)`. Build variants with
`scenario.model_copy(update={"annual_revenue": revenue})` instead of mutating.
`validate_default=True` checks default constants against the field bounds too, so a bad
edit to a default fails loudly. Because a frozen model cannot assign in an `after`
validator, derive defaults from other fields in a `mode="before"` validator.

**PYD-11 — Expose derived outputs with `@computed_field` on a `@property`,** so they are
included in `model_dump()` and in API responses:

```python
@computed_field  # type: ignore[prop-decorator]
@property
def total_monthly_cost(self) -> float:
    return self.hosting_cost + self.license_cost
```

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
        populate_by_name=True,
        serialize_by_alias=True,
    )
```

API JSON is `snake_case`: the entities inside `data` have no alias generator, so their
keys are their field names. The camelCase alias generator applies only to the envelope's
own fields, so envelope models MUST use single-word field names (`data`, `report`,
`expenses`). Do not mix an entity into a `BaseResponseModel` subclass, which would
camelCase that entity's keys in one endpoint only.

---

## Serialization

**PYD-14 — Convert with the model's own methods:** `Entity.model_validate(obj)` in,
`model_dump()` out (with `exclude={...}` to drop relationship fields before a database
write), and `model_dump(mode="json")` whenever the result must be JSON-safe (cookies,
queue payloads, files). Compare two models in tests with `==` or via `model_dump()`.

---

## Settings

**PYD-15 — Environment configuration is one `EnvVars(BaseModel)` in
`config/env_vars.py`,** read through `EnvVarManager().env_vars` (PY-26). Each field reads
its variable in a `default_factory` with a development default and the right type;
derived values are set in a `mode="after"` model validator:

```python
class EnvVars(BaseModel):
    database_name: str = Field(default_factory=lambda: os.getenv("DATABASE_NAME", "app"))
    database_port: int = Field(default_factory=lambda: int(os.getenv("DATABASE_PORT", "5432")))
    log_sql: bool = Field(default_factory=lambda: EnvVars._parse_bool("LOG_SQL", False))
    """Valid values: `true`, `false`, `1`, `0`, `yes`, `no` (case insensitive)."""

    base_domain: str = Field(default_factory=lambda: os.getenv("BASE_DOMAIN", "app.dev"))
    base_api_url: str = Field(default="UNSET")

    @model_validator(mode="after")
    def derive_urls(self) -> Self:
        self.base_api_url = f"https://{self.base_domain}/api"
        return self
```

Parse booleans with the shared `_parse_bool` helper; never treat the raw string as a
boolean (`os.getenv("LOG_SQL", False)` is truthy for `"false"`). Secrets have no real
default; a placeholder such as `"UNSET"` makes a missing value obvious in logs and
failures. Group fields under comments by concern (`# Auth`, `# Session cache`).

**PYD-16 — Prefer standard library types in fields** (`datetime`, `date`, `UUID`,
`Decimal`). A third-party type needs a custom core schema; if one is unavoidable, define
it once in `utils/pydantic_helpers.py` with `Annotated[..., WrapValidator(...)]` or
`__get_pydantic_core_schema__`, with a serializer for `mode="json"`.
