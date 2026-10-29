/**
 * @file Export a plan as CSV (budget, vendors, timeline) or as a PDF summary.
 */
import { pctList } from "../core/budget.js";
import { toIsoDate } from "../core/dates.js";
import { formatDate, formatMoneyPlain } from "../core/format.js";
import { analyze } from "../core/risks.js";
import { JSPDF_SRI, JSPDF_URL } from "../core/safety.js";
import { isNumeric, sum } from "../core/util.js";

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (=, +, -, @, tab, CR) is prefixed
 * with an apostrophe (CSV injection protection); cells with quotes, commas or newlines are quoted.
 * @param {unknown} value
 * @returns {string}
 */
export function csvCell(value) {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Builds a CSV export.
 * @param {import("../core/model.js").Plan} plan
 * @param {"budget"|"vendors"|"timeline"} kind
 * @returns {string} CRLF-separated rows
 */
export function buildCSV(plan, kind) {
  const analysis = analyze(plan);
  const builders = { budget: budgetRows, vendors: vendorRows, timeline: timelineRows };
  const rows = (builders[kind] || timelineRows)(plan, analysis);
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function budgetRows(plan, analysis) {
  const cur = plan.brief.currency;
  const pcts = pctList(
    plan.budget.map((line) => line.amount),
    plan.brief.budget,
  );
  return [
    ["Category", "Share %", `Allocated (${cur})`, `Committed (${cur})`, `Left (${cur})`, "Note"],
    ...plan.budget.map((line, i) => [
      line.category,
      pcts[i].toFixed(1),
      line.amount,
      line.committed || 0,
      line.amount - (line.committed || 0),
      line.note,
    ]),
    [
      "Total",
      sum(pcts).toFixed(1),
      analysis.alloc,
      analysis.committed,
      analysis.alloc - analysis.committed,
      "",
    ],
  ];
}

function vendorRows(plan, analysis) {
  const cur = plan.brief.currency;
  const bookBy = (vendor) => analysis.sc.vendorDue[vendor.id];
  return [
    [
      "Category",
      "Critical",
      "Vendor",
      "Contact",
      "Status",
      "Payment",
      `Estimate (${cur})`,
      `Quote (${cur})`,
      "Book by",
      "Arrival",
      "Checklist done",
      "Notes",
    ],
    ...plan.vendors.map((vendor) => [
      vendor.category,
      vendor.critical ? "Yes" : "No",
      vendor.name,
      vendor.contact,
      vendor.status,
      vendor.payment,
      vendor.estimate ?? "",
      vendor.quote ?? "",
      bookBy(vendor) ? toIsoDate(bookBy(vendor)) : "",
      vendor.arrival,
      `${vendor.checklist.filter((item) => item.done).length}/${vendor.checklist.length}`,
      vendor.notes,
    ]),
  ];
}

function timelineRows(plan, analysis) {
  const sched = analysis.sc;
  const titleOf = (id) => plan.tasks.find((task) => task.id === id)?.title;
  const status = (task) => {
    if (task.done) return "Done";
    return sched.due[task.id] && sched.due[task.id] < sched.today ? "Overdue" : "Pending";
  };
  return [
    ["Due date", "Phase", "Task", "Priority", "Status", "Depends on"],
    ...sortByDue(plan.tasks, sched).map((task) => [
      sched.due[task.id] ? toIsoDate(sched.due[task.id]) : "",
      task.phase,
      task.title,
      task.priority,
      status(task),
      task.deps.map(titleOf).join("; "),
    ]),
  ];
}

const sortByDue = (tasks, sched) =>
  tasks.slice().sort((a, b) => (sched.due[a.id] || 0) - (sched.due[b.id] || 0));

/**
 * A file-name-safe version of the event name.
 * @param {import("../core/model.js").Plan} plan
 * @returns {string}
 */
export function fileBase(plan) {
  const base = (plan.brief.name || "event")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return base || "event";
}

let jsPdfLoading = null;

/**
 * Loads jsPDF from the CDN once, checked against its pinned integrity hash.
 * @returns {Promise<object>} the jspdf namespace
 */
export function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  jsPdfLoading ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = JSPDF_URL;
    script.integrity = JSPDF_SRI;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";
    script.onload = () =>
      window.jspdf ? resolve(window.jspdf) : reject(new Error("jsPDF missing"));
    script.onerror = () => {
      jsPdfLoading = null;
      reject(new Error("load failed"));
    };
    document.head.append(script);
  });
  return jsPdfLoading;
}

