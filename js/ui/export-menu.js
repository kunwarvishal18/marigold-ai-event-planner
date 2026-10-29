/**
 * @file The Export menu: file downloads when the host allows them, copy-to-clipboard otherwise.
 */
import { buildCSV, buildPDF, fileBase } from "../services/export.js";
import { state } from "../services/state.js";
import { $, onEach, setHtml } from "./dom.js";
import { toast } from "./toast.js";

/** UTF-8 byte order mark, so spreadsheet apps read non-ASCII text correctly. */
const BOM = "﻿";

const DOWNLOAD_BUTTONS = [
  ["pdf", "Full plan (PDF)"],
  ["budget", "Budget (CSV)"],
  ["vendors", "Vendors (CSV)"],
  ["timeline", "Timeline (CSV)"],
];
const COPY_BUTTONS = [
  ["budget", "Copy budget CSV"],
  ["vendors", "Copy vendors CSV"],
  ["timeline", "Copy timeline CSV"],
];

/** Renders the export options for this view. */
export function renderExport() {
  const body = $("#exportBody");
  const button =
    (attribute) =>
    ([kind, label]) =>
      `<button class="btn ghost small" type="button" ${attribute}="${kind}">${label}</button>`;
  setHtml(
    body,
    state.downloads
      ? DOWNLOAD_BUTTONS.map(button("data-exp")).join("")
      : `${COPY_BUTTONS.map(button("data-copy")).join(
          "",
        )}<span class="hint">File downloads aren't available in this view, so you can copy instead.</span>`,
  );
  onEach("[data-exp]", "click", (element) => exportFile(element.dataset.exp, element), body);
  onEach("[data-copy]", "click", (element) => copyCSV(element.dataset.copy), body);
}

async function copyCSV(kind) {
  try {
    await navigator.clipboard.writeText(buildCSV(state.plan, kind));
    toast("Copied. Paste it into a spreadsheet.");
  } catch {
    toast("Couldn't copy here. Try a different browser view.", true);
  }
}

function exportErrorMessage(error, kind) {
  const code = error?.code;
  if (code === "declined") return "Download cancelled.";
  if (code === "rate_limited") return "A download prompt is already open. Try again in a moment.";
  if (kind === "pdf" && !code) {
    return "Couldn't build the PDF (the PDF library didn't load). CSV exports still work.";
  }
  return "Couldn't save the file in this view.";
}

/**
 * Builds a file and hands it to the host's download prompt.
 * @param {"pdf"|"budget"|"vendors"|"timeline"} kind
 * @param {HTMLButtonElement} button shows "Preparing…" while busy
 */
async function exportFile(kind, button) {
  if (state.busy.exp) return;
  state.busy.exp = true;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    const data = kind === "pdf" ? await buildPDF(state.plan) : BOM + buildCSV(state.plan, kind);
    const suffix = kind === "pdf" ? "plan.pdf" : `${kind}.csv`;
    await state.downloads.save({ filename: `${fileBase(state.plan)}-${suffix}`, data });
    toast("Saved.");
  } catch (error) {
    toast(exportErrorMessage(error, kind), error?.code !== "declined");
  } finally {
    state.busy.exp = false;
    button.disabled = false;
    button.textContent = label;
  }
}
