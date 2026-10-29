// Unit tests for error paths and browser-facing services, using small fakes: a recording jsPDF,
// a failing localStorage, a fake script loader and a stalled Claude.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  aiRiskReview,
  generate,
  moreIdeas,
  optimize,
  sendChat,
} from "../../js/actions/assistant.js";
import { proposeChange, showProposal, undo, commit } from "../../js/actions/history.js";
import { formatMoneyPlain } from "../../js/core/format.js";
import { JSPDF_SRI, JSPDF_URL } from "../../js/core/safety.js";
import { buildPDF, loadJsPDF } from "../../js/services/export.js";
import { localStore } from "../../js/services/local-store.js";
import { generationPrompt, planContext } from "../../js/services/prompts.js";
import { state } from "../../js/services/state.js";
import { connectView } from "../../js/services/view.js";
import { installLocalStorage, weddingPlan } from "./helpers.js";

const events = [];
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
connectView(
  Object.fromEntries(viewMethods.map((name) => [name, (...args) => events.push([name, ...args])])),
);
const lastEvent = (name) => events.filter(([event]) => event === name).at(-1);

beforeEach(() => {
  installLocalStorage();
  events.length = 0;
  Object.assign(state, {
    plan: weddingPlan(),
    proposal: null,
    busy: {},
    seq: {},
    ctl: {},
    sample: null,
    ai: "off",
  });
  delete globalThis.window;
  delete globalThis.document;
});

/** A jsPDF stand-in that records every call. */
class FakePdf {
  static last;
  constructor(options) {
    this.options = options;
    this.lines = [];
    this.pages = 1;
    FakePdf.last = this;
  }
  setFont() {}
  setFontSize() {}
  splitTextToSize(text) {
    return String(text).split("\n");
  }
  text(content) {
    this.lines.push(content);
  }
  addPage() {
    this.pages++;
  }
  output(type) {
    return { type, lines: this.lines };
  }
}

test("the PDF has every section, uses Latin-1-safe text and breaks onto new pages", async () => {
  globalThis.window = { jspdf: { jsPDF: FakePdf } };
  const plan = state.plan;
  plan.brief.name = "Aanya’s wedding – ₹ budget";
  plan.vendors[0].quote = 1000;
  plan.vendors[0].name = "Hall";
  const blob = await buildPDF(plan);
  const text = FakePdf.last.lines.join("\n");
  assert.equal(blob.type, "blob");
  assert.deepEqual(FakePdf.last.options, { unit: "pt", format: "a4" });
  for (const heading of [
    "Health score:",
    "Risks",
    "Budget",
    "Timeline",
    "Vendors",
    "Ideas",
    "Run of show",
  ]) {
    assert.ok(text.includes(heading), heading);
  }
  assert.ok(text.includes("Aanya's wedding - INR  budget"), "typographic characters are replaced");
  assert.ok(text.includes("Total"));
  assert.ok(FakePdf.last.pages > 1, "a long plan spills onto more pages");
  const latin1 = (char) => {
    const code = char.codePointAt(0);
    return (
      [9, 10, 13].includes(code) ||
      (code >= 32 && code <= 126) ||
      (code >= 160 && code <= 255) ||
      char === "€"
    );
  };
  assert.ok(
    FakePdf.last.lines.every((line) => [...String(line)].every(latin1)),
    "only drawable characters",
  );
});

test("jsPDF is loaded once from the pinned URL with its integrity hash", async () => {
  const appended = [];
  globalThis.window = {};
  globalThis.document = {
    createElement: () => ({}),
    head: { append: (script) => appended.push(script) },
  };
  const first = loadJsPDF();
  const second = loadJsPDF();
  assert.equal(appended.length, 1, "concurrent exports share one request");
  const [script] = appended;
  assert.deepEqual(
    [script.src, script.integrity, script.crossOrigin, script.referrerPolicy],
    [JSPDF_URL, JSPDF_SRI, "anonymous", "no-referrer"],
  );
  script.onerror();
  await assert.rejects(first, /load failed/);
  await assert.rejects(second, /load failed/);

  const retry = loadJsPDF();
  assert.equal(appended.length, 2, "a failed load can be retried");
  globalThis.window.jspdf = { jsPDF: FakePdf };
  appended[1].onload();
  assert.equal((await retry).jsPDF, FakePdf);
});

