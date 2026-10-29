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
} from "./constants.js";
import { daysBetween, parseIsoDate, today } from "./dates.js";
import { formatDate, formatMoney } from "./format.js";
import { matchLine, newVendor } from "./model.js";
import { analyze } from "./risks.js";
import { validIdea } from "./validation.js";
import {
  MAX_AMOUNT,
  clip,
  deepClone,
  isNumeric,
  normalizeName,
  safeAmount,
  sum,
  uid,
} from "./util.js";

/** Free-text brief fields a proposal may change, with their maximum lengths. */
const TEXT_LIMITS = { name: 90, city: 80, style: 120, notes: 600 };

/**
 * Brief fields that only accept known values. A proposal with anything else is ignored for that
 * field (with a warning), so model output can never put arbitrary text where the app expects a
 * code, a time or an event type.
 */
const CHECKED_FIELDS = {
  type: { valid: (v) => EVENT_TYPES.includes(v), warning: "Ignored an unknown event type." },
  currency: { valid: (v) => CURRENCIES.includes(v), warning: "Ignored an unsupported currency." },
  time: {
    valid: (v) => v === "" || TIME_PATTERN.test(v),
    warning: "Ignored an invalid start time.",
  },
};

/**
 * @typedef {object} ProposalSpec
 * @property {"ai"|"rule"|"you"} origin who suggested the change
 * @property {string} kind e.g. "chat", "optimize", "alloc", "details", "idea"
 * @property {string} title
 * @property {string} [explanation]
 * @property {string[]} [tradeoffs]
 * @property {object} changes {brief?, budget?, addTasks?, removeTaskIds?, addVendors?, addIdeas?}
 * @property {string} [request] the user's message, for chat proposals
 */

/**
 * @typedef {object} Proposal
 * @property {string} id
 * @property {string[]} warnings what Marigold adjusted or ignored
 * @property {string|null} blocked why it can't be applied, if it can't
 * @property {number} baseRev the plan revision it was made against
 * @property {string} planId
 * @property {import("./model.js").Plan} after the plan as it would be after applying
 * @property {object} diff see diffPlans()
 * @property {"pending"|"stale"} status
 */

/**
 * The plan without undo history, chat and log: the part a proposal or undo snapshot replaces.
 * @param {import("./model.js").Plan} plan
 * @returns {import("./model.js").Plan}
 */
export function corePlan(plan) {
  const copy = deepClone(plan);
  delete copy.history;
  delete copy.chat;
  delete copy.log;
  return copy;
}

/**
 * Applies a requested change to a copy of `base` and describes the result.
 * Money always adds up exactly; committed spend is never cut; past dates are refused.
 * @param {import("./model.js").Plan} base the current plan (not modified)
 * @param {ProposalSpec} spec
 * @returns {Proposal}
 */
