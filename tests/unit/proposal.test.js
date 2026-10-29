// Unit tests for proposals: every requested change keeps money exact and protects what the person
// has committed or completed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, toIsoDate, today } from "../../js/core/dates.js";
import { diffPlans } from "../../js/core/plan-diff.js";
import { corePlan, makeProposal } from "../../js/core/proposal.js";
import { allocated, weddingPlan } from "./helpers.js";

const spec = (changes, extra = {}) => ({
  origin: "ai",
  kind: "chat",
  title: "Test change",
  changes,
  ...extra,
});

test("a new total rescales every category exactly and never below committed spend", () => {
  const plan = weddingPlan();
  plan.budget[0].committed = plan.budget[0].amount; // fully committed line
  const proposal = makeProposal(plan, spec({ brief: { budget: 800_000 } }));
  assert.equal(proposal.blocked, null);
  assert.equal(allocated(proposal.after), 800_000);
  assert.ok(proposal.after.budget[0].amount >= plan.budget[0].committed);
  assert.ok(proposal.warnings.some((w) => /scaled in proportion/.test(w)));
  assert.equal(proposal.after.rev, plan.rev + 1);
  assert.equal(plan.brief.budget, 1_000_000, "the base plan is never modified");
});

test("a budget below committed spend is blocked with an explanation", () => {
  const plan = weddingPlan();
  plan.budget.forEach((line) => {
    line.committed = line.amount;
  });
  const proposal = makeProposal(plan, spec({ brief: { budget: 500_000 } }));
  assert.match(proposal.blocked, /Committed spend is more than the new budget/);
});

test("Claude's small arithmetic slip is absorbed by Contingency and disclosed", () => {
  const plan = weddingPlan();
  const lines = plan.budget.map((line) => ({ category: line.category, amount: line.amount }));
  lines[0].amount += 1234; // now adds up to 1,001,234
  const proposal = makeProposal(plan, spec({ budget: lines }));
  assert.equal(allocated(proposal.after), 1_000_000);
  const contingency = proposal.after.budget.find((l) => /contingen/i.test(l.category));
  const before = plan.budget.find((l) => /contingen/i.test(l.category));
  assert.equal(contingency.amount, before.amount - 1234);
  assert.ok(proposal.warnings.some((w) => /corrected the difference .* in Contingency/.test(w)));
});

test("a dropped category with committed spend is kept, and a past date is blocked", () => {
  const plan = weddingPlan();
  plan.budget[1].committed = 1000;
  const kept = plan.budget.filter((_, i) => i !== 1);
  const lines = kept.map((line) => ({ category: line.category, amount: line.amount }));
  const past = toIsoDate(addDays(today(), -3));
  const proposal = makeProposal(plan, spec({ budget: lines, brief: { date: past } }));
  assert.ok(proposal.after.budget.some((line) => line.id === plan.budget[1].id));
  assert.ok(proposal.warnings.some((w) => /because it has committed spend/.test(w)));
  assert.equal(proposal.blocked, "The new event date is in the past.");
});

test("invalid brief values are ignored with a warning instead of applied", () => {
  const plan = weddingPlan();
  const proposal = makeProposal(
    plan,
    spec({ brief: { budget: -5, guests: 0, date: "2027-02-31", currency: "USD" } }),
  );
  assert.equal(proposal.after.brief.budget, plan.brief.budget);
  assert.equal(proposal.after.brief.guests, plan.brief.guests);
  assert.equal(proposal.after.brief.date, plan.brief.date);
  assert.deepEqual(proposal.warnings.slice(0, 4), [
    "Ignored an invalid budget value.",
    "Ignored an invalid guest count.",
    "Ignored an invalid date.",
    "Currency changed: amounts are relabelled, not converted.",
  ]);
});

