// ESLint flat config: recommended rules plus a few that catch real bugs in this codebase.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/**", "node_modules/**", "docs/**"] },
  js.configs.recommended,
  {
    files: ["js/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.browser } },
    rules: {
      eqeqeq: ["error", "smart"],
      "no-implicit-globals": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-unused-vars": ["error", { args: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "prefer-const": "error",
    },
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.js", "tests/**/*.mjs", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.node } },
    rules: { "no-unused-vars": ["error", { args: "none" }] },
  },
  {
    // Browser-test callbacks run inside the page; the Claude mock is a plain browser script.
    files: ["tests/e2e/**"],
    languageOptions: { globals: { ...globals.browser, MarigoldTest: "readonly", axe: "readonly" } },
  },
  // The screenshot script also runs callbacks inside the page.
  { files: ["scripts/screenshots.mjs"], languageOptions: { globals: { ...globals.browser } } },
  { files: ["tests/e2e/mock-claude.js"], languageOptions: { sourceType: "script" } },
];
