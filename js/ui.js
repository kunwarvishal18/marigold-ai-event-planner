// Marigold — ui.js
import { aiOn } from "./ai.js";
import { aiRiskReview, createTemplate, generate, moreIdeas, optimize, sendChat } from "./app.js";
import { pctList } from "./budget.js";
import { buildCSV, exportFile } from "./export.js";
import { newVendor } from "./model.js";
import { applyProposal, commit, makeProposal, rejectProposal, showProposal } from "./proposals.js";
import { analyze } from "./risks.js";
import { S } from "./state.js";
import { allPlans, hiddenCounts, sanePlan, savePlan, storageState } from "./storage.js";
import { $, $$, CONT_RE, DAY, MAX_AMOUNT, PAYMENTS, STATUSES, clip, daysBetween, esc, fmtDate, fmtShort, isBooked, isNum, iso, money, norm, parseISO, safeAmount, sum, today, uid } from "./util.js";

/* ============ Rendering ============ */
export function setAI(state) {
  S.ai = state;
  const dot = $("#aiDot"), t = $("#aiText");
  dot.className = "dot" + (state === "on" ? " on" : state === "checking" ? "" : " off");
  t.textContent = { checking: "Checking Claude connection…", on: "Claude connected", off: "Template mode: Claude isn't available here", declined: "Template mode: Claude access declined" }[state];
}
export const tabs = ["overview", "budget", "timeline", "vendors", "ideas", "eventday", "chat"];
let toastTimer;
export function toast(msg, err) { const t = $("#toast"); t.setAttribute("role", err ? "alert" : "status"); t.setAttribute("aria-live", err ? "assertive" : "polite"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, err ? 7000 : 4000); }
export function sourceBadge(src) { return { ai: '<span class="badge ai">AI generated</span>', template: '<span class="badge tpl">Template plan</span>', example: '<span class="badge tpl ex">Example data · template</span>', legacy: '<span class="badge tpl">Imported from earlier version</span>' }[src] || ""; }
export function originBadge(o) { return o === "ai" ? '<span class="badge ai">AI</span>' : o === "you" ? '<span class="badge">Added by you</span>' : o === "rule" ? '<span class="badge rule">Rule-based</span>' : '<span class="badge tpl">Template</span>'; }

export function renderAll() {
  const has = !!S.plan;
  $("#layout").classList.toggle("has-plan", has);
  $("#welcome").hidden = has; $("#planView").hidden = !has;
  renderForm(); renderSaved();
  if (!has) return;
  const p = S.plan, A = analyze(p), b = p.brief;
  $("#badges").innerHTML = sourceBadge(p.source) + (p.log.some(l => l.text.startsWith("Applied")) ? ' <span class="badge">Edited with approvals</span>' : "");
  $("#pType").textContent = `${b.type}${b.city ? " · " + b.city : ""}${b.date ? " · " + fmtDate(parseISO(b.date)) : ""}`;
  $("#pTitle").textContent = b.name;
  $("#pSummary").textContent = p.summary || (p.source === "ai" ? "" : "A starter plan built from Marigold's standard template for this event type. Generate with AI to personalise it to your brief.");
  const u = $("#undoBtn"); u.disabled = !p.history.length; u.textContent = p.history.length ? `Undo: ${p.history[0].title}` : "Undo"; u.title = u.textContent;
  const booked = p.vendors.filter(isBooked).length;
  const done = p.tasks.filter(t => t.done).length;
  $("#stats").innerHTML = [
    [A.sc.daysLeft == null ? "—" : A.sc.daysLeft >= 0 ? A.sc.daysLeft : "Passed", "days to go"],
    [`${A.health.score}/100`, "health score"],
    [money(b.budget), `budget · ${money(b.budget / Math.max(1, b.guests))}/guest`],
    [`${done}/${p.tasks.length}`, "tasks done"],
    [`${booked}/${p.vendors.length}`, "vendors booked"],
  ].map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
  const crit = A.risks.filter(r => r.sev === "critical" || r.sev === "high").length;
  $("#tab-overview").innerHTML = `Overview${crit ? `<span class="count" aria-label="${crit} high or critical risks">${crit}</span>` : ""}`;
  $$("#tabs [role=tab]").forEach(t => { const on = t.dataset.tab === S.tab; t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1; });
  tabs.forEach(t => { $("#panel-" + t).hidden = t !== S.tab; });
  // Only the visible panel is rebuilt; the others render when their tab is opened.
  renderProposal();
  ({ overview: () => renderOverview(A), budget: () => renderBudget(A), timeline: () => renderTimeline(A), vendors: () => renderVendors(A), ideas: () => renderIdeas(), eventday: () => renderEventDay(A), chat: () => renderChat() })[S.tab]();
  renderExport();
}

export function renderForm() {
  const edit = S.mode === "edit" && S.plan;
  $("#formTitle").textContent = edit ? "Event details" : "New event";
  $("#newEventBtn").hidden = !S.plan;
  const busy = !!S.busy.gen;
  $("#formBtns").innerHTML = edit
    ? `<button class="btn" type="submit" id="reviewBtn">Review changes</button><button class="btn ghost" type="button" id="regenBtn" ${aiOn() && !busy ? "" : "disabled"}>${busy ? "Generating…" : "Fresh AI plan"}</button>${busy ? '<button class="btn ghost small" type="button" id="stopGen">Stop</button>' : ""}`
    : `<button class="btn" type="submit" id="genBtn" ${busy ? "disabled" : ""}>${busy ? "Generating…" : aiOn() ? "Generate plan with AI" : "Create template plan"}</button>${aiOn() && !busy ? '<button class="btn ghost" type="button" id="tplBtn">Use template instead</button>' : ""}${busy ? '<button class="btn ghost small" type="button" id="stopGen">Stop</button>' : ""}`;
  $("#regenBtn")?.addEventListener("click", () => generate(true));
  $("#tplBtn")?.addEventListener("click", () => createTemplate());
  $("#stopGen")?.addEventListener("click", () => S.ctl.gen?.abort());
}
export function fillForm(b) {
  S.type = b.type;
  $$("#types button").forEach(x => x.setAttribute("aria-pressed", x.dataset.type === b.type));
  $("#f-name").value = b.name || ""; $("#f-date").value = b.date || ""; $("#f-time").value = b.time || "";
  $("#f-guests").value = b.guests ?? ""; $("#f-cap").value = b.venueCapacity ?? ""; $("#f-budget").value = b.budget ?? "";
  $("#f-cur").value = b.currency || "INR"; $("#f-city").value = b.city || ""; $("#f-style").value = b.style || ""; $("#f-notes").value = b.notes || "";
  clearErrors();
}
export function readForm() {
  const n = id => { const v = $(id).value.trim(); return v === "" ? null : +v; };
  return { type: S.type, name: clip($("#f-name").value, 90), date: $("#f-date").value, time: $("#f-time").value, guests: n("#f-guests"), venueCapacity: n("#f-cap"), budget: n("#f-budget"), currency: $("#f-cur").value, city: clip($("#f-city").value, 80), style: clip($("#f-style").value, 120), notes: clip($("#f-notes").value, 600) };
}
export function clearErrors() { for (const k of ["name", "date", "guests", "budget"]) { $("#e-" + k).hidden = true; $("#f-" + k).removeAttribute("aria-invalid"); } }
export function validateBrief(b, editing) {
  const e = {};
  if (!b.name) e.name = "Give the event a name.";
  if (b.guests == null || !Number.isInteger(b.guests) || b.guests < 1 || b.guests > 100000) e.guests = "Guests must be a whole number from 1 to 100,000.";
  if (b.budget == null || !(b.budget > 0) || b.budget > 1e12) e.budget = "Enter a budget greater than 0.";
  if (b.date) { const d = parseISO(b.date); if (!d) e.date = "Enter a valid date."; else if (daysBetween(today(), d) < 0 && (!editing || b.date !== S.plan.brief.date)) e.date = "That date has passed. Pick today or a future date."; }
  if (b.venueCapacity != null && !(b.venueCapacity >= 1)) e.guests = (e.guests ? e.guests + " " : "") + "Venue capacity must be at least 1.";
  clearErrors();
  for (const [k, msg] of Object.entries(e)) { const el = $("#e-" + k); el.textContent = msg; el.hidden = false; $("#f-" + k).setAttribute("aria-invalid", "true"); }
  const first = Object.keys(e)[0]; if (first) $("#f-" + first).focus();
  return !first;
}

