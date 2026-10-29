/**
 * @file One vendor card in the Vendors tab: summary line, booking fields, checklist, questions to
 * ask and the option comparison. Markup only; vendors-tab.js wires the events.
 */
import { PAYMENT_STATES, VENDOR_STATUSES } from "../core/constants.js";
import { toIsoDate } from "../core/dates.js";
import { escapeHtml, formatShortDate } from "../core/format.js";
import { daysToBook } from "../core/scheduler.js";
import { isNumeric } from "../core/util.js";
import { state } from "../services/state.js";
import { attrIf } from "./dom.js";

/** @typedef {import("../core/model.js").Plan} Plan */
/** @typedef {import("../core/model.js").Vendor} Vendor */
/** @typedef {import("../core/scheduler.js").Schedule} Schedule */
/** @typedef {(amount: number|null) => string} Money */

/**
 * The amount allocated to the vendor's budget line, if it has one.
 * @param {Plan} plan
 * @param {Vendor} vendor
 * @returns {number|undefined}
 */
const allocationFor = (plan, vendor) =>
  plan.budget.find((line) => line.id === vendor.lineId)?.amount;

/**
 * @param {readonly string[]} values
 * @param {string} selected
 * @returns {string} <option> markup
 */
const selectOptions = (values, selected) =>
  values
    .map((value) => `<option ${attrIf(selected === value, "selected")}>${value}</option>`)
    .join("");

/**
 * The editable fields of one vendor card.
 * @param {Vendor} vendor
 * @param {Plan} plan
 * @param {Schedule} sched
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

/**
 * The quote against the vendor's allocation (flagged when over), or just the allocation.
 * @param {number|null} quote
 * @param {number|undefined} allocation
 * @param {Money} money
 * @returns {string} markup, or "" when there is neither
 */
function costSummary(quote, allocation, money) {
  if (quote != null && isNumeric(quote)) {
    if (allocation == null) return `<span>Quote ${money(quote)}</span>`;
    const overBudget = quote > allocation ? "neg" : "";
    return `<span class="${overBudget}">Quote ${money(quote)} vs ${money(allocation)} allocated</span>`;
  }
  return allocation != null ? `<span>Allocated ${money(allocation)}</span>` : "";
}

/**
 * @param {Vendor} vendor
 * @param {Plan} plan
 * @param {Schedule} sched
 * @param {Money} money
 * @returns {string}
 */
function cardSummary(vendor, plan, sched, money) {
  const stage = VENDOR_STATUSES.indexOf(vendor.status) + 1;
  const due = sched.vendorDue[vendor.id];
  const late = (daysToBook(vendor, sched) ?? 0) < 0;
  const checksDone = vendor.checklist.filter((item) => item.done).length;
  const cost = costSummary(vendor.quote, allocationFor(plan, vendor), money);
  const name = vendor.name ? escapeHtml(vendor.name) : "<i>Vendor not chosen yet</i>";
  return `<summary>
    <h3>${escapeHtml(vendor.category)} <span class="status s${stage}">${escapeHtml(vendor.status)}</span>${vendor.critical ? '<span class="badge">critical</span>' : ""}</h3>
    <span class="note">${checksDone}/${vendor.checklist.length} checks</span>
    <div class="vsub"><span>${name}</span><span class="${late ? "overdue" : ""}">Book by ${due ? formatShortDate(due) : "—"}${late ? " · late" : ""}</span>${cost}<span>${escapeHtml(vendor.payment)}</span></div>
  </summary>`;
}

/**
 * @param {Vendor} vendor
 * @returns {string}
 */
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

/**
 * @param {Vendor} vendor
 * @param {Money} money
 * @returns {string}
 */
function optionsSection(vendor, money) {
  const id = vendor.id;
  const table = vendor.options.length
    ? `<div class="tablewrap"><table><thead><tr><th>Option</th><th>Contact</th><th class="num">Quote</th><th>Notes</th><th></th></tr></thead><tbody>${vendor.options
        .map(
          (option) => `<tr>
            <td>${escapeHtml(option.name)}</td>
            <td>${escapeHtml(option.contact)}</td>
            <td class="num">${option.quote != null && isNumeric(option.quote) ? money(option.quote) : "—"}</td>
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

/**
 * One collapsible vendor card; it stays open across re-renders once the person opens it.
 * @param {Vendor} vendor
 * @param {Plan} plan
 * @param {Schedule} sched
 * @param {Money} money
 * @returns {string}
 */
export function vendorCard(vendor, plan, sched, money) {
  const questions = vendor.questions.length
    ? `<div><span class="lbl">Questions to ask</span><ul class="list-indent">${vendor.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul></div>`
    : "";
  const remove =
    vendor.origin === "you"
      ? `<button type="button" class="btn danger small align-start" data-delv="${escapeHtml(vendor.id)}">Remove this vendor</button>`
      : "";
  return `<details class="vendor" data-vid="${escapeHtml(vendor.id)}" ${attrIf(state.expandedVendors.has(vendor.id), "open")}>
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
