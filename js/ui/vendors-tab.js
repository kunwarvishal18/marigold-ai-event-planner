/**
 * @file Vendors tab: one card per vendor type with booking details, a checklist, questions to ask,
 * and side-by-side comparison of options. Marigold never invents real vendors.
 */
import { commit } from "../actions/history.js";
import { PAYMENT_STATES, VENDOR_STATUSES, isBooked } from "../core/constants.js";
import { toIsoDate } from "../core/dates.js";
import { escapeHtml, formatMoney, formatShortDate } from "../core/format.js";
import { newVendor } from "../core/model.js";
import { MAX_AMOUNT, clip, isNumeric, normalizeName, safeAmount, uid } from "../core/util.js";
import { state } from "../services/state.js";
import { view } from "../services/view.js";
import { $, attrIf, onEach, onSubmit, setHtml } from "./dom.js";
import { toast } from "./toast.js";

/** Text limits per editable vendor field. */
const FIELD_LIMITS = { name: 80, contact: 80, notes: 600 };
const NEW_VENDOR_CHECKLIST = ["Request a quote", "Confirm availability for the date"];
const NEW_VENDOR_LEAD_DAYS = 14;

const allocationFor = (plan, vendor) =>
  plan.budget.find((line) => line.id === vendor.lineId)?.amount;
const selectOptions = (values, selected) =>
  values
    .map((value) => `<option ${attrIf(selected === value, "selected")}>${value}</option>`)
    .join("");

/**
 * The editable fields of one vendor card.
 * @returns {string}
 */
function vendorFields(vendor, plan, sched) {
  const id = vendor.id;
  const lineOptions = plan.budget
    .map(
      (line) =>
        `<option value="${escapeHtml(line.id)}" ${attrIf(vendor.lineId === line.id, "selected")}>${escapeHtml(line.category)}</option>`,
    )
    .join("");
  const allocation = allocationFor(plan, vendor);
  const due = sched.vendorDue[id];
  const estimateHint =
    allocation != null ? `Budget line: ${Math.round(allocation)}` : "Your estimate";
  return `<div class="vgrid">
    <div><label for="vn-${escapeHtml(id)}">Vendor name</label><input id="vn-${escapeHtml(id)}" data-vf="name" value="${escapeHtml(vendor.name)}" placeholder="Not chosen yet"></div>
    <div><label for="vc-${escapeHtml(id)}">Contact</label><input id="vc-${escapeHtml(id)}" data-vf="contact" value="${escapeHtml(vendor.contact)}" placeholder="Phone or email"></div>
    <div><label for="vs-${escapeHtml(id)}">Booking status</label><select id="vs-${escapeHtml(id)}" data-vf="status">${selectOptions(VENDOR_STATUSES, vendor.status)}</select></div>
    <div><label for="vp-${escapeHtml(id)}">Payment</label><select id="vp-${escapeHtml(id)}" data-vf="payment">${selectOptions(PAYMENT_STATES, vendor.payment)}</select></div>
    <div><label for="ve-${escapeHtml(id)}">Estimated cost</label><input id="ve-${escapeHtml(id)}" type="number" min="0" data-vf="estimate" value="${vendor.estimate ?? ""}" placeholder="${estimateHint}"></div>
    <div><label for="vq-${escapeHtml(id)}">Quoted cost</label><input id="vq-${escapeHtml(id)}" type="number" min="0" data-vf="quote" value="${vendor.quote ?? ""}" placeholder="From the vendor"></div>
    <div><label for="vd-${escapeHtml(id)}">Book by</label><input id="vd-${escapeHtml(id)}" type="date" data-vf="dueFixed" value="${escapeHtml(vendor.dueFixed || (due ? toIsoDate(due) : ""))}"></div>
    <div><label for="va-${escapeHtml(id)}">Event-day arrival</label><input id="va-${escapeHtml(id)}" type="time" data-vf="arrival" value="${escapeHtml(vendor.arrival)}"></div>
    <div><label for="vl-${escapeHtml(id)}">Budget category</label><select id="vl-${escapeHtml(id)}" data-vf="lineId"><option value="">None</option>${lineOptions}</select></div>
  </div>
  <div><label for="vno-${escapeHtml(id)}">Notes</label><textarea id="vno-${escapeHtml(id)}" data-vf="notes" rows="2">${escapeHtml(vendor.notes)}</textarea></div>`;
}

