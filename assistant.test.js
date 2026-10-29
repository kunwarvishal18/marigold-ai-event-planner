// Unit tests for the AI actions with a fake Claude: generation, optimizer, ideas, risk review and
// chat. Replies that arrive late or for another plan must change nothing.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  aiRiskReview,
  generate,
  moreIdeas,
  optimize,
  sendChat,
} from "../../js/actions/assistant.js";
import {
  deletePlan,
  newEvent,
  openPlan,
  openSample,
  reviewDetails,
} from "../../js/actions/plans.js";
import { rejectProposal } from "../../js/actions/history.js";
import { state } from "../../js/services/state.js";
import { connectView } from "../../js/services/view.js";
import { allocated, installLocalStorage, weddingPlan } from "./helpers.js";

const events = [];
const record =
  (name) =>
  (...args) =>
    events.push([name, ...args]);
const viewMethods = [
  "render",
  "renderSection",
  "toast",
  "fillForm",
  "setConnection",
  "revealProposal",
  "setFormHint",
  "showInlineError",
  "showGenerationProgress",
  "showGenerationError",
  "clearChatInput",
];
connectView(Object.fromEntries(viewMethods.map((name) => [name, record(name)])));
const eventsNamed = (name) => events.filter(([event]) => event === name);

/** Queues replies for a fake Claude; returns the prompts it receives. */
function fakeClaude(...replies) {
  const prompts = [];
  state.sample = async (input) => {
    prompts.push(input);
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return { text: typeof next === "string" ? next : JSON.stringify(next) };
  };
  state.ai = "on";
  return prompts;
}

const generatedPlan = {
  summary: "A plan.",
  budget: [
    { category: "Venue", pct: 40, note: "" },
    { category: "Food", pct: 40, note: "" },
    { category: "Decor", pct: 10, note: "" },
    { category: "Contingency", pct: 10, note: "" },
  ],
  tasks: Array.from({ length: 6 }, (_, i) => ({
    key: `t${i}`,
    title: `Task ${i}`,
    phase: "Plan",
    daysBefore: 60 - i * 10,
    priority: "high",
    dependsOn: i ? [`t${i - 1}`] : ["t5"],
  })),
  vendors: ["Venue", "Caterer", "Photographer"].map((category) => ({
    category,
    critical: true,
    bookByDaysBefore: 50,
    checklist: ["Quote"],
  })),
  ideas: [1, 2, 3].map((n) => ({ title: `Idea ${n}`, detail: "Detail.", tag: "Fun" })),
};

beforeEach(() => {
  installLocalStorage();
  events.length = 0;
  Object.assign(state, {
    plan: weddingPlan(),
    proposal: null,
    busy: {},
    seq: {},
    ctl: {},
    mode: "edit",
    sample: null,
    ai: "off",
    protect: "",
    ideaFocus: "",
  });
});

