/**
 * @file Proposals: a requested change is applied to a copy of the plan, checked, and turned into a
 * before/after diff the person approves. Pure functions; applying the result is done elsewhere.
 */
import { fitToTotal } from "./budget.js";
import {
  CURRENCIES,
  EVENT_TYPES,
  MAX_GUESTS,
  PRIORITIES,
  TIME_PATTERN,
  isContingency,
  isOneOf,
  oneOf,
} from "./constants.js";
import { daysBetween, parseIsoDate, today } from "./dates.js";
import { formatMoney, moneyIn } from "./format.js";
import { matchLine, newVendor } from "./model.js";
import { diffPlans } from "./plan-diff.js";
import { validIdea } from "./validation.js";
import {
  MAX_AMOUNT,
  clip,
  deepClone,
  isNumeric,
  isPlainObject,
  normalizeName,
  safeAmount,
  sum,
  uid,
} from "./util.js";

/** @typedef {import("./model.js").Plan} Plan */
/** @typedef {import("./model.js").CorePlan} CorePlan */
/** @typedef {import("./model.js").BudgetLine} BudgetLine */
/** @typedef {import("./model.js").ItemOrigin} ItemOrigin */
/** @typedef {Record<string, unknown>} Raw an object from Claude or the UI, not yet checked */

/**
 * Free-text brief fields a proposal may change, with their maximum lengths.
 * @type {Array<["name"|"city"|"style"|"notes", number]>}
 */
const TEXT_LIMITS = [
  ["name", 90],
  ["city", 80],
  ["style", 120],
  ["notes", 600],
];

/**
 * Whole-number brief fields a proposal may change: [field, maximum, warning when out of range].
 * Both must be at least 1.
 * @type {Array<["budget"|"guests", number, string]>}
 */
const WHOLE_NUMBER_FIELDS = [
  ["budget", MAX_AMOUNT, "Ignored an invalid budget value."],
  ["guests", MAX_GUESTS, "Ignored an invalid guest count."],
];

/**
 * @param {unknown} value
 * @returns {value is string} true for "" (no start time) or HH:MM
 */
const isStartTime = (value) =>
  typeof value === "string" && (value === "" || TIME_PATTERN.test(value));

/**
 * Brief fields that only accept known values. A proposal with anything else is ignored for that
 * field (with a warning), so model output can never put arbitrary text where the app expects a
 * code, a time or an event type.
 * @type {Array<["type"|"currency"|"time", (value: unknown) => value is string, string]>}
 */
const CHECKED_FIELDS = [
  ["type", (value) => isOneOf(value, EVENT_TYPES), "Ignored an unknown event type."],
  ["currency", (value) => isOneOf(value, CURRENCIES), "Ignored an unsupported currency."],
  ["time", isStartTime, "Ignored an invalid start time."],
];

/**
 * What a proposal asks to change. Everything is untrusted (it may come from Claude) and checked
 * as it is applied.
 * @typedef {object} ProposalChanges
 * @property {unknown} [brief] brief fields to change
 * @property {unknown} [budget] a new allocation: [{category, amount, note?, locked?}]
 * @property {unknown} [addTasks] [{title, phase?, daysBefore?, priority?}]
 * @property {unknown} [removeTaskIds]
 * @property {unknown} [addVendors] [{category, critical?, budgetCategory?, bookByDaysBefore?, ...}]
 * @property {unknown} [addIdeas] [{title, detail, tag?, costLow?, costHigh?}]
 */

/**
 * @typedef {object} ProposalSpec
 * @property {"ai"|"rule"|"you"} origin who suggested the change
 * @property {string} kind e.g. "chat", "optimize", "alloc", "details", "idea"
 * @property {string} title
 * @property {string} [explanation]
 * @property {string[]} [tradeoffs]
 * @property {ProposalChanges} changes
 * @property {string} [request] the user's message, for chat proposals
 */

/**
 * @typedef {object} Proposal
 * @property {string} id
 * @property {ProposalSpec["origin"]} origin
 * @property {string} kind
 * @property {string} title
 * @property {string} explanation
 * @property {string[]} tradeoffs
 * @property {string[]} warnings what Marigold adjusted or ignored
 * @property {string|null} blocked why it can't be applied, if it can't
 * @property {number} baseRev the plan revision it was made against
 * @property {string} planId
 * @property {CorePlan} after the plan as it would be after applying
 * @property {import("./plan-diff.js").PlanDiff} diff
 * @property {string} [request]
 * @property {"pending"|"stale"} status
 */

/**
 * A copy of the plan without undo history, chat and log: the part a proposal or undo snapshot
 * replaces.
 * @param {CorePlan & Partial<Pick<Plan, "history" | "chat" | "log">>} plan
 * @returns {CorePlan}
 */
