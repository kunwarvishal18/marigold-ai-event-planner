// Architecture checks: the import graph has no cycles and every import points down a layer.
//   core ← services ← actions ← ui ← app
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { moduleGraph } from "../../scripts/build.mjs";

const LAYER_RANK = { core: 0, services: 1, actions: 2, ui: 3, app: 4 };
const layerOf = (id) => LAYER_RANK[id.split("/")[0]];

test("the app's import graph has no cycles and reaches every module", () => {
  const modules = moduleGraph(); // throws on a cycle
  assert.ok(modules.length >= 40);
  assert.equal(modules.at(-1).id, "app", "the entry module comes last, after its dependencies");
});

test("imports only point to the same or a lower layer", () => {
  const violations = [];
  for (const module of moduleGraph()) {
    for (const { from } of module.imports) {
      if (layerOf(from) > layerOf(module.id)) violations.push(`${module.id} → ${from}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("core modules use no browser APIs, so they run unchanged in Node", () => {
  const browserApi = /\b(document|window|localStorage|navigator|matchMedia)\b/;
  const offenders = moduleGraph()
    .filter((module) => module.id.startsWith("core/"))
    .filter((module) => {
      const code = readFileSync(new URL(`../../js/${module.id}.js`, import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      return browserApi.test(code);
    })
    .map((module) => module.id);
  assert.deepEqual(offenders, []);
});

test("every relative import in scripts/ and tests/ points at a file that exists", () => {
  const dirs = ["scripts", "tests/unit", "tests/e2e"];
  const missing = [];
  for (const dir of dirs) {
    for (const name of readdirSync(new URL(`../../${dir}/`, import.meta.url))) {
      if (!/\.m?js$/.test(name)) continue;
      const file = new URL(`../../${dir}/${name}`, import.meta.url);
      const source = readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");
      for (const [, path] of source.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
        if (!existsSync(new URL(path, file))) missing.push(`${dir}/${name} → ${path}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("every export is used by another module or a test (no dead public API)", () => {
  const sources = new Map();
  const collect = (dir) => {
    for (const entry of readdirSync(new URL(`../../${dir}/`, import.meta.url), {
      withFileTypes: true,
    })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) collect(path);
      else if (/\.m?js$/.test(entry.name)) {
        sources.set(path, readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
      }
    }
  };
  collect("js");
  collect("tests/unit");
  collect("tests/e2e");
  const unused = [];
  for (const [path, source] of sources) {
    if (!path.startsWith("js/")) continue;
    for (const [, name] of source.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)) {
      const usedElsewhere = [...sources].some(
        ([other, text]) => other !== path && new RegExp(`\\b${name}\\b`).test(text),
      );
      if (!usedElsewhere) unused.push(`${path}: ${name}`);
    }
  }
  assert.deepEqual(unused, []);
});
