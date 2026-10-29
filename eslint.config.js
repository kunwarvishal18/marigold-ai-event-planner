// ESLint flat config: recommended rules, quality limits, and the layer rules that keep imports
// pointing one way: core ← services ← actions ← ui ← app.js. Formatting is Prettier's job.
import js from "@eslint/js";
import globals from "globals";

/** Blocks imports from the given folders (relative paths, any depth). */
const forbidLayers = (...layers) => [
  "error",
  {
    patterns: layers.map((layer) => ({
      group: [`**/${layer}/*`, `../${layer}/*`, `./${layer}/*`],
      message: `This layer must not depend on ${layer}/. Imports point down: core ← services ← actions ← ui ← app.`,
    })),
  },
];

const qualityRules = {
  eqeqeq: ["error", "smart"],
  "no-implicit-globals": "error",
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-script-url": "error",
  "no-unused-vars": ["error", { args: "none" }],
  "no-empty": ["error", { allowEmptyCatch: false }],
  "no-var": "error",
  "prefer-const": "error",
  "one-var": ["error", "never"],
  "no-shadow": ["error", { builtinGlobals: false }],
  "no-param-reassign": ["error", { props: false }],
  "no-nested-ternary": "off",
  "default-param-last": "error",
  "consistent-return": "error",
  "dot-notation": "error",
  "object-shorthand": ["error", "always"],
  "prefer-template": "error",
  curly: ["error", "multi-line"],
  complexity: ["error", 20],
  "max-depth": ["error", 4],
  "max-params": ["error", 6],
  "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
  "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
};

export default [
  { ignores: ["dist/**", "node_modules/**", "docs/**", "coverage/**", "tests/fixtures/**"] },
  js.configs.recommended,
  {
    files: ["js/**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.browser } },
    rules: qualityRules,
  },
  {
    // Pure logic: no DOM, no browser APIs, no app state. Runs unchanged in Node unit tests.
    files: ["js/core/**/*.js"],
    rules: {
      "no-restricted-imports": forbidLayers("services", "actions", "ui"),
      "no-restricted-globals": [
        "error",
        ...[
          "window",
          "document",
          "localStorage",
          "navigator",
          "location",
          "matchMedia",
          "fetch",
        ].map((name) => ({
          name,
          message: "core/ is pure logic; browser APIs belong in services/ or ui/.",
        })),
      ],
    },
  },
  {
    files: ["js/services/**/*.js"],
    rules: { "no-restricted-imports": forbidLayers("actions", "ui") },
  },
  {
    files: ["js/actions/**/*.js"],
    rules: { "no-restricted-imports": forbidLayers("ui") },
  },
  {
    // The view port is the only way logic reaches the page; logic never touches the DOM itself.
    files: ["js/services/**/*.js", "js/actions/**/*.js"],
    ignores: ["js/services/export.js"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "document", message: "Report through the view port (services/view.js)." },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.js", "tests/**/*.mjs", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node } },
    rules: { "no-unused-vars": ["error", { args: "none" }] },
  },
  {
    // Browser-test callbacks run inside the page; the Claude mock is a plain browser script.
    files: ["tests/e2e/**"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, MarigoldTest: "readonly", axe: "readonly" },
    },
  },
  // The screenshot and benchmark scripts also run callbacks inside the page.
  {
    files: ["scripts/screenshots.mjs", "scripts/bench.mjs"],
    languageOptions: { globals: { ...globals.browser } },
  },
  { files: ["tests/e2e/mock-claude.js"], languageOptions: { sourceType: "script" } },
];
