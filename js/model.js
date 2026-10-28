// Marigold — model.js
import { fitToTotal } from "./budget.js";
import { EMERGENCY, WEATHER, templateData } from "./templates.js";
import { clip, isNum, iso, norm, sum, today, uid } from "./util.js";

/* ============ Plan model ============ */
export function matchLine(name, budget) {
  const words = norm(name).split(" ").filter(w => w.length > 2).map(w => w.slice(0, 5));
  let best = null, score = 0;
  for (const l of budget) {
    const lw = norm(l.category).split(" ").map(w => w.slice(0, 5));
    const s = words.filter(w => lw.includes(w)).length;
    if (s > score) { score = s; best = l.id; }
  }
  return best;
}
export function newVendor(v, budget, origin) {
  return {
    id: uid(), category: clip(v.category, 60), critical: !!v.critical, origin,
    lineId: matchLine(v.budgetCategory || v.category, budget) || matchLine(v.category, budget),
    bookBy: Math.max(0, Math.round(+v.bookByDaysBefore || 0)), dueFixed: "",
    checklist: (v.checklist || []).map(t => ({ id: uid(), text: clip(t, 160), done: false })).filter(c => c.text),
    questions: (v.questions || []).map(q => clip(q, 200)).filter(Boolean),
    status: "Not started", payment: "Unpaid", name: "", contact: "", estimate: null, quote: null, arrival: "", notes: "", options: [],
  };
}
export function buildPlan(brief, d, source, createdOn) {
  const p = {
    v: 2, id: uid(), source, createdOn: createdOn || iso(today()), createdAt: Date.now(), updatedAt: Date.now(), rev: 0,
    brief: { ...brief }, summary: clip(d.summary, 700),
    budget: [], tasks: [], vendors: [], ideas: [], runOfShow: [], aiRisks: null,
    dayOf: { contacts: [], emergency: EMERGENCY.map(text => ({ id: uid(), text, done: false })), weather: WEATHER.map(text => ({ id: uid(), text, done: false })) },
    history: [], log: [], chat: [],
  };
  const total = brief.budget; const ps = sum(d.budget.map(b => b.pct)) || 1;
  const fit = fitToTotal(d.budget.map(b => b.pct / ps * total), d.budget.map(() => 0), total);
  p.budget = d.budget.map((b, i) => ({ id: uid(), category: clip(b.category, 60), note: clip(b.note, 200), amount: fit.amounts[i], committed: null }));
  const keyMap = {}; d.tasks.forEach(t => { keyMap[t.key] = uid(); });
  p.tasks = d.tasks.map(t => ({ id: keyMap[t.key], title: clip(t.title, 160), phase: clip(t.phase, 40) || "Planning", offset: t.daysBefore, fixedOffset: false, fixedDate: "", priority: t.priority, deps: (t.dependsOn || []).map(k => keyMap[k]).filter(Boolean), done: false, origin: source === "ai" ? "ai" : "template" }));
  p.vendors = d.vendors.map(v => newVendor(v, p.budget, source === "ai" ? "ai" : "template"));
  p.ideas = d.ideas.map(i => ({ id: uid(), title: clip(i.title, 90), detail: clip(i.detail, 320), tag: clip(i.tag, 24) || "Idea", costLow: isNum(i.costLow) ? Math.round(+i.costLow) : null, costHigh: isNum(i.costHigh) ? Math.round(+i.costHigh) : null, origin: source === "ai" ? "ai" : "template" }));
  p.runOfShow = (d.runOfShow && d.runOfShow.length ? d.runOfShow : templateData(brief.type).runOfShow).map(r => ({ id: uid(), time: r.time, item: clip(r.item, 120), owner: clip(r.owner, 60) }));
  if (d.risks && d.risks.length) p.aiRisks = { at: Date.now(), rev: 0, items: d.risks };
  return p;
}
