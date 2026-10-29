/**
 * @file Validators for Claude's JSON replies. Each returns {ok: true, value} with cleaned data, or
 * {ok: false, errors} with messages that are sent back to Claude so it can correct its answer.
 */
import { CONTINGENCY_PATTERN, PRIORITIES, SEVERITIES, isOneOf, oneOf } from "./constants.js";
import { parseIsoDate } from "./dates.js";
import { breakCycles } from "./scheduler.js";
import { MAX_AMOUNT, clip, isNumeric, isPlainObject, sum } from "./util.js";

/**
 * @typedef {{ok: true, value: T} | {ok: false, errors: string[]}} Validation
 * @template T
 */

/** @typedef {import("./model.js").AiRisk} AiRisk */

/**
 * @typedef {object} BudgetShare
 * @property {string} category
 * @property {number} pct share of the total, 0–100
 * @property {string} note
 */

/**
 * @typedef {object} GeneratedTask
 * @property {string} key reference used by other tasks' dependsOn
 * @property {string} title
 * @property {string} phase
 * @property {number} daysBefore
 * @property {import("./model.js").Priority} priority
 * @property {string[]} dependsOn keys of tasks that must be done first
 */

/**
 * @typedef {object} VendorSpec
 * @property {string} category
 * @property {boolean} critical
 * @property {string} [budgetCategory] the budget line it is paid from, by name
 * @property {number} [bookByDaysBefore]
 * @property {string[]} [checklist]
 * @property {string[]} [questions]
 */

/**
 * @typedef {object} IdeaSpec
 * @property {string} title
 * @property {string} detail
 * @property {string} tag
 * @property {number|null} [costLow]
 * @property {number|null} [costHigh]
 */

/**
 * @typedef {object} RunOfShowSpec
 * @property {string} time HH:MM
 * @property {string} item
 * @property {string} owner
 */

/**
 * @typedef {object} GeneratedPlan Claude's (or a template's) plan content, cleaned.
 * @property {string} summary
 * @property {BudgetShare[]} budget
 * @property {GeneratedTask[]} tasks
 * @property {VendorSpec[]} vendors
 * @property {IdeaSpec[]} ideas
 * @property {RunOfShowSpec[]} [runOfShow]
 * @property {AiRisk[]} [risks]
 * @property {number} [unknownDepsRemoved]
 * @property {number} [cyclesRemoved]
 */

/**
 * @typedef {object} ChatProposal a change Claude suggests, not yet checked against the plan
 * @property {string} title
 * @property {string} explanation
 * @property {string[]} tradeoffs
 * @property {Record<string, unknown>} changes
 */

/**
 * @typedef {object} BudgetAmount
 * @property {string} category
 * @property {number} amount
 * @property {string} note
 */

/** @typedef {Record<string, unknown>} Raw an untrusted object from a reply */

/** @type {{ok: false, errors: string[]}} */
const NOT_AN_OBJECT = { ok: false, errors: ["Top level must be a JSON object"] };

/**
 * @template T
 * @param {string[]} errors
 * @param {T} value
 * @returns {Validation<T>}
 */
const result = (errors, value) => (errors.length ? { ok: false, errors } : { ok: true, value });

/** @param {unknown} value */
const isAmount = (value) => isNumeric(value) && Number(value) >= 0 && Number(value) <= MAX_AMOUNT;

/**
 * Non-empty strings from a list, each cut to maxLength.
 * @param {unknown} list
 * @param {number} maxLength
 * @param {number} maxItems
 * @returns {string[]}
 */
