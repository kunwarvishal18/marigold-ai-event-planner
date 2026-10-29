# Security

Marigold is a client-only app: no server, no database, no API keys. This file lists what it trusts, what it doesn't, the controls in place, and the limits of what has been verified.

## Reporting a problem

Open a GitHub issue without exploit details and ask for a private contact, or use GitHub's private vulnerability reporting if it is enabled for the repository.

## Threat model

| Untrusted input                    | Where it enters       | Controls                                                                                                                                                                                                                                                                                 | Tests                                                                                         |
| ---------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Claude's replies                   | `services/claude.js`  | 200,000-character cap before parsing; strict schema validators (`core/validation.js`); one retry with the reasons; enums, numbers and lengths clamped; replies for a closed plan or an older request are discarded                                                                       | `services.test.js`, `assistant.test.js`, `rules.test.js`; browser "AI safety" checks          |
| Changes Claude proposes            | `core/proposal.js`    | Applied to a copy and shown as a before/after preview; nothing changes until the person presses Apply; money re-fitted to exact totals; committed spend protected; event type, currency and start time accepted only from allow-lists                                                    | `proposal.test.js`, `sanitizer.test.js`; browser "proposal injection" check                   |
| User text sent to Claude           | `services/prompts.js` | Wrapped in named data tags (`fence`), with copies of those tags neutralised; Claude told to treat them as data                                                                                                                                                                           | `services.test.js`; browser prompt-fencing check                                              |
| Browser storage (`localStorage`)   | `services/storage.js` | Every plan rebuilt field by field by `core/plan-sanitizer.js`: unknown fields dropped, enums allow-listed, ids replaced unless short and attribute-safe, money clamped, dependency loops removed. Undo snapshots validated the same way. Unreadable data is backed up, never overwritten | `sanitizer.test.js`, `storage.test.js`; browser "stored injection" and corrupt-storage checks |
| Everything rendered into the page  | `ui/*`                | Every dynamic value goes through `escapeHtml()`; markup has no `style=""` attributes; no `eval`, no inline handlers, no URL navigation from data                                                                                                                                         | Browser XSS checks on AI text, proposals and stored data                                      |
| CSV export opened in a spreadsheet | `services/export.js`  | Text starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`; quotes and commas escaped                                                                                                                                                                                         | `services.test.js`, mutation check                                                            |
| Third-party script (jsPDF)         | `services/export.js`  | Loaded only on PDF export, from a pinned version with a Subresource Integrity hash, `crossorigin="anonymous"`, `referrerpolicy="no-referrer"`. Only plan text is passed to it; `output()` gets a fixed type                                                                              | `core.test.js` (hash matches fixture), browser tampered-file check, CI `verify-sri.mjs`       |

## Browser policy

- **Content-Security-Policy** (`index.html`): `default-src 'self'`; scripts from the page and cdnjs only; styles from the page and Google Fonts only; `connect-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. No `'unsafe-inline'` and no `'unsafe-eval'`. The single-file build allows its inlined script and stylesheet by SHA-256 hash. The claude.ai Artifact build relies on claude.ai's own policy.
- **Referrer policy**: `no-referrer`.

## Dependencies

- **Runtime:** none bundled. jsPDF **4.2.1** is fetched from cdnjs for PDF export. Versions before 4.2.1 have published advisories, including a critical HTML-injection issue in the `output()` options; Marigold never passes user data to `output()`, but it now pins the patched release regardless. The pinned file is kept as `tests/fixtures/jspdf/jspdf.umd.min.js` (MIT licence alongside) so tests run offline and the hash can be checked.
- **Development:** ESLint, `@eslint/js`, `globals`, axe-core and Playwright, pinned in `package-lock.json`. jsPDF is no longer a dev dependency.
- **CI** runs `npm audit --audit-level=high`, re-checks the jsPDF hash against the live cdnjs file, and uses least-privilege permissions (`contents: read`) with no secrets.

## Known limitations

- `npm audit` could not be run in the environment where these changes were made (no registry access); CI runs it on every push.
- The jsPDF 4.2.1 hash was computed from the official GitHub release file. CI's `verify-sri.mjs` confirms the cdnjs file is byte-identical; if it ever isn't, CI fails and PDF export is refused by the browser rather than running an unverified file.
- Plans live in the browser's `localStorage`, readable by anyone with access to that browser profile. Don't store sensitive personal data in event notes.
- Automated tests use a Claude mock. Real Claude behaviour was checked manually (see `TESTING.md`).