export function renderSaved() {
  const all = Object.values(allPlans()).map(sanePlan).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
  const box = $("#savedList");
  const h = hiddenCounts(), st = storageState;
  const notes = [
    st.corrupt ? (st.backupKey ? `Saved data on this device couldn't be read. A copy was kept in browser storage under "${st.backupKey}" before anything new was saved.` : "Saved data on this device couldn't be read or backed up, so saving is paused to avoid overwriting it.") : "",
    h.newer ? `${h.newer} plan${h.newer > 1 ? "s were" : " was"} saved by a newer version of Marigold. ${h.newer > 1 ? "They are" : "It is"} kept unchanged but not shown.` : "",
    h.invalid ? `${h.invalid} saved entr${h.invalid > 1 ? "ies" : "y"} couldn't be read and ${h.invalid > 1 ? "are" : "is"} kept unchanged but not shown.` : "",
  ].filter(Boolean).map(t => `<p class="field-err" role="alert">${esc(t)}</p>`).join("");
  if (!all.length) { box.innerHTML = notes + '<p class="hint">No saved plans yet. Plans save automatically once created.</p>'; return; }
  box.innerHTML = notes + all.map(p => `<div class="saved-item"><button type="button" class="linkbtn" data-open="${esc(p.id)}" ${S.plan && S.plan.id === p.id ? 'aria-current="true"' : ""}>${esc(p.brief.name)}</button><span class="btnrow"><small>${p.source === "ai" ? "AI" : p.source === "example" ? "Example" : "Template"}</small><button type="button" class="iconbtn" data-del="${esc(p.id)}" aria-label="Delete ${esc(p.brief.name)}">Delete</button></span></div>`).join("");
}

