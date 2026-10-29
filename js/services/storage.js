/**
 * @file Plan persistence. Plans live in localStorage under one key. Reads never throw and never
 * erase data:
 * - unreadable JSON is copied to a backup key before anything new is written;
 * - if that backup can't be made, saving is switched off for the session (read-only);
 * - plans written by a newer Marigold version, or that fail validation, are kept as-is but hidden.
 */
import { toIsoDate } from "../core/dates.js";
import { PLAN_VERSION, buildPlan } from "../core/model.js";
import { breakCycles } from "../core/scheduler.js";
import { MAX_GUESTS } from "../core/constants.js";
import { hasOwn, isNumeric, isPlainObject, safeAmount } from "../core/util.js";
import { STORAGE_KEYS, localStore } from "./local-store.js";
import { state } from "./state.js";
import { view } from "./view.js";

/** Plan ids are short and URL/attribute safe. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Older undo snapshots are dropped when storage is full. */
const HISTORY_KEPT_WHEN_FULL = 2;
const MAX_HISTORY = 10;

/** What the UI should tell the person about stored data. */
export const storageState = { corrupt: false, backupKey: null, readOnly: false };

/** Copies unreadable data to a backup key; if that fails, stops all writes. */
function quarantine(raw) {
  if (storageState.corrupt) return;
  const backupKey = `${STORAGE_KEYS.plans}.corrupt-${Date.now()}`;
  storageState.corrupt = true;
  if (localStore.setRaw(backupKey, raw)) storageState.backupKey = backupKey;
  else storageState.readOnly = true;
}

/**
 * Every stored plan, keyed by id (raw, not validated).
 * @returns {Record<string, unknown>} an object without a prototype, so ids like "__proto__" are safe
 */
export function allPlans() {
  const plans = Object.create(null);
  if (storageState.readOnly) return plans;
  const raw = localStore.raw(STORAGE_KEYS.plans);
  if (raw == null || raw === "") return plans;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (!isPlainObject(parsed)) {
    quarantine(raw);
    return plans;
  }
  for (const id of Object.keys(parsed)) plans[id] = parsed[id];
  return plans;
}

/**
 * @param {unknown} id
 * @returns {unknown} the stored (unvalidated) plan, or null
 */
export function getPlan(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
  const plans = allPlans();
  return hasOwn(plans, id) ? plans[id] : null;
}

/**
 * Replaces every stored plan.
 * @returns {boolean} false when saving is paused or storage refused the write
 */
export function writeAll(plans) {
  if (storageState.readOnly) return false;
  return localStore.set(STORAGE_KEYS.plans, plans);
}

/**
 * Deletes one stored plan.
 * @returns {boolean} false if the change couldn't be saved
 */
export function deleteStoredPlan(id) {
  const plans = allPlans();
  delete plans[id];
  return writeAll(plans);
}

/** Saves the open plan, trimming undo history if storage is full. Reports problems as toasts. */
export function savePlan() {
  if (!state.plan) return;
  state.plan.updatedAt = Date.now();
  if (storageState.readOnly) {
    view.toast(
      "Saving is paused: saved data on this device couldn't be read or backed up, so Marigold " +
        "won't overwrite it. Your changes last until you close the page.",
      true,
    );
    view.renderSection("saved");
    return;
  }

  const plans = allPlans();
  plans[state.plan.id] = state.plan;
  let saved = writeAll(plans);
  if (!saved) {
    for (const plan of Object.values(plans)) {
      if (plan && Array.isArray(plan.history)) {
        plan.history = plan.history.slice(0, HISTORY_KEPT_WHEN_FULL);
      }
    }
    saved = writeAll(plans);
  }
  if (!saved) {
    view.toast(
      "Couldn't save on this device. Browser storage may be full or blocked; your changes last " +
        "until you close the page.",
      true,
    );
  }
  localStore.set(STORAGE_KEYS.lastPlanId, state.plan.id);
  view.renderSection("saved");
}

/**
 * Counts stored entries that are kept but not shown, so the UI can say so.
 * @returns {{newer: number, invalid: number}}
 */
export function hiddenCounts() {
  let newer = 0;
  let invalid = 0;
  for (const plan of Object.values(allPlans())) {
    if (plan && typeof plan === "object" && isNumeric(plan.v) && +plan.v > PLAN_VERSION) newer++;
    else if (!sanePlan(plan)) invalid++;
  }
  return { newer, invalid };
}

const text = (value, maxLength) => {
  if (typeof value === "string") return value.slice(0, maxLength);
  return value == null ? "" : String(value).slice(0, maxLength);
};
const optionalAmount = (value) => (value == null ? null : safeAmount(value));
const objectsIn = (list) => (Array.isArray(list) ? list.filter(isPlainObject) : []);

/**
 * Validates a stored plan and returns a cleaned copy, or null if it can't be used.
 * Money becomes whole numbers in [0, MAX_AMOUNT]; task links to missing tasks or in loops are
 * dropped. Never trusts stored data: it may come from an older version or be hand-edited.
 * @param {unknown} plan
 * @returns {import("../core/model.js").Plan|null}
 */
