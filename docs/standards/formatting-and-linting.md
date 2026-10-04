# Formatting and Linting Standards

Applies to every file the formatter or linter can process. The tools enforce these rules;
this document records their configuration and the conventions for suppressing them.

**Tools:** [oxfmt](https://oxc.rs/docs/guide/usage/formatter) (formatter) and
[oxlint](https://oxc.rs/docs/guide/usage/linter/) (linter), both from the Oxc project.

**Source of truth:** `.oxfmtrc.json` and `.oxlintrc.json` at the repository root.

---

## Formatter (oxfmt)

**FMT-1 — oxfmt formats all TypeScript, JavaScript, JSON, CSS, and Markdown.** Do not
hand-format code oxfmt will rewrite, and do not install Prettier alongside it.

**FMT-2 — Use one oxfmt configuration at the repository root:**

```jsonc
// .oxfmtrc.json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "arrowParens": "always",
  "bracketSameLine": false,
  "printWidth": 88,
  "proseWrap": "always",
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "all",
  "useTabs": false,
  "sortImports": {
    "partitionByNewline": true,
    "newlinesBetween": false
  },
  "overrides": [
    { "files": ["*.json"], "options": { "tabWidth": 4, "trailingComma": "none" } },
    { "files": ["*.css"], "options": { "tabWidth": 4 } }
  ]
}
```

- `printWidth` MUST be set explicitly, because oxfmt's default is 100 and the standard
  is 88.
- Leave `sortPackageJson` and `insertFinalNewline` at their defaults (`true`).
- Do not add nested `.oxfmtrc.json` files in workspaces.

**FMT-3 — `sortImports` enforces the import-statement order** from
[typescript.md](typescript.md) TS-32. Blank lines separate the groups, and oxfmt sorts
within each group: Node built-ins, then packages, then `@/` aliases, then relative paths.
Side-effect imports (`import './styles.css'`) are never moved, so keep them last by hand.
oxfmt does not sort the names inside an import's braces; keep those alphabetical
yourself.

**FMT-4 — To keep a short list or argument group on multiple lines, end its first item
with `// force formatting`.** A line comment forces a line break, so the formatter has to
keep the list expanded:

```ts
import {
  ProjectStatus, // force formatting
  TaskStatus,
} from '@/constants';
```

Use it for import lists, module metadata arrays, and destructured parameters where one
item per line reads better. Do not use it to get around `printWidth`.

**FMT-5 — Suppress formatting only for layouts that carry meaning** (aligned boolean
expressions, ASCII diagrams). Put the comment directly above a single statement:

- JS/TS: `// oxfmt-ignore`
- CSS, Markdown, and other non-JS files: `/* prettier-ignore */` or
  `<!-- prettier-ignore -->` (oxfmt recognizes `oxfmt-ignore` only in JS/TS)

---

## Linter (oxlint)

**FMT-6 — oxlint uses one root `.oxlintrc.json`.** It enables the built-in `typescript`,
`react`, `unicorn`, and `oxc` plugins and the type-aware rules, and sets the
`correctness` category to `error`:

```jsonc
// .oxlintrc.json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "react", "unicorn", "oxc"],
  "categories": { "correctness": "error" },
  "env": { "browser": true, "node": true },
  "rules": {
    "eslint/no-case-declarations": "error",
    "react/rules-of-hooks": "error",
    "react/exhaustive-deps": "error",
    "typescript/ban-ts-comment": [
      "error",
      { "ts-expect-error": "allow-with-description", "ts-ignore": true }
    ],
    "typescript/no-explicit-any": "warn",
    "typescript/no-floating-promises": "error",
    "typescript/require-await": "warn",
    "typescript/no-unused-vars": [
      "warn",
      { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "ignoreRestSiblings": true }
    ]
  },
  "overrides": [
    {
      "files": ["frontend/**/*.tsx"],
      "rules": {
        "react/only-export-components": ["warn", { "allowConstantExport": true }]
      }
    },
    {
      "files": ["**/*.test.ts", "**/*.test.tsx", "**/testing/**"],
      "env": { "jest": true, "vitest": true }
    }
  ]
}
```

Listing `plugins` replaces oxlint's default plugin set, so any plugin missing from the
list is off. Enable another category (`suspicious`, `perf`) only as a deliberate,
repo-wide change, never for one file at a time.

**FMT-7 — Type-aware rules require `oxlint-tsgolint`.** Install `oxlint` and
`oxlint-tsgolint` as root devDependencies, and run the linter with `--type-aware`.
Without that flag, `no-floating-promises` and `require-await` do nothing, and
[nodejs.md](nodejs.md) NODE-13 depends on them.

**FMT-8 — Rule severities follow this policy:**

| Rule                              | Setting | Why                                                        |
| --------------------------------- | ------- | ---------------------------------------------------------- |
| `react/rules-of-hooks`            | error   | breaking it causes runtime bugs                            |
| `react/exhaustive-deps`           | error   | [react.md](react.md) REACT-21                              |
| `typescript/no-floating-promises` | error   | [nodejs.md](nodejs.md) NODE-13                             |
| `typescript/ban-ts-comment`       | error   | allows `@ts-expect-error` only with a reason (TS-36)       |
| `typescript/no-explicit-any`      | warn    | [typescript.md](typescript.md) TS-14; warns at the boundary |
| `typescript/require-await`        | warn    |                                                            |
| `typescript/no-unused-vars`       | warn    | ignores names starting with `_`                            |

Change a severity only as a repo-wide decision, and update this table when you do.

**FMT-9 — Prefix intentionally unused parameters and variables with `_`.** Removing them
is better.

**FMT-10 — Disable a rule as narrowly as possible, and always name it.** Start with a
single line: `// oxlint-disable-next-line typescript/no-namespace`. Use a file-level
`/* oxlint-disable <rule>, <rule> */` at the very top only when the whole file needs it
(custom matcher files need `typescript/no-namespace`). Never disable all rules, and
use the `oxlint-` form rather than `eslint-disable`.

---

## Scripts and CI

**FMT-11 — Formatting and linting run from the repository root** across every workspace:

```jsonc
// package.json
"scripts": {
  "format": "oxfmt",
  "format:check": "oxfmt --check",
  "lint": "oxlint --type-aware",
  "lint:fix": "oxlint --type-aware --fix"
}
```

CI runs `pnpm format:check` and `pnpm lint --deny-warnings`.

**FMT-12 — New code MUST NOT add warnings.** Run `pnpm format` and `pnpm lint` before
opening a PR.

**FMT-13 — Do not add ESLint or Prettier packages or configs.** If you need a rule oxlint
does not have, load the ESLint plugin through `jsPlugins` in `.oxlintrc.json`. Do not add
a second linter.

---

## Editor

**FMT-14 — Use the Oxc editor extension** for format-on-save and inline lint errors, and
disable the Prettier and ESLint extensions for this workspace. Commit shared editor
settings as `*.example.json` files (`.vscode/settings.example.json`), and keep personal
settings untracked. You MAY commit `launch.json` for shared debug configurations.