export function renderProposal() {
  const host = $("#proposalHost"); const pr = S.proposal;
  if (!pr || !S.plan || pr.planId !== S.plan.id) { host.innerHTML = ""; return; }
  const d = pr.diff, cur = pr.after.brief.currency; const m = n => money(n, cur);
  const stale = pr.status === "stale";
  const budgetTbl = d.budgetChanged ? `<div class="tablewrap"><table><caption class="sr">Budget before and after</caption><thead><tr><th>Category</th><th class="num">Before</th><th class="num">After</th><th class="num">Change</th></tr></thead><tbody>${d.budget.map(r => { const ch = r.after - r.before; return `<tr><td>${esc(r.category)}${r.added ? ' <span class="badge">new</span>' : ""}${r.removed ? ' <span class="badge">removed</span>' : ""}${r.committed ? `<div class="note">${m(r.committed)} committed, protected</div>` : ""}</td><td class="num">${m(r.before)}</td><td class="num">${m(r.after)}</td><td class="num ${ch > 0 ? "diff-up" : ch < 0 ? "diff-down" : ""}">${ch > 0 ? "+" : ""}${ch ? m(ch) : "—"}</td></tr>`; }).join("")}</tbody><tfoot><tr><th>Total</th><th class="num">${m(d.totalBefore)}</th><th class="num">${m(d.totalAfter)}</th><th class="num">${d.totalAfter - d.totalBefore ? m(d.totalAfter - d.totalBefore) : "—"}</th></tr></tfoot></table></div><p class="note">After: ${pctList(pr.after.budget.map(l => l.amount), pr.after.brief.budget).reduce((a, b) => a + b, 0).toFixed(1)}% allocated, ${m(d.totalAfter)} of ${m(pr.after.brief.budget)}.</p>` : "";
  const list = (label, items) => items.length ? `<div><span class="lbl">${label}</span><ul>${items.map(x => `<li>${x}</li>`).join("")}</ul></div>` : "";
  host.innerHTML = `<section class="proposal" aria-labelledby="propTitle">
    <div class="badges">${pr.origin === "ai" ? '<span class="badge ai">AI proposal</span>' : '<span class="badge rule">Rule-based proposal</span>'}<span class="badge">Needs your approval</span></div>
    <h3 id="propTitle" tabindex="-1">${esc(pr.title)}</h3>
    ${pr.explanation ? `<p style="margin:0">${esc(pr.explanation)}</p>` : ""}
    ${pr.blocked ? `<div class="callout err"><b>Can't apply.</b> ${esc(pr.blocked)}</div>` : ""}
    ${stale ? '<div class="callout err"><b>Out of date.</b> The plan changed after this was proposed. Reject it and ask again.</div>' : ""}
    ${pr.warnings.length ? `<div class="callout warn"><b>Marigold's checks:</b><ul>${pr.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    ${d.brief.length ? `<div class="tablewrap"><table><thead><tr><th>Detail</th><th>Before</th><th>After</th></tr></thead><tbody>${d.brief.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.from)}</td><td><b>${esc(r.to)}</b></td></tr>`).join("")}</tbody></table></div>` : ""}
    ${budgetTbl}
    ${d.timeline ? `<div class="callout info">Timeline: every date ${d.timeline.shift == null ? "is recalculated" : `moves ${Math.abs(d.timeline.shift)} days ${d.timeline.shift < 0 ? "earlier" : "later"}`}. Overdue tasks: ${d.timeline.overdueBefore} → ${d.timeline.overdueAfter}${d.timeline.compressed ? ". Deadlines are compressed to fit the time left." : "."}</div>` : ""}
    ${list("Tasks added", d.tasksAdded.map(t => `${esc(t.title)} <span class="pri ${t.priority}">${t.priority}</span>`))}
    ${list("Tasks removed", d.tasksRemoved.map(t => esc(t.title)))}
    ${list("Vendors added", d.vendorsAdded.map(v => `${esc(v.category)}${v.critical ? " (critical)" : ""}: ${v.checklist.length} checklist items`))}
    ${list("Vendor checklists updated", d.vendorsChanged.map(v => esc(v.category)))}
    ${list("Ideas added", d.ideasAdded.map(i => esc(i.title)))}
    ${pr.tradeoffs.length ? list("Trade-offs", pr.tradeoffs.map(esc)) : ""}
    <div class="btnrow"><button class="btn" type="button" id="applyBtn" ${pr.blocked || stale ? "disabled" : ""}>Apply changes</button><button class="btn ghost" type="button" id="rejectBtn">Reject</button></div>
  </section>`;
  $("#applyBtn").addEventListener("click", applyProposal);
  $("#rejectBtn").addEventListener("click", rejectProposal);
}

export function dial(score, band) {
  const r = 46, c = 2 * Math.PI * r, col = band === "On track" ? "var(--good)" : band === "Needs attention" ? "var(--accent)" : "var(--rose)";
  return `<svg width="112" height="112" viewBox="0 0 112 112" role="img" aria-label="Health score ${score} out of 100"><circle cx="56" cy="56" r="${r}" fill="none" stroke="var(--sunk)" stroke-width="10"/><circle cx="56" cy="56" r="${r}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(score / 100 * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 56 56)"/></svg>`;
}
export function riskItem(r) {
  return `<li class="risk ${r.sev}"><div class="risk-top"><span class="sev ${r.sev}">${r.sev}</span><b>${esc(r.title)}</b>${r.source === "ai" ? '<span class="badge ai">AI insight</span>' : ""}</div><p>${esc(r.why)}</p><p class="act">Do this: ${esc(r.action)}${r.tab ? ` <button type="button" class="linkbtn" data-goto="${r.tab}">Open ${r.tab === "eventday" ? "Event day" : r.tab}</button>` : ""}</p></li>`;
}
export function renderOverview(A) {
  const p = S.plan, sc = A.sc;
  const next = p.tasks.filter(t => !t.done && sc.due[t.id]).sort((a, b) => sc.due[a.id] - sc.due[b.id]).slice(0, 5);
  // The label never says "On track" while a critical or high risk is open.
  const hasCrit = A.risks.some(r => r.sev === "critical"), hasHigh = A.risks.some(r => r.sev === "high");
  const band = hasCrit || A.health.score < 60 ? "At risk" : hasHigh || A.health.score < 80 ? "Needs attention" : "On track";
  const ai = p.aiRisks;
  $("#panel-overview").innerHTML = `
  <div class="ov-grid">
    <div class="card">
      <h2>Event health</h2>
      <div class="dial">${dial(A.health.score, band)}<div><div class="big">${A.health.score}</div><div class="note">out of 100 · ${band}</div></div></div>
      <div class="comp">${A.health.comps.map(c => `<div class="comp-row"><span>${c.name}</span><span>${c.got}/${c.max}</span><div class="bar"><i class="${c.got >= 16 ? "good" : c.got < 10 ? "over" : ""}" style="width:${c.got / c.max * 100}%"></i></div>${c.ded.length ? `<ul class="ded" style="grid-column:1/-1">${c.ded.map(d => `<li>−${d.pts}: ${esc(d.reason)}. ${esc(d.action)}.</li>`).join("")}</ul>` : `<p class="note" style="grid-column:1/-1;margin:0">${esc(c.note || "No deductions.")}</p>`}</div>`).join("")}</div>
      ${hasCrit || hasHigh ? `<p class="hint" style="color:var(--fg)">${hasCrit ? "A critical" : "A high"} risk is open, so the status reads “${band}” whatever the score.</p>` : ""}
      <p class="hint">Fixed rules, no AI: each area starts at 20 and loses points only for things Marigold can check (dates, money, statuses you set).</p>
    </div>
    <div class="panel">
      <div class="toolbar"><h2>Risks and next steps</h2></div>
      ${A.risks.length ? `<ul class="risks">${A.risks.map(riskItem).join("")}</ul>` : '<div class="callout ok">No rule-based risks found right now.</div>'}
      <div class="toolbar"><h3 style="margin:0;font-size:16px;margin-right:auto">AI risk review</h3><button class="btn small ${aiOn() ? "" : "ghost"}" type="button" id="aiRiskBtn" ${aiOn() && !S.busy.risks ? "" : "disabled"}>${S.busy.risks ? "Reviewing…" : "Run AI risk review"}</button></div>
      ${!aiOn() ? '<p class="hint">Needs Claude. Rule-based checks above still run.</p>' : ""}
      <div id="aiRiskOut">${ai && ai.items.length ? `<p class="hint">Contextual insights from Claude${ai.rev !== p.rev ? " (from an earlier version of the plan)" : ""}. These are advice and don't change the score.</p><ul class="risks">${ai.items.map(r => riskItem({ ...r, source: "ai" })).join("")}</ul>` : ""}</div>
      <h3 style="margin:8px 0 0;font-size:16px">Next up</h3>
      ${next.length ? `<ul class="mini">${next.map(t => `<li><span>${esc(t.title)} <span class="pri ${t.priority}">${t.priority}</span></span><span class="${sc.due[t.id] < sc.today ? "overdue" : "note"}">${sc.due[t.id] < sc.today ? "Overdue · " : ""}${fmtShort(sc.due[t.id])}</span></li>`).join("")}</ul>` : `<p class="hint">${sc.ev ? "Everything is done." : "Add an event date to see what's next."}</p>`}
      <h3 style="margin:8px 0 0;font-size:16px">Change log</h3>
      ${p.log.length ? `<ul class="log">${p.log.slice(0, 8).map(l => `<li><time>${new Date(l.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>${esc(l.text)} ${l.origin === "ai" ? '<span class="badge ai">AI</span>' : l.origin === "rule" ? '<span class="badge rule">Rule</span>' : ""}</li>`).join("")}</ul>` : '<p class="hint">Applied, rejected and undone changes appear here.</p>'}
    </div>
  </div>`;
  $("#aiRiskBtn")?.addEventListener("click", aiRiskReview);
}

export function renderBudget(A) {
  const p = S.plan, b = p.brief, m = n => money(n, b.currency);
  const pcts = pctList(p.budget.map(l => l.amount), b.budget);
  const left = b.budget - A.committed;
  $("#panel-budget").innerHTML = `
  <div class="toolbar"><h2>Budget</h2><span class="${left < 0 ? "over-txt" : "under-txt"}">${left < 0 ? "Over by " : "Uncommitted "}${m(Math.abs(left))}</span></div>
  <div class="tablewrap"><table><caption class="sr">Budget allocation and committed spend</caption><thead><tr><th>Category</th><th class="num">Share</th><th class="num">Allocated</th><th class="num">Committed</th><th class="num">Left</th><th>Used</th></tr></thead><tbody>
  ${p.budget.map((l, i) => { const c = l.committed || 0, over = c > l.amount; return `<tr><td><b>${esc(l.category)}</b>${CONT_RE.test(l.category) ? ' <span class="badge">reserve</span>' : ""}<div class="note">${esc(l.note)}</div></td><td class="num">${pcts[i].toFixed(1)}%</td><td class="num"><label class="sr" for="al-${l.id}">Allocation for ${esc(l.category)}</label><input class="amt" id="al-${l.id}" type="number" min="0" step="1" data-alloc="${l.id}" value="${l.amount}"></td><td class="num"><label class="sr" for="cm-${l.id}">Committed spend for ${esc(l.category)}</label><input class="amt" id="cm-${l.id}" type="number" min="0" step="1" data-commit="${l.id}" value="${l.committed ?? ""}" placeholder="0"></td><td class="num ${over ? "neg" : ""}">${m(l.amount - c)}</td><td style="min-width:90px"><div class="bar" title="${l.amount ? Math.round(c / l.amount * 100) : 0}% used"><i class="${over ? "over" : ""}" style="width:${l.amount ? Math.min(100, c / l.amount * 100) : (c ? 100 : 0)}%"></i></div></td></tr>`; }).join("")}
  </tbody><tfoot><tr><th>Total</th><th class="num">${sum(pcts).toFixed(1)}%</th><th class="num">${m(A.alloc)}</th><th class="num">${m(A.committed)}</th><th class="num ${left < 0 ? "neg" : ""}">${m(b.budget - A.committed)}</th><th>${A.alloc === b.budget ? '<span class="pos">Fully allocated</span>' : '<span class="neg">Not balanced</span>'}</th></tr></tfoot></table></div>
  <p class="hint">Type what you've paid or signed for in Committed. Changing an Allocated amount creates a proposal that rebalances the other categories, which you approve first.</p>
  <div class="card">
    <h2>Budget optimizer</h2>
    <p class="hint">Find savings without touching committed spend. Every category stays at or above what you've already committed, and the new allocations add up exactly to the new total.</p>
    <div class="btnrow" role="group" aria-label="Savings target">
      ${[10, 15, 20].map(x => `<button class="btn ghost small" type="button" data-save="${x}" ${S.busy.opt ? "disabled" : ""}>Save ${x}%</button>`).join("")}
      <label class="sr" for="saveCustom">Custom savings percent</label><input id="saveCustom" type="number" min="1" max="60" step="1" placeholder="Custom %" style="width:110px">
      <button class="btn small" type="button" id="saveGo" ${S.busy.opt ? "disabled" : ""}>Optimize</button>
      ${S.busy.opt ? '<span class="progress"><span class="spinner"></span>Claude is finding savings…</span>' : ""}
    </div>
    <label for="saveProtect" class="lbl">Protect (optional)</label><input id="saveProtect" placeholder="e.g. catering quality, photography" value="${esc(S.protect || "")}">
    <p class="hint">${aiOn() ? "Claude chooses where to cut and explains trade-offs; Marigold checks the maths." : "Claude isn't available, so this uses a rule-based proportional cut, labelled as such."}</p>
    <p class="field-err" id="optErr" role="alert" hidden></p>
  </div>`;
  $$("[data-commit]").forEach(inp => inp.addEventListener("change", () => {
    const v = inp.value.trim(); const n = v === "" ? null : Math.round(+v);
    if (n != null && (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT)) { toast("Committed spend must be a number from 0 to 1 trillion.", true); renderAll(); return; }
    commit("Recorded spend", pl => { const l = pl.budget.find(x => x.id === inp.dataset.commit); l.committed = n; }, { structural: false });
    S.plan.rev++; savePlan(); if (S.proposal) { S.proposal.status = "stale"; renderProposal(); }
  }));
  $$("[data-alloc]").forEach(inp => inp.addEventListener("change", () => {
    const l = p.budget.find(x => x.id === inp.dataset.alloc); const n = Math.round(+inp.value);
    if (!Number.isFinite(n) || n < 0) { toast("Allocation must be 0 or more.", true); renderAll(); return; }
    if (n > b.budget) { toast(`Allocation can't exceed the total budget of ${m(b.budget)}.`, true); renderAll(); return; }
    if (n < (l.committed || 0)) { toast(`${l.category} already has ${m(l.committed)} committed.`, true); renderAll(); return; }
    const lines = p.budget.map(x => ({ category: x.category, amount: x.id === l.id ? n : x.amount, locked: x.id === l.id }));
    const pr = makeProposal({ origin: "rule", kind: "alloc", title: `Set ${l.category} to ${m(n)}`, explanation: `The other categories are rebalanced in proportion so the total stays exactly ${m(b.budget)}. Committed spend is protected.`, changes: { budget: lines } });
    showProposal(pr); renderBudget(analyze(S.plan));
  }));
  $$("[data-save]").forEach(x => x.addEventListener("click", () => optimize(+x.dataset.save)));
  $("#saveGo").addEventListener("click", () => { const v = +$("#saveCustom").value; if (!(v >= 1 && v <= 60)) { const e = $("#optErr"); e.textContent = "Enter a savings target from 1% to 60%."; e.hidden = false; return; } optimize(v); });
  $("#saveProtect").addEventListener("input", e => { S.protect = e.target.value; });
}

