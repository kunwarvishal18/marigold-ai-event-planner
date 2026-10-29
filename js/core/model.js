/**
 * @file The plan data model: how a brief plus generated content becomes a stored plan.
 */
import { fitToTotal } from "./budget.js";
import { toIsoDate, today } from "./dates.js";
import { EMERGENCY, WEATHER } from "./template-data.js";
import { templateData } from "./templates.js";
import { clip, isNumeric, normalizeName, sum, uid } from "./util.js";

/** Version number written into every stored plan. */
export const PLAN_VERSION = 2;

/** @typedef {import("./constants.js").PlanSource} PlanSource */
/** @typedef {import("./constants.js").ItemOrigin} ItemOrigin */
/** @typedef {import("./constants.js").Priority} Priority */

/**
 * The event brief: what the person told Marigold about the event. Numbers are validated before a
 * brief reaches the planner (see validateBrief in ui/form.js and cleanBrief in plan-sanitizer.js).
 * @typedef {object} Brief
 * @property {string} type "Wedding" | "Birthday" | "Community event"
 * @property {string} name
 * @property {string} date YYYY-MM-DD or ""
 * @property {string} [time] HH:MM or ""
 * @property {number} guests
 * @property {number|null} [venueCapacity]
 * @property {number} budget total, whole currency units
 * @property {string} currency ISO 4217 code
 * @property {string} [city]
 * @property {string} [style]
 * @property {string} [notes]
 */

/**
 * @typedef {object} BudgetLine
 * @property {string} id
 * @property {string} category
 * @property {string} note
 * @property {number} amount allocated, whole currency units
 * @property {number|null} committed spend already paid or signed for
 * @property {boolean} [locked] only on proposal input: keep this amount exactly
 */

/**
 * @typedef {object} Task
 * @property {string} id
 * @property {string} title
 * @property {string} phase
 * @property {number} offset days before the event
 * @property {boolean} fixedOffset true when the offset must not be scaled to fit a short runway
 * @property {string} fixedDate YYYY-MM-DD set by the person, or ""
 * @property {Priority} priority
 * @property {string[]} deps ids of tasks that must be done first
 * @property {boolean} done
 * @property {ItemOrigin} origin
 */

/**
 * @typedef {object} ChecklistItem
 * @property {string} id
 * @property {string} text
 * @property {boolean} done
 */

/**
 * @typedef {object} VendorOption a quote being compared for one vendor type
 * @property {string} id
 * @property {string} name
 * @property {string} contact
 * @property {number|null} quote
 * @property {string} notes
 */

/**
 * @typedef {object} Vendor
 * @property {string} id
 * @property {string} category vendor type, e.g. "Caterer"
 * @property {boolean} critical the event can't happen without it
 * @property {ItemOrigin} origin
 * @property {string|null} lineId the budget line it is paid from
 * @property {number} bookBy book this many days before the event
 * @property {string} dueFixed book-by date set by the person (YYYY-MM-DD), or ""
 * @property {ChecklistItem[]} checklist
 * @property {string[]} questions
 * @property {string} status one of VENDOR_STATUSES
 * @property {string} payment one of PAYMENT_STATES
 * @property {string} name
 * @property {string} contact
 * @property {number|null} estimate
 * @property {number|null} quote
 * @property {string} arrival HH:MM on the event day, or ""
 * @property {string} notes
 * @property {VendorOption[]} options
 */

/**
 * @typedef {object} Idea
 * @property {string} id
 * @property {string} title
 * @property {string} detail
 * @property {string} tag
 * @property {number|null} costLow
 * @property {number|null} costHigh
 * @property {ItemOrigin} origin
 */

/**
 * @typedef {object} RunOfShowRow
 * @property {string} id
 * @property {string} time HH:MM
 * @property {string} item
 * @property {string} owner
 */

/**
 * @typedef {object} Contact
 * @property {string} id
 * @property {string} name
 * @property {string} role
 * @property {string} phone
 */

