/**
 * @file Top-level rendering: the plan header, stats, tabs, and the connection chip. Everything is
 * rendered from the app state; only the visible tab panel is rebuilt.
 */
import { isBooked, isOneOf } from "../core/constants.js";
import { escapeHtml, formatDate, moneyIn } from "../core/format.js";
import { parseIsoDate } from "../core/dates.js";
import { analyze } from "../core/risks.js";
import { state } from "../services/state.js";
import { sourceBadge } from "./badges.js";
import { renderBudget } from "./budget-tab.js";
import { renderChat } from "./chat-tab.js";
import { $, $$, $as, setHtml } from "./dom.js";
import { renderEventDay } from "./eventday-tab.js";
import { renderExport } from "./export-menu.js";
import { preserveFocus } from "./focus.js";
import { renderForm } from "./form.js";
import { renderIdeas } from "./ideas-tab.js";
import { renderOverview } from "./overview-tab.js";
import { renderProposal } from "./proposal-panel.js";
import { renderSaved } from "./saved-plans.js";
import { renderTimeline } from "./timeline-tab.js";
import { renderVendors } from "./vendors-tab.js";

/** @typedef {import("../core/model.js").Plan} Plan */
/** @typedef {import("../core/risks.js").Analysis} Analysis */

/** Plan tabs, in display order. */
export const TABS = /** @type {const} */ ([
  "overview",
  "budget",
  "timeline",
  "vendors",
  "ideas",
  "eventday",
  "chat",
]);

/**
 * How each tab panel is rendered.
 * @type {Record<typeof TABS[number], (analysis: Analysis) => void>}
 */
const PANEL_RENDERERS = {
  overview: renderOverview,
  budget: renderBudget,
  timeline: renderTimeline,
  vendors: renderVendors,
  ideas: () => renderIdeas(),
  eventday: renderEventDay,
  chat: () => renderChat(),
};

const CONNECTION_TEXT = {
  checking: "Checking Claude connection…",
  on: "Claude connected",
  off: "Template mode: Claude isn't available here",
  declined: "Template mode: Claude access declined",
};

/**
 * Updates the Claude status chip.
 * @param {"checking"|"on"|"off"|"declined"} status
 */
export function renderConnection(status) {
  let dotClass = "dot off";
  if (status === "on") dotClass = "dot on";
  else if (status === "checking") dotClass = "dot";
  $("#aiDot").className = dotClass;
  $("#aiText").textContent = CONNECTION_TEXT[status];
}

/** @param {Plan} plan */
function renderHeader(plan) {
  const { brief } = plan;
  const edited = plan.log.some((entry) => entry.text.startsWith("Applied"));
  setHtml(
    $("#badges"),
    sourceBadge(plan.source) + (edited ? ' <span class="badge">Edited with approvals</span>' : ""),
  );
  const city = brief.city ? ` · ${brief.city}` : "";
  const date = brief.date ? ` · ${formatDate(parseIsoDate(brief.date))}` : "";
  $("#pType").textContent = `${brief.type}${city}${date}`;
  $("#pTitle").textContent = brief.name;
  $("#pSummary").textContent =
    plan.summary ||
    (plan.source === "ai"
      ? ""
      : "A starter plan built from Marigold's standard template for this event type. Generate with AI to personalise it to your brief.");

  const undoButton = $as(HTMLButtonElement, "#undoBtn");
  undoButton.disabled = !plan.history.length;
  undoButton.textContent = plan.history.length ? `Undo: ${plan.history[0].title}` : "Undo";
  undoButton.title = undoButton.textContent;
}

/**
 * @param {Plan} plan
 * @param {Analysis} analysis
 */
function renderStats(plan, analysis) {
  const { brief } = plan;
  const { daysLeft } = analysis.schedule;
  const money = moneyIn(brief.currency);
  const stats = [
    [daysLeft == null ? "—" : daysLeft >= 0 ? daysLeft : "Passed", "days to go"],
    [`${analysis.health.score}/100`, "health score"],
    [money(brief.budget), `budget · ${money(brief.budget / Math.max(1, brief.guests))}/guest`],
    [`${plan.tasks.filter((task) => task.done).length}/${plan.tasks.length}`, "tasks done"],
    [`${plan.vendors.filter(isBooked).length}/${plan.vendors.length}`, "vendors booked"],
  ];
  setHtml(
    $("#stats"),
    stats
      .map(
        ([value, label]) =>
          `<div class="stat"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`,
      )
      .join(""),
  );
}

/** @param {Analysis} analysis */
function renderTabs(analysis) {
  const urgent = analysis.risks.filter((r) => r.sev === "critical" || r.sev === "high").length;
  setHtml(
    $("#tab-overview"),
    `Overview${urgent ? `<span class="count" aria-label="${urgent} high or critical risks">${urgent}</span>` : ""}`,
  );
  for (const tab of $$("#tabs [role=tab]")) {
    const selected = tab.dataset.tab === state.tab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const name of TABS) $(`#panel-${name}`).hidden = name !== state.tab;
}

/** Re-renders the whole page from state, keeping keyboard focus in place. */
export function renderAll() {
  preserveFocus(renderPage);
}

function renderPage() {
  const plan = state.plan;
  $("#layout").classList.toggle("has-plan", !!plan);
  $("#welcome").hidden = !!plan;
  $("#planView").hidden = !plan;
  renderForm();
  renderSaved();
  if (!plan) return;

  const analysis = analyze(plan);
  renderHeader(plan);
  renderStats(plan, analysis);
  renderTabs(analysis);
  renderProposal();
  // Only the visible panel is rebuilt; the others render when their tab is opened.
  (isOneOf(state.tab, TABS) ? PANEL_RENDERERS[state.tab] : PANEL_RENDERERS.overview)(analysis);
  renderExport();
}

/**
 * Re-renders one part of the page (used while a request is in flight).
 * @param {"form"|"saved"|"proposal"|"overview"|"budget"|"ideas"|"chat"} section
 */
export function renderSection(section) {
  preserveFocus(() => {
    if (section === "form") renderForm();
    else if (section === "saved") renderSaved();
    else if (section === "proposal") renderProposal();
    else if (state.plan) {
      PANEL_RENDERERS[section](analyze(state.plan));
    }
  });
}

/**
 * Switches to a tab.
 * @param {string} name one of TABS
 * @param {{focus?: boolean}} [options] move keyboard focus to the tab
 */
export function selectTab(name, { focus = false } = {}) {
  if (!isOneOf(name, TABS)) return;
  state.tab = name;
  renderAll();
  if (focus) $(`#tab-${name}`).focus();
}
