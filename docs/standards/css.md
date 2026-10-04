# CSS / SCSS Standards

Applies to all styles in `frontend`.

**Stack:** plain CSS processed by PostCSS (`postcss-preset-env`, `postcss-import`,
`autoprefixer`, and `cssnano` in production). Styles use **native CSS nesting** and
**custom properties**; `postcss-preset-env` lowers them for older browsers.

> **SCSS is not part of the default stack.** Native nesting and custom properties cover
> most needs. Add SCSS only for a concrete need (mixins, loops, maps), and follow the
> [SCSS section](#if-scss-is-introduced) when you do.

**Source of truth:** `frontend/postcss.config.js`, `frontend/src/index.css`.

---

## Files and scope

**CSS-1 — A component or page that needs styles has a `styles.css` in its own folder**,
imported as the last import in its `index.tsx`:

```tsx
import { FlexColumn } from '@/layouts';
import './styles.css';
```

**CSS-2 — Global styles live in exactly two files.** `src/index.css` holds the normalize
section, the design tokens on `:root`, element defaults, and utility classes.
`src/app/App.css` holds the app shell. Component stylesheets MUST NOT style bare elements
globally.

**CSS-3 — Divide long files into sections with banner comments:**

```css
/****************************************************************
Global
****************************************************************/
```

---

## Selectors and nesting

**CSS-4 — Scope every component stylesheet under one root selector** that matches the
component's root element: an `id` for a page or singleton (`#project-details`,
`#task-board`), or a class for a reusable component (`.loading-spinner`, `.base-input`).
Nest everything else inside it with `&`:

```css
#task-list {
    border: 0.25rem solid var(--color-border-strong);

    & thead th {
        position: sticky;
        top: 0;
    }

    & tbody tr:nth-child(even) {
        background: var(--color-surface-alt);
    }
}
```

**CSS-5 — Always write the `&` in nested rules** (`& .task`, `&:hover`, `& > span`), and
nest no more than three levels deep.

**CSS-6 — Class names are kebab-case** (`.top-nav-bar`, `.project-card`,
`.view-details-cta`). Modifier and state classes are short adjectives applied alongside
the base class (`.task.done`, `.task.overdue`).

**CSS-7 — IDs are kebab-case and match the component's DOM `id`.** Use IDs only for page
sections and singletons; style reusable components by class.

**CSS-8 — Prefer a shared class to attribute selectors on generated names**
(`[class*="col-"]`). Use attribute selectors only for markup you do not control.

**CSS-9 — Do not use `!important`.** Fix the specificity instead.

---

## Design tokens

**CSS-10 — Define colors and other reused values as custom properties on `:root` in
`index.css`.** Name them `--<category>-<role>[-<variant>]` by purpose, not by appearance:

```css
:root {
    --color-surface: #ffffff;
    --color-surface-alt: #f4f4f6;
    --color-border-strong: #123456;
    --color-accent: #0059ff;
    --color-accent-translucent: rgb(0 89 255 / 0.5);
    --color-error: #dc3545;
    --color-success: #198754;
    --space-md: 1rem;
}
```

**CSS-11 — Component styles MUST use tokens (`var(--color-accent)`) instead of raw color
literals.** Add a token when a new value is needed in more than one place.

**CSS-12 — Write opaque colors as hex and translucent colors as space-separated
`rgb(r g b / a)`.**

**CSS-13 — Support light and dark schemes.** Set `color-scheme: light dark`, and redefine
the tokens (not individual rules) inside `@media (prefers-color-scheme: ...)` in
`index.css`.

---

## Properties and units

**CSS-14 — Order declarations alphabetically within a rule** (`align-items`,
`background`, `border`, `display`, `flex-direction`, …), with custom properties first.

**CSS-15 — Use `rem` for spacing, sizing, and type**; `px` only for hairline borders and
shadows; and `vw`, `vh`, `%`, or `fr` for layout. Prefer `calc()` and tokens over magic
numbers.

**CSS-16 — Use flexbox for one-dimensional layout and grid for two-dimensional layout.**
Shared flex wrappers (`FlexRow` / `FlexColumn` components and their `.flex-row` /
`.flex-column` classes) are defined once.

**CSS-17 — Responsive overrides use a small set of named breakpoints, defined once and
documented in `index.css`** (for example, `max-width: 1024px` for tablet). Place each
`@media` block directly after the rule it modifies, in the same file.

**CSS-18 — Declare animations with `@keyframes` in the file that uses them.** Wrap
decorative motion in `@media (prefers-reduced-motion: no-preference)`.

---

## Formatting

**CSS-19 — Indent CSS with 4 spaces, one declaration per line, with a blank line between
rules.** The oxfmt config overrides `*.css` with `tabWidth: 4`, so this is enforced (see
[formatting-and-linting.md](formatting-and-linting.md) FMT-2).

**CSS-20 — Remove commented-out declarations before merging.** Explanatory comments
(`/* NOTE: ... */`) are fine.

---

## If SCSS is introduced

**CSS-21 — Add `sass` to `frontend` devDependencies and name files `styles.scss`**, following
the same colocation, scoping, and nesting rules above.

**CSS-22 — Keep runtime-themeable values as CSS custom properties.** Use Sass variables
only for build-time constants (such as breakpoints). Define them once in
`src/styles/_tokens.scss` and load them with `@use`, never `@import`.

**CSS-23 — Use mixins only for repeated multi-declaration patterns** (such as a responsive
breakpoint). Do not use `@extend`.