/**
 * @typedef {object} AiRisk
 * @property {import("./constants.js").Severity} sev
 * @property {string} title
 * @property {string} why
 * @property {string} action
 * @property {"ai"} source
 */

/**
 * @typedef {object} AiRiskReview
 * @property {number} at when it was made (ms since epoch)
 * @property {number} rev the plan revision it reviewed
 * @property {AiRisk[]} items
 */

/**
 * @typedef {object} ChatMessage
 * @property {import("./constants.js").ChatRole} role
 * @property {string} text
 * @property {number} [at]
 */

/**
 * @typedef {object} LogEntry
 * @property {string} text
 * @property {ItemOrigin} origin
 * @property {number} at
 */

/**
 * @typedef {object} HistoryEntry an undo snapshot
 * @property {string} title
 * @property {number} at
 * @property {object} snap a CorePlan as saved; validated before use, since it comes from storage
 */

/**
 * @typedef {object} Plan
 * @property {number} v schema version (PLAN_VERSION)
 * @property {string} id
 * @property {PlanSource} source
 * @property {string} createdOn YYYY-MM-DD the schedule is measured from
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {number} rev increases with every structural change; stale proposals compare it
 * @property {Brief} brief
 * @property {string} summary
 * @property {BudgetLine[]} budget
 * @property {Task[]} tasks
 * @property {Vendor[]} vendors
 * @property {Idea[]} ideas
 * @property {RunOfShowRow[]} runOfShow
 * @property {AiRiskReview|null} aiRisks the last AI risk review
 * @property {{contacts: Contact[], emergency: ChecklistItem[], weather: ChecklistItem[]}} dayOf
 * @property {HistoryEntry[]} history undo snapshots, newest first
 * @property {LogEntry[]} log change log, newest first
 * @property {ChatMessage[]} chat co-planner messages
 */

/**
 * A plan without its undo history, chat and log: what a proposal or an undo snapshot replaces.
 * @typedef {Omit<Plan, "history" | "chat" | "log">} CorePlan
 */

/**
 * Origin label for items created from generated content.
 * @param {PlanSource} source
 * @returns {ItemOrigin}
 */
const originFor = (source) => (source === "ai" ? "ai" : "template");

/**
 * Finds the budget line whose category best matches a name (shared word stems).
 * @param {string} name e.g. a vendor category
 * @param {Array<{id: string, category: string}>} budget
 * @returns {string|null} the matching line id
 */
export function matchLine(name, budget) {
  const stems = normalizeName(name)
    .split(" ")
    .filter((word) => word.length > 2)
    .map((word) => word.slice(0, 5));
  let bestId = null;
  let bestScore = 0;
  for (const line of budget) {
    const lineStems = normalizeName(line.category)
      .split(" ")
      .map((word) => word.slice(0, 5));
    const score = stems.filter((stem) => lineStems.includes(stem)).length;
    if (score > bestScore) {
      bestScore = score;
      bestId = line.id;
    }
  }
  return bestId;
}

/**
 * Creates a vendor entry, linked to the closest budget line.
 * @param {import("./validation.js").VendorSpec} spec
 * @param {Array<{id: string, category: string}>} budget the plan's budget lines
 * @param {ItemOrigin} origin
 * @returns {Vendor}
 */
export function newVendor(spec, budget, origin) {
  return {
    id: uid(),
    category: clip(spec.category, 60),
    critical: !!spec.critical,
    origin,
    lineId:
      matchLine(spec.budgetCategory || spec.category, budget) || matchLine(spec.category, budget),
    bookBy: Math.max(0, Math.round(Number(spec.bookByDaysBefore) || 0)),
    dueFixed: "",
    checklist: (spec.checklist || [])
      .map((text) => ({ id: uid(), text: clip(text, 160), done: false }))
      .filter((item) => item.text),
    questions: (spec.questions || []).map((q) => clip(q, 200)).filter(Boolean),
    status: "Not started",
    payment: "Unpaid",
    name: "",
    contact: "",
    estimate: null,
    quote: null,
    arrival: "",
    notes: "",
    options: [],
  };
}

