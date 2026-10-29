/**
 * @file Prompt builders. Every piece of user-typed text or plan data is wrapped with fence() so
 * Claude treats it as data, never as instructions.
 */
import { nextActions } from "../core/advisor.js";
import { pctList } from "../core/budget.js";
import { daysBetween, parseIsoDate, toIsoDate, today } from "../core/dates.js";
import { analyze } from "../core/risks.js";
import { DATA_RULE, fence } from "../core/safety.js";
import { isNumeric } from "../core/util.js";

/** How many pending tasks are listed in the plan context. */
const MAX_TASKS_IN_CONTEXT = 25;
/** How many recent chat messages are sent with each co-planner request. */
const CHAT_HISTORY_SENT = 8;

/** Rules appended to every prompt. */
const SAFETY =
  `${DATA_RULE} Never invent real business names, phone numbers, ratings, reviews, availability ` +
  "or live weather. Any cost is an approximate estimate in the event's currency, not a quote.";

/** @param {import("../core/model.js").Brief} brief */
const daysUntil = (brief) => {
  const eventDate = parseIsoDate(brief.date);
  return eventDate ? daysBetween(today(), eventDate) : null;
};

/**
 * The brief as labelled lines.
 * @param {import("../core/model.js").Brief} brief
 * @returns {string}
 */
