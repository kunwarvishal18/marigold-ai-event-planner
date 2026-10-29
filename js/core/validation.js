/**
 * @file Validators for Claude's JSON replies. Each returns {ok: true, value} with cleaned data, or
 * {ok: false, errors} with messages that are sent back to Claude so it can correct its answer.
 */
import { CONTINGENCY_PATTERN, PRIORITIES, SEVERITY_RANK } from "./constants.js";
import { parseIsoDate } from "./dates.js";
import { breakCycles } from "./scheduler.js";
import { MAX_AMOUNT, clip, isNumeric, isPlainObject, sum } from "./util.js";

/**
 * @typedef {{ok: true, value: T} | {ok: false, errors: string[]}} Validation
 * @template T
 */

/**
 * @typedef {object} GeneratedPlan Claude's (or a template's) plan content, cleaned.
 * @property {string} summary
 * @property {Array<{category: string, pct: number, note: string}>} budget
 * @property {Array<{key: string, title: string, phase: string, daysBefore: number, priority: string, dependsOn: string[]}>} tasks
 * @property {Array<object>} vendors
 * @property {Array<object>} ideas
 * @property {Array<{time: string, item: string, owner: string}>} [runOfShow]
 * @property {Array<object>} [risks]
 * @property {number} [unknownDepsRemoved]
 * @property {number} [cyclesRemoved]
 */

const NOT_AN_OBJECT = { ok: false, errors: ["Top level must be a JSON object"] };
const result = (errors, value) => (errors.length ? { ok: false, errors } : { ok: true, value });
const isAmount = (value) => isNumeric(value) && +value >= 0 && +value <= MAX_AMOUNT;
const cleanList = (list, maxLength, maxItems) =>
  (Array.isArray(list) ? list : [])
    .map((text) => clip(text, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);

/**
 * Reads a string field, recording an error when a required one is empty.
 * @returns {string}
 */
export function readString(object, key, maxLength, errors, path, required = true) {
  const text = clip(object?.[key], maxLength);
  if (required && !text) errors.push(`${path}.${key} must be a non-empty string`);
  return text;
}

/**
 * Reads an array field, recording an error when it's missing or too short.
 * @returns {Array} at most `max` items
 */
export function readArray(object, key, errors, path, min, max) {
  const list = object?.[key];
  if (!Array.isArray(list)) {
    errors.push(`${path}.${key} must be an array`);
    return [];
  }
  if (list.length < min) {
    errors.push(`${path}.${key} needs at least ${min} items (got ${list.length})`);
  }
  return list.slice(0, max);
}

/**
 * Validates a full generated plan. Dependencies that point at unknown tasks, or that form a loop,
 * are sent back to Claude for a corrected answer. Only on the final attempt are they repaired in
 * code (dropped), and the repair is reported in unknownDepsRemoved / cyclesRemoved.
 * @param {unknown} reply
 * @param {number|null} daysLeft days until the event; lead times are capped to it
 * @param {{final?: boolean}} [context]
 * @returns {Validation<GeneratedPlan>}
 */
export function validateGen(reply, daysLeft, { final = true } = {}) {
  if (!isPlainObject(reply)) return NOT_AN_OBJECT;
  const errors = [];
  const out = { summary: readString(reply, "summary", 700, errors, "root") };

  out.budget = readArray(reply, "budget", errors, "root", 4, 14).map((line, i) =>
    readBudgetShare(line, i, errors),
  );
  if (out.budget.length && sum(out.budget.map((line) => line.pct)) <= 0) {
    errors.push("budget pct values must add up to more than 0");
  }
  if (out.budget.length && !out.budget.some((line) => CONTINGENCY_PATTERN.test(line.category))) {
    errors.push('budget must include a "Contingency" category');
  }

  out.tasks = readTasks(reply, daysLeft, errors);
  const repairs = repairDependencies(out.tasks);
  if (repairs.unknown.size && !final) {
    const sample = [...repairs.unknown].slice(0, 5).join(", ");
    errors.push(`tasks[].dependsOn must only use keys of tasks in this plan; unknown: ${sample}`);
  }
  out.unknownDepsRemoved = repairs.unknown.size;
  out.cyclesRemoved = repairs.cycles;
  if (repairs.cycles && !final) {
    const noun = repairs.cycles > 1 ? "dependencies" : "dependency";
    errors.push(
      `tasks[].dependsOn contains ${repairs.cycles} circular ${noun}; ` +
        "a task can't depend on itself through other tasks",
    );
  }

  out.vendors = readArray(reply, "vendors", errors, "root", 3, 15).map((vendor, i) =>
    readVendor(vendor, i, errors),
  );
  out.ideas = readArray(reply, "ideas", errors, "root", 3, 10).map((idea, i) =>
    validIdea(idea, errors, `ideas[${i}]`),
  );
  out.runOfShow = readRunOfShow(reply.runOfShow);
  out.risks = validRisks(reply.risks);
  return result(errors, out);
}

function readBudgetShare(line, i, errors) {
  const category = readString(line, "category", 60, errors, `budget[${i}]`);
  let pct = 0;
  if (isNumeric(line?.pct) && +line.pct >= 0 && +line.pct <= 100) pct = +line.pct;
  else errors.push(`budget[${i}].pct must be a number from 0 to 100`);
  return { category, pct, note: clip(line?.note, 200) };
}

function readTasks(reply, daysLeft, errors) {
  const keys = new Set();
  return readArray(reply, "tasks", errors, "root", 6, 60).map((task, i) => {
    let key = clip(task?.key, 30) || `t${i}`;
    while (keys.has(key)) key += "_";
    keys.add(key);

    let daysBefore = 0;
    if (isNumeric(task?.daysBefore)) daysBefore = Math.max(0, Math.round(+task.daysBefore));
    else errors.push(`tasks[${i}].daysBefore must be an integer`);
    if (daysLeft != null && daysLeft >= 0) daysBefore = Math.min(daysBefore, Math.max(daysLeft, 0));

    return {
      key,
      title: readString(task, "title", 160, errors, `tasks[${i}]`),
      phase: clip(task?.phase, 40),
      daysBefore,
      priority: PRIORITIES.includes(task?.priority) ? task.priority : "medium",
      dependsOn: Array.isArray(task?.dependsOn) ? task.dependsOn.map(String) : [],
    };
  });
}

/** Drops self-links, duplicates, unknown keys and loops from task dependencies. */
function repairDependencies(tasks) {
  const keys = new Set(tasks.map((task) => task.key));
  const unknown = new Set();
  for (const task of tasks) {
    const known = task.dependsOn.filter((key) => {
      const ok = keys.has(key) && key !== task.key;
      if (!ok) unknown.add(key);
      return ok;
    });
    task.dependsOn = [...new Set(known)];
  }
  return { unknown, cycles: breakCycles(tasks) };
}

function readVendor(vendor, i, errors) {
  const checklist = cleanList(vendor?.checklist, 160, Infinity);
  if (!checklist.length) errors.push(`vendors[${i}].checklist must have at least one item`);
  return {
    category: readString(vendor, "category", 60, errors, `vendors[${i}]`),
    critical: !!vendor?.critical,
    budgetCategory: clip(vendor?.budgetCategory, 60),
    bookByDaysBefore: isNumeric(vendor?.bookByDaysBefore)
      ? Math.max(0, Math.round(+vendor.bookByDaysBefore))
      : 30,
    checklist,
    questions: cleanList(vendor?.questions, 200, 6),
  };
}

function readRunOfShow(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (row) => row && /^\d{1,2}:\d{2}$/.test(String(row.time || "").trim()) && clip(row.item, 120),
    )
    .slice(0, 20)
    .map((row) => ({
      time: String(row.time).trim().padStart(5, "0"),
      item: clip(row.item, 120),
      owner: clip(row.owner, 60),
    }));
}

