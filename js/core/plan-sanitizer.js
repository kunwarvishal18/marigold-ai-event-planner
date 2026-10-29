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
  SEVERITY_RANK,
  TIME_PATTERN,
  VENDOR_STATUSES,
} from "./constants.js";
import { parseIsoDate } from "./dates.js";
import { PLAN_VERSION } from "./model.js";
import { breakCycles } from "./scheduler.js";
import { isNumeric, isPlainObject, safeAmount, uid } from "./util.js";

const MAX_HISTORY = 10;
const MAX_CHAT = 60;
const MAX_LOG = 40;

/** A string cut to a maximum length; other values become their string form, null becomes "". */
const text = (value, maxLength) => (value == null ? "" : String(value).slice(0, maxLength));
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const validId = (value) => typeof value === "string" && ID_PATTERN.test(value);
const idOrNew = (value) => (validId(value) ? value : uid());
const isoOrEmpty = (value) => (parseIsoDate(value) ? value : "");
const timeOrEmpty = (value) => (typeof value === "string" && TIME_PATTERN.test(value) ? value : "");
const optionalAmount = (value) => (value == null ? null : safeAmount(value));
const wholeOr = (value, fallback) => (Number.isInteger(value) ? value : fallback);
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
    createdAt: isNumeric(plan.createdAt) ? +plan.createdAt : Date.now(),
    updatedAt: isNumeric(plan.updatedAt) ? +plan.updatedAt : Date.now(),
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
      .filter((entry) => isPlainObject(entry.snap))
      .slice(0, MAX_HISTORY)
      .map((entry) => ({ title: text(entry.title, 120), at: +entry.at || 0, snap: entry.snap })),
    log: objects(plan.log)
      .slice(0, MAX_LOG)
      .map((entry) => ({
        text: text(entry.text, 300),
        origin: oneOf(entry.origin, ITEM_ORIGINS, "you"),
        at: +entry.at || 0,
      })),
    chat: objects(plan.chat)
      .filter((message) => CHAT_ROLES.includes(message.role))
      .slice(-MAX_CHAT)
      .map((message) => ({
        role: message.role,
        text: text(message.text, 2500),
        at: +message.at || 0,
      })),
  };
}

/** @returns {import("./model.js").Brief|null} null when the total budget isn't usable */
function cleanBrief(brief) {
  const budget = safeAmount(brief.budget);
  if (!budget) return null;
  const capacity = safeAmount(brief.venueCapacity);
  return {
    type: oneOf(brief.type, EVENT_TYPES, EVENT_TYPES[0]),
    name: text(brief.name, 90) || "Untitled event",
    date: isoOrEmpty(brief.date),
    time: timeOrEmpty(brief.time),
    guests: Math.max(1, Math.min(MAX_GUESTS, Math.round(+brief.guests) || 1)),
    venueCapacity: capacity ? Math.min(capacity, MAX_GUESTS * 10) : null,
    budget,
    currency: oneOf(brief.currency, CURRENCIES, CURRENCIES[0]),
    city: text(brief.city, 80),
    style: text(brief.style, 120),
    notes: text(brief.notes, 600),
  };
}

function cleanBudgetLine(line) {
  return {
    id: idOrNew(line.id),
    category: text(line.category, 60) || "Other",
    note: text(line.note, 200),
    amount: safeAmount(line.amount) ?? 0,
    committed: optionalAmount(line.committed),
  };
}

/** Keeps every task; drops dependency links that are unknown, self-links or loops. */
function cleanTasks(tasks) {
  const keptIds = new Set(tasks.filter((task) => validId(task.id)).map((task) => task.id));
  const withIds = tasks.map((task) => ({ task, id: validId(task.id) ? task.id : uid() }));
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
    offset: Math.max(0, Math.round(+task.offset) || 0),
    fixedOffset: !!task.fixedOffset,
    fixedDate: isoOrEmpty(task.fixedDate),
    priority: oneOf(task.priority, PRIORITIES, "medium"),
    deps: graph[i].dependsOn,
    done: !!task.done,
    origin: oneOf(task.origin, ITEM_ORIGINS, "template"),
  }));
}

function cleanVendor(vendor, lineIds) {
  return {
    id: idOrNew(vendor.id),
    category: text(vendor.category, 60) || "Vendor",
    critical: !!vendor.critical,
    origin: oneOf(vendor.origin, ITEM_ORIGINS, "template"),
    lineId: lineIds.has(vendor.lineId) ? vendor.lineId : null,
    bookBy: Math.max(0, Math.round(+vendor.bookBy) || 0),
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

function cleanRunOfShowRow(row) {
  return {
    id: idOrNew(row.id),
    time: timeOrEmpty(row.time),
    item: text(row.item, 120),
    owner: text(row.owner, 60),
  };
}

function cleanChecklistItem(item) {
  return { id: idOrNew(item.id), text: text(item.text, 160), done: !!item.done };
}

function cleanContact(contact) {
  return {
    id: idOrNew(contact.id),
    name: text(contact.name, 60),
    role: text(contact.role, 60),
    phone: text(contact.phone, 40),
  };
}

/** Stored AI risk reviews are re-checked like a fresh reply. */
function cleanAiRisks(review) {
  if (!isPlainObject(review)) return null;
  const items = objects(review.items)
    .filter((risk) => Object.hasOwn(SEVERITY_RANK, risk.sev) && text(risk.title, 100))
    .slice(0, 8)
    .map((risk) => ({
      sev: risk.sev,
      title: text(risk.title, 100),
      why: text(risk.why, 300),
      action: text(risk.action, 240),
      source: "ai",
    }));
  return { at: +review.at || 0, rev: wholeOr(review.rev, 0), items };
}
