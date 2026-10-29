/**
 * @file Marigold entry point: connects the view, wires the page, restores the last plan and asks
 * the host for Claude.
 *
 * Layers (imports only point down; lint enforces it):
 *   core/     pure planning logic: budget maths, scheduling, risks, validation (no DOM)
 *   services/ app state, storage, the Claude client, prompts, export, the view port
 *   actions/  operations that change the plan (generate, apply, undo, …)
 *   ui/       rendering and event handlers
 *   app.js    start-up
 */
import { EMPTY_BRIEF, openPlan } from "./actions/plans.js";
import { proposeChange } from "./actions/history.js";
import { fitToTotal, pctList } from "./core/budget.js";
import { parseIsoDate } from "./core/dates.js";
import { analyze } from "./core/risks.js";
import { extractJSON } from "./core/safety.js";
import { breakCycles, schedule } from "./core/scheduler.js";
import { validateChat, validateGen } from "./core/validation.js";
import { setConnection } from "./services/claude.js";
import { STORAGE_KEYS, localStore } from "./services/local-store.js";
import { state } from "./services/state.js";
import { getPlan, migrateV1, sanePlan } from "./services/storage.js";
import { connectView, view } from "./services/view.js";
import { bindPage, domView, savedTab } from "./ui/controller.js";

/**
 * Requests one host capability. Each is requested on its own, so a downloads failure can't take
 * the Claude connection down with it.
 * @param {string} name e.g. "sample", "downloads"
 * @returns {Promise<object|null>}
 */
async function useCapability(name) {
  try {
    return window.claude?.use ? await window.claude.use(name) : null;
  } catch {
    return null;
  }
}

/** Restores the last open plan, or shows an empty brief. */
function restoreLastPlan() {
  migrateV1();
  state.tab = savedTab();
  const lastPlan = sanePlan(getPlan(localStore.get(STORAGE_KEYS.lastPlanId, "")));
  if (lastPlan) {
    openPlan(lastPlan);
  } else {
    view.fillForm({ ...EMPTY_BRIEF });
    view.render();
  }
  return lastPlan;
}

/** Connects to Claude and file downloads, if the host offers them. */
async function connectHost(hasPlan) {
  setConnection("checking");
  const [sample, downloads] = await Promise.all([
    useCapability("sample"),
    useCapability("downloads"),
  ]);
  state.sample = sample;
  state.downloads = downloads;
  setConnection(sample ? "on" : "off");
  view.render();
  if (!hasPlan && !sample) {
    view.setFormHint(
      "Claude isn't available in this view, so new plans use templates and are labelled that way.",
    );
  }
}

connectView(domView);
bindPage();
const restored = restoreLastPlan();
connectHost(!!restored);

/** Read-only hooks for the browser tests (tests/e2e). Not used by the app itself. */
window.MarigoldTest = {
  parseISO: parseIsoDate,
  breakCycles,
  fitToTotal,
  pctList,
  schedule,
  analyze,
  validateGen,
  validateChat,
  extractJSON,
  makeProposal: (spec) => proposeChange(spec),
  state: () => state,
};