/**
 * Cleans one idea. Costs are clamped to [0, MAX_AMOUNT] and swapped if low > high.
 * @param {unknown} idea
 * @param {string[]} errors
 * @param {string} path
 * @returns {{title: string, detail: string, tag: string, costLow: number|null, costHigh: number|null}}
 */
export function validIdea(idea, errors, path) {
  const cost = (value) =>
    isNumeric(value) ? Math.min(MAX_AMOUNT, Math.max(0, Math.round(+value))) : null;
  let costLow = cost(idea?.costLow);
  let costHigh = cost(idea?.costHigh);
  if (costLow != null && costHigh != null && costLow > costHigh) {
    [costLow, costHigh] = [costHigh, costLow];
  }
  return {
    title: readString(idea, "title", 90, errors, path),
    detail: readString(idea, "detail", 320, errors, path),
    tag: clip(idea?.tag, 24) || "Idea",
    costLow,
    costHigh,
  };
}

/**
 * Keeps well-formed AI risks (known severity and a title), at most 8.
 * @param {unknown} risks
 * @returns {import("./risks.js").Risk[]}
 */
export function validRisks(risks) {
  if (!Array.isArray(risks)) return [];
  const severityOf = (risk) => String(risk.severity || "").toLowerCase();
  return risks
    .filter(
      (risk) => risk && Object.hasOwn(SEVERITY_RANK, severityOf(risk)) && clip(risk.title, 100),
    )
    .slice(0, 8)
    .map((risk) => ({
      sev: severityOf(risk),
      title: clip(risk.title, 100),
      why: clip(risk.why, 300),
      action: clip(risk.action, 240),
      source: "ai",
    }));
}

