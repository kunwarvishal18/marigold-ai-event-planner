/**
 * @file Budget tab: allocation table (editing an allocation creates a proposal), committed spend,
 * and the budget optimizer.
 */
import { optimize } from "../actions/assistant.js";
import { commit, markProposalStale, proposeChange, showProposal } from "../actions/history.js";
import { pctList } from "../core/budget.js";
import { isContingency } from "../core/constants.js";
import { escapeHtml, formatMoney } from "../core/format.js";
import { MAX_AMOUNT, sum } from "../core/util.js";
import { analyze } from "../core/risks.js";
import { isClaudeOn } from "../services/claude.js";
import { state } from "../services/state.js";
import { savePlan } from "../services/storage.js";
import { view } from "../services/view.js";
import { renderProposal } from "./proposal-panel.js";
import { toast } from "./toast.js";
import { $, attrIf, onEach, setHtml, showInlineError } from "./dom.js";

const PRESET_SAVINGS = [10, 15, 20];
const MIN_SAVING_PCT = 1;
const MAX_SAVING_PCT = 60;

function budgetRow(line, pct, money) {
  const committed = line.committed || 0;
  const over = committed > line.amount;
  const usedPct = line.amount ? Math.round((committed / line.amount) * 100) : 0;
  const barPct = line.amount ? Math.min(100, (committed / line.amount) * 100) : committed ? 100 : 0;
  const category = escapeHtml(line.category);
  const reserve = isContingency(line.category) ? ' <span class="badge">reserve</span>' : "";
  return `<tr>
    <td><b>${category}</b>${reserve}<div class="note">${escapeHtml(line.note)}</div></td>
    <td class="num">${pct.toFixed(1)}%</td>
    <td class="num">
      <label class="sr" for="al-${escapeHtml(line.id)}">Allocation for ${category}</label>
      <input class="amt" id="al-${escapeHtml(line.id)}" type="number" min="0" step="1" data-alloc="${escapeHtml(line.id)}" value="${line.amount}">
    </td>
    <td class="num">
      <label class="sr" for="cm-${escapeHtml(line.id)}">Committed spend for ${category}</label>
      <input class="amt" id="cm-${escapeHtml(line.id)}" type="number" min="0" step="1" data-commit="${escapeHtml(line.id)}" value="${line.committed ?? ""}" placeholder="0">
    </td>
    <td class="num ${over ? "neg" : ""}">${money(line.amount - committed)}</td>
    <td class="bar-cell"><div class="bar" title="${usedPct}% used"><i class="${over ? "over" : ""}" data-width="${barPct}"></i></div></td>
  </tr>`;
}

function allocationTable(plan, analysis, money) {
  const { brief } = plan;
  const pcts = pctList(
    plan.budget.map((line) => line.amount),
    brief.budget,
  );
  const left = brief.budget - analysis.committed;
  const balance =
    analysis.alloc === brief.budget
      ? '<span class="pos">Fully allocated</span>'
      : '<span class="neg">Not balanced</span>';
  return `<div class="tablewrap"><table>
    <caption class="sr">Budget allocation and committed spend</caption>
    <thead><tr><th>Category</th><th class="num">Share</th><th class="num">Allocated</th><th class="num">Committed</th><th class="num">Left</th><th>Used</th></tr></thead>
    <tbody>${plan.budget.map((line, i) => budgetRow(line, pcts[i], money)).join("")}</tbody>
    <tfoot><tr>
      <th>Total</th>
      <th class="num">${sum(pcts).toFixed(1)}%</th>
      <th class="num">${money(analysis.alloc)}</th>
      <th class="num">${money(analysis.committed)}</th>
      <th class="num ${left < 0 ? "neg" : ""}">${money(left)}</th>
      <th>${balance}</th>
    </tr></tfoot>
  </table></div>`;
}