export function sanePlan(plan) {
  if (!isPlainObject(plan) || plan.v !== PLAN_VERSION) return null;
  if (typeof plan.id !== "string" || !ID_PATTERN.test(plan.id) || !isPlainObject(plan.brief)) {
    return null;
  }
  if (!["budget", "tasks", "vendors", "ideas"].every((key) => Array.isArray(plan[key]))) {
    return null;
  }
  const total = safeAmount(plan.brief.budget);
  if (!total) return null;

  const clean = {
    history: [],
    log: [],
    chat: [],
    runOfShow: [],
    dayOf: { contacts: [], emergency: [], weather: [] },
    rev: 0,
    ...plan,
  };
  clean.brief = {
    ...plan.brief,
    budget: total,
    guests: Math.max(1, Math.min(MAX_GUESTS, Math.round(+plan.brief.guests) || 1)),
    name: text(plan.brief.name, 90) || "Untitled event",
  };
  clean.budget = plan.budget.filter(isPlainObject).map((line) => ({
    ...line,
    category: text(line.category, 60) || "Other",
    amount: safeAmount(line.amount) ?? 0,
    committed: optionalAmount(line.committed),
  }));
  clean.vendors = plan.vendors.filter(isPlainObject).map((vendor) => ({
    ...vendor,
    estimate: optionalAmount(vendor.estimate),
    quote: optionalAmount(vendor.quote),
    checklist: objectsIn(vendor.checklist),
    questions: Array.isArray(vendor.questions) ? vendor.questions.map((q) => text(q, 200)) : [],
    options: objectsIn(vendor.options),
  }));
  clean.ideas = plan.ideas.filter(isPlainObject).map((idea) => ({
    ...idea,
    costLow: optionalAmount(idea.costLow),
    costHigh: optionalAmount(idea.costHigh),
  }));
  clean.tasks = cleanTasks(plan.tasks);

  for (const key of ["history", "log", "chat", "runOfShow"]) {
    if (!Array.isArray(clean[key])) clean[key] = [];
  }
  clean.history = clean.history.slice(0, MAX_HISTORY);
  if (!isPlainObject(clean.dayOf)) clean.dayOf = { contacts: [], emergency: [], weather: [] };
  for (const key of ["contacts", "emergency", "weather"]) {
    if (!Array.isArray(clean.dayOf[key])) clean.dayOf = { ...clean.dayOf, [key]: [] };
  }
  if (!Number.isInteger(clean.rev)) clean.rev = 0;
  return clean;
}

/** Keeps tasks with string ids; drops dependency links that are unknown, self-links or loops. */
function cleanTasks(tasks) {
  const valid = tasks.filter((task) => isPlainObject(task) && typeof task.id === "string");
  const ids = new Set(valid.map((task) => task.id));
  const graph = valid.map((task) => ({
    key: task.id,
    dependsOn: [
      ...new Set(
        (Array.isArray(task.deps) ? task.deps : []).filter(
          (dep) => typeof dep === "string" && dep !== task.id && ids.has(dep),
        ),
      ),
    ],
  }));
  breakCycles(graph);
  return valid.map((task, i) => ({
    ...task,
    title: text(task.title, 160),
    offset: Math.max(0, Math.round(+task.offset) || 0),
    deps: graph[i].dependsOn,
  }));
}

/**
 * One-time import of plans saved by Marigold v1 (a different shape, stored under another key).
 * Example plans are skipped; anything that fails to convert is left alone.
 */
export function migrateV1() {
  const legacy = localStore.get(STORAGE_KEYS.legacyPlans, null);
  if (!legacy || localStore.get(STORAGE_KEYS.migrated, false)) return;
  const plans = allPlans();
  for (const old of Object.values(legacy)) {
    try {
      if (!old || !old.plan || !old.brief || old.example) continue;
      const plan = convertV1Plan(old);
      plans[plan.id] = plan;
    } catch {
      // Leave plans that can't be converted where they are.
    }
  }
  if (writeAll(plans)) localStore.set(STORAGE_KEYS.migrated, true);
}

function convertV1Plan(old) {
  const data = {
    summary: old.plan.summary,
    budget: old.plan.budget.map((line) => ({
      category: line.category,
      pct: +line.pct || 0,
      note: line.note,
    })),
    tasks: [],
    vendors: old.plan.vendors.map((vendor) => ({
      category: vendor.category,
      checklist: vendor.checklist,
      questions: vendor.questions,
      bookByDaysBefore: 30,
    })),
    ideas: old.plan.ideas || [],
  };
  old.plan.timeline.forEach((stage, i) =>
    stage.tasks.forEach((title, j) =>
      data.tasks.push({
        key: `t${i}.${j}`,
        title,
        phase: stage.title,
        daysBefore: (+stage.weeksBefore || 0) * 7,
        priority: "medium",
        dependsOn: [],
      }),
    ),
  );

  const brief = { ...old.brief, time: "", venueCapacity: null };
  const savedOn = toIsoDate(new Date(old.savedAt || Date.now()));
  const plan = buildPlan(brief, data, "legacy", savedOn);

  let index = 0;
  old.plan.timeline.forEach((stage, i) =>
    stage.tasks.forEach((_, j) => {
      if (old.done && old.done[`t${i}.${j}`]) plan.tasks[index].done = true;
      index++;
    }),
  );
  plan.budget.forEach((line, i) => {
    const spent = old.actual && old.actual[i];
    if (isNumeric(spent)) line.committed = +spent;
  });
  return plan;
}
