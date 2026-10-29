// Unit tests for persistence: stored data is validated on load and never silently erased.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PLAN_VERSION } from "../../js/core/model.js";
import { sanePlan } from "../../js/core/plan-sanitizer.js";
import { STORAGE_KEYS } from "../../js/services/local-store.js";
import { state } from "../../js/services/state.js";
import {
  allPlans,
  deleteStoredPlan,
  getPlan,
  storedPlanSummary,
  migrateV1,
  savePlan,
  storageState,
} from "../../js/services/storage.js";
import { connectView } from "../../js/services/view.js";
import { installLocalStorage, weddingPlan } from "./helpers.js";

const toasts = [];
const noop = () => {};
connectView({
  render: noop,
  renderSection: noop,
  toast: (message, isError) => toasts.push({ message, isError }),
  fillForm: noop,
  setConnection: noop,
  revealProposal: noop,
  setFormHint: noop,
  showInlineError: noop,
  showGenerationProgress: noop,
  showGenerationError: noop,
  clearChatInput: noop,
});

beforeEach(() => {
  Object.assign(storageState, { corrupt: false, backupKey: null, readOnly: false });
  toasts.length = 0;
  state.plan = null;
});

test("unreadable JSON is copied to a backup key before anything is written", () => {
  const data = installLocalStorage({ [STORAGE_KEYS.plans]: "{not json" });
  assert.equal(Object.keys(allPlans()).length, 0);
  assert.equal(storageState.corrupt, true);
  assert.equal(data.get(storageState.backupKey), "{not json");
  state.plan = weddingPlan();
  savePlan();
  assert.equal(data.get(storageState.backupKey), "{not json", "the backup survives a new save");
  assert.ok(JSON.parse(data.get(STORAGE_KEYS.plans))[state.plan.id]);
});

test("if the backup can't be made, saving pauses instead of overwriting", () => {
  installLocalStorage(
    { [STORAGE_KEYS.plans]: "[]" },
    { failWrites: (key) => key.includes("corrupt") },
  );
  allPlans();
  assert.equal(storageState.readOnly, true);
  state.plan = weddingPlan();
  savePlan();
  assert.ok(toasts.some((t) => t.isError && /Saving is paused/.test(t.message)));
});

test("when storage is full, undo history is trimmed and the save retried", () => {
  let fullOnce = true;
  installLocalStorage(
    {},
    {
      failWrites: (key) => {
        if (key !== STORAGE_KEYS.plans || !fullOnce) return false;
        fullOnce = false;
        return true;
      },
    },
  );
  state.plan = weddingPlan();
  state.plan.history = Array.from({ length: 6 }, (_, i) => ({ title: `h${i}`, snap: {} }));
  savePlan();
  assert.equal(
    JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.plans))[state.plan.id].history.length,
    2,
  );
  assert.equal(toasts.length, 0);
});

test("sanePlan clamps money, drops unknown and circular task links, and rejects bad shapes", () => {
  const plan = weddingPlan();
  const [a, b, c] = plan.tasks;
  a.deps = [b.id, "missing", a.id];
  b.deps = [a.id];
  c.deps = [c.id];
  plan.budget[0].amount = 5e12;
  plan.budget[1].committed = -20;
  const clean = sanePlan(JSON.parse(JSON.stringify(plan)));
  assert.equal(clean.budget[0].amount, 0, "out-of-range amounts become 0");
  assert.equal(clean.budget[1].committed, null);
  const deps = Object.fromEntries(clean.tasks.map((t) => [t.id, t.deps]));
  assert.deepEqual(deps[a.id], [b.id]);
  assert.deepEqual(deps[b.id], [], "the loop back to A is removed");
  assert.deepEqual(deps[c.id], []);

  assert.equal(sanePlan(null), null);
  assert.equal(sanePlan({ ...plan, v: PLAN_VERSION + 1 }), null);
  assert.equal(sanePlan({ ...plan, id: "../etc" }), null);
  assert.equal(sanePlan({ ...plan, brief: { ...plan.brief, budget: 0 } }), null);
});

test("newer-version and invalid entries are counted, kept, and '__proto__' ids are harmless", () => {
  const good = weddingPlan();
  const raw = `{"${good.id}":${JSON.stringify(good)},"future":{"v":${PLAN_VERSION + 1}},"bad":{"v":2},"__proto__":{"polluted":true}}`;
  installLocalStorage({ [STORAGE_KEYS.plans]: raw });
  const before = storedPlanSummary();
  assert.deepEqual([before.plans.length, before.newer, before.invalid], [1, 1, 2]);
  assert.equal(storedPlanSummary(), before, "unchanged storage reuses the cached summary");
  assert.equal(getPlan("__proto__")?.polluted, true, "returned as plain data only");
  assert.equal({}.polluted, undefined, "Object.prototype is untouched");
  assert.equal(getPlan("not a valid id!"), null);
  assert.ok(deleteStoredPlan("bad"));
  const after = storedPlanSummary();
  assert.notEqual(after, before, "a change in storage invalidates the cache");
  assert.deepEqual([after.newer, after.invalid], [1, 1]);
});

test("version 1 plans are migrated once, keeping ticked tasks and recorded spend", () => {
  const legacy = {
    one: {
      brief: {
        type: "Birthday",
        name: "Old party",
        date: "",
        guests: 20,
        budget: 10000,
        currency: "INR",
      },
      plan: {
        summary: "old",
        budget: [
          { category: "Food", pct: 60 },
          { category: "Contingency", pct: 40 },
        ],
        timeline: [{ title: "Plan", weeksBefore: 2, tasks: ["Book hall", "Order cake"] }],
        vendors: [{ category: "Bakery", checklist: ["Taste"], questions: [] }],
        ideas: [],
      },
      done: { "t0.1": true },
      actual: [2500],
    },
    example: { example: true, brief: {}, plan: {} },
  };
  installLocalStorage({ [STORAGE_KEYS.legacyPlans]: JSON.stringify(legacy) });
  migrateV1();
  const plans = Object.values(allPlans());
  assert.equal(plans.length, 1);
  const [plan] = plans;
  assert.equal(plan.source, "legacy");
  assert.deepEqual(
    plan.tasks.map((t) => t.done),
    [false, true],
  );
  assert.equal(plan.budget[0].committed, 2500);
  migrateV1();
  assert.equal(Object.values(allPlans()).length, 1, "running again doesn't duplicate");
});

test("when saving fails even after trimming, the person is told their changes aren't stored", () => {
  installLocalStorage({}, { failWrites: (key) => key === STORAGE_KEYS.plans });
  state.plan = weddingPlan();
  savePlan();
  assert.ok(toasts.some((t) => t.isError && /Couldn't save on this device/.test(t.message)));
  assert.equal(deleteStoredPlan(state.plan.id), false, "deleting also reports the failure");
});

test("a version 1 plan that can't be converted is left alone", () => {
  installLocalStorage({
    [STORAGE_KEYS.legacyPlans]: JSON.stringify({ broken: { brief: {}, plan: { budget: "nope" } } }),
  });
  migrateV1();
  assert.equal(Object.keys(allPlans()).length, 0);
});
