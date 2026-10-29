/**
 * @file Event day tab: countdown, pending critical tasks, the run of show, vendor arrivals, key
 * contacts, and the emergency and weather checklists.
 */
import { commit } from "../actions/history.js";
import { DAY_MS, daysBetween, parseIsoDate, today } from "../core/dates.js";
import { escapeHtml, formatDate, formatShortDate } from "../core/format.js";
import { clip, uid } from "../core/util.js";
import { state } from "../services/state.js";
import { $, attrIf, onEach, onSubmit, setHtml } from "./dom.js";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const CRITICAL_TASKS_SHOWN = 8;

/**
 * Time left until the event starts, e.g. "12 days", "1d 4h 30m", "Today", "Event passed".
 * @returns {string}
 */
function countdownText() {
  if (!state.plan) return "";
  const { brief } = state.plan;
  const eventDate = parseIsoDate(brief.date);
  if (!eventDate) return "No date set";
  const [hours, minutes] = (brief.time || "00:00").split(":").map(Number);
  const startsAt = new Date(eventDate);
  startsAt.setHours(hours || 0, minutes || 0, 0, 0);

  const msLeft = startsAt - Date.now();
  if (msLeft < 0) return daysBetween(eventDate, today()) === 0 ? "Today" : "Event passed";
  const days = Math.floor(msLeft / DAY_MS);
  const hoursLeft = Math.floor((msLeft % DAY_MS) / HOUR_MS);
  const minutesLeft = Math.floor((msLeft % HOUR_MS) / MINUTE_MS);
  if (days >= 2) return `${days} days`;
  return `${days ? `${days}d ` : ""}${hoursLeft}h ${minutesLeft}m`;
}

/** Updates the countdown in place, if the Event day tab is open. */
export function refreshCountdown() {
  const element = $("#countdown");
  if (element) element.textContent = countdownText();
}

function checklistCard(plan, key, title) {
  const items = plan.dayOf[key]
    .map(
      (item) =>
        `<li><input type="checkbox" id="dc-${escapeHtml(item.id)}" data-dchk="${escapeHtml(key)}:${escapeHtml(item.id)}" ${attrIf(item.done, "checked")}><label for="dc-${escapeHtml(item.id)}" class="plain-label ${item.done ? "done" : ""}">${escapeHtml(item.text)}</label></li>`,
    )
    .join("");
  return `<div class="card"><h2>${title}</h2>
    <ul class="checks">${items}</ul>
    <form class="inline-add" data-dadd="${escapeHtml(key)}"><label class="sr" for="da-${escapeHtml(key)}">Add item</label><input id="da-${escapeHtml(key)}" maxlength="140" placeholder="Add item"><button class="btn ghost small">Add</button></form>
  </div>`;
}

function summaryCards(plan, sched) {
  const { brief } = plan;
  const doneCount = plan.tasks.filter((task) => task.done).length;
  const donePct = plan.tasks.length ? (doneCount / plan.tasks.length) * 100 : 0;
  const when = sched.ev
    ? formatDate(sched.ev) + (brief.time ? ` at ${escapeHtml(brief.time)}` : "")
    : "Add a date in Event details";
  const critical = plan.tasks
    .filter((task) => !task.done && task.priority === "high")
    .sort((a, b) => (sched.due[a.id] || 0) - (sched.due[b.id] || 0));
  const criticalList = critical.length
    ? `<ul class="mini">${critical
        .slice(0, CRITICAL_TASKS_SHOWN)
        .map((task) => {
          const due = sched.due[task.id];
          return `<li><span>${escapeHtml(task.title)}</span><span class="${due && due < sched.today ? "overdue" : "note"}">${formatShortDate(due)}</span></li>`;
        })
        .join("")}</ul>`
    : '<p class="hint">No pending high-priority tasks.</p>';
  return `<div class="ed-grid">
    <div class="card">
      <span class="lbl">Countdown</span><div class="countdown" id="countdown">${countdownText()}</div>
      <p class="note flush">${when}</p>
      <span class="lbl mt-sm">Task completion</span><div class="bar"><i class="good" data-width="${donePct}"></i></div>
      <p class="note flush">${doneCount} of ${plan.tasks.length} tasks done</p>
    </div>
    <div class="card"><h2>Pending critical tasks</h2>${criticalList}</div>
  </div>`;
}

function runOfShowCard(plan) {
  const rows = plan.runOfShow
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time))
    .map(
      (row) => `<div class="sched-row" data-rid="${escapeHtml(row.id)}">
        <label class="sr" for="rt-${escapeHtml(row.id)}">Time</label><input id="rt-${escapeHtml(row.id)}" type="time" data-rf="time" value="${escapeHtml(row.time)}">
        <label class="sr" for="ri-${escapeHtml(row.id)}">Item</label><input id="ri-${escapeHtml(row.id)}" data-rf="item" value="${escapeHtml(row.item)}">
        <label class="sr" for="ro-${escapeHtml(row.id)}">Owner</label><input class="owner" id="ro-${escapeHtml(row.id)}" data-rf="owner" value="${escapeHtml(row.owner)}" placeholder="Owner">
        <button type="button" class="iconbtn" data-rdel="${escapeHtml(row.id)}" aria-label="Remove ${escapeHtml(row.item)}">Remove</button>
      </div>`,
    )
    .join("");
  return `<div class="card"><h2>Run of show</h2>
    ${rows || '<p class="hint">No schedule yet.</p>'}
    <form class="sched-row" id="addRun">
      <label class="sr" for="nr-time">Time</label><input id="nr-time" type="time" required>
      <label class="sr" for="nr-item">Item</label><input id="nr-item" placeholder="What happens" maxlength="120" required>
      <label class="sr" for="nr-owner">Owner</label><input class="owner" id="nr-owner" placeholder="Owner" maxlength="60">
      <button class="btn ghost small">Add</button>
    </form>
  </div>`;
}

