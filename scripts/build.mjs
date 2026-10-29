// Builds the single-file versions of Marigold from the modular source.
//   node scripts/build.mjs          write dist/marigold-standalone.html and dist/marigold-artifact.html
//   node scripts/build.mjs --check  exit 1 if the files in dist/ are out of date
//
// No dependencies. Each ES module becomes a function scope that returns its exports, and its
// imports become destructuring from the modules it depends on. Modules are ordered so dependencies
// come first; an import cycle is a build error. Supported syntax (enforced here):
//   import { a, b as c } from "./relative/path.js";      (one or more lines)
//   export function | async function | class | const <name>
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const ENTRY = "app";
const IMPORT_PATTERN = /^import\s*\{([^}]*)\}\s*from\s*"(\.{1,2}\/[^"]+)\.js";[ \t]*$/gm;
const EXPORT_PATTERN =
  /^export\s+(?:async\s+)?(?:function\*?\s+|class\s+|const\s+)([A-Za-z_$][\w$]*)/gm;

/** Module id ("core/util") → the variable that holds its exports in the bundle. */
const exportsVar = (id) => `__${id.replace(/[^\w]/g, "_")}`;

/**
 * Parses one module: its imports (resolved to module ids) and exported names.
 * @param {string} id module id relative to js/, without ".js"
 */
function parseModule(id) {
  const source = read(`js/${id}.js`);
  const imports = [...source.matchAll(IMPORT_PATTERN)].map(([, names, path]) => ({
    from: posix.normalize(posix.join(posix.dirname(id), path)),
    names: names
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => {
        const [imported, local = imported] = name.split(/\s+as\s+/);
        return { imported, local };
      }),
  }));
  const body = source.replace(IMPORT_PATTERN, "");
  for (const line of body.split("\n")) {
    if (/^import\s/.test(line)) throw new Error(`${id}.js: unsupported import form: ${line}`);
    if (/^export\s+(default|\{|\*|let|var)/.test(line)) {
      throw new Error(`${id}.js: only "export function|class|const <name>" is supported: ${line}`);
    }
  }
  const exported = [...body.matchAll(EXPORT_PATTERN)].map(([, name]) => name);
  return { id, imports, exported, body: body.replace(/^export\s+/gm, "") };
}

/**
 * The import graph from the entry module, dependencies first. Throws on an import cycle.
 * @returns {Array<ReturnType<typeof parseModule>>}
 */
export function moduleGraph(entry = ENTRY) {
  const done = new Map();
  const visiting = [];
  const visit = (id) => {
    if (done.has(id)) return;
    if (visiting.includes(id)) {
      const cycle = [...visiting.slice(visiting.indexOf(id)), id].join(" → ");
      throw new Error(`Import cycle: ${cycle}`);
    }
    visiting.push(id);
    const module = parseModule(id);
    for (const { from } of module.imports) visit(from);
    visiting.pop();
    done.set(id, module);
  };
  visit(entry);
  return [...done.values()];
}

/** Wraps one module in its own scope. */
function wrapModule(module) {
  const imports = module.imports
    .map(({ from, names }) => {
      const bindings = names
        .map(({ imported, local }) => (imported === local ? imported : `${imported}: ${local}`))
        .join(", ");
      return `const { ${bindings} } = ${exportsVar(from)};`;
    })
    .join("\n");
  const body = `${imports}\n${module.body.trim()}\nreturn { ${module.exported.join(", ")} };`;
  return `// ---- ${module.id}.js ----\nconst ${exportsVar(module.id)} = (() => {\n${body}\n})();`;
}

/** The whole app as one strict-mode script that leaks nothing into globals. */
export function bundle() {
  const modules = moduleGraph();
  const js = `(() => {\n"use strict";\n${modules.map(wrapModule).join("\n")}\n})();\n`;
  return { names: modules.map((m) => m.id), js };
}

const sha256 = (text) => createHash("sha256").update(text).digest("base64");

const CSS_TAG = /<link rel="stylesheet" href="css\/styles\.css"\s*\/?>/;
const JS_TAG = /<script type="module" src="js\/app\.js"><\/script>/;
/** Head tags the Artifact build keeps: the title, the viewport hint and the Google Fonts links. */
const HEAD_TAG = /<title>[\s\S]*?<\/title>|<(?:meta|link)\b[^>]*>/g;
const KEEP_IN_ARTIFACT = /<title>|claude:viewport|fonts\.g/;

export function build() {
  const html = read("index.html");
  const css = read("css/styles.css");
  const { js, names } = bundle();
  if (!CSS_TAG.test(html) || !JS_TAG.test(html)) {
    throw new Error("index.html is missing the stylesheet or module script tag");
  }
  const safeJs = js.replace(/<\/script/gi, "<\\/script");
  const styleBlock = `\n${css}`;
  const inlineScript = `<script>\n${safeJs}</script>`;

  // The standalone file inlines the script and stylesheet, so its CSP allows exactly those two
  // blocks by SHA-256 hash instead of 'self'. No 'unsafe-inline' anywhere.
  for (const directive of ["script-src 'self' ", "style-src 'self' "]) {
    if (!html.includes(directive)) throw new Error(`index.html CSP is missing ${directive.trim()}`);
  }
  const standalone = html
    .replace("script-src 'self' ", `script-src 'sha256-${sha256(`\n${safeJs}`)}' `)
    .replace("style-src 'self' ", `style-src 'sha256-${sha256(styleBlock)}' `)
    .replace(CSS_TAG, () => `<style>${styleBlock}</style>`)
    .replace(JS_TAG, () => inlineScript);

  // The Artifact host adds its own doctype/head/body and CSP, so the artifact build is the page
  // content only, plus the few head tags it still needs.
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  const headKeep = (head.match(HEAD_TAG) || [])
    .filter((tag) => KEEP_IN_ARTIFACT.test(tag) && !/http-equiv/.test(tag))
    .join("\n");
  const artifact = `${headKeep}\n<style>${styleBlock}</style>\n${body.replace(JS_TAG, () => inlineScript).trim()}\n`;
  return { standalone, artifact, names };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { standalone, artifact, names } = build();
  const files = {
    "dist/marigold-standalone.html": standalone,
    "dist/marigold-artifact.html": artifact,
  };
  if (process.argv.includes("--check")) {
    const stale = Object.entries(files)
      .filter(([path, content]) => !existsSync(join(root, path)) || read(path) !== content)
      .map(([path]) => path);
    if (stale.length) {
      console.error(`Out of date, run npm run build: ${stale.join(", ")}`);
      process.exit(1);
    }
    console.log("dist/ is up to date.");
  } else {
    mkdirSync(join(root, "dist"), { recursive: true });
    for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
    console.log(`Built ${Object.keys(files).join(" and ")} from ${names.length} modules.`);
  }
}
