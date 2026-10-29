/**
 * @file Rule-based risks. Deterministic: no AI, no randomness.
 *
 * analyze() runs four independent checks (budget, timeline, vendors, event) and then scores the
 * plan's health from what they found (see health.js).
 */
import { SEVERITY_RANK, isContingency } from "./constants.js";
import { formatDate, moneyIn } from "./format.js";
import { scoreHealth } from "./health.js";
import { daysToBook, schedule } from "./scheduler.js";
import { isNumeric, sum } from "./util.js";

/**
 * Vendors each event type can't happen without: [label, category pattern].
 * @type {Readonly<Record<string, Array<[string, RegExp]>>>}
 */
const REQUIRED_VENDORS = {
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

/**
 * Minimum sensible planning runway, in days, per event type.
 * @type {Readonly<Record<string, number>>}
 */
const MIN_RUNWAY_DAYS = { Wedding: 30, Birthday: 7, "Community event": 21 };
const DEFAULT_MIN_RUNWAY_DAYS = 14;

const OUTDOOR_PATTERN =
  /outdoor|garden|lawn|open[- ]air|beach|terrace|rooftop|park|festival|poolside|courtyard/;
const CROWD_PLAN_PATTERN = /security|crowd|volunteer|transport|parking|shuttle|steward/;

/** @typedef {import("./constants.js").Severity} Severity */
/** @typedef {import("./model.js").CorePlan} Plan the plan content (history, chat and log unused) */
/** @typedef {import("./model.js").Task} Task */
/** @typedef {import("./model.js").Vendor} Vendor */
/** @typedef {import("./model.js").BudgetLine} BudgetLine */
/** @typedef {import("./scheduler.js").Schedule} Schedule */
/** @typedef {(amount: number|null) => string} Money formats an amount in the plan's currency */

/**
 * @typedef {object} Risk
 * @property {Severity} sev
 * @property {"budget"|"timeline"|"vendors"|"event"} area
 * @property {string} title
 * @property {string} why
 * @property {string} action
 * @property {string} tab the plan tab where it can be fixed
 * @property {"rule"} source
 */

/**
 * @typedef {object} Analysis
 * @property {Schedule} schedule
 * @property {Risk[]} risks most severe first
 * @property {{score: number, components: import("./health.js").HealthComponent[]}} health
 * @property {number} allocated sum of allocations
 * @property {number} committed sum of committed spend
 * @property {Task[]} overdue overdue tasks
 * @property {number} contingencyPct unspent contingency as a percent of the budget
 */

/**
 * @typedef {object} BudgetFindings
 * @property {number} allocated
 * @property {number} committed
 * @property {number} total
 * @property {BudgetLine[]} overLines lines with more committed than allocated
 * @property {boolean} hasContingency
 * @property {number} contingencyPct
 * @property {Vendor[]} quoteOver vendors quoted above their budget line
 */

/** @typedef {{overdue: Task[], minDays: number}} TimelineFindings */
/** @typedef {{late: Vendor[], soon: Vendor[], missing: Array<[string, RegExp]>}} VendorFindings */

/**
 * Collects risks in a fixed order. Each check appends to the same list.
 */
class RiskList {
  constructor() {
    /** @type {Risk[]} */
    this.items = [];
  }

  /**
   * @param {Severity} sev
   * @param {Risk["area"]} area
   * @param {string} title
   * @param {string} why
   * @param {string} action
   * @param {string} tab
   */
  add(sev, area, title, why, action, tab) {
    this.items.push({ sev, area, title, why, action, tab, source: "rule" });
  }
}

/**
 * Analyzes a plan: schedule, rule-based risks and the health score.
 * @param {Plan} plan
 * @returns {Analysis}
 */
export function analyze(plan) {
  const sched = schedule(plan);
  const risks = new RiskList();
  const money = moneyIn(plan.brief.currency);

  const budget = checkBudget(plan, risks, money);
  const timeline = checkTimeline(plan, sched, risks);
  const vendors = checkVendors(plan, sched, risks);
  checkEvent(plan, sched, risks);
  risks.items.sort((a, b) => SEVERITY_RANK[a.sev] - SEVERITY_RANK[b.sev]);

  const health = scoreHealth({ plan, sched, risks: risks.items, budget, timeline, vendors });
  return {
    schedule: sched,
    risks: risks.items,
    health,
    allocated: budget.allocated,
    committed: budget.committed,
    overdue: timeline.overdue,
    contingencyPct: budget.contingencyPct,
  };
}

/**
 * @param {Plan} plan
 * @param {RiskList} risks
 * @param {Money} money
 * @returns {BudgetFindings}
 */
function checkBudget(plan, risks, money) {
  const total = plan.brief.budget;
  const allocated = sum(plan.budget.map((line) => line.amount));
  const committed = sum(plan.budget.map((line) => line.committed || 0));

  if (allocated !== total) {
    risks.add(
      "high",
      "budget",
      "Budget not fully allocated",
      `Categories add up to ${money(allocated)} but the budget is ${money(total)}.`,
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

  return {
    allocated,
    committed,
    total,
    overLines,
    ...checkContingency(plan, risks),
    quoteOver: checkQuotes(plan, risks, money),
  };
}

/**
 * Whether there is a contingency reserve, and how much of it is unspent.
 * @param {Plan} plan
 * @param {RiskList} risks
 * @returns {{hasContingency: boolean, contingencyPct: number}}
 */
function checkContingency(plan, risks) {
  const total = plan.brief.budget;
  const contingency = plan.budget.filter((line) => isContingency(line.category));
  const contFree = sum(contingency.map((line) => Math.max(0, line.amount - (line.committed || 0))));
  const contingencyPct = total ? (contFree / total) * 100 : 0;
  if (!contingency.length) {
    risks.add(
      "medium",
      "budget",
      "No contingency reserve",
      "No category is set aside for surprises.",
      "Add a 5–10% contingency through the optimizer or the co-planner.",
      "budget",
    );
  } else if (contingencyPct < 5) {
    risks.add(
      contingencyPct < 2 ? "high" : "medium",
      "budget",
      "Contingency reserve is thin",
      `Unspent contingency is ${contingencyPct.toFixed(1)}% of the budget. Many planners keep 5–10%.`,
      "Move money into contingency before committing more.",
      "budget",
    );
  }
  return { hasContingency: contingency.length > 0, contingencyPct };
}

/**
 * Vendors whose quote is above the budget line they're linked to.
 * @param {Plan} plan
 * @param {RiskList} risks
 * @param {Money} money
 * @returns {Vendor[]}
 */
function checkQuotes(plan, risks, money) {
  /** @type {Vendor[]} */
  const quoteOver = [];
  for (const vendor of plan.vendors) {
    const line = plan.budget.find((budgetLine) => budgetLine.id === vendor.lineId);
    if (!line || !isNumeric(vendor.quote) || Number(vendor.quote) <= line.amount) continue;
    quoteOver.push(vendor);
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

/**
 * @param {Plan} plan
 * @param {Schedule} sched
 * @param {RiskList} risks
 * @returns {TimelineFindings}
 */
function checkTimeline(plan, sched, risks) {
  const { brief } = plan;
  const minDays = MIN_RUNWAY_DAYS[brief.type] || DEFAULT_MIN_RUNWAY_DAYS;
  /** @type {Task[]} */
  const overdue = [];

  if (!sched.eventDate || sched.daysLeft == null) {
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
      `${formatDate(sched.eventDate)} was ${-sched.daysLeft} days ago.`,
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

  const overdueTasks = checkOverdue(plan, sched, risks);
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
  return { overdue: overdueTasks, minDays };
}

/**
 * Unfinished tasks whose due date has passed.
 * @param {Plan} plan
 * @param {Schedule} sched
 * @param {RiskList} risks
 * @returns {Task[]}
 */
function checkOverdue(plan, sched, risks) {
  const dueTime = (/** @type {Task} */ task) => sched.due[task.id]?.getTime() ?? Infinity;
  const overdue = plan.tasks.filter((task) => !task.done && dueTime(task) < sched.today.getTime());
  if (!overdue.length) return overdue;
  const highCount = overdue.filter((task) => task.priority === "high").length;
  const oldest = overdue.slice().sort((a, b) => dueTime(a) - dueTime(b))[0];
  risks.add(
    highCount ? "high" : "medium",
    "timeline",
    `${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}`,
    `${highCount} high priority. Oldest: “${oldest.title}”, due ${formatDate(sched.due[oldest.id])}.`,
    "Finish them or ask the co-planner to reschedule.",
    "timeline",
  );
  return overdue;
}

/**
 * @param {Plan} plan
 * @param {Schedule} sched
 * @param {RiskList} risks
 * @returns {VendorFindings}
 */
function checkVendors(plan, sched, risks) {
  return { ...checkBookings(plan, sched, risks), missing: checkRequiredVendors(plan, risks) };
}

/**
 * Critical vendors past, or within two weeks of, their book-by date.
 * @param {Plan} plan
 * @param {Schedule} sched
 * @param {RiskList} risks
 * @returns {{late: Vendor[], soon: Vendor[]}}
 */
function checkBookings(plan, sched, risks) {
  /** @type {Vendor[]} */
  const late = [];
  /** @type {Vendor[]} */
  const soon = [];
  for (const vendor of plan.vendors) {
    const daysLeft = daysToBook(vendor, sched);
    const bookBy = sched.vendorDue[vendor.id];
    if (daysLeft == null || !bookBy) continue;
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
  return { late, soon };
}

/**
 * Vendor types this kind of event can't happen without, that the plan doesn't list.
 * @param {Plan} plan
 * @param {RiskList} risks
 * @returns {Array<[string, RegExp]>}
 */
function checkRequiredVendors(plan, risks) {
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
  return missing;
}

/**
 * @param {Plan} plan
 * @param {Schedule} sched
 * @param {RiskList} risks
 */
function checkEvent(plan, sched, risks) {
  checkCapacity(plan.brief, risks);
  checkWeather(plan, sched, risks);
  checkCrowd(plan, risks);
}

/**
 * Guests against venue capacity.
 * @param {import("./model.js").Brief} brief
 * @param {RiskList} risks
 */
function checkCapacity(brief, risks) {
  const capacity = Number(brief.venueCapacity) || 0;

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
}

/**
 * Outdoor events need a weather backup.
 * @param {Plan} plan
 * @param {Schedule} sched
 * @param {RiskList} risks
 */
function checkWeather(plan, sched, risks) {
  const { brief } = plan;
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
}

/**
 * Large events need crowd and transport planning.
 * @param {Plan} plan
 * @param {RiskList} risks
 */
function checkCrowd(plan, risks) {
  const { brief } = plan;
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