/**
 * Validates a co-planner reply: {reply, proposal?}.
 * @param {unknown} reply
 * @returns {Validation<{reply: string, proposal: object|null}>}
 */
export function validateChat(reply) {
  if (!isPlainObject(reply)) return NOT_AN_OBJECT;
  const errors = [];
  const text = clip(reply.reply, 2500);
  if (!text) errors.push('"reply" must be a non-empty string');

  let proposal = null;
  if (reply.proposal) {
    const { changes } = reply.proposal;
    if (!isPlainObject(changes)) errors.push("proposal.changes must be an object");
    else checkChanges(changes, errors);
    proposal = {
      title: clip(reply.proposal.title, 90) || "Proposed change",
      explanation: clip(reply.proposal.explanation, 700),
      tradeoffs: cleanList(reply.proposal.tradeoffs, 260, 6),
      changes,
    };
  }
  return result(errors, { reply: text, proposal });
}

function checkChanges(changes, errors) {
  checkBriefChanges(changes.brief, errors);
  checkBudgetChanges(changes.budget, errors);
  for (const key of ["addTasks", "removeTaskIds", "addVendors", "addIdeas"]) {
    if (changes[key] != null && !Array.isArray(changes[key])) {
      errors.push(`changes.${key} must be an array`);
    }
  }
  (Array.isArray(changes.addTasks) ? changes.addTasks : []).forEach((task, i) => {
    if (!clip(task?.title, 160)) errors.push(`addTasks[${i}].title missing`);
  });
  (Array.isArray(changes.addVendors) ? changes.addVendors : []).forEach((vendor, i) => {
    if (!clip(vendor?.category, 60)) errors.push(`addVendors[${i}].category missing`);
  });
}

function checkBriefChanges(brief, errors) {
  if (brief == null) return;
  if (!isPlainObject(brief)) errors.push("changes.brief must be an object");
  if (brief.date != null && !parseIsoDate(brief.date)) {
    errors.push("changes.brief.date must be YYYY-MM-DD");
  }
  const budget = brief.budget;
  if (budget != null && !(isNumeric(budget) && +budget > 0 && +budget <= MAX_AMOUNT)) {
    errors.push("changes.brief.budget must be a positive number up to 1e12");
  }
  if (brief.guests != null && !(isNumeric(brief.guests) && +brief.guests >= 1)) {
    errors.push("changes.brief.guests must be a positive integer");
  }
}

function checkBudgetChanges(budget, errors) {
  if (budget == null) return;
  if (!Array.isArray(budget) || !budget.length) {
    errors.push("changes.budget must be a non-empty array or omitted");
    return;
  }
  budget.forEach((line, i) => {
    if (!clip(line?.category, 60)) errors.push(`changes.budget[${i}].category missing`);
    if (!isAmount(line?.amount)) {
      errors.push(`changes.budget[${i}].amount must be a number from 0 to 1e12`);
    }
  });
}

/**
 * Validates a budget-optimizer reply: {explanation, tradeoffs, budget}.
 * @param {unknown} reply
 * @returns {Validation<{explanation: string, budget: object[], tradeoffs: string[]}>}
 */
export function validateBudgetOpt(reply) {
  if (!reply || typeof reply !== "object") return NOT_AN_OBJECT;
  const errors = [];
  const explanation = readString(reply, "explanation", 700, errors, "root");
  const budget = readArray(reply, "budget", errors, "root", 2, 16).map((line, i) => {
    if (!clip(line?.category, 60)) errors.push(`budget[${i}].category missing`);
    if (!isAmount(line?.amount)) errors.push(`budget[${i}].amount must be a number from 0 to 1e12`);
    return {
      category: clip(line?.category, 60),
      amount: +line?.amount || 0,
      note: clip(line?.note, 200),
    };
  });
  const tradeoffs = cleanList(reply.tradeoffs, 260, 6);
  return result(errors, { explanation, budget, tradeoffs });
}

/**
 * Validates an "ideas" reply: a JSON array of up to 6 ideas.
 * @param {unknown} reply
 * @returns {Validation<object[]>}
 */
export function validateIdeas(reply) {
  if (!Array.isArray(reply)) return { ok: false, errors: ["Top level must be an array"] };
  const errors = [];
  const ideas = reply.slice(0, 6).map((idea, i) => validIdea(idea, errors, `[${i}]`));
  if (errors.length) return { ok: false, errors };
  return ideas.length ? { ok: true, value: ideas } : { ok: false, errors: ["empty array"] };
}

/**
 * Validates a risk-review reply: {risks: [...]}, at least one usable risk.
 * @param {unknown} reply
 * @returns {Validation<object[]>}
 */
export function validateRiskReview(reply) {
  const risks = validRisks(reply?.risks);
  return risks.length
    ? { ok: true, value: risks }
    : { ok: false, errors: ['"risks" must be a non-empty array of {severity,title,why,action}'] };
}
