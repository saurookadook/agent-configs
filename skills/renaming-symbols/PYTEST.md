# Renaming inside a pytest suite

The branch of [`renaming-symbols`](SKILL.md) for test files. Tests hold more capture hazards per line than source does, because pytest resolves several things by name at runtime that a tokenizer sees as ordinary strings.

## Parameter labels are strings that must move

`@pytest.mark.parametrize("value", [...])` binds the string `"value"` to the parameter named `value`. Rename the parameter and the label is orphaned; pytest fails at **collection** with `function uses no argument 'value'`, so the whole module reports as an error rather than a failure.

Let collection find them. Run `pytest --collect-only` after applying and fix what it names. Do not automate this with a pass that rewrites quoted occurrences of renamed names inside a function: the same function body legitimately contains the old word as a config key or a JSON field, and such a pass rewrites those too. That failure is invisible until something downstream reads the key.

One label per meaning. Three parameters all called `value` in one class need three different names and three different labels; a single blanket edit gives all three the first one.

`@pytest.fixture(name="...")` has the same shape.

## A fixture rename is tree-wide, and stops at the tree

Every test that requests a fixture names it as a parameter, so the definition and all consumers move together — scope the row to the test tree. Scope it wider and it reaches identically-named things in `src/`: a `dsn` fixture renamed globally will also rewrite `Settings.dsn`.

## Fakes and stubs are bound to a protocol by name

A stub implementing `Store`, `Source` or a client protocol must keep the method names and keyword-only parameter names of the real thing. A drifted stub does not fail loudly; it stops being called, or silently accepts a call the real object would reject. Before proposing any rename on a fake, read the protocol. Rename the stub's own bookkeeping attributes freely — `self.calls`, `self.seen`, `self.batches` — those belong to the test.

The reverse also holds: when a protocol method is renamed in source, every fake, every partial stub defined inline in a test, and every helper script implementing it must move in the same change.

## Names that repeat across modules are not global

Test modules routinely define their own `CONNECTION`, `STAMP`, `SHIPPED`, `build`, `settings`, `StubAuth`, `FakeData` — same spelling, different values and shapes. Almost every rename in a test suite is file-scoped for this reason. Check for a second definition before scoping any test row wider than one file.

## Assertions on observability are contracts

`captured[0]["landed"]`, `line.get("action") == "..."`, metric names and attribute keys are strings asserting an external contract. They stay fixed even when the local variable feeding them is renamed. A test asserting a log field is the only thing standing between a renamed keyword and a dead dashboard query — so when such a test fails, the source is wrong, not the test.

## Gated tiers need static verification

A tier that needs Docker, a network, or a live credential is deselected on most runs and will carry a broken call indefinitely. After renaming, verify it without running it: parse the tier, collect the methods it calls on each renamed type, and assert every one exists on the real class. `pytest --collect-only` on the tier proves imports and fixtures resolve; it proves nothing about method bodies.
