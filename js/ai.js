// Marigold — ai.js
import { pctList } from "./budget.js";
import { DATA_RULE, MAX_REPLY_CHARS, extractJSON, fence } from "./safety.js";
import { analyze } from "./risks.js";
import { S } from "./state.js";
import { setAI } from "./ui.js";
import { daysBetween, isNum, iso, parseISO, today } from "./util.js";

/* ============ AI layer ============ */
export class AIError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
export async function aiJSON(prompt, validate, { tier = "default", signal, retries = 1 } = {}) {
  if (!S.sample) throw new AIError("unavailable", "Claude isn't connected.");
  let input = prompt, errors = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    let text;
    try { ({ text } = await S.sample(input, { modelTier: tier, signal, cache: false })); }
    catch (e) { if (e && e.code === "not_granted") setAI("declined"); throw new AIError(e?.code || "upstream_error", e?.message || "Claude request failed"); }
    const parsed = typeof text === "string" && text.length > MAX_REPLY_CHARS ? undefined : extractJSON(text);
    if (parsed === undefined) errors = [typeof text === "string" && text.length > MAX_REPLY_CHARS ? "The answer was too long." : "The answer was not valid JSON."];
    else { const r = validate(parsed, { attempt, final: attempt === retries }); if (r.ok) return r.value; errors = r.errors; }
    input = `${prompt}\n\nIMPORTANT: your previous answer was rejected by the app's validator for these reasons: ${errors.slice(0, 8).join("; ")}. Reply again with ONLY the corrected JSON object, no prose, no code fences.`;
  }
  throw new AIError("invalid_output", "Claude's answer failed validation twice.", errors);
}
export function aiErrMsg(e) {
  const c = e && e.code;
  return ({
    rate_limited: "Claude is rate-limited for you right now. Wait about a minute, then try again.",
    queue_overflow: "Too many Claude requests are waiting. Wait a moment, then try again.",
    not_granted: "Claude access was declined for this page. Reload the page to be asked again. Templates and rule-based tools still work.",
    cancelled: "Stopped. Nothing was changed.",
    invalid_output: `Claude's answer didn't pass Marigold's checks after a retry${e.details && e.details.length ? ` (${e.details.slice(0, 2).join("; ")})` : ""}. Nothing was changed. Try again.`,
    prompt_too_large: "This plan is too large to send to Claude in one request. Try a shorter message.",
    refused: "Claude declined this request. Try rephrasing it.",
    session_expired: "Your Claude session expired. Reload the page.",
    unavailable: "Claude isn't connected in this view.",
    sampling_disabled: "Claude access is turned off for this page.",
  })[c] || `Claude couldn't complete this request${c ? ` (${c})` : ""}. Nothing was changed. Try again.`;
}
export const aiOn = () => S.ai === "on" && !!S.sample;

/* ---- prompts ---- */
export function briefText(b) {
  const ev = parseISO(b.date); const dl = ev ? daysBetween(today(), ev) : null;
  return [`Event type: ${b.type}`, `Name: ${b.name}`, `Date: ${b.date || "not set"}${dl != null ? ` (${dl} days from today, ${iso(today())})` : ""}`, b.time ? `Start time: ${b.time}` : "", `Guests: ${b.guests}`, b.venueCapacity ? `Venue capacity: ${b.venueCapacity}` : "", `Total budget: ${b.budget} ${b.currency}`, `Location: ${b.city || "not given"}`, `Style/theme: ${b.style || "open"}`, `Priorities and must-haves: ${b.notes || "none"}`].filter(Boolean).join("\n");
}
export const SAFETY = `${DATA_RULE} Never invent real business names, phone numbers, ratings, reviews, availability or live weather. Any cost is an approximate estimate in the event's currency, not a quote.`;
export function genPrompt(b) {
  const ev = parseISO(b.date); const dl = ev ? daysBetween(today(), ev) : null;
  return `You are an expert event planner for weddings, birthdays and community events. Build a practical, personalised plan for this brief. Use local customs, typical vendor types and realistic proportions for the location, guest count and currency. Reflect every stated priority (diet, accessibility, sustainability, number of functions).

${fence("event_brief", briefText(b))}

${dl != null ? `Scheduling: the event is ${dl} days away. Every daysBefore and bookByDaysBefore must be between 0 and ${Math.max(dl, 0)}. If time is short, compress into fewer, urgent, realistic steps.` : "No date is set: use typical lead times."}
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
export function planContext(p) {
  const A = analyze(p), b = p.brief, cur = b.currency, sc = A.sc;
  const pcts = pctList(p.budget.map(l => l.amount), b.budget);
  const pend = p.tasks.filter(t => !t.done).sort((x, y) => (sc.due[x.id] || 0) - (sc.due[y.id] || 0)).slice(0, 25);
  return fence("plan_data", `${briefText(b)}

BUDGET (total ${b.budget} ${cur}; allocations always sum exactly to the total):
${p.budget.map((l, i) => `- ${l.category}: ${l.amount} (${pcts[i]}%)${l.committed ? `, committed ${l.committed}` : ""}`).join("\n")}
Committed so far: ${A.committed}.

TASKS: ${p.tasks.filter(t => t.done).length} of ${p.tasks.length} done. Pending (id | title | due | priority):
${pend.map(t => `- ${t.id} | ${t.title} | ${sc.due[t.id] ? iso(sc.due[t.id]) : "no date"} | ${t.priority}`).join("\n") || "- none"}

VENDORS:
${p.vendors.map(v => `- ${v.category}${v.critical ? " (critical)" : ""}: ${v.status}, ${v.payment}${isNum(v.quote) ? `, quote ${v.quote}` : ""}${sc.vendorDue[v.id] ? `, book by ${iso(sc.vendorDue[v.id])}` : ""}`).join("\n")}

IDEAS ALREADY IN PLAN: ${p.ideas.map(i => i.title).join("; ") || "none"}
RULE-BASED RISKS: ${A.risks.map(r => `${r.sev}: ${r.title}`).join("; ") || "none"}
HEALTH SCORE: ${A.health.score}/100`);
}
export function chatPrompt(p, msg) {
  const hist = p.chat.filter(m => m.role === "user" || m.role === "assistant").slice(-8).map(m => `${m.role === "user" ? "User" : "Co-planner"}: ${m.text}`).join("\n");
  return `You are Marigold, an AI event co-planner inside a planning app. You can answer questions and propose edits to the plan. The app validates your proposal, shows the user a before/after preview, and applies it only if they approve.

CURRENT PLAN
${planContext(p)}

RECENT CONVERSATION
${fence("conversation", hist || "(none)")}

NEW USER MESSAGE
${fence("user_message", msg)}

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
