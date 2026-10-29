/**
 * @file Changing the open plan: proposals (preview → approve → apply), direct edits, and undo.
 * Every structural change is undoable and logged.
 */
import { PLAN_LIMITS } from "../core/constants.js";
import { sanePlan } from "../core/plan-sanitizer.js";
import { corePlan, makeProposal } from "../core/proposal.js";
import { deepClone } from "../core/util.js";
import { requirePlan, state } from "../services/state.js";
import { savePlan } from "../services/storage.js";
import { view } from "../services/view.js";

/** @typedef {import("../core/model.js").Plan} Plan */
/** @typedef {import("../core/model.js").Vendor} Vendor */

/**
 * Vendor fields the person fills in; undo keeps their latest values.
 * @type {Array<keyof Vendor>}
 */
const VENDOR_FACTS = [
  "status",
  "payment",
  "name",
  "contact",
  "estimate",
  "quote",
  "arrival",
  "notes",
  "options",
  "dueFixed",
  "lineId",
];

/**
 * Builds a proposal against the open plan.
 * @param {import("../core/proposal.js").ProposalSpec} spec
 * @returns {import("../core/proposal.js").Proposal}
 */
export const proposeChange = (spec) => makeProposal(requirePlan(), spec);

/**
 * Shows a proposal for approval, unless it wouldn't change anything.
 * @param {import("../core/proposal.js").Proposal|null} proposal
 */
export function showProposal(proposal) {
  if (!proposal) return;
  if (proposal.diff.empty && !proposal.blocked) {
    view.toast("That suggestion wouldn't change the plan, so there's nothing to approve.");
    return;
  }
  state.proposal = proposal;
  view.renderSection("proposal");
  view.revealProposal();
}

/**
 * Adds an entry to the open plan's change log.
 * @param {string} text
 * @param {import("../core/model.js").ItemOrigin} [origin]
 */
function logEntry(text, origin) {
  const plan = requirePlan();
  plan.log.unshift({ text, origin: origin || "you", at: Date.now() });
  plan.log = plan.log.slice(0, PLAN_LIMITS.log);
}

/**
 * Saves an undo snapshot of the open plan.
 * @param {string} title
 */
function pushHistory(title) {
  const plan = requirePlan();
  plan.history.unshift({ title, at: Date.now(), snap: corePlan(plan) });
  plan.history = plan.history.slice(0, PLAN_LIMITS.history);
}

/** Marks a pending proposal as out of date (the plan changed underneath it). */
export function markProposalStale() {
  if (state.proposal) state.proposal.status = "stale";
}

/** Applies the pending proposal, if it's still current. */
export function applyProposal() {
  const proposal = state.proposal;
  if (!proposal || proposal.blocked || state.busy.apply) return;
  const current = requirePlan();
  if (proposal.planId !== current.id || proposal.baseRev !== current.rev) {
    proposal.status = "stale";
    view.renderSection("proposal");
    return;
  }
  state.busy.apply = true;
  pushHistory(proposal.title);
  const { history, chat, log } = current;
  const applied = { ...proposal.after, history, chat, log };
  state.plan = applied;
  logEntry(`Applied: ${proposal.title}`, proposal.origin);
  applied.chat.push({ role: "note", text: `Applied “${proposal.title}”.`, at: Date.now() });
  state.proposal = null;
  state.busy.apply = false;
  view.fillForm(applied.brief);
  savePlan();
  view.render();
  view.toast("Changes applied. Use Undo to reverse them.");
}

/** Rejects the pending proposal. Nothing in the plan changes. */
export function rejectProposal() {
  const proposal = state.proposal;
  if (!proposal) return;
  if (state.plan && proposal.planId === state.plan.id) {
    logEntry(`Rejected: ${proposal.title}`, proposal.origin);
    state.plan.chat.push({
      role: "note",
      text: `Rejected “${proposal.title}”. Nothing changed.`,
      at: Date.now(),
    });
    savePlan();
  }
  state.proposal = null;
  view.render();
  view.toast("Proposal rejected. Nothing changed.");
}

/**
 * Undo restores the plan before the last change, but keeps facts the person entered since
 * (ticked tasks, recorded spend, vendor details), matched by id.
 */
export function undo() {
  const current = requirePlan();
  const entry = current.history[0];
  if (!entry) return;
  // Snapshots come back from storage, so they are validated like any stored plan.
  const snapshot = sanePlan({ ...deepClone(entry.snap), id: current.id });
  if (!snapshot) {
    current.history = current.history.slice(1);
    savePlan();
    view.render();
    view.toast("Can't undo: the saved snapshot couldn't be read, so it was discarded.", true);
    return;
  }

  const orphan = current.budget.find(
    (line) => (line.committed || 0) > 0 && !snapshot.budget.some((old) => old.id === line.id),
  );
  if (orphan) {
    view.toast(
      `Can't undo: you've recorded spend on “${orphan.category}”, which that change added. ` +
        "Clear that spend first.",
      true,
    );
    return;
  }

  keepEnteredFacts(snapshot, current);
  const restored = {
    ...snapshot,
    rev: current.rev + 1,
    history: current.history.slice(1),
    chat: current.chat,
    log: current.log,
  };
  state.plan = restored;
  logEntry(`Undid: ${entry.title}`);
  restored.chat.push({ role: "note", text: `Undid “${entry.title}”.`, at: Date.now() });
  markProposalStale();
  view.fillForm(restored.brief);
  savePlan();
  view.render();
  view.toast(`Undid “${entry.title}”.`);
}

/**
 * Copies what the person recorded since the snapshot onto it.
 * @param {Plan} snapshot mutated
 * @param {Plan} current
 */
function keepEnteredFacts(snapshot, current) {
  /**
   * @template {{id: string}} T
   * @param {T[]} list
   * @param {string} id
   * @returns {T|undefined}
   */
  const byId = (list, id) => list.find((item) => item.id === id);
  for (const task of snapshot.tasks) {
    const now = byId(current.tasks, task.id);
    if (now) task.done = now.done;
  }
  for (const line of snapshot.budget) {
    const now = byId(current.budget, line.id);
    if (now) line.committed = now.committed;
  }
  for (const vendor of snapshot.vendors) {
    const now = byId(current.vendors, vendor.id);
    if (!now) continue;
    for (const key of VENDOR_FACTS) Object.assign(vendor, { [key]: now[key] });
    for (const item of vendor.checklist) {
      const nowItem = byId(now.checklist, item.id);
      if (nowItem) item.done = nowItem.done;
    }
  }
  snapshot.dayOf = current.dayOf;
  snapshot.runOfShow = current.runOfShow;
}

/**
 * A direct edit by the person. Structural edits are undoable and logged; others (ticking a box,
 * typing a vendor's phone number) are just saved.
 * @param {string} title shown in the Undo button and change log
 * @param {(plan: import("../core/model.js").Plan) => void} change mutates the plan
 * @param {{structural?: boolean}} [options]
 */
export function commit(title, change, { structural = true } = {}) {
  const plan = requirePlan();
  if (structural) pushHistory(title);
  change(plan);
  if (structural) {
    plan.rev++;
    logEntry(title);
  }
  savePlan();
  view.render();
}

/**
 * A change that is saved but not undoable or logged: ticking a box, typing a vendor's phone
 * number, recording spend.
 * @param {string} title
 * @param {(plan: Plan) => void} change mutates the plan
 */
export const commitQuietly = (title, change) => commit(title, change, { structural: false });
