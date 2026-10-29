/**
 * @file Rule-based risks and the event health score. Deterministic: no AI, no randomness.
 *
 * analyze() runs four independent checks (budget, timeline, vendors, event), then scores five
 * health components of 20 points each. Every lost point comes with a reason and an action.
 */
import { SEVERITY_RANK, isBooked, isContingency } from "./constants.js";
import { daysBetween } from "./dates.js";
import { formatDate, formatMoney } from "./format.js";
import { schedule } from "./scheduler.js";
import { isNumeric, sum } from "./util.js";

/** Vendors each event type can't happen without: [label, category pattern]. */
export const REQUIRED_VENDORS = {
  Wedding: [
    ["venue", /venue|hall|banquet|palace|lawn|resort|haveli|garden/],
    ["caterer", /cater|food|chef|kitchen/],
    ["photographer", /photo|video/],
  ],
  Birthday: [["food or cake supplier", /cake|bak|food|cater|dessert/]],
  "Community event": [
    ["venue or permit", /venue|permit|authority|ground|park|hall/],
    ["sound and stage", /sound|stage|audio|\bpa\b/],
    ["waste management", /waste|clean|sanitation|recycl|compost/],
  ],
};

/** Minimum sensible planning runway, in days, per event type. */
const MIN_RUNWAY_DAYS = { Wedding: 30, Birthday: 7, "Community event": 21 };
const DEFAULT_MIN_RUNWAY_DAYS = 14;

/** Health points lost per "event" risk, by severity. */
const EVENT_RISK_POINTS = { critical: 10, high: 6, medium: 3, low: 1 };

const OUTDOOR_PATTERN =
  /outdoor|garden|lawn|open[- ]air|beach|terrace|rooftop|park|festival|poolside|courtyard/;
const CROWD_PLAN_PATTERN = /security|crowd|volunteer|transport|parking|shuttle|steward/;

/**
 * @typedef {object} Risk
 * @property {"critical"|"high"|"medium"|"low"} sev
 * @property {"budget"|"timeline"|"vendors"|"event"} area
 * @property {string} title
 * @property {string} why
 * @property {string} action
 * @property {string} tab the plan tab where it can be fixed
 * @property {"rule"|"ai"} source
 */

/**
 * @typedef {object} Analysis
 * @property {import("./scheduler.js").Schedule} sc
 * @property {Risk[]} risks most severe first
 * @property {{score: number, comps: object[]}} health
 * @property {number} alloc sum of allocations
 * @property {number} committed sum of committed spend
 * @property {object[]} overdue overdue tasks
 * @property {number} contPct unspent contingency as a percent of the budget
 */

/**
 * Collects risks in a fixed order. Each check appends to the same list.
 */
class RiskList {
  constructor() {
    /** @type {Risk[]} */
    this.items = [];
  }

  add(sev, area, title, why, action, tab) {
    this.items.push({ sev, area, title, why, action, tab, source: "rule" });
  }
}

/**
 * Analyzes a plan: schedule, rule-based risks and the health score.
 * @param {import("./model.js").Plan} plan
 * @returns {Analysis}
 */
export function analyze(plan) {
  const sched = schedule(plan);
  const risks = new RiskList();
  const money = (amount) => formatMoney(amount, plan.brief.currency);

  const budget = checkBudget(plan, risks, money);
  const timeline = checkTimeline(plan, sched, risks);
  const vendors = checkVendors(plan, sched, risks);
  checkEvent(plan, sched, risks);
  risks.items.sort((a, b) => SEVERITY_RANK[a.sev] - SEVERITY_RANK[b.sev]);

  const health = scoreHealth({ plan, sched, risks: risks.items, budget, timeline, vendors });
  return {
    sc: sched,
    risks: risks.items,
    health,
    alloc: budget.alloc,
    committed: budget.committed,
    overdue: timeline.overdue,
    contPct: budget.contPct,
  };
}