function optimizerCard() {
  const busy = !!state.busy.opt;
  const presets = PRESET_SAVINGS.map(
    (pct) =>
      `<button class="btn ghost small" type="button" data-save="${pct}" ${attrIf(busy, "disabled")}>Save ${pct}%</button>`,
  ).join("");
  const progress = busy
    ? '<span class="progress"><span class="spinner"></span>Claude is finding savings…</span>'
    : "";
  const howItWorks = isClaudeOn()
    ? "Claude chooses where to cut and explains trade-offs; Marigold checks the maths."
    : "Claude isn't available, so this uses a rule-based proportional cut, labelled as such.";
  return `<div class="card">
    <h2>Budget optimizer</h2>
    <p class="hint">Find savings without touching committed spend. Every category stays at or above what you've already committed, and the new allocations add up exactly to the new total.</p>
    <div class="btnrow" role="group" aria-label="Savings target">
      ${presets}
      <label class="sr" for="saveCustom">Custom savings percent</label>
      <input id="saveCustom" class="narrow-input" type="number" min="${MIN_SAVING_PCT}" max="${MAX_SAVING_PCT}" step="1" placeholder="Custom %">
      <button class="btn small" type="button" id="saveGo" ${attrIf(busy, "disabled")}>Optimize</button>
      ${progress}
    </div>
    <label for="saveProtect" class="lbl">Protect (optional)</label>
    <input id="saveProtect" placeholder="e.g. catering quality, photography" value="${escapeHtml(state.protect || "")}">
    <p class="hint">${howItWorks}</p>
    <p class="field-err" id="optErr" role="alert" hidden></p>
  </div>`;
}

/**
 * Renders the Budget tab.
 * @param {import("../core/risks.js").Analysis} analysis
 */
export function renderBudget(analysis) {
  const plan = state.plan;
  const money = (amount) => formatMoney(amount, plan.brief.currency);
  const left = plan.brief.budget - analysis.committed;
  const panel = $("#panel-budget");
  setHtml(
    panel,
    `<div class="toolbar"><h2>Budget</h2><span class="${left < 0 ? "over-txt" : "under-txt"}">${left < 0 ? "Over by " : "Uncommitted "}${money(Math.abs(left))}</span></div>
    ${allocationTable(plan, analysis, money)}
    <p class="hint">Type what you've paid or signed for in Committed. Changing an Allocated amount creates a proposal that rebalances the other categories, which you approve first.</p>
    ${optimizerCard()}`,
  );
  onEach("[data-commit]", "change", recordCommitted, panel);
  onEach("[data-alloc]", "change", proposeAllocation, panel);
  onEach("[data-save]", "click", (button) => optimize(+button.dataset.save), panel);
  $("#saveGo").addEventListener("click", optimizeCustom);
  $("#saveProtect").addEventListener("input", (event) => {
    state.protect = event.target.value;
  });
}

/** Records committed spend (a fact, not a plan change, so it isn't a proposal). */
function recordCommitted(input) {
  const text = input.value.trim();
  const amount = text === "" ? null : Math.round(+text);
  if (amount != null && (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT)) {
    toast("Committed spend must be a number from 0 to 1 trillion.", true);
    view.render();
    return;
  }
  commit(
    "Recorded spend",
    (plan) => {
      plan.budget.find((line) => line.id === input.dataset.commit).committed = amount;
    },
    { structural: false },
  );
  // Committed spend changes what a pending proposal may cut, so it becomes stale.
  state.plan.rev++;
  savePlan();
  if (state.proposal) {
    markProposalStale();
    renderProposal();
  }
}

/** A new allocation for one line becomes a proposal that rebalances the others. */
function proposeAllocation(input) {
  const plan = state.plan;
  const { brief } = plan;
  const money = (amount) => formatMoney(amount, brief.currency);
  const line = plan.budget.find((x) => x.id === input.dataset.alloc);
  const amount = Math.round(+input.value);
  let problem = null;
  if (!Number.isFinite(amount) || amount < 0) problem = "Allocation must be 0 or more.";
  else if (amount > brief.budget) {
    problem = `Allocation can't exceed the total budget of ${money(brief.budget)}.`;
  } else if (amount < (line.committed || 0)) {
    problem = `${line.category} already has ${money(line.committed)} committed.`;
  }
  if (problem) {
    toast(problem, true);
    view.render();
    return;
  }

  const lines = plan.budget.map((x) => ({
    category: x.category,
    amount: x.id === line.id ? amount : x.amount,
    locked: x.id === line.id,
  }));
  showProposal(
    proposeChange({
      origin: "rule",
      kind: "alloc",
      title: `Set ${line.category} to ${money(amount)}`,
      explanation: `The other categories are rebalanced in proportion so the total stays exactly ${money(brief.budget)}. Committed spend is protected.`,
      changes: { budget: lines },
    }),
  );
  renderBudget(analyze(state.plan));
}

function optimizeCustom() {
  const pct = +$("#saveCustom").value;
  if (!(pct >= MIN_SAVING_PCT && pct <= MAX_SAVING_PCT)) {
    showInlineError("optErr", "Enter a savings target from 1% to 60%.");
    return;
  }
  optimize(pct);
}