const cleanList = (list, maxLength, maxItems) =>
  (Array.isArray(list) ? list : [])
    .map((text) => clip(text, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);

/**
 * Reads a string field, recording an error when a required one is empty.
 * @param {unknown} object
 * @param {string} key
 * @param {number} maxLength
 * @param {string[]} errors
 * @param {string} path where the field is, for the error message
 * @param {boolean} [required]
 * @returns {string}
 */
function readString(object, key, maxLength, errors, path, required = true) {
  const text = clip(field(object, key), maxLength);
  if (required && !text) errors.push(`${path}.${key} must be a non-empty string`);
  return text;
}

/**
 * One field of an untrusted value, or undefined when it isn't an object.
 * @param {unknown} object
 * @param {string} key
 * @returns {unknown}
 */
const field = (object, key) => (isPlainObject(object) ? object[key] : undefined);

/**
 * Reads an array field, recording an error when it's missing or too short.
 * @param {unknown} object
 * @param {string} key
 * @param {string[]} errors
 * @param {string} path where the field is, for the error message
 * @param {number} min
 * @param {number} max
 * @returns {unknown[]} at most `max` items
 */
function readArray(object, key, errors, path, min, max) {
  const list = field(object, key);
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
  /** @type {string[]} */
  const errors = [];
  const summary = readString(reply, "summary", 700, errors, "root");
  const budget = readBudget(reply, errors);
  const tasks = readTasks(reply, daysLeft, errors);
  const repairs = repairDependencies(tasks);
  if (!final) errors.push(...dependencyErrors(repairs));

  const vendors = readArray(reply, "vendors", errors, "root", 3, 15).map((vendor, i) =>
    readVendor(vendor, i, errors),
  );
  const ideas = readArray(reply, "ideas", errors, "root", 3, 10).map((idea, i) =>
    validIdea(idea, errors, `ideas[${i}]`),
  );
  return result(errors, {
    summary,
    budget,
    tasks,
    unknownDepsRemoved: repairs.unknown.size,
    cyclesRemoved: repairs.cycles,
    vendors,
    ideas,
    runOfShow: readRunOfShow(reply.runOfShow),
    risks: validRisks(reply.risks),
  });
}

/**
 * The budget shares; they must add up to more than 0 and include a contingency.
 * @param {Raw} reply
 * @param {string[]} errors
 * @returns {BudgetShare[]}
 */
function readBudget(reply, errors) {
  const budget = readArray(reply, "budget", errors, "root", 4, 14).map((line, i) =>
    readBudgetShare(line, i, errors),
  );
  if (budget.length && sum(budget.map((line) => line.pct)) <= 0) {
    errors.push("budget pct values must add up to more than 0");
  }
  if (budget.length && !budget.some((line) => CONTINGENCY_PATTERN.test(line.category))) {
    errors.push('budget must include a "Contingency" category');
  }
  return budget;
}

/**
 * What to tell Claude about dependencies that had to be repaired, so it can fix them itself.
 * @param {{unknown: Set<string>, cycles: number}} repairs
 * @returns {string[]}
 */
function dependencyErrors({ unknown, cycles }) {
  const errors = [];
  if (unknown.size) {
    const sample = [...unknown].slice(0, 5).join(", ");
    errors.push(`tasks[].dependsOn must only use keys of tasks in this plan; unknown: ${sample}`);
  }
  if (cycles) {
    const noun = cycles > 1 ? "dependencies" : "dependency";
    errors.push(
      `tasks[].dependsOn contains ${cycles} circular ${noun}; ` +
        "a task can't depend on itself through other tasks",
    );
  }
  return errors;
}

/**
 * @param {unknown} line
 * @param {number} i
 * @param {string[]} errors
 * @returns {BudgetShare}
 */
function readBudgetShare(line, i, errors) {
  const category = readString(line, "category", 60, errors, `budget[${i}]`);
  const share = Number(field(line, "pct"));
  let pct = 0;
  if (isNumeric(field(line, "pct")) && share >= 0 && share <= 100) pct = share;
  else errors.push(`budget[${i}].pct must be a number from 0 to 100`);
  return { category, pct, note: clip(field(line, "note"), 200) };
}

/**
 * @param {Raw} reply
 * @param {number|null} daysLeft
 * @param {string[]} errors
 * @returns {GeneratedTask[]}
 */
function readTasks(reply, daysLeft, errors) {
  /** @type {Set<string>} */
  const keys = new Set();
  return readArray(reply, "tasks", errors, "root", 6, 60).map((task, i) => {
    let key = clip(field(task, "key"), 30) || `t${i}`;
    while (keys.has(key)) key += "_";
    keys.add(key);

    const lead = field(task, "daysBefore");
    let daysBefore = 0;
    if (isNumeric(lead)) daysBefore = Math.max(0, Math.round(Number(lead)));
    else errors.push(`tasks[${i}].daysBefore must be an integer`);
    if (daysLeft != null && daysLeft >= 0) daysBefore = Math.min(daysBefore, Math.max(daysLeft, 0));

    return {
      key,
      title: readString(task, "title", 160, errors, `tasks[${i}]`),
      phase: clip(field(task, "phase"), 40),
      daysBefore,
      priority: oneOf(field(task, "priority"), PRIORITIES, "medium"),
      dependsOn: stringList(field(task, "dependsOn")),
    };
  });
}

/**
 * Every item of a list as a string, or [] when it isn't a list.
 * @param {unknown} list
 * @returns {string[]}
 */
const stringList = (list) => (Array.isArray(list) ? list.map(String) : []);

/**
 * Drops self-links, duplicates, unknown keys and loops from task dependencies.
 * @param {GeneratedTask[]} tasks mutated in place
 * @returns {{unknown: Set<string>, cycles: number}}
 */
function repairDependencies(tasks) {
  const keys = new Set(tasks.map((task) => task.key));
  /** @type {Set<string>} */
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

/**
 * @param {unknown} vendor
 * @param {number} i
 * @param {string[]} errors
 * @returns {VendorSpec}
 */
function readVendor(vendor, i, errors) {
  const checklist = cleanList(field(vendor, "checklist"), 160, Infinity);
  if (!checklist.length) errors.push(`vendors[${i}].checklist must have at least one item`);
  const lead = field(vendor, "bookByDaysBefore");
  return {
    category: readString(vendor, "category", 60, errors, `vendors[${i}]`),
    critical: !!field(vendor, "critical"),
    budgetCategory: clip(field(vendor, "budgetCategory"), 60),
    bookByDaysBefore: isNumeric(lead) ? Math.max(0, Math.round(Number(lead))) : 30,
    checklist,
    questions: cleanList(field(vendor, "questions"), 200, 6),
  };
}

/**
 * @param {unknown} rows
 * @returns {RunOfShowSpec[]}
 */
function readRunOfShow(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(isPlainObject)
    .filter((row) => /^\d{1,2}:\d{2}$/.test(String(row.time || "").trim()) && clip(row.item, 120))
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
 * @returns {Required<IdeaSpec>}
 */
export function validIdea(idea, errors, path) {
  /** @type {(value: unknown) => number|null} */
  const cost = (value) =>
    isNumeric(value) ? Math.min(MAX_AMOUNT, Math.max(0, Math.round(Number(value)))) : null;
  let costLow = cost(field(idea, "costLow"));
  let costHigh = cost(field(idea, "costHigh"));
  if (costLow != null && costHigh != null && costLow > costHigh) {
    [costLow, costHigh] = [costHigh, costLow];
  }
  return {
    title: readString(idea, "title", 90, errors, path),
    detail: readString(idea, "detail", 320, errors, path),
    tag: clip(field(idea, "tag"), 24) || "Idea",
    costLow,
    costHigh,
  };
}

/**
 * Keeps well-formed AI risks (known severity and a title), at most 8.
 * @param {unknown} risks
 * @returns {AiRisk[]}
 */
export function validRisks(risks) {
  if (!Array.isArray(risks)) return [];
  /** @param {Raw} risk */
  const severityOf = (risk) => String(risk.severity || "").toLowerCase();
  return risks
    .filter(isPlainObject)
    .filter((risk) => isOneOf(severityOf(risk), SEVERITIES) && clip(risk.title, 100))
    .slice(0, 8)
    .map((risk) => ({
      sev: oneOf(severityOf(risk), SEVERITIES, "low"),
      title: clip(risk.title, 100),
      why: clip(risk.why, 300),
      action: clip(risk.action, 240),
      source: /** @type {const} */ ("ai"),
    }));
}

/**
 * Validates a co-planner reply: {reply, proposal?}.
 * @param {unknown} reply
 * @returns {Validation<{reply: string, proposal: ChatProposal|null}>}
 */
export function validateChat(reply) {
  if (!isPlainObject(reply)) return NOT_AN_OBJECT;
  /** @type {string[]} */
  const errors = [];
  const text = clip(reply.reply, 2500);
  if (!text) errors.push('"reply" must be a non-empty string');

  /** @type {ChatProposal|null} */
  let proposal = null;
  const offered = reply.proposal;
  if (offered) {
    const changes = field(offered, "changes");
    if (isPlainObject(changes)) checkChanges(changes, errors);
    else errors.push("proposal.changes must be an object");
    proposal = {
      title: clip(field(offered, "title"), 90) || "Proposed change",
      explanation: clip(field(offered, "explanation"), 700),
      tradeoffs: cleanList(field(offered, "tradeoffs"), 260, 6),
      changes: isPlainObject(changes) ? changes : {},
    };
  }
  return result(errors, { reply: text, proposal });
}

/**
 * @param {Raw} changes
 * @param {string[]} errors
 */
function checkChanges(changes, errors) {
  checkBriefChanges(changes.brief, errors);
  checkBudgetChanges(changes.budget, errors);
  for (const key of ["addTasks", "removeTaskIds", "addVendors", "addIdeas"]) {
    if (changes[key] != null && !Array.isArray(changes[key])) {
      errors.push(`changes.${key} must be an array`);
    }
  }
  (Array.isArray(changes.addTasks) ? changes.addTasks : []).forEach((task, i) => {
    if (!clip(field(task, "title"), 160)) errors.push(`addTasks[${i}].title missing`);
  });
  (Array.isArray(changes.addVendors) ? changes.addVendors : []).forEach((vendor, i) => {
    if (!clip(field(vendor, "category"), 60)) errors.push(`addVendors[${i}].category missing`);
  });
}

/**
 * @param {unknown} brief
 * @param {string[]} errors
 */
function checkBriefChanges(brief, errors) {
  if (brief == null) return;
  if (!isPlainObject(brief)) {
    errors.push("changes.brief must be an object");
    return;
  }
  if (brief.date != null && !parseIsoDate(String(brief.date))) {
    errors.push("changes.brief.date must be YYYY-MM-DD");
  }
  const budget = brief.budget;
  if (
    budget != null &&
    !(isNumeric(budget) && Number(budget) > 0 && Number(budget) <= MAX_AMOUNT)
  ) {
    errors.push("changes.brief.budget must be a positive number up to 1e12");
  }
  if (brief.guests != null && !(isNumeric(brief.guests) && Number(brief.guests) >= 1)) {
    errors.push("changes.brief.guests must be a positive integer");
  }
}

/**
 * @param {unknown} budget
 * @param {string[]} errors
 */
function checkBudgetChanges(budget, errors) {
  if (budget == null) return;
  if (!Array.isArray(budget) || !budget.length) {
    errors.push("changes.budget must be a non-empty array or omitted");
    return;
  }
  budget.forEach((line, i) => {
    if (!clip(field(line, "category"), 60)) errors.push(`changes.budget[${i}].category missing`);
    if (!isAmount(field(line, "amount"))) {
      errors.push(`changes.budget[${i}].amount must be a number from 0 to 1e12`);
    }
  });
}

/**
 * Validates a budget-optimizer reply: {explanation, tradeoffs, budget}.
 * @param {unknown} reply
 * @returns {Validation<{explanation: string, budget: BudgetAmount[], tradeoffs: string[]}>}
 */
export function validateBudgetOpt(reply) {
  if (!isPlainObject(reply)) return NOT_AN_OBJECT;
  /** @type {string[]} */
  const errors = [];
  const explanation = readString(reply, "explanation", 700, errors, "root");
  const budget = readArray(reply, "budget", errors, "root", 2, 16).map((line, i) => {
    const category = clip(field(line, "category"), 60);
    const amount = field(line, "amount");
    if (!category) errors.push(`budget[${i}].category missing`);
    if (!isAmount(amount)) errors.push(`budget[${i}].amount must be a number from 0 to 1e12`);
    return { category, amount: Number(amount) || 0, note: clip(field(line, "note"), 200) };
  });
  const tradeoffs = cleanList(reply.tradeoffs, 260, 6);
  return result(errors, { explanation, budget, tradeoffs });
}

/**
 * Validates an "ideas" reply: a JSON array of up to 6 ideas.
 * @param {unknown} reply
 * @returns {Validation<Array<Required<IdeaSpec>>>}
 */
export function validateIdeas(reply) {
  if (!Array.isArray(reply)) return { ok: false, errors: ["Top level must be an array"] };
  /** @type {string[]} */
  const errors = [];
  const ideas = reply.slice(0, 6).map((idea, i) => validIdea(idea, errors, `[${i}]`));
  if (errors.length) return { ok: false, errors };
  return ideas.length ? { ok: true, value: ideas } : { ok: false, errors: ["empty array"] };
}

/**
 * Validates a risk-review reply: {risks: [...]}, at least one usable risk.
 * @param {unknown} reply
 * @returns {Validation<AiRisk[]>}
 */
export function validateRiskReview(reply) {
  const risks = validRisks(field(reply, "risks"));
  return risks.length
    ? { ok: true, value: risks }
    : { ok: false, errors: ['"risks" must be a non-empty array of {severity,title,why,action}'] };
}
