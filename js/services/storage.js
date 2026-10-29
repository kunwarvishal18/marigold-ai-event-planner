/**
 * @file Plan persistence. Plans live in localStorage under one key. Reads never throw and never
 * erase data:
 * - unreadable JSON is copied to a backup key before anything new is written;
 * - if that backup can't be made, saving is switched off for the session (read-only);
 * - plans written by a newer Marigold version, or that fail validation, are kept as-is but hidden.
 */
import { toIsoDate } from "../core/dates.js";
import { PLAN_VERSION, buildPlan } from "../core/model.js";
import { ID_PATTERN } from "../core/constants.js";
import { sanePlan } from "../core/plan-sanitizer.js";
import { hasOwn, isNumeric, isPlainObject } from "../core/util.js";
import { STORAGE_KEYS, localStore } from "./local-store.js";
import { state } from "./state.js";
import { view } from "./view.js";

/** Older undo snapshots are dropped when storage is full. */
const HISTORY_KEPT_WHEN_FULL = 2;

/** @typedef {import("../core/model.js").Plan} Plan */

/**
 * What the UI should tell the person about stored data.
 * @type {{corrupt: boolean, backupKey: string|null, readOnly: boolean}}
 */
export const storageState = { corrupt: false, backupKey: null, readOnly: false };

/**
 * Copies unreadable data to a backup key; if that fails, stops all writes.
 * @param {string} raw
 */
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
  /** @type {Record<string, unknown>} */
  const plans = Object.create(null);
  if (storageState.readOnly) return plans;
  const raw = localStore.raw(STORAGE_KEYS.plans);
  if (raw == null || raw === "") return plans;

  const parsed = parseStored(raw);
  if (!isPlainObject(parsed)) {
    quarantine(raw);
    return plans;
  }
  for (const id of Object.keys(parsed)) plans[id] = parsed[id];
  return plans;
}

/**
 * The last parse, reused while the stored text is unchanged. Callers never mutate its plans.
 * @type {{raw: string|undefined, parsed: unknown}}
 */
let parseCache = { raw: undefined, parsed: undefined };

/**
 * @param {string} raw
 * @returns {unknown} the parsed value, or undefined when the text isn't JSON
 */
