/**
 * @file The event details form: reading, validating and filling the brief, its buttons, and the
 * generation progress and error messages under it.
 */
import { generate } from "../actions/assistant.js";
import { createTemplate, reviewDetails } from "../actions/plans.js";
import { MAX_GUESTS } from "../core/constants.js";
import { daysBetween, parseIsoDate, today } from "../core/dates.js";
import { escapeHtml } from "../core/format.js";
import { MAX_AMOUNT, clip } from "../core/util.js";
import { isClaudeOn } from "../services/claude.js";
import { state } from "../services/state.js";
import { $, $$, attrIf, setHtml } from "./dom.js";

/** Fields with an inline error message (#e-<name>) next to their input (#f-<name>). */
const CHECKED_FIELDS = ["name", "date", "guests", "budget"];
const MS_PER_SECOND = 1000;

/** Re-renders the form title and buttons for the current mode and busy state. */
export function renderForm() {
  const editing = state.mode === "edit" && !!state.plan;
  const busy = !!state.busy.gen;
  const claudeOn = isClaudeOn();
  $("#formTitle").textContent = editing ? "Event details" : "New event";
  $("#newEventBtn").hidden = !state.plan;

  const stopButton = busy
    ? '<button class="btn ghost small" type="button" id="stopGen">Stop</button>'
    : "";
  let buttons;
  if (editing) {
    buttons =
      '<button class="btn" type="submit" id="reviewBtn">Review changes</button>' +
      `<button class="btn ghost" type="button" id="regenBtn" ${attrIf(!claudeOn || busy, "disabled")}>` +
      `${busy ? "Generating…" : "Fresh AI plan"}</button>${stopButton}`;
  } else {
    const label = busy
      ? "Generating…"
      : claudeOn
        ? "Generate plan with AI"
        : "Create template plan";
    const templateButton =
      claudeOn && !busy
        ? '<button class="btn ghost" type="button" id="tplBtn">Use template instead</button>'
        : "";
    buttons =
      `<button class="btn" type="submit" id="genBtn" ${attrIf(busy, "disabled")}>${label}</button>` +
      `${templateButton}${stopButton}`;
  }
  setHtml($("#formBtns"), buttons);
  $("#regenBtn")?.addEventListener("click", () => requestGenerate(true));
  $("#tplBtn")?.addEventListener("click", requestTemplate);
  $("#stopGen")?.addEventListener("click", () => state.ctl.gen?.abort());
}

/**
 * Puts a brief into the form.
 * @param {Partial<import("../core/model.js").Brief>} brief
 */
export function fillForm(brief) {
  state.type = brief.type;
  for (const button of $$("#types button")) {
    button.setAttribute("aria-pressed", button.dataset.type === brief.type);
  }
  $("#f-name").value = brief.name || "";
  $("#f-date").value = brief.date || "";
  $("#f-time").value = brief.time || "";
  $("#f-guests").value = brief.guests ?? "";
  $("#f-cap").value = brief.venueCapacity ?? "";
  $("#f-budget").value = brief.budget ?? "";
  $("#f-cur").value = brief.currency || "INR";
  $("#f-city").value = brief.city || "";
  $("#f-style").value = brief.style || "";
  $("#f-notes").value = brief.notes || "";
  clearErrors();
}

/**
 * Reads the brief from the form (not yet validated).
 * @returns {import("../core/model.js").Brief}
 */
export function readForm() {
  const numberIn = (selector) => {
    const value = $(selector).value.trim();
    return value === "" ? null : +value;
  };
  return {
    type: state.type,
    name: clip($("#f-name").value, 90),
    date: $("#f-date").value,
    time: $("#f-time").value,
    guests: numberIn("#f-guests"),
    venueCapacity: numberIn("#f-cap"),
    budget: numberIn("#f-budget"),
    currency: $("#f-cur").value,
    city: clip($("#f-city").value, 80),
    style: clip($("#f-style").value, 120),
    notes: clip($("#f-notes").value, 600),
  };
}

/** Hides every inline form error. */
export function clearErrors() {
  for (const field of CHECKED_FIELDS) {
    $(`#e-${field}`).hidden = true;
    $(`#f-${field}`).removeAttribute("aria-invalid");
  }
}

