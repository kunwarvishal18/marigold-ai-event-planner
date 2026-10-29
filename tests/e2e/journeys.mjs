// End-to-end user journeys and regression checks, run against both builds by browser.test.mjs.
// `fresh(seed, mock)` opens a new browser context (optionally seeding localStorage and installing
// the Claude MOCK); `ok(name, condition, info)` records a result.

/** Opens the sample wedding in template mode and switches to a tab. */
async function sampleOn(fresh, tab) {
  const session = await fresh();
  await session.pg.click("#openSample");
  await session.pg.click(`#tab-${tab}`);
  return session;
}

const planNow = (pg) => pg.evaluate(() => MarigoldTest.state().plan);

/** Adding, validating and removing a task in the timeline. */
async function timelineJourney(fresh, ok) {
  const { ctx, pg, errs } = await sampleOn(fresh, "timeline");
  const target = await pg.evaluate(() => {
    const { plan } = MarigoldTest.state();
    const sched = MarigoldTest.schedule(plan);
    const late = plan.tasks
      .filter((t) => !t.done && sched.due[t.id])
      .sort((a, b) => sched.due[b.id] - sched.due[a.id])[0];
    return { id: late.id, title: late.title };
  });
  await pg.fill("#nt-title", "Book guest shuttles");
  await pg.fill("#nt-date", new Date().toISOString().slice(0, 10));
  await pg.selectOption("#nt-dep", target.id);
  await pg.click("#addTask button[type=submit]");
  const message = await pg.textContent("#nt-err");
  ok(
    "Timeline: a task due before its prerequisite is refused with the prerequisite named",
    message.includes(target.title) && !errs.length,
    message + errs.join(" | "),
  );

  await pg.fill("#nt-date", "");
  await pg.click("#addTask button[type=submit]");
  const added = (await planNow(pg)).tasks.find((t) => t.title === "Book guest shuttles");
  ok(
    "Timeline: a valid new task is added with its dependency",
    added && added.deps[0] === target.id && added.origin === "you",
    JSON.stringify(added),
  );
  await pg.click(`[data-deltask="${added.id}"]`);
  const removed = !(await planNow(pg)).tasks.some((t) => t.id === added.id);
  ok("Timeline: a task you added can be removed (and undone)", removed);
  await pg.click("#undoBtn");
  ok(
    "Timeline: undo brings the removed task back",
    (await planNow(pg)).tasks.some((t) => t.id === added.id),
  );
  ok("No page errors (timeline journey)", !errs.length, errs.join(" | "));
  await ctx.close();
}

/** Adding a vendor type, comparing options and choosing one. */
async function vendorJourney(fresh, ok) {
  const { ctx, pg, errs } = await sampleOn(fresh, "vendors");
  await pg.fill("#nv-cat", "Florist");
  await pg.selectOption("#nv-crit", "1");
  await pg.click("#addVendor button");
  const florist = (await planNow(pg)).vendors.find((v) => v.category === "Florist");
  ok(
    "Vendors: a new critical vendor type is added and its card opens",
    florist?.critical && (await pg.isVisible(`#on-${florist.id}`)),
  );

  await pg.fill(`#on-${florist.id}`, "Petal & Stem");
  await pg.fill(`#oq-${florist.id}`, "45000");
  await pg.click(`[data-optadd="${florist.id}"] button`);
  await pg.click(`[data-vid="${florist.id}"] [data-choose]`);
  await pg.selectOption(`#vp-${florist.id}`, "Deposit paid");
  await pg.fill(`#vadd-${florist.id}`, "Confirm flower varieties");
  await pg.click(`[data-vadd="${florist.id}"] button`);
  const chosen = (await planNow(pg)).vendors.find((v) => v.id === florist.id);
  ok(
    "Vendors: choosing an option fills name, quote and stage; payment and checklist save",
    chosen.name === "Petal & Stem" &&
      chosen.quote === 45000 &&
      chosen.status === "Shortlisted" &&
      chosen.payment === "Deposit paid" &&
      chosen.checklist.some((c) => c.text === "Confirm flower varieties"),
    JSON.stringify(chosen),
  );
  await pg.fill(`#vq-${florist.id}`, "5000000000000");
  await pg.locator(`#vq-${florist.id}`).blur();
  ok(
    "Vendors: an impossible quote is refused and the saved quote is kept",
    (await planNow(pg)).vendors.find((v) => v.id === florist.id).quote === 45000 &&
      (await pg.textContent("#toast")).includes("1 trillion"),
  );
  ok("No page errors (vendor journey)", !errs.length, errs.join(" | "));
  await ctx.close();
}

