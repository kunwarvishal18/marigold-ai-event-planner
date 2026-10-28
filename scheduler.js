// Marigold — scheduler.js
import { addDays, daysBetween, parseISO, today } from "./util.js";

/* ============ Scheduling ============
   Tasks keep "days before the event". If the usual lead times don't fit between plan creation and
   the event, every offset is scaled down to fit. A task is never due before a task it depends on. */
export function schedule(p) {
  const t0 = today(); const ev = parseISO(p.brief.date);
  const r = { ev, today: t0, daysLeft: ev ? daysBetween(t0, ev) : null, scale: 1, compressed: false, windowDays: null, due: {}, vendorDue: {} };
  if (!ev) return r;
  const start = parseISO(p.createdOn) || t0;
  const win = daysBetween(start, ev); r.windowDays = win;
  const offs = [...p.tasks.filter(t => !t.fixedOffset && !t.fixedDate).map(t => t.offset), ...p.vendors.map(v => v.bookBy)];
  const maxOff = Math.max(0, ...offs);
  r.scale = win <= 0 ? 0 : (maxOff > win ? win / maxOff : 1);
  r.compressed = r.scale < 1;
  const at = off => addDays(ev, -Math.round((off || 0) * r.scale));
  for (const t of p.tasks) {
    r.due[t.id] = t.fixedDate ? parseISO(t.fixedDate) : t.fixedOffset ? addDays(ev, -Math.max(0, t.offset)) : at(t.offset);
  }
  for (let pass = 0; pass < p.tasks.length; pass++) {
    let changed = false;
    for (const t of p.tasks) for (const dep of t.deps || []) {
      const dd = r.due[dep];
      if (dd && r.due[t.id] && dd > r.due[t.id]) { r.due[t.id] = new Date(Math.min(+dd, +ev)); changed = true; }
    }
    if (!changed) break;
  }
  for (const v of p.vendors) r.vendorDue[v.id] = v.dueFixed ? parseISO(v.dueFixed) : at(v.bookBy);
  return r;
}


/* Depth-first search over task dependencies. Any dependency that closes a loop (A needs B, B needs A)
   is dropped, so the schedule always has a valid order. Returns how many were dropped. */
export function breakCycles(tasks) {
  const byKey = new Map(tasks.map(t => [t.key, t])), state = new Map(); let removed = 0;
  const visit = t => {
    state.set(t.key, 1);
    t.dependsOn = t.dependsOn.filter(k => {
      const st = state.get(k);
      if (st === 1) { removed++; return false; }
      if (!st) visit(byKey.get(k));
      return true;
    });
    state.set(t.key, 2);
  };
  for (const t of tasks) if (!state.get(t.key)) visit(t);
  return removed;
}