test("without Claude, generate creates a labelled template plan", async () => {
  const brief = { ...state.plan.brief, name: "Template party" };
  await generate(brief, false);
  assert.equal(state.plan.source, "template");
  assert.equal(state.plan.brief.name, "Template party");
  assert.ok(eventsNamed("setFormHint").some(([, text]) => /isn't AI generated/.test(text)));
});

test("generate builds an AI plan, repairs a dependency loop on the retry and logs it", async () => {
  const prompts = fakeClaude(generatedPlan, generatedPlan);
  await generate(state.plan.brief, true);
  assert.equal(prompts.length, 2, "the loop was sent back to Claude once");
  assert.equal(state.plan.source, "ai");
  assert.equal(allocated(state.plan), state.plan.brief.budget);
  assert.ok(state.plan.log.some((entry) => /circular task dependency/.test(entry.text)));
  assert.ok(state.plan.log.some((entry) => entry.text === "Generated a fresh AI plan"));
  assert.equal(state.busy.gen, false);
});

test("a failed generation offers a retry; a cancelled one doesn't", async () => {
  fakeClaude(Object.assign(new Error("busy"), { code: "rate_limited" }));
  await generate(state.plan.brief, false);
  assert.deepEqual(eventsNamed("showGenerationError").at(-1).slice(2), [true, false]);
  fakeClaude(Object.assign(new Error("stop"), { code: "cancelled" }));
  await generate(state.plan.brief, false);
  assert.equal(eventsNamed("showGenerationError").at(-1)[2], false);
});

test("the optimizer refuses a cut below committed spend", async () => {
  state.plan.budget.forEach((line) => {
    line.committed = line.amount;
  });
  await optimize(10);
  assert.match(eventsNamed("showInlineError")[0][2], /below what's already committed/);
  assert.equal(state.proposal, null);
});

test("without Claude the optimizer proposes a rule-based proportional cut", async () => {
  await optimize(20);
  assert.equal(state.proposal.origin, "rule");
  assert.equal(state.proposal.after.brief.budget, 800_000);
  assert.equal(allocated(state.proposal.after), 800_000);
});

test("with Claude the optimizer proposes Claude's allocation, made exact", async () => {
  const lines = state.plan.budget.map((line) => ({
    category: line.category,
    amount: Math.round(line.amount * 0.85),
  }));
  fakeClaude({ explanation: "Cut décor.", tradeoffs: ["Fewer flowers"], budget: lines });
  state.protect = "catering";
  await optimize(15);
  assert.equal(state.proposal.origin, "ai");
  assert.equal(allocated(state.proposal.after), 850_000);
  assert.deepEqual(state.proposal.tradeoffs, ["Fewer flowers"]);
});

test("more ideas: only new ones are added; repeats are reported", async () => {
  const existing = state.plan.ideas[0].title;
  fakeClaude([
    { title: existing, detail: "Same.", tag: "x" },
    { title: "Lantern walk", detail: "New.", tag: "Decor" },
  ]);
  await moreIdeas();
  assert.ok(state.plan.ideas.some((idea) => idea.title === "Lantern walk" && idea.origin === "ai"));
  assert.equal(state.plan.ideas.filter((idea) => idea.title === existing).length, 1);

  fakeClaude([{ title: "Lantern walk", detail: "Again.", tag: "Decor" }]);
  await moreIdeas();
  assert.ok(
    eventsNamed("toast").some(([, text]) => /only suggested ideas you already have/.test(text)),
  );
});

test("the AI risk review is stored with the plan revision it reviewed", async () => {
  fakeClaude({ risks: [{ severity: "High", title: "Monsoon", why: "Rain.", action: "Tent." }] });
  await aiRiskReview();
  assert.equal(state.plan.aiRisks.items[0].sev, "high");
  assert.equal(state.plan.aiRisks.rev, state.plan.rev);
});

test("a reply for a plan that is no longer open is discarded", async () => {
  let release;
  state.sample = () =>
    new Promise((resolve) => {
      release = () =>
        resolve({ text: JSON.stringify({ risks: [{ severity: "low", title: "T" }] }) });
    });
  state.ai = "on";
  const pending = aiRiskReview();
  const original = state.plan;
  openPlan(weddingPlan({ name: "Another" }));
  release();
  await pending;
  assert.equal(state.plan.aiRisks, null);
  assert.equal(original.aiRisks, null);
});

test("chat: a proposal from Claude is shown for approval and noted in the conversation", async () => {
  fakeClaude({
    reply: "Moved it.",
    proposal: { title: "More guests", explanation: "", changes: { brief: { guests: 250 } } },
  });
  await sendChat("We now have 250 guests");
  assert.equal(state.plan.brief.guests, 200, "nothing changes before approval");
  assert.equal(state.proposal.title, "More guests");
  assert.deepEqual(
    state.plan.chat.map((m) => m.role),
    ["user", "assistant", "note"],
  );
  rejectProposal();
  assert.equal(state.proposal, null);
  assert.equal(state.plan.brief.guests, 200);
});

test("chat: a no-op proposal is dropped and errors are shown in the conversation", async () => {
  fakeClaude(
    { reply: "Sure.", proposal: { title: "Same", changes: { brief: { guests: 200 } } } },
    Object.assign(new Error("x"), { code: "refused" }),
  );
  await sendChat("Keep guests at 200");
  assert.equal(state.proposal, null);
  assert.match(state.plan.chat.at(-1).text, /wouldn't alter the plan/);
  await sendChat("Do something bad");
  assert.equal(state.plan.chat.at(-1).role, "error");
  assert.match(state.plan.chat.at(-1).text, /declined this request/);
});

test("plan actions: sample, review details, delete and new event", () => {
  openSample();
  assert.equal(state.plan.source, "example");
  assert.ok(state.plan.vendors.some((vendor) => vendor.status === "Booked"));

  reviewDetails({ ...state.plan.brief });
  assert.ok(eventsNamed("setFormHint").some(([, text]) => text === "No changes to review."));
  reviewDetails({ ...state.plan.brief, guests: 260 });
  assert.equal(state.proposal.kind, "details");

  const id = state.plan.id;
  assert.equal(deletePlan(id), true);
  assert.equal(state.plan, null);
  newEvent();
  assert.equal(state.mode, "create");
  assert.equal(openPlan({ v: 99 }), false, "unusable plans are refused");
});