function arrivalsAndContacts(plan) {
  const arrivals = plan.vendors
    .filter((vendor) => vendor.arrival)
    .sort((a, b) => a.arrival.localeCompare(b.arrival));
  const arrivalList = arrivals.length
    ? `<ul class="mini">${arrivals
        .map(
          (vendor) =>
            `<li><span>${escapeHtml(vendor.arrival)} · ${escapeHtml(vendor.category)}${vendor.name ? ` (${escapeHtml(vendor.name)})` : ""}</span><span class="note">${escapeHtml(vendor.contact)}</span></li>`,
        )
        .join("")}</ul>`
    : '<p class="hint">Set arrival times in each vendor card to see them here.</p>';

  const vendorContacts = plan.vendors.filter((vendor) => vendor.contact);
  const people = plan.dayOf.contacts.map(
    (contact) =>
      `<li><span><b>${escapeHtml(contact.name)}</b> · ${escapeHtml(contact.role)}</span><span>${escapeHtml(contact.phone)} <button type="button" class="iconbtn" data-cdel="${escapeHtml(contact.id)}" aria-label="Remove ${escapeHtml(contact.name)}">Remove</button></span></li>`,
  );
  const vendors = vendorContacts.map(
    (vendor) =>
      `<li><span><b>${escapeHtml(vendor.name || vendor.category)}</b> · ${escapeHtml(vendor.category)}</span><span>${escapeHtml(vendor.contact)}</span></li>`,
  );
  const contactList =
    people.length || vendors.length
      ? `<ul class="mini">${people.join("")}${vendors.join("")}</ul>`
      : '<p class="hint">Add the people to call on the day.</p>';

  return `<div class="ed-grid">
    <div class="card"><h2>Vendor arrivals</h2>${arrivalList}</div>
    <div class="card"><h2>Key contacts</h2>
      ${contactList}
      <form class="vgrid" id="addContact">
        <div><label for="nc-name">Name</label><input id="nc-name" maxlength="60" required></div>
        <div><label for="nc-role">Role</label><input id="nc-role" maxlength="60"></div>
        <div><label for="nc-phone">Phone</label><input id="nc-phone" maxlength="40"></div>
        <div class="align-end"><button class="btn ghost small">Add contact</button></div>
      </form>
    </div>
  </div>`;
}

/**
 * Renders the Event day tab.
 * @param {import("../core/risks.js").Analysis} analysis
 */
export function renderEventDay(analysis) {
  const plan = state.plan;
  const panel = $("#panel-eventday");
  setHtml(
    panel,
    `<div class="toolbar"><h2>Event day command center</h2></div>
    ${summaryCards(plan, analysis.sc)}
    ${runOfShowCard(plan)}
    ${arrivalsAndContacts(plan)}
    <div class="ed-grid">${checklistCard(plan, "emergency", "Emergency checklist")}${checklistCard(plan, "weather", "Weather contingency")}</div>
    <p class="hint">Marigold doesn't fetch live weather. Check a forecast service in the days before the event and work through the weather checklist.</p>`,
  );
  bindEventDay(panel);
}

const quietCommit = (title, change) => commit(title, change, { structural: false });

function bindEventDay(panel) {
  onEach(
    "[data-rf]",
    "change",
    (input) =>
      quietCommit("Edited run of show", (plan) => {
        const row = plan.runOfShow.find((x) => x.id === input.closest("[data-rid]").dataset.rid);
        row[input.dataset.rf] = clip(input.value, 120);
      }),
    panel,
  );
  onEach(
    "[data-rdel]",
    "click",
    (button) =>
      quietCommit("Removed schedule item", (plan) => {
        plan.runOfShow = plan.runOfShow.filter((row) => row.id !== button.dataset.rdel);
      }),
    panel,
  );
  onSubmit($("#addRun"), () => {
    const time = $("#nr-time").value;
    const item = clip($("#nr-item").value, 120);
    if (!time || !item) return;
    quietCommit("Added schedule item", (plan) =>
      plan.runOfShow.push({ id: uid(), time, item, owner: clip($("#nr-owner").value, 60) }),
    );
  });
  onEach(
    "[data-dchk]",
    "change",
    (checkbox) => {
      const [listKey, itemId] = checkbox.dataset.dchk.split(":");
      quietCommit("Checklist", (plan) => {
        plan.dayOf[listKey].find((item) => item.id === itemId).done = checkbox.checked;
      });
    },
    panel,
  );
  for (const form of panel.querySelectorAll("[data-dadd]")) {
    onSubmit(form, () => {
      const text = clip(form.querySelector("input").value, 140);
      if (!text) return;
      quietCommit("Added checklist item", (plan) =>
        plan.dayOf[form.dataset.dadd].push({ id: uid(), text, done: false }),
      );
    });
  }
  onEach(
    "[data-cdel]",
    "click",
    (button) =>
      quietCommit("Removed contact", (plan) => {
        plan.dayOf.contacts = plan.dayOf.contacts.filter((c) => c.id !== button.dataset.cdel);
      }),
    panel,
  );
  onSubmit($("#addContact"), () => {
    const name = clip($("#nc-name").value, 60);
    if (!name) return;
    quietCommit("Added contact", (plan) =>
      plan.dayOf.contacts.push({
        id: uid(),
        name,
        role: clip($("#nc-role").value, 60),
        phone: clip($("#nc-phone").value, 40),
      }),
    );
  });
}
