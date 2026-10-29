/**
 * @file Overview tab: health score, rule-based risks, the AI risk review, "Do next" and the change
 * log.
 */
import { aiRiskReview } from "../actions/assistant.js";
import { blockedTasks, nextActions } from "../core/advisor.js";
import { escapeHtml, formatShortDate } from "../core/format.js";
import { isClaudeOn } from "../services/claude.js";
import { requirePlan, state } from "../services/state.js";
import { $, attrIf, find, setHtml } from "./dom.js";

/** @typedef {import("../core/model.js").Plan} Plan */
/** @typedef {import("../core/risks.js").Analysis} Analysis */

/**
 * A risk card's content: a rule-based risk, or an AI one (which has no tab to link to).
 * @typedef {Pick<import("../core/risks.js").Risk, "sev" | "title" | "why" | "action">
 *   & {tab?: string, source: "rule" | "ai"}} RiskCard
 */

const DIAL_RADIUS = 46;
/** @type {Readonly<Record<string, string>>} */
const BAND_COLORS = { "On track": "var(--good)", "Needs attention": "var(--accent)" };
const LOG_ENTRIES_SHOWN = 8;

/**
 * The health-score ring.
 * @param {number} score 0–100
 * @param {string} band "On track" | "Needs attention" | "At risk"
 * @returns {string} SVG markup
 */
function dial(score, band) {
  const circumference = 2 * Math.PI * DIAL_RADIUS;
  const color = Object.hasOwn(BAND_COLORS, band) ? BAND_COLORS[band] : "var(--rose)";
  const filled = ((score / 100) * circumference).toFixed(1);
  return `<svg width="112" height="112" viewBox="0 0 112 112" role="img" aria-label="Health score ${score} out of 100">
    <circle cx="56" cy="56" r="${DIAL_RADIUS}" fill="none" stroke="var(--sunk)" stroke-width="10"/>
    <circle cx="56" cy="56" r="${DIAL_RADIUS}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${filled} ${circumference.toFixed(1)}" transform="rotate(-90 56 56)"/>
  </svg>`;
}

/**
 * One risk card.
 * @param {RiskCard} risk
 * @returns {string}
 */
function riskItem(risk) {
  const aiBadge = risk.source === "ai" ? '<span class="badge ai">AI insight</span>' : "";
  const tabName = risk.tab === "eventday" ? "Event day" : risk.tab;
  const link = risk.tab
    ? ` <button type="button" class="linkbtn" data-goto="${escapeHtml(risk.tab)}">Open ${tabName}</button>`
    : "";
  return `<li class="risk ${escapeHtml(risk.sev)}">
    <div class="risk-top"><span class="sev ${escapeHtml(risk.sev)}">${escapeHtml(risk.sev)}</span><b>${escapeHtml(risk.title)}</b>${aiBadge}</div>
    <p>${escapeHtml(risk.why)}</p>
    <p class="act">Do this: ${escapeHtml(risk.action)}${link}</p>
  </li>`;
}

/**
 * The status band never says "On track" while a critical or high risk is open.
 * @param {Analysis} analysis
 */
function healthBand(analysis) {
  const hasCritical = analysis.risks.some((r) => r.sev === "critical");
  const hasHigh = analysis.risks.some((r) => r.sev === "high");
  const { score } = analysis.health;
  let band = "On track";
  if (hasCritical || score < 60) band = "At risk";
  else if (hasHigh || score < 80) band = "Needs attention";
  return { band, hasCritical, hasHigh };
}

/**
 * @param {import("../core/health.js").HealthComponent} comp
 * @returns {string}
 */
function componentRow(comp) {
  const barClass = comp.score >= 16 ? "good" : comp.score < 10 ? "over" : "";
  const details = comp.deductions.length
    ? `<ul class="ded full-row">${comp.deductions
        .map((d) => `<li>−${d.points}: ${escapeHtml(d.reason)}. ${escapeHtml(d.action)}.</li>`)
        .join("")}</ul>`
    : `<p class="note full-row flush">${escapeHtml(comp.note || "No deductions.")}</p>`;
  return `<div class="comp-row">
    <span>${comp.name}</span><span>${comp.score}/${comp.max}</span>
    <div class="bar"><i class="${barClass}" data-width="${(comp.score / comp.max) * 100}"></i></div>
    ${details}
  </div>`;
}

/**
 * @param {Analysis} analysis
 * @returns {string}
 */
function healthCard(analysis) {
  const { band, hasCritical, hasHigh } = healthBand(analysis);
  const { score, components } = analysis.health;
  const openRiskNote =
    hasCritical || hasHigh
      ? `<p class="hint strong">${hasCritical ? "A critical" : "A high"} risk is open, so the status reads “${band}” whatever the score.</p>`
      : "";
  return `<div class="card">
    <h2>Event health</h2>
    <div class="dial">${dial(score, band)}<div><div class="big">${score}</div><div class="note">out of 100 · ${band}</div></div></div>
    <div class="comp">${components.map(componentRow).join("")}</div>
    ${openRiskNote}
    <p class="hint">Fixed rules, no AI: each area starts at 20 and loses points only for things Marigold can check (dates, money, statuses you set).</p>
  </div>`;
}