function cardSummary(vendor, plan, sched, money) {
  const stage = VENDOR_STATUSES.indexOf(vendor.status) + 1;
  const due = sched.vendorDue[vendor.id];
  const late =
    vendor.critical && !isBooked(vendor) && due && due < sched.today && sched.daysLeft >= 0;
  const allocation = allocationFor(plan, vendor);
  const checksDone = vendor.checklist.filter((item) => item.done).length;

  let cost = "";
  if (isNumeric(vendor.quote)) {
    const overBudget = allocation != null && vendor.quote > allocation;
    const versus = allocation != null ? ` vs ${money(allocation)} allocated` : "";
    cost = `<span class="${overBudget ? "neg" : ""}">Quote ${money(vendor.quote)}${versus}</span>`;
  } else if (allocation != null) {
    cost = `<span>Allocated ${money(allocation)}</span>`;
  }
  const name = vendor.name ? escapeHtml(vendor.name) : "<i>Vendor not chosen yet</i>";
  return `<summary>
    <h3>${escapeHtml(vendor.category)} <span class="status s${stage}">${escapeHtml(vendor.status)}</span>${vendor.critical ? '<span class="badge">critical</span>' : ""}</h3>
    <span class="note">${checksDone}/${vendor.checklist.length} checks</span>
    <div class="vsub"><span>${name}</span><span class="${late ? "overdue" : ""}">Book by ${due ? formatShortDate(due) : "—"}${late ? " · late" : ""}</span>${cost}<span>${escapeHtml(vendor.payment)}</span></div>
  </summary>`;
}

function checklistSection(vendor) {
  const items = vendor.checklist
    .map(
      (item) =>
        `<li><input type="checkbox" id="vk-${escapeHtml(item.id)}" data-vcheck="${escapeHtml(item.id)}" ${attrIf(item.done, "checked")}><label for="vk-${escapeHtml(item.id)}" class="plain-label ${item.done ? "done" : ""}">${escapeHtml(item.text)}</label></li>`,
    )
    .join("");
  return `<div><span class="lbl">Checklist</span><ul class="checks">${items}</ul>
    <form class="inline-add mt-sm" data-vadd="${escapeHtml(vendor.id)}"><label class="sr" for="vadd-${escapeHtml(vendor.id)}">New checklist item</label><input id="vadd-${escapeHtml(vendor.id)}" placeholder="Add checklist item" maxlength="160"><button class="btn ghost small">Add</button></form>
  </div>`;
}

function optionsSection(vendor, money) {
  const id = vendor.id;
  const table = vendor.options.length
    ? `<div class="tablewrap"><table><thead><tr><th>Option</th><th>Contact</th><th class="num">Quote</th><th>Notes</th><th></th></tr></thead><tbody>${vendor.options
        .map(
          (option) => `<tr>
            <td>${escapeHtml(option.name)}</td>
            <td>${escapeHtml(option.contact)}</td>
            <td class="num">${isNumeric(option.quote) ? money(option.quote) : "—"}</td>
            <td>${escapeHtml(option.notes)}</td>
            <td><div class="btnrow"><button type="button" class="btn ghost small" data-choose="${escapeHtml(option.id)}">Choose</button><button type="button" class="iconbtn" data-delopt="${escapeHtml(option.id)}" aria-label="Remove ${escapeHtml(option.name)}">Remove</button></div></td>
          </tr>`,
        )
        .join("")}</tbody></table></div>`
    : '<p class="hint">No options yet. Add each vendor you are considering to compare quotes side by side.</p>';
  return `<div><span class="lbl">Compare options</span>
    ${table}
    <form class="vgrid mt-md" data-optadd="${escapeHtml(id)}">
      <div><label for="on-${escapeHtml(id)}">Option name</label><input id="on-${escapeHtml(id)}" maxlength="80" required></div>
      <div><label for="oc-${escapeHtml(id)}">Contact</label><input id="oc-${escapeHtml(id)}" maxlength="80"></div>
      <div><label for="oq-${escapeHtml(id)}">Quote</label><input id="oq-${escapeHtml(id)}" type="number" min="0"></div>
      <div><label for="oo-${escapeHtml(id)}">Notes</label><input id="oo-${escapeHtml(id)}" maxlength="140"></div>
      <div class="align-end"><button class="btn ghost small">Add option</button></div>
    </form>
  </div>`;
}

