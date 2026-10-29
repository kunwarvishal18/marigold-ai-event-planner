// Unit tests for the deterministic "Do next" planner (js/core/advisor.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockedTasks, nextActions } from "../../js/core/advisor.js";
import { addDays, today } from "../../js/core/dates.js";

// Minimal plan + schedule fixtures; due dates are given directly so the tests don't depend on scheduling.
function fixture(tasks, vendors = [], eventInDays = 60) {
  const t0 = today(),
    due = {},
    vendorDue = {};
  const p = {
    tasks: tasks.map((t) => ({ deps: [], done: false, priority: "medium", ...t })),
    vendors: vendors.map((v) => ({
      status: "Not started",
      payment: "Unpaid",
      critical: false,
      ...v,
    })),
  };
  for (const t of tasks) if (t.in != null) due[t.id] = addDays(t0, t.in);
  for (const v of vendors) if (v.in != null) vendorDue[v.id] = addDays(t0, v.in);
  return [p, { today: t0, eventDate: addDays(t0, eventInDays), due, vendorDue }];
}

test("blocked tasks are never suggested; their prerequisite is", () => {
  const [p, sc] = fixture([
    { id: "a", title: "Book venue", in: 10 },
    { id: "b", title: "Send invites", in: 2, deps: ["a"], priority: "high" },
  ]);
  const ids = nextActions(p, sc).map((a) => a.id);
  assert.ok(ids.includes("a"));
  assert.ok(!ids.includes("b"));
  assert.deepEqual(
    blockedTasks(p).map((x) => [x.task.id, x.waiting.map((w) => w.id)]),
    [["b", ["a"]]],
  );
});
test("a prerequisite holding up an overdue task jumps the queue and says why", () => {
  const [p, sc] = fixture([
    { id: "a", title: "Approve menu", in: 20 },
    { id: "b", title: "Order food", in: -3, deps: ["a"] },
    { id: "c", title: "Pick music", in: 5 },
  ]);
  const first = nextActions(p, sc)[0];
  assert.equal(first.id, "a");
  assert.ok(first.why.some((w) => /overdue task is waiting/.test(w)));
});
test("overdue beats due soon, and high priority breaks ties", () => {
  const [p, sc] = fixture([
    { id: "soon", title: "Soon", in: 3 },
    { id: "late", title: "Late", in: -1 },
    { id: "hi", title: "Soon high", in: 3, priority: "high" },
  ]);
  assert.deepEqual(
    nextActions(p, sc).map((a) => a.id),
    ["late", "hi", "soon"],
  );
});
test("done tasks are ignored and finishing a prerequisite releases the next task", () => {
  const [p, sc] = fixture([
    { id: "a", title: "A", in: 1, done: true },
    { id: "b", title: "B", in: 2, deps: ["a"] },
  ]);
  assert.deepEqual(
    nextActions(p, sc).map((a) => a.id),
    ["b"],
  );
});
test("tasks more than 30 days out with normal priority are not pushed yet", () => {
  const [p, sc] = fixture([{ id: "far", title: "Far", in: 90 }]);
  assert.equal(nextActions(p, sc).length, 0);
});
test("unbooked critical vendor near its book-by date is suggested; non-critical is not", () => {
  const [p, sc] = fixture(
    [],
    [
      { id: "v1", category: "Caterer", critical: true, in: 5 },
      { id: "v2", category: "Balloons", in: 5 },
    ],
  );
  const a = nextActions(p, sc);
  assert.deepEqual(
    a.map((x) => x.id),
    ["v1"],
  );
  assert.equal(a[0].title, "Book Caterer");
});
test("booked but unpaid vendor is flagged within 30 days of the event", () => {
  const [p, sc] = fixture(
    [],
    [{ id: "v", category: "Venue", status: "Booked", payment: "Unpaid" }],
    20,
  );
  assert.equal(nextActions(p, sc)[0].title, "Settle the Venue deposit");
  const [p2, sc2] = fixture(
    [],
    [{ id: "v", category: "Venue", status: "Booked", payment: "Unpaid" }],
    90,
  );
  assert.equal(nextActions(p2, sc2).length, 0);
});
test("output is deterministic and respects the limit", () => {
  const tasks = Array.from({ length: 12 }, (_, i) => ({
    id: "t" + i,
    title: "Task " + String(i).padStart(2, "0"),
    in: 2,
  }));
  const [p, sc] = fixture(tasks);
  const a = nextActions(p, sc, 4),
    b = nextActions(p, sc, 4);
  assert.equal(a.length, 4);
  assert.deepEqual(a, b);
  assert.deepEqual(
    a.map((x) => x.id),
    ["t0", "t1", "t2", "t3"],
  );
});
