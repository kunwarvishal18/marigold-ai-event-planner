# Changelog

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
