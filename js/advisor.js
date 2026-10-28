// Marigold — advisor.js
import { STATUSES, daysBetween, isBooked } from "./util.js";

/* ============ Next best actions (deterministic, no AI) ============
   Ranks what to do next from the plan itself:
   - only tasks whose prerequisites are all done are "ready"; blocked tasks are never suggested,
     but an overdue blocked task raises the priority of the prerequisite holding it up;
   - urgency comes from the due date, importance from priority and from how many tasks each one unblocks;
   - critical vendors that aren't booked near their book-by date, and booked vendors still unpaid close
     to the event, are suggested too.
   Every item carries a plain-language reason so the user can see why it was picked. */
export function nextActions(p, sc, limit = 5) {
  const today = sc.today, byId = new Map(p.tasks.map(t => [t.id, t]));
  const pending = p.tasks.filter(t => !t.done);
  const waitingOn = t => (t.deps || []).filter(d => byId.has(d) && !byId.get(d).done);
  const unblocks = new Map(); // task id -> number of pending tasks that wait on it
  for (const t of pending) for (const d of waitingOn(t)) unblocks.set(d, (unblocks.get(d) || 0) + 1);
  const holdsUpOverdue = new Set();
  for (const t of pending) if (sc.due[t.id] && sc.due[t.id] < today) for (const d of waitingOn(t)) holdsUpOverdue.add(d);

  const out = [];
  for (const t of pending) {
    if (waitingOn(t).length) continue; // blocked: never suggested directly
    const due = sc.due[t.id], days = due ? daysBetween(today, due) : null;
    let score = 0; const why = [];
    if (days != null && days < 0) { score += 60; why.push(`overdue by ${-days} day${days === -1 ? "" : "s"}`); }
    else if (days != null && days <= 7) { score += 40; why.push(days === 0 ? "due today" : `due in ${days} day${days === 1 ? "" : "s"}`); }
    else if (days != null && days <= 30) { score += 20; why.push(`due in ${days} days`); }
    score += t.priority === "high" ? 15 : t.priority === "medium" ? 5 : 0;
    if (t.priority === "high") why.push("high priority");
    const n = unblocks.get(t.id) || 0;
    if (n) { score += Math.min(n, 5) * 3; why.push(`unblocks ${n} other task${n > 1 ? "s" : ""}`); }
    if (holdsUpOverdue.has(t.id)) { score += 25; why.push("an overdue task is waiting on it"); }
    if (score >= 20) out.push({ kind: "task", id: t.id, title: t.title, why, score, due, tab: "timeline" });
  }
  const ev = sc.ev, toEvent = ev ? daysBetween(today, ev) : null;
  for (const v of p.vendors) {
    const due = sc.vendorDue[v.id], days = due ? daysBetween(today, due) : null;
    if (v.critical && !isBooked(v) && days != null && days <= 14) {
      out.push({ kind: "vendor", id: v.id, title: `Book ${v.category}`, why: [days < 0 ? `book-by date passed ${-days} day${days === -1 ? "" : "s"} ago` : `book by ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`, "critical vendor", `stage: ${STATUSES.includes(v.status) ? v.status : "Not started"}`], score: (days < 0 ? 70 : 50) + 10, due, tab: "vendors" });
    } else if (isBooked(v) && v.payment === "Unpaid" && toEvent != null && toEvent >= 0 && toEvent <= 30) {
      out.push({ kind: "vendor", id: v.id, title: `Settle the ${v.category} deposit`, why: ["booked but unpaid", `event in ${toEvent} day${toEvent === 1 ? "" : "s"}`], score: 35, due: null, tab: "vendors" });
    }
  }
  out.sort((a, b) => b.score - a.score || (a.due && b.due ? a.due - b.due : a.due ? -1 : b.due ? 1 : 0) || a.title.localeCompare(b.title));
  return out.slice(0, limit);
}

/* Tasks that can't start yet, with the unfinished prerequisites holding each one up. */
export function blockedTasks(p) {
  const byId = new Map(p.tasks.map(t => [t.id, t]));
  return p.tasks.filter(t => !t.done).map(t => ({ task: t, waiting: (t.deps || []).map(d => byId.get(d)).filter(d => d && !d.done) })).filter(x => x.waiting.length);
}