/**
 * Makes text drawable by jsPDF's built-in Helvetica (Latin-1): replaces typographic characters and
 * the rupee sign, strips accents and drops anything else the font can't draw.
 * @param {unknown} text
 * @returns {string}
 */
export function pdfSafe(text) {
  return (
    String(text ?? "")
      .replace(/₹/g, "INR ")
      .replace(/[‐-―]/g, "-")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/…/g, "...")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      // eslint-disable-next-line no-control-regex -- keeps tab, LF and CR on purpose
      .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF€]/g, "")
  );
}

const PAGE_WIDTH = 595;
const MARGIN = 48;
const PAGE_BOTTOM = 800;
const SOURCE_LABELS = {
  ai: "AI generated",
  template: "Template",
  example: "Example (template data)",
  legacy: "Imported",
};

/** A small cursor-based writer over a jsPDF document. */
class PdfWriter {
  constructor(doc) {
    this.doc = doc;
    this.y = MARGIN;
  }

  ensureSpace(height) {
    if (this.y + height > PAGE_BOTTOM) {
      this.doc.addPage();
      this.y = MARGIN;
    }
  }

  text(content, size = 10, style = "normal", indent = 0) {
    this.doc.setFont("helvetica", style);
    this.doc.setFontSize(size);
    const width = PAGE_WIDTH - 2 * MARGIN - indent;
    for (const line of this.doc.splitTextToSize(pdfSafe(content), width)) {
      this.ensureSpace(size * 1.4);
      this.doc.text(line, MARGIN + indent, this.y);
      this.y += size * 1.4;
    }
  }

  heading(content) {
    this.y += 8;
    this.text(content, 14, "bold");
    this.y += 2;
  }

  /** One budget table row: category, share, amount, committed note. */
  budgetRow(cells, rowHeight) {
    const [category, share, amount, committed] = cells.map(pdfSafe);
    this.ensureSpace(14);
    this.doc.text(category, MARGIN, this.y);
    this.doc.text(share, MARGIN + 250, this.y, { align: "right" });
    this.doc.text(amount, MARGIN + 360, this.y, { align: "right" });
    this.doc.text(committed, PAGE_WIDTH - MARGIN, this.y, { align: "right" });
    this.y += rowHeight;
  }
}

/**
 * Builds the PDF summary of a plan.
 * @param {import("../core/model.js").Plan} plan
 * @returns {Promise<Blob>}
 */
export async function buildPDF(plan) {
  const { jsPDF } = await loadJsPDF();
  const analysis = analyze(plan);
  const money = (amount) => formatMoneyPlain(amount, plan.brief.currency);
  const pdf = new PdfWriter(new jsPDF({ unit: "pt", format: "a4" }));
  writeTitle(pdf, plan, analysis.sc, money);
  writeHealthAndRisks(pdf, analysis);
  writeBudgetTable(pdf, plan, analysis, money);
  writeTimeline(pdf, plan, analysis.sc);
  writeVendors(pdf, plan, analysis.sc, money);
  writeIdeasAndRunOfShow(pdf, plan, money);
  return pdf.doc.output("blob");
}

