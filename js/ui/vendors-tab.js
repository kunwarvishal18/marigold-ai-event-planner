/**
 * @file Vendors tab: the status pipeline, one card per vendor type (see vendor-card.js), and the
 * handlers for editing vendors, their checklists and the options being compared. Marigold never
 * invents real vendors.
 */
import { commit, commitQuietly } from "../actions/history.js";
import { VENDOR_STATUSES, isOneOf } from "../core/constants.js";
import { moneyIn } from "../core/format.js";
import { newVendor } from "../core/model.js";
import { clip, normalizeName, safeAmount, uid } from "../core/util.js";
import { requirePlan, state } from "../services/state.js";
import { view } from "../services/view.js";
import { $, $$, asField, field, isChecked, onEach, onSubmit, setHtml } from "./dom.js";
import { toast } from "./toast.js";
import { vendorCard } from "./vendor-card.js";

/** @typedef {import("../core/model.js").Vendor} Vendor */

/** Text limits per free-text vendor field. */
const TEXT_LIMITS = { name: 80, contact: 80, notes: 600 };
/** @type {ReadonlyArray<keyof typeof TEXT_LIMITS>} */
const TEXT_FIELDS = ["name", "contact", "notes"];
/** Fields whose value (from a select, date or time input) is stored as it is. */
const PLAIN_FIELDS = /** @type {const} */ (["status", "payment", "dueFixed", "arrival"]);
const COST_FIELDS = /** @type {const} */ (["estimate", "quote"]);
const NEW_VENDOR_CHECKLIST = ["Request a quote", "Confirm availability for the date"];
const NEW_VENDOR_LEAD_DAYS = 14;

/**
 * Renders the Vendors tab.
 * @param {import("../core/risks.js").Analysis} analysis
 */
export function renderVendors(analysis) {
  const plan = requirePlan();
  const money = moneyIn(plan.brief.currency);
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
    <div class="vendor-list">${plan.vendors.map((vendor) => vendorCard(vendor, plan, analysis.schedule, money)).join("")}</div>
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

/** @param {HTMLElement} panel */
function bindVendors(panel) {
  onEach(
    "details.vendor",
    "toggle",
    (details) => {
      const vendorId = details.dataset.vid || "";
      const open = details instanceof HTMLDetailsElement && details.open;
      if (open) state.expandedVendors.add(vendorId);
      else state.expandedVendors.delete(vendorId);
    },
    panel,
  );
  onEach("[data-vf]", "change", updateVendorField, panel);
  onEach(
    "[data-vcheck]",
    "change",
    (checkbox) =>
      commitQuietly("Vendor check", (plan) => {
        for (const vendor of plan.vendors) {
          const item = vendor.checklist.find((x) => x.id === checkbox.dataset.vcheck);
          if (item) item.done = isChecked(checkbox);
        }
      }),
    panel,
  );
  for (const form of $$("[data-vadd]", panel)) {
    onSubmit(form, () => addChecklistItem(form));
  }
  for (const form of $$("[data-optadd]", panel)) {
    onSubmit(form, () => addOption(form.dataset.optadd || ""));
  }
  onEach("[data-choose]", "click", (button) => chooseOption(button.dataset.choose), panel);
  onEach(
    "[data-delopt]",
    "click",
    (button) =>
      commitQuietly("Removed vendor option", (plan) => {
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

/**
 * The change one edited vendor field makes, or null when the value is invalid. Free text is
 * clipped; costs must be whole amounts in range; "None" unlinks the budget line.
 * @param {string} name the field's data-vf name
 * @param {string} raw the field's value
 * @returns {Partial<Vendor>|null}
 */
function vendorChange(name, raw) {
  if (isOneOf(name, TEXT_FIELDS)) return { [name]: clip(raw, TEXT_LIMITS[name]) };
  if (isOneOf(name, PLAIN_FIELDS)) return { [name]: raw };
  if (name === "lineId") return { lineId: raw || null };
  if (!isOneOf(name, COST_FIELDS)) return {};
  const amount = raw.trim() === "" ? null : Math.round(Number(raw));
  if (amount != null && safeAmount(amount) == null) return null;
  return { [name]: amount };
}

/**
 * Saves an edited vendor field.
 * @param {HTMLElement} input
 */
function updateVendorField(input) {
  const card = input.closest("[data-vid]");
  const vendorId = card instanceof HTMLElement ? card.dataset.vid : undefined;
  const name = input.dataset.vf || "";
  const change = vendorChange(name, asField(input).value);
  if (!change) {
    toast("Costs must be a number from 0 to 1 trillion.", true);
    view.render();
    return;
  }
  commitQuietly(`Updated ${name} for vendor`, (plan) => {
    const vendor = plan.vendors.find((item) => item.id === vendorId);
    if (vendor) Object.assign(vendor, change);
  });
}

/**
 * @param {string|undefined} vendorId
 * @returns {(plan: import("../core/model.js").Plan) => Vendor|undefined}
 */
const vendorIn = (vendorId) => (plan) => plan.vendors.find((vendor) => vendor.id === vendorId);

/**
 * Adds the item typed into a vendor's "Add checklist item" form.
 * @param {HTMLElement} form
 */
function addChecklistItem(form) {
  const text = clip(field("input", form).value, 160);
  if (!text) return;
  const findVendor = vendorIn(form.dataset.vadd);
  commitQuietly("Added vendor checklist item", (plan) =>
    findVendor(plan)?.checklist.push({ id: uid(), text, done: false }),
  );
}

/**
 * Adds the option typed into a vendor's "Compare options" form.
 * @param {string} vendorId
 */
function addOption(vendorId) {
  /** @param {string} prefix */
  const valueOf = (prefix) => field(`#${prefix}-${CSS.escape(vendorId)}`).value;
  const name = clip(valueOf("on"), 80);
  if (!name) return;
  const quoteText = valueOf("oq").trim();
  if (quoteText !== "" && safeAmount(quoteText) == null) {
    toast("Quote must be a number from 0 to 1 trillion.", true);
    return;
  }
  const option = {
    id: uid(),
    name,
    contact: clip(valueOf("oc"), 80),
    quote: quoteText === "" ? null : safeAmount(quoteText),
    notes: clip(valueOf("oo"), 140),
  };
  const findVendor = vendorIn(vendorId);
  commitQuietly("Added vendor option", (plan) => findVendor(plan)?.options.push(option));
}

/**
 * Copies an option's details onto its vendor and moves it to at least "Shortlisted".
 * @param {string|undefined} optionId
 */
function chooseOption(optionId) {
  commitQuietly("Chose a vendor option", (plan) => {
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

/** Adds the vendor type from the "Add a vendor type" form, unless it is already listed. */
function addVendor() {
  const category = clip(field("#nv-cat").value, 60);
  if (!category) return;
  const plan = requirePlan();
  if (plan.vendors.some((vendor) => normalizeName(vendor.category) === normalizeName(category))) {
    toast(`${category} is already in the list.`, true);
    return;
  }
  const critical = !!field("#nv-crit").value;
  commit(`Added vendor “${category}”`, (draft) => {
    const vendor = newVendor(
      {
        category,
        critical,
        bookByDaysBefore: NEW_VENDOR_LEAD_DAYS,
        checklist: NEW_VENDOR_CHECKLIST,
        questions: [],
      },
      draft.budget,
      "you",
    );
    draft.vendors.push(vendor);
    state.expandedVendors.add(vendor.id);
  });
}