export function corePlan(plan) {
  const { history, chat, log, ...core } = deepClone(plan);
  return core;
}

/**
 * The items of an untrusted list that are objects.
 * @param {unknown} list
 * @returns {Raw[]}
 */
const objects = (list) => (Array.isArray(list) ? list.filter(isPlainObject) : []);

/**
 * Every item of an untrusted list as clipped text.
 * @param {unknown} list
 * @param {number} maxLength
 * @returns {string[]}
 */
const clipEach = (list, maxLength) =>
  Array.isArray(list) ? list.map((text) => clip(text, maxLength)) : [];

/**
 * Applies a requested change to a copy of `base` and describes the result.
 * Money always adds up exactly; committed spend is never cut; past dates are refused.
 * @param {CorePlan} base the current plan (not modified)
 * @param {ProposalSpec} spec
 * @returns {Proposal}
 */
export function makeProposal(
  base,
  { origin, kind, title, explanation, tradeoffs, changes, request },
) {
  const after = corePlan(base);
  /** @type {string[]} */
  const warnings = [];
  /** @type {ItemOrigin} */
  const itemOrigin = origin === "ai" ? "ai" : "you";

  const brief = isPlainObject(changes.brief) ? changes.brief : {};
  let blocked = applyBriefChanges(base, after, brief, warnings);
  const budgetBlock = applyBudgetChanges(base, after, changes.budget, origin, warnings);
  blocked = budgetBlock || blocked;

  const eventDate = parseIsoDate(after.brief.date);
  const daysLeft = eventDate ? daysBetween(today(), eventDate) : null;
  addTasks(after, changes.addTasks, daysLeft, itemOrigin, warnings);
  removeTasks(after, changes.removeTaskIds, warnings);
  addVendors(after, changes.addVendors, daysLeft, itemOrigin, warnings);
  addIdeas(after, changes.addIdeas, itemOrigin);
  relinkVendors(after);

  after.rev = base.rev + 1;
  return {
    id: uid(),
    origin,
    kind,
    title,
    explanation: explanation || "",
    tradeoffs: tradeoffs || [],
    warnings,
    blocked,
    baseRev: base.rev,
    planId: base.id,
    after,
    diff: diffPlans(base, after),
    request,
    status: "pending",
  };
}

/**
 * Budget, guests, date and venue capacity: numbers and dates are range-checked.
 * @param {CorePlan} after
 * @param {Raw} brief
 * @param {string[]} warnings
 */
function applyNumericBriefChanges(after, brief, warnings) {
  for (const [field, max, warning] of WHOLE_NUMBER_FIELDS) {
    if (brief[field] == null) continue;
    const value = Math.round(Number(brief[field]));
    if (value >= 1 && value <= max) after.brief[field] = value;
    else warnings.push(warning);
  }
  if (brief.date != null) {
    if (typeof brief.date === "string" && parseIsoDate(brief.date)) after.brief.date = brief.date;
    else warnings.push("Ignored an invalid date.");
  }
  if ("venueCapacity" in brief) {
    const capacity = Math.round(Number(brief.venueCapacity));
    after.brief.venueCapacity = brief.venueCapacity != null && capacity > 0 ? capacity : null;
  }
}

/**
 * @param {CorePlan} base
 * @param {CorePlan} after
 * @param {Raw} brief
 * @param {string[]} warnings
 * @returns {string|null} a reason the change is blocked, if any
 */
function applyBriefChanges(base, after, brief, warnings) {
  applyNumericBriefChanges(after, brief, warnings);
  for (const [field, limit] of TEXT_LIMITS) {
    const value = brief[field];
    if (typeof value === "string") after.brief[field] = clip(value, limit);
  }
  for (const [field, isValid, warning] of CHECKED_FIELDS) {
    const value = brief[field];
    if (value == null) continue;
    if (isValid(value)) after.brief[field] = value;
    else warnings.push(warning);
  }
  if (after.brief.currency !== base.brief.currency) {
    warnings.push("Currency changed: amounts are relabelled, not converted.");
  }

  const newDate = parseIsoDate(after.brief.date);
  const dateMoved = brief.date != null && after.brief.date !== base.brief.date;
  if (dateMoved && newDate && daysBetween(today(), newDate) < 0) {
    return "The new event date is in the past.";
  }
  return null;
}

/**
 * Applies a new allocation (or rescales for a new total) so the budget adds up exactly.
 * @param {CorePlan} base
 * @param {CorePlan} after
 * @param {unknown} proposedLines
 * @param {ProposalSpec["origin"]} origin
 * @param {string[]} warnings
 * @returns {string|null} a reason the change is blocked, if any
 */