function briefText(brief) {
  const daysLeft = daysUntil(brief);
  const when = daysLeft != null ? ` (${daysLeft} days from today, ${toIsoDate(today())})` : "";
  return [
    `Event type: ${brief.type}`,
    `Name: ${brief.name}`,
    `Date: ${brief.date || "not set"}${when}`,
    brief.time ? `Start time: ${brief.time}` : "",
    `Guests: ${brief.guests}`,
    brief.venueCapacity ? `Venue capacity: ${brief.venueCapacity}` : "",
    `Total budget: ${brief.budget} ${brief.currency}`,
    `Location: ${brief.city || "not given"}`,
    `Style/theme: ${brief.style || "open"}`,
    `Priorities and must-haves: ${brief.notes || "none"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Prompt for a complete new plan.
 * @param {import("../core/model.js").Brief} brief
 * @returns {string}
 */
export function generationPrompt(brief) {
  const daysLeft = daysUntil(brief);
  const scheduling =
    daysLeft != null
      ? `Scheduling: the event is ${daysLeft} days away. Every daysBefore and bookByDaysBefore must be between 0 and ${Math.max(daysLeft, 0)}. If time is short, compress into fewer, urgent, realistic steps.`
      : "No date is set: use typical lead times.";
  return `You are an expert event planner for weddings, birthdays and community events. Build a practical, personalised plan for this brief. Use local customs, typical vendor types and realistic proportions for the location, guest count and currency. Reflect every stated priority (diet, accessibility, sustainability, number of functions).

${fence("event_brief", briefText(brief))}

${scheduling}
${SAFETY}

Return ONLY a JSON object (no prose, no code fences) with exactly these keys:
{
 "summary": "2-3 sentences on this plan's approach, specific to the brief",
 "budget": [{"category": "string", "pct": number, "note": "one practical tip"}],
 "tasks": [{"key": "short unique id like t1", "title": "string", "phase": "short phase name", "daysBefore": integer, "priority": "high"|"medium"|"low", "dependsOn": ["keys of tasks that must finish first"]}],
 "vendors": [{"category": "vendor type", "critical": boolean, "budgetCategory": "matching budget category", "bookByDaysBefore": integer, "checklist": ["string"], "questions": ["question to ask this vendor"]}],
 "ideas": [{"title": "string", "detail": "1-2 sentences tied to the theme, city and priorities", "tag": "one word", "costLow": number, "costHigh": number}],
 "runOfShow": [{"time": "HH:MM", "item": "string", "owner": "role, not a person's name"}],
 "risks": [{"severity": "critical"|"high"|"medium"|"low", "title": "string", "why": "string", "action": "string"}]
}
Rules: 6-10 budget categories whose pct values add up to 100 and include one named "Contingency" (5-10%). 12-30 tasks across 5-8 phases ending with daysBefore 0. 5-8 vendors; mark the ones the event cannot happen without as critical. 6 ideas. 6-12 run-of-show items for the main event day. 2-5 contextual risks specific to this brief (weather season, local logistics, guest needs).`;
}

/**
 * A fenced summary of the whole plan: budget, pending tasks, vendors, ideas, risks, next actions.
 * @param {import("../core/model.js").Plan} plan
 * @returns {string}
 */
export function planContext(plan) {
  const analysis = analyze(plan);
  const { brief } = plan;
  const sched = analysis.schedule;
  /** @param {import("../core/model.js").Task} task */
  const dueOf = (task) => sched.due[task.id]?.getTime() ?? 0;
  const pcts = pctList(
    plan.budget.map((line) => line.amount),
    brief.budget,
  );
  const pending = plan.tasks
    .filter((task) => !task.done)
    .sort((a, b) => dueOf(a) - dueOf(b))
    .slice(0, MAX_TASKS_IN_CONTEXT);

  const budgetLines = plan.budget
    .map((line, i) => {
      const committed = line.committed ? `, committed ${line.committed}` : "";
      return `- ${line.category}: ${line.amount} (${pcts[i]}%)${committed}`;
    })
    .join("\n");
  const taskLines =
    pending
      .map((task) => {
        const dueDate = sched.due[task.id];
        const due = dueDate ? toIsoDate(dueDate) : "no date";
        return `- ${task.id} | ${task.title} | ${due} | ${task.priority}`;
      })
      .join("\n") || "- none";
  const vendorLines = plan.vendors
    .map((vendor) => {
      const critical = vendor.critical ? " (critical)" : "";
      const quote = isNumeric(vendor.quote) ? `, quote ${vendor.quote}` : "";
      const bookByDate = sched.vendorDue[vendor.id];
      const bookBy = bookByDate ? `, book by ${toIsoDate(bookByDate)}` : "";
      return `- ${vendor.category}${critical}: ${vendor.status}, ${vendor.payment}${quote}${bookBy}`;
    })
    .join("\n");
  const ideas = plan.ideas.map((idea) => idea.title).join("; ") || "none";
  const risks = analysis.risks.map((risk) => `${risk.sev}: ${risk.title}`).join("; ") || "none";
  const next =
    nextActions(plan, sched)
      .map((action) => `${action.title} (${action.why.join(", ")})`)
      .join("; ") || "none";
  const doneCount = plan.tasks.filter((task) => task.done).length;

  return fence(
    "plan_data",
    `${briefText(brief)}

BUDGET (total ${brief.budget} ${brief.currency}; allocations always sum exactly to the total):
${budgetLines}
Committed so far: ${analysis.committed}.

TASKS: ${doneCount} of ${plan.tasks.length} done. Pending (id | title | due | priority):
${taskLines}

VENDORS:
${vendorLines}

IDEAS ALREADY IN PLAN: ${ideas}
RULE-BASED RISKS: ${risks}
RULE-BASED NEXT ACTIONS (dependency-aware): ${next}
HEALTH SCORE: ${analysis.health.score}/100`,
  );
}

/**
 * Prompt for one co-planner turn: answer, and optionally propose a change.
 * @param {import("../core/model.js").Plan} plan
 * @param {string} message the user's new message
 * @returns {string}
 */
export function chatPrompt(plan, message) {
  const history = plan.chat
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-CHAT_HISTORY_SENT)
    .map((m) => `${m.role === "user" ? "User" : "Co-planner"}: ${m.text}`)
    .join("\n");
  return `You are Marigold, an AI event co-planner inside a planning app. You can answer questions and propose edits to the plan. The app validates your proposal, shows the user a before/after preview, and applies it only if they approve.

CURRENT PLAN
${planContext(plan)}

RECENT CONVERSATION
${fence("conversation", history || "(none)")}

NEW USER MESSAGE
${fence("user_message", message)}

Return ONLY a JSON object:
{"reply": "plain-text answer, specific and actionable, under 160 words",
 "proposal": null or {
   "title": "short name of the change",
   "explanation": "what changes and why, 1-3 sentences",
   "tradeoffs": ["each trade-off or risk of this change"],
   "changes": {
     "brief": {"budget": number, "guests": integer, "date": "YYYY-MM-DD", "style": "string", "notes": "string"}  (include only fields that change),
     "budget": [{"category": "string", "amount": number, "note": "string"}]  (omit if allocations don't change),
     "addTasks": [{"title": "string", "phase": "string", "daysBefore": integer, "priority": "high"|"medium"|"low"}],
     "removeTaskIds": ["ids from the pending task list"],
     "addVendors": [{"category": "string", "critical": boolean, "checklist": ["string"], "questions": ["string"], "bookByDaysBefore": integer}],
     "addIdeas": [{"title": "string", "detail": "string", "tag": "string", "costLow": number, "costHigh": number}]
   }}}
Rules:
- Include a proposal only when the user asks to change the plan. Questions get "proposal": null.
- If any money changes, "budget" must list EVERY category to keep, with whole-number amounts that add up EXACTLY to the total budget (the new total if brief.budget changes). Keep a Contingency line of at least 5% unless told otherwise.
- Never set a category below its committed amount, and never drop a category that has committed spend.
- Respect priorities the user states (for example "protect catering" means catering is not cut).
- When the date moves, set brief.date; task dates recalculate automatically.
- Never mark tasks done or change vendor booking/payment status. ${SAFETY}
- daysBefore must be between 0 and the days left until the event.`;
}

/**
 * Prompt for the budget optimizer.
 * @param {import("../core/model.js").Plan} plan
 * @param {{pct: number, target: number, protect: string}} goal
 * @returns {string}
 */
export function optimizerPrompt(plan, { pct, target, protect }) {
  const total = plan.brief.budget;
  const protectRule = protect
    ? `Protect what the user lists here; cut these least or not at all: ${fence("user_note", protect)}`
    : "Protect what the brief's priorities say matters most.";
  return `You are a budget optimizer for an event plan. Reduce the total planned spend by ${pct}%: from ${total} to exactly ${target} ${plan.brief.currency} (saving ${total - target}).

${planContext(plan)}

Constraints:
- Return the full new allocation. Whole numbers that add up to EXACTLY ${target}.
- No category may go below its committed amount. Keep every category that has committed spend.
- Keep a Contingency line of at least 3% of the new total.
- ${protectRule}
- ${SAFETY}
- Prefer smart substitutions (digital invites, seasonal flowers, reuse décor across functions) over across-the-board cuts.

Return ONLY JSON: {"explanation": "where the savings come from and why, 2-3 sentences", "tradeoffs": ["what the person gives up"], "budget": [{"category": "string", "amount": number, "note": "what changes in this category"}]}`;
}

/**
 * Prompt for four new ideas that don't repeat the plan's existing ones.
 * @param {import("../core/model.js").Plan} plan
 * @param {string} focus optional user focus
 * @returns {string}
 */
export function ideasPrompt(plan, focus) {
  const focusLine = focus
    ? ` Focus on what the user asks for here: ${fence("user_note", focus)}`
    : "";
  const existing = plan.ideas.map((idea) => idea.title).join("; ") || "none";
  return `Suggest 4 NEW creative, specific ideas for this event. Tie them to the city's regional customs, the theme, the budget level, the guest profile and any accessibility or sustainability needs.${focusLine}
Do not repeat or lightly reword these existing ideas: ${fence("plan_data", existing)}

${fence("event_brief", briefText(plan.brief))}

${SAFETY}
Return ONLY a JSON array: [{"title": "string", "detail": "1-2 sentences", "tag": "one word", "costLow": number, "costHigh": number}] with costs in ${plan.brief.currency}.`;
}

/**
 * Prompt for a contextual risk review beyond the rule-based checks.
 * @param {import("../core/model.js").Plan} plan
 * @returns {string}
 */
export function riskReviewPrompt(plan) {
  return `Review this event plan for contextual risks that simple rules can't see: season and climate for the city and date, local logistics and permissions, cultural timing, guest needs (elderly, children, dietary, accessibility), vendor lead times in that market, and whether the budget per guest is realistic for the location. Don't repeat the rule-based risks already listed.

${planContext(plan)}

${SAFETY}
Return ONLY JSON: {"risks": [{"severity": "critical"|"high"|"medium"|"low", "title": "string", "why": "1-2 sentences", "action": "one concrete step"}]} with 3-6 risks.`;
}
