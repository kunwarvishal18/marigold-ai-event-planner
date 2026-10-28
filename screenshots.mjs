// Captures README screenshots from the real standalone build (example data, rule-based features, no Claude).
//   node scripts/screenshots.mjs
import { createRequire } from "node:module";
import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(import.meta.url)("playwright");
const out = n => path.join(root, "docs/screenshots", n);
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 860 } });
await pg.goto("file://" + path.join(root, "dist/marigold-standalone.html")); await pg.waitForTimeout(400);
await pg.click("#openSample"); await pg.waitForTimeout(200);
await pg.screenshot({ path: out("overview.png") });
await pg.click("#tab-vendors"); await pg.waitForTimeout(100); await pg.screenshot({ path: out("vendors.png") });
await pg.click("#tab-budget"); await pg.click('[data-save="10"]'); await pg.waitForSelector("#applyBtn");
await pg.locator("#proposalHost").scrollIntoViewIfNeeded(); await pg.screenshot({ path: out("proposal.png") });
await pg.click("#rejectBtn"); await pg.evaluate(() => { document.querySelector("#toast").hidden = true; });
await pg.setViewportSize({ width: 390, height: 844 }); await pg.click("#tab-overview"); await pg.evaluate(() => scrollTo(0, document.querySelector("#planView").offsetTop - 8)); await pg.waitForTimeout(100);
await pg.screenshot({ path: out("mobile.png") });
await b.close();
console.log("Saved 4 screenshots to docs/screenshots/");
