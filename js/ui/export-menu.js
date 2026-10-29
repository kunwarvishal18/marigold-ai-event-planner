/**
 * @file The Export menu: file downloads when the host allows them, copy-to-clipboard otherwise.
 */
import { isOneOf } from "../core/constants.js";
import { errorCode } from "../services/claude.js";
import { buildCSV, buildPDF, fileBase } from "../services/export.js";
import { requirePlan, state } from "../services/state.js";
import { $, onEach, setHtml } from "./dom.js";
import { toast } from "./toast.js";

/** UTF-8 byte order mark, so spreadsheet apps read non-ASCII text correctly. */
const BOM = "﻿";

/** @typedef {"pdf"|"budget"|"vendors"|"timeline"} ExportKind */
/** @typedef {Exclude<ExportKind, "pdf">} CsvKind */

/** @type {readonly CsvKind[]} */
const CSV_KINDS = ["budget", "vendors", "timeline"];
/** @type {readonly ExportKind[]} */
const EXPORT_KINDS = ["pdf", ...CSV_KINDS];

/** @type {Array<[ExportKind, string]>} */
const DOWNLOAD_BUTTONS = [
  ["pdf", "Full plan (PDF)"],
  ["budget", "Budget (CSV)"],
  ["vendors", "Vendors (CSV)"],
  ["timeline", "Timeline (CSV)"],
];
/** @type {Array<[CsvKind, string]>} */
const COPY_BUTTONS = [
  ["budget", "Copy budget CSV"],
  ["vendors", "Copy vendors CSV"],
  ["timeline", "Copy timeline CSV"],
];

/** Renders the export options for this view. */
export function renderExport() {
  const body = $("#exportBody");
  const button =
    (/** @type {string} */ attribute) =>
    (/** @type {[ExportKind, string]} */ [kind, label]) =>
      `<button class="btn ghost small" type="button" ${attribute}="${kind}">${label}</button>`;
  setHtml(
    body,
    state.downloads
      ? DOWNLOAD_BUTTONS.map(button("data-exp")).join("")
      : `${COPY_BUTTONS.map(button("data-copy")).join(
          "",
        )}<span class="hint">File downloads aren't available in this view, so you can copy instead.</span>`,
  );
  onEach(
    "[data-exp]",
    "click",
    (element) => {
      const kind = element.dataset.exp;
      if (isOneOf(kind, EXPORT_KINDS) && element instanceof HTMLButtonElement) {
        exportFile(kind, element);
      }
    },
    body,
  );
  onEach(
    "[data-copy]",
    "click",
    (element) => {
      const kind = element.dataset.copy;
      if (isOneOf(kind, CSV_KINDS)) copyCSV(kind);
    },
    body,
  );
}

/** @param {CsvKind} kind */
async function copyCSV(kind) {
  try {
    await navigator.clipboard.writeText(buildCSV(requirePlan(), kind));
    toast("Copied. Paste it into a spreadsheet.");
  } catch {
    toast("Couldn't copy here. Try a different browser view.", true);
  }
}

/**
 * @param {unknown} error
 * @param {ExportKind} kind
 * @returns {string}
 */
function exportErrorMessage(error, kind) {
  const code = errorCode(error);
  if (code === "declined") return "Download cancelled.";
  if (code === "rate_limited") return "A download prompt is already open. Try again in a moment.";
  if (kind === "pdf" && !code) {
    return "Couldn't build the PDF (the PDF library didn't load). CSV exports still work.";
  }
  return "Couldn't save the file in this view.";
}

/**
 * Builds a file and hands it to the host's download prompt.
 * @param {ExportKind} kind
 * @param {HTMLButtonElement} button shows "Preparing…" while busy
 */
async function exportFile(kind, button) {
  const downloads = state.downloads;
  if (state.busy.exp || !downloads) return;
  const plan = requirePlan();
  state.busy.exp = true;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    const data = kind === "pdf" ? await buildPDF(plan) : BOM + buildCSV(plan, kind);
    const suffix = kind === "pdf" ? "plan.pdf" : `${kind}.csv`;
    await downloads.save({ filename: `${fileBase(plan)}-${suffix}`, data });
    toast("Saved.");
  } catch (error) {
    toast(exportErrorMessage(error, kind), errorCode(error) !== "declined");
  } finally {
    state.busy.exp = false;
    button.disabled = false;
    button.textContent = label;
  }
}
