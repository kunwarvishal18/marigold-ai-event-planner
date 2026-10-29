/**
 * @file Page-level event wiring (the parts of the page that exist from the start) and the DOM
 * implementation of the view port.
 */
import { undo } from "../actions/history.js";
import { newEvent, openSample } from "../actions/plans.js";
import { escapeHtml } from "../core/format.js";
import { isOneOf } from "../core/constants.js";
import { SCENARIOS, scenarioBrief } from "../core/scenarios.js";
import { isClaudeOn } from "../services/claude.js";
import { STORAGE_KEYS, localStore } from "../services/local-store.js";
import { state } from "../services/state.js";
import { bindChat, clearChatInput } from "./chat-tab.js";
import { $, $$, closestTo, onEach, setHtml, showInlineError } from "./dom.js";
import { refreshCountdown } from "./eventday-tab.js";
import {
  fillForm,
  setFormHint,
  showGenerationError,
  showGenerationProgress,
  submitBrief,
} from "./form.js";
import { revealProposal } from "./proposal-panel.js";
import { TABS, renderAll, renderConnection, renderSection, selectTab } from "./render.js";
import { bindSavedPlans } from "./saved-plans.js";
import { toast } from "./toast.js";

const COUNTDOWN_REFRESH_MS = 30_000;
const TAB_KEYS = ["ArrowLeft", "ArrowRight", "Home", "End"];

/**
 * The DOM implementation of the view port (see services/view.js).
 * @type {import("../services/view.js").ViewPort}
 */
export const domView = {
  render: renderAll,
  renderSection,
  toast,
  fillForm,
  setConnection: renderConnection,
  revealProposal,
  setFormHint,
  showInlineError,
  showGenerationProgress,
  showGenerationError,
  clearChatInput,
};

/**
 * The tab reached from `current` by an arrow, Home or End key (wrapping around).
 * @param {string} key
 * @param {string} current
 * @returns {string}
 */
function tabForKey(key, current) {
  if (key === "Home") return TABS[0];
  if (key === "End") return TABS[TABS.length - 1];
  const step = key === "ArrowRight" ? 1 : -1;
  const index = (TABS.findIndex((tab) => tab === current) + step + TABS.length) % TABS.length;
  return TABS[index];
}

function bindBriefForm() {
  onEach("#types button", "click", (button) => {
    state.type = button.dataset.type || state.type;
    for (const other of $$("#types button")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
  });
  $("#brief").addEventListener("submit", (event) => {
    event.preventDefault();
    submitBrief();
  });
  $("#newEventBtn").addEventListener("click", () => {
    newEvent();
    $("#f-name").focus();
  });
}

function bindWelcome() {
  $("#openSample").addEventListener("click", openSample);
  $("#startOwn").addEventListener("click", () => $("#f-name").focus());
  setHtml(
    $("#scenarios"),
    SCENARIOS.map(
      (scenario, i) =>
        `<button type="button" data-scen="${i}"><b>${escapeHtml(scenario.label)}</b><span>${escapeHtml(scenario.summary)}</span></button>`,
    ).join(""),
  );
  onEach("[data-scen]", "click", (button) => {
    const scenario = SCENARIOS[Number(button.dataset.scen)];
    if (!scenario) return;
    fillForm(scenarioBrief(scenario));
    const next = isClaudeOn() ? "Press Generate plan with AI." : "Press Create template plan.";
    setFormHint(`Brief filled with the ${scenario.label} scenario. ${next}`);
    $("#f-name").focus();
  });
}

/** Tabs follow the WAI-ARIA tabs pattern: arrows, Home and End move focus and selection. */
function bindTabs() {
  $("#tabs").addEventListener("click", (event) => {
    const name = closestTo(event, "[role=tab]")?.dataset.tab;
    if (!name) return;
    localStore.set(STORAGE_KEYS.tab, name);
    selectTab(name);
  });
  $("#tabs").addEventListener("keydown", (event) => {
    if (!TAB_KEYS.includes(event.key)) return;
    event.preventDefault();
    selectTab(tabForKey(event.key, state.tab), { focus: true });
  });
  // Links inside the plan ("Open budget", "Do next" items) jump to a tab.
  $("#planView").addEventListener("click", (event) => {
    const target = closestTo(event, "[data-goto]")?.dataset.goto;
    if (target) selectTab(target, { focus: true });
  });
}

/** Wires every control that is part of the static page. Called once at start-up. */
export function bindPage() {
  bindBriefForm();
  bindWelcome();
  bindSavedPlans();
  bindTabs();
  bindChat();
  $("#undoBtn").addEventListener("click", undo);
  setInterval(refreshCountdown, COUNTDOWN_REFRESH_MS);
}

/** @returns {string} the tab saved from the last visit, if it still exists */
export function savedTab() {
  const tab = localStore.get(STORAGE_KEYS.tab, "overview");
  return isOneOf(tab, TABS) ? tab : "overview";
}
