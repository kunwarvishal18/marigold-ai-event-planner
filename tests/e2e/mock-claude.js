/* ==========================================================================
   TEST MOCK. This is NOT Claude and is never shipped in the app.
   It stands in for the claude.ai Artifact runtime (window.claude.use) so the
   browser tests can run offline and deterministically. Every answer below is
   canned test data; passing these tests says nothing about the quality of
   real Claude output. See TESTING.md for the manual real-Claude checklist.
   ========================================================================== */
window.__calls = []; window.__prompts = []; window.__mode = window.__mode || {}; window.__saved = [];
function genFor(p) {
  const type = /Event type: (.*)/.exec(p)[1].trim();
  const left = +((/is (\d+) days away/.exec(p) || [])[1] ?? 300);
  const cap = d => Math.min(d, left);
  const B = { "Wedding": [["Venue & hospitality",27],["Vegetarian catering",26],["Décor & florals",12],["Photography & video",8],["Attire & beauty",9],["Music & sangeet",6],["Accessibility & guest care",3],["Invitations",3],["Contingency",6]],
    "Birthday": [["Garden venue",20],["Vegetarian food & cake",40],["Natural décor",10],["Activities",12],["Steel tableware rental",8],["Contingency",10]],
    "Community event": [["Permits & ground",15],["Stage & sound",22],["Waste segregation & compost",14],["Volunteer kits",10],["Accessible entry & ramps",9],["Publicity",12],["Water stations",10],["Contingency",8]] }[type];
  return JSON.stringify({ summary: `A ${type} plan tailored to the brief with specific choices.`,
    budget: B.map(([c,p]) => ({ category: c, pct: p, note: "tip for " + c })),
    tasks: Array.from({length: 14}, (_, i) => ({ key: "t"+i, title: `${type} task ${i+1}`, phase: "Phase " + (1 + Math.floor(i/3)), daysBefore: cap(Math.max(0, 200 - i*15)), priority: i % 4 === 0 ? "high" : "medium", dependsOn: i ? ["t"+(i-1)] : (window.__mode.cycle ? ["t13", "t5"] : []) })),
    vendors: [["Venue",true],["Caterer",true],["Photographer",true],["Decorator",false],["Sound & stage",true],["Waste management crew",true]].map(([c,cr]) => ({ category: c, critical: cr, budgetCategory: c, bookByDaysBefore: cap(120), checklist: ["Get quote", "Check availability"], questions: ["What is included?"] })),
    ideas: Array.from({length: 6}, (_, i) => ({ title: `${type} idea ${i+1}`, detail: "Detail for the idea.", tag: "Décor", costLow: 1000*(i+1), costHigh: 2000*(i+1) })),
    runOfShow: [{ time: "09:00", item: "Setup", owner: "Lead" }, { time: "18:00", item: "Main event", owner: "Host" }],
    risks: [{ severity: "medium", title: "Monsoon season", why: "Rain likely.", action: "Book a tent." }] });
}
function parseBudget(p) {
  const sec = p.split("BUDGET (total ")[1]; const total = +sec.split(" ")[0];
  const lines = [...sec.split("Committed so far")[0].matchAll(/- (.+?): (\d+) \(/g)].map(m => ({ category: m[1], amount: +m[2] }));
  return { total, lines };
}
async function sample(input, opts) {
  const p = String(input); window.__calls.push(p.slice(0, 80)); window.__prompts.push(p);
  await new Promise(r => setTimeout(r, window.__mode.delay || 30));
  if (opts && opts.signal && opts.signal.aborted) throw { code: "cancelled" };
  if (window.__mode.rate) throw { code: "rate_limited", message: "slow down" };
  if (window.__mode.huge) return { text: '{"reply":"' + 'x'.repeat(300000) + '"}', truncated: false };
  if (window.__mode.garbage) return { text: "Sure! here is your plan {not json", truncated: false };
  if (window.__mode.badOnce && !p.includes("previous answer was rejected")) return { text: '{"summary":"x"}', truncated: false };
  if (p.includes("Build a practical, personalised plan")) return { text: "```json\n" + genFor(p) + "\n```", truncated: false };
  if (p.includes("budget optimizer")) {
    const { total, lines } = parseBudget(p); const target = +/to exactly (\d+)/.exec(p)[1];
    const f = target / total; return { text: JSON.stringify({ explanation: "Cut décor and invitations most.", tradeoffs: ["Fewer flowers"], budget: lines.map(l => ({ category: l.category, amount: Math.round(l.amount * f), note: "trimmed" })) }) };
  }
  if (p.includes("NEW creative")) return { text: JSON.stringify([{ title: "Fresh idea A", detail: "d", tag: "Food", costLow: 500, costHigh: 900 }, { title: "Fresh idea B", detail: "d", tag: "Décor", costLow: 100, costHigh: 300 }]) };
  if (p.includes("contextual risks")) return { text: JSON.stringify({ risks: [{ severity: "high", title: "Heat in afternoon", why: "Hot season.", action: "Shift outdoor items to evening." }] }) };
  if (p.includes("NEW USER MESSAGE")) {
    const msg = p.split("NEW USER MESSAGE")[1];
    const { total, lines } = parseBudget(p);
    if (/reduced to/i.test(msg)) {
      const target = 2000000; const cat = lines.find(l => /cater/i.test(l.category)); const others = lines.filter(l => l !== cat);
      const os = others.reduce((a, l) => a + l.amount, 0); const room = target - cat.amount;
      // deliberately off by 1,234 to exercise the repair step
      const out = lines.map(l => ({ category: l.category, amount: l === cat ? l.amount : Math.round(l.amount * room / os) + (l === others[0] ? 1234 : 0) }));
      return { text: JSON.stringify({ reply: "I kept catering intact and trimmed the rest.", proposal: { title: "Fit plan to ₹20 lakh", explanation: "Catering protected.", tradeoffs: ["Smaller décor"], changes: { brief: { budget: target }, budget: out, addTasks: [{ title: "Renegotiate décor package", phase: "Budget", daysBefore: 9999, priority: "high" }] } } }) };
    }
    if (/two weeks earlier/i.test(msg)) { const d = /Date: (\d{4}-\d{2}-\d{2})/.exec(p)[1]; const dt = new Date(d + "T00:00"); dt.setDate(dt.getDate() - 14); const iso = dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0"); return { text: JSON.stringify({ reply: "Moved.", proposal: { title: "Move event 2 weeks earlier", explanation: "Date moves.", tradeoffs: [], changes: { brief: { date: iso } } } }) }; }
    if (/photography vendor/i.test(msg)) return { text: JSON.stringify({ reply: "Added.", proposal: { title: "Add drone photography", explanation: "", tradeoffs: [], changes: { addVendors: [{ category: "Drone photography", critical: false, checklist: ["Check permits"], questions: [], bookByDaysBefore: 30 }], addTasks: [{ title: "Brief the drone team", phase: "Vendors", daysBefore: 10, priority: "medium" }] } } }) };
    if (/xss/i.test(msg)) return { text: JSON.stringify({ reply: "<img src=x onerror=alert(1)>", proposal: { title: "<script>bad()</script>", explanation: "", tradeoffs: [], changes: { addTasks: [{ title: "<b>bold</b>", daysBefore: 1 }] } } }) };
    return { text: JSON.stringify({ reply: "Focus on booking the venue this week.", proposal: null }) };
  }
  return { text: "{}" };
}
const downloads = { save: async (r) => { window.__saved.push({ filename: r.filename, size: r.data.size ?? r.data.length, text: typeof r.data === "string" ? r.data : null }); return {}; } };
window.claude = { use: async n => { if (n === "downloads" && window.__mode.dlThrows) throw new Error("downloads broke"); return n === "sample" ? sample : n === "downloads" ? downloads : null; } };