test("new tasks: duplicates are skipped and lead times are clamped to the days left", () => {
  const plan = weddingPlan({}, 20);
  const existing = plan.tasks[0].title;
  const proposal = makeProposal(
    plan,
    spec({
      addTasks: [
        { title: existing.toUpperCase(), daysBefore: 5 },
        { title: "Book a shuttle", daysBefore: 90, priority: "urgent" },
      ],
    }),
  );
  const added = proposal.after.tasks.filter((t) => !plan.tasks.some((x) => x.id === t.id));
  assert.equal(added.length, 1);
  assert.equal(added[0].offset, 20);
  assert.equal(added[0].priority, "medium", "unknown priorities fall back to medium");
  assert.equal(added[0].origin, "ai");
  assert.ok(proposal.warnings.some((w) => w.startsWith("Skipped duplicate task")));
  assert.ok(proposal.warnings.some((w) => /aren't dated in the past/.test(w)));
});

test("completed tasks are never removed; links to removed tasks are dropped", () => {
  const plan = weddingPlan();
  const [done, pending, dependent] = plan.tasks;
  done.done = true;
  dependent.deps = [pending.id];
  const proposal = makeProposal(plan, spec({ removeTaskIds: [done.id, pending.id] }));
  const ids = proposal.after.tasks.map((t) => t.id);
  assert.ok(ids.includes(done.id));
  assert.ok(!ids.includes(pending.id));
  assert.deepEqual(proposal.after.tasks.find((t) => t.id === dependent.id).deps, []);
  assert.ok(proposal.warnings.includes("Completed tasks are never removed."));
});

test("a vendor that already exists gets the new checklist items instead of a duplicate", () => {
  const plan = weddingPlan();
  const venue = plan.vendors.find((v) => /venue/i.test(v.category));
  const proposal = makeProposal(
    plan,
    spec({
      addVendors: [
        { category: "venue", checklist: ["Check the generator", venue.checklist[0].text] },
      ],
    }),
  );
  assert.equal(proposal.after.vendors.length, plan.vendors.length);
  const updated = proposal.after.vendors.find((v) => v.id === venue.id);
  assert.equal(updated.checklist.length, venue.checklist.length + 1);
  assert.deepEqual(
    proposal.diff.vendorsChanged.map((v) => v.id),
    [venue.id],
  );
});

test("diffPlans reports a date move and an unchanged plan as empty", () => {
  const plan = weddingPlan();
  const later = toIsoDate(addDays(today(), 214));
  const moved = makeProposal(plan, spec({ brief: { date: later } }));
  assert.equal(moved.diff.timeline.shift, 14);
  assert.ok(moved.diff.brief.some((row) => row.label === "Event date"));
  assert.equal(diffPlans(plan, corePlan(plan)).empty, true);
});

test("corePlan drops history, chat and log but keeps the plan itself", () => {
  const plan = weddingPlan();
  plan.chat.push({ role: "user", text: "hi" });
  const core = corePlan(plan);
  assert.equal(core.chat, undefined);
  assert.equal(core.history, undefined);
  assert.equal(core.log, undefined);
  assert.equal(core.budget.length, plan.budget.length);
});

test("explicit allocations below committed spend, new categories and dropped links", () => {
  const plan = weddingPlan();
  plan.budget[0].committed = 900_000;
  const blocked = makeProposal(
    plan,
    spec({ budget: [{ category: plan.budget[0].category, amount: 100, locked: true }] }),
  );
  assert.match(blocked.blocked, /can't be applied without cutting commitments/);

  const fresh = weddingPlan();
  const venue = fresh.vendors.find((v) => /venue/i.test(v.category));
  const lines = fresh.budget
    .filter((line) => line.id !== venue.lineId)
    .map((line) => ({ category: line.category, amount: line.amount }));
  lines.push({ category: "Fireworks", amount: 5000, note: "Finale" });
  const proposal = makeProposal(fresh, spec({ budget: lines }, { origin: "rule" }));
  assert.equal(allocated(proposal.after), fresh.brief.budget);
  assert.ok(proposal.after.budget.some((l) => l.category === "Fireworks" && l.note === "Finale"));
  const relinked = proposal.after.vendors.find((v) => v.id === venue.id).lineId;
  assert.ok(proposal.after.budget.some((l) => l.id === relinked) || relinked === null);
  assert.ok(
    proposal.diff.budget.some((row) => row.removed) && proposal.diff.budget.some((r) => r.added),
  );
});

test("without a contingency line, Claude's slip is spread across categories and disclosed", () => {
  const plan = weddingPlan();
  plan.budget = plan.budget.filter((line) => !/contingen/i.test(line.category));
  const lines = plan.budget.map((line) => ({ category: line.category, amount: line.amount }));
  const proposal = makeProposal(plan, spec({ budget: lines }));
  assert.equal(allocated(proposal.after), plan.brief.budget);
  assert.ok(proposal.warnings.some((w) => /across categories in proportion/.test(w)));
});

test("venue capacity and new ideas from a proposal", () => {
  const plan = weddingPlan();
  const proposal = makeProposal(
    plan,
    spec({
      brief: { venueCapacity: 450 },
      addIdeas: [
        { title: plan.ideas[0].title, detail: "dup" },
        { title: "Lantern walk", detail: "Evening walk", costLow: 900, costHigh: 100 },
        { detail: "no title" },
      ],
    }),
  );
  assert.equal(proposal.after.brief.venueCapacity, 450);
  const added = proposal.after.ideas.filter((i) => !plan.ideas.some((x) => x.id === i.id));
  assert.deepEqual(
    added.map((i) => [i.title, i.costLow, i.costHigh, i.origin]),
    [["Lantern walk", 100, 900, "ai"]],
  );
  const cleared = makeProposal(plan, spec({ brief: { venueCapacity: null } }));
  assert.equal(cleared.after.brief.venueCapacity, null);
});
