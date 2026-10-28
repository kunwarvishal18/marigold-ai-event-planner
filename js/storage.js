// Marigold — storage.js
import { buildPlan } from "./model.js";
import { S } from "./state.js";
import { renderSaved, toast } from "./ui.js";
import { breakCycles } from "./scheduler.js";
import { hasOwn, isNum, iso, safeAmount, store } from "./util.js";

/* ============ Persistence ============
   Plans live in localStorage under one key. Reads never throw and never erase data:
   - unreadable JSON is copied to a backup key before anything new is written;
   - if that backup can't be made, saving is switched off for the session (read-only);
   - plans written by a newer Marigold version, or that fail validation, are kept as-is but not shown. */
export const KEY = "mg2.plans", LAST = "mg2.last", PLAN_VERSION = 2;
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const storageState = { corrupt: false, backupKey: null, readOnly: false };
function quarantine(raw) {
  if (storageState.corrupt) return;
  const key = `${KEY}.corrupt-${Date.now()}`;
  storageState.corrupt = true;
  if (store.setRaw(key, raw)) storageState.backupKey = key; else storageState.readOnly = true;
}
export function allPlans() {
  const out = Object.create(null); // no prototype, so ids like "__proto__" can't reach Object.prototype
  if (storageState.readOnly) return out;
  const raw = store.raw(KEY);
  if (raw == null || raw === "") return out;
  let a; try { a = JSON.parse(raw); } catch { a = undefined; }
  if (!a || typeof a !== "object" || Array.isArray(a)) { quarantine(raw); return out; }
  for (const k of Object.keys(a)) out[k] = a[k];
  return out;
}
export function getPlan(id) { if (typeof id !== "string" || !ID_RE.test(id)) return null; const all = allPlans(); return hasOwn(all, id) ? all[id] : null; }
export function writeAll(all) {
  if (storageState.readOnly) return false;
  return store.set(KEY, all);
}
export function savePlan() {
  if (!S.plan) return;
  S.plan.updatedAt = Date.now();
  if (storageState.readOnly) { toast("Saving is paused: saved data on this device couldn't be read or backed up, so Marigold won't overwrite it. Your changes last until you close the page.", true); renderSaved(); return; }
  const all = allPlans(); all[S.plan.id] = S.plan;
  let ok = writeAll(all);
  if (!ok) { for (const p of Object.values(all)) if (p && Array.isArray(p.history)) p.history = p.history.slice(0, 2); ok = writeAll(all); }
  if (!ok) toast("Couldn't save on this device. Browser storage may be full or blocked; your changes last until you close the page.", true);
  store.set(LAST, S.plan.id);
  renderSaved();
}
/* Counts stored entries that are kept but not shown, so the UI can say so. */
export function hiddenCounts() {
  let newer = 0, invalid = 0;
  for (const p of Object.values(allPlans())) {
    if (p && typeof p === "object" && isNum(p.v) && +p.v > PLAN_VERSION) newer++;
    else if (!sanePlan(p)) invalid++;
  }
  return { newer, invalid };
}
const isObj = o => !!o && typeof o === "object" && !Array.isArray(o);
const str = (v, n) => typeof v === "string" ? v.slice(0, n) : v == null ? "" : String(v).slice(0, n);
/* Validates a stored plan and returns a cleaned copy, or null if it can't be used.
   Money becomes whole numbers in [0, MAX_AMOUNT]; task links to missing tasks or in loops are dropped. */
