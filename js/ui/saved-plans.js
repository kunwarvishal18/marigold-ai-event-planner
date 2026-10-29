/**
 * @file The "Saved plans" list, with storage warnings and two-step delete.
 */
import { deletePlan, openPlan } from "../actions/plans.js";
import { escapeHtml } from "../core/format.js";
import { state } from "../services/state.js";
import { sanePlan } from "../core/plan-sanitizer.js";
import { getPlan, storageState, storedPlanSummary } from "../services/storage.js";
import { $, attrIf, setHtml } from "./dom.js";

/** How long a "Confirm delete" button stays armed. */
const CONFIRM_MS = 4000;

const SOURCE_LABELS = { ai: "AI", example: "Example" };

/** Explains any stored data that is kept but not shown, or why saving is paused. */
function storageNotes(hidden) {
  const notes = [];
  if (storageState.corrupt) {
    notes.push(
      storageState.backupKey
        ? "Saved data on this device couldn't be read. A copy was kept in browser storage under " +
            `"${storageState.backupKey}" before anything new was saved.`
        : "Saved data on this device couldn't be read or backed up, so saving is paused to avoid " +
            "overwriting it.",
    );
  }
  if (hidden.newer) {
    const many = hidden.newer > 1;
    notes.push(
      `${hidden.newer} plan${many ? "s were" : " was"} saved by a newer version of Marigold. ` +
        `${many ? "They are" : "It is"} kept unchanged but not shown.`,
    );
  }
  if (hidden.invalid) {
    const many = hidden.invalid > 1;
    notes.push(
      `${hidden.invalid} saved entr${many ? "ies" : "y"} couldn't be read and ` +
        `${many ? "are" : "is"} kept unchanged but not shown.`,
    );
  }
  return notes.map((note) => `<p class="field-err" role="alert">${escapeHtml(note)}</p>`).join("");
}

function savedItem(plan) {
  const id = plan.id;
  const name = escapeHtml(plan.brief.name);
  const isOpen = state.plan && state.plan.id === plan.id;
  return `<div class="saved-item">
    <button type="button" class="linkbtn" data-open="${escapeHtml(id)}" ${attrIf(isOpen, 'aria-current="true"')}>${name}</button>
    <span class="btnrow">
      <small>${SOURCE_LABELS[plan.source] || "Template"}</small>
      <button type="button" class="iconbtn" data-del="${escapeHtml(id)}" aria-label="Delete ${name}">Delete</button>
    </span>
  </div>`;
}

/** Re-renders the saved plans list, newest first. */
export function renderSaved() {
  const summary = storedPlanSummary();
  const body = summary.plans.length
    ? summary.plans.map(savedItem).join("")
    : '<p class="hint">No saved plans yet. Plans save automatically once created.</p>';
  setHtml($("#savedList"), storageNotes(summary) + body);
}

/** Wires opening and deleting (delete needs a second click within a few seconds). */
export function bindSavedPlans() {
  $("#savedList").addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-open]");
    if (openButton) {
      const plan = sanePlan(getPlan(openButton.dataset.open));
      if (plan) openPlan(plan);
    }
    const deleteButton = event.target.closest("[data-del]");
    if (deleteButton) confirmOrDelete(deleteButton);
  });
}

function confirmOrDelete(button) {
  if (button.dataset.armed) {
    deletePlan(button.dataset.del);
    return;
  }
  button.dataset.armed = "1";
  button.textContent = "Confirm delete";
  setTimeout(() => {
    if (!button.isConnected) return;
    button.textContent = "Delete";
    delete button.dataset.armed;
  }, CONFIRM_MS);
}
