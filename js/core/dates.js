/**
 * @file Calendar-date helpers. Dates are local-time midnights; strings are strict YYYY-MM-DD.
 */

/** Milliseconds in one day. */
export const DAY_MS = 86_400_000;

const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

/**
 * Local midnight of the given date.
 * @param {Date|number|string} date
 * @returns {Date}
 */
function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/** @returns {Date} today at local midnight */
export const today = () => startOfDay(new Date());

/**
 * Formats a date as YYYY-MM-DD in local time.
 * @param {Date} date
 * @returns {string}
 */
export function toIsoDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Strict YYYY-MM-DD parser. The date must survive a full round trip, so values JavaScript would
 * quietly normalise (Feb 31, month 13, two-digit years mapped to 19xx) are rejected.
 * @param {unknown} text
 * @returns {Date|null} local midnight, or null if the text isn't a real calendar date
 */
export function parseIsoDate(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  const roundTrips =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return roundTrips ? date : null;
}

/**
 * @param {Date} date
 * @param {number} days may be negative
 * @returns {Date} a new date
 */
export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Whole calendar days from `from` to `to` (negative when `to` is earlier).
 * @param {Date} from
 * @param {Date} to
 * @returns {number}
 */
export const daysBetween = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
