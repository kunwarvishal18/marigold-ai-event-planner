/**
 * @file Validation of plans that come from outside the running app: browser storage (which can be
 * stale, from an older version, or hand-edited) and undo snapshots.
 *
 * sanePlan() rebuilds a plan field by field from allow-listed values. Unknown fields are dropped,
 * enums fall back to safe defaults, ids that aren't short and attribute-safe are replaced, money
 * becomes whole numbers in [0, MAX_AMOUNT], and task links to missing tasks or in loops are removed.
 * The UI escapes everything it renders as well; this is the second line of defence.
 */
import {
  CHAT_ROLES,
  CURRENCIES,
  EVENT_TYPES,
  ID_PATTERN,
  ITEM_ORIGINS,
  MAX_GUESTS,
  PAYMENT_STATES,
  PLAN_SOURCES,
  PRIORITIES,
  SEVERITIES,
  TIME_PATTERN,
  VENDOR_STATUSES,
  isOneOf,
  PLAN_LIMITS,
  oneOf,
} from "./constants.js";
import { parseIsoDate } from "./dates.js";
import { PLAN_VERSION } from "./model.js";
import { breakCycles } from "./scheduler.js";
import { isNumeric, isPlainObject, safeAmount, uid } from "./util.js";

/** @typedef {Record<string, unknown>} Raw an untrusted object read from storage */

/**
 * A string cut to a maximum length; other values become their string form, null becomes "".
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string}
 */
const text = (value, maxLength) => (value == null ? "" : String(value).slice(0, maxLength));
/**
 * @param {unknown} value
 * @returns {value is string}
 */
const validId = (value) => typeof value === "string" && ID_PATTERN.test(value);
/** @type {(value: unknown) => string} */
const idOrNew = (value) => (validId(value) ? value : uid());
/** @type {(value: unknown) => string} */
const isoOrEmpty = (value) => (typeof value === "string" && parseIsoDate(value) ? value : "");
/** @type {(value: unknown) => string} */
const timeOrEmpty = (value) => (typeof value === "string" && TIME_PATTERN.test(value) ? value : "");
/** @type {(value: unknown) => number|null} */
const optionalAmount = (value) => (value == null ? null : safeAmount(value));
/** @type {(value: unknown, fallback: number) => number} */
const wholeOr = (value, fallback) =>
  typeof value === "number" && Number.isInteger(value) ? value : fallback;
/** @type {(value: unknown) => number} */
const timestamp = (value) => Number(value) || 0;
/** @type {(list: unknown) => Raw[]} */
const objects = (list) => (Array.isArray(list) ? list.filter(isPlainObject) : []);

/**
 * Validates a plan and returns a clean copy, or null if it can't be used.
 * @param {unknown} plan
 * @returns {import("./model.js").Plan|null}
 */