function applyBudgetChanges(base, after, proposedLines, origin, warnings) {
  const total = after.brief.budget;
  const money = moneyIn(after.brief.currency);
  const newLines = objects(proposedLines);
  if (!newLines.length) {
    return total === base.brief.budget ? null : rescaleBudget(after, warnings);
  }

  const { lines, lockedIndexes } = mergeBudgetLines(after.budget, newLines, warnings);
  const raised = lines.filter((line) => (line.committed || 0) > line.amount).map((l) => l.category);
  if (raised.length) warnings.push(`Raised ${raised.join(", ")} to the amount already committed.`);

  // A small arithmetic slip from Claude is absorbed by the contingency line first, so the
  // categories Claude chose to protect stay exactly as proposed; anything larger is spread in
  // proportion.
  const proposedSum = sum(lines.map((line) => line.amount));
  const gap = total - proposedSum;
  const hasContingency = absorbInContingency(lines, gap);

  const fit = fitToTotal(
    lines.map((line) => line.amount),
    lines.map((line) => line.committed || 0),
    total,
    lockedIndexes,
  );
  if (!fit.ok) {
    const committed = sum(lines.map((line) => line.committed || 0));
    return (
      `Committed spend (${money(committed)}) is more than the budget of ${money(total)}, ` +
      "so this can't be applied without cutting commitments."
    );
  }
  lines.forEach((line, i) => {
    line.amount = fit.amounts[i];
  });
  after.budget = lines;

  if (gap && origin === "ai") {
    const where = hasContingency ? "in Contingency" : "across categories in proportion";
    warnings.push(
      `Claude's amounts added up to ${money(proposedSum)}, not ${money(total)}. ` +
        `Marigold corrected the difference of ${money(Math.abs(gap))} ${where} ` +
        "so the total is exact.",
    );
  }
  return null;
}

/**
 * Scales every line to a new total, never below committed spend.
 * @param {CorePlan} after mutated
 * @param {string[]} warnings
 * @returns {string|null} a reason the change is blocked, if any
 */
function rescaleBudget(after, warnings) {
  const total = after.brief.budget;
  const fit = fitToTotal(
    after.budget.map((line) => line.amount),
    after.budget.map((line) => line.committed || 0),
    total,
  );
  if (!fit.ok) {
    return `Committed spend is more than the new budget of ${formatMoney(total, after.brief.currency)}.`;
  }
  after.budget.forEach((line, i) => {
    line.amount = fit.amounts[i];
  });
  warnings.push("Every category was scaled in proportion; committed spend is protected.");
  return null;
}

/**
 * Adds a gap between the proposed lines and the total to the contingency line, unless that would
 * take it below its committed spend.
 * @param {BudgetLine[]} lines mutated
 * @param {number} gap total minus the sum of the lines
 * @returns {boolean} true when there is a contingency line
 */
function absorbInContingency(lines, gap) {
  const contingency = lines.find((line) => isContingency(line.category));
  if (gap && contingency && contingency.amount + gap >= (contingency.committed || 0)) {
    contingency.amount += gap;
  }
  return !!contingency;
}

/**
 * Matches proposed categories to existing lines (exact name first, then partial), keeps any
 * dropped line that has committed spend, and records which lines are locked.
 * @param {BudgetLine[]} existing
 * @param {Raw[]} proposed
 * @param {string[]} warnings
 * @returns {{lines: BudgetLine[], lockedIndexes: number[]}}
 */
function mergeBudgetLines(existing, proposed, warnings) {
  /** @type {Set<string>} */
  const used = new Set();
  /** @type {BudgetLine[]} */
  const lines = [];
  /** @type {number[]} */
  const lockedIndexes = [];
  /** @param {BudgetLine} line */
  const unused = (line) => !used.has(line.id);

  for (const entry of proposed) {
    const name = clip(entry.category, 60);
    if (!name) continue;
    const key = normalizeName(name);
    const match =
      existing.find((line) => unused(line) && normalizeName(line.category) === key) ||
      existing.find((line) => {
        const lineKey = normalizeName(line.category);
        return unused(line) && (lineKey.includes(key) || key.includes(lineKey));
      });
    const amount = safeAmount(entry.amount) ?? 0;
    if (match) {
      used.add(match.id);
      lines.push({ ...match, amount, note: entry.note ? clip(entry.note, 200) : match.note });
    } else {
      lines.push({
        id: uid(),
        category: name,
        note: clip(entry.note, 200),
        amount,
        committed: null,
      });
    }
    if (entry.locked) lockedIndexes.push(lines.length - 1);
  }

  for (const line of existing) {
    if (unused(line) && (line.committed || 0) > 0) {
      lines.push({ ...line });
      warnings.push(`Kept “${line.category}” because it has committed spend.`);
    }
  }
  return { lines, lockedIndexes };
}