export function sanePlan(p) {
  if (!isObj(p) || p.v !== PLAN_VERSION || typeof p.id !== "string" || !ID_RE.test(p.id) || !isObj(p.brief)) return null;
  if (!["budget", "tasks", "vendors", "ideas"].every(k => Array.isArray(p[k]))) return null;
  const total = safeAmount(p.brief.budget); if (!total) return null;
  const q = Object.assign({ history: [], log: [], chat: [], runOfShow: [], dayOf: { contacts: [], emergency: [], weather: [] }, rev: 0 }, p);
  q.brief = { ...p.brief, budget: total, guests: Math.max(1, Math.min(100000, Math.round(+p.brief.guests) || 1)), name: str(p.brief.name, 90) || "Untitled event" };
  q.budget = p.budget.filter(isObj).map(l => ({ ...l, category: str(l.category, 60) || "Other", amount: safeAmount(l.amount) ?? 0, committed: l.committed == null ? null : safeAmount(l.committed) }));
  q.vendors = p.vendors.filter(isObj).map(v => ({ ...v, estimate: v.estimate == null ? null : safeAmount(v.estimate), quote: v.quote == null ? null : safeAmount(v.quote), checklist: Array.isArray(v.checklist) ? v.checklist.filter(isObj) : [], questions: Array.isArray(v.questions) ? v.questions.map(x => str(x, 200)) : [], options: Array.isArray(v.options) ? v.options.filter(isObj) : [] }));
  q.ideas = p.ideas.filter(isObj).map(i => ({ ...i, costLow: i.costLow == null ? null : safeAmount(i.costLow), costHigh: i.costHigh == null ? null : safeAmount(i.costHigh) }));
  const tasks = p.tasks.filter(t => isObj(t) && typeof t.id === "string");
  const ids = new Set(tasks.map(t => t.id));
  const tmp = tasks.map(t => ({ key: t.id, dependsOn: [...new Set((Array.isArray(t.deps) ? t.deps : []).filter(d => typeof d === "string" && d !== t.id && ids.has(d)))] }));
  breakCycles(tmp);
  q.tasks = tasks.map((t, i) => ({ ...t, title: str(t.title, 160), offset: Math.max(0, Math.round(+t.offset) || 0), deps: tmp[i].dependsOn }));
  for (const k of ["history", "log", "chat", "runOfShow"]) if (!Array.isArray(q[k])) q[k] = [];
  q.history = q.history.slice(0, 10);
  if (!isObj(q.dayOf)) q.dayOf = { contacts: [], emergency: [], weather: [] };
  for (const k of ["contacts", "emergency", "weather"]) if (!Array.isArray(q.dayOf[k])) q.dayOf = { ...q.dayOf, [k]: [] };
  if (!Number.isInteger(q.rev)) q.rev = 0;
  return q;
}
export function migrateV1() {
  const old = store.get("mg.plans", null); if (!old || store.get("mg2.migrated", false)) return;
  const all = allPlans();
  for (const o of Object.values(old)) {
    try {
      if (!o || !o.plan || !o.brief || o.example) continue;
      const d = { summary: o.plan.summary, budget: o.plan.budget.map(b => ({ category: b.category, pct: +b.pct || 0, note: b.note })), tasks: [], vendors: [], ideas: o.plan.ideas || [] };
      o.plan.timeline.forEach((s, i) => s.tasks.forEach((t, j) => d.tasks.push({ key: `t${i}.${j}`, title: t, phase: s.title, daysBefore: (+s.weeksBefore || 0) * 7, priority: "medium", dependsOn: [] })));
      d.vendors = o.plan.vendors.map(v => ({ category: v.category, checklist: v.checklist, questions: v.questions, bookByDaysBefore: 30 }));
      const brief = { ...o.brief, time: "", venueCapacity: null };
      const p = buildPlan(brief, d, "legacy", iso(new Date(o.savedAt || Date.now())));
      let n = 0; o.plan.timeline.forEach((s, i) => s.tasks.forEach((_, j) => { if (o.done && o.done[`t${i}.${j}`]) p.tasks[n].done = true; n++; }));
      p.budget.forEach((l, i) => { const a = o.actual && o.actual[i]; if (isNum(a)) l.committed = +a; });
      all[p.id] = p;
    } catch {}
  }
  if (writeAll(all)) store.set("mg2.migrated", true);
}