function checkBudget(plan, risks, money) {
  const total = plan.brief.budget;
  const alloc = sum(plan.budget.map((line) => line.amount));
  const committed = sum(plan.budget.map((line) => line.committed || 0));

  if (alloc !== total) {
    risks.add(
      "high",
      "budget",
      "Budget not fully allocated",
      `Categories add up to ${money(alloc)} but the budget is ${money(total)}.`,
      "Use the optimizer or ask the co-planner to rebalance.",
      "budget",
    );
  }
  if (committed > total) {
    risks.add(
      "critical",
      "budget",
      "Committed spend exceeds the budget",
      `${money(committed)} committed against ${money(total)}: ${money(committed - total)} over.`,
      "Renegotiate or drop items, or raise the budget in Event details.",
      "budget",
    );
  }

  const overLines = plan.budget.filter((line) => (line.committed || 0) > line.amount);
  for (const line of overLines) {
    risks.add(
      "high",
      "budget",
      `${line.category} is over plan`,
      `Committed ${money(line.committed)} against ${money(line.amount)} allocated.`,
      "Rebalance from another category or the contingency.",
      "budget",
    );
  }

  const contingency = plan.budget.filter((line) => isContingency(line.category));
  const contFree = sum(contingency.map((line) => Math.max(0, line.amount - (line.committed || 0))));
  const contPct = total ? (contFree / total) * 100 : 0;
  if (!contingency.length) {
    risks.add(
      "medium",
      "budget",
      "No contingency reserve",
      "No category is set aside for surprises.",
      "Add a 5–10% contingency through the optimizer or the co-planner.",
      "budget",
    );
  } else if (contPct < 5) {
    risks.add(
      contPct < 2 ? "high" : "medium",
      "budget",
      "Contingency reserve is thin",
      `Unspent contingency is ${contPct.toFixed(1)}% of the budget. Many planners keep 5–10%.`,
      "Move money into contingency before committing more.",
      "budget",
    );
  }

  const quoteOver = checkQuotes(plan, risks, money);
  return {
    alloc,
    committed,
    total,
    overLines,
    hasContingency: contingency.length > 0,
    contPct,
    quoteOver,
  };
}

/** Vendors whose quote is above the budget line they're linked to. */
function checkQuotes(plan, risks, money) {
  const lineFor = (vendor) => plan.budget.find((line) => line.id === vendor.lineId);
  const quoteOver = plan.vendors.filter((vendor) => {
    if (!isNumeric(vendor.quote) || !vendor.lineId) return false;
    const line = lineFor(vendor);
    return line && +vendor.quote > line.amount;
  });
  for (const vendor of quoteOver) {
    const line = lineFor(vendor);
    risks.add(
      "medium",
      "budget",
      `${vendor.category} quote is above its allocation`,
      `Quote ${money(vendor.quote)} vs ${money(line.amount)} for ${line.category}.`,
      "Negotiate, compare another option, or rebalance.",
      "vendors",
    );
  }
  return quoteOver;
}

function checkTimeline(plan, sched, risks) {
  const { brief } = plan;
  const minDays = MIN_RUNWAY_DAYS[brief.type] || DEFAULT_MIN_RUNWAY_DAYS;
  let overdue = [];

  if (!sched.ev) {
    risks.add(
      "medium",
      "timeline",
      "No event date",
      "Without a date Marigold can't schedule tasks or flag overdue work.",
      "Add the date in Event details.",
      "timeline",
    );
    return { overdue, minDays };
  }
  if (sched.daysLeft < 0) {
    risks.add(
      "high",
      "timeline",
      "Event date has passed",
      `${formatDate(sched.ev)} was ${-sched.daysLeft} days ago.`,
      "If the event moved, update the date in Event details.",
      "timeline",
    );
    return { overdue, minDays };
  }

  if (sched.daysLeft < minDays) {
    risks.add(
      "high",
      "timeline",
      "Very short runway",
      `${sched.daysLeft} days left. A ${brief.type.toLowerCase()} usually needs at least ` +
        `${minDays} days to book key vendors.`,
      "Work through high-priority tasks first. Deadlines have been compressed to fit.",
      "timeline",
    );
  }

  overdue = plan.tasks.filter(
    (task) => !task.done && sched.due[task.id] && sched.due[task.id] < sched.today,
  );
  if (overdue.length) {
    const highCount = overdue.filter((task) => task.priority === "high").length;
    const oldest = overdue.slice().sort((a, b) => sched.due[a.id] - sched.due[b.id])[0];
    risks.add(
      highCount ? "high" : "medium",
      "timeline",
      `${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}`,
      `${highCount} high priority. Oldest: “${oldest.title}”, due ${formatDate(sched.due[oldest.id])}.`,
      "Finish them or ask the co-planner to reschedule.",
      "timeline",
    );
  }
  if (sched.compressed) {
    risks.add(
      "low",
      "timeline",
      "Timeline compressed",
      `Typical lead times don't fit into ${sched.windowDays} days, so every deadline was scaled to fit.`,
      "Book critical vendors first.",
      "timeline",
    );
  }
  return { overdue, minDays };
}