/**
 * Checks a brief, shows inline errors and focuses the first invalid field.
 * @param {import("../core/model.js").Brief} brief
 * @param {boolean} editing true when editing an open plan (its past date is still allowed)
 * @returns {boolean} true when the brief is valid
 */
export function validateBrief(brief, editing) {
  const errors = briefErrors(brief, editing);
  clearErrors();
  for (const [field, message] of Object.entries(errors)) {
    const element = $(`#e-${field}`);
    element.textContent = message;
    element.hidden = false;
    $(`#f-${field}`).setAttribute("aria-invalid", "true");
  }
  const first = Object.keys(errors)[0];
  if (first) $(`#f-${first}`).focus();
  return !first;
}

/** @returns {Record<string, string>} error message per invalid field */
function briefErrors(brief, editing) {
  const errors = {};
  if (!brief.name) errors.name = "Give the event a name.";
  const { guests, budget } = brief;
  if (guests == null || !Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS) {
    errors.guests = "Guests must be a whole number from 1 to 100,000.";
  }
  if (budget == null || !(budget > 0) || budget > MAX_AMOUNT) {
    errors.budget = "Enter a budget greater than 0.";
  }
  if (brief.date) {
    const date = parseIsoDate(brief.date);
    const unchangedPastDate = editing && brief.date === state.plan.brief.date;
    if (!date) errors.date = "Enter a valid date.";
    else if (daysBetween(today(), date) < 0 && !unchangedPastDate) {
      errors.date = "That date has passed. Pick today or a future date.";
    }
  }
  if (brief.venueCapacity != null && !(brief.venueCapacity >= 1)) {
    errors.guests = `${errors.guests ? `${errors.guests} ` : ""}Venue capacity must be at least 1.`;
  }
  return errors;
}

/** Handles the form's submit button: review edits to an open plan, or generate a new one. */
export function submitBrief() {
  if (state.mode === "edit" && state.plan) requestReview();
  else requestGenerate(false);
}

/** Validates the form and generates a plan (or a template plan without Claude). */
export function requestGenerate(fresh) {
  if (state.busy.gen) return;
  const brief = readForm();
  if (validateBrief(brief, state.mode === "edit")) generate(brief, fresh);
}

/** Validates the form and creates a template plan. */
export function requestTemplate() {
  const brief = readForm();
  if (validateBrief(brief, false)) createTemplate(brief);
}

/** Validates the form and proposes the edits to the open plan. */
function requestReview() {
  const brief = readForm();
  if (validateBrief(brief, true)) reviewDetails(brief);
}

/** @param {string} text plain text under the form */
export function setFormHint(text) {
  $("#formHint").textContent = text;
}

/**
 * Shows "Claude is drafting your plan" with a seconds counter. The message is announced once;
 * only the aria-hidden counter changes, so screen readers aren't interrupted every second.
 */
export function showGenerationProgress() {
  const startedAt = Date.now();
  setHtml(
    $("#formHint"),
    '<span class="progress"><span class="spinner"></span>Claude is drafting your plan' +
      '<span aria-hidden="true"> (<span id="genSecs">0</span>s)</span>. ' +
      "This usually takes 20–90 seconds.</span>",
  );
  const timer = setInterval(() => {
    const counter = $("#genSecs");
    if (!counter || !state.busy.gen) {
      clearInterval(timer);
      return;
    }
    counter.textContent = Math.round((Date.now() - startedAt) / MS_PER_SECOND);
  }, MS_PER_SECOND);
}

/**
 * Shows why generation failed, with Retry and template buttons unless the person cancelled.
 * @param {string} message
 * @param {boolean} canRetry
 * @param {boolean} fresh whether the failed request was a "Fresh AI plan"
 */
export function showGenerationError(message, canRetry, fresh) {
  const hint = $("#formHint");
  setHtml(hint, `<span class="field-err flush" role="alert">${escapeHtml(message)}</span>`);
  if (!canRetry) return;
  const row = document.createElement("div");
  row.className = "btnrow";
  row.innerHTML =
    '<button type="button" class="btn small" id="retryGen">Retry</button>' +
    '<button type="button" class="btn ghost small" id="tplInstead">Use template instead</button>';
  hint.append(row);
  $("#retryGen").addEventListener("click", () => requestGenerate(fresh));
  $("#tplInstead").addEventListener("click", requestTemplate);
}
