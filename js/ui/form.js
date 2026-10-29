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
import { $, $$, attrIf, field, find, setHtml } from "./dom.js";

/** @typedef {import("../core/model.js").Brief} Brief */

/**
 * The brief as typed into the form, before validation: numbers may still be missing.
 * @typedef {Omit<Brief, "guests" | "budget"> & {guests: number|null, budget: number|null}} FormBrief
 */

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
  const buttons = editing ? editButtons(claudeOn, busy) : createButtons(claudeOn, busy);
  setHtml($("#formBtns"), buttons + stopButton);
  find("#regenBtn")?.addEventListener("click", () => requestGenerate(true));
  find("#tplBtn")?.addEventListener("click", requestTemplate);
  find("#stopGen")?.addEventListener("click", () => state.abortControllers.gen?.abort());
}

/**
 * Buttons while editing an open plan: review the edits, or ask Claude for a fresh plan.
 * @param {boolean} claudeOn
 * @param {boolean} busy a plan is being generated
 * @returns {string}
 */
function editButtons(claudeOn, busy) {
  return (
    '<button class="btn" type="submit" id="reviewBtn">Review changes</button>' +
    `<button class="btn ghost" type="button" id="regenBtn" ${attrIf(!claudeOn || busy, "disabled")}>` +
    `${busy ? "Generating…" : "Fresh AI plan"}</button>`
  );
}

/**
 * Buttons for a new event: generate with Claude (or from the template without it).
 * @param {boolean} claudeOn
 * @param {boolean} busy a plan is being generated
 * @returns {string}
 */
function createButtons(claudeOn, busy) {
  let label = claudeOn ? "Generate plan with AI" : "Create template plan";
  if (busy) label = "Generating…";
  const templateButton =
    claudeOn && !busy
      ? '<button class="btn ghost" type="button" id="tplBtn">Use template instead</button>'
      : "";
  return `<button class="btn" type="submit" id="genBtn" ${attrIf(busy, "disabled")}>${label}</button>${templateButton}`;
}

/**
 * Puts a brief into the form.
 * @param {import("../services/view.js").BriefDraft} brief
 */
export function fillForm(brief) {
  state.type = brief.type || state.type;
  for (const button of $$("#types button")) {
    button.setAttribute("aria-pressed", String(button.dataset.type === state.type));
  }
  /** @type {Array<[string, unknown]>} */
  const values = [
    ["#f-name", brief.name],
    ["#f-date", brief.date],
    ["#f-time", brief.time],
    ["#f-guests", brief.guests],
    ["#f-cap", brief.venueCapacity],
    ["#f-budget", brief.budget],
    ["#f-cur", brief.currency || "INR"],
    ["#f-city", brief.city],
    ["#f-style", brief.style],
    ["#f-notes", brief.notes],
  ];
  for (const [selector, value] of values) field(selector).value = String(value ?? "");
  clearErrors();
}

/**
 * Reads the brief from the form (not yet validated).
 * @returns {FormBrief}
 */
function readForm() {
  /** @param {string} selector */
  const text = (selector) => field(selector).value;
  /** @param {string} selector */
  const numberIn = (selector) => {
    const value = text(selector).trim();
    return value === "" ? null : Number(value);
  };
  return {
    type: state.type,
    name: clip(text("#f-name"), 90),
    date: text("#f-date"),
    time: text("#f-time"),
    guests: numberIn("#f-guests"),
    venueCapacity: numberIn("#f-cap"),
    budget: numberIn("#f-budget"),
    currency: text("#f-cur"),
    city: clip(text("#f-city"), 80),
    style: clip(text("#f-style"), 120),
    notes: clip(text("#f-notes"), 600),
  };
}

/** Hides every inline form error. */
function clearErrors() {
  for (const name of CHECKED_FIELDS) {
    $(`#e-${name}`).hidden = true;
    $(`#f-${name}`).removeAttribute("aria-invalid");
  }
}

/**
 * Checks a brief, shows inline errors and focuses the first invalid field.
 * @param {FormBrief} brief
 * @param {boolean} editing true when editing an open plan (its past date is still allowed)
 * @returns {Brief|null} the brief, once valid; null when it isn't
 */
function validateBrief(brief, editing) {
  const errors = briefErrors(brief, editing);
  clearErrors();
  for (const [name, message] of Object.entries(errors)) {
    const element = $(`#e-${name}`);
    element.textContent = message;
    element.hidden = false;
    $(`#f-${name}`).setAttribute("aria-invalid", "true");
  }
  const first = Object.keys(errors)[0];
  if (first) $(`#f-${first}`).focus();
  const { guests, budget } = brief;
  // briefErrors() has already reported missing numbers; these checks only narrow the type.
  if (first || guests == null || budget == null) return null;
  return { ...brief, guests, budget };
}

/**
 * @param {FormBrief} brief
 * @param {boolean} editing
 * @returns {Record<string, string>} error message per invalid field
 */
function briefErrors(brief, editing) {
  /** @type {Record<string, string>} */
  const errors = {};
  if (!brief.name) errors.name = "Give the event a name.";
  const guestError = guestProblems(brief).join(" ");
  if (guestError) errors.guests = guestError;
  const { budget } = brief;
  if (budget == null || !(budget > 0) || budget > MAX_AMOUNT) {
    errors.budget = "Enter a budget greater than 0.";
  }
  const dateError = brief.date ? dateProblem(brief.date, editing) : "";
  if (dateError) errors.date = dateError;
  return errors;
}

/**
 * Problems with the guest count and venue capacity (both reported next to Guests).
 * @param {FormBrief} brief
 * @returns {string[]}
 */
function guestProblems({ guests, venueCapacity }) {
  const problems = [];
  if (guests == null || !Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS) {
    problems.push("Guests must be a whole number from 1 to 100,000.");
  }
  if (venueCapacity != null && !(venueCapacity >= 1)) {
    problems.push("Venue capacity must be at least 1.");
  }
  return problems;
}

/**
 * Why an event date can't be used, or "" when it can. While editing, an unchanged date that has
 * since passed is still allowed.
 * @param {string} date YYYY-MM-DD
 * @param {boolean} editing
 * @returns {string}
 */
function dateProblem(date, editing) {
  const parsed = parseIsoDate(date);
  if (!parsed) return "Enter a valid date.";
  const unchangedPastDate = editing && date === state.plan?.brief.date;
  if (daysBetween(today(), parsed) < 0 && !unchangedPastDate) {
    return "That date has passed. Pick today or a future date.";
  }
  return "";
}

/** Handles the form's submit button: review edits to an open plan, or generate a new one. */
export function submitBrief() {
  if (state.mode === "edit" && state.plan) requestReview();
  else requestGenerate(false);
}

/**
 * Validates the form and generates a plan (or a template plan without Claude).
 * @param {boolean} fresh true for "Fresh AI plan" on an open plan
 */
function requestGenerate(fresh) {
  if (state.busy.gen) return;
  const brief = validateBrief(readForm(), state.mode === "edit");
  if (brief) generate(brief, fresh);
}

/** Validates the form and creates a template plan. */
function requestTemplate() {
  const brief = validateBrief(readForm(), false);
  if (brief) createTemplate(brief);
}

/** Validates the form and proposes the edits to the open plan. */
function requestReview() {
  const brief = validateBrief(readForm(), true);
  if (brief) reviewDetails(brief);
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
    const counter = find("#genSecs");
    if (!counter || !state.busy.gen) {
      clearInterval(timer);
      return;
    }
    counter.textContent = String(Math.round((Date.now() - startedAt) / MS_PER_SECOND));
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
