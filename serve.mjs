// Minimal static server for the modular version (ES modules don't load from file://).
//   node scripts/serve.mjs [port]   then open http://localhost:8080
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED = new Set(["css", "js", "dist", "docs"]);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

export function serve(port = 8080) {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = normalize(join(root, path === "/" ? "index.html" : path));
      // Only the app's own files are served (never node_modules, .git, tests or scripts).
      const top = file.slice(root.length + 1).split(sep)[0];
      if (!file.startsWith(root + sep) || !(file === join(root, "index.html") || ALLOWED.has(top))) { res.writeHead(403).end("Forbidden"); return; }
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(data);
    } catch { res.writeHead(404).end("Not found"); }
  });
  return new Promise(ok => server.listen(port, "127.0.0.1", () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8080;
  await serve(port);
  console.log(`Marigold (modular) at http://localhost:${port}`);
}
