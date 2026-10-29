/**
 * @file Text formatting for display: HTML escaping, money and dates.
 */

/** Currency used when a plan doesn't name one. */
export const DEFAULT_CURRENCY = "INR";

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Escapes text for safe use inside HTML element content and quoted attributes.
 * Every user- or AI-supplied string goes through this before it reaches innerHTML.
 * @param {unknown} text
 * @returns {string}
 */
export const escapeHtml = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

const localeFor = (currency) => (currency === "INR" ? "en-IN" : "en-US");

/**
 * Formats a whole amount with its currency symbol, e.g. ₹25,00,000.
 * @param {number|string} amount
 * @param {string} [currency]
 * @returns {string}
 */
export function formatMoney(amount, currency = DEFAULT_CURRENCY) {
  const whole = Math.round(+amount || 0);
  try {
    return new Intl.NumberFormat(localeFor(currency), {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(whole);
  } catch {
    return `${currency} ${whole.toLocaleString()}`;
  }
}

/**
 * Money as "CODE 1,234" without symbols, for PDF fonts that can't draw every currency sign.
 * @param {number|string} amount
 * @param {string} currency
 * @returns {string}
 */
export function formatMoneyPlain(amount, currency) {
  const digits = new Intl.NumberFormat(localeFor(currency), { maximumFractionDigits: 0 });
  return `${currency} ${digits.format(Math.round(+amount || 0))}`;
}

/**
 * @param {Date|null|undefined} date
 * @returns {string} e.g. "14 Feb 2027", or "No date"
 */
export const formatDate = (date) =>
  date
    ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "No date";

/**
 * @param {Date|null|undefined} date
 * @returns {string} e.g. "14 Feb", or "—"
 */
export const formatShortDate = (date) =>
  date ? date.toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—";