export function sanePlan(plan) {
  if (!isPlainObject(plan) || plan.v !== PLAN_VERSION || !validId(plan.id)) return null;
  if (!isPlainObject(plan.brief)) return null;
  if (!["budget", "tasks", "vendors", "ideas"].every((key) => Array.isArray(plan[key]))) {
    return null;
  }
  const brief = cleanBrief(plan.brief);
  if (!brief) return null;

  const budget = objects(plan.budget).map(cleanBudgetLine);
  const lineIds = new Set(budget.map((line) => line.id));
  const dayOf = isPlainObject(plan.dayOf) ? plan.dayOf : {};
  return {
    v: PLAN_VERSION,
    id: plan.id,
    source: oneOf(plan.source, PLAN_SOURCES, "template"),
    createdOn: isoOrEmpty(plan.createdOn),
    createdAt: isNumeric(plan.createdAt) ? Number(plan.createdAt) : Date.now(),
    updatedAt: isNumeric(plan.updatedAt) ? Number(plan.updatedAt) : Date.now(),
    rev: wholeOr(plan.rev, 0),
    brief,
    summary: text(plan.summary, 700),
    budget,
    tasks: cleanTasks(objects(plan.tasks)),
    vendors: objects(plan.vendors).map((vendor) => cleanVendor(vendor, lineIds)),
    ideas: objects(plan.ideas).map(cleanIdea),
    runOfShow: objects(plan.runOfShow).map(cleanRunOfShowRow),
    aiRisks: cleanAiRisks(plan.aiRisks),
    dayOf: {
      contacts: objects(dayOf.contacts).map(cleanContact),
      emergency: objects(dayOf.emergency).map(cleanChecklistItem),
      weather: objects(dayOf.weather).map(cleanChecklistItem),
    },
    history: objects(plan.history)
      .flatMap(({ title, at, snap }) =>
        isPlainObject(snap) ? [{ title: text(title, 120), at: timestamp(at), snap }] : [],
      )
      .slice(0, PLAN_LIMITS.history),
    log: objects(plan.log)
      .slice(0, PLAN_LIMITS.log)
      .map((entry) => ({
        text: text(entry.text, 300),
        origin: oneOf(entry.origin, ITEM_ORIGINS, "you"),
        at: timestamp(entry.at),
      })),
    chat: objects(plan.chat)
      .filter((message) => isOneOf(message.role, CHAT_ROLES))
      .slice(-PLAN_LIMITS.chat)
      .map((message) => ({
        role: oneOf(message.role, CHAT_ROLES, "note"),
        text: text(message.text, 2500),
        at: timestamp(message.at),
      })),
  };
}

/**
 * @param {Raw} brief
 * @returns {import("./model.js").Brief|null} null when the total budget isn't usable
 */
function cleanBrief(brief) {
  const budget = safeAmount(brief.budget);
  if (!budget) return null;
  const capacity = safeAmount(brief.venueCapacity);
  return {
    type: oneOf(brief.type, EVENT_TYPES, EVENT_TYPES[0]),
    name: text(brief.name, 90) || "Untitled event",
    date: isoOrEmpty(brief.date),
    time: timeOrEmpty(brief.time),
    guests: Math.max(1, Math.min(MAX_GUESTS, Math.round(Number(brief.guests)) || 1)),
    venueCapacity: capacity ? Math.min(capacity, MAX_GUESTS * 10) : null,
    budget,
    currency: oneOf(brief.currency, CURRENCIES, CURRENCIES[0]),
    city: text(brief.city, 80),
    style: text(brief.style, 120),
    notes: text(brief.notes, 600),
  };
}

/**
 * @param {Raw} line
 * @returns {import("./model.js").BudgetLine}
 */
function cleanBudgetLine(line) {
  return {
    id: idOrNew(line.id),
    category: text(line.category, 60) || "Other",
    note: text(line.note, 200),
    amount: safeAmount(line.amount) ?? 0,
    committed: optionalAmount(line.committed),
  };
}

/**
 * Keeps every task; drops dependency links that are unknown, self-links or loops.
 * @param {Raw[]} tasks
 * @returns {import("./model.js").Task[]}
 */
function cleanTasks(tasks) {
  const keptIds = new Set(tasks.map((task) => task.id).filter(validId));
  const withIds = tasks.map((task) => ({ task, id: idOrNew(task.id) }));
  const graph = withIds.map(({ task, id }) => ({
    key: id,
    dependsOn: [
      ...new Set(
        (Array.isArray(task.deps) ? task.deps : []).filter((dep) => dep !== id && keptIds.has(dep)),
      ),
    ],
  }));
  breakCycles(graph);
  return withIds.map(({ task, id }, i) => ({
    id,
    title: text(task.title, 160),
    phase: text(task.phase, 40) || "Planning",
    offset: Math.max(0, Math.round(Number(task.offset)) || 0),
    fixedOffset: !!task.fixedOffset,
    fixedDate: isoOrEmpty(task.fixedDate),
    priority: oneOf(task.priority, PRIORITIES, "medium"),
    deps: graph[i].dependsOn,
    done: !!task.done,
    origin: oneOf(task.origin, ITEM_ORIGINS, "template"),
  }));
}

