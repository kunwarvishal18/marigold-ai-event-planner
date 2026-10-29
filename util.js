/**
 * @file General-purpose helpers for numbers, strings and ids.
 * Pure functions only: no DOM, no storage, no app state, so everything here is unit-testable in Node.
 */

/** Largest money amount Marigold accepts anywhere (one trillion). Keeps sums exact in floating point. */
export const MAX_AMOUNT = 1e12;

/**
 * Adds up a list of values, treating anything that isn't a number as 0.
 * @param {Array<number|string|null|undefined>} values
 * @returns {number}
 */
export const sum = (values) => values.reduce((total, value) => total + (+value || 0), 0);

/**
 * Collapses whitespace, trims and cuts a value to a maximum length.
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string}
 */
export const clip = (value, maxLength) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

/**
 * A short random id, unique enough for items inside one plan.
 * @returns {string}
 */
export const uid = () => Math.random().toString(36).slice(2, 9) + (Date.now() % 1e6).toString(36);

/**
 * Lower-cases text and reduces it to letters, digits and single spaces, for loose name matching.
 * @param {unknown} text
 * @returns {string}
 */
export const normalizeName = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Deep copy of plain JSON data.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export const deepClone = (value) => JSON.parse(JSON.stringify(value));

/**
 * True for finite numbers and numeric strings; false for null, "" and NaN.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isNumeric = (value) => value !== null && value !== "" && Number.isFinite(+value);

/**
 * Safe own-property check that also works on objects without a prototype.
 * @param {object|null|undefined} object
 * @param {PropertyKey} key
 * @returns {boolean}
 */
export const hasOwn = (object, key) =>
  object != null && Object.prototype.hasOwnProperty.call(object, key);

/**
 * True for a non-null object that isn't an array.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export const isPlainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * A whole, finite, non-negative amount within MAX_AMOUNT, or null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function safeAmount(value) {
  if (!isNumeric(value)) return null;
  const amount = Math.round(+value);
  return amount >= 0 && amount <= MAX_AMOUNT ? amount : null;
}

/**
 * Picks the singular or plural form for a count, e.g. plural(2, "task") → "tasks".
 * @param {number} count
 * @param {string} singular
 * @param {string} [pluralForm] defaults to singular + "s"
 * @returns {string}
 */
export const plural = (count, singular, pluralForm = `${singular}s`) =>
  count === 1 ? singular : pluralForm;
