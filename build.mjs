// Builds the single-file versions of Marigold from the modular source.
//   node scripts/build.mjs          write dist/marigold-standalone.html and dist/marigold-artifact.html
//   node scripts/build.mjs --check  exit 1 if the files in dist/ are out of date
// No dependencies: modules are ordered by their imports, import lines are removed, "export " is
// dropped, and everything is wrapped in one strict-mode function so nothing leaks into globals.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(root, p), "utf8");
const IMPORT = /^import\s+\{[^}]*\}\s+from\s+"\.\/([\w-]+)\.js";\s*$/;

// Depth-first post-order from the entry module: dependencies come before the code that uses them.
function order(entry) {
  const seen = new Set(), out = [];
  const visit = name => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const line of read(`js/${name}.js`).split("\n")) { const m = line.match(IMPORT); if (m) visit(m[1]); }
    out.push(name);
  };
  visit(entry);
  return out;
}

export function bundle() {
  const names = order("app");
  const declared = new Map();
  const parts = names.map(name => {
    const lines = read(`js/${name}.js`).split("\n").filter(l => !IMPORT.test(l));
    for (const l of lines) {
      if (/^import\s/.test(l)) throw new Error(`${name}.js: unsupported import form: ${l}`);
      if (/^export\s+(default|\{|\*)/.test(l)) throw new Error(`${name}.js: only "export <declaration>" is supported: ${l}`);
      const m = l.match(/^export\s+(?:async\s+)?(?:function\*?\s+|class\s+|const\s+|let\s+)([A-Za-z_$][\w$]*)/);
      if (m) {
        if (declared.has(m[1])) throw new Error(`Duplicate top-level name "${m[1]}" in ${name}.js and ${declared.get(m[1])}.js`);
        declared.set(m[1], name);
      }
    }
    return `// ---- ${name}.js ----\n` + lines.map(l => l.replace(/^export\s+/, "")).join("\n");
  });
  return { names, js: `(() => {\n"use strict";\n${parts.join("\n")}\n})();\n` };
}

export function build() {
  const html = read("index.html"), css = read("css/styles.css"), { js, names } = bundle();
  const cssTag = '<link rel="stylesheet" href="css/styles.css">', jsTag = '<script type="module" src="js/app.js"></script>';
  if (!html.includes(cssTag) || !html.includes(jsTag)) throw new Error("index.html is missing the stylesheet or module script tag");
  const safeJs = js.replace(/<\/script/gi, "<\\/script");
  // The standalone file inlines the script, so its CSP allows exactly that script by SHA-256 hash instead of 'self'.
  const hash = createHash("sha256").update(`\n${safeJs}`).digest("base64");
  if (!html.includes("script-src 'self' ")) throw new Error("index.html CSP is missing script-src 'self'");
  const standalone = html.replace("script-src 'self' ", `script-src 'sha256-${hash}' `).replace(cssTag, () => `<style>\n${css}</style>`).replace(jsTag, () => `<script>\n${safeJs}</script>`);
  // The Artifact host adds its own doctype/head/body, so the artifact build is the page content only.
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1], body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  const headKeep = head.split("\n").filter(l => /<title>|claude:viewport|fonts\.g/.test(l) && !/http-equiv/.test(l)).join("\n");  // claude.ai applies its own CSP
  const artifact = `${headKeep}\n<style>\n${css}</style>\n${body.replace(jsTag, () => `<script>\n${safeJs}</script>`).trim()}\n`;
  return { standalone, artifact, names };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { standalone, artifact, names } = build();
  const files = { "dist/marigold-standalone.html": standalone, "dist/marigold-artifact.html": artifact };
  if (process.argv.includes("--check")) {
    const stale = Object.entries(files).filter(([p, c]) => !existsSync(join(root, p)) || read(p) !== c).map(([p]) => p);
    if (stale.length) { console.error("Out of date, run npm run build: " + stale.join(", ")); process.exit(1); }
    console.log("dist/ is up to date.");
  } else {
    mkdirSync(join(root, "dist"), { recursive: true });
    for (const [p, c] of Object.entries(files)) writeFileSync(join(root, p), c);
    console.log(`Built ${Object.keys(files).join(" and ")} from ${names.length} modules: ${names.join(", ")}`);
  }
}
