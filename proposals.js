// Marigold — proposals.js
import { fitToTotal } from "./budget.js";
import { matchLine, newVendor } from "./model.js";
import { analyze } from "./risks.js";
import { S } from "./state.js";
import { savePlan } from "./storage.js";
import { fillForm, renderAll, renderProposal, toast } from "./ui.js";
import { $, CONT_RE, MAX_AMOUNT, clip, clone, daysBetween, fmtDate, isNum, money, norm, parseISO, safeAmount, sum, today, uid } from "./util.js";
import { PRI, validIdea } from "./validation.js";

/* ============ Proposals: preview → approve → apply, with undo ============ */
export function corePlan(p) { const c = clone(p); delete c.history; delete c.chat; delete c.log; return c; }
export function makeProposal({ origin, kind, title, explanation, tradeoffs, changes, request }) {
  const base = S.plan; const after = corePlan(base); const warnings = []; let blocked = null;
  const b = changes.brief || {};
  if (b.budget != null) { const n = Math.round(+b.budget); if (n > 0 && n <= MAX_AMOUNT) after.brief.budget = n; else warnings.push("Ignored an invalid budget value."); }
  if (b.guests != null) { const n = Math.round(+b.guests); if (n >= 1 && n <= 100000) after.brief.guests = n; else warnings.push("Ignored an invalid guest count."); }
  if (b.date != null) { if (parseISO(b.date)) after.brief.date = b.date; else warnings.push("Ignored an invalid date."); }
  if ("venueCapacity" in b) { const n = Math.round(+b.venueCapacity); after.brief.venueCapacity = b.venueCapacity != null && n > 0 ? n : null; }
  for (const k of ["style", "notes", "name", "city", "time", "type", "currency"]) if (typeof b[k] === "string") after.brief[k] = clip(b[k], k === "notes" ? 600 : 120);
  if (after.brief.currency !== base.brief.currency) warnings.push("Currency changed: amounts are relabelled, not converted.");
  const total = after.brief.budget; const cur = after.brief.currency;
  if (b.date != null && after.brief.date !== base.brief.date && parseISO(after.brief.date) && daysBetween(today(), parseISO(after.brief.date)) < 0) blocked = "The new event date is in the past.";
  if (Array.isArray(changes.budget) && changes.budget.length) {
    const used = new Set(), lines = [], lockedIdx = [];
    for (const c of changes.budget) {
      const name = clip(c.category, 60); if (!name) continue;
      const ex = after.budget.find(l => !used.has(l.id) && norm(l.category) === norm(name)) || after.budget.find(l => !used.has(l.id) && (norm(l.category).includes(norm(name)) || norm(name).includes(norm(l.category))));
      if (ex) { used.add(ex.id); lines.push({ ...ex, amount: safeAmount(c.amount) ?? 0, note: c.note ? clip(c.note, 200) : ex.note }); }
      else lines.push({ id: uid(), category: name, note: clip(c.note, 200), amount: safeAmount(c.amount) ?? 0, committed: null });
      if (c.locked) lockedIdx.push(lines.length - 1);
    }
    for (const l of after.budget) if (!used.has(l.id) && (l.committed || 0) > 0) { lines.push({ ...l }); warnings.push(`Kept “${l.category}” because it has committed spend.`); }
    const raised = lines.filter(l => (l.committed || 0) > l.amount).map(l => l.category);
    if (raised.length) warnings.push(`Raised ${raised.join(", ")} to the amount already committed.`);
    const proposedSum = sum(lines.map(l => l.amount));
    // A small arithmetic slip from Claude is absorbed by the contingency line first, so the categories
    // Claude chose to protect stay exactly as proposed; anything larger is spread in proportion.
    const gap = total - proposedSum; const ci = lines.findIndex(l => CONT_RE.test(l.category));
    if (gap && ci >= 0 && lines[ci].amount + gap >= (lines[ci].committed || 0)) lines[ci].amount += gap;
    const fit = fitToTotal(lines.map(l => l.amount), lines.map(l => l.committed || 0), total, lockedIdx);
    if (!fit.ok) blocked = `Committed spend (${money(sum(lines.map(l => l.committed || 0)), cur)}) is more than the budget of ${money(total, cur)}, so this can't be applied without cutting commitments.`;
    else {
      lines.forEach((l, i) => { l.amount = fit.amounts[i]; }); after.budget = lines;
      if (proposedSum !== total && origin === "ai") warnings.push(`Claude's amounts added up to ${money(proposedSum, cur)}, not ${money(total, cur)}. Marigold corrected the difference of ${money(Math.abs(total - proposedSum), cur)} ${ci >= 0 && Math.abs(gap) && lines[ci] ? "in Contingency" : "across categories in proportion"} so the total is exact.`);
    }
  } else if (total !== base.brief.budget) {
    const fit = fitToTotal(after.budget.map(l => l.amount), after.budget.map(l => l.committed || 0), total);
    if (!fit.ok) blocked = `Committed spend is more than the new budget of ${money(total, cur)}.`;
    else { after.budget.forEach((l, i) => { l.amount = fit.amounts[i]; }); warnings.push("Every category was scaled in proportion; committed spend is protected."); }
  }
  const evA = parseISO(after.brief.date); const dlA = evA ? daysBetween(today(), evA) : null;
  let clamped = false;
  for (const t of Array.isArray(changes.addTasks) ? changes.addTasks : []) {
    const title = clip(t.title, 160); if (!title) continue;
    if (after.tasks.some(x => norm(x.title) === norm(title))) { warnings.push(`Skipped duplicate task “${title}”.`); continue; }
    let off = isNum(t.daysBefore) ? Math.max(0, Math.round(+t.daysBefore)) : 7;
    if (dlA != null && dlA >= 0 && off > dlA) { off = dlA; clamped = true; }
    after.tasks.push({ id: uid(), title, phase: clip(t.phase, 40) || "Added", offset: off, fixedOffset: true, fixedDate: "", priority: PRI.includes(t.priority) ? t.priority : "medium", deps: [], done: false, origin: origin === "ai" ? "ai" : "you" });
  }
  if (clamped) warnings.push("Some new tasks were moved so they aren't dated in the past.");
  const rm = new Set(Array.isArray(changes.removeTaskIds) ? changes.removeTaskIds.map(String) : []);
  if (rm.size) {
    const doneHit = after.tasks.filter(t => rm.has(t.id) && t.done);
    if (doneHit.length) warnings.push("Completed tasks are never removed.");
    after.tasks = after.tasks.filter(t => !(rm.has(t.id) && !t.done));
    after.tasks.forEach(t => { t.deps = t.deps.filter(d => after.tasks.some(x => x.id === d)); });
  }
  for (const v of Array.isArray(changes.addVendors) ? changes.addVendors : []) {
    const cat = clip(v.category, 60); if (!cat) continue;
    const ex = after.vendors.find(x => norm(x.category) === norm(cat) || norm(x.category).includes(norm(cat)) || norm(cat).includes(norm(x.category)));
    if (ex) {
      const add = (v.checklist || []).map(s => clip(s, 160)).filter(s => s && !ex.checklist.some(c => norm(c.text) === norm(s)));
      add.forEach(text => ex.checklist.push({ id: uid(), text, done: false }));
      warnings.push(`${ex.category} already exists${add.length ? `; ${add.length} checklist item${add.length > 1 ? "s" : ""} added to it` : ""}.`);
    } else after.vendors.push(newVendor({ ...v, bookByDaysBefore: dlA != null && dlA >= 0 ? Math.min(+v.bookByDaysBefore || 0, dlA) : v.bookByDaysBefore }, after.budget, origin === "ai" ? "ai" : "you"));
  }
  for (const i of Array.isArray(changes.addIdeas) ? changes.addIdeas : []) {
    const iv = validIdea(i, [], "idea"); if (!iv.title || after.ideas.some(x => norm(x.title) === norm(iv.title))) continue;
    after.ideas.push({ id: uid(), ...iv, origin: origin === "ai" ? "ai" : "you" });
  }
  after.vendors.forEach(v => { if (v.lineId && !after.budget.some(l => l.id === v.lineId)) v.lineId = matchLine(v.category, after.budget); });
  after.rev = base.rev + 1;
  const diff = diffPlans(base, after);
  return { id: uid(), origin, kind, title, explanation: explanation || "", tradeoffs: tradeoffs || [], warnings, blocked, baseRev: base.rev, planId: base.id, after, diff, request, status: "pending" };
}
export function diffPlans(a, b) {
  const d = { brief: [], budget: [], budgetChanged: false, tasksAdded: [], tasksRemoved: [], vendorsAdded: [], vendorsChanged: [], ideasAdded: [], timeline: null };
  const F = { budget: ["Total budget", v => money(v, b.brief.currency)], guests: ["Guests", v => v], date: ["Event date", v => v ? fmtDate(parseISO(v)) : "none"], venueCapacity: ["Venue capacity", v => v || "not set"], style: ["Theme", v => v || "—"], notes: ["Priorities", v => v || "—"], name: ["Name", v => v], city: ["City", v => v], time: ["Start time", v => v || "—"], currency: ["Currency", v => v] };
  for (const k in F) if ((a.brief[k] ?? "") !== (b.brief[k] ?? "")) d.brief.push({ label: F[k][0], from: F[k][1](a.brief[k]), to: F[k][1](b.brief[k]) });
  const ids = [...new Set([...a.budget.map(l => l.id), ...b.budget.map(l => l.id)])];
  d.budget = ids.map(id => { const x = a.budget.find(l => l.id === id), y = b.budget.find(l => l.id === id); return { category: (y || x).category, before: x ? x.amount : 0, after: y ? y.amount : 0, committed: (y || x).committed || 0, added: !x, removed: !y }; });
  d.budgetChanged = d.budget.some(r => r.before !== r.after || r.added || r.removed);
  d.totalBefore = sum(a.budget.map(l => l.amount)); d.totalAfter = sum(b.budget.map(l => l.amount));
  d.tasksAdded = b.tasks.filter(t => !a.tasks.some(x => x.id === t.id));
  d.tasksRemoved = a.tasks.filter(t => !b.tasks.some(x => x.id === t.id));
  d.vendorsAdded = b.vendors.filter(v => !a.vendors.some(x => x.id === v.id));
  d.vendorsChanged = b.vendors.filter(v => { const x = a.vendors.find(y => y.id === v.id); return x && x.checklist.length !== v.checklist.length; });
  d.ideasAdded = b.ideas.filter(i => !a.ideas.some(x => x.id === i.id));
  if (a.brief.date !== b.brief.date) {
    const A = analyze(a), B = analyze(b); const ea = parseISO(a.brief.date), eb = parseISO(b.brief.date);
    d.timeline = { shift: ea && eb ? daysBetween(ea, eb) : null, overdueBefore: A.overdue.length, overdueAfter: B.overdue.length, compressed: B.sc.compressed };
  }
  d.empty = !d.brief.length && !d.budgetChanged && !d.tasksAdded.length && !d.tasksRemoved.length && !d.vendorsAdded.length && !d.vendorsChanged.length && !d.ideasAdded.length;
  return d;
}
export function showProposal(pr) {
  if (!pr) return;
  if (pr.diff.empty && !pr.blocked) { toast("That suggestion wouldn't change the plan, so there's nothing to approve."); return; }
  S.proposal = pr; renderProposal();
  const host = $("#proposalHost"); host.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  const h = $("#propTitle"); if (h) h.focus();
}
export function pushHistory(title) {
  S.plan.history.unshift({ title, at: Date.now(), snap: corePlan(S.plan) });
  S.plan.history = S.plan.history.slice(0, 10);
}
export function applyProposal() {
  const pr = S.proposal; if (!pr || pr.blocked || S.busy.apply) return;
  if (pr.planId !== S.plan.id || pr.baseRev !== S.plan.rev) { pr.status = "stale"; renderProposal(); return; }
  S.busy.apply = true;
  pushHistory(pr.title);
  const keep = { history: S.plan.history, chat: S.plan.chat, log: S.plan.log };
  S.plan = { ...pr.after, ...keep };
  logEntry(`Applied: ${pr.title}`, pr.origin);
  S.plan.chat.push({ role: "note", text: `Applied “${pr.title}”.`, at: Date.now() });
  S.proposal = null; S.busy.apply = false;
  fillForm(S.plan.brief); savePlan(); renderAll(); toast("Changes applied. Use Undo to reverse them.");
}
export function rejectProposal() {
  const pr = S.proposal; if (!pr) return;
  if (S.plan && pr.planId === S.plan.id) { logEntry(`Rejected: ${pr.title}`, pr.origin); S.plan.chat.push({ role: "note", text: `Rejected “${pr.title}”. Nothing changed.`, at: Date.now() }); savePlan(); }
  S.proposal = null; renderAll(); toast("Proposal rejected. Nothing changed.");
}
export function logEntry(text, origin) { S.plan.log.unshift({ text, origin: origin || "you", at: Date.now() }); S.plan.log = S.plan.log.slice(0, 40); }
/* Undo restores the plan before the last change, but keeps facts the person entered since
   (ticked tasks, recorded spend, vendor details), matched by id. */
