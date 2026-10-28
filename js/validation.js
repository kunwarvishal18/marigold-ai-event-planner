// Marigold — validation.js
import { SEV_RANK } from "./risks.js";
import { breakCycles } from "./scheduler.js";
import { CONT_RE, MAX_AMOUNT, clip, isNum, parseISO, sum } from "./util.js";

/* ---- validators ---- */
export const PRI = ["high", "medium", "low"];
export function vStr(o, k, n, errs, path, req = true) { const s = clip(o && o[k], n); if (req && !s) errs.push(`${path}.${k} must be a non-empty string`); return s; }
export function vArr(o, k, errs, path, min, max) { const a = o && o[k]; if (!Array.isArray(a)) { errs.push(`${path}.${k} must be an array`); return []; } if (a.length < min) errs.push(`${path}.${k} needs at least ${min} items (got ${a.length})`); return a.slice(0, max); }
/* Dependencies that point at unknown tasks, or that form a loop, are sent back to Claude for a corrected
   answer. Only on the final attempt are they repaired in code (dropped), and the repair is reported. */
export function validateGen(o, daysLeft, { final = true } = {}) {
  const errs = []; if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, errors: ["Top level must be a JSON object"] };
  const out = { summary: vStr(o, "summary", 700, errs, "root") };
  out.budget = vArr(o, "budget", errs, "root", 4, 14).map((b, i) => ({ category: vStr(b, "category", 60, errs, `budget[${i}]`), pct: isNum(b && b.pct) && +b.pct >= 0 && +b.pct <= 100 ? +b.pct : (errs.push(`budget[${i}].pct must be a number from 0 to 100`), 0), note: clip(b && b.note, 200) }));
  if (out.budget.length && sum(out.budget.map(b => b.pct)) <= 0) errs.push("budget pct values must add up to more than 0");
  if (out.budget.length && !out.budget.some(b => CONT_RE.test(b.category))) errs.push('budget must include a "Contingency" category');
  const keys = new Set();
  out.tasks = vArr(o, "tasks", errs, "root", 6, 60).map((t, i) => {
    let key = clip(t && t.key, 30) || "t" + i; while (keys.has(key)) key += "_"; keys.add(key);
    const d = isNum(t && t.daysBefore) ? Math.max(0, Math.round(+t.daysBefore)) : (errs.push(`tasks[${i}].daysBefore must be an integer`), 0);
    return { key, title: vStr(t, "title", 160, errs, `tasks[${i}]`), phase: clip(t && t.phase, 40), daysBefore: daysLeft != null && daysLeft >= 0 ? Math.min(d, Math.max(daysLeft, 0)) : d, priority: PRI.includes(t && t.priority) ? t.priority : "medium", dependsOn: Array.isArray(t && t.dependsOn) ? t.dependsOn.map(String) : [] };
  });
  const unknown = new Set();
  out.tasks.forEach(t => { t.dependsOn = [...new Set(t.dependsOn.filter(k => { const ok = keys.has(k) && k !== t.key; if (!ok) unknown.add(k); return ok; }))]; });
  if (unknown.size && !final) errs.push(`tasks[].dependsOn must only use keys of tasks in this plan; unknown: ${[...unknown].slice(0, 5).join(", ")}`);
  out.unknownDepsRemoved = unknown.size;
  out.cyclesRemoved = breakCycles(out.tasks);
  if (out.cyclesRemoved && !final) errs.push(`tasks[].dependsOn contains ${out.cyclesRemoved} circular dependenc${out.cyclesRemoved > 1 ? "ies" : "y"}; a task can't depend on itself through other tasks`);
  out.vendors = vArr(o, "vendors", errs, "root", 3, 15).map((v, i) => {
    const checklist = Array.isArray(v && v.checklist) ? v.checklist.map(s => clip(s, 160)).filter(Boolean) : [];
    if (!checklist.length) errs.push(`vendors[${i}].checklist must have at least one item`);
    return { category: vStr(v, "category", 60, errs, `vendors[${i}]`), critical: !!(v && v.critical), budgetCategory: clip(v && v.budgetCategory, 60), bookByDaysBefore: isNum(v && v.bookByDaysBefore) ? Math.max(0, Math.round(+v.bookByDaysBefore)) : 30, checklist, questions: Array.isArray(v && v.questions) ? v.questions.map(s => clip(s, 200)).filter(Boolean).slice(0, 6) : [] };
  });
  out.ideas = vArr(o, "ideas", errs, "root", 3, 10).map((x, i) => validIdea(x, errs, `ideas[${i}]`));
  out.runOfShow = Array.isArray(o.runOfShow) ? o.runOfShow.filter(r => r && /^\d{1,2}:\d{2}$/.test(String(r.time || "").trim()) && clip(r.item, 120)).slice(0, 20).map(r => ({ time: String(r.time).trim().padStart(5, "0"), item: clip(r.item, 120), owner: clip(r.owner, 60) })) : [];
  out.risks = validRisks(o.risks);
  return errs.length ? { ok: false, errors: errs } : { ok: true, value: out };
}
export function validIdea(x, errs, path) {
  const cap = v => isNum(v) ? Math.min(MAX_AMOUNT, Math.max(0, Math.round(+v))) : null;
  let lo = cap(x && x.costLow), hi = cap(x && x.costHigh);
  if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
  return { title: vStr(x, "title", 90, errs, path), detail: vStr(x, "detail", 320, errs, path), tag: clip(x && x.tag, 24) || "Idea", costLow: lo, costHigh: hi };
}
export function validRisks(a) {
  if (!Array.isArray(a)) return [];
  return a.filter(r => r && SEV_RANK[String(r.severity || "").toLowerCase()] != null && clip(r.title, 100)).slice(0, 8).map(r => ({ sev: String(r.severity).toLowerCase(), title: clip(r.title, 100), why: clip(r.why, 300), action: clip(r.action, 240), source: "ai" }));
}
export function validateChat(o) {
  const errs = []; if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, errors: ["Top level must be a JSON object"] };
  const reply = clip(o.reply, 2500); if (!reply) errs.push('"reply" must be a non-empty string');
  let proposal = null;
  if (o.proposal) {
    const p = o.proposal, c = p.changes;
    if (!c || typeof c !== "object" || Array.isArray(c)) errs.push("proposal.changes must be an object");
    else {
      if (c.brief != null && (typeof c.brief !== "object" || Array.isArray(c.brief))) errs.push("changes.brief must be an object");
      if (c.brief && c.brief.date != null && !parseISO(c.brief.date)) errs.push("changes.brief.date must be YYYY-MM-DD");
      if (c.brief && c.brief.budget != null && !(isNum(c.brief.budget) && +c.brief.budget > 0 && +c.brief.budget <= MAX_AMOUNT)) errs.push("changes.brief.budget must be a positive number up to 1e12");
      if (c.brief && c.brief.guests != null && !(isNum(c.brief.guests) && +c.brief.guests >= 1)) errs.push("changes.brief.guests must be a positive integer");
      if (c.budget != null) {
        if (!Array.isArray(c.budget) || !c.budget.length) errs.push("changes.budget must be a non-empty array or omitted");
        else c.budget.forEach((b, i) => { if (!clip(b && b.category, 60)) errs.push(`changes.budget[${i}].category missing`); if (!(isNum(b && b.amount) && +b.amount >= 0 && +b.amount <= MAX_AMOUNT)) errs.push(`changes.budget[${i}].amount must be a number from 0 to 1e12`); });
      }
      for (const k of ["addTasks", "removeTaskIds", "addVendors", "addIdeas"]) if (c[k] != null && !Array.isArray(c[k])) errs.push(`changes.${k} must be an array`);
      (Array.isArray(c.addTasks) ? c.addTasks : []).forEach((t, i) => { if (!clip(t && t.title, 160)) errs.push(`addTasks[${i}].title missing`); });
      (Array.isArray(c.addVendors) ? c.addVendors : []).forEach((v, i) => { if (!clip(v && v.category, 60)) errs.push(`addVendors[${i}].category missing`); });
    }
    proposal = { title: clip(p.title, 90) || "Proposed change", explanation: clip(p.explanation, 700), tradeoffs: (Array.isArray(p.tradeoffs) ? p.tradeoffs : []).map(t => clip(t, 260)).filter(Boolean).slice(0, 6), changes: c };
  }
  return errs.length ? { ok: false, errors: errs } : { ok: true, value: { reply, proposal } };
}
export function validateBudgetOpt(o) {
  const errs = []; if (!o || typeof o !== "object") return { ok: false, errors: ["Top level must be a JSON object"] };
  const explanation = vStr(o, "explanation", 700, errs, "root");
  const budget = vArr(o, "budget", errs, "root", 2, 16).map((b, i) => { if (!clip(b && b.category, 60)) errs.push(`budget[${i}].category missing`); if (!(isNum(b && b.amount) && +b.amount >= 0 && +b.amount <= MAX_AMOUNT)) errs.push(`budget[${i}].amount must be a number from 0 to 1e12`); return { category: clip(b && b.category, 60), amount: +b.amount || 0, note: clip(b && b.note, 200) }; });
  const tradeoffs = (Array.isArray(o.tradeoffs) ? o.tradeoffs : []).map(t => clip(t, 260)).filter(Boolean).slice(0, 6);
  return errs.length ? { ok: false, errors: errs } : { ok: true, value: { explanation, budget, tradeoffs } };
}
