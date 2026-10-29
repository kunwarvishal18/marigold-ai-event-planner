/**
 * @file The event health score: five components of 20 points each, scored from what the risk
 * checks found. Every lost point comes with a reason and an action. Deterministic, no AI.
 */
import { sum } from "./util.js";

/** @typedef {import("./constants.js").Severity} Severity */
/** @typedef {import("./model.js").CorePlan} Plan */
/** @typedef {import("./model.js").Task} Task */
/** @typedef {import("./scheduler.js").Schedule} Schedule */
/** @typedef {import("./risks.js").Risk} Risk */
/** @typedef {import("./risks.js").BudgetFindings} BudgetFindings */
/** @typedef {import("./risks.js").TimelineFindings} TimelineFindings */
/** @typedef {import("./risks.js").VendorFindings} VendorFindings */

/**
 * @typedef {object} Deduction health points lost, why, and what would win them back
 * @property {number} points
 * @property {string} reason
 * @property {string} action
 */

/**
 * @typedef {object} HealthComponent
 * @property {string} name
 * @property {number} max
 * @property {number} score points kept, max minus the deductions taken
 * @property {Deduction[]} deductions the ones taken, in priority order
 * @property {string} [note] shown when there is nothing to measure yet
 */

/**
 * Health points lost per "event" risk, by severity.
 * @type {Readonly<Record<Severity, number>>}
 */
const EVENT_RISK_POINTS = { critical: 10, high: 6, medium: 3, low: 1 };

/**
 * @param {number} points
 * @param {string} reason
 * @param {string} action
 * @returns {Deduction}
 */
const deduction = (points, reason, action) => ({ points, reason, action });

/**
 * @param {BudgetFindings} budget
 * @returns {Deduction[]}
 */
function budgetDeductions(budget) {
  const deductions = [];
  if (budget.allocated !== budget.total) {
    deductions.push(deduction(4, "Budget not fully allocated", "Rebalance categories"));
  }
  if (budget.committed > budget.total) {
    deductions.push(
      deduction(10, "Committed spend is over budget", "Cut or renegotiate commitments"),
    );
  }
  for (const line of budget.overLines.slice(0, 2)) {
    deductions.push(deduction(3, `${line.category} over plan`, "Rebalance or renegotiate"));
  }
  if (!budget.hasContingency || budget.contingencyPct < 5) {
    deductions.push(deduction(4, "Contingency under 5%", "Top up contingency"));
  }
  for (const vendor of budget.quoteOver.slice(0, 2)) {
    deductions.push(
      deduction(2, `${vendor.category} quote above allocation`, "Negotiate or rebalance"),
    );
  }
  return deductions;
}

/**
 * @param {Schedule} sched
 * @param {TimelineFindings} timeline
 * @returns {Deduction[]}
 */
function timelineDeductions(sched, timeline) {
  if (!sched.eventDate || sched.daysLeft == null) {
    return [deduction(10, "No event date", "Add the date")];
  }
  if (sched.daysLeft < 0) return [deduction(20, "Event date has passed", "Update the date")];
  const deductions = [];
  if (sched.daysLeft < timeline.minDays) {
    deductions.push(deduction(6, "Very short runway", "Prioritise critical tasks"));
  }
  for (const task of timeline.overdue.slice(0, 8)) {
    const points = task.priority === "high" ? 3 : 2;
    deductions.push(deduction(points, `Overdue: ${task.title}`, "Complete or reschedule"));
  }
  return deductions;
}

/**
 * @param {VendorFindings} vendors
 * @returns {Deduction[]}
 */
function vendorDeductions(vendors) {
  return [
    ...vendors.late.map((v) => deduction(6, `${v.category} past its book-by date`, "Book it now")),
    ...vendors.soon.map((v) =>
      deduction(2, `${v.category} due to be booked soon`, "Request quotes this week"),
    ),
    ...vendors.missing.map(([label]) => deduction(5, `No ${label}`, "Add this vendor")),
  ];
}

/**
 * Share of the tasks due before today that are done.
 * @param {Task[]} dueTasks
 * @returns {Deduction[]}
 */
function progressDeductions(dueTasks) {
  if (!dueTasks.length) return [];
  const doneDue = dueTasks.filter((task) => task.done).length;
  const lost = Math.round(20 - (20 * doneDue) / dueTasks.length);
  if (!lost) return [];
  return [
    deduction(
      lost,
      `${doneDue} of ${dueTasks.length} tasks due before today are done`,
      "Tick off finished tasks in Timeline",
    ),
  ];
}

/**
 * Five components, 20 points each. Deductions are listed in priority order and stop at zero.
 * @param {{plan: Plan, sched: Schedule, risks: Risk[], budget: BudgetFindings,
 *   timeline: TimelineFindings, vendors: VendorFindings}} findings
 * @returns {{score: number, components: HealthComponent[]}}
 */
export function scoreHealth({ plan, sched, risks, budget, timeline, vendors }) {
  const today = sched.today.getTime();
  const dueTasks = sched.eventDate
    ? plan.tasks.filter((task) => (sched.due[task.id]?.getTime() ?? Infinity) < today)
    : [];
  const eventRisks = risks
    .filter((risk) => risk.area === "event")
    .map((risk) => deduction(EVENT_RISK_POINTS[risk.sev], risk.title, risk.action));

  /** @type {Array<[string, Deduction[]]>} */
  const candidates = [
    ["Budget", budgetDeductions(budget)],
    ["Timeline", timelineDeductions(sched, timeline)],
    ["Vendors", vendorDeductions(vendors)],
    ["Task progress", progressDeductions(dueTasks)],
    ["Event risks", eventRisks],
  ];
  const components = candidates.map(([name, deductions]) => scoreComponent(name, 20, deductions));

  if (!dueTasks.length) {
    components[3].note = sched.eventDate
      ? "No tasks are due yet."
      : "Add a date to measure progress.";
  }
  return { score: sum(components.map((component) => component.score)), components };
}

/**
 * Takes deductions in order until the component reaches zero.
 * @param {string} name
 * @param {number} max
 * @param {Deduction[]} candidates
 * @returns {HealthComponent}
 */
function scoreComponent(name, max, candidates) {
  let left = max;
  const deductions = [];
  for (const { points, reason, action } of candidates) {
    const take = Math.min(points, left);
    if (take <= 0) break;
    left -= take;
    deductions.push({ points: take, reason, action });
  }
  return { name, max, deductions, score: left };
}
