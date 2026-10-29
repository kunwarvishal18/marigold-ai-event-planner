// Measures how long one task tick takes to save and re-render with many saved plans.
//   node scripts/bench.mjs            (uses dist/marigold-standalone.html; needs Playwright)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(import.meta.url)("playwright");
const SAVED_PLANS = 40;
const RUNS = 5;
const TICKS_PER_RUN = 26;

async function measure(browser) {
  const page = await browser.newPage();
  await page.goto(`file://${path.join(root, "dist/marigold-standalone.html")}`);
  await page.click("#openSample");
  await page.evaluate((count) => {
    const plans = JSON.parse(localStorage.getItem("mg2.plans"));
    const sample = Object.values(plans)[0];
    for (let i = 0; i < count; i++) {
      plans[`copy${i}`] = { ...structuredClone(sample), id: `copy${i}` };
    }
    localStorage.setItem("mg2.plans", JSON.stringify(plans));
  }, SAVED_PLANS);
  await page.click("#tab-timeline");
  const times = await page.evaluate((ticks) => {
    const ids = [...document.querySelectorAll("[data-task]")].slice(0, ticks).map((b) => b.id);
    return ids.map((id) => {
      const start = performance.now();
      document.getElementById(id).click();
      return performance.now() - start;
    });
  }, TICKS_PER_RUN);
  await page.close();
  return times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
}

const browser = await chromium.launch();
const medians = [];
for (let run = 0; run < RUNS; run++) medians.push(await measure(browser));
await browser.close();
medians.sort((a, b) => a - b);
console.log(
  `Task tick (save + re-render) with ${SAVED_PLANS + 1} saved plans: ` +
    `median ${medians[Math.floor(RUNS / 2)].toFixed(1)} ms over ${RUNS} runs`,
);