function parseStored(raw) {
  if (raw !== parseCache.raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    parseCache = { raw, parsed };
  }
  return parseCache.parsed;
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
 * @param {Record<string, unknown>} plans
 * @returns {boolean} false when saving is paused or storage refused the write
 */
function writeAll(plans) {
  if (storageState.readOnly) return false;
  return localStore.set(STORAGE_KEYS.plans, plans);
}

/**
 * Deletes one stored plan.
 * @param {string} id
 * @returns {boolean} false if the change couldn't be saved
 */
export function deleteStoredPlan(id) {
  const plans = allPlans();
  delete plans[id];
  return writeAll(plans);
}

/** Saves the open plan, trimming undo history if storage is full. Reports problems as toasts. */
export function savePlan() {
  const open = state.plan;
  if (!open) return;
  open.updatedAt = Date.now();
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
  plans[open.id] = open;
  let saved = writeAll(plans);
  if (!saved) {
    // Storage is full: keep only the newest undo snapshots of every plan (copies, so the cached
    // parse of the stored text is never modified) and try once more.
    for (const [id, plan] of Object.entries(plans)) {
      if (isPlainObject(plan) && Array.isArray(plan.history)) {
        plans[id] = { ...plan, history: plan.history.slice(0, HISTORY_KEPT_WHEN_FULL) };
      }
    }
    open.history = open.history.slice(0, HISTORY_KEPT_WHEN_FULL);
    saved = writeAll(plans);
  }
  if (!saved) {
    view.toast(
      "Couldn't save on this device. Browser storage may be full or blocked; your changes last " +
        "until you close the page.",
      true,
    );
  }
  localStore.set(STORAGE_KEYS.lastPlanId, open.id);
  view.renderSection("saved");
}

/** @typedef {{plans: Plan[], newer: number, invalid: number}} StoredPlanSummary */

/**
 * The last summary, reused while the stored text is unchanged.
 * @type {{raw: string|null|undefined, summary: StoredPlanSummary|null}}
 */
let summaryCache = { raw: undefined, summary: null };

/**
 * The plans that can be listed, plus counts of stored entries that are kept but not shown.
 * Parsing and validating every stored plan is the costliest part of a render, so the result is
 * cached against the raw stored text and recomputed only when storage actually changes.
 * @returns {StoredPlanSummary}
 */
export function storedPlanSummary() {
  const raw = storageState.readOnly ? null : localStore.raw(STORAGE_KEYS.plans);
  if (raw === summaryCache.raw && summaryCache.summary) return summaryCache.summary;
  /** @type {StoredPlanSummary} */
  const summary = { plans: [], newer: 0, invalid: 0 };
  for (const plan of Object.values(allPlans())) {
    const clean = sanePlan(plan);
    if (clean) summary.plans.push(clean);
    else if (isPlainObject(plan) && isNumeric(plan.v) && Number(plan.v) > PLAN_VERSION) {
      summary.newer++;
    } else summary.invalid++;
  }
  summary.plans.sort((a, b) => b.updatedAt - a.updatedAt);
  summaryCache = { raw, summary };
  return summary;
}

/**
 * One-time import of plans saved by Marigold v1 (a different shape, stored under another key).
 * Example plans are skipped; anything that fails to convert is left alone.
 */
export function migrateV1() {
  const legacy = localStore.get(STORAGE_KEYS.legacyPlans, null);
  if (!isPlainObject(legacy) || localStore.get(STORAGE_KEYS.migrated, false)) return;
  const plans = allPlans();
  for (const old of Object.values(legacy)) {
    try {
      if (!isPlainObject(old) || !old.plan || !old.brief || old.example) continue;
      // Unchecked v1 data: anything missing makes the conversion throw, and the plan is skipped.
      // What is converted is validated by sanePlan() whenever it is read.
      const plan = convertV1Plan(/** @type {LegacyPlan} */ (old));
      plans[plan.id] = plan;
    } catch {
      // Leave plans that can't be converted where they are.
    }
  }
  if (writeAll(plans)) localStore.set(STORAGE_KEYS.migrated, true);
}

/**
 * The shape Marigold v1 stored (not validated; see migrateV1).
 * @typedef {object} LegacyPlan
 * @property {import("../core/model.js").Brief} brief
 * @property {number} [savedAt]
 * @property {Record<string, boolean>} [done] ticked tasks by "t<stage>.<task>"
 * @property {unknown[]} [actual] spend per budget line
 * @property {object} plan
 * @property {string} plan.summary
 * @property {Array<{category: string, pct: unknown, note: string}>} plan.budget
 * @property {Array<{category: string, checklist: string[], questions: string[]}>} plan.vendors
 * @property {import("../core/validation.js").IdeaSpec[]} [plan.ideas]
 * @property {Array<{title: string, weeksBefore: unknown, tasks: string[]}>} plan.timeline
 */

/**
 * @param {LegacyPlan} old
 * @returns {Plan}
 */
function convertV1Plan(old) {
  /** @type {import("../core/validation.js").GeneratedPlan} */
  const data = {
    summary: old.plan.summary,
    budget: old.plan.budget.map((line) => ({
      category: line.category,
      pct: Number(line.pct) || 0,
      note: line.note,
    })),
    tasks: [],
    vendors: old.plan.vendors.map((vendor) => ({
      category: vendor.category,
      critical: false,
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
        daysBefore: (Number(stage.weeksBefore) || 0) * 7,
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
    if (isNumeric(spent)) line.committed = Number(spent);
  });
  return plan;
}