function checkVendors(plan, sched, risks) {
  const late = [];
  const soon = [];
  const eventAhead = sched.ev && sched.daysLeft >= 0;

  for (const vendor of eventAhead ? plan.vendors : []) {
    if (!vendor.critical || isBooked(vendor)) continue;
    const bookBy = sched.vendorDue[vendor.id];
    if (!bookBy) continue;
    const daysLeft = daysBetween(sched.today, bookBy);
    if (daysLeft < 0) {
      late.push(vendor);
      risks.add(
        "high",
        "vendors",
        `${vendor.category} not booked yet`,
        `Book-by date was ${formatDate(bookBy)}. Current status: ${vendor.status}.`,
        "Contact options now and record quotes in Vendors.",
        "vendors",
      );
    } else if (daysLeft <= 14) {
      soon.push(vendor);
      risks.add(
        "medium",
        "vendors",
        `Book ${vendor.category} soon`,
        `Book-by date ${formatDate(bookBy)} is ${daysLeft} day${daysLeft === 1 ? "" : "s"} away.`,
        "Shortlist and request quotes this week.",
        "vendors",
      );
    }
  }

  const { type } = plan.brief;
  const missing = (REQUIRED_VENDORS[type] || []).filter(
    ([, pattern]) => !plan.vendors.some((vendor) => pattern.test(vendor.category.toLowerCase())),
  );
  for (const [label] of missing) {
    risks.add(
      "high",
      "vendors",
      `No ${label} in the vendor list`,
      `Most ${type.toLowerCase()}s depend on a ${label}.`,
      "Ask the co-planner to add one, or add it in Vendors.",
      "vendors",
    );
  }
  return { late, soon, missing };
}

function checkEvent(plan, sched, risks) {
  const { brief } = plan;
  const capacity = +brief.venueCapacity || 0;

  if (capacity && brief.guests > capacity) {
    risks.add(
      "critical",
      "event",
      "Guest count exceeds venue capacity",
      `${brief.guests} guests for a venue that holds ${capacity}.`,
      "Trim the list, add a second space, or change venue.",
      "overview",
    );
  } else if (capacity && brief.guests > capacity * 0.9) {
    risks.add(
      "medium",
      "event",
      "Venue will be near capacity",
      `${brief.guests} of ${capacity} places (${Math.round((brief.guests / capacity) * 100)}%).`,
      "Check fire limits and plan seating carefully.",
      "overview",
    );
  } else if (!capacity && brief.guests >= 150) {
    risks.add(
      "low",
      "event",
      "Venue capacity not recorded",
      `With ${brief.guests} guests, capacity is worth confirming.`,
      "Add the venue capacity in Event details.",
      "overview",
    );
  }

  const themeText = `${brief.style} ${brief.notes} ${brief.name}`.toLowerCase();
  const outdoor = OUTDOOR_PATTERN.test(themeText) || brief.type === "Community event";
  if (outdoor && !plan.dayOf.weather.some((item) => item.done)) {
    const soon = sched.daysLeft != null && sched.daysLeft >= 0 && sched.daysLeft <= 30;
    risks.add(
      soon ? "medium" : "low",
      "event",
      "Outdoor elements without a weather backup",
      "The theme or event type suggests outdoor spaces. Marigold doesn't fetch live weather.",
      "Work through the weather checklist on the Event day tab.",
      "eventday",
    );
  }

  const planText = [...plan.tasks.map((t) => t.title), ...plan.vendors.map((v) => v.category)]
    .join(" ")
    .toLowerCase();
  if (brief.guests >= 300 && !CROWD_PLAN_PATTERN.test(planText)) {
    risks.add(
      "medium",
      "event",
      "No crowd or transport plan",
      `${brief.guests} guests need parking, arrival and crowd flow planning.`,
      "Ask the co-planner to add crowd and transport tasks.",
      "timeline",
    );
  }
}

