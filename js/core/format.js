/**
 * @file Text formatting for display: HTML escaping, money and dates.
 */

/** Currency used when a plan doesn't name one. */
const DEFAULT_CURRENCY = "INR";

/** @type {Readonly<Record<string, string>>} */
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Escapes text for safe use inside HTML element content and quoted attributes.
 * Every user- or AI-supplied string goes through this before it reaches innerHTML.
 * @param {unknown} text
 * @returns {string}
 */
export const escapeHtml = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

/** @param {string} currency */
const localeFor = (currency) => (currency === "INR" ? "en-IN" : "en-US");

/**
 * Intl formatters are expensive to create and a render formats hundreds of values, so each one is
 * built once and reused.
 */
/** @type {Map<string, Intl.NumberFormat>} */
const moneyFormatters = new Map();
/** @type {Map<string, Intl.NumberFormat>} */
const plainFormatters = new Map();
const LONG_DATE = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

/**
 * @param {string} currency
 * @returns {Intl.NumberFormat} throws a RangeError for an unknown currency code
 */
function moneyFormatter(currency) {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    /** @type {Intl.NumberFormatOptions} */
    const options = { style: "currency", currency, maximumFractionDigits: 0 };
    formatter = new Intl.NumberFormat(localeFor(currency), options);
    moneyFormatters.set(currency, formatter);
  }
  return formatter;
}

/**
 * Formats a whole amount with its currency symbol, e.g. ₹25,00,000.
 * @param {number|string} amount
 * @param {string} [currency]
 * @returns {string}
 */
export function formatMoney(amount, currency = DEFAULT_CURRENCY) {
  const whole = Math.round(+amount || 0);
  try {
    return moneyFormatter(currency).format(whole);
  } catch {
    // An unknown code: show the number with a sanitised label, never the raw input.
    const label = String(currency)
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3);
    return `${label} ${whole.toLocaleString()}`.trim();
  }
}

/**
 * A money formatter bound to one currency, for code that formats many amounts of one plan.
 * @param {string} currency
 * @returns {(amount: number|null) => string} null is shown as zero
 */
export const moneyIn = (currency) => (amount) => formatMoney(amount ?? 0, currency);

/**
 * Money as "CODE 1,234" without symbols, for PDF fonts that can't draw every currency sign.
 * @param {number|string} amount
 * @param {string} currency
 * @returns {string}
 */
export function formatMoneyPlain(amount, currency) {
  let formatter = plainFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(localeFor(currency), { maximumFractionDigits: 0 });
    plainFormatters.set(currency, formatter);
  }
  return `${currency} ${formatter.format(Math.round(+amount || 0))}`;
}

/**
 * @param {Date|null|undefined} date
 * @returns {string} e.g. "14 Feb 2027", or "No date"
 */
export const formatDate = (date) => (date ? LONG_DATE.format(date) : "No date");

/**
 * @param {Date|null|undefined} date
 * @returns {string} e.g. "14 Feb", or "—"
 */
export const formatShortDate = (date) => (date ? SHORT_DATE.format(date) : "—");
