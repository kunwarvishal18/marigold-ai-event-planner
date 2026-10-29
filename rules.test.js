// Unit tests for rule-based risks, validators, prompts and the PDF text cleaner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, toIsoDate, today } from "../../js/core/dates.js";
import { formatMoney, formatShortDate } from "../../js/core/format.js";
import { analyze } from "../../js/core/risks.js";
import {
  validateChat,
  validateGen,
  validateIdeas,
  validateRiskReview,
  validRisks,
} from "../../js/core/validation.js";
import { buildCSV, pdfSafe } from "../../js/services/export.js";
import { ideasPrompt, optimizerPrompt, riskReviewPrompt } from "../../js/services/prompts.js";
import { weddingPlan } from "./helpers.js";

const titles = (plan) => analyze(plan).risks.map((risk) => risk.title);

test("budget risks: over-committed lines, missing contingency and quotes above allocation", () => {
  const plan = weddingPlan();
  plan.budget = plan.budget.filter((line) => !/contingen/i.test(line.category));
  plan.budget[0].committed = plan.budget[0].amount + 10;
  const venue = plan.vendors.find((vendor) => /venue/i.test(vendor.category));
  venue.lineId = plan.budget[1].id;
  venue.quote = plan.budget[1].amount + 1;
  const found = titles(plan);
  assert.ok(found.includes("Budget not fully allocated"));
  assert.ok(found.includes(`${plan.budget[0].category} is over plan`));
  assert.ok(found.includes("No contingency reserve"));
  assert.ok(found.includes(`${venue.category} quote is above its allocation`));
  const health = analyze(plan).health.comps[0];
  assert.ok(health.got < 20 && health.ded.every((d) => d.reason && d.action));
});

test("timeline risks: no date, a passed date and a very short runway", () => {
  assert.ok(titles(weddingPlan({ date: "" })).includes("No event date"));
  const passed = weddingPlan({ date: toIsoDate(addDays(today(), -2)) });
  assert.ok(titles(passed).includes("Event date has passed"));
  assert.equal(analyze(passed).health.comps[1].got, 0);
  const soon = weddingPlan({}, 10);
  assert.ok(titles(soon).includes("Very short runway"));
  assert.ok(titles(soon).some((title) => /overdue task/.test(title)));
});

test("event risks: capacity, outdoor weather and crowd planning", () => {
  assert.ok(titles(weddingPlan({ guests: 320 })).includes("Guest count exceeds venue capacity"));
  assert.ok(titles(weddingPlan({ guests: 280 })).includes("Venue will be near capacity"));
  assert.ok(titles(weddingPlan({ venueCapacity: null })).includes("Venue capacity not recorded"));
  const outdoor = weddingPlan({ style: "Garden lawn party" });
  assert.ok(titles(outdoor).includes("Outdoor elements without a weather backup"));
  const crowd = weddingPlan({ guests: 400, venueCapacity: 500 });
  crowd.tasks = crowd.tasks.filter(
    (t) => !/security|crowd|volunteer|transport|parking/i.test(t.title),
  );
  crowd.vendors = crowd.vendors.filter((v) => !/transport|security/i.test(v.category));
  assert.ok(titles(crowd).includes("No crowd or transport plan"));
});

test("vendor risks: late critical vendors and missing required vendors", () => {
  const plan = weddingPlan({}, 40);
  plan.vendors = plan.vendors.filter((vendor) => !/photo/i.test(vendor.category));
  const found = titles(plan);
  assert.ok(found.includes("No photographer in the vendor list"));
  assert.ok(found.some((title) => / not booked yet$/.test(title)));
});

test("validators reject malformed replies with reasons Claude can act on", () => {
  assert.deepEqual(validateGen([], 10).errors, ["Top level must be a JSON object"]);
  const gen = validateGen(
    { summary: "", budget: [{ pct: 500 }], tasks: [], vendors: [], ideas: [] },
    10,
  );
  assert.ok(gen.errors.includes("root.summary must be a non-empty string"));
  assert.ok(gen.errors.includes("budget[0].pct must be a number from 0 to 100"));
  assert.ok(gen.errors.includes("root.tasks needs at least 6 items (got 0)"));

  const chat = validateChat({
    reply: "ok",
    proposal: {
      changes: {
        brief: { date: "tomorrow", budget: -1, guests: 0 },
        budget: [{ amount: "lots" }],
        addTasks: [{}],
        addVendors: "Florist",
      },
    },
  });
  assert.deepEqual(chat.errors, [
    "changes.brief.date must be YYYY-MM-DD",
    "changes.brief.budget must be a positive number up to 1e12",
    "changes.brief.guests must be a positive integer",
    "changes.budget[0].category missing",
    "changes.budget[0].amount must be a number from 0 to 1e12",
    "changes.addVendors must be an array",
    "addTasks[0].title missing",
  ]);
  assert.equal(validateChat({ reply: "Hello", proposal: null }).value.proposal, null);

  assert.deepEqual(validateIdeas({}).errors, ["Top level must be an array"]);
  assert.deepEqual(validateIdeas([]).errors, ["empty array"]);
  const ideas = validateIdeas([{ title: "A", detail: "B", costLow: 900, costHigh: 100 }]);
  assert.deepEqual([ideas.value[0].costLow, ideas.value[0].costHigh], [100, 900]);

  assert.equal(validateRiskReview({ risks: [] }).ok, false);
  assert.deepEqual(
    validRisks([
      { severity: "constructor", title: "x" },
      { severity: "LOW", title: "Rain" },
    ]).map((risk) => risk.sev),
    ["low"],
    "only real severities are accepted",
  );
});

test("optimizer, ideas and risk prompts fence the person's notes", () => {
  const plan = weddingPlan();
  const optimizer = optimizerPrompt(plan, { pct: 10, target: 900_000, protect: "catering" });
  assert.match(optimizer, /from 1000000 to exactly 900000 INR \(saving 100000\)/);
  assert.match(optimizer, /<user_note>\ncatering\n<\/user_note>/);
  assert.match(
    optimizerPrompt(plan, { pct: 10, target: 900_000, protect: "" }),
    /brief's priorities/,
  );
  assert.match(ideasPrompt(plan, "kids"), /<user_note>\nkids\n<\/user_note>/);
  assert.match(riskReviewPrompt(plan), /HEALTH SCORE: \d+\/100/);
});

test("vendor CSV and PDF text cleaning", () => {
  const plan = weddingPlan();
  const csv = buildCSV(plan, "vendors").split("\r\n");
  assert.match(csv[0], /^Category,Critical,Vendor,Contact,Status,Payment,Estimate \(INR\)/);
  assert.equal(csv.length, plan.vendors.length + 1);
  assert.equal(pdfSafe("₹5 – “café” …"), 'INR 5 - "cafe" ...');
  assert.equal(pdfSafe(null), "");
});

test("money and dates format for display", () => {
  assert.equal(formatMoney(2500000, "INR"), "₹25,00,000");
  assert.equal(formatMoney(1234.6, "USD"), "$1,235");
  assert.match(formatMoney(5, "NOTACODE"), /^NOTACODE 5$/);
  assert.equal(formatShortDate(null), "—");
});