function vendorCard(vendor, plan, sched, money) {
  const questions = vendor.questions.length
    ? `<div><span class="lbl">Questions to ask</span><ul class="list-indent">${vendor.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul></div>`
    : "";
  const remove =
    vendor.origin === "you"
      ? `<button type="button" class="btn danger small align-start" data-delv="${escapeHtml(vendor.id)}">Remove this vendor</button>`
      : "";
  return `<details class="vendor" data-vid="${escapeHtml(vendor.id)}" ${attrIf(state.openV.has(vendor.id), "open")}>
    ${cardSummary(vendor, plan, sched, money)}
    <div class="vbody">
      ${vendorFields(vendor, plan, sched)}
      ${checklistSection(vendor)}
      ${questions}
      ${optionsSection(vendor, money)}
      ${remove}
    </div>
  </details>`;
}

/**
 * Renders the Vendors tab.
 * @param {import("../core/risks.js").Analysis} analysis
 */
export function renderVendors(analysis) {
  const plan = state.plan;
  const money = (amount) => formatMoney(amount, plan.brief.currency);
  const pipeline = VENDOR_STATUSES.map((status) => {
    const count = plan.vendors.filter((vendor) => vendor.status === status).length;
    return `<span class="pipe"><b>${count}</b>${status}</span>`;
  }).join("");
  const panel = $("#panel-vendors");
  setHtml(
    panel,
    `<div class="toolbar"><h2>Vendors</h2></div>
    <div class="pipeline" aria-label="Vendors by status">${pipeline}</div>
    <p class="placeholder-note">Marigold doesn't search for real vendors, so it never invents names, prices, ratings or availability. Add the vendors you find, and compare their quotes in each card.</p>
    <div class="vendor-list">${plan.vendors.map((vendor) => vendorCard(vendor, plan, analysis.sc, money)).join("")}</div>
    <form class="card" id="addVendor"><h2>Add a vendor type</h2>
      <div class="row2">
        <div><label for="nv-cat">Category</label><input id="nv-cat" maxlength="60" placeholder="e.g. Florist" required></div>
        <div><label for="nv-crit">Critical?</label><select id="nv-crit"><option value="">No</option><option value="1">Yes</option></select></div>
      </div>
      <div class="btnrow"><button class="btn small">Add vendor</button></div>
    </form>`,
  );
  bindVendors(panel);
}

/** Applies a non-structural change to the vendor (or item) the handler belongs to. */
const quietCommit = (title, change) => commit(title, change, { structural: false });