function writeTitle(pdf, plan, sched, money) {
  const { brief } = plan;
  pdf.text(brief.name, 20, "bold");
  const date = sched.ev ? formatDate(sched.ev) : "No date";
  pdf.text(
    `${brief.type} | ${brief.city || "Location not set"} | ${date} | ${brief.guests} guests | ` +
      `Budget ${money(brief.budget)}`,
    10,
  );
  const source = SOURCE_LABELS[plan.source] || plan.source;
  pdf.text(`Plan source: ${source}. Exported ${new Date().toLocaleString()}.`, 8);
  if (plan.summary) {
    pdf.y += 4;
    pdf.text(plan.summary, 10);
  }
}

function writeHealthAndRisks(pdf, analysis) {
  pdf.heading(`Health score: ${analysis.health.score}/100`);
  for (const comp of analysis.health.comps) {
    const deductions = comp.ded.length
      ? ` - ${comp.ded.map((d) => `-${d.pts} ${d.reason}`).join("; ")}`
      : "";
    pdf.text(`${comp.name}: ${comp.got}/${comp.max}${deductions}`, 9);
  }
  pdf.heading("Risks");
  if (!analysis.risks.length) pdf.text("No rule-based risks found.", 9);
  for (const risk of analysis.risks) {
    pdf.text(`[${risk.sev.toUpperCase()}] ${risk.title}: ${risk.why} Action: ${risk.action}`, 9);
  }
}

function writeTimeline(pdf, plan, sched) {
  pdf.heading("Timeline");
  for (const task of sortByDue(plan.tasks, sched)) {
    const due = sched.due[task.id] ? toIsoDate(sched.due[task.id]) : "no date";
    pdf.text(`${task.done ? "[x]" : "[ ]"} ${due}  ${task.title} (${task.priority})`, 9);
  }
}

function writeVendors(pdf, plan, sched, money) {
  pdf.heading("Vendors");
  for (const vendor of plan.vendors) {
    const details = [
      vendor.critical ? " (critical)" : "",
      `: ${vendor.status}, ${vendor.payment}`,
      vendor.name ? `, ${vendor.name}` : "",
      isNumeric(vendor.quote) ? `, quote ${money(vendor.quote)}` : "",
      sched.vendorDue[vendor.id] ? `, book by ${toIsoDate(sched.vendorDue[vendor.id])}` : "",
    ].join("");
    pdf.text(`${vendor.category}${details}`, 9, "bold");
    for (const item of vendor.checklist) {
      pdf.text(`${item.done ? "[x]" : "[ ]"} ${item.text}`, 9, "normal", 12);
    }
  }
}

function writeIdeasAndRunOfShow(pdf, plan, money) {
  pdf.heading("Ideas");
  for (const idea of plan.ideas) {
    let cost = "";
    if (idea.costLow != null) {
      const high = idea.costHigh != null ? `-${money(idea.costHigh)}` : "";
      cost = ` (est. ${money(idea.costLow)}${high}, not a quote)`;
    }
    pdf.text(`${idea.title}: ${idea.detail}${cost}`, 9);
  }
  pdf.heading("Run of show");
  const runOfShow = plan.runOfShow.slice().sort((a, b) => a.time.localeCompare(b.time));
  for (const row of runOfShow) {
    pdf.text(`${row.time}  ${row.item}${row.owner ? ` - ${row.owner}` : ""}`, 9);
  }
}

function writeBudgetTable(pdf, plan, analysis, money) {
  pdf.heading("Budget");
  const pcts = pctList(
    plan.budget.map((line) => line.amount),
    plan.brief.budget,
  );
  plan.budget.forEach((line, i) => {
    pdf.doc.setFont("helvetica", "normal");
    pdf.doc.setFontSize(9);
    const committed = line.committed ? `committed ${money(line.committed)}` : "";
    pdf.budgetRow([line.category, `${pcts[i].toFixed(1)}%`, money(line.amount), committed], 13);
  });
  pdf.doc.setFont("helvetica", "bold");
  pdf.budgetRow(
    [
      "Total",
      `${sum(pcts).toFixed(1)}%`,
      money(analysis.alloc),
      `committed ${money(analysis.committed)}`,
    ],
    14,
  );
}