/**
 * @param {Plan} plan
 * @returns {string}
 */
function aiReviewSection(plan) {
  const claudeOn = isClaudeOn();
  const busy = !!state.busy.risks;
  const review = plan.aiRisks;
  const results = review?.items.length
    ? `<p class="hint">Contextual insights from Claude${review.rev !== plan.rev ? " (from an earlier version of the plan)" : ""}. These are advice and don't change the score.</p>
       <ul class="risks">${review.items.map(riskItem).join("")}</ul>`
    : "";
  return `<div class="toolbar">
      <h3 class="subhead grow">AI risk review</h3>
      <button class="btn small ${claudeOn ? "" : "ghost"}" type="button" id="aiRiskBtn" ${attrIf(!claudeOn || busy, "disabled")}>${busy ? "Reviewing…" : "Run AI risk review"}</button>
    </div>
    ${claudeOn ? "" : '<p class="hint">Needs Claude. Rule-based checks above still run.</p>'}
    <div id="aiRiskOut">${results}</div>`;
}

/**
 * @param {Plan} plan
 * @param {import("../core/scheduler.js").Schedule} sched
 * @returns {string}
 */
function doNextSection(plan, sched) {
  const actions = nextActions(plan, sched);
  const blocked = blockedTasks(plan).length;
  let list;
  if (actions.length) {
    const items = actions.map((action) => {
      const overdue = action.due && action.due < sched.today;
      const due = action.due
        ? `<span class="${overdue ? "overdue" : "note"}">${overdue ? "Overdue · " : ""}${formatShortDate(action.due)}</span>`
        : "";
      return `<li><span><button type="button" class="linkbtn" data-goto="${escapeHtml(action.tab)}">${escapeHtml(action.title)}</button><small class="note">Why: ${escapeHtml(action.why.join(", "))}</small></span>${due}</li>`;
    });
    list = `<ol class="mini donext" aria-labelledby="doNextTitle">${items.join("")}</ol>`;
  } else {
    let message = "Nothing urgent: no ready task is due in the next 30 days.";
    if (!sched.eventDate) message = "Add an event date to see what to do next.";
    else if (plan.tasks.every((task) => task.done)) message = "Everything is done.";
    list = `<p class="hint">${message}</p>`;
  }
  const waiting = blocked
    ? ` ${blocked} task${blocked > 1 ? "s are" : " is"} waiting on others.`
    : "";
  return `<h3 class="subhead spaced" id="doNextTitle">Do next</h3>
    ${list}
    <p class="hint">Ranked by rules, not AI: only tasks whose prerequisites are done, ordered by due date, priority and how much they unblock.${waiting}</p>`;
}

/**
 * @param {Plan} plan
 * @returns {string}
 */
function changeLog(plan) {
  if (!plan.log.length) {
    return '<p class="hint">Applied, rejected and undone changes appear here.</p>';
  }
  /** @type {Intl.DateTimeFormatOptions} */
  const timeFormat = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  /** @type {Readonly<Record<string, string>>} */
  const originBadges = {
    ai: '<span class="badge ai">AI</span>',
    rule: '<span class="badge rule">Rule</span>',
  };
  const items = plan.log
    .slice(0, LOG_ENTRIES_SHOWN)
    .map(
      (entry) =>
        `<li><time>${new Date(entry.at).toLocaleString(undefined, timeFormat)}</time>${escapeHtml(entry.text)} ${Object.hasOwn(originBadges, entry.origin) ? originBadges[entry.origin] : ""}</li>`,
    );
  return `<ul class="log">${items.join("")}</ul>`;
}

/**
 * Renders the Overview tab.
 * @param {import("../core/risks.js").Analysis} analysis
 */
export function renderOverview(analysis) {
  const plan = requirePlan();
  const risks = analysis.risks.length
    ? `<ul class="risks">${analysis.risks.map(riskItem).join("")}</ul>`
    : '<div class="callout ok">No rule-based risks found right now.</div>';
  setHtml(
    $("#panel-overview"),
    `<div class="ov-grid">
      ${healthCard(analysis)}
      <div class="panel">
        <div class="toolbar"><h2>Risks and next steps</h2></div>
        ${risks}
        ${aiReviewSection(plan)}
        ${doNextSection(plan, analysis.schedule)}
        <h3 class="subhead spaced">Change log</h3>
        ${changeLog(plan)}
      </div>
    </div>`,
  );
  find("#aiRiskBtn")?.addEventListener("click", aiRiskReview);
}