/** Each deduction is [points, reason, action]. */
function budgetDeductions(budget) {
  const ded = [];
  if (budget.alloc !== budget.total) {
    ded.push([4, "Budget not fully allocated", "Rebalance categories"]);
  }
  if (budget.committed > budget.total) {
    ded.push([10, "Committed spend is over budget", "Cut or renegotiate commitments"]);
  }
  for (const line of budget.overLines.slice(0, 2)) {
    ded.push([3, `${line.category} over plan`, "Rebalance or renegotiate"]);
  }
  if (!budget.hasContingency || budget.contPct < 5) {
    ded.push([4, "Contingency under 5%", "Top up contingency"]);
  }
  for (const vendor of budget.quoteOver.slice(0, 2)) {
    ded.push([2, `${vendor.category} quote above allocation`, "Negotiate or rebalance"]);
  }
  return ded;
}

function timelineDeductions(sched, timeline) {
  if (!sched.ev) return [[10, "No event date", "Add the date"]];
  if (sched.daysLeft < 0) return [[20, "Event date has passed", "Update the date"]];
  const ded = [];
  if (sched.daysLeft < timeline.minDays) {
    ded.push([6, "Very short runway", "Prioritise critical tasks"]);
  }
  for (const task of timeline.overdue.slice(0, 8)) {
    ded.push([
      task.priority === "high" ? 3 : 2,
      `Overdue: ${task.title}`,
      "Complete or reschedule",
    ]);
  }
  return ded;
}

function vendorDeductions(vendors) {
  return [
    ...vendors.late.map((v) => [6, `${v.category} past its book-by date`, "Book it now"]),
    ...vendors.soon.map((v) => [
      2,
      `${v.category} due to be booked soon`,
      "Request quotes this week",
    ]),
    ...vendors.missing.map(([label]) => [5, `No ${label}`, "Add this vendor"]),
  ];
}

/** Share of the tasks due before today that are done. */
function progressDeductions(dueTasks) {
  if (!dueTasks.length) return [];
  const doneDue = dueTasks.filter((task) => task.done).length;
  const lost = Math.round(20 - (20 * doneDue) / dueTasks.length);
  if (!lost) return [];
  return [
    [
      lost,
      `${doneDue} of ${dueTasks.length} tasks due before today are done`,
      "Tick off finished tasks in Timeline",
    ],
  ];
}

/**
 * Five components, 20 points each. Deductions are listed in priority order and stop at zero.
 */
function scoreHealth({ plan, sched, risks, budget, timeline, vendors }) {
  const dueTasks = sched.ev
    ? plan.tasks.filter((task) => sched.due[task.id] && sched.due[task.id] < sched.today)
    : [];
  const eventRisks = risks
    .filter((risk) => risk.area === "event")
    .map((risk) => [EVENT_RISK_POINTS[risk.sev], risk.title, risk.action]);

  const comps = [
    ["Budget", budgetDeductions(budget)],
    ["Timeline", timelineDeductions(sched, timeline)],
    ["Vendors", vendorDeductions(vendors)],
    ["Task progress", progressDeductions(dueTasks)],
    ["Event risks", eventRisks],
  ].map(([name, ded]) => applyDeductions({ name, max: 20, ded }));

  if (!dueTasks.length) {
    comps[3].note = sched.ev ? "No tasks are due yet." : "Add a date to measure progress.";
  }
  return { score: sum(comps.map((c) => c.got)), comps };
}

/** Takes deductions in order until the component reaches zero. */
function applyDeductions(component) {
  let left = component.max;
  const ded = [];
  for (const [pts, reason, action] of component.ded) {
    const take = Math.min(pts, left);
    if (take <= 0) break;
    left -= take;
    ded.push({ pts: take, reason, action });
  }
  return { ...component, ded, got: left };
}
