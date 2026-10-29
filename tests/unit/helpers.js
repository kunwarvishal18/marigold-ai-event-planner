// Shared fixtures for unit tests: an in-memory localStorage and ready-made plans.
import { addDays, toIsoDate, today } from "../../js/core/dates.js";
import { buildPlan } from "../../js/core/model.js";
import { templateData } from "../../js/core/templates.js";

/**
 * Installs an in-memory localStorage on globalThis.
 * @param {Record<string, string>} [initial] raw values
 * @param {{failWrites?: (key: string) => boolean}} [options] make chosen writes throw (quota full)
 * @returns {Map<string, string>} the backing store, for assertions
 */
export function installLocalStorage(initial = {}, { failWrites = () => false } = {}) {
  const data = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      if (failWrites(key)) throw new Error("QuotaExceededError");
      data.set(key, String(value));
    },
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
  };
  return data;
}

/**
 * A wedding plan from the template, `daysAhead` days away, created 30 days ago.
 * @param {object} [overrides] brief fields
 */
export function weddingPlan(overrides = {}, daysAhead = 200) {
  const brief = {
    type: "Wedding",
    name: "Test wedding",
    date: toIsoDate(addDays(today(), daysAhead)),
    time: "17:00",
    guests: 200,
    venueCapacity: 300,
    budget: 1_000_000,
    currency: "INR",
    city: "Jaipur",
    style: "",
    notes: "",
    ...overrides,
  };
  return buildPlan(brief, templateData("Wedding"), "template", toIsoDate(addDays(today(), -30)));
}

/** Sum of a plan's budget allocations. */
export const allocated = (plan) => plan.budget.reduce((total, line) => total + line.amount, 0);