export function renderTimeline(A) {
  const p = S.plan, sc = A.sc;
  const rows = p.tasks.map(t => ({ t, due: sc.due[t.id] || null })).filter(({ t, due }) => S.filter === "all" || (S.filter === "pending" && !t.done) || (S.filter === "overdue" && !t.done && due && due < sc.today) || (S.filter === "high" && t.priority === "high"));
  rows.sort((a, b) => (a.due || 0) - (b.due || 0));
  const phases = []; for (const r of rows) { const last = phases[phases.length - 1]; if (last && last.name === r.t.phase) last.rows.push(r); else phases.push({ name: r.t.phase, rows: [r] }); }
  const title = id => (p.tasks.find(x => x.id === id) || {}).title;
  $("#panel-timeline").innerHTML = `
  <div class="toolbar"><h2>Timeline</h2>
    <div class="filters" role="group" aria-label="Filter tasks">${[["all", "All"], ["pending", "Pending"], ["overdue", "Overdue"], ["high", "High priority"]].map(([k, l]) => `<button type="button" data-filter="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join("")}</div></div>
  ${!sc.ev ? '<div class="callout warn">No event date yet, so tasks have no calendar dates. Add one in Event details.</div>' : sc.daysLeft < 0 ? '<div class="callout err">The event date has passed. Update it in Event details if the event moved.</div>' : sc.compressed ? `<div class="callout info">Usual lead times don't fit into the ${sc.windowDays} days you had when this plan started, so Marigold compressed every deadline to fit. No task is dated before plan creation, and no task is due before a task it depends on.</div>` : ""}
  ${rows.length ? phases.map(ph => `<div class="phase"><h3>${esc(ph.name)}</h3>${ph.rows.map(({ t, due }) => { const od = !t.done && due && due < sc.today; return `<div class="task ${t.done ? "done" : ""}"><input type="checkbox" id="tk-${t.id}" data-task="${t.id}" ${t.done ? "checked" : ""}><div><label for="tk-${t.id}" class="t-title" style="all:unset;cursor:pointer" >${esc(t.title)}</label><div class="meta"><span class="pri ${t.priority}">${t.priority}</span>${t.deps.length ? `<span>After: ${t.deps.map(d => esc(title(d))).join(", ")}</span>` : ""}${t.origin === "ai" ? "<span>AI</span>" : t.origin === "you" ? "<span>Added by you</span>" : ""}${t.origin === "you" && !t.done ? `<button type="button" class="linkbtn" data-deltask="${t.id}">Remove</button>` : ""}</div></div><div class="due">${due ? `<span class="${od ? "overdue" : ""}">${od ? "Overdue · " : ""}${fmtShort(due)}</span>` : '<span class="note">No date</span>'}${due && sc.ev ? `<div class="note">${daysBetween(due, sc.ev) === 0 ? "Event day" : `${daysBetween(due, sc.ev)}d before`}</div>` : ""}</div></div>`; }).join("")}</div>`).join("") : '<p class="hint">No tasks match this filter.</p>'}
  <form class="card" id="addTask"><h2>Add a task</h2>
    <div class="row2"><div><label for="nt-title">Task</label><input id="nt-title" maxlength="160" required></div><div><label for="nt-date">Due date</label><input id="nt-date" type="date"></div></div>
    <div class="row2"><div><label for="nt-pri">Priority</label><select id="nt-pri"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select></div><div><label for="nt-dep">Must happen after</label><select id="nt-dep"><option value="">Nothing</option>${p.tasks.filter(t => !t.done).map(t => `<option value="${t.id}">${esc(clip(t.title, 50))}</option>`).join("")}</select></div></div>
    <div class="btnrow"><button class="btn small" type="submit">Add task</button><span class="field-err" id="nt-err" role="alert" hidden></span></div>
  </form>`;
  $$("[data-filter]").forEach(b => b.addEventListener("click", () => { S.filter = b.dataset.filter; renderTimeline(analyze(S.plan)); }));
  $$("[data-task]").forEach(cb => cb.addEventListener("change", () => commit("Ticked task", pl => { pl.tasks.find(t => t.id === cb.dataset.task).done = cb.checked; }, { structural: false })));
  $$("[data-deltask]").forEach(b => b.addEventListener("click", () => commit("Removed a task", pl => { pl.tasks = pl.tasks.filter(t => t.id !== b.dataset.deltask); pl.tasks.forEach(t => { t.deps = t.deps.filter(d => d !== b.dataset.deltask); }); })));
  $("#addTask").addEventListener("submit", e => {
    e.preventDefault(); const title = clip($("#nt-title").value, 160), date = $("#nt-date").value, err = $("#nt-err");
    if (!title) { err.textContent = "Name the task."; err.hidden = false; return; }
    if (date && sc.ev && parseISO(date) > sc.ev) { err.textContent = "Due date can't be after the event."; err.hidden = false; return; }
    const dep = $("#nt-dep").value;
    if (date && dep && sc.due[dep] && parseISO(date) < sc.due[dep]) { err.textContent = `That's before “${title(dep) || "the task it depends on"}” is due.`; err.hidden = false; return; }
    commit(`Added task “${title}”`, pl => pl.tasks.push({ id: uid(), title, phase: "Added", offset: 0, fixedOffset: !date, fixedDate: date || "", priority: $("#nt-pri").value, deps: dep ? [dep] : [], done: false, origin: "you" }));
  });
}