/**
 * @param {Raw} vendor
 * @param {Set<string>} lineIds ids of the plan's budget lines
 * @returns {import("./model.js").Vendor}
 */
function cleanVendor(vendor, lineIds) {
  return {
    id: idOrNew(vendor.id),
    category: text(vendor.category, 60) || "Vendor",
    critical: !!vendor.critical,
    origin: oneOf(vendor.origin, ITEM_ORIGINS, "template"),
    lineId: validId(vendor.lineId) && lineIds.has(vendor.lineId) ? vendor.lineId : null,
    bookBy: Math.max(0, Math.round(Number(vendor.bookBy)) || 0),
    dueFixed: isoOrEmpty(vendor.dueFixed),
    checklist: objects(vendor.checklist).map(cleanChecklistItem),
    questions: (Array.isArray(vendor.questions) ? vendor.questions : []).map((q) => text(q, 200)),
    status: oneOf(vendor.status, VENDOR_STATUSES, VENDOR_STATUSES[0]),
    payment: oneOf(vendor.payment, PAYMENT_STATES, PAYMENT_STATES[0]),
    name: text(vendor.name, 80),
    contact: text(vendor.contact, 80),
    estimate: optionalAmount(vendor.estimate),
    quote: optionalAmount(vendor.quote),
    arrival: timeOrEmpty(vendor.arrival),
    notes: text(vendor.notes, 600),
    options: objects(vendor.options).map((option) => ({
      id: idOrNew(option.id),
      name: text(option.name, 80),
      contact: text(option.contact, 80),
      quote: optionalAmount(option.quote),
      notes: text(option.notes, 140),
    })),
  };
}

/**
 * @param {Raw} idea
 * @returns {import("./model.js").Idea}
 */
function cleanIdea(idea) {
  return {
    id: idOrNew(idea.id),
    title: text(idea.title, 90),
    detail: text(idea.detail, 320),
    tag: text(idea.tag, 24) || "Idea",
    costLow: optionalAmount(idea.costLow),
    costHigh: optionalAmount(idea.costHigh),
    origin: oneOf(idea.origin, ITEM_ORIGINS, "template"),
  };
}

/**
 * @param {Raw} row
 * @returns {import("./model.js").RunOfShowRow}
 */
function cleanRunOfShowRow(row) {
  return {
    id: idOrNew(row.id),
    time: timeOrEmpty(row.time),
    item: text(row.item, 120),
    owner: text(row.owner, 60),
  };
}

/**
 * @param {Raw} item
 * @returns {import("./model.js").ChecklistItem}
 */
function cleanChecklistItem(item) {
  return { id: idOrNew(item.id), text: text(item.text, 160), done: !!item.done };
}

/**
 * @param {Raw} contact
 * @returns {import("./model.js").Contact}
 */
function cleanContact(contact) {
  return {
    id: idOrNew(contact.id),
    name: text(contact.name, 60),
    role: text(contact.role, 60),
    phone: text(contact.phone, 40),
  };
}

/**
 * Stored AI risk reviews are re-checked like a fresh reply.
 * @param {unknown} review
 * @returns {import("./model.js").AiRiskReview|null}
 */
function cleanAiRisks(review) {
  if (!isPlainObject(review)) return null;
  const items = objects(review.items)
    .filter((risk) => isOneOf(risk.sev, SEVERITIES) && text(risk.title, 100))
    .slice(0, 8)
    .map((risk) => ({
      sev: oneOf(risk.sev, SEVERITIES, "low"),
      title: text(risk.title, 100),
      why: text(risk.why, 300),
      action: text(risk.action, 240),
      source: /** @type {const} */ ("ai"),
    }));
  return { at: timestamp(review.at), rev: wholeOr(review.rev, 0), items };
}
