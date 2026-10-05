# Make Pydantic contracts visible to pyright

As of October 2026, best practice for Pydantic in a typed Python 3.14 backend is to **pin Pydantic 2.13.x (2.13.5 is the latest stable release; 2.14 is in beta)**, write plain unquoted annotations, and design models around one constraint: **pyright understands Pydantic only through PEP 681 `dataclass_transform`**. Pyright sees `default`, `default_factory` and `alias` when they are passed to `Field()` in assignment form, and it sees `frozen` only when it is a class keyword. Everything else is invisible to it: constraints, validators, `ConfigDict`, alias generators and `validation_alias` ([Fields](https://pydantic.dev/docs/validation/latest/concepts/fields/); [VS Code integration](https://pydantic.dev/docs/validation/latest/integrations/dev-tools/visual_studio_code/)). In practice that gives these rules:

- Put defaults and factories in assignment form, and constraints in `Annotated` aliases.
- Parametrise every `default_factory`.
- Build models from untyped data with `model_validate`, not `Model(**data)`.
- Type a before-validator's raw input as `object`, following Python's typing docs rather than Pydantic's `Any`.
- Write after model validators as instance methods that return `Self`.
- Raise `PydanticCustomError` with literal message templates.
- Replace the soon-to-be-deprecated `populate_by_name` with `validate_by_name` plus `validate_by_alias`.

Three choices are genuinely open, and this report sets out the options for each rather than picking one: how to spell `frozen`, whether to use `BaseSettings` or a hand-rolled settings model, and whether output models should be separate classes or rely on field exclusion.

**How the examples were checked.** Every Python example below passed **pyright 1.1.414 in strict mode targeting Python 3.14**, except one deliberate counter-example, which produces exactly the errors its comments name. Every one except the forward-reference example also ran against **Pydantic 2.13.5 and pydantic-core 2.46.5**. Those runs used **CPython 3.13**, because PyPI was blocked and no 3.14 pydantic-core wheel was available. The local runs also overturned four assumptions in the research notes, flagged where they come up:

- A bare `default_factory=list` is sometimes clean and sometimes `list[Unknown]`.
- `Model(**data)` is accepted silently, not flagged.
- `validate_assignment=True` can leave an instance invalid.
- A class-keyword `frozen=True` forces frozen-ness on the whole class hierarchy under pyright.

## Pydantic 2.13 on Python 3.14 needs no quotes, but does need runtime imports

The current stable line is **2.13 (2.13.0 on 13 April 2026, 2.13.5 on 28 August 2026)**. **2.14.0b2** (9 September 2026) drops Python 3.9, adds Python 3.15 support and promotes the `MISSING` sentinel from experimental to stable ([PyPI](https://pypi.org/project/pydantic/); [HISTORY.md](https://github.com/pydantic/pydantic/blob/main/HISTORY.md)). Python 3.14 has been supported since **2.12.0**. Its release notes say PEP 649/749 annotations "are now lazily evaluated, dropping the need to use string annotations", though nested scopes still have "limited support" ([v2.12 announcement](https://pydantic.dev/articles/pydantic-v2-12-release)). On 3.14, `from __future__ import annotations` therefore adds nothing to model modules. It has also caused resolution bugs:

- a "not fully defined" regression in 2.10 ([pydantic#11004](https://github.com/pydantic/pydantic/issues/11004));
- a still-open bug in which a `TypedDict` using `Required[...]` under the future import fails on 3.14.0 final ([pydantic#12421](https://github.com/pydantic/pydantic/issues/12421)).

Leave the future import out of model modules. Pydantic V1 does not work on 3.14 at all ([v2.12 announcement](https://pydantic.dev/articles/pydantic-v2-12-release)).

Lazy annotations do not mean Pydantic stops evaluating them. **Pydantic still evaluates every field annotation, and every validator or serializer signature, when it builds the schema.** So a type imported only under `if TYPE_CHECKING:` breaks the model. Pydantic's resolver looks names up in the class namespace, the parent frame's locals and the module globals, and leaves anything unresolved behind a mock schema until `model_rebuild()` ([Resolving annotations](https://pydantic.dev/docs/validation/latest/internals/resolving_annotations/)). Two local checks confirmed this:

- A field typed with a `TYPE_CHECKING`-only import raised "`Project` is not fully defined; you should define `Owner`" on first validation.
- So did a `@field_serializer` whose *return* annotation was imported that way.

The second case catches people out, because serializer return types look like ordinary method annotations ([Serialization](https://pydantic.dev/docs/validation/latest/concepts/serialization/)).

**Ruff actively pushes code into this trap.** With Ruff 0.16.8's flake8-type-checking rules enabled and `target-version = "py314"`, a model module whose `datetime` and `Decimal` imports appear only in field annotations gets `TC003 Move standard library import ... into a type-checking block` (verified locally). Two Ruff settings fix this, and both are needed:

- [`runtime-evaluated-base-classes`](https://docs.astral.sh/ruff/settings/#lint_flake8-type-checking_runtime-evaluated-base-classes) covers field annotations. It must list `pydantic.BaseModel` **and every project base class defined in another module**. Ruff did not resolve that an imported `app.base.ApiModel` subclasses `BaseModel` until that class was listed too (verified locally).
- [`runtime-evaluated-decorators`](https://docs.astral.sh/ruff/settings/#lint_flake8-type-checking_runtime-evaluated-decorators) covers method signatures. With only the base-class setting, Ruff still suggested moving a `Mapping` import used only in a `@field_serializer` return type. Applying that suggestion broke the model ("not fully defined"). Listing the Pydantic decorators silenced the suggestion.

Both results were verified locally.

```toml
[lint.flake8-type-checking]
runtime-evaluated-base-classes = ["pydantic.BaseModel", "app.models.base.ApiModel", "app.models.base.EntityModel"]
runtime-evaluated-decorators = [
    "pydantic.field_serializer", "pydantic.model_serializer",
    "pydantic.field_validator", "pydantic.model_validator", "pydantic.validate_call",
]
```

With both settings, Ruff still suggests moving imports used only in ordinary method signatures, such as `Mapping` in a plain classmethod. Pydantic never evaluates those, so moving them is safe on 3.14.

Self-references and forward references to classes defined later in the module work unquoted on 3.14. Pydantic resolves them when the class is created, or retries once the name exists ([Forward annotations](https://pydantic.dev/docs/validation/latest/concepts/forward_annotations/); [Models](https://pydantic.dev/docs/validation/latest/concepts/models/)). The example below passes pyright strict for 3.14. It is **the one example not executed**: on the available 3.13 interpreter it fails with `NameError`, as expected, because 3.13 evaluates annotations eagerly.

```python
from pydantic import BaseModel


class Category(BaseModel):
    name: str
    parent: Category | None = None
    owner: Owner | None = None


class Owner(BaseModel):
    email: str


root: Category = Category.model_validate({"name": "root", "owner": {"email": "a@example.com"}})
child: Category = Category(name="child", parent=root)
```

V3 is planned as a cleanup with no large API changes. It will remove the `pydantic.v1` shim and instance-level `model_fields` access, and promote proven experimental features. No date has been published ([pydantic#10033](https://github.com/pydantic/pydantic/issues/10033)). The one V3 change that touches typical code today is `populate_by_name`, covered below.

## Only three `Field()` arguments reach pyright's `__init__`

Pydantic's docs prefer the annotated pattern, `x: Annotated[T, Field(...)]`, because `x: T = Field(...)` "might trick users into thinking `f` has a default value". The same page then makes an exception: `default`, `default_factory` and `alias` "are taken into account by static type checkers to synthesize a correct `__init__()` method. The annotated pattern is *not* understood by them, so you should use the normal assignment form instead" ([Fields](https://pydantic.dev/docs/validation/latest/concepts/fields/)). That gives a clean split:

- **Defaults and factories go in assignment form.** Write `= None` or `= Field(default_factory=...)`.
- **Constraints and metadata go inside `Annotated`**, ideally as reusable aliases, so that the annotation itself states the contract.

Pyright also requires `default` to be a keyword argument. With `status: str = Field("todo")`, pyright reports `status` as a missing argument ([VS Code integration](https://pydantic.dev/docs/validation/latest/integrations/dev-tools/visual_studio_code/); verified locally).

Mutable defaults are safe at runtime, because Pydantic deep-copies any non-hashable default ([Fields](https://pydantic.dev/docs/validation/latest/concepts/fields/)). Under pyright strict, though, **a bare factory is unreliable**. Pyright 1.1.398 and later deliberately infers `list[Unknown]` for a stdlib dataclass `field(default_factory=list)` ([pyright#10169](https://github.com/microsoft/pyright/issues/10169)). The research notes assumed Pydantic's `Field` behaves the same way. The local run showed it is inconsistent instead:

- `list[str] = Field(default_factory=list)` and `dict[str, int] = Field(default_factory=dict)` were clean.
- `set[int] = Field(default_factory=set)` and `list[dict[str, int]] = Field(default_factory=list)` both raised `reportUnknownVariableType`.

The rule that always works is to **parametrise the factory** (`default_factory=list[str]`). `list[str]()` is a valid runtime call that returns `[]`.

**Named `type` aliases and assignment aliases are not interchangeable.** Since v2.11, a PEP 695 `type` alias becomes a named JSON Schema `$defs` entry referenced with `$ref`, whereas an assignment alias (`X = Annotated[...]`) is inlined. Locally, `type New = Annotated[int, Field(ge=0)]` produced `{"$ref": "#/$defs/New"}`, and the equivalent assignment alias produced an inline `minimum`. This changes OpenAPI output, so snapshot it. The docs also warn that **field-specific metadata such as `alias`, `default` or `deprecated` cannot live inside a named alias**. Only metadata that applies to the type itself is allowed there, such as constraints, validators, serializers, a discriminator or JSON metadata ([Types: named type aliases](https://pydantic.dev/docs/validation/latest/concepts/types/#named-type-aliases)). So use `type` for reusable constrained types, and keep aliases and defaults on the field.

```python
from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, ValidationError

type NonEmptyStr = Annotated[str, StringConstraints(min_length=1, strip_whitespace=True)]
type Money = Annotated[Decimal, Field(max_digits=12, decimal_places=2, ge=0)]
type Priority = Annotated[int, Field(ge=1, le=5)]


class TaskStatus(StrEnum):
    TODO = "todo"
    DONE = "done"


class Task(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID  # required: no default
    title: NonEmptyStr
    status: TaskStatus = TaskStatus.TODO  # enum in Python, "todo" in JSON
    kind: Literal["bug", "feature"] = "feature"
    estimate: Money | None = None  # may be omitted, may be null
    due_at: AwareDatetime | None = None  # rejects naive datetimes
    tags: list[str] = Field(default_factory=list[str])  # parametrised factory
    priority: Priority = 3


task: Task = Task(id=uuid4(), title="  Write report  ", due_at=datetime(2026, 10, 5, tzinfo=UTC))
assert task.title == "Write report"
assert task.model_dump(mode="json")["status"] == "todo"
try:
    Task.model_validate({"id": str(uuid4()), "title": "x", "due_at": "2026-10-05T12:00:00"})
except ValidationError as exc:
    assert exc.errors()[0]["type"] == "timezone_aware"
```

The example settles several smaller questions:

- **`x: X | None = None` is the norm.** `x: X | None` with no default is legal, and means "must be sent, may be null", which suits request bodies where an explicit null carries meaning.
- **Use `AwareDatetime`, not bare `datetime`,** wherever times must be timezone-aware. It raises `timezone_aware` on naive input ([Validation errors](https://pydantic.dev/docs/validation/latest/errors/validation_errors/)).
- **Keep `use_enum_values=False`, the default.** With it set to `True`, Pydantic stores the raw `.value`, so the attribute no longer matches its annotation and pyright cannot see the gap ([Config](https://pydantic.dev/docs/validation/latest/api/pydantic/config/)). A `StrEnum` already serialises to its value in JSON mode ([Standard library types](https://pydantic.dev/docs/validation/latest/api/pydantic/standard_library_types/)).
- **Apply strict mode per field** (`Field(strict=True)` or `Strict*` types) rather than model-wide on request models. The docs note that "strict mode is looser when validating from JSON" anyway ([Strict mode](https://pydantic.dev/docs/validation/latest/concepts/strict_mode/)).

The next block collects the patterns pyright rejects. Pyright strict reports exactly the errors noted in its comments (verified locally).

```python
# Counter-example: pyright strict reports the errors noted on the two calls at the bottom.
# (At runtime only the alias complaint is real: Bad(pid="x") raises `missing` for projectId.)
from typing import Annotated, Any

from pydantic import BaseModel, Field


class Bad(BaseModel):
    name: Annotated[str, Field(default="x")]  # default invisible: pyright treats `name` as required
    status: str = Field("todo")  # positional default: also treated as required
    pid: str = Field(alias="projectId")  # pyright's __init__ now only accepts projectId=


class Coerce(BaseModel):
    age: int


def unchecked(data: dict[str, Any]) -> Coerce:
    return Coerce(**data)  # NOT flagged: a dict[str, Any] spread switches checking off


Bad(pid="x")  # error: missing name/status/projectId, and no parameter named "pid"
Coerce(age="23")  # error: str is not assignable to int, although Pydantic accepts it at runtime
```

Two lessons in that block differ from the research notes and from common advice. First, **pyright strict does not flag `Model(**data)` when `data` is `dict[str, Any]`**; the spread silently disables checking. The case for `Model.model_validate(data)` on untyped input is therefore honesty, not a pyright error. `model_validate` declares that coercion happens at runtime, while `__init__` claims types that were never checked. FastAPI's own layering example uses `UserInDB(**user_in.model_dump(), hashed_password=...)` ([FastAPI extra models](https://fastapi.tiangolo.com/tutorial/extra-models/)). Because `model_dump()` returns `dict[str, Any]`, that conversion is unchecked under pyright, so pass fields explicitly or use `model_validate`. Second, pyright reports runtime-valid coercions such as `age="23"` as errors. Pydantic's documented workarounds are `cast(Any, ...)` or a targeted `# pyright: ignore` ([VS Code integration](https://pydantic.dev/docs/validation/latest/integrations/dev-tools/visual_studio_code/)). In application code, `model_validate` makes both unnecessary.

## `ConfigDict` is type-checked, but `frozen` forces a hierarchy choice

`model_config = ConfigDict(...)` is a `TypedDict`, so pyright catches misspelt keys. Its contents are otherwise invisible to pyright. Since 2.11, the alias configuration is a trio:

- `validate_by_name` (default `False`)
- `validate_by_alias` (default `True`)
- `serialize_by_alias` (default `False`)

The docs say `populate_by_name` usage "is not recommended in v2.11+ and will be deprecated in v3", and that `validate_by_name=True` plus `validate_by_alias=True` "is strictly equivalent" ([Config](https://pydantic.dev/docs/validation/latest/api/pydantic/config/)). One summary of HISTORY.md described `populate_by_name` as already deprecated in 2.12; the config page is the authority here. Locally, **2.13.5 emitted no warning** for `populate_by_name=True`, so nothing will warn about this migration. Change it now. `serialize_by_alias` matters too: `model_dump` still defaults to `by_alias=False`, which the docs call "notably inconsistent" with validation, and V3 is expected to flip the default to `True` ([Alias](https://pydantic.dev/docs/validation/latest/concepts/alias/); [Config](https://pydantic.dev/docs/validation/latest/api/pydantic/config/)). APIs that use snake_case JSON need none of this.

An `alias_generator` runs only at runtime, so **pyright builds `__init__` from field names** (`Model(page_size=1)` passes, `Model(pageSize=1)` fails), while JSON clients send camelCase. That is the cleanest fully typed setup. A per-field override inside such a model should use `Annotated[T, Field(alias=...)]`. A plain `= Field(alias=...)` would flip that one field to alias-only construction for pyright. This is the docs' own workaround ([Fields: field aliases](https://pydantic.dev/docs/validation/latest/concepts/fields/#field-aliases)).

`frozen` is the one config key that pyright can see, and how you spell it is a real choice. The official examples use `model_config = ConfigDict(frozen=True)` ([Models: faux immutability](https://pydantic.dev/docs/validation/latest/concepts/models/#faux-immutability)). The VS Code integration page says only the class-keyword form lets Pylance "detect errors when something is trying to set values in a model that is frozen" ([VS Code integration](https://pydantic.dev/docs/validation/latest/integrations/dev-tools/visual_studio_code/)). Local pyright runs showed the cost of the class keyword, which neither page mentions. **Pyright applies dataclass frozen-inheritance rules.** A class-keyword frozen model cannot inherit from a non-frozen base ("A frozen class cannot inherit from a class that is not frozen"). That includes a base that is frozen only through `ConfigDict`. A subclass of a frozen model must repeat `frozen=True` ("A non-frozen class cannot inherit from a class that is frozen"). Pydantic itself allows both at runtime. A `frozen_default` feature to ease this was requested and is still open ([pydantic#10890](https://github.com/pydantic/pydantic/issues/10890)).

| Option | Runtime | Pyright on `obj.x = ...` | Hierarchy constraint | Source |
|---|---|---|---|---|
| `class V(Base, frozen=True)` | frozen, hashable | error: attribute is read-only | every ancestor up to `BaseModel` must be class-keyword frozen; every subclass must repeat it | VS Code page; verified |
| `model_config = ConfigDict(frozen=True)` | frozen, hashable, inherited | silent | none | docs' main examples; verified |
| `Field(frozen=True)` on one field | raises `frozen_field` | silent | none | [Fields](https://pydantic.dev/docs/validation/latest/concepts/fields/); verified |
| Class keyword plus `model_config` | the two merge (`frozen` and `validate_default` both apply) | error, as for the class keyword | as for the class keyword | verified |

If static detection is worth the constraint, the pattern below keeps it workable. Use **two roots that share one `ConfigDict` constant**: a mutable `ApiModel` and a frozen `FrozenApiModel`. Value objects then descend only from the frozen root, and repeat the keyword at each level. The shared dict is not mutated by the class keyword (verified). If one shared base must cover both mutable and immutable models, the `ConfigDict` spelling is the only option, at the cost of losing static detection. Either way, frozen is shallow: "In Python, immutability is not enforced", so use `tuple[...]` and `frozenset[...]` inside value objects ([Models](https://pydantic.dev/docs/validation/latest/concepts/models/)).

```python
from decimal import Decimal
from typing import Annotated, Final
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError
from pydantic.alias_generators import to_camel

API_CONFIG: Final[ConfigDict] = ConfigDict(
    alias_generator=to_camel,
    validate_by_name=True,  # replaces populate_by_name=True
    validate_by_alias=True,
    serialize_by_alias=True,
    extra="forbid",
)


class ApiModel(BaseModel):
    """Mutable root for transport models."""

    model_config = API_CONFIG


class FrozenApiModel(BaseModel, frozen=True):
    """Frozen root: pyright accepts only frozen subclasses of a frozen root."""

    model_config = API_CONFIG


class ProjectCreateRequest(ApiModel):
    project_name: str
    owner_id: UUID
    external_ref: Annotated[str | None, Field(alias="extRef")] = None  # field name stays valid for pyright


class PriceQuote(FrozenApiModel, frozen=True):
    unit_price: Decimal
    currency_code: str = "EUR"


class EntityModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID


class Timestamped(BaseModel):  # mixins subclass BaseModel so their fields are collected
    created_at: AwareDatetime
    updated_at: AwareDatetime


class ProjectEntity(Timestamped, EntityModel):
    name: str


req: ProjectCreateRequest = ProjectCreateRequest.model_validate_json(
    '{"projectName": "Atlas", "ownerId": "8c4e2a8e-6c1f-4a9b-9a51-1d2f3e4a5b6c", "extRef": "A-1"}'
)
assert req.external_ref == "A-1" and set(req.model_dump()) == {"projectName", "ownerId", "extRef"}
quote: PriceQuote = PriceQuote.model_validate({"unitPrice": "9.99"})
assert quote.model_dump(mode="json") == {"unitPrice": "9.99", "currencyCode": "EUR"}
try:
    quote.unit_price = Decimal(1)  # pyright: ignore[reportAttributeAccessIssue]
except ValidationError as exc:
    assert exc.errors()[0]["type"] == "frozen_instance"
```

The remaining options split into those the docs leave neutral and those where the local runs found a trap.

**`extra`.** The docs give no recommendation between `forbid` and the default `ignore` ([Models](https://pydantic.dev/docs/validation/latest/concepts/models/)). `forbid` suits inbound request bodies, where unknown keys are client bugs. `ignore` suits `from_attributes` entities and lenient upstream payloads.

**`validate_assignment=True`.** Use it only on mutable models whose invariants must survive mutation, and know its trap. In a local run, an assignment that failed a `mode="after"` model validator raised `ValidationError` **but left the new value on the instance** (`d.a == 5` after the failed `d.a = 5`). The docs do not mention this. Treat the exception as fatal for that instance, or prefer frozen models with explicit replacement methods.

**`use_attribute_docstrings=True`.** It turns a bare string under each field into the JSON Schema `description` ([Config](https://pydantic.dev/docs/validation/latest/api/pydantic/config/)). If both a docstring and `Field(description=...)` are set, **`description=` wins** (verified). Pick one source per field.

**`protected_namespaces`.** Since 2.10 it covers only `model_validate*` and `model_dump*`. A field named `model_name` is now fine, while `model_dump_mode` still warns (verified; [Config](https://pydantic.dev/docs/validation/latest/api/pydantic/config/)).

## Validators type cleanly once raw input is `object`, not `Any`

The docs' guidance is to **default to after validators**, because they "are generally more type safe and thus easier to implement". Use before validators for coercing raw input. Avoid plain validators unless you mean them: they skip type validation entirely, and the docs show an `int` field accepting `'invalid'`. Wrap validators are the most flexible but slower ([Validators](https://pydantic.dev/docs/validation/latest/concepts/validators/); [Performance](https://pydantic.dev/docs/validation/latest/concepts/performance/)). The docs treat the `Annotated` form and the decorator form as equals: `Annotated[int, AfterValidator(...)]` is reusable and visible in the annotation, while `@field_validator` can cover several fields or `'*'` ([Validators: which pattern](https://pydantic.dev/docs/validation/latest/concepts/validators/#which-validator-pattern-to-use)). A sensible split is `Annotated` aliases for type-level rules and decorators for model-specific coercion.

On raw input, Pydantic's docs and Python's diverge. Pydantic types a before validator's input as `Any` ("Before validators take the raw input, which can be anything"), and in one example contradicts itself by annotating it `str` ([Validators: before](https://pydantic.dev/docs/validation/latest/concepts/validators/#field-before-validator)). Python's typing docs say: "Use `object` to indicate that a value could be any type in a typesafe manner. Use `Any` to indicate that a value is dynamically typed" ([typing: the Any type](https://docs.python.org/3/library/typing.html#the-any-type)). On this language-level question Python's docs win. **Type raw input as `object`.** It satisfies Pydantic's `Any`-typed decorator protocols, because parameters are contravariant, and it forces narrowing. Narrowing has its own strict-mode snag. `isinstance(value, (list, tuple))` narrows to `list[Unknown] | tuple[Unknown, ...]`, and unpacking it then fails with `reportUnknownVariableType` whether `value` is `Any` or `object`. **A `match` statement with class patterns narrows the elements cleanly** (verified; the `isinstance` failure was reproduced against 2.13.5).

The local runs also confirmed four rules about how validators are declared:

- **Stack `@classmethod` under every `@field_validator` and before/wrap `@model_validator`.** Pydantic adds it automatically at runtime ([functional_validators.py](https://github.com/pydantic/pydantic/blob/main/pydantic/functional_validators.py)). Without it, pyright stays silent but types `cls` as `Self` rather than `type[Self]`.
- **After model validators are instance methods returning `Self`.** A classmethod emits `PydanticDeprecatedSince212`, and V3 will stop converting it ([Validators: model after](https://pydantic.dev/docs/validation/latest/concepts/validators/#model-after-validator)).
- **Wrap model validators take `handler: ModelWrapValidatorHandler[Self]` and return `Self`.**
- **Never name a validator after a `BaseModel` method.** A before validator named `from_orm` triggers `reportIncompatibleMethodOverride`.

A bare `info: ValidationInfo` needs no type argument, because its context type variable has a default. `info.data` is `dict[str, Any]`, holds only the fields validated so far, and is `None` for model validators ([Validators: validation info](https://pydantic.dev/docs/validation/latest/concepts/validators/#validation-info)). For before and wrap validators, pass `json_schema_input_type` so that the request schema documents the inputs actually accepted ([Validators: JSON Schema](https://pydantic.dev/docs/validation/latest/concepts/validators/#json-schema-and-field-validators)).

```python
from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ModelWrapValidatorHandler,
    ValidationError,
    ValidationInfo,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError


def _non_blank(value: str) -> str:
    if not value.strip():
        raise PydanticCustomError("blank", "Value must not be blank")
    return value


type NonBlankStr = Annotated[str, AfterValidator(_non_blank)]


class Site(BaseModel, frozen=True):
    name: NonBlankStr
    location_wkt: str
    min_guests: int = 1
    max_guests: int = 10

    @field_validator("location_wkt", mode="before", json_schema_input_type=str | tuple[float, float])
    @classmethod
    def _coerce_pair(cls, value: object) -> object:
        match value:  # class patterns narrow elements; isinstance(list | tuple) leaves Unknown
            case [int() | float() as x, int() | float() as y]:
                return f"POINT({x} {y})"
            case _:
                return value  # let Pydantic reject anything else

    @field_validator("max_guests")
    @classmethod
    def _max_not_below_min(cls, value: int, info: ValidationInfo) -> int:
        minimum: object = info.data.get("min_guests")
        if isinstance(minimum, int) and value < minimum:
            raise PydanticCustomError("guest_range", "max_guests must be >= min_guests")
        return value

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.name == self.location_wkt:
            raise PydanticCustomError("name_is_location", "Name must differ from location")
        return self

    @model_validator(mode="wrap")
    @classmethod
    def _passthrough(cls, data: object, handler: ModelWrapValidatorHandler[Self]) -> Self:
        return handler(data)


site: Site = Site.model_validate({"name": "Depot", "location_wkt": (1.5, 2)})
assert site.location_wkt == "POINT(1.5 2)"
try:
    Site.model_validate({"name": "a", "location_wkt": "POINT(0 0)", "min_guests": 5, "max_guests": 2})
except ValidationError as exc:
    assert exc.errors()[0]["type"] == "guest_range"
```

### Error payloads leak input unless three switches are off

Validators may raise `ValueError`, `AssertionError` or `PydanticCustomError`. `assert` is skipped under `python -O`, which rules it out ([Validators: raising errors](https://pydantic.dev/docs/validation/latest/concepts/validators/#raising-validation-errors)). **`PydanticCustomError` is the typed choice.** Its `message_template` parameter is `LiteralString`, so pyright strict rejects an f-string message: "Argument of type 'str' cannot be assigned to parameter 'message_template' of type 'LiteralString'". That enforces the rule that a message never interpolates user input. A `ValueError`, by contrast, yields a `msg` prefixed "Value error, ", plus a `ctx` that holds the exception object. Locally, `json.dumps` on such an error dict failed with "Object of type ValueError is not JSON serializable".

**`hide_input_in_errors=True` is not a redaction switch for API bodies.** Pydantic documents it as "Whether to hide inputs when printing errors" ([Config](https://pydantic.dev/docs/validation/latest/api/pydantic/config/)). The pydantic-core source consults it only on the display path ([validation_exception.rs](https://github.com/pydantic/pydantic/blob/main/pydantic-core/src/errors/validation_exception.rs)). Locally, `errors()` still returned `'input': 99` with the flag set, while `str(exc)` omitted it. Client-facing errors must call `errors(include_input=False, include_context=False, include_url=False)` ([Error handling](https://pydantic.dev/docs/validation/latest/errors/errors/)). Keep `hide_input_in_errors` for logs.

```python
import json

from pydantic import BaseModel, ConfigDict, SecretStr, ValidationError, field_validator
from pydantic_core import ErrorDetails, PydanticCustomError


class Booking(BaseModel):
    model_config = ConfigDict(hide_input_in_errors=True)  # protects str(exc) and logs only

    nights: int
    card_token: SecretStr

    @field_validator("nights")
    @classmethod
    def _range(cls, value: int) -> int:
        if not 1 <= value <= 30:
            raise PydanticCustomError(
                "nights_out_of_range", "Nights must be between {min} and {max}", {"min": 1, "max": 30}
            )
        return value


def client_errors(exc: ValidationError) -> list[ErrorDetails]:
    """Error list that is safe to return to API clients."""
    return exc.errors(include_input=False, include_context=False, include_url=False)


try:
    Booking.model_validate({"nights": 99, "card_token": "tok_secret_123"})
except ValidationError as exc:
    assert exc.errors()[0]["input"] == 99  # hide_input_in_errors does NOT strip errors()
    assert "99" not in str(exc)
    safe: list[ErrorDetails] = client_errors(exc)
    assert safe == [{"type": "nights_out_of_range", "loc": ("nights",), "msg": "Nights must be between 1 and 30"}]
    json.dumps(safe)
```

## Serialization, copying and unions each have one unchecked escape hatch

Pydantic dumps in three ways ([Serialization](https://pydantic.dev/docs/validation/latest/concepts/serialization/)):

- `model_dump()` returns Python objects.
- `model_dump(mode="json")` returns JSON-compatible values.
- `model_dump_json()` returns the encoded string.

Both `model_dump` forms are typed `dict[str, Any]`. Serializers differ from validators in two ways that trip people up:

- **They are instance methods.** Validators are classmethods.
- **Only one serializer is allowed per field or model.**

A serializer's return annotation "will be used to build an extra serializer", so annotate it precisely, never as `Any`. A plain model serializer that returns a non-dict breaks `model_dump()`'s declared `dict[str, Any]`, which the docs themselves warn about ([Serialization: model serializers](https://pydantic.dev/docs/validation/latest/concepts/serialization/#model-serializers)).

`@computed_field` must sit on an explicit `@property`. On a bare method, pyright types the attribute as `() -> int`, i.e. as a method. Here mypy and pyright diverge. The docstring warns that mypy reports "Decorated property not supported" and needs `# type: ignore[prop-decorator]`, while "pyright supports `@computed_field` without error" ([Fields: computed_field](https://pydantic.dev/docs/validation/latest/concepts/fields/#the-computed_field-decorator)). **In a pyright codebase, remove those ignores.** Avoid `@computed_field` on top of `@cached_property` in any model that is ever copied. Locally, `model_copy(update={"a": 5})` carried over the cached `double == 2`, and the stale value appeared in `model_dump()`.

Subclass fields are dropped by default. A field annotated `UserOut` that holds a `UserRecord` serializes only `UserOut`'s fields. The docs explain this as protection against leaking secrets that a subclass adds. **2.13's `polymorphic_serialization`** is the documented opt-in, set "on the class that should be polymorphic". The docs prefer it to `SerializeAsAny` "in most cases" ([Serialization: polymorphic](https://pydantic.dev/docs/validation/latest/concepts/serialization/#polymorphic-serialization)).

```python
from datetime import UTC, datetime
from decimal import Decimal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    SerializerFunctionWrapHandler,
    computed_field,
    field_serializer,
    model_serializer,
)


class Invoice(BaseModel):
    issued_at: AwareDatetime
    net: Decimal
    vat_rate: Decimal = Decimal("0.20")

    @field_serializer("issued_at", when_used="json")
    def _date_only(self, value: datetime) -> str:
        return value.date().isoformat()

    @computed_field
    @property
    def gross(self) -> Decimal:
        return self.net * (1 + self.vat_rate)

    @model_serializer(mode="wrap")
    def _versioned(self, handler: SerializerFunctionWrapHandler) -> dict[str, object]:
        data: dict[str, object] = handler(self)
        data["schema_version"] = 2
        return data


class UserOut(BaseModel):
    email: str


class UserRecord(UserOut):
    password_hash: str


class Shape(BaseModel):
    model_config = ConfigDict(polymorphic_serialization=True)
    name: str


class Circle(Shape):
    radius: float


class Envelope(BaseModel):
    user: UserOut
    shape: Shape


inv: Invoice = Invoice(issued_at=datetime(2026, 10, 5, 9, tzinfo=UTC), net=Decimal("10.00"))
assert inv.model_dump(mode="json") == {
    "issued_at": "2026-10-05",
    "net": "10.00",  # Decimal is a string in JSON mode
    "vat_rate": "0.20",
    "gross": "12.0000",
    "schema_version": 2,
}
env: Envelope = Envelope(user=UserRecord(email="a@example.com", password_hash="x"), shape=Circle(name="c", radius=1.0))
assert env.model_dump() == {"user": {"email": "a@example.com"}, "shape": {"name": "c", "radius": 1.0}}
```

**`model_copy(update=...)` is the largest typed hole in Pydantic.** The docs say the updates "aren't validated" ([Models: model copy](https://pydantic.dev/docs/validation/latest/concepts/models/#model-copy)). Its `update` parameter is typed `Mapping[str, Any]`, so pyright accepts anything. Locally, `update={"a": "nope", "zzz": 1}` on an `a: int` model produced `a == 'nope'` plus an undeclared `zzz` entry in `__dict__`, with no errors from either tool. For frozen value objects, wrap replacement in a typed method that revalidates. Keep raw `model_copy` for values that are already validated instances of the field type.

```python
from decimal import Decimal
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class Price(BaseModel, frozen=True):
    model_config = ConfigDict(extra="forbid")

    amount: Decimal = Field(ge=0)
    currency: str = "EUR"

    def with_amount(self, amount: Decimal) -> Self:
        """Typed, validated replacement for model_copy(update={"amount": ...})."""
        return type(self).model_validate(self.model_dump() | {"amount": amount})


base: Price = Price(amount=Decimal("5"))
assert base.with_amount(Decimal("7.50")).amount == Decimal("7.50")
try:
    base.with_amount(Decimal("-1"))
except ValidationError as exc:
    assert exc.errors()[0]["type"] == "greater_than_equal"
assert base.model_copy(update={"amount": Decimal("-1")}).amount == Decimal("-1")  # unvalidated
```

For composition, the docs' advice is consistent:

- **Generics.** PEP 695 generics (`class Page[T](BaseModel)`) and type-variable defaults are fully supported from v2.11 ([Models: generics](https://pydantic.dev/docs/validation/latest/concepts/models/)).
- **Unions.** The default `smart` mode exists because left-to-right matching gives "potentially surprising results". The docs recommend discriminated unions as "both more performant and more predictable" ([Unions](https://pydantic.dev/docs/validation/latest/concepts/unions/)).
- **Discriminators on `type` aliases.** A string discriminator inside a `type` alias works on 2.13.5 (verified). The research notes read 2.14's #13604 as adding discriminators on PEP 695 aliases in general, but the changelog entry is specifically "Fix support for *callable* discriminators with PEP 695 type aliases" ([HISTORY.md](https://github.com/pydantic/pydantic/blob/main/HISTORY.md)). Until 2.14, avoid combining callable discriminators with `type` aliases.
- **`TypeAdapter`.** Use it for non-model top-level types, built once at module scope, because "Each time a `TypeAdapter` is instantiated, it will construct a new validator and serializer" ([Performance](https://pydantic.dev/docs/validation/latest/concepts/performance/)). An explicit `TypeAdapter[...]` annotation satisfies strict mode.

```python
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, RootModel, TypeAdapter


class Page[T](BaseModel):
    items: list[T]
    total: int


class TaskCreated(BaseModel):
    kind: Literal["created"] = "created"
    task_id: UUID


class TaskDeleted(BaseModel):
    kind: Literal["deleted"] = "deleted"
    task_id: UUID
    reason: str


type TaskEvent = Annotated[TaskCreated | TaskDeleted, Field(discriminator="kind")]


class EventBatch(BaseModel):
    events: list[TaskEvent]


class TagList(RootModel[list[str]]):
    pass


TASK_EVENTS: TypeAdapter[list[TaskEvent]] = TypeAdapter(list[TaskEvent])  # build once

tid: UUID = uuid4()
events: list[TaskEvent] = TASK_EVENTS.validate_json(f'[{{"kind": "created", "task_id": "{tid}"}}]')
match events[0]:
    case TaskCreated(task_id=created_id):
        assert created_id == tid
    case TaskDeleted():
        raise AssertionError
page: Page[TaskCreated] = Page[TaskCreated](items=[TaskCreated(task_id=tid)], total=1)
tags: TagList = TagList.model_validate_json('["a", "b"]')
assert tags.root == ["a", "b"]
```

## Boundaries: ORM rows, settings, foreign types and tests

### `from_attributes` turns lazy-load errors into validation errors, and swallows `AttributeError`

The documented ORM path is `from_attributes=True` with `Model.model_validate(orm_obj)`, applied recursively to nested models ([Models: arbitrary class instances](https://pydantic.dev/docs/validation/latest/concepts/models/)). Pydantic reads attributes with `getattr`, so every relationship field an entity declares triggers SQLAlchemy's loader. With `lazy="raise"` that read raises, and Pydantic reports any non-`AttributeError` exception as `get_attribute_error` ([Validation errors](https://pydantic.dev/docs/validation/latest/errors/validation_errors/)). Local runs with stand-in classes confirmed this. They also showed something the notes only suspected: **a property raising `AttributeError` is treated as a missing attribute, so a field with a default silently takes the default**. They further showed that a non-dict `Mapping` (the shape of SQLAlchemy's `RowMapping`) is accepted in lax mode but rejected in strict mode with `model_type`.

The resulting rules are as follows:

- An entity that declares a relationship field must be eager-loaded by every facade that validates it. SQLAlchemy recommends `selectinload` for collections and `joinedload` for many-to-one ([SQLAlchemy 2.1 relationship loading](https://docs.sqlalchemy.org/en/21/orm/queryguide/relationships.html)).
- Narrow read models for joins should validate `.mappings()` rows and declare no relationships.
- Validate inside the session, before commit or expiry.
- Add one test that validates an un-eager-loaded row and asserts `get_attribute_error`.

```python
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError


class InvalidRequestError(Exception):
    """Stand-in for sqlalchemy.exc.InvalidRequestError raised by lazy="raise"."""


@dataclass
class TaskRow:
    id: UUID
    title: str


@dataclass
class ProjectRow:
    """Stand-in for a mapped class whose `tasks` relationship was not eager-loaded."""

    id: UUID
    name: str
    _tasks: list[TaskRow] | None = field(default=None)

    @property
    def tasks(self) -> list[TaskRow]:
        if self._tasks is None:
            raise InvalidRequestError("'ProjectRow.tasks' is not available due to lazy='raise'")
        return self._tasks


class EntityModel(BaseModel, frozen=True):
    model_config = ConfigDict(from_attributes=True)


class TaskEntity(EntityModel, frozen=True):
    id: UUID
    title: str


class ProjectEntity(EntityModel, frozen=True):
    id: UUID
    name: str
    tasks: list[TaskEntity]  # every facade returning this must eager-load `tasks`


class ProjectHeader(EntityModel, frozen=True):
    id: UUID
    name: str  # declares no relationship, so never touches one


class RowMappingLike(Mapping[str, object]):
    """Stand-in for sqlalchemy.engine.RowMapping (a non-dict Mapping)."""

    def __init__(self, data: dict[str, object]) -> None:
        self._data: dict[str, object] = data

    def __getitem__(self, key: str) -> object:
        return self._data[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)


class ProjectSummary(BaseModel, frozen=True):
    project_id: UUID
    project_name: str


PROJECT_SUMMARIES: TypeAdapter[list[ProjectSummary]] = TypeAdapter(list[ProjectSummary])

unloaded: ProjectRow = ProjectRow(id=uuid4(), name="Atlas")
assert ProjectHeader.model_validate(unloaded).name == "Atlas"
try:
    ProjectEntity.model_validate(unloaded)
except ValidationError as exc:
    assert exc.errors()[0]["type"] == "get_attribute_error"
rows: list[RowMappingLike] = [RowMappingLike({"project_id": uuid4(), "project_name": "Atlas"})]
assert PROJECT_SUMMARIES.validate_python(rows)[0].project_name == "Atlas"
```

This example uses stand-ins because SQLAlchemy could not be installed. The equivalent real facade is `ProjectEntity.model_validate(session.scalars(select(ProjectDB).options(selectinload(ProjectDB.tasks))).one())`. That call was neither type-checked nor run.

### Settings: `BaseSettings` is official, a validated `BaseModel` is pyright-clean

**Option 1 is `BaseSettings`, which the docs steer toward.** It adds `env_prefix`, nested delimiters, dotenv files with "Environment variables will always take priority", secrets directories, CLI parsing and pluggable sources. "Unlike regular `BaseModel`, `BaseSettings` validates default values by default" ([pydantic-settings](https://pydantic.dev/docs/validation/latest/concepts/pydantic_settings/)). Its cost under pyright is that `Settings()` with required fields looks like a call with missing arguments. The maintainers' only fix is the mypy plugin, and the issue remains open ([pydantic-settings#164](https://github.com/pydantic/pydantic-settings/issues/164)).

**Option 2 is a plain `BaseModel` validated from `os.environ`.** It avoids that cost if the env strings are fed in as *validation input*, rather than through `default_factory=lambda: os.getenv(...)`. Default factories are not validated on a `BaseModel` (`validate_default` defaults to `False`), and a lambda typed `str | None` does not fit a `bool` field. Validating the mapping lets Pydantic parse the strings instead. Locally, the accepted `bool` strings were `0/1, f/t, n/y, no/yes, off/on, false/true` in any case; `""`, `"2"` and `" true"` were rejected. The trade-off is giving up dotenv, secrets directories and CLI support, or rebuilding them yourself.

```python
import os
from collections.abc import Mapping
from enum import StrEnum
from typing import Annotated, ClassVar, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, SecretStr, ValidationError


class AppEnv(StrEnum):
    DEV = "dev"
    TEST = "test"
    PROD = "prod"


class EnvVars(BaseModel, frozen=True):
    model_config = ConfigDict(extra="ignore", validate_default=True, hide_input_in_errors=True)

    app_env: Annotated[AppEnv, Field(validation_alias="APP_ENV")] = AppEnv.DEV
    debug: Annotated[bool, Field(validation_alias="DEBUG")] = False
    db_url: Annotated[SecretStr, Field(validation_alias="DATABASE_URL")]
    db_pool_size: Annotated[int, Field(gt=0, le=100, validation_alias="DB_POOL_SIZE")] = 5
    api_base_url: Annotated[AnyHttpUrl, Field(validation_alias="API_BASE_URL")]

    @classmethod
    def from_environ(cls, environ: Mapping[str, str] | None = None) -> Self:
        source: Mapping[str, str] = os.environ if environ is None else environ
        return cls.model_validate(dict(source))


class EnvVarManager:
    _instance: ClassVar[EnvVars | None] = None

    @classmethod
    def get(cls) -> EnvVars:
        if cls._instance is None:
            cls._instance = EnvVars.from_environ()
        return cls._instance

    @classmethod
    def reset_for_tests(cls, environ: Mapping[str, str]) -> EnvVars:
        cls._instance = EnvVars.from_environ(environ)
        return cls._instance


env: EnvVars = EnvVarManager.reset_for_tests(
    {"APP_ENV": "prod", "DEBUG": "off", "DATABASE_URL": "postgresql://u:pw@db/app", "API_BASE_URL": "https://x.io"}
)
assert env.app_env is AppEnv.PROD and env.debug is False and "pw@" not in repr(env)
try:
    EnvVars.from_environ({"DATABASE_URL": "postgresql://u:pw@db/app", "API_BASE_URL": "x", "DEBUG": "maybe"})
except ValidationError as exc:
    assert {e["type"] for e in exc.errors()} == {"bool_parsing", "url_parsing"}
    assert "pw@" not in str(exc)
```

### Foreign types climb a three-step ladder

The docs order custom-type techniques from simplest to most powerful. "Pydantic provides high level hooks to customize types via `Annotated` like `AfterValidator` and `Field`. Use these when possible." Next comes `__get_pydantic_core_schema__`, either on the type or on a marker class in `Annotated`, or `GetPydanticSchema` for one-offs. Raw pydantic-core schemas are the last resort ([Types: custom types](https://pydantic.dev/docs/validation/latest/concepts/types/)).

For a third-party class such as a GeoAlchemy2 `WKBElement` or `arrow.Arrow`, the documented recipe is an `Annotated[ThirdParty, _Marker]` alias. The marker defines three things that must agree:

- the validation schema, via `json_or_python_schema`;
- the JSON serializer;
- the JSON Schema, via `__get_pydantic_json_schema__`.

Implementing these "you don't need to use `arbitrary_types_allowed`". Marker classes should be `@dataclass(frozen=True)`, because without that "a union such as `Username | None` will raise an error" ([Types](https://pydantic.dev/docs/validation/latest/concepts/types/)). Named, annotated helper functions keep pyright strict clean where lambdas would infer `Any`. The example uses a stand-in class, because neither GeoAlchemy2 nor arrow was installable.

```python
from dataclasses import dataclass
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, GetCoreSchemaHandler, GetJsonSchemaHandler, PlainSerializer
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import core_schema


def _decimal_to_float(value: Decimal) -> float:
    return float(value)


# Step 1: Annotated metadata (here: a per-field opt-out of Decimal-as-string JSON)
type DecimalAsNumber = Annotated[Decimal, PlainSerializer(_decimal_to_float, return_type=float, when_used="json")]


class LegacyPoint:
    """Stand-in for a third-party geometry class (e.g. a GeoAlchemy2 WKBElement)."""

    def __init__(self, x: float, y: float) -> None:
        self.x: float = x
        self.y: float = y

    def to_wkt(self) -> str:
        return f"POINT({self.x} {self.y})"


def _point_from_wkt(value: str) -> LegacyPoint:
    x_text, _, y_text = value.removeprefix("POINT(").removesuffix(")").partition(" ")
    return LegacyPoint(float(x_text), float(y_text))


def _point_to_wkt(value: LegacyPoint) -> str:
    return value.to_wkt()


@dataclass(frozen=True)
class _PointAnnotation:  # Step 2: marker class with core-schema hooks
    @classmethod
    def __get_pydantic_core_schema__(cls, source_type: object, handler: GetCoreSchemaHandler) -> core_schema.CoreSchema:
        from_wkt: core_schema.CoreSchema = core_schema.no_info_after_validator_function(
            _point_from_wkt, core_schema.str_schema(pattern=r"^POINT\(\S+ \S+\)$")
        )
        return core_schema.json_or_python_schema(
            json_schema=from_wkt,
            python_schema=core_schema.union_schema([core_schema.is_instance_schema(LegacyPoint), from_wkt]),
            serialization=core_schema.plain_serializer_function_ser_schema(_point_to_wkt, when_used="json"),
        )

    @classmethod
    def __get_pydantic_json_schema__(
        cls, schema: core_schema.CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        return handler(core_schema.str_schema(pattern=r"^POINT\(\S+ \S+\)$"))


type Point = Annotated[LegacyPoint, _PointAnnotation()]


class Site(BaseModel):
    location: Point
    budget: DecimalAsNumber
    backup: Point | None = None


site: Site = Site.model_validate_json('{"location": "POINT(1.5 2)", "budget": "10.50"}')
assert isinstance(site.model_dump()["location"], LegacyPoint)  # Python mode keeps the object for the ORM
assert site.model_dump(mode="json") == {"location": "POINT(1.5 2.0)", "budget": 10.5, "backup": None}
assert Site.model_json_schema()["$defs"]["Point"]["type"] == "string"  # `type` alias -> named $defs entry
```

Standard-library types need no such work. In JSON mode, `datetime`, `UUID`, `Decimal`, `Path` and IP addresses serialize as strings, and enums as their `.value` ([Standard library types](https://pydantic.dev/docs/validation/latest/api/pydantic/standard_library_types/)). Keep the string form for money. **`Decimal`'s validation schema is `number | string` but its serialization schema is `string`**, so an API's request and response schemas legitimately differ ([JSON Schema](https://pydantic.dev/docs/validation/latest/concepts/json_schema/)).

### Security defaults and tests

The input-side defaults are:

- `extra="forbid"` on request bodies.
- A `str_max_length` ceiling, tightened per field.
- `max_length` on collections.

The docs give no maximum nesting depth or document size, so those limits belong at the ASGI server or proxy. `model_construct()` must "only ever" receive "data which has already been validated, or that you definitely trust". It skips all validation and even ignores `extra="forbid"` ([Models: creating without validation](https://pydantic.dev/docs/validation/latest/concepts/models/#creating-models-without-validation)).

For output, FastAPI's position is "use multiple Pydantic models and inherit freely": an input model, an output model and a storage model off a shared base, with `response_model` filtering the output ([FastAPI extra models](https://fastapi.tiangolo.com/tutorial/extra-models/)). Pydantic's `Field(exclude=True)` and `exclude_if` are the alternative. Both are legitimate. Separate output models make the contract explicit, survive `model_dump(include=...)`, and compose with the non-polymorphic default described earlier. Field exclusion means fewer classes, but `polymorphic_serialization` or `SerializeAsAny` can undo it.

Tests should assert stable error `type` codes rather than messages, and snapshot `model_json_schema()` in **both** `validation` and `serialization` modes, because the two differ ([JSON Schema](https://pydantic.dev/docs/validation/latest/concepts/json_schema/)). **Pydantic v2 still ships no Hypothesis plugin.** The docs say it was "temporarily" removed and name no replacement ([Hypothesis integration](https://pydantic.dev/docs/validation/latest/integrations/dev-tools/hypothesis/)). For factories there are two options:

- **factory-boy** works by calling the model's constructor, so its output is validated like production data.
- **Polyfactory** supports Pydantic models natively through a generic factory class ([Polyfactory](https://polyfactory.litestar.dev/latest/)). Its Pydantic-specific behaviour was not verified.

The following test file passed under pytest 9.1.1 on the local runs.

```python
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pydantic.json_schema import JsonSchemaMode

SNAPSHOT_DIR: Path = Path(__file__).parent / "schemas"


class ProjectCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_max_length=10_000)

    name: str = Field(min_length=1, max_length=120)
    tags: list[str] = Field(default_factory=list[str], max_length=20)


@pytest.mark.parametrize(
    ("payload", "error_type"),
    [
        ({"name": "x", "owner": "y"}, "extra_forbidden"),
        ({"name": ""}, "string_too_short"),
        ({"name": "x", "tags": ["t"] * 21}, "too_long"),
    ],
)
def test_rejects_invalid_payloads(payload: dict[str, Any], error_type: str) -> None:
    with pytest.raises(ValidationError) as excinfo:
        ProjectCreateRequest.model_validate(payload)
    assert [e["type"] for e in excinfo.value.errors()] == [error_type]


@pytest.mark.parametrize("mode", ["validation", "serialization"])
def test_schema_matches_snapshot(mode: JsonSchemaMode) -> None:
    schema: dict[str, Any] = ProjectCreateRequest.model_json_schema(mode=mode)
    path: Path = SNAPSHOT_DIR / f"project_create_request.{mode}.json"
    if not path.exists():  # first run writes the snapshot; commit it
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
    assert json.loads(path.read_text()) == schema
```

## Where the official docs, pyright and third parties disagree

| Topic | Pydantic docs | Pyright / Python docs / third party | Recommendation |
|---|---|---|---|
| `Field` placement | prefer `Annotated[T, Field(...)]` | only assignment-form `default`/`default_factory`/`alias` reach `__init__` | defaults in assignment form, constraints in `Annotated` (the docs' own caveat) |
| `default_factory=list` | fine | pyright sometimes infers `list[Unknown]` | always `default_factory=list[str]` |
| Before-validator input | `Any` (one example: `str`) | Python typing docs: `object` for "any value, type-safe" | `object` plus `match` narrowing |
| `frozen` | `ConfigDict(frozen=True)` in examples; class keyword on the VS Code page | only the class keyword is checked, and it constrains the whole hierarchy | open choice (see the frozen table) |
| `@computed_field` | use explicit `@property` | mypy needs `# type: ignore[prop-decorator]`; pyright needs nothing | `@property`, no ignore |
| `populate_by_name` | not recommended, deprecated in V3 | 2.13.5 emits no warning | migrate to `validate_by_name` + `validate_by_alias` |
| Settings | `BaseSettings` | `Settings()` with required fields fails pyright; the fix is mypy-only | open choice (`BaseSettings` vs validated `BaseModel`) |
| Runtime imports | annotations must resolve at runtime | Ruff's TC rules suggest `TYPE_CHECKING` imports | configure `runtime-evaluated-base-classes` and `runtime-evaluated-decorators` |
| Error messages | examples interpolate the value | `LiteralString` template type forbids it | literal templates, no input in `ctx` |
| Layering | layer-agnostic | FastAPI: separate In/Out/DB models | separate output models by default |

## Conclusion

All of these findings come back to one fact. **A Pydantic model has two contracts: the runtime schema Pydantic builds, and the `__init__` signature pyright synthesizes. Best practice means keeping them aligned, and knowing every point where they come apart.** Those points form a short, closed list:

- coercing constructors;
- alias generators;
- `model_copy(update=...)`;
- `model_construct`;
- `dict[str, Any]` spreads;
- `ConfigDict`-only `frozen`.

A codebase can treat each one as a named exception with a typed wrapper, as `with_amount` does for `model_copy`, rather than scattering `Any` and ignores. The local runs showed the gaps are wider than the docs suggest. Pyright stays silent on `Model(**data)` and on `model_copy`. `validate_assignment` can leave an instance invalid. Pyright's dataclass frozen rules make "frozen everywhere" or "frozen nowhere statically" a hierarchy-level decision, not a per-class one.

Going forward, 2.14 (stable `MISSING`, Python 3.15) and V3 (`serialize_by_alias=True` by default, no V1 shim) both reward code that already uses the 2.11+ alias flags, explicit instance-method after-validators and plain 3.14 annotations, so adopting them now costs nothing later. Before treating this report as final, two checks remain. First, rerun the forward-reference example on a real 3.14 interpreter once a pydantic-core wheel can be installed. Second, run the ORM and settings patterns against the real SQLAlchemy and pydantic-settings packages, which this environment could not install.
