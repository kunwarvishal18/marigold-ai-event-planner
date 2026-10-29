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
/** @type {Readonly<Record<import("./constants.js").Priority, number>>} */
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

/** @typedef {import("./model.js").Plan} Plan */
/** @typedef {import("./model.js").Task} Task */
/** @typedef {import("./scheduler.js").Schedule} Schedule */

/**
 * @typedef {object} DependencyPressure
 * @property {Map<string, number>} unblockCount how many pending tasks wait on each task id
 * @property {Set<string>} holdsUpOverdue ids of tasks an overdue task is waiting on
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

/**
 * Highest score first, then earliest due date, then title.
 * @param {NextAction} a
 * @param {NextAction} b
 * @returns {number}
 */
function compareActions(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const dueGap = a.due && b.due ? a.due.getTime() - b.due.getTime() : 0;
  if (dueGap) return dueGap;
  if (a.due && !b.due) return -1;
  if (b.due && !a.due) return 1;
  return a.title.localeCompare(b.title);
}

/** @param {number} days */
const dayWord = (days) => (Math.abs(days) === 1 ? "day" : "days");

/**
 * Points and reason for how soon a task is due.
 * @param {number|null} days until it is due
 * @returns {{points: number, reason: string}|null}
 */
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

/**
 * How many pending tasks wait on each task, and which tasks hold up an overdue one.
 * @param {Task[]} pending
 * @param {(task: Task) => string[]} waitingOn ids of a task's unfinished prerequisites
 * @param {Schedule} sched
 * @returns {DependencyPressure}
 */
function dependencyPressure(pending, waitingOn, sched) {
  /** @type {Map<string, number>} */
  const unblockCount = new Map();
  /** @type {Set<string>} */
  const holdsUpOverdue = new Set();
  for (const task of pending) {
    const due = sched.due[task.id];
    const isOverdue = !!due && due < sched.today;
    for (const depId of waitingOn(task)) {
      unblockCount.set(depId, (unblockCount.get(depId) || 0) + 1);
      if (isOverdue) holdsUpOverdue.add(depId);
    }
  }
  return { unblockCount, holdsUpOverdue };
}

/**
 * Scores one ready task; the reasons explain every point it got.
 * @param {Task} task
 * @param {Schedule} sched
 * @param {DependencyPressure} pressure
 * @returns {NextAction}
 */
function scoreTask(task, sched, pressure) {
  const due = sched.due[task.id] ?? null;
  let score = 0;
  /** @type {string[]} */
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

/**
 * @param {Plan} plan
 * @param {Schedule} sched
 * @returns {NextAction[]}
 */
function taskActions(plan, sched) {
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const pending = plan.tasks.filter((task) => !task.done);
  /** @param {Task} task */
  const waitingOn = (task) =>
    (task.deps || []).filter((id) => {
      const dep = byId.get(id);
      return dep && !dep.done;
    });
  const pressure = dependencyPressure(pending, waitingOn, sched);
  return pending
    .filter((task) => !waitingOn(task).length) // blocked tasks are never suggested directly
    .map((task) => scoreTask(task, sched, pressure))
    .filter((action) => action.score >= MIN_TASK_SCORE);
}

/**
 * @param {Plan} plan
 * @param {Schedule} sched
 * @returns {NextAction[]}
 */
function vendorActions(plan, sched) {
  const daysToEvent = sched.eventDate ? daysBetween(sched.today, sched.eventDate) : null;
  return plan.vendors.flatMap((vendor) => {
    const action = bookingAction(vendor, sched) || depositAction(vendor, daysToEvent);
    return action ? [action] : [];
  });
}

/**
 * "Book X" for a critical vendor within two weeks of (or past) its book-by date.
 * @param {import("./model.js").Vendor} vendor
 * @param {Schedule} sched
 * @returns {NextAction|null}
 */
function bookingAction(vendor, sched) {
  const due = sched.vendorDue[vendor.id] ?? null;
  if (!vendor.critical || isBooked(vendor) || !due) return null;
  const days = daysBetween(sched.today, due);
  if (days > 14) return null;
  const timing =
    days < 0
      ? `book-by date passed ${-days} ${dayWord(days)} ago`
      : `book by ${days === 0 ? "today" : `in ${days} ${dayWord(days)}`}`;
  const stage = VENDOR_STATUSES.includes(vendor.status) ? vendor.status : "Not started";
  return {
    kind: "vendor",
    id: vendor.id,
    title: `Book ${vendor.category}`,
    why: [timing, "critical vendor", `stage: ${stage}`],
    score: (days < 0 ? 70 : 50) + 10,
    due,
    tab: "vendors",
  };
}

/**
 * "Settle the deposit" for a booked, unpaid vendor in the last month before the event.
 * @param {import("./model.js").Vendor} vendor
 * @param {number|null} daysToEvent
 * @returns {NextAction|null}
 */
function depositAction(vendor, daysToEvent) {
  if (!isBooked(vendor) || vendor.payment !== "Unpaid") return null;
  if (daysToEvent == null || daysToEvent < 0 || daysToEvent > 30) return null;
  return {
    kind: "vendor",
    id: vendor.id,
    title: `Settle the ${vendor.category} deposit`,
    why: ["booked but unpaid", `event in ${daysToEvent} ${dayWord(daysToEvent)}`],
    score: 35,
    due: null,
    tab: "vendors",
  };
}

/**
 * Tasks that can't start yet, with the unfinished prerequisites holding each one up.
 * @param {import("./model.js").Plan} plan
 * @returns {Array<{task: Task, waiting: Task[]}>}
 */
export function blockedTasks(plan) {
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  /**
   * @param {Task|undefined} dep
   * @returns {dep is Task}
   */
  const unfinished = (dep) => !!dep && !dep.done;
  return plan.tasks
    .filter((task) => !task.done)
    .map((task) => ({
      task,
      waiting: (task.deps || []).map((id) => byId.get(id)).filter(unfinished),
    }))
    .filter((entry) => entry.waiting.length);
}
