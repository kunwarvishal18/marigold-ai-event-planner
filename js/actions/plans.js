/**
 * @file Opening, creating and deleting plans.
 */
import { addDays, toIsoDate, today } from "../core/dates.js";
import { buildPlan } from "../core/model.js";
import { schedule } from "../core/scheduler.js";
import { SCENARIOS, scenarioBrief } from "../core/scenarios.js";
import { templateData } from "../core/templates.js";
import { uid } from "../core/util.js";
import { STORAGE_KEYS, localStore } from "../services/local-store.js";
import { requirePlan, state } from "../services/state.js";
import { sanePlan } from "../core/plan-sanitizer.js";
import { deleteStoredPlan, savePlan } from "../services/storage.js";
import { view } from "../services/view.js";
import { proposeChange, showProposal } from "./history.js";

/**
 * The blank brief shown for a new event.
 * @type {Readonly<import("../services/view.js").BriefDraft>}
 */
export const EMPTY_BRIEF = Object.freeze({
  type: "Wedding",
  name: "",
  date: "",
  guests: "",
  budget: "",
  currency: "INR",
});

/**
 * Brief fields compared when reviewing edits to an open plan.
 * @type {Array<keyof import("../core/model.js").Brief>}
 */
const EDITABLE_FIELDS = [
  "name",
  "date",
  "time",
  "guests",
  "venueCapacity",
  "budget",
  "city",
  "style",
  "notes",
  "type",
  "currency",
];

/**
 * Adds a change-log entry to a plan that isn't open yet.
 * @param {import("../core/model.js").Plan} plan
 * @param {string} text
 * @param {import("../core/model.js").ItemOrigin} origin
 */
export function logEntryFor(plan, text, origin) {
  plan.log.unshift({ text, origin, at: Date.now() });
}

/**
 * Opens a plan after validating it.
 * @param {unknown} plan
 * @returns {boolean} false if the plan was unusable
 */
export function openPlan(plan) {
  const clean = sanePlan(plan);
  if (!clean) {
    view.toast("That plan couldn't be opened. It is kept unchanged in storage.", true);
    return false;
  }
  state.plan = clean;
  state.proposal = null;
  state.mode = "edit";
  state.expandedVendors.clear();
  view.fillForm(clean.brief);
  localStore.set(STORAGE_KEYS.lastPlanId, clean.id);
  view.render();
  return true;
}

/** Closes the open plan and shows an empty brief. */
export function newEvent() {
  state.plan = null;
  state.proposal = null;
  state.mode = "create";
  view.fillForm({ ...EMPTY_BRIEF });
  view.render();
}

/**
 * Creates and opens a plan from the standard template for the brief's event type.
 * @param {import("../core/model.js").Brief} brief already validated
 */
export function createTemplate(brief) {
  const plan = buildPlan(brief, templateData(brief.type), "template");
  logEntryFor(plan, "Created from the standard template", "template");
  openPlan(plan);
  savePlan();
  view.setFormHint(
    "Template plan created. It isn't AI generated; use Fresh AI plan to personalise it.",
  );
}

/**
 * Proposes the differences between an edited brief and the open plan's brief.
 * @param {import("../core/model.js").Brief} brief already validated
 */
export function reviewDetails(brief) {
  const current = requirePlan().brief;
  /** @type {Record<string, unknown>} */
  const changes = {};
  for (const field of EDITABLE_FIELDS) {
    if ((brief[field] ?? "") !== (current[field] ?? "")) changes[field] = brief[field];
  }
  if (!Object.keys(changes).length) {
    view.setFormHint("No changes to review.");
    return;
  }
  const explanation =
    changes.budget != null
      ? "The new total is spread across categories in proportion, never below committed spend. " +
        "Ask the co-planner if you want a smarter rebalance."
      : "Timeline dates recalculate from the event date.";
  showProposal(
    proposeChange({
      origin: "rule",
      kind: "details",
      title: "Update event details",
      explanation,
      changes: { brief: changes },
    }),
  );
}

/**
 * Deletes a stored plan, closing it if it's open.
 * @param {string} id
 * @returns {boolean} false if the deletion couldn't be saved
 */
export function deletePlan(id) {
  if (!deleteStoredPlan(id)) {
    view.toast("Couldn't delete: saving is unavailable on this device.", true);
    return false;
  }
  if (state.plan && state.plan.id === id) {
    state.plan = null;
    state.proposal = null;
    state.mode = "create";
  }
  view.render();
  view.toast("Plan deleted.");
  return true;
}

/**
 * Opens the sample wedding: template data with some progress filled in, clearly labelled as an
 * example (placeholder vendor names, no AI).
 */
export function openSample() {
  const brief = scenarioBrief(SCENARIOS[0]);
  const plan = buildPlan(
    brief,
    templateData("Wedding"),
    "example",
    toIsoDate(addDays(today(), -45)),
  );
  plan.summary =
    "Example data built from Marigold's wedding template so you can explore the app. It isn't " +
    "AI generated. Generate with AI in Event details to get a plan written for this brief.";
  addSampleBookings(plan);
  tickEarlyHighPriorityTasks(plan);
  logEntryFor(plan, "Opened the sample wedding (template data)", "template");
  openPlan(plan);
  savePlan();
}

/**
 * The sample's progress: a booked venue and a photographer being compared, with committed spend.
 * The wedding template always has these lines and vendors; the guards only satisfy the types.
 * @param {import("../core/model.js").Plan} plan mutated
 */
function addSampleBookings(plan) {
  const lineFor = (/** @type {RegExp} */ pattern) =>
    plan.budget.find((line) => pattern.test(line.category));
  const vendorFor = (/** @type {RegExp} */ pattern) =>
    plan.vendors.find((vendor) => pattern.test(vendor.category));
  const venueLine = lineFor(/venue/i);
  const photoLine = lineFor(/photo/i);
  if (venueLine) venueLine.committed = 450000;
  if (photoLine) photoLine.committed = 230000;

  const venue = vendorFor(/venue/i);
  if (venue) {
    Object.assign(venue, {
      status: "Booked",
      payment: "Deposit paid",
      name: "Example venue (placeholder)",
      quote: 450000,
      arrival: "08:00",
    });
  }
  const photographer = vendorFor(/photo/i);
  if (photographer) {
    Object.assign(photographer, {
      status: "Negotiating",
      quote: 230000,
      options: [
        {
          id: uid(),
          name: "Option A (placeholder)",
          contact: "",
          quote: 230000,
          notes: "Two shooters, drone",
        },
        {
          id: uid(),
          name: "Option B (placeholder)",
          contact: "",
          quote: 185000,
          notes: "One shooter, 8 weeks delivery",
        },
      ],
    });
  }
}

/**
 * Ticks off the high-priority tasks that were due well before today.
 * @param {import("../core/model.js").Plan} plan mutated
 */
function tickEarlyHighPriorityTasks(plan) {
  const sched = schedule(plan);
  const cutoff = addDays(today(), -10);
  for (const task of plan.tasks) {
    const due = sched.due[task.id];
    if (due && due < cutoff && task.priority === "high") task.done = true;
  }
}
