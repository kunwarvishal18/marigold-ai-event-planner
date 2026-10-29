/**
 * @file Timeline tab: tasks grouped by phase in due-date order, filters, and "Add a task".
 */
import { commit } from "../actions/history.js";
import { daysBetween, parseIsoDate } from "../core/dates.js";
import { escapeHtml, formatShortDate } from "../core/format.js";
import { analyze } from "../core/risks.js";
import { clip, uid } from "../core/util.js";
import { state } from "../services/state.js";
import { $, attrIf, onEach, onSubmit, setHtml, showInlineError } from "./dom.js";

const FILTERS = [
  ["all", "All"],
  ["pending", "Pending"],
  ["overdue", "Overdue"],
  ["high", "High priority"],
];

const isOverdue = (task, due, sched) => !task.done && !!due && due < sched.today;

/** Which rows a filter keeps. */
const FILTER_TESTS = {
  all: () => true,
  pending: ({ task }) => !task.done,
  overdue: ({ task, due }, sched) => isOverdue(task, due, sched),
  high: ({ task }) => task.priority === "high",
};

/** Consecutive rows with the same phase form one group. */
function groupByPhase(rows) {
  const phases = [];
  for (const row of rows) {
    const last = phases[phases.length - 1];
    if (last && last.name === row.task.phase) last.rows.push(row);
    else phases.push({ name: row.task.phase, rows: [row] });
  }
  return phases;
}

function scheduleNotice(sched) {
  if (!sched.ev) {
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

function taskRow({ task, due }, sched, titleOf) {
  const overdue = isOverdue(task, due, sched);
  const after = task.deps.length
    ? `<span>After: ${task.deps.map((id) => escapeHtml(titleOf(id))).join(", ")}</span>`
    : "";
  let origin = "";
  if (task.origin === "ai") origin = "<span>AI</span>";
  else if (task.origin === "you") origin = "<span>Added by you</span>";
  const remove =
    task.origin === "you" && !task.done
      ? `<button type="button" class="linkbtn" data-deltask="${task.id}">Remove</button>`
      : "";
  const dueText = due
    ? `<span class="${overdue ? "overdue" : ""}">${overdue ? "Overdue · " : ""}${formatShortDate(due)}</span>`
    : '<span class="note">No date</span>';
  let lead = "";
  if (due && sched.ev) {
    const daysBefore = daysBetween(due, sched.ev);
    lead = `<div class="note">${daysBefore === 0 ? "Event day" : `${daysBefore}d before`}</div>`;
  }
  return `<div class="task ${task.done ? "done" : ""}">
    <input type="checkbox" id="tk-${task.id}" data-task="${task.id}" ${attrIf(task.done, "checked")}>
    <div>
      <label for="tk-${task.id}" class="t-title plain-label">${escapeHtml(task.title)}</label>
      <div class="meta"><span class="pri ${task.priority}">${task.priority}</span>${after}${origin}${remove}</div>
    </div>
    <div class="due">${dueText}${lead}</div>
  </div>`;
}

function addTaskForm(plan) {
  const options = plan.tasks
    .filter((task) => !task.done)
    .map((task) => `<option value="${task.id}">${escapeHtml(clip(task.title, 50))}</option>`)
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
  const plan = state.plan;
  const sched = analysis.sc;
  const keep = FILTER_TESTS[state.filter] || FILTER_TESTS.all;
  const rows = plan.tasks
    .map((task) => ({ task, due: sched.due[task.id] || null }))
    .filter((row) => keep(row, sched))
    .sort((a, b) => (a.due || 0) - (b.due || 0));
  const titleOf = (id) => plan.tasks.find((task) => task.id === id)?.title;

  const filterButtons = FILTERS.map(
    ([key, label]) =>
      `<button type="button" data-filter="${key}" aria-pressed="${state.filter === key}">${label}</button>`,
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

function bindTimeline(panel, sched, titleOf) {
  onEach(
    "[data-filter]",
    "click",
    (button) => {
      state.filter = button.dataset.filter;
      renderTimeline(analyze(state.plan));
    },
    panel,
  );
  onEach(
    "[data-task]",
    "change",
    (checkbox) =>
      commit(
        "Ticked task",
        (plan) => {
          plan.tasks.find((task) => task.id === checkbox.dataset.task).done = checkbox.checked;
        },
        { structural: false },
      ),
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

function addTask(sched, titleOf) {
  const title = clip($("#nt-title").value, 160);
  const date = $("#nt-date").value;
  const dependsOn = $("#nt-dep").value;
  if (!title) {
    showInlineError("nt-err", "Name the task.");
    return;
  }
  if (date && sched.ev && parseIsoDate(date) > sched.ev) {
    showInlineError("nt-err", "Due date can't be after the event.");
    return;
  }
  if (date && dependsOn && sched.due[dependsOn] && parseIsoDate(date) < sched.due[dependsOn]) {
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
      priority: $("#nt-pri").value,
      deps: dependsOn ? [dependsOn] : [],
      done: false,
      origin: "you",
    }),
  );
}
