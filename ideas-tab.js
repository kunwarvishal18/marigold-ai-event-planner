/**
 * @file Ideas tab: idea cards with rough cost estimates; ideas can be added to the timeline or,
 * through a proposal, to the budget. Claude can suggest more.
 */
import { moreIdeas } from "../actions/assistant.js";
import { commit, proposeChange, showProposal } from "../actions/history.js";
import { isContingency } from "../core/constants.js";
import { escapeHtml, formatMoney } from "../core/format.js";
import { analyze } from "../core/risks.js";
import { clip, normalizeName, uid } from "../core/util.js";
import { isClaudeOn } from "../services/claude.js";
import { state } from "../services/state.js";
import { originBadge } from "./badges.js";
import { $, attrIf, onEach, setHtml } from "./dom.js";
import { toast } from "./toast.js";

/** Ideas added to the timeline are due this many days before the event (or sooner). */
const IDEA_TASK_LEAD_DAYS = 30;

const taskTitleFor = (idea) => clip(`Arrange: ${idea.title}`, 160);
const budgetCategoryFor = (idea) => clip(`Idea: ${idea.title}`, 60);

function isInTasks(plan, idea) {
  const key = normalizeName(`Arrange: ${idea.title}`);
  return plan.tasks.some((task) => normalizeName(task.title) === key);
}

function isInBudget(plan, idea) {
  const fullKey = normalizeName(`Idea: ${idea.title}`).slice(0, 60);
  const clippedKey = normalizeName(budgetCategoryFor(idea));
  return plan.budget.some((line) => {
    const key = normalizeName(line.category);
    return key === fullKey || key === clippedKey;
  });
}

function costText(idea, currency) {
  if (idea.costLow == null && idea.costHigh == null) return "";
  const low = formatMoney(idea.costLow ?? idea.costHigh, currency);
  const hasRange = idea.costHigh != null && idea.costLow != null && idea.costHigh !== idea.costLow;
  const high = hasRange ? `–${formatMoney(idea.costHigh, currency)}` : "";
  return `<div class="cost">Est. ${low}${high} <span class="note">(estimate)</span></div>`;
}

function ideaCard(idea, plan) {
  const currency = plan.brief.currency;
  const inTasks = isInTasks(plan, idea);
  const midpoint =
    idea.costLow != null && idea.costHigh != null
      ? Math.round((idea.costLow + idea.costHigh) / 2)
      : (idea.costLow ?? idea.costHigh ?? "");
  const budgetAction = isInBudget(plan, idea)
    ? '<span class="note">In budget</span>'
    : `<label class="sr" for="ib-${idea.id}">Amount for ${escapeHtml(idea.title)}</label>` +
      `<input id="ib-${idea.id}" type="number" min="1" step="1" value="${midpoint}" placeholder="Amount">` +
      `<button type="button" class="btn ghost small" data-ibud="${idea.id}">Add to budget</button>`;
  return `<article class="idea">
    <div class="tag"><span>${escapeHtml(idea.tag)}</span>${originBadge(idea.origin)}</div>
    <h3>${escapeHtml(idea.title)}</h3>
    <p>${escapeHtml(idea.detail)}</p>
    ${costText(idea, currency)}
    <div class="acts">
      <button type="button" class="btn ghost small" data-itask="${idea.id}" ${attrIf(inTasks, "disabled")}>${inTasks ? "In tasks" : "Add to tasks"}</button>
      ${budgetAction}
    </div>
  </article>`;
}

/** Renders the Ideas tab. */
export function renderIdeas() {
  const plan = state.plan;
  const claudeOn = isClaudeOn();
  const busy = !!state.busy.ideas;
  const panel = $("#panel-ideas");
  setHtml(
    panel,
    `<div class="toolbar"><h2>Ideas</h2></div>
    <div class="card">
      <div class="row2">
        <div><label for="ideaFocus">Focus (optional)</label><input id="ideaFocus" maxlength="120" placeholder="e.g. sustainability, kids, grandparents" value="${escapeHtml(state.ideaFocus || "")}"></div>
        <div class="align-end"><button class="btn" type="button" id="moreIdeas" ${attrIf(!claudeOn || busy, "disabled")}>${busy ? "Thinking…" : "Get more AI ideas"}</button></div>
      </div>
      ${claudeOn ? "" : '<p class="hint">Needs Claude.</p>'}<p class="field-err" id="ideaErr" role="alert" hidden></p>
    </div>
    <p class="hint">Cost ranges are rough AI estimates in ${escapeHtml(plan.brief.currency)}, not vendor quotes.</p>
    <div class="ideas">${plan.ideas.map((idea) => ideaCard(idea, plan)).join("")}</div>`,
  );
  $("#moreIdeas").addEventListener("click", moreIdeas);
  $("#ideaFocus").addEventListener("input", (event) => {
    state.ideaFocus = event.target.value;
  });
  onEach("[data-itask]", "click", (button) => addIdeaToTasks(button.dataset.itask), panel);
  onEach("[data-ibud]", "click", (button) => proposeIdeaBudget(button.dataset.ibud), panel);
}

function addIdeaToTasks(ideaId) {
  const idea = state.plan.ideas.find((x) => x.id === ideaId);
  commit(`Added idea to tasks: ${idea.title}`, (plan) =>
    plan.tasks.push({
      id: uid(),
      title: taskTitleFor(idea),
      phase: "Ideas",
      offset: Math.min(
        IDEA_TASK_LEAD_DAYS,
        Math.max(0, analyze(plan).sc.daysLeft ?? IDEA_TASK_LEAD_DAYS),
      ),
      fixedOffset: true,
      fixedDate: "",
      priority: "medium",
      deps: [],
      done: false,
      origin: "you",
    }),
  );
  toast("Added to Timeline. Undo is available.");
}

/**
 * Proposes a new budget line for an idea, taken from the contingency first (then in proportion
 * from the other categories). The total budget doesn't change.
 */
function proposeIdeaBudget(ideaId) {
  const plan = state.plan;
  const currency = plan.brief.currency;
  const idea = plan.ideas.find((x) => x.id === ideaId);
  const amount = Math.round(+$(`#ib-${idea.id}`).value);
  if (!(amount > 0)) {
    toast("Enter an amount greater than 0.", true);
    return;
  }

  const lines = plan.budget.map((line) => ({ category: line.category, amount: line.amount }));
  lines.push({ category: budgetCategoryFor(idea), amount, locked: true });
  const contingency = lines.find((line) => isContingency(line.category));
  const contingencyLine = plan.budget.find((line) => isContingency(line.category));
  if (contingency) {
    const free = contingency.amount - (contingencyLine?.committed || 0);
    contingency.amount -= Math.min(free, amount);
  }
  const spillsOver =
    contingency && contingencyLine.amount - (contingencyLine.committed || 0) < amount;

  showProposal(
    proposeChange({
      origin: "rule",
      kind: "idea",
      title: `Add “${idea.title}” to the budget`,
      explanation:
        `Sets aside ${formatMoney(amount, currency)} for this idea, taken from the contingency ` +
        `first${spillsOver ? ", then in proportion from other categories" : ""}. ` +
        `The total budget stays ${formatMoney(plan.brief.budget, currency)}.`,
      tradeoffs: ["Less contingency means less room for surprises."],
      changes: { budget: lines },
    }),
  );
}