export function vendorFields(v, p, sc) {
  const lines = p.budget.map(l => `<option value="${l.id}" ${v.lineId === l.id ? "selected" : ""}>${esc(l.category)}</option>`).join("");
  const alloc = (p.budget.find(l => l.id === v.lineId) || {}).amount;
  const due = sc.vendorDue[v.id];
  return `<div class="vgrid">
    <div><label for="vn-${v.id}">Vendor name</label><input id="vn-${v.id}" data-vf="name" value="${esc(v.name)}" placeholder="Not chosen yet"></div>
    <div><label for="vc-${v.id}">Contact</label><input id="vc-${v.id}" data-vf="contact" value="${esc(v.contact)}" placeholder="Phone or email"></div>
    <div><label for="vs-${v.id}">Booking status</label><select id="vs-${v.id}" data-vf="status">${STATUSES.map(s => `<option ${v.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
    <div><label for="vp-${v.id}">Payment</label><select id="vp-${v.id}" data-vf="payment">${PAYMENTS.map(s => `<option ${v.payment === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
    <div><label for="ve-${v.id}">Estimated cost</label><input id="ve-${v.id}" type="number" min="0" data-vf="estimate" value="${v.estimate ?? ""}" placeholder="${alloc != null ? `Budget line: ${Math.round(alloc)}` : "Your estimate"}"></div>
    <div><label for="vq-${v.id}">Quoted cost</label><input id="vq-${v.id}" type="number" min="0" data-vf="quote" value="${v.quote ?? ""}" placeholder="From the vendor"></div>
    <div><label for="vd-${v.id}">Book by</label><input id="vd-${v.id}" type="date" data-vf="dueFixed" value="${v.dueFixed || (due ? iso(due) : "")}"></div>
    <div><label for="va-${v.id}">Event-day arrival</label><input id="va-${v.id}" type="time" data-vf="arrival" value="${esc(v.arrival)}"></div>
    <div><label for="vl-${v.id}">Budget category</label><select id="vl-${v.id}" data-vf="lineId"><option value="">None</option>${lines}</select></div>
  </div>
  <div><label for="vno-${v.id}">Notes</label><textarea id="vno-${v.id}" data-vf="notes" rows="2">${esc(v.notes)}</textarea></div>`;
}
export function renderVendors(A) {
  const p = S.plan, sc = A.sc, m = n => money(n, p.brief.currency);
  const counts = STATUSES.map(s => [s, p.vendors.filter(v => v.status === s).length]);
  $("#panel-vendors").innerHTML = `
  <div class="toolbar"><h2>Vendors</h2></div>
  <div class="pipeline" aria-label="Vendors by status">${counts.map(([s, n]) => `<span class="pipe"><b>${n}</b>${s}</span>`).join("")}</div>
  <p class="placeholder-note">Marigold doesn't search for real vendors, so it never invents names, prices, ratings or availability. Add the vendors you find, and compare their quotes in each card.</p>
  <div class="vendor-list">${p.vendors.map(v => {
    const si = STATUSES.indexOf(v.status) + 1; const due = sc.vendorDue[v.id]; const late = v.critical && !isBooked(v) && due && due < sc.today && sc.daysLeft >= 0;
    const alloc = (p.budget.find(l => l.id === v.lineId) || {}).amount; const ck = v.checklist.filter(c => c.done).length;
    return `<details class="vendor" data-vid="${v.id}" ${S.openV.has(v.id) ? "open" : ""}><summary><h3>${esc(v.category)} <span class="status s${si}">${v.status}</span>${v.critical ? '<span class="badge">critical</span>' : ""}</h3><span class="note">${ck}/${v.checklist.length} checks</span>
      <div class="vsub"><span>${v.name ? esc(v.name) : "<i>Vendor not chosen yet</i>"}</span><span class="${late ? "overdue" : ""}">Book by ${due ? fmtShort(due) : "—"}${late ? " · late" : ""}</span>${isNum(v.quote) ? `<span class="${alloc != null && v.quote > alloc ? "neg" : ""}">Quote ${m(v.quote)}${alloc != null ? ` vs ${m(alloc)} allocated` : ""}</span>` : alloc != null ? `<span>Allocated ${m(alloc)}</span>` : ""}<span>${v.payment}</span></div></summary>
      <div class="vbody">
        ${vendorFields(v, p, sc)}
        <div><span class="lbl">Checklist</span><ul class="checks">${v.checklist.map(c => `<li><input type="checkbox" id="vk-${c.id}" data-vcheck="${c.id}" ${c.done ? "checked" : ""}><label for="vk-${c.id}" style="all:unset;cursor:pointer" class="${c.done ? "done" : ""}">${esc(c.text)}</label></li>`).join("")}</ul>
          <form class="inline-add" data-vadd="${v.id}" style="margin-top:6px"><label class="sr" for="vadd-${v.id}">New checklist item</label><input id="vadd-${v.id}" placeholder="Add checklist item" maxlength="160"><button class="btn ghost small">Add</button></form></div>
        ${v.questions.length ? `<div><span class="lbl">Questions to ask</span><ul style="margin:0;padding-left:18px">${v.questions.map(q => `<li>${esc(q)}</li>`).join("")}</ul></div>` : ""}
        <div><span class="lbl">Compare options</span>
          ${v.options.length ? `<div class="tablewrap"><table><thead><tr><th>Option</th><th>Contact</th><th class="num">Quote</th><th>Notes</th><th></th></tr></thead><tbody>${v.options.map(o => `<tr><td>${esc(o.name)}</td><td>${esc(o.contact)}</td><td class="num">${isNum(o.quote) ? m(o.quote) : "—"}</td><td>${esc(o.notes)}</td><td><div class="btnrow"><button type="button" class="btn ghost small" data-choose="${o.id}">Choose</button><button type="button" class="iconbtn" data-delopt="${o.id}" aria-label="Remove ${esc(o.name)}">Remove</button></div></td></tr>`).join("")}</tbody></table></div>` : '<p class="hint">No options yet. Add each vendor you are considering to compare quotes side by side.</p>'}
          <form class="vgrid" data-optadd="${v.id}" style="margin-top:8px"><div><label for="on-${v.id}">Option name</label><input id="on-${v.id}" maxlength="80" required></div><div><label for="oc-${v.id}">Contact</label><input id="oc-${v.id}" maxlength="80"></div><div><label for="oq-${v.id}">Quote</label><input id="oq-${v.id}" type="number" min="0"></div><div><label for="oo-${v.id}">Notes</label><input id="oo-${v.id}" maxlength="140"></div><div style="align-self:end"><button class="btn ghost small">Add option</button></div></form>
        </div>
        ${v.origin === "you" ? `<button type="button" class="btn danger small" data-delv="${v.id}" style="align-self:flex-start">Remove this vendor</button>` : ""}
      </div></details>`; }).join("")}</div>
  <form class="card" id="addVendor"><h2>Add a vendor type</h2><div class="row2"><div><label for="nv-cat">Category</label><input id="nv-cat" maxlength="60" placeholder="e.g. Florist" required></div><div><label for="nv-crit">Critical?</label><select id="nv-crit"><option value="">No</option><option value="1">Yes</option></select></div></div><div class="btnrow"><button class="btn small">Add vendor</button></div></form>`;
  $$("details.vendor").forEach(d => d.addEventListener("toggle", () => { d.open ? S.openV.add(d.dataset.vid) : S.openV.delete(d.dataset.vid); }));
  $$("[data-vf]").forEach(inp => inp.addEventListener("change", () => {
    const vid = inp.closest("[data-vid]").dataset.vid, k = inp.dataset.vf; let val = inp.value;
    if (k === "estimate" || k === "quote") { val = val.trim() === "" ? null : Math.round(+val); if (val != null && (!Number.isFinite(val) || val < 0 || val > MAX_AMOUNT)) { toast("Costs must be a number from 0 to 1 trillion.", true); renderAll(); return; } }
    if (k === "name" || k === "contact") val = clip(val, 80); if (k === "notes") val = clip(val, 600);
    commit(`Updated ${k} for vendor`, pl => { const v = pl.vendors.find(x => x.id === vid); v[k] = val; if (k === "dueFixed" && val === "") v.dueFixed = ""; }, { structural: false });
  }));
  $$("[data-vcheck]").forEach(cb => cb.addEventListener("change", () => commit("Vendor check", pl => { for (const v of pl.vendors) { const c = v.checklist.find(x => x.id === cb.dataset.vcheck); if (c) c.done = cb.checked; } }, { structural: false })));
  $$("[data-vadd]").forEach(f => f.addEventListener("submit", e => { e.preventDefault(); const t = clip(f.querySelector("input").value, 160); if (!t) return; commit("Added vendor checklist item", pl => pl.vendors.find(v => v.id === f.dataset.vadd).checklist.push({ id: uid(), text: t, done: false }), { structural: false }); }));
  $$("[data-optadd]").forEach(f => f.addEventListener("submit", e => { e.preventDefault(); const vid = f.dataset.optadd; const name = clip($("#on-" + vid).value, 80); if (!name) return; const q = $("#oq-" + vid).value.trim(); if (q !== "" && safeAmount(q) == null) { toast("Quote must be a number from 0 to 1 trillion.", true); return; } commit("Added vendor option", pl => pl.vendors.find(v => v.id === vid).options.push({ id: uid(), name, contact: clip($("#oc-" + vid).value, 80), quote: q === "" ? null : safeAmount(q), notes: clip($("#oo-" + vid).value, 140) }), { structural: false }); }));
  $$("[data-choose]").forEach(b => b.addEventListener("click", () => commit("Chose a vendor option", pl => { for (const v of pl.vendors) { const o = v.options.find(x => x.id === b.dataset.choose); if (o) { v.name = o.name; v.contact = o.contact; v.quote = o.quote; if (STATUSES.indexOf(v.status) < 1) v.status = "Shortlisted"; } } }, { structural: false })));
  $$("[data-delopt]").forEach(b => b.addEventListener("click", () => commit("Removed vendor option", pl => { for (const v of pl.vendors) v.options = v.options.filter(o => o.id !== b.dataset.delopt); }, { structural: false })));
  $$("[data-delv]").forEach(b => b.addEventListener("click", () => commit("Removed a vendor", pl => { pl.vendors = pl.vendors.filter(v => v.id !== b.dataset.delv); })));
  $("#addVendor").addEventListener("submit", e => { e.preventDefault(); const cat = clip($("#nv-cat").value, 60); if (!cat) return; if (p.vendors.some(v => norm(v.category) === norm(cat))) { toast(`${cat} is already in the list.`, true); return; } commit(`Added vendor “${cat}”`, pl => { const v = newVendor({ category: cat, critical: !!$("#nv-crit").value, bookByDaysBefore: 14, checklist: ["Request a quote", "Confirm availability for the date"] }, pl.budget, "you"); pl.vendors.push(v); S.openV.add(v.id); }); });
}

export function renderIdeas() {
  const p = S.plan, cur = p.brief.currency;
  $("#panel-ideas").innerHTML = `
  <div class="toolbar"><h2>Ideas</h2></div>
  <div class="card"><div class="row2"><div><label for="ideaFocus">Focus (optional)</label><input id="ideaFocus" maxlength="120" placeholder="e.g. sustainability, kids, grandparents" value="${esc(S.ideaFocus || "")}"></div><div style="align-self:end"><button class="btn" type="button" id="moreIdeas" ${aiOn() && !S.busy.ideas ? "" : "disabled"}>${S.busy.ideas ? "Thinking…" : "Get more AI ideas"}</button></div></div>
  ${aiOn() ? "" : '<p class="hint">Needs Claude.</p>'}<p class="field-err" id="ideaErr" role="alert" hidden></p></div>
  <p class="hint">Cost ranges are rough AI estimates in ${esc(cur)}, not vendor quotes.</p>
  <div class="ideas">${p.ideas.map(i => {
    const mid = i.costLow != null && i.costHigh != null ? Math.round((i.costLow + i.costHigh) / 2) : (i.costLow ?? i.costHigh ?? "");
    const inTasks = p.tasks.some(t => norm(t.title) === norm("Arrange: " + i.title));
    const inBudget = p.budget.some(l => norm(l.category) === norm("Idea: " + i.title).slice(0, 60) || norm(l.category) === norm(clip("Idea: " + i.title, 60)));
    return `<article class="idea"><div class="tag"><span>${esc(i.tag)}</span>${originBadge(i.origin)}</div><h3>${esc(i.title)}</h3><p>${esc(i.detail)}</p>${i.costLow != null || i.costHigh != null ? `<div class="cost">Est. ${money(i.costLow ?? i.costHigh, cur)}${i.costHigh != null && i.costLow != null && i.costHigh !== i.costLow ? `–${money(i.costHigh, cur)}` : ""} <span class="note">(estimate)</span></div>` : ""}
    <div class="acts"><button type="button" class="btn ghost small" data-itask="${i.id}" ${inTasks ? "disabled" : ""}>${inTasks ? "In tasks" : "Add to tasks"}</button>
    ${inBudget ? '<span class="note">In budget</span>' : `<label class="sr" for="ib-${i.id}">Amount for ${esc(i.title)}</label><input id="ib-${i.id}" type="number" min="1" step="1" value="${mid}" placeholder="Amount"><button type="button" class="btn ghost small" data-ibud="${i.id}">Add to budget</button>`}</div></article>`; }).join("")}</div>`;
  $("#moreIdeas").addEventListener("click", moreIdeas);
  $("#ideaFocus").addEventListener("input", e => { S.ideaFocus = e.target.value; });
  $$("[data-itask]").forEach(b => b.addEventListener("click", () => { const i = p.ideas.find(x => x.id === b.dataset.itask); commit(`Added idea to tasks: ${i.title}`, pl => pl.tasks.push({ id: uid(), title: clip("Arrange: " + i.title, 160), phase: "Ideas", offset: Math.min(30, Math.max(0, analyze(pl).sc.daysLeft ?? 30)), fixedOffset: true, fixedDate: "", priority: "medium", deps: [], done: false, origin: "you" })); toast("Added to Timeline. Undo is available."); }));
  $$("[data-ibud]").forEach(b => b.addEventListener("click", () => {
    const i = p.ideas.find(x => x.id === b.dataset.ibud); const amt = Math.round(+$("#ib-" + i.id).value);
    if (!(amt > 0)) { toast("Enter an amount greater than 0.", true); return; }
    const cat = clip("Idea: " + i.title, 60);
    const lines = p.budget.map(l => ({ category: l.category, amount: l.amount })); lines.push({ category: cat, amount: amt, locked: true });
    const cont = lines.find(l => CONT_RE.test(l.category)); const cl = p.budget.find(l => CONT_RE.test(l.category));
    if (cont) { const free = cont.amount - ((cl && cl.committed) || 0); cont.amount -= Math.min(free, amt); }
    const pr = makeProposal({ origin: "rule", kind: "idea", title: `Add “${i.title}” to the budget`, explanation: `Sets aside ${money(amt, cur)} for this idea, taken from the contingency first${cont && (cl.amount - (cl.committed || 0)) < amt ? ", then in proportion from other categories" : ""}. The total budget stays ${money(p.brief.budget, cur)}.`, tradeoffs: ["Less contingency means less room for surprises."], changes: { budget: lines } });
    showProposal(pr);
  }));
}

export function renderEventDay(A) {
  const p = S.plan, sc = A.sc, b = p.brief;
  const run = p.runOfShow.slice().sort((x, y) => x.time.localeCompare(y.time));
  const arrivals = p.vendors.filter(v => v.arrival).sort((x, y) => x.arrival.localeCompare(y.arrival));
  const critical = p.tasks.filter(t => !t.done && t.priority === "high").sort((x, y) => (sc.due[x.id] || 0) - (sc.due[y.id] || 0));
  const doneN = p.tasks.filter(t => t.done).length;
  const vc = p.vendors.filter(v => v.contact);
  const checklist = (key, label) => `<div class="card"><h2>${label}</h2><ul class="checks">${p.dayOf[key].map(c => `<li><input type="checkbox" id="dc-${c.id}" data-dchk="${key}:${c.id}" ${c.done ? "checked" : ""}><label for="dc-${c.id}" style="all:unset;cursor:pointer" class="${c.done ? "done" : ""}">${esc(c.text)}</label></li>`).join("")}</ul><form class="inline-add" data-dadd="${key}"><label class="sr" for="da-${key}">Add item</label><input id="da-${key}" maxlength="140" placeholder="Add item"><button class="btn ghost small">Add</button></form></div>`;
  $("#panel-eventday").innerHTML = `
  <div class="toolbar"><h2>Event day command center</h2></div>
  <div class="ed-grid">
    <div class="card"><span class="lbl">Countdown</span><div class="countdown" id="countdown">${countdownText()}</div><p class="note" style="margin:0">${sc.ev ? fmtDate(sc.ev) + (b.time ? " at " + b.time : "") : "Add a date in Event details"}</p>
      <span class="lbl" style="margin-top:6px">Task completion</span><div class="bar"><i class="good" style="width:${p.tasks.length ? doneN / p.tasks.length * 100 : 0}%"></i></div><p class="note" style="margin:0">${doneN} of ${p.tasks.length} tasks done</p></div>
    <div class="card"><h2>Pending critical tasks</h2>${critical.length ? `<ul class="mini">${critical.slice(0, 8).map(t => `<li><span>${esc(t.title)}</span><span class="${sc.due[t.id] && sc.due[t.id] < sc.today ? "overdue" : "note"}">${fmtShort(sc.due[t.id])}</span></li>`).join("")}</ul>` : '<p class="hint">No pending high-priority tasks.</p>'}</div>
  </div>
  <div class="card"><h2>Run of show</h2>
    ${run.length ? run.map(r => `<div class="sched-row" data-rid="${r.id}"><label class="sr" for="rt-${r.id}">Time</label><input id="rt-${r.id}" type="time" data-rf="time" value="${esc(r.time)}"><label class="sr" for="ri-${r.id}">Item</label><input id="ri-${r.id}" data-rf="item" value="${esc(r.item)}"><label class="sr" for="ro-${r.id}">Owner</label><input class="owner" id="ro-${r.id}" data-rf="owner" value="${esc(r.owner)}" placeholder="Owner"><button type="button" class="iconbtn" data-rdel="${r.id}" aria-label="Remove ${esc(r.item)}">Remove</button></div>`).join("") : '<p class="hint">No schedule yet.</p>'}
    <form class="sched-row" id="addRun"><label class="sr" for="nr-time">Time</label><input id="nr-time" type="time" required><label class="sr" for="nr-item">Item</label><input id="nr-item" placeholder="What happens" maxlength="120" required><label class="sr" for="nr-owner">Owner</label><input class="owner" id="nr-owner" placeholder="Owner" maxlength="60"><button class="btn ghost small">Add</button></form>
  </div>
  <div class="ed-grid">
    <div class="card"><h2>Vendor arrivals</h2>${arrivals.length ? `<ul class="mini">${arrivals.map(v => `<li><span>${esc(v.arrival)} · ${esc(v.category)}${v.name ? ` (${esc(v.name)})` : ""}</span><span class="note">${esc(v.contact)}</span></li>`).join("")}</ul>` : '<p class="hint">Set arrival times in each vendor card to see them here.</p>'}</div>
    <div class="card"><h2>Key contacts</h2>
      ${p.dayOf.contacts.length || vc.length ? `<ul class="mini">${p.dayOf.contacts.map(c => `<li><span><b>${esc(c.name)}</b> · ${esc(c.role)}</span><span>${esc(c.phone)} <button type="button" class="iconbtn" data-cdel="${c.id}" aria-label="Remove ${esc(c.name)}">Remove</button></span></li>`).join("")}${vc.map(v => `<li><span><b>${esc(v.name || v.category)}</b> · ${esc(v.category)}</span><span>${esc(v.contact)}</span></li>`).join("")}</ul>` : '<p class="hint">Add the people to call on the day.</p>'}
      <form class="vgrid" id="addContact"><div><label for="nc-name">Name</label><input id="nc-name" maxlength="60" required></div><div><label for="nc-role">Role</label><input id="nc-role" maxlength="60"></div><div><label for="nc-phone">Phone</label><input id="nc-phone" maxlength="40"></div><div style="align-self:end"><button class="btn ghost small">Add contact</button></div></form></div>
  </div>
  <div class="ed-grid">${checklist("emergency", "Emergency checklist")}${checklist("weather", "Weather contingency")}</div>
  <p class="hint">Marigold doesn't fetch live weather. Check a forecast service in the days before the event and work through the weather checklist.</p>`;
  $$("[data-rf]").forEach(inp => inp.addEventListener("change", () => commit("Edited run of show", pl => { const r = pl.runOfShow.find(x => x.id === inp.closest("[data-rid]").dataset.rid); r[inp.dataset.rf] = clip(inp.value, 120); }, { structural: false })));
  $$("[data-rdel]").forEach(bt => bt.addEventListener("click", () => commit("Removed schedule item", pl => { pl.runOfShow = pl.runOfShow.filter(r => r.id !== bt.dataset.rdel); }, { structural: false })));
  $("#addRun").addEventListener("submit", e => { e.preventDefault(); const time = $("#nr-time").value, item = clip($("#nr-item").value, 120); if (!time || !item) return; commit("Added schedule item", pl => pl.runOfShow.push({ id: uid(), time, item, owner: clip($("#nr-owner").value, 60) }), { structural: false }); });
  $$("[data-dchk]").forEach(cb => cb.addEventListener("change", () => { const [k, id] = cb.dataset.dchk.split(":"); commit("Checklist", pl => { pl.dayOf[k].find(c => c.id === id).done = cb.checked; }, { structural: false }); }));
  $$("[data-dadd]").forEach(f => f.addEventListener("submit", e => { e.preventDefault(); const t = clip(f.querySelector("input").value, 140); if (!t) return; commit("Added checklist item", pl => pl.dayOf[f.dataset.dadd].push({ id: uid(), text: t, done: false }), { structural: false }); }));
  $$("[data-cdel]").forEach(bt => bt.addEventListener("click", () => commit("Removed contact", pl => { pl.dayOf.contacts = pl.dayOf.contacts.filter(c => c.id !== bt.dataset.cdel); }, { structural: false })));
  $("#addContact").addEventListener("submit", e => { e.preventDefault(); const name = clip($("#nc-name").value, 60); if (!name) return; commit("Added contact", pl => pl.dayOf.contacts.push({ id: uid(), name, role: clip($("#nc-role").value, 60), phone: clip($("#nc-phone").value, 40) }), { structural: false }); });
}
export function countdownText() {
  if (!S.plan) return "";
  const b = S.plan.brief, ev = parseISO(b.date); if (!ev) return "No date set";
  const [h, mi] = (b.time || "00:00").split(":").map(Number); const at = new Date(ev); at.setHours(h || 0, mi || 0, 0, 0);
  const ms = at - Date.now();
  if (ms < 0) return daysBetween(ev, today()) === 0 ? "Today" : "Event passed";
  const d = Math.floor(ms / DAY), hr = Math.floor(ms % DAY / 3600000), mn = Math.floor(ms % 3600000 / 60000);
  return d >= 2 ? `${d} days` : `${d ? d + "d " : ""}${hr}h ${mn}m`;
}

export function renderChat() {
  const p = S.plan; const box = $("#msgs");
  box.innerHTML = p.chat.length ? p.chat.slice(-40).map(m => `<div class="msg ${m.role}">${esc(m.text)}</div>`).join("") : `<div class="msg note">${aiOn() ? "Try one of the suggestions below." : "The co-planner needs Claude. Everything else works in template mode."}</div>`;
  if (S.busy.chat) box.insertAdjacentHTML("beforeend", '<div class="msg assistant"><span class="progress"><span class="spinner"></span>Thinking and checking the numbers…</span></div>');
  box.scrollTop = box.scrollHeight;
  const cur = p.brief.currency, tb = p.brief.budget;
  const reduced = Math.round(tb * 0.8 / (cur === "INR" ? 100000 : 1000)) * (cur === "INR" ? 100000 : 1000) || Math.round(tb * 0.8);
  const sugg = [
    `My budget has been reduced to ${money(reduced, cur)}. Keep the guest count unchanged and protect the catering quality.`,
    `Our guest count went up from ${p.brief.guests} to ${Math.round(p.brief.guests * 1.2)}. Recalculate the budget.`,
    "Move the event two weeks earlier and adjust my timeline.",
    `Make this ${p.brief.type.toLowerCase()} more sustainable without increasing the budget.`,
    "What should I focus on this week?",
  ];
  $("#suggest").innerHTML = sugg.map(s => `<button type="button" data-sugg="${esc(s)}" ${aiOn() && !S.busy.chat ? "" : "disabled"}>${esc(s)}</button>`).join("");
  $$("[data-sugg]").forEach(b => b.addEventListener("click", () => sendChat(b.dataset.sugg)));
  $("#askBtn").disabled = !aiOn() || !!S.busy.chat; $("#askInput").disabled = !aiOn();
  $("#stopChat").hidden = !S.busy.chat;
  $("#chatHint").textContent = aiOn() ? "" : "Needs Claude";
}

export function renderExport() {
  const canSave = !!S.downloads;
  $("#exportBody").innerHTML = canSave
    ? `<button class="btn ghost small" type="button" data-exp="pdf">Full plan (PDF)</button><button class="btn ghost small" type="button" data-exp="budget">Budget (CSV)</button><button class="btn ghost small" type="button" data-exp="vendors">Vendors (CSV)</button><button class="btn ghost small" type="button" data-exp="timeline">Timeline (CSV)</button>`
    : `<button class="btn ghost small" type="button" data-copy="budget">Copy budget CSV</button><button class="btn ghost small" type="button" data-copy="vendors">Copy vendors CSV</button><button class="btn ghost small" type="button" data-copy="timeline">Copy timeline CSV</button><span class="hint">File downloads aren't available in this view, so you can copy instead.</span>`;
  $$("[data-exp]").forEach(b => b.addEventListener("click", () => exportFile(b.dataset.exp, b)));
  $$("[data-copy]").forEach(b => b.addEventListener("click", async () => { const csv = buildCSV(b.dataset.copy); try { await navigator.clipboard.writeText(csv); toast("Copied. Paste it into a spreadsheet."); } catch { toast("Couldn't copy here. Try a different browser view.", true); } }));
}