function bindVendors(panel) {
  onEach(
    "details.vendor",
    "toggle",
    (details) => {
      if (details.open) state.openV.add(details.dataset.vid);
      else state.openV.delete(details.dataset.vid);
    },
    panel,
  );
  onEach("[data-vf]", "change", updateVendorField, panel);
  onEach(
    "[data-vcheck]",
    "change",
    (checkbox) =>
      quietCommit("Vendor check", (plan) => {
        for (const vendor of plan.vendors) {
          const item = vendor.checklist.find((x) => x.id === checkbox.dataset.vcheck);
          if (item) item.done = checkbox.checked;
        }
      }),
    panel,
  );
  for (const form of panel.querySelectorAll("[data-vadd]")) {
    onSubmit(form, () => addChecklistItem(form));
  }
  for (const form of panel.querySelectorAll("[data-optadd]")) {
    onSubmit(form, () => addOption(form.dataset.optadd));
  }
  onEach("[data-choose]", "click", (button) => chooseOption(button.dataset.choose), panel);
  onEach(
    "[data-delopt]",
    "click",
    (button) =>
      quietCommit("Removed vendor option", (plan) => {
        for (const vendor of plan.vendors) {
          vendor.options = vendor.options.filter((option) => option.id !== button.dataset.delopt);
        }
      }),
    panel,
  );
  onEach(
    "[data-delv]",
    "click",
    (button) =>
      commit("Removed a vendor", (plan) => {
        plan.vendors = plan.vendors.filter((vendor) => vendor.id !== button.dataset.delv);
      }),
    panel,
  );
  onSubmit($("#addVendor"), addVendor);
}

function updateVendorField(input) {
  const vendorId = input.closest("[data-vid]").dataset.vid;
  const field = input.dataset.vf;
  let value = input.value;
  if (field === "estimate" || field === "quote") {
    value = value.trim() === "" ? null : Math.round(+value);
    if (value != null && (!Number.isFinite(value) || value < 0 || value > MAX_AMOUNT)) {
      toast("Costs must be a number from 0 to 1 trillion.", true);
      view.render();
      return;
    }
  }
  if (Object.hasOwn(FIELD_LIMITS, field)) value = clip(value, FIELD_LIMITS[field]);
  quietCommit(`Updated ${field} for vendor`, (plan) => {
    plan.vendors.find((vendor) => vendor.id === vendorId)[field] = value;
  });
}

function addChecklistItem(form) {
  const text = clip(form.querySelector("input").value, 160);
  if (!text) return;
  quietCommit("Added vendor checklist item", (plan) =>
    plan.vendors
      .find((vendor) => vendor.id === form.dataset.vadd)
      .checklist.push({ id: uid(), text, done: false }),
  );
}

function addOption(vendorId) {
  const name = clip($(`#on-${vendorId}`).value, 80);
  if (!name) return;
  const quoteText = $(`#oq-${vendorId}`).value.trim();
  if (quoteText !== "" && safeAmount(quoteText) == null) {
    toast("Quote must be a number from 0 to 1 trillion.", true);
    return;
  }
  quietCommit("Added vendor option", (plan) =>
    plan.vendors
      .find((vendor) => vendor.id === vendorId)
      .options.push({
        id: uid(),
        name,
        contact: clip($(`#oc-${vendorId}`).value, 80),
        quote: quoteText === "" ? null : safeAmount(quoteText),
        notes: clip($(`#oo-${vendorId}`).value, 140),
      }),
  );
}

/** Copies an option's details onto its vendor and moves it to at least "Shortlisted". */
function chooseOption(optionId) {
  quietCommit("Chose a vendor option", (plan) => {
    for (const vendor of plan.vendors) {
      const option = vendor.options.find((x) => x.id === optionId);
      if (!option) continue;
      vendor.name = option.name;
      vendor.contact = option.contact;
      vendor.quote = option.quote;
      if (VENDOR_STATUSES.indexOf(vendor.status) < 1) vendor.status = "Shortlisted";
    }
  });
}

function addVendor() {
  const category = clip($("#nv-cat").value, 60);
  if (!category) return;
  const plan = state.plan;
  if (plan.vendors.some((vendor) => normalizeName(vendor.category) === normalizeName(category))) {
    toast(`${category} is already in the list.`, true);
    return;
  }
  const critical = !!$("#nv-crit").value;
  commit(`Added vendor “${category}”`, (draft) => {
    const vendor = newVendor(
      {
        category,
        critical,
        bookByDaysBefore: NEW_VENDOR_LEAD_DAYS,
        checklist: NEW_VENDOR_CHECKLIST,
      },
      draft.budget,
      "you",
    );
    draft.vendors.push(vendor);
    state.openV.add(vendor.id);
  });
}
