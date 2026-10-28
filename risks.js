// Marigold — risks.js
import { schedule } from "./scheduler.js";
import { CONT_RE, daysBetween, fmtDate, isBooked, isNum, money, sum } from "./util.js";

/* ============ Risks + health score (deterministic) ============ */
export const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
export const REQUIRED = {
  "Wedding": [["venue", /venue|hall|banquet|palace|lawn|resort|haveli|garden/], ["caterer", /cater|food|chef|kitchen/], ["photographer", /photo|video/]],
  "Birthday": [["food or cake supplier", /cake|bak|food|cater|dessert/]],
  "Community event": [["venue or permit", /venue|permit|authority|ground|park|hall/], ["sound and stage", /sound|stage|audio|\bpa\b/], ["waste management", /waste|clean|sanitation|recycl|compost/]],
};
export function analyze(p) {
  const sc = schedule(p); const B = p.brief, cur = B.currency, total = B.budget;
  const risks = []; const add = (sev, area, title, why, action, tab) => risks.push({ sev, area, title, why, action, tab, source: "rule" });
  const alloc = sum(p.budget.map(l => l.amount)); const committed = sum(p.budget.map(l => l.committed || 0));
  const m = n => money(n, cur);
  if (alloc !== total) add("high", "budget", "Budget not fully allocated", `Categories add up to ${m(alloc)} but the budget is ${m(total)}.`, "Use the optimizer or ask the co-planner to rebalance.", "budget");
  if (committed > total) add("critical", "budget", "Committed spend exceeds the budget", `${m(committed)} committed against ${m(total)}: ${m(committed - total)} over.`, "Renegotiate or drop items, or raise the budget in Event details.", "budget");
  const overLines = p.budget.filter(l => (l.committed || 0) > l.amount);
  overLines.forEach(l => add("high", "budget", `${l.category} is over plan`, `Committed ${m(l.committed)} against ${m(l.amount)} allocated.`, "Rebalance from another category or the contingency.", "budget"));
  const cont = p.budget.filter(l => CONT_RE.test(l.category));
  const contFree = sum(cont.map(l => Math.max(0, l.amount - (l.committed || 0))));
  const contPct = total ? contFree / total * 100 : 0;
  if (!cont.length) add("medium", "budget", "No contingency reserve", "No category is set aside for surprises.", "Add a 5–10% contingency through the optimizer or the co-planner.", "budget");
  else if (contPct < 5) add(contPct < 2 ? "high" : "medium", "budget", "Contingency reserve is thin", `Unspent contingency is ${contPct.toFixed(1)}% of the budget. Many planners keep 5–10%.`, "Move money into contingency before committing more.", "budget");
  const quoteOver = p.vendors.filter(v => isNum(v.quote) && v.lineId && (() => { const l = p.budget.find(x => x.id === v.lineId); return l && +v.quote > l.amount; })());
  quoteOver.forEach(v => { const l = p.budget.find(x => x.id === v.lineId); add("medium", "budget", `${v.category} quote is above its allocation`, `Quote ${m(v.quote)} vs ${m(l.amount)} for ${l.category}.`, "Negotiate, compare another option, or rebalance.", "vendors"); });

  const minDays = { "Wedding": 30, "Birthday": 7, "Community event": 21 }[B.type] || 14;
  let overdue = [];
  if (!sc.ev) add("medium", "timeline", "No event date", "Without a date Marigold can't schedule tasks or flag overdue work.", "Add the date in Event details.", "timeline");
  else if (sc.daysLeft < 0) add("high", "timeline", "Event date has passed", `${fmtDate(sc.ev)} was ${-sc.daysLeft} days ago.`, "If the event moved, update the date in Event details.", "timeline");
  else {
    if (sc.daysLeft < minDays) add("high", "timeline", "Very short runway", `${sc.daysLeft} days left. A ${B.type.toLowerCase()} usually needs at least ${minDays} days to book key vendors.`, "Work through high-priority tasks first. Deadlines have been compressed to fit.", "timeline");
    overdue = p.tasks.filter(t => !t.done && sc.due[t.id] && sc.due[t.id] < sc.today);
    if (overdue.length) {
      const hi = overdue.filter(t => t.priority === "high").length;
      const oldest = overdue.slice().sort((a, b) => sc.due[a.id] - sc.due[b.id])[0];
      add(hi ? "high" : "medium", "timeline", `${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}`, `${hi} high priority. Oldest: “${oldest.title}”, due ${fmtDate(sc.due[oldest.id])}.`, "Finish them or ask the co-planner to reschedule.", "timeline");
    }
    if (sc.compressed) add("low", "timeline", "Timeline compressed", `Typical lead times don't fit into ${sc.windowDays} days, so every deadline was scaled to fit.`, "Book critical vendors first.", "timeline");
  }
  const vendorLate = [], vendorSoon = [];
  if (sc.ev && sc.daysLeft >= 0) for (const v of p.vendors) {
    if (!v.critical || isBooked(v)) continue;
    const d = sc.vendorDue[v.id]; if (!d) continue;
    const dl = daysBetween(sc.today, d);
    if (dl < 0) { vendorLate.push(v); add("high", "vendors", `${v.category} not booked yet`, `Book-by date was ${fmtDate(d)}. Current status: ${v.status}.`, "Contact options now and record quotes in Vendors.", "vendors"); }
    else if (dl <= 14) { vendorSoon.push(v); add("medium", "vendors", `Book ${v.category} soon`, `Book-by date ${fmtDate(d)} is ${dl} day${dl === 1 ? "" : "s"} away.`, "Shortlist and request quotes this week.", "vendors"); }
  }
  const missing = (REQUIRED[B.type] || []).filter(([, re]) => !p.vendors.some(v => re.test(v.category.toLowerCase())));
  missing.forEach(([label]) => add("high", "vendors", `No ${label} in the vendor list`, `Most ${B.type.toLowerCase()}s depend on a ${label}.`, "Ask the co-planner to add one, or add it in Vendors.", "vendors"));

  const cap = +B.venueCapacity || 0;
  if (cap) { if (B.guests > cap) add("critical", "event", "Guest count exceeds venue capacity", `${B.guests} guests for a venue that holds ${cap}.`, "Trim the list, add a second space, or change venue.", "overview"); else if (B.guests > cap * 0.9) add("medium", "event", "Venue will be near capacity", `${B.guests} of ${cap} places (${Math.round(B.guests / cap * 100)}%).`, "Check fire limits and plan seating carefully.", "overview"); }
  else if (B.guests >= 150) add("low", "event", "Venue capacity not recorded", `With ${B.guests} guests, capacity is worth confirming.`, "Add the venue capacity in Event details.", "overview");
  const text = `${B.style} ${B.notes} ${B.name}`.toLowerCase();
  const outdoor = /outdoor|garden|lawn|open[- ]air|beach|terrace|rooftop|park|festival|poolside|courtyard/.test(text) || B.type === "Community event";
  if (outdoor && !p.dayOf.weather.some(i => i.done)) add(sc.daysLeft != null && sc.daysLeft >= 0 && sc.daysLeft <= 30 ? "medium" : "low", "event", "Outdoor elements without a weather backup", "The theme or event type suggests outdoor spaces. Marigold doesn't fetch live weather.", "Work through the weather checklist on the Event day tab.", "eventday");
  const allText = (p.tasks.map(t => t.title).join(" ") + " " + p.vendors.map(v => v.category).join(" ")).toLowerCase();
  if (B.guests >= 300 && !/security|crowd|volunteer|transport|parking|shuttle|steward/.test(allText)) add("medium", "event", "No crowd or transport plan", `${B.guests} guests need parking, arrival and crowd flow planning.`, "Ask the co-planner to add crowd and transport tasks.", "timeline");
  risks.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);

  // Health score: five components x 20 points, each deduction explained.
  const comp = (name) => ({ name, max: 20, ded: [] });
  const cB = comp("Budget"), cT = comp("Timeline"), cV = comp("Vendors"), cP = comp("Task progress"), cE = comp("Event risks");
  if (alloc !== total) cB.ded.push([4, "Budget not fully allocated", "Rebalance categories"]);
  if (committed > total) cB.ded.push([10, "Committed spend is over budget", "Cut or renegotiate commitments"]);
  overLines.slice(0, 2).forEach(l => cB.ded.push([3, `${l.category} over plan`, "Rebalance or renegotiate"]));
  if (!cont.length || contPct < 5) cB.ded.push([4, "Contingency under 5%", "Top up contingency"]);
  quoteOver.slice(0, 2).forEach(v => cB.ded.push([2, `${v.category} quote above allocation`, "Negotiate or rebalance"]));
  if (!sc.ev) cT.ded.push([10, "No event date", "Add the date"]);
  else if (sc.daysLeft < 0) cT.ded.push([20, "Event date has passed", "Update the date"]);
  else {
    if (sc.daysLeft < minDays) cT.ded.push([6, "Very short runway", "Prioritise critical tasks"]);
    overdue.slice(0, 8).forEach(t => cT.ded.push([t.priority === "high" ? 3 : 2, `Overdue: ${t.title}`, "Complete or reschedule"]));
  }
  vendorLate.forEach(v => cV.ded.push([6, `${v.category} past its book-by date`, "Book it now"]));
  vendorSoon.forEach(v => cV.ded.push([2, `${v.category} due to be booked soon`, "Request quotes this week"]));
  missing.forEach(([label]) => cV.ded.push([5, `No ${label}`, "Add this vendor"]));
  const dueTasks = sc.ev ? p.tasks.filter(t => sc.due[t.id] && sc.due[t.id] < sc.today) : [];
  if (dueTasks.length) { const doneDue = dueTasks.filter(t => t.done).length; const lost = Math.round(20 - 20 * doneDue / dueTasks.length); if (lost) cP.ded.push([lost, `${doneDue} of ${dueTasks.length} tasks due before today are done`, "Tick off finished tasks in Timeline"]); }
  const evPts = { critical: 10, high: 6, medium: 3, low: 1 };
  risks.filter(r => r.area === "event").forEach(r => cE.ded.push([evPts[r.sev], r.title, r.action]));
  const comps = [cB, cT, cV, cP, cE].map(c => {
    let left = c.max; const ded = [];
    for (const [pts, reason, action] of c.ded) { const take = Math.min(pts, left); if (take <= 0) break; left -= take; ded.push({ pts: take, reason, action }); }
    return { ...c, ded, got: left };
  });
  if (!dueTasks.length) comps[3].note = sc.ev ? "No tasks are due yet." : "Add a date to measure progress.";
  return { sc, risks, health: { score: sum(comps.map(c => c.got)), comps }, alloc, committed, overdue, contPct };
}
