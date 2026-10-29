# Changelog

## Unreleased

Code quality release. Behaviour is unchanged: 111 unit tests and 222 browser checks (both builds) pass, and the mutation spot-check still catches 8/8.

### Type safety

- The whole codebase now passes a **strict TypeScript check** of its JSDoc types (`npm run typecheck`, run in CI and by `npm test`). Before this change the same check reported 1,240 errors (missing parameter types, unchecked `null`, `.value` on untyped elements, indexing objects by arbitrary strings).
- Precise types for the plan model, Claude's generated content, proposals, diffs, the health score and the app state. The fixed vocabularies (priorities, origins, sources, chat roles, severities) are `const` lists with derived types, checked with one shared `isOneOf()` / `oneOf()`.
- Untrusted input (Claude replies, storage, proposals) is typed `unknown` and narrowed by the validators. DOM lookups are checked at runtime (`$`, `find`, `field`, `$as` in `ui/dom.js`), and `requirePlan()` replaces unchecked `state.plan` access.
- Host capabilities are checked before use: a non-function `sample` capability now counts as "Claude unavailable" instead of failing on the first request.

### Structure and complexity

- Split `core/risks.js` (health score moved to `core/health.js`), `core/proposal.js` (diff moved to `core/plan-diff.js`) and `ui/vendors-tab.js` (card markup moved to `ui/vendor-card.js`).
- Every function is now at most 60 lines with cyclomatic complexity at most 12 and nesting depth at most 3; ESLint enforces these limits (previously 80, 20 and 4). 19 functions were split, e.g. `buildPlan`, `checkEvent`, `vendorActions`, `applyBudgetChanges`, `briefErrors`, `bindEventDay`.

### Duplication

- One `moneyIn(currency)` formatter replaces eight copies of the same closure; one `commitQuietly()` replaces two local helpers and three inline option objects; one `daysToBook()` rule is shared by the risk check and the vendor card; plan size limits (`PLAN_LIMITS`) are defined once instead of in three files.

### Naming

- Clearer names for analysis and state fields: `sc` → `schedule`, `ev` → `eventDate`, `comps`/`ded`/`got`/`pts` → `components`/`deductions`/`score`/`points`, `alloc`/`contPct` → `allocated`/`contingencyPct`, `openV` → `expandedVendors`, `ctl` → `abortControllers`, `seq` → `requestNumbers`, scenario `b`/`sub`/`days` → `brief`/`summary`/`daysAway`. The stored plan format is unchanged.

### Fixes found by the type check

- `scenarioBrief()` leaked its internal `days` field into the brief it returned.
- An empty "Budget category" choice stored `""` instead of `null` until the next reload.
- The CSV-cell comment contained `@,` which TypeScript 6 parsed as a JSDoc tag.

## 3.4.0 (2026-10-29)

Security, accessibility, testing and efficiency release. No features removed.

### Security

- **Fixed HTML injection through approved AI proposals.** A co-planner proposal could set the currency, start time or event type to arbitrary text, which was later rendered as HTML. These fields now accept only allow-listed values, and the money formatter never echoes an unknown currency code.
- **Fixed HTML injection through stored data.** Ids, priorities, vendor statuses and payments, chat roles, AI risks and dates read from `localStorage` reached the page unchecked. A new `core/plan-sanitizer.js` rebuilds every loaded plan from allow-listed values, and the UI escapes every interpolated value as well.
- **Undo snapshots are validated** before they are restored; an unreadable snapshot is discarded with a message.
- **jsPDF 4.2.1** (was 2.5.1, which has published advisories including a critical one). The pinned file lives in `tests/fixtures/jspdf/`; jsPDF and 19 packages only it needed are gone from the dev dependencies.
- CI now runs `npm audit --audit-level=high`. Added `SECURITY.md`.

### Accessibility

- **Keyboard focus is kept across re-renders** (WCAG 2.4.3). Previously, ticking a task, editing a vendor or applying a proposal sent focus to the page body.
- The conversation is a `role="log"` region that only receives new messages, so screen readers no longer re-read the whole chat after each reply.

### Efficiency

- Cached `Intl` formatters and a parse cache for stored plans: a task tick with 41 saved plans went from 28.2 ms to 18.7 ms (median, `npm run bench`).

### Code quality

- Removed dead and duplicated code (`CSV_KINDS`, a second `plural`), and unexported 23 internal helpers. Selecting an unknown tab is ignored instead of throwing.

### Tests

- Unit tests 83 → 111; coverage 94.4/83.5/92.7% → 99.2/88.2/98.2% (lines/branches/functions); thresholds raised to 95/85/95.
- Browser checks 172 → 222: timeline, vendor, event-day and ideas journeys, keyboard focus, chat log, and both injection paths.
- `npm run test:mutation` breaks 8 safety-critical rules one at a time and fails unless the tests catch each (8/8); runs in CI.

## 3.3.0 (2026-10-29)

Code quality, security and testing release. Behaviour is unchanged; all 172 browser tests pass on both builds.

### Structure

- Split the 16 flat modules into four layers: `core/` (pure logic), `services/`, `actions/` and `ui/`. Imports only point down a layer, so there are no circular imports (previously `ui.js`, `app.js`, `proposals.js`, `storage.js`, `ai.js` and `export.js` imported each other).
- Logic reports to the page through a small view port (`services/view.js`) instead of importing the UI.
- Split `ui.js` (53 KB) into one module per tab or panel; split long functions (risk checks, health score, PDF export, validators, "Do next" scoring).
- Clear names throughout (`state` instead of `S`, `parseIsoDate`, `formatMoney`, `CONTINGENCY_PATTERN`, `SCENARIOS`, …) and named constants instead of magic numbers.
- JSDoc on every exported function, with typedefs for the plan, schedule, proposal and analysis.

### Tooling

- Prettier formatting for all code, styles and markup, with `.editorconfig`; checked in CI.
- Stricter ESLint: complexity, function and file length, parameter count, `no-shadow`, `prefer-template`, plus layer rules that keep `core/` free of browser APIs.
- The bundler now gives each module its own scope, supports sub-folders and multi-line imports, and fails on import cycles.

### Security

- Removed `'unsafe-inline'` from `style-src`. No markup uses `style=""` any more; the standalone build allows its inlined stylesheet by SHA-256 hash.

### Accessibility

- Skip-to-content link; focusable `<main>`.
- `prefers-contrast: more` and `forced-colors` support.
- Completed tasks and checklist items are now visibly struck through (an inline `all: unset` had been hiding the intended style).

### Fixes

- Adding a task that depends on another with an earlier due date no longer throws (a local variable shadowed the title lookup).
- Unknown AI risk severities such as `"constructor"` are rejected.

### Tests

- Unit tests grew from 36 to 82: proposals, storage, the Claude client, AI actions with a fake Claude, apply/undo, export, prompts and architecture rules.
- Coverage thresholds: 90% lines, 80% branches, 85% functions on `core/`, `services/` and `actions/` (currently 94% / 83% / 92%).