/**
 * @param {string[]} texts
 * @returns {ChecklistItem[]}
 */
const checklistFrom = (texts) => texts.map((text) => ({ id: uid(), text, done: false }));

/**
 * Builds a complete plan from a brief and generated (AI or template) content.
 * Budget percentages become exact whole amounts that add up to the brief's total.
 * @param {Brief} brief
 * @param {import("./validation.js").GeneratedPlan} data
 * @param {Plan["source"]} source
 * @param {string} [createdOn] YYYY-MM-DD, defaults to today
 * @returns {Plan}
 */
export function buildPlan(brief, data, source, createdOn) {
  const origin = originFor(source);
  const budget = budgetFromShares(data.budget, brief.budget);
  const runOfShow = data.runOfShow?.length
    ? data.runOfShow
    : (templateData(brief.type).runOfShow ?? []);
  return {
    v: PLAN_VERSION,
    id: uid(),
    source,
    createdOn: createdOn || toIsoDate(today()),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rev: 0,
    brief: { ...brief },
    summary: clip(data.summary, 700),
    budget,
    tasks: tasksFrom(data.tasks, origin),
    vendors: data.vendors.map((vendor) => newVendor(vendor, budget, origin)),
    ideas: data.ideas.map((idea) => ({
      id: uid(),
      title: clip(idea.title, 90),
      detail: clip(idea.detail, 320),
      tag: clip(idea.tag, 24) || "Idea",
      costLow: isNumeric(idea.costLow) ? Math.round(Number(idea.costLow)) : null,
      costHigh: isNumeric(idea.costHigh) ? Math.round(Number(idea.costHigh)) : null,
      origin,
    })),
    runOfShow: runOfShow.map((row) => ({
      id: uid(),
      time: row.time,
      item: clip(row.item, 120),
      owner: clip(row.owner, 60),
    })),
    aiRisks: data.risks?.length ? { at: Date.now(), rev: 0, items: data.risks } : null,
    dayOf: { contacts: [], emergency: checklistFrom(EMERGENCY), weather: checklistFrom(WEATHER) },
    history: [],
    log: [],
    chat: [],
  };
}

/**
 * Budget lines from percentage shares: exact whole amounts that add up to the total.
 * @param {import("./validation.js").BudgetShare[]} shares
 * @param {number} total
 * @returns {BudgetLine[]}
 */
function budgetFromShares(shares, total) {
  const pctTotal = sum(shares.map((line) => line.pct)) || 1;
  const fit = fitToTotal(
    shares.map((line) => (line.pct / pctTotal) * total),
    shares.map(() => 0),
    total,
  );
  const amounts = fit.ok ? fit.amounts : shares.map(() => 0);
  return shares.map((line, i) => ({
    id: uid(),
    category: clip(line.category, 60),
    note: clip(line.note, 200),
    amount: amounts[i],
    committed: null,
  }));
}

/**
 * Plan tasks from generated ones; dependency keys become task ids.
 * @param {import("./validation.js").GeneratedTask[]} generated
 * @param {ItemOrigin} origin
 * @returns {Task[]}
 */
function tasksFrom(generated, origin) {
  /** @type {Record<string, string>} */
  const idForKey = {};
  generated.forEach((task) => {
    idForKey[task.key] = uid();
  });
  return generated.map((task) => ({
    id: idForKey[task.key],
    title: clip(task.title, 160),
    phase: clip(task.phase, 40) || "Planning",
    offset: task.daysBefore,
    fixedOffset: false,
    fixedDate: "",
    priority: task.priority,
    deps: (task.dependsOn || []).map((key) => idForKey[key]).filter(Boolean),
    done: false,
    origin,
  }));
}
