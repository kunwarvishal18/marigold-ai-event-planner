// Marigold — export.js
import { pctList } from "./budget.js";
import { analyze } from "./risks.js";
import { JSPDF_SRI, JSPDF_URL } from "./safety.js";
import { S } from "./state.js";
import { toast } from "./ui.js";
import { fmtDate, isNum, iso, moneyPlain, sum } from "./util.js";

/* ============ Export ============ */
export function csvCell(v) { let s = String(v ?? ""); if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
export function buildCSV(kind) {
  const p = S.plan, A = analyze(p), sc = A.sc, cur = p.brief.currency;
  let rows;
  if (kind === "budget") { const pc = pctList(p.budget.map(l => l.amount), p.brief.budget); rows = [["Category", "Share %", `Allocated (${cur})`, `Committed (${cur})`, `Left (${cur})`, "Note"], ...p.budget.map((l, i) => [l.category, pc[i].toFixed(1), l.amount, l.committed || 0, l.amount - (l.committed || 0), l.note]), ["Total", sum(pc).toFixed(1), A.alloc, A.committed, A.alloc - A.committed, ""]]; }
  else if (kind === "vendors") rows = [["Category", "Critical", "Vendor", "Contact", "Status", "Payment", `Estimate (${cur})`, `Quote (${cur})`, "Book by", "Arrival", "Checklist done", "Notes"], ...p.vendors.map(v => [v.category, v.critical ? "Yes" : "No", v.name, v.contact, v.status, v.payment, v.estimate ?? "", v.quote ?? "", sc.vendorDue[v.id] ? iso(sc.vendorDue[v.id]) : "", v.arrival, `${v.checklist.filter(c => c.done).length}/${v.checklist.length}`, v.notes])];
  else rows = [["Due date", "Phase", "Task", "Priority", "Status", "Depends on"], ...p.tasks.slice().sort((a, b) => (sc.due[a.id] || 0) - (sc.due[b.id] || 0)).map(t => [sc.due[t.id] ? iso(sc.due[t.id]) : "", t.phase, t.title, t.priority, t.done ? "Done" : (sc.due[t.id] && sc.due[t.id] < sc.today ? "Overdue" : "Pending"), t.deps.map(d => (p.tasks.find(x => x.id === d) || {}).title).join("; ")])];
  return rows.map(r => r.map(csvCell).join(",")).join("\r\n");
}
export function fileBase() { return (S.plan.brief.name || "event").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "event"; }
export let jsPdfLoading = null;
export function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  return jsPdfLoading ||= new Promise((res, rej) => { const s = document.createElement("script"); s.src = JSPDF_URL; s.integrity = JSPDF_SRI; s.crossOrigin = "anonymous"; s.referrerPolicy = "no-referrer"; s.onload = () => window.jspdf ? res(window.jspdf) : rej(new Error("jsPDF missing")); s.onerror = () => { jsPdfLoading = null; rej(new Error("load failed")); }; document.head.append(s); });
}
// eslint-disable-next-line no-control-regex -- keeps tab, LF and CR on purpose; strips other characters the PDF font cannot draw
export function pdfSafe(s) { return String(s ?? "").replace(/₹/g, "INR ").replace(/[‐-―]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF€]/g, ""); }
export async function buildPDF() {
  const { jsPDF } = await loadJsPDF();
  const p = S.plan, A = analyze(p), sc = A.sc, b = p.brief, cur = b.currency, mp = n => moneyPlain(n, cur);
  const doc = new jsPDF({ unit: "pt", format: "a4" }); const W = 595, M = 48; let y = M;
  const need = h => { if (y + h > 800) { doc.addPage(); y = M; } };
  const text = (s, size = 10, style = "normal", indent = 0) => { doc.setFont("helvetica", style); doc.setFontSize(size); const lines = doc.splitTextToSize(pdfSafe(s), W - 2 * M - indent); for (const ln of lines) { need(size * 1.4); doc.text(ln, M + indent, y); y += size * 1.4; } };
  const h = s => { y += 8; text(s, 14, "bold"); y += 2; };
  text(b.name, 20, "bold");
  text(`${b.type} | ${b.city || "Location not set"} | ${sc.ev ? fmtDate(sc.ev) : "No date"} | ${b.guests} guests | Budget ${mp(b.budget)}`, 10);
  text(`Plan source: ${{ ai: "AI generated", template: "Template", example: "Example (template data)", legacy: "Imported" }[p.source] || p.source}. Exported ${new Date().toLocaleString()}.`, 8);
  if (p.summary) { y += 4; text(p.summary, 10); }
  h(`Health score: ${A.health.score}/100`);
  A.health.comps.forEach(c => text(`${c.name}: ${c.got}/${c.max}${c.ded.length ? " - " + c.ded.map(d => `-${d.pts} ${d.reason}`).join("; ") : ""}`, 9));
  h("Risks"); if (!A.risks.length) text("No rule-based risks found.", 9); A.risks.forEach(r => text(`[${r.sev.toUpperCase()}] ${r.title}: ${r.why} Action: ${r.action}`, 9));
  h("Budget");
  const pc = pctList(p.budget.map(l => l.amount), b.budget);
  p.budget.forEach((l, i) => { need(14); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(pdfSafe(l.category), M, y); doc.text(`${pc[i].toFixed(1)}%`, M + 250, y, { align: "right" }); doc.text(pdfSafe(mp(l.amount)), M + 360, y, { align: "right" }); doc.text(pdfSafe(l.committed ? "committed " + mp(l.committed) : ""), W - M, y, { align: "right" }); y += 13; });
  doc.setFont("helvetica", "bold"); need(14); doc.text("Total", M, y); doc.text(`${sum(pc).toFixed(1)}%`, M + 250, y, { align: "right" }); doc.text(pdfSafe(mp(A.alloc)), M + 360, y, { align: "right" }); doc.text(pdfSafe("committed " + mp(A.committed)), W - M, y, { align: "right" }); y += 14;
  h("Timeline");
  p.tasks.slice().sort((x, z) => (sc.due[x.id] || 0) - (sc.due[z.id] || 0)).forEach(t => text(`${t.done ? "[x]" : "[ ]"} ${sc.due[t.id] ? iso(sc.due[t.id]) : "no date"}  ${t.title} (${t.priority})`, 9));
  h("Vendors");
  p.vendors.forEach(v => { text(`${v.category}${v.critical ? " (critical)" : ""}: ${v.status}, ${v.payment}${v.name ? ", " + v.name : ""}${isNum(v.quote) ? ", quote " + mp(v.quote) : ""}${sc.vendorDue[v.id] ? ", book by " + iso(sc.vendorDue[v.id]) : ""}`, 9, "bold"); v.checklist.forEach(c => text(`${c.done ? "[x]" : "[ ]"} ${c.text}`, 9, "normal", 12)); });
  h("Ideas"); p.ideas.forEach(i => text(`${i.title}: ${i.detail}${i.costLow != null ? ` (est. ${mp(i.costLow)}${i.costHigh != null ? "-" + mp(i.costHigh) : ""}, not a quote)` : ""}`, 9));
  h("Run of show"); p.runOfShow.slice().sort((x, z) => x.time.localeCompare(z.time)).forEach(r => text(`${r.time}  ${r.item}${r.owner ? " - " + r.owner : ""}`, 9));
  return doc.output("blob");
}
export async function exportFile(kind, btn) {
  if (S.busy.exp) return; S.busy.exp = true; const label = btn.textContent; btn.disabled = true; btn.textContent = "Preparing…";
  try {
    const data = kind === "pdf" ? await buildPDF() : "﻿" + buildCSV(kind);
    await S.downloads.save({ filename: `${fileBase()}-${kind === "pdf" ? "plan.pdf" : kind + ".csv"}`, data });
    toast("Saved.");
  } catch (e) {
    const c = e && e.code;
    toast(c === "declined" ? "Download cancelled." : c === "rate_limited" ? "A download prompt is already open. Try again in a moment." : kind === "pdf" && !c ? "Couldn't build the PDF (the PDF library didn't load). CSV exports still work." : "Couldn't save the file in this view.", c !== "declined");
  } finally { S.busy.exp = false; btn.disabled = false; btn.textContent = label; }
}