/** The event-day command center: run of show, contacts and checklists. */
async function eventDayJourney(fresh, ok) {
  const { ctx, pg, errs } = await sampleOn(fresh, "eventday");
  await pg.fill("#nr-time", "18:45");
  await pg.fill("#nr-item", "Fireworks");
  await pg.click("#addRun button");
  await pg.fill("#nc-name", "Asha");
  await pg.fill("#nc-role", "Venue manager");
  await pg.fill("#nc-phone", "+91 90000 00000");
  await pg.click("#addContact button");
  await pg.check("[data-dchk^='emergency:']");
  const plan = await planNow(pg);
  ok(
    "Event day: schedule items, contacts and checklist ticks are saved",
    plan.runOfShow.some((r) => r.time === "18:45" && r.item === "Fireworks") &&
      plan.dayOf.contacts.some((c) => c.name === "Asha") &&
      plan.dayOf.emergency[0].done === true,
  );
  const times = await pg.evaluate(() =>
    [...document.querySelectorAll("[data-rid] [data-rf=time]")].map((input) => input.value),
  );
  ok(
    "Event day: the run of show is listed in time order",
    times.includes("18:45") && times.every((time, i) => i === 0 || times[i - 1] <= time),
    times.join(),
  );
  const contactId = plan.dayOf.contacts.find((c) => c.name === "Asha").id;
  await pg.click(`[data-cdel="${contactId}"]`);
  ok(
    "Event day: a contact can be removed",
    !(await planNow(pg)).dayOf.contacts.some((c) => c.id === contactId),
  );
  ok("No page errors (event-day journey)", !errs.length, errs.join(" | "));
  await ctx.close();
}

/** Ideas become timeline tasks, or budget lines through an approved proposal. */
async function ideasJourney(fresh, ok) {
  const { ctx, pg, errs } = await sampleOn(fresh, "ideas");
  const idea = (await planNow(pg)).ideas[0];
  await pg.click(`[data-itask="${idea.id}"]`);
  ok(
    "Ideas: adding an idea to tasks creates a dated task",
    (await planNow(pg)).tasks.some((t) => t.title === `Arrange: ${idea.title}`),
  );
  await pg.fill(`#ib-${idea.id}`, "20000");
  await pg.click(`[data-ibud="${idea.id}"]`);
  await pg.click("#applyBtn");
  const plan = await planNow(pg);
  const total = plan.budget.reduce((sum, line) => sum + line.amount, 0);
  ok(
    "Ideas: adding an idea to the budget keeps the total exact after approval",
    plan.budget.some((l) => l.category.startsWith("Idea:") && l.amount === 20000) &&
      total === plan.brief.budget,
    `${total} vs ${plan.brief.budget}`,
  );
  ok("No page errors (ideas journey)", !errs.length, errs.join(" | "));
  await ctx.close();
}

/** Keyboard users keep their place when the panel re-renders (WCAG 2.4.3). */
async function focusJourney(fresh, ok) {
  const { ctx, pg, errs } = await sampleOn(fresh, "timeline");
  const id = await pg.evaluate(() => document.querySelector("[data-task]:not(:checked)").id);
  await pg.focus(`#${id}`);
  await pg.keyboard.press("Space");
  const focusedAfterTick = await pg.evaluate(() => document.activeElement.id);
  const ticked = (await planNow(pg)).tasks.some((t) => `tk-${t.id}` === id && t.done);
  ok(
    "Focus: ticking a task with the keyboard keeps focus on that checkbox",
    focusedAfterTick === id && ticked,
    `focused=${focusedAfterTick} expected=${id} ticked=${ticked}`,
  );
  await pg.click("#tab-budget");
  await pg.click('[data-save="10"]');
  await pg.focus("#applyBtn");
  await pg.keyboard.press("Enter");
  ok(
    "Focus: applying a proposal moves focus to the plan title, not the page body",
    (await pg.evaluate(() => document.activeElement.id)) === "pTitle",
  );
  ok("No page errors (focus journey)", !errs.length, errs.join(" | "));
  await ctx.close();
}

/** An approved AI proposal can't put markup into the page through checked brief fields. */
async function proposalInjection(fresh, ok) {
  const { ctx, pg, errs } = await sampleOn(fresh, "ideas");
  const warnings = await pg.evaluate(() => {
    const state = MarigoldTest.state();
    state.proposal = MarigoldTest.makeProposal({
      origin: "ai",
      kind: "chat",
      title: "Injected",
      changes: {
        brief: {
          currency: '<img src=x id="pwnCurrency">',
          time: '<b id="pwnTime">9</b>',
          type: "<i id=pwnType>",
          guests: 210,
        },
      },
    });
    return state.proposal.warnings;
  });
  await pg.click("#tab-budget");
  await pg.click("#applyBtn");
  await pg.click("#tab-eventday");
  const plan = await planNow(pg);
  const injected = await pg.evaluate(
    () => !!document.querySelector("#pwnCurrency, #pwnTime, #pwnType"),
  );
  ok(
    "Security: currency, time and event type from an AI proposal are allow-listed, never rendered as HTML",
    !injected &&
      plan.brief.currency === "INR" &&
      plan.brief.type === "Wedding" &&
      plan.brief.guests === 210 &&
      warnings.includes("Ignored an unsupported currency.") &&
      warnings.includes("Ignored an invalid start time."),
    JSON.stringify(warnings),
  );
  ok("No page errors (proposal injection)", !errs.length, errs.join(" | "));
  await ctx.close();
}

