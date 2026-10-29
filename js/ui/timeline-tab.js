/**
 * @file Timeline tab: tasks grouped by phase in due-date order, filters, and "Add a task".
 */
import { commit, commitQuietly } from "../actions/history.js";
import { PRIORITIES, isOneOf, oneOf } from "../core/constants.js";
import { daysBetween, parseIsoDate } from "../core/dates.js";
import { escapeHtml, formatShortDate } from "../core/format.js";
import { analyze } from "../core/risks.js";
import { clip, uid } from "../core/util.js";
import { requirePlan, state } from "../services/state.js";
import { $, attrIf, field, isChecked, onEach, onSubmit, setHtml, showInlineError } from "./dom.js";

/** @typedef {import("../core/model.js").Plan} Plan */
/** @typedef {import("../core/model.js").Task} Task */
/** @typedef {import("../core/scheduler.js").Schedule} Schedule */
/** @typedef {{task: Task, due: Date|null}} TaskRow */
/** @typedef {(id: string) => string|undefined} TitleOf */
/** @typedef {import("../services/state.js").AppState["filter"]} Filter */

/** @type {Array<[Filter, string]>} */
const FILTERS = [
  ["all", "All"],
  ["pending", "Pending"],
  ["overdue", "Overdue"],
  ["high", "High priority"],
];
const FILTER_KEYS = FILTERS.map(([key]) => key);

/** @type {Readonly<Record<string, string>>} */
const ORIGIN_LABELS = { ai: "AI", you: "Added by you" };

/**
 * @param {Task} task
 * @param {Date|null} due
 * @param {Schedule} sched
 */
const isOverdue = (task, due, sched) => !task.done && !!due && due < sched.today;

/**
 * Which rows a filter keeps.
 * @type {Record<Filter, (row: TaskRow, sched: Schedule) => boolean>}
 */
const FILTER_TESTS = {
  all: () => true,
  pending: ({ task }) => !task.done,
  overdue: ({ task, due }, sched) => isOverdue(task, due, sched),
  high: ({ task }) => task.priority === "high",
};

/**
 * Consecutive rows with the same phase form one group.
 * @param {TaskRow[]} rows
 * @returns {Array<{name: string, rows: TaskRow[]}>}
 */
function groupByPhase(rows) {
  /** @type {Array<{name: string, rows: TaskRow[]}>} */
  const phases = [];
  for (const row of rows) {
    const last = phases[phases.length - 1];
    if (last && last.name === row.task.phase) last.rows.push(row);
    else phases.push({ name: row.task.phase, rows: [row] });
  }
  return phases;
}

/**
 * @param {Schedule} sched
 * @returns {string}
 */
function scheduleNotice(sched) {
  if (!sched.eventDate || sched.daysLeft == null) {
    return '<div class="callout warn">No event date yet, so tasks have no calendar dates. Add one in Event details.</div>';
  }
  if (sched.daysLeft < 0) {
    return '<div class="callout err">The event date has passed. Update it in Event details if the event moved.</div>';
  }
  if (sched.compressed) {
    return `<div class="callout info">Usual lead times don't fit into the ${sched.windowDays} days you had when this plan started, so Marigold compressed every deadline to fit. No task is dated before plan creation, and no task is due before a task it depends on.</div>`;
  }
  return "";
}

/**
 * @param {TaskRow} row
 * @param {Schedule} sched
 * @param {TitleOf} titleOf
 * @returns {string}
 */
function taskRow({ task, due }, sched, titleOf) {
  const after = task.deps.length
    ? `<span>After: ${task.deps.map((id) => escapeHtml(titleOf(id))).join(", ")}</span>`
    : "";
  const origin = Object.hasOwn(ORIGIN_LABELS, task.origin)
    ? `<span>${ORIGIN_LABELS[task.origin]}</span>`
    : "";
  const remove =
    task.origin === "you" && !task.done
      ? `<button type="button" class="linkbtn" data-deltask="${escapeHtml(task.id)}">Remove</button>`
      : "";
  return `<div class="task ${task.done ? "done" : ""}">
    <input type="checkbox" id="tk-${escapeHtml(task.id)}" data-task="${escapeHtml(task.id)}" ${attrIf(task.done, "checked")}>
    <div>
      <label for="tk-${escapeHtml(task.id)}" class="t-title plain-label">${escapeHtml(task.title)}</label>
      <div class="meta"><span class="pri ${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>${after}${origin}${remove}</div>
    </div>
    <div class="due">${dueCell(task, due, sched)}</div>
  </div>`;
}

/**
 * A task's due date (flagged when overdue) and how long before the event it is.
 * @param {Task} task
 * @param {Date|null} due
 * @param {Schedule} sched
 * @returns {string}
 */
function dueCell(task, due, sched) {
  if (!due) return '<span class="note">No date</span>';
  const overdue = isOverdue(task, due, sched);
  const date = `<span class="${overdue ? "overdue" : ""}">${overdue ? "Overdue · " : ""}${formatShortDate(due)}</span>`;
  if (!sched.eventDate) return date;
  const daysBefore = daysBetween(due, sched.eventDate);
  return `${date}<div class="note">${daysBefore === 0 ? "Event day" : `${daysBefore}d before`}</div>`;
}