export function makeProposal(
  base,
  { origin, kind, title, explanation, tradeoffs, changes, request },
) {
  const after = corePlan(base);
  const warnings = [];
  const itemOrigin = origin === "ai" ? "ai" : "you";

  let blocked = applyBriefChanges(base, after, changes.brief || {}, warnings);
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

/** Budget, guests, date and venue capacity: numbers and dates are range-checked. */
function applyNumericBriefChanges(after, brief, warnings) {
  if (brief.budget != null) {
    const budget = Math.round(+brief.budget);
    if (budget > 0 && budget <= MAX_AMOUNT) after.brief.budget = budget;
    else warnings.push("Ignored an invalid budget value.");
  }
  if (brief.guests != null) {
    const guests = Math.round(+brief.guests);
    if (guests >= 1 && guests <= MAX_GUESTS) after.brief.guests = guests;
    else warnings.push("Ignored an invalid guest count.");
  }
  if (brief.date != null) {
    if (parseIsoDate(brief.date)) after.brief.date = brief.date;
    else warnings.push("Ignored an invalid date.");
  }
  if ("venueCapacity" in brief) {
    const capacity = Math.round(+brief.venueCapacity);
    after.brief.venueCapacity = brief.venueCapacity != null && capacity > 0 ? capacity : null;
  }
}

/** @returns {string|null} a reason the change is blocked, if any */
function applyBriefChanges(base, after, brief, warnings) {
  applyNumericBriefChanges(after, brief, warnings);
  for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
    if (typeof brief[field] === "string") after.brief[field] = clip(brief[field], limit);
  }
  for (const [field, rule] of Object.entries(CHECKED_FIELDS)) {
    if (brief[field] == null) continue;
    if (rule.valid(brief[field])) after.brief[field] = brief[field];
    else warnings.push(rule.warning);
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
 * @returns {string|null} a reason the change is blocked, if any
 */
function applyBudgetChanges(base, after, newLines, origin, warnings) {
  const total = after.brief.budget;
  const money = (amount) => formatMoney(amount, after.brief.currency);

  if (!Array.isArray(newLines) || !newLines.length) {
    if (total === base.brief.budget) return null;
    const fit = fitToTotal(
      after.budget.map((line) => line.amount),
      after.budget.map((line) => line.committed || 0),
      total,
    );
    if (!fit.ok) return `Committed spend is more than the new budget of ${money(total)}.`;
    after.budget.forEach((line, i) => {
      line.amount = fit.amounts[i];
    });
    warnings.push("Every category was scaled in proportion; committed spend is protected.");
    return null;
  }

  const { lines, lockedIndexes } = mergeBudgetLines(after.budget, newLines, warnings);
  const raised = lines.filter((line) => (line.committed || 0) > line.amount).map((l) => l.category);
  if (raised.length) warnings.push(`Raised ${raised.join(", ")} to the amount already committed.`);

  // A small arithmetic slip from Claude is absorbed by the contingency line first, so the
  // categories Claude chose to protect stay exactly as proposed; anything larger is spread in
  // proportion.
  const proposedSum = sum(lines.map((line) => line.amount));
  const gap = total - proposedSum;
  const contingencyIndex = lines.findIndex((line) => isContingency(line.category));
  const contingency = lines[contingencyIndex];
  if (gap && contingency && contingency.amount + gap >= (contingency.committed || 0)) {
    contingency.amount += gap;
  }

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

  if (proposedSum !== total && origin === "ai") {
    const where =
      contingencyIndex >= 0 && Math.abs(gap) && lines[contingencyIndex]
        ? "in Contingency"
        : "across categories in proportion";
    warnings.push(
      `Claude's amounts added up to ${money(proposedSum)}, not ${money(total)}. ` +
        `Marigold corrected the difference of ${money(Math.abs(total - proposedSum))} ${where} ` +
        "so the total is exact.",
    );
  }
  return null;
}

/**
 * Matches proposed categories to existing lines (exact name first, then partial), keeps any
 * dropped line that has committed spend, and records which lines are locked.
 */
function mergeBudgetLines(existing, proposed, warnings) {
  const used = new Set();
  const lines = [];
  const lockedIndexes = [];
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

function addTasks(after, newTasks, daysLeft, origin, warnings) {
  let clamped = false;
  for (const task of Array.isArray(newTasks) ? newTasks : []) {
    const title = clip(task.title, 160);
    if (!title) continue;
    if (after.tasks.some((existing) => normalizeName(existing.title) === normalizeName(title))) {
      warnings.push(`Skipped duplicate task “${title}”.`);
      continue;
    }
    let offset = isNumeric(task.daysBefore) ? Math.max(0, Math.round(+task.daysBefore)) : 7;
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
      priority: PRIORITIES.includes(task.priority) ? task.priority : "medium",
      deps: [],
      done: false,
      origin,
    });
  }
  if (clamped) warnings.push("Some new tasks were moved so they aren't dated in the past.");
}

/** Removes pending tasks by id (completed tasks are never removed) and unlinks dependents. */
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

/** Adds vendors; an existing vendor with a similar category gets the new checklist items instead. */
function addVendors(after, newVendors, daysLeft, origin, warnings) {
  for (const spec of Array.isArray(newVendors) ? newVendors : []) {
    const category = clip(spec.category, 60);
    if (!category) continue;
    const key = normalizeName(category);
    const existing = after.vendors.find((vendor) => {
      const vendorKey = normalizeName(vendor.category);
      return vendorKey === key || vendorKey.includes(key) || key.includes(vendorKey);
    });
    if (existing) {
      const knownItems = new Set(existing.checklist.map((item) => normalizeName(item.text)));
      const additions = (spec.checklist || [])
        .map((text) => clip(text, 160))
        .filter((text) => text && !knownItems.has(normalizeName(text)));
      additions.forEach((text) => existing.checklist.push({ id: uid(), text, done: false }));
      const added = additions.length
        ? `; ${additions.length} checklist item${additions.length > 1 ? "s" : ""} added to it`
        : "";
      warnings.push(`${existing.category} already exists${added}.`);
    } else {
      const bookBy =
        daysLeft != null && daysLeft >= 0
          ? Math.min(+spec.bookByDaysBefore || 0, daysLeft)
          : spec.bookByDaysBefore;
      after.vendors.push(newVendor({ ...spec, bookByDaysBefore: bookBy }, after.budget, origin));
    }
  }
}

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

/** Points vendors whose budget line was removed at the closest remaining line. */
function relinkVendors(after) {
  for (const vendor of after.vendors) {
    if (vendor.lineId && !after.budget.some((line) => line.id === vendor.lineId)) {
      vendor.lineId = matchLine(vendor.category, after.budget);
    }
  }
}

/**
 * Brief fields shown in a diff: [label, formatter].
 * @param {string} currency
 */
const briefFieldLabels = (currency) => ({
  budget: ["Total budget", (v) => formatMoney(v, currency)],
  guests: ["Guests", (v) => v],
  date: ["Event date", (v) => (v ? formatDate(parseIsoDate(v)) : "none")],
  venueCapacity: ["Venue capacity", (v) => v || "not set"],
  style: ["Theme", (v) => v || "—"],
  notes: ["Priorities", (v) => v || "—"],
  name: ["Name", (v) => v],
  city: ["City", (v) => v],
  time: ["Start time", (v) => v || "—"],
  currency: ["Currency", (v) => v],
});

/**
 * Describes what changes between two versions of a plan, for the approval preview.
 * @param {import("./model.js").Plan} before
 * @param {import("./model.js").Plan} after
 * @returns {object} brief rows, budget rows, added/removed items, timeline shift and `empty`
 */
export function diffPlans(before, after) {
  const addedTo = (list, other) => list.filter((item) => !other.some((x) => x.id === item.id));
  const diff = {
    brief: [],
    budget: [],
    budgetChanged: false,
    tasksAdded: addedTo(after.tasks, before.tasks),
    tasksRemoved: addedTo(before.tasks, after.tasks),
    vendorsAdded: addedTo(after.vendors, before.vendors),
    vendorsChanged: after.vendors.filter((vendor) => {
      const old = before.vendors.find((x) => x.id === vendor.id);
      return old && old.checklist.length !== vendor.checklist.length;
    }),
    ideasAdded: addedTo(after.ideas, before.ideas),
    timeline: null,
  };

  for (const [field, [label, show]] of Object.entries(briefFieldLabels(after.brief.currency))) {
    if ((before.brief[field] ?? "") !== (after.brief[field] ?? "")) {
      diff.brief.push({ label, from: show(before.brief[field]), to: show(after.brief[field]) });
    }
  }

  const lineIds = [...new Set([...before.budget, ...after.budget].map((line) => line.id))];
  diff.budget = lineIds.map((id) => {
    const old = before.budget.find((line) => line.id === id);
    const now = after.budget.find((line) => line.id === id);
    return {
      category: (now || old).category,
      before: old ? old.amount : 0,
      after: now ? now.amount : 0,
      committed: (now || old).committed || 0,
      added: !old,
      removed: !now,
    };
  });
  diff.budgetChanged = diff.budget.some(
    (row) => row.before !== row.after || row.added || row.removed,
  );
  diff.totalBefore = sum(before.budget.map((line) => line.amount));
  diff.totalAfter = sum(after.budget.map((line) => line.amount));

  if (before.brief.date !== after.brief.date) {
    const oldDate = parseIsoDate(before.brief.date);
    const newDate = parseIsoDate(after.brief.date);
    const afterAnalysis = analyze(after);
    diff.timeline = {
      shift: oldDate && newDate ? daysBetween(oldDate, newDate) : null,
      overdueBefore: analyze(before).overdue.length,
      overdueAfter: afterAnalysis.overdue.length,
      compressed: afterAnalysis.sc.compressed,
    };
  }

  diff.empty =
    !diff.brief.length &&
    !diff.budgetChanged &&
    !diff.tasksAdded.length &&
    !diff.tasksRemoved.length &&
    !diff.vendorsAdded.length &&
    !diff.vendorsChanged.length &&
    !diff.ideasAdded.length;
  return diff;
}
