/**
 * @file Task and vendor scheduling.
 * Tasks keep "days before the event". If the usual lead times don't fit between plan creation and
 * the event, every offset is scaled down to fit. A task is never due before a task it depends on.
 */
import { addDays, daysBetween, parseIsoDate, today } from "./dates.js";

/**
 * @typedef {object} Schedule
 * @property {Date|null} ev the event date
 * @property {Date} today
 * @property {number|null} daysLeft days from today to the event
 * @property {number} scale factor applied to lead times (1 = not compressed)
 * @property {boolean} compressed true when lead times were scaled down to fit
 * @property {number|null} windowDays days between plan creation and the event
 * @property {Record<string, Date|null>} due due date per task id
 * @property {Record<string, Date|null>} vendorDue book-by date per vendor id
 */

/**
 * Works out every due date for a plan.
 * @param {import("./model.js").Plan} plan
 * @returns {Schedule}
 */
export function schedule(plan) {
  const now = today();
  const eventDate = parseIsoDate(plan.brief.date);
  const result = {
    ev: eventDate,
    today: now,
    daysLeft: eventDate ? daysBetween(now, eventDate) : null,
    scale: 1,
    compressed: false,
    windowDays: null,
    due: {},
    vendorDue: {},
  };
  if (!eventDate) return result;

  const start = parseIsoDate(plan.createdOn) || now;
  const windowDays = daysBetween(start, eventDate);
  result.windowDays = windowDays;

  const flexibleOffsets = [
    ...plan.tasks.filter((t) => !t.fixedOffset && !t.fixedDate).map((t) => t.offset),
    ...plan.vendors.map((v) => v.bookBy),
  ];
  const longestLead = Math.max(0, ...flexibleOffsets);
  if (windowDays <= 0) result.scale = 0;
  else if (longestLead > windowDays) result.scale = windowDays / longestLead;
  result.compressed = result.scale < 1;

  const scaledDate = (offset) => addDays(eventDate, -Math.round((offset || 0) * result.scale));
  for (const task of plan.tasks) {
    result.due[task.id] = taskDueDate(task, eventDate, scaledDate);
  }
  respectDependencies(plan.tasks, result.due, eventDate);
  for (const vendor of plan.vendors) {
    result.vendorDue[vendor.id] = vendor.dueFixed
      ? parseIsoDate(vendor.dueFixed)
      : scaledDate(vendor.bookBy);
  }
  return result;
}

function taskDueDate(task, eventDate, scaledDate) {
  if (task.fixedDate) return parseIsoDate(task.fixedDate);
  if (task.fixedOffset) return addDays(eventDate, -Math.max(0, task.offset));
  return scaledDate(task.offset);
}

/** Moves each task's due date to on or after its prerequisites' (but never after the event). */
function respectDependencies(tasks, due, eventDate) {
  for (let pass = 0; pass < tasks.length; pass++) {
    let changed = false;
    for (const task of tasks) {
      for (const depId of task.deps || []) {
        const depDue = due[depId];
        if (depDue && due[task.id] && depDue > due[task.id]) {
          due[task.id] = new Date(Math.min(+depDue, +eventDate));
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

/**
 * Depth-first search over task dependencies. Any dependency that closes a loop (A needs B, B needs
 * A) is dropped, so the schedule always has a valid order. Mutates `dependsOn` in place.
 * @param {Array<{key: string, dependsOn: string[]}>} tasks
 * @returns {number} how many dependencies were dropped
 */
export function breakCycles(tasks) {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const VISITING = 1;
  const DONE = 2;
  const visitState = new Map();
  let removed = 0;

  const visit = (task) => {
    visitState.set(task.key, VISITING);
    task.dependsOn = task.dependsOn.filter((key) => {
      const seen = visitState.get(key);
      if (seen === VISITING) {
        removed++;
        return false;
      }
      if (!seen) visit(byKey.get(key));
      return true;
    });
    visitState.set(task.key, DONE);
  };

  for (const task of tasks) if (!visitState.get(task.key)) visit(task);
  return removed;
}
