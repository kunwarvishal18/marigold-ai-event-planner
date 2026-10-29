// Checks that the live jsPDF file on cdnjs matches the SRI hash pinned in js/core/safety.js.
// Run in CI (it needs network access to cdnjs):  node scripts/verify-sri.mjs
import { createHash } from "node:crypto";
import { JSPDF_SRI, JSPDF_URL } from "../js/core/safety.js";

const res = await fetch(JSPDF_URL);
if (!res.ok) {
  console.error(`Could not fetch ${JSPDF_URL}: HTTP ${res.status}`);
  process.exit(1);
}
const body = Buffer.from(await res.arrayBuffer());
const actual = "sha384-" + createHash("sha384").update(body).digest("base64");
if (actual !== JSPDF_SRI) {
  console.error(`SRI mismatch for ${JSPDF_URL}\n  pinned: ${JSPDF_SRI}\n  actual: ${actual}`);
  process.exit(1);
}
console.log(`OK: ${JSPDF_URL} matches ${JSPDF_SRI} (${body.length} bytes)`);