test("prompts describe briefs with and without optional details", () => {
  const brief = {
    ...state.plan.brief,
    date: "",
    time: "",
    venueCapacity: null,
    city: "",
    notes: "",
  };
  const text = generationPrompt(brief);
  assert.match(text, /Date: not set$/m);
  assert.match(text, /No date is set: use typical lead times\./);
  assert.match(text, /Location: not given/);
  assert.match(text, /Priorities and must-haves: none/);
  assert.doesNotMatch(text, /Start time|Venue capacity/);
  state.plan.tasks.forEach((task) => {
    task.done = true;
  });
  state.plan.ideas = [];
  const context = planContext(state.plan);
  assert.match(context, /Pending \(id \| title \| due \| priority\):\n- none/);
  assert.match(context, /IDEAS ALREADY IN PLAN: none/);
});

test("plain money formatting for PDFs", () => {
  assert.equal(formatMoneyPlain(2500000, "INR"), "INR 25,00,000");
  assert.equal(formatMoneyPlain(1234.5, "USD"), "USD 1,235");
});

test("storage that throws is reported as unavailable, never as an exception", () => {
  globalThis.localStorage = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(localStore.get("k", "fallback"), "fallback");
  assert.equal(localStore.set("k", 1), false);
  assert.equal(localStore.raw("k"), null);
  assert.equal(localStore.setRaw("k", "v"), false);
});

test("a proposal that changes nothing is not shown for approval", () => {
  showProposal(proposeChange({ origin: "rule", kind: "x", title: "Same", changes: {} }));
  assert.equal(state.proposal, null);
  assert.match(lastEvent("toast")[1], /nothing to approve/);
  showProposal(null);
  assert.equal(state.proposal, null);
});

test("undo keeps vendor details and checklist ticks entered after the change", () => {
  commit("Added a task", (plan) => {
    plan.tasks.push({ ...plan.tasks[0], id: "extra1", title: "Extra" });
  });
  const vendor = state.plan.vendors[0];
  vendor.name = "Chosen hall";
  vendor.status = "Booked";
  vendor.checklist[0].done = true;
  undo();
  const restored = state.plan.vendors.find((v) => v.id === vendor.id);
  assert.ok(!state.plan.tasks.some((t) => t.id === "extra1"));
  assert.deepEqual(
    [restored.name, restored.status, restored.checklist[0].done],
    ["Chosen hall", "Booked", true],
  );
});

/** A Claude that answers only when released, to test replies that arrive late. */
function stalledClaude(reply) {
  let release;
  state.ai = "on";
  state.sample = () =>
    new Promise((resolve, reject) => {
      release = () =>
        reply instanceof Error ? reject(reply) : resolve({ text: JSON.stringify(reply) });
    });
  return () => release();
}

test("a late optimizer reply for a plan that was closed is ignored", async () => {
  const release = stalledClaude({
    explanation: "x",
    tradeoffs: [],
    budget: [
      { category: "Venue", amount: 600000 },
      { category: "Contingency", amount: 300000 },
    ],
  });
  const pending = optimize(10);
  assert.equal(state.busy.opt, true);
  state.plan = weddingPlan({ name: "Other" });
  release();
  await pending;
  assert.equal(state.proposal, null);
  assert.equal(state.busy.opt, false);
});

test("Claude errors in ideas, risk review and generation are reported, not thrown", async () => {
  const failing = (code) => {
    state.ai = "on";
    state.sample = async () => {
      throw Object.assign(new Error(code), { code });
    };
  };
  failing("rate_limited");
  await moreIdeas();
  assert.equal(lastEvent("showInlineError")[1], "ideaErr");
  failing("session_expired");
  await aiRiskReview();
  assert.match(lastEvent("toast")[1], /session expired/);
  assert.equal(lastEvent("toast")[2], true);
  failing("sampling_disabled");
  await optimize(10);
  assert.match(lastEvent("toast")[1], /turned off/);
});

test("duplicate submissions while a request is running are ignored", async () => {
  const release = stalledClaude({ reply: "ok", proposal: null });
  const first = sendChat("Hello");
  await sendChat("Hello again");
  assert.equal(state.plan.chat.filter((m) => m.role === "user").length, 1);
  release();
  await first;
  state.busy.gen = true;
  await generate(state.plan.brief, false);
  assert.equal(lastEvent("showGenerationProgress"), undefined, "a busy generator does nothing");
});

test("without Claude, chat explains it is needed and ideas and risk review do nothing", async () => {
  await sendChat("Hello");
  assert.match(lastEvent("toast")[1], /needs Claude/);
  await moreIdeas();
  await aiRiskReview();
  assert.equal(state.plan.chat.length, 0);
  await sendChat("   ");
  assert.equal(events.filter(([e]) => e === "toast").length, 1, "blank messages are ignored");
});
