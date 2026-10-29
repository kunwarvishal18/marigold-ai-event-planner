// Mutation spot-check: deliberately breaks safety-critical rules, one at a time, and confirms the
// unit tests notice. Each source file is restored afterwards, even if the run is interrupted.
//   node scripts/mutation-check.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** [description, file, exact text to find, replacement] */
const MUTANTS = [
  [
    "exact budget totals (largest-remainder rounding removed)",
    "js/core/budget.js",
    "amounts[order[k]]++;",
    "amounts[order[k]] += 0;",
  ],
  [
    "committed spend as a floor",
    "js/core/budget.js",
    "const floorOf = targets.map((_, i) => Math.max(0, Math.ceil(+floors[i] || 0)));",
    "const floorOf = targets.map(() => 0);",
  ],
  [
    "money formatter never echoes raw input",
    "js/core/format.js",
    'const label = String(currency)\n      .toUpperCase()\n      .replace(/[^A-Z]/g, "")\n      .slice(0, 3);',
    "const label = String(currency);",
  ],
  [
    "AI proposals can only set a known currency",
    "js/core/proposal.js",
    "valid: (v) => CURRENCIES.includes(v)",
    "valid: () => true",
  ],
  [
    "stored priorities are allow-listed",
    "js/core/plan-sanitizer.js",
    'priority: oneOf(task.priority, PRIORITIES, "medium"),',
    "priority: task.priority,",
  ],
  [
    "CSV formula-injection guard",
    "js/services/export.js",
    "text = `'${text}`;",
    "text = `${text}`;",
  ],
  [
    "one retry with the validator's reasons",
    "js/services/claude.js",
    '{ tier = "default", signal, retries = 1 } = {}',
    '{ tier = "default", signal, retries = 0 } = {}',
  ],
  [
    "circular task dependencies are broken",
    "js/core/scheduler.js",
    "if (seen === VISITING) {",
    "if (seen === VISITING && false) {",
  ],
];

function unitTestsPass() {
  try {
    execFileSync(process.execPath, ["--test", ...listTests()], { cwd: root, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function listTests() {
  return execFileSync("ls", ["tests/unit"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((name) => name.endsWith(".test.js"))
    .map((name) => join("tests/unit", name));
}

if (!unitTestsPass()) {
  console.error("Unit tests fail before any mutation; fix them first.");
  process.exit(1);
}

let survived = 0;
for (const [description, file, find, replace] of MUTANTS) {
  const path = join(root, file);
  const original = readFileSync(path, "utf8");
  if (!original.includes(find)) {
    console.error(`Mutation target not found in ${file}: ${description}`);
    process.exit(1);
  }
  const restore = () => writeFileSync(path, original);
  process.once("SIGINT", restore);
  try {
    writeFileSync(path, original.replace(find, replace));
    const caught = !unitTestsPass();
    if (!caught) survived++;
    console.log(`${caught ? "CAUGHT  " : "SURVIVED"} ${description} (${file})`);
  } finally {
    restore();
    process.removeListener("SIGINT", restore);
  }
}
console.log(`\n${MUTANTS.length - survived}/${MUTANTS.length} mutants caught by the unit tests.`);
process.exit(survived ? 1 : 0);