/** Stored data with markup in ids and enum fields is rebuilt from allow-lists on load. */
async function storedInjection(fresh, ok) {
  const seed = await (async () => {
    const { ctx, pg } = await fresh();
    await pg.click("#openSample");
    const stored = await pg.evaluate(() => localStorage.getItem("mg2.plans"));
    await ctx.close();
    const plans = JSON.parse(stored);
    const plan = Object.values(plans)[0];
    const evil = '"><img src=x class=pwn>';
    plan.tasks[0].id = evil;
    plan.tasks[1].priority = `high${evil}`;
    plan.vendors[0].status = `Booked${evil}`;
    plan.vendors[0].payment = evil;
    plan.vendors[0].dueFixed = evil;
    plan.budget[0].id = evil;
    plan.chat = [{ role: `user${evil}`, text: "hi" }];
    plan.aiRisks = { at: 1, rev: 0, items: [{ sev: `high${evil}`, title: "t" }] };
    plan.brief.time = evil;
    plan.brief.currency = evil;
    return { "mg2.plans": JSON.stringify(plans), "mg2.last": JSON.stringify(plan.id) };
  })();
  const { ctx, pg, errs } = await fresh(seed);
  let found = false;
  for (const tab of ["overview", "budget", "timeline", "vendors", "eventday", "chat"]) {
    await pg.click(`#tab-${tab}`);
    found ||= await pg.evaluate(() => !!document.querySelector(".pwn"));
  }
  const plan = await planNow(pg);
  ok(
    "Security: markup hidden in stored ids, priorities, statuses, roles and risks never reaches the page",
    !found &&
      plan.tasks.every((t) => /^[A-Za-z0-9_-]+$/.test(t.id)) &&
      ["high", "medium", "low"].includes(plan.tasks[1].priority) &&
      plan.vendors[0].status === "Not started" &&
      plan.brief.currency === "INR" &&
      plan.brief.time === "" &&
      plan.chat.length === 0 &&
      plan.aiRisks.items.length === 0,
  );
  ok("No page errors (stored injection)", !errs.length, errs.join(" | "));
  await ctx.close();
}

/** The conversation is a log: new replies are appended, earlier ones are never re-announced. */
async function chatLogJourney(fresh, ok) {
  const { ctx, pg, errs } = await fresh(null, true);
  await pg.click("#openSample");
  await pg.click("#tab-chat");
  await pg.evaluate(() => {
    window.__removedMessages = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        window.__removedMessages += [...record.removedNodes].filter((n) => n.dataset?.key).length;
      }
    }).observe(document.querySelector("#msgs"), { childList: true });
  });
  for (const text of ["What should I focus on this week?", "Any risks I should know about?"]) {
    await pg.fill("#askInput", text);
    await pg.click("#askBtn");
    await pg.waitForFunction(() => !MarigoldTest.state().busy.chat);
  }
  const result = await pg.evaluate(() => ({
    removed: window.__removedMessages,
    shown: document.querySelectorAll("#msgs [data-key]").length,
    role: document.querySelector("#msgs").getAttribute("role"),
  }));
  ok(
    "Chat: replies are appended to a role=log region without re-inserting earlier messages",
    result.removed === 0 && result.shown >= 4 && result.role === "log",
    JSON.stringify(result),
  );
  ok("No page errors (chat log)", !errs.length, errs.join(" | "));
  await ctx.close();
}

/**
 * Runs every journey.
 * @param {(seed?: object, mock?: boolean) => Promise<{ctx, pg, errs}>} fresh
 * @param {(name: string, condition: boolean, info?: string) => void} ok
 */
export async function journeys(fresh, ok) {
  await timelineJourney(fresh, ok);
  await vendorJourney(fresh, ok);
  await eventDayJourney(fresh, ok);
  await ideasJourney(fresh, ok);
  await focusJourney(fresh, ok);
  await proposalInjection(fresh, ok);
  await storedInjection(fresh, ok);
  await chatLogJourney(fresh, ok);
}