/**
 * @param {Plan} plan
 * @returns {string}
 */
function addTaskForm(plan) {
  const options = plan.tasks
    .filter((task) => !task.done)
    .map(
      (task) =>
        `<option value="${escapeHtml(task.id)}">${escapeHtml(clip(task.title, 50))}</option>`,
    )
    .join("");
  return `<form class="card" id="addTask"><h2>Add a task</h2>
    <div class="row2">
      <div><label for="nt-title">Task</label><input id="nt-title" maxlength="160" required></div>
      <div><label for="nt-date">Due date</label><input id="nt-date" type="date"></div>
    </div>
    <div class="row2">
      <div><label for="nt-pri">Priority</label><select id="nt-pri"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select></div>
      <div><label for="nt-dep">Must happen after</label><select id="nt-dep"><option value="">Nothing</option>${options}</select></div>
    </div>
    <div class="btnrow"><button class="btn small" type="submit">Add task</button><span class="field-err" id="nt-err" role="alert" hidden></span></div>
  </form>`;
}

/**
 * Renders the Timeline tab.
 * @param {import("../core/risks.js").Analysis} analysis
 */
export function renderTimeline(analysis) {
  const plan = requirePlan();
  const sched = analysis.schedule;
  const keep = FILTER_TESTS[state.filter] || FILTER_TESTS.all;
  const rows = plan.tasks
    .map((task) => ({ task, due: sched.due[task.id] || null }))
    .filter((row) => keep(row, sched))
    .sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0));
  /** @type {TitleOf} */
  const titleOf = (id) => plan.tasks.find((task) => task.id === id)?.title;

  const filterButtons = FILTERS.map(
    ([key, label]) =>
      `<button type="button" data-filter="${escapeHtml(key)}" aria-pressed="${state.filter === key}">${label}</button>`,
  ).join("");
  const phases = rows.length
    ? groupByPhase(rows)
        .map(
          (phase) =>
            `<div class="phase"><h3>${escapeHtml(phase.name)}</h3>${phase.rows.map((row) => taskRow(row, sched, titleOf)).join("")}</div>`,
        )
        .join("")
    : '<p class="hint">No tasks match this filter.</p>';

  const panel = $("#panel-timeline");
  setHtml(
    panel,
    `<div class="toolbar"><h2>Timeline</h2>
      <div class="filters" role="group" aria-label="Filter tasks">${filterButtons}</div>
    </div>
    ${scheduleNotice(sched)}
    ${phases}
    ${addTaskForm(plan)}`,
  );
  bindTimeline(panel, sched, titleOf);
}

/**
 * @param {HTMLElement} panel
 * @param {Schedule} sched
 * @param {TitleOf} titleOf
 */
function bindTimeline(panel, sched, titleOf) {
  onEach(
    "[data-filter]",
    "click",
    (button) => {
      const filter = button.dataset.filter;
      if (!isOneOf(filter, FILTER_KEYS)) return;
      state.filter = filter;
      renderTimeline(analyze(requirePlan()));
    },
    panel,
  );
  onEach(
    "[data-task]",
    "change",
    (checkbox) =>
      commitQuietly("Ticked task", (plan) => {
        const task = plan.tasks.find((item) => item.id === checkbox.dataset.task);
        if (task) task.done = isChecked(checkbox);
      }),
    panel,
  );
  onEach(
    "[data-deltask]",
    "click",
    (button) =>
      commit("Removed a task", (plan) => {
        const removedId = button.dataset.deltask;
        plan.tasks = plan.tasks.filter((task) => task.id !== removedId);
        plan.tasks.forEach((task) => {
          task.deps = task.deps.filter((id) => id !== removedId);
        });
      }),
    panel,
  );
  onSubmit($("#addTask"), () => addTask(sched, titleOf));
}

/**
 * Adds the task described in the "Add a task" form, if it is valid.
 * @param {Schedule} sched
 * @param {TitleOf} titleOf
 */
function addTask(sched, titleOf) {
  const title = clip(field("#nt-title").value, 160);
  const date = field("#nt-date").value;
  const dependsOn = field("#nt-dep").value;
  const dueDate = date ? parseIsoDate(date) : null;
  const dependencyDue = dependsOn ? sched.due[dependsOn] : null;
  if (!title) {
    showInlineError("nt-err", "Name the task.");
    return;
  }
  if (dueDate && sched.eventDate && dueDate > sched.eventDate) {
    showInlineError("nt-err", "Due date can't be after the event.");
    return;
  }
  if (dueDate && dependencyDue && dueDate < dependencyDue) {
    showInlineError(
      "nt-err",
      `That's before “${titleOf(dependsOn) || "the task it depends on"}” is due.`,
    );
    return;
  }
  commit(`Added task “${title}”`, (plan) =>
    plan.tasks.push({
      id: uid(),
      title,
      phase: "Added",
      offset: 0,
      fixedOffset: !date,
      fixedDate: date || "",
      priority: oneOf(field("#nt-pri").value, PRIORITIES, "medium"),
      deps: dependsOn ? [dependsOn] : [],
      done: false,
      origin: "you",
    }),
  );
}