export function undo() {
  const h = S.plan.history[0]; if (!h) return;
  const cur = S.plan, snap = clone(h.snap);
  const orphan = cur.budget.filter(l => (l.committed || 0) > 0 && !snap.budget.some(x => x.id === l.id));
  if (orphan.length) { toast(`Can't undo: you've recorded spend on “${orphan[0].category}”, which that change added. Clear that spend first.`, true); return; }
  snap.tasks.forEach(t => { const c = cur.tasks.find(x => x.id === t.id); if (c) t.done = c.done; });
  snap.budget.forEach(l => { const c = cur.budget.find(x => x.id === l.id); if (c) l.committed = c.committed; });
  snap.vendors.forEach(v => { const c = cur.vendors.find(x => x.id === v.id); if (!c) return; for (const k of ["status", "payment", "name", "contact", "estimate", "quote", "arrival", "notes", "options", "dueFixed", "lineId"]) v[k] = c[k]; v.checklist.forEach(i => { const ci = c.checklist.find(x => x.id === i.id); if (ci) i.done = ci.done; }); });
  snap.dayOf = cur.dayOf; snap.runOfShow = cur.runOfShow;
  S.plan = { ...snap, rev: cur.rev + 1, history: cur.history.slice(1), chat: cur.chat, log: cur.log };
  logEntry(`Undid: ${h.title}`);
  S.plan.chat.push({ role: "note", text: `Undid “${h.title}”.`, at: Date.now() });
  if (S.proposal) S.proposal.status = "stale";
  fillForm(S.plan.brief); savePlan(); renderAll(); toast(`Undid “${h.title}”.`);
}
/* Direct, non-financial edits by the person (still undoable). */
export function commit(title, fn, { structural = true } = {}) {
  if (structural) pushHistory(title);
  fn(S.plan);
  if (structural) { S.plan.rev++; logEntry(title); }
  savePlan(); renderAll();
}
