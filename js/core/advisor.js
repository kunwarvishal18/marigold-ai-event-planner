/**
 * @file "Do next" suggestions: deterministic ranking of what to do next, no AI.
 *
 * - Only tasks whose prerequisites are all done are "ready"; blocked tasks are never suggested,
 *   but an overdue blocked task raises the priority of the prerequisite holding it up.
 * - Urgency comes from the due date, importance from priority and from how many tasks each one
 *   unblocks.
 * - Critical vendors that aren't booked near their book-by date, and booked vendors still unpaid
 *   close to the event, are suggested too.
 *
 * Every item carries a plain-language reason so the user can see why it was picked.
 */
import { VENDOR_STATUSES, isBooked } from "./constants.js";
import { daysBetween } from "./dates.js";

/** Items scoring below this aren't worth suggesting. */
const MIN_TASK_SCORE = 20;

const URGENCY_POINTS = { overdue: 60, thisWeek: 40, thisMonth: 20 };
const PRIORITY_POINTS = { high: 15, medium: 5, low: 0 };
const POINTS_PER_UNBLOCKED_TASK = 3;
const MAX_UNBLOCKED_COUNTED = 5;
const HOLDS_UP_OVERDUE_POINTS = 25;

/**
 * @typedef {object} NextAction
 * @property {"task"|"vendor"} kind
 * @property {string} id
 * @property {string} title
 * @property {string[]} why plain-language reasons
 * @property {number} score
 * @property {Date|null} due
 * @property {string} tab the plan tab where the action is done
 */

/**
 * Ranks the most useful next actions for a plan.
 * @param {import("./model.js").Plan} plan
 * @param {import("./scheduler.js").Schedule} sched
 * @param {number} [limit]
 * @returns {NextAction[]}
 */
export function nextActions(plan, sched, limit = 5) {
  const actions = [...taskActions(plan, sched), ...vendorActions(plan, sched)];
  actions.sort(compareActions);
  return actions.slice(0, limit);
}

/** Highest score first, then earliest due date, then title. */
function compareActions(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.due && b.due && a.due - b.due) return a.due - b.due;
  if (a.due && !b.due) return -1;
  if (b.due && !a.due) return 1;
  return a.title.localeCompare(b.title);
}

const dayWord = (days) => (Math.abs(days) === 1 ? "day" : "days");

/** Points and reason for how soon a task is due. */
function urgency(days) {
  if (days == null || days > 30) return null;
  if (days < 0) {
    return { points: URGENCY_POINTS.overdue, reason: `overdue by ${-days} ${dayWord(days)}` };
  }
  if (days <= 7) {
    const reason = days === 0 ? "due today" : `due in ${days} ${dayWord(days)}`;
    return { points: URGENCY_POINTS.thisWeek, reason };
  }
  return { points: URGENCY_POINTS.thisMonth, reason: `due in ${days} days` };
}

/** How many pending tasks wait on each task, and which tasks hold up an overdue one. */
function dependencyPressure(pending, waitingOn, sched) {
  const unblockCount = new Map();
  const holdsUpOverdue = new Set();
  for (const task of pending) {
    const isOverdue = sched.due[task.id] && sched.due[task.id] < sched.today;
    for (const depId of waitingOn(task)) {
      unblockCount.set(depId, (unblockCount.get(depId) || 0) + 1);
      if (isOverdue) holdsUpOverdue.add(depId);
    }
  }
  return { unblockCount, holdsUpOverdue };
}

/** Scores one ready task; the reasons explain every point it got. */
function scoreTask(task, sched, pressure) {
  const due = sched.due[task.id];
  let score = 0;
  const why = [];
  const soon = urgency(due ? daysBetween(sched.today, due) : null);
  if (soon) {
    score += soon.points;
    why.push(soon.reason);
  }
  score += Object.hasOwn(PRIORITY_POINTS, task.priority) ? PRIORITY_POINTS[task.priority] : 0;
  if (task.priority === "high") why.push("high priority");

  const unblocks = pressure.unblockCount.get(task.id) || 0;
  if (unblocks) {
    score += Math.min(unblocks, MAX_UNBLOCKED_COUNTED) * POINTS_PER_UNBLOCKED_TASK;
    why.push(`unblocks ${unblocks} other task${unblocks > 1 ? "s" : ""}`);
  }
  if (pressure.holdsUpOverdue.has(task.id)) {
    score += HOLDS_UP_OVERDUE_POINTS;
    why.push("an overdue task is waiting on it");
  }
  return { kind: "task", id: task.id, title: task.title, why, score, due, tab: "timeline" };
}

function taskActions(plan, sched) {
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const pending = plan.tasks.filter((task) => !task.done);
  const waitingOn = (task) => (task.deps || []).filter((id) => byId.has(id) && !byId.get(id).done);
  const pressure = dependencyPressure(pending, waitingOn, sched);
  return pending
    .filter((task) => !waitingOn(task).length) // blocked tasks are never suggested directly
    .map((task) => scoreTask(task, sched, pressure))
    .filter((action) => action.score >= MIN_TASK_SCORE);
}

function vendorActions(plan, sched) {
  const daysToEvent = sched.ev ? daysBetween(sched.today, sched.ev) : null;
  const actions = [];
  for (const vendor of plan.vendors) {
    const due = sched.vendorDue[vendor.id];
    const days = due ? daysBetween(sched.today, due) : null;

    if (vendor.critical && !isBooked(vendor) && days != null && days <= 14) {
      const timing =
        days < 0
          ? `book-by date passed ${-days} ${dayWord(days)} ago`
          : `book by ${days === 0 ? "today" : `in ${days} ${dayWord(days)}`}`;
      const stage = VENDOR_STATUSES.includes(vendor.status) ? vendor.status : "Not started";
      actions.push({
        kind: "vendor",
        id: vendor.id,
        title: `Book ${vendor.category}`,
        why: [timing, "critical vendor", `stage: ${stage}`],
        score: (days < 0 ? 70 : 50) + 10,
        due,
        tab: "vendors",
      });
    } else if (
      isBooked(vendor) &&
      vendor.payment === "Unpaid" &&
      daysToEvent != null &&
      daysToEvent >= 0 &&
      daysToEvent <= 30
    ) {
      actions.push({
        kind: "vendor",
        id: vendor.id,
        title: `Settle the ${vendor.category} deposit`,
        why: ["booked but unpaid", `event in ${daysToEvent} ${dayWord(daysToEvent)}`],
        score: 35,
        due: null,
        tab: "vendors",
      });
    }
  }
  return actions;
}

/**
 * Tasks that can't start yet, with the unfinished prerequisites holding each one up.
 * @param {import("./model.js").Plan} plan
 * @returns {Array<{task: object, waiting: object[]}>}
 */
export function blockedTasks(plan) {
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  return plan.tasks
    .filter((task) => !task.done)
    .map((task) => ({
      task,
      waiting: (task.deps || []).map((id) => byId.get(id)).filter((dep) => dep && !dep.done),
    }))
    .filter((entry) => entry.waiting.length);
}