/**
 * @param {CorePlan} after
 * @param {unknown} newTasks
 * @param {number|null} daysLeft
 * @param {ItemOrigin} origin
 * @param {string[]} warnings
 */
function addTasks(after, newTasks, daysLeft, origin, warnings) {
  let clamped = false;
  for (const task of objects(newTasks)) {
    const title = clip(task.title, 160);
    if (!title) continue;
    if (after.tasks.some((existing) => normalizeName(existing.title) === normalizeName(title))) {
      warnings.push(`Skipped duplicate task “${title}”.`);
      continue;
    }
    let offset = isNumeric(task.daysBefore) ? Math.max(0, Math.round(Number(task.daysBefore))) : 7;
    if (daysLeft != null && daysLeft >= 0 && offset > daysLeft) {
      offset = daysLeft;
      clamped = true;
    }
    after.tasks.push({
      id: uid(),
      title,
      phase: clip(task.phase, 40) || "Added",
      offset,
      fixedOffset: true,
      fixedDate: "",
      priority: oneOf(task.priority, PRIORITIES, "medium"),
      deps: [],
      done: false,
      origin,
    });
  }
  if (clamped) warnings.push("Some new tasks were moved so they aren't dated in the past.");
}

/**
 * Removes pending tasks by id (completed tasks are never removed) and unlinks dependents.
 * @param {CorePlan} after
 * @param {unknown} ids
 * @param {string[]} warnings
 */
function removeTasks(after, ids, warnings) {
  const remove = new Set(Array.isArray(ids) ? ids.map(String) : []);
  if (!remove.size) return;
  if (after.tasks.some((task) => remove.has(task.id) && task.done)) {
    warnings.push("Completed tasks are never removed.");
  }
  after.tasks = after.tasks.filter((task) => !(remove.has(task.id) && !task.done));
  const remaining = new Set(after.tasks.map((task) => task.id));
  after.tasks.forEach((task) => {
    task.deps = task.deps.filter((id) => remaining.has(id));
  });
}

/**
 * Adds vendors; an existing vendor with a similar category gets the new checklist items instead.
 * @param {CorePlan} after
 * @param {unknown} newVendors
 * @param {number|null} daysLeft
 * @param {ItemOrigin} origin
 * @param {string[]} warnings
 */
function addVendors(after, newVendors, daysLeft, origin, warnings) {
  for (const spec of objects(newVendors)) {
    const category = clip(spec.category, 60);
    if (!category) continue;
    const key = normalizeName(category);
    const existing = after.vendors.find((vendor) => {
      const vendorKey = normalizeName(vendor.category);
      return vendorKey === key || vendorKey.includes(key) || key.includes(vendorKey);
    });
    if (existing) {
      const knownItems = new Set(existing.checklist.map((item) => normalizeName(item.text)));
      const additions = (Array.isArray(spec.checklist) ? spec.checklist : [])
        .map((text) => clip(text, 160))
        .filter((text) => text && !knownItems.has(normalizeName(text)));
      additions.forEach((text) => existing.checklist.push({ id: uid(), text, done: false }));
      const added = additions.length
        ? `; ${additions.length} checklist item${additions.length > 1 ? "s" : ""} added to it`
        : "";
      warnings.push(`${existing.category} already exists${added}.`);
    } else {
      const lead = Number(spec.bookByDaysBefore) || 0;
      const bookBy = daysLeft != null && daysLeft >= 0 ? Math.min(lead, daysLeft) : lead;
      const vendorSpec = {
        category,
        critical: !!spec.critical,
        budgetCategory: clip(spec.budgetCategory, 60),
        bookByDaysBefore: bookBy,
        checklist: clipEach(spec.checklist, 160),
        questions: clipEach(spec.questions, 200),
      };
      after.vendors.push(newVendor(vendorSpec, after.budget, origin));
    }
  }
}

/**
 * @param {CorePlan} after
 * @param {unknown} newIdeas
 * @param {ItemOrigin} origin
 */
function addIdeas(after, newIdeas, origin) {
  for (const raw of Array.isArray(newIdeas) ? newIdeas : []) {
    const idea = validIdea(raw, [], "idea");
    const duplicate = after.ideas.some(
      (existing) => normalizeName(existing.title) === normalizeName(idea.title),
    );
    if (!idea.title || duplicate) continue;
    after.ideas.push({ id: uid(), ...idea, origin });
  }
}

/**
 * Points vendors whose budget line was removed at the closest remaining line.
 * @param {CorePlan} after
 */
function relinkVendors(after) {
  for (const vendor of after.vendors) {
    if (vendor.lineId && !after.budget.some((line) => line.id === vendor.lineId)) {
      vendor.lineId = matchLine(vendor.category, after.budget);
    }
  }
}
