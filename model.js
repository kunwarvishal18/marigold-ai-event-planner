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

/**
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
 * @typedef {object} Plan
 * @property {number} v schema version (PLAN_VERSION)
 * @property {string} id
 * @property {"ai"|"template"|"example"|"legacy"} source
 * @property {string} createdOn YYYY-MM-DD the schedule is measured from
 * @property {number} rev increases with every structural change; stale proposals compare it
 * @property {Brief} brief
 * @property {string} summary
 * @property {Array<object>} budget lines {id, category, note, amount, committed}
 * @property {Array<object>} tasks {id, title, phase, offset, fixedOffset, fixedDate, priority, deps, done, origin}
 * @property {Array<object>} vendors see newVendor()
 * @property {Array<object>} ideas {id, title, detail, tag, costLow, costHigh, origin}
 * @property {Array<object>} runOfShow {id, time, item, owner}
 * @property {object|null} aiRisks the last AI risk review
 * @property {{contacts: object[], emergency: object[], weather: object[]}} dayOf
 * @property {Array<object>} history undo snapshots, newest first
 * @property {Array<object>} log change log, newest first
 * @property {Array<object>} chat co-planner messages
 */

/** Origin label for items created from generated content. */
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
 * @param {object} spec {category, critical, budgetCategory, bookByDaysBefore, checklist, questions}
 * @param {Array<object>} budget the plan's budget lines
 * @param {"ai"|"template"|"you"} origin
 * @returns {object} a vendor
 */
export function newVendor(spec, budget, origin) {
  return {
    id: uid(),
    category: clip(spec.category, 60),
    critical: !!spec.critical,
    origin,
    lineId:
      matchLine(spec.budgetCategory || spec.category, budget) || matchLine(spec.category, budget),
    bookBy: Math.max(0, Math.round(+spec.bookByDaysBefore || 0)),
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
  const plan = {
    v: PLAN_VERSION,
    id: uid(),
    source,
    createdOn: createdOn || toIsoDate(today()),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rev: 0,
    brief: { ...brief },
    summary: clip(data.summary, 700),
    budget: [],
    tasks: [],
    vendors: [],
    ideas: [],
    runOfShow: [],
    aiRisks: null,
    dayOf: { contacts: [], emergency: checklistFrom(EMERGENCY), weather: checklistFrom(WEATHER) },
    history: [],
    log: [],
    chat: [],
  };

  const pctTotal = sum(data.budget.map((line) => line.pct)) || 1;
  const fit = fitToTotal(
    data.budget.map((line) => (line.pct / pctTotal) * brief.budget),
    data.budget.map(() => 0),
    brief.budget,
  );
  plan.budget = data.budget.map((line, i) => ({
    id: uid(),
    category: clip(line.category, 60),
    note: clip(line.note, 200),
    amount: fit.amounts[i],
    committed: null,
  }));

  const idForKey = {};
  data.tasks.forEach((task) => {
    idForKey[task.key] = uid();
  });
  plan.tasks = data.tasks.map((task) => ({
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

  plan.vendors = data.vendors.map((vendor) => newVendor(vendor, plan.budget, origin));
  plan.ideas = data.ideas.map((idea) => ({
    id: uid(),
    title: clip(idea.title, 90),
    detail: clip(idea.detail, 320),
    tag: clip(idea.tag, 24) || "Idea",
    costLow: isNumeric(idea.costLow) ? Math.round(+idea.costLow) : null,
    costHigh: isNumeric(idea.costHigh) ? Math.round(+idea.costHigh) : null,
    origin,
  }));

  const runOfShow = data.runOfShow?.length ? data.runOfShow : templateData(brief.type).runOfShow;
  plan.runOfShow = runOfShow.map((row) => ({
    id: uid(),
    time: row.time,
    item: clip(row.item, 120),
    owner: clip(row.owner, 60),
  }));

  if (data.risks?.length) plan.aiRisks = { at: Date.now(), rev: 0, items: data.risks };
  return plan;
}
