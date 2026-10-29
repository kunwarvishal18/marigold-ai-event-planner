/**
 * @file Before/after comparison of two versions of a plan, for the approval preview.
 */
import { daysBetween, parseIsoDate } from "./dates.js";
import { formatDate, formatMoney } from "./format.js";
import { analyze } from "./risks.js";
import { sum } from "./util.js";

/** @typedef {import("./model.js").CorePlan} CorePlan */
/** @typedef {import("./model.js").Brief} Brief */

/**
 * @typedef {object} BriefRow
 * @property {string} label
 * @property {string} from
 * @property {string} to
 */

/**
 * @typedef {object} BudgetRow
 * @property {string} category
 * @property {number} before
 * @property {number} after
 * @property {number} committed
 * @property {boolean} added
 * @property {boolean} removed
 */

/**
 * @typedef {object} TimelineShift
 * @property {number|null} shift days the event moved (positive = later)
 * @property {number} overdueBefore
 * @property {number} overdueAfter
 * @property {boolean} compressed true when lead times no longer fit and were scaled down
 */

/**
 * @typedef {object} PlanDiff
 * @property {BriefRow[]} brief
 * @property {BudgetRow[]} budget
 * @property {boolean} budgetChanged
 * @property {number} totalBefore
 * @property {number} totalAfter
 * @property {import("./model.js").Task[]} tasksAdded
 * @property {import("./model.js").Task[]} tasksRemoved
 * @property {import("./model.js").Vendor[]} vendorsAdded
 * @property {import("./model.js").Vendor[]} vendorsChanged vendors that gained checklist items
 * @property {import("./model.js").Idea[]} ideasAdded
 * @property {TimelineShift|null} timeline set when the event date moved
 * @property {boolean} empty true when nothing changes
 */

/** @typedef {[keyof Brief, string, (value: unknown) => string]} BriefField */

/**
 * Brief fields shown in a diff: [field, label, formatter].
 * @param {string} currency
 * @returns {BriefField[]}
 */
const briefFields = (currency) => {
  /** @param {unknown} value */
  const shown = (value) => String(value ?? "");
  /** @param {string} empty */
  const orElse = (empty) => (/** @type {unknown} */ value) => (value ? shown(value) : empty);
  return [
    ["budget", "Total budget", (value) => formatMoney(Number(value), currency)],
    ["guests", "Guests", shown],
    ["date", "Event date", (value) => (value ? formatDate(parseIsoDate(String(value))) : "none")],
    ["venueCapacity", "Venue capacity", orElse("not set")],
    ["style", "Theme", orElse("—")],
    ["notes", "Priorities", orElse("—")],
    ["name", "Name", shown],
    ["city", "City", shown],
    ["time", "Start time", orElse("—")],
    ["currency", "Currency", shown],
  ];
};

/**
 * Items of `list` whose id isn't in `other`.
 * @template {{id: string}} T
 * @param {T[]} list
 * @param {T[]} other
 * @returns {T[]}
 */
const missingFrom = (list, other) => list.filter((item) => !other.some((x) => x.id === item.id));

/**
 * @param {Brief} before
 * @param {Brief} after
 * @returns {BriefRow[]}
 */
function briefRows(before, after) {
  /** @type {BriefRow[]} */
  const rows = [];
  for (const [field, label, show] of briefFields(after.currency)) {
    if ((before[field] ?? "") !== (after[field] ?? "")) {
      rows.push({ label, from: show(before[field]), to: show(after[field]) });
    }
  }
  return rows;
}

/**
 * @param {CorePlan} before
 * @param {CorePlan} after
 * @returns {BudgetRow[]}
 */
function budgetRows(before, after) {
  const lineIds = [...new Set([...before.budget, ...after.budget].map((line) => line.id))];
  return lineIds.flatMap((id) => {
    const old = before.budget.find((line) => line.id === id);
    const now = after.budget.find((line) => line.id === id);
    const line = now || old;
    if (!line) return [];
    return [
      {
        category: line.category,
        before: old ? old.amount : 0,
        after: now ? now.amount : 0,
        committed: line.committed || 0,
        added: !old,
        removed: !now,
      },
    ];
  });
}

/**
 * How moving the event date changes the timeline, or null when the date didn't move.
 * @param {CorePlan} before
 * @param {CorePlan} after
 * @returns {TimelineShift|null}
 */
function timelineShift(before, after) {
  if (before.brief.date === after.brief.date) return null;
  const oldDate = parseIsoDate(before.brief.date);
  const newDate = parseIsoDate(after.brief.date);
  const afterAnalysis = analyze(after);
  return {
    shift: oldDate && newDate ? daysBetween(oldDate, newDate) : null,
    overdueBefore: analyze(before).overdue.length,
    overdueAfter: afterAnalysis.overdue.length,
    compressed: afterAnalysis.schedule.compressed,
  };
}

/**
 * Describes what changes between two versions of a plan, for the approval preview.
 * @param {CorePlan} before
 * @param {CorePlan} after
 * @returns {PlanDiff}
 */
export function diffPlans(before, after) {
  const budget = budgetRows(before, after);
  const diff = {
    brief: briefRows(before.brief, after.brief),
    budget,
    budgetChanged: budget.some((row) => row.before !== row.after || row.added || row.removed),
    totalBefore: sum(before.budget.map((line) => line.amount)),
    totalAfter: sum(after.budget.map((line) => line.amount)),
    tasksAdded: missingFrom(after.tasks, before.tasks),
    tasksRemoved: missingFrom(before.tasks, after.tasks),
    vendorsAdded: missingFrom(after.vendors, before.vendors),
    vendorsChanged: after.vendors.filter((vendor) => {
      const old = before.vendors.find((x) => x.id === vendor.id);
      return old && old.checklist.length !== vendor.checklist.length;
    }),
    ideasAdded: missingFrom(after.ideas, before.ideas),
    timeline: timelineShift(before, after),
  };
  const empty =
    !diff.brief.length &&
    !diff.budgetChanged &&
    !diff.tasksAdded.length &&
    !diff.tasksRemoved.length &&
    !diff.vendorsAdded.length &&
    !diff.vendorsChanged.length &&
    !diff.ideasAdded.length;
  return { ...diff, empty };
}
