/**
 * @file Shared domain vocabulary: the fixed lists and patterns the rest of the app agrees on.
 */

/** Budget categories that act as a reserve for surprises. */
export const CONTINGENCY_PATTERN = /contingen|buffer|reserve|emergency fund|miscellaneous|misc\b/i;

/** Vendor booking stages, in pipeline order. */
export const VENDOR_STATUSES = [
  "Not started",
  "Shortlisted",
  "Contacted",
  "Negotiating",
  "Booked",
  "Completed",
];

/** Vendor payment states. */
export const PAYMENT_STATES = ["Unpaid", "Deposit paid", "Paid in full"];

/** Task priorities, most urgent first. */
export const PRIORITIES = /** @type {const} */ (["high", "medium", "low"]);
/** @typedef {typeof PRIORITIES[number]} Priority */

/** Risk severities, most severe first. */
export const SEVERITIES = /** @type {const} */ (["critical", "high", "medium", "low"]);
/** @typedef {typeof SEVERITIES[number]} Severity */

/**
 * Risk severities mapped to sort order (most severe first).
 * @type {Readonly<Record<Severity, number>>}
 */
export const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/** Event types Marigold plans for (each has a template). */
export const EVENT_TYPES = ["Wedding", "Birthday", "Community event"];

/** Currencies offered in the brief form (ISO 4217 codes). */
export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"];

/** Who wrote a chat message. */
export const CHAT_ROLES = /** @type {const} */ (["user", "assistant", "note", "error"]);
/** @typedef {typeof CHAT_ROLES[number]} ChatRole */

/** Where a plan came from. */
export const PLAN_SOURCES = /** @type {const} */ (["ai", "template", "example", "legacy"]);
/** @typedef {typeof PLAN_SOURCES[number]} PlanSource */

/** Where an item in a plan came from. */
export const ITEM_ORIGINS = /** @type {const} */ (["ai", "template", "you", "rule"]);
/** @typedef {typeof ITEM_ORIGINS[number]} ItemOrigin */

/** Ids of plans and of items inside them: short and safe in HTML attributes and selectors. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** A 24-hour clock time, HH:MM. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** How many undo snapshots, change-log entries and chat messages a plan keeps. */
export const PLAN_LIMITS = Object.freeze({ history: 10, log: 40, chat: 60 });

/** Largest guest count a brief accepts. */
export const MAX_GUESTS = 100_000;

/**
 * @param {{status: string}} vendor
 * @returns {boolean} true once the vendor is booked (or the job is done)
 */
export const isBooked = (vendor) => vendor.status === "Booked" || vendor.status === "Completed";

/**
 * @param {string} category
 * @returns {boolean} true when a budget category is a contingency reserve
 */
export const isContingency = (category) => CONTINGENCY_PATTERN.test(category);

/**
 * True when a value is one of an allowed list (type guard for the lists above).
 * @template {string} T
 * @param {unknown} value
 * @param {readonly T[]} allowed
 * @returns {value is T}
 */
export const isOneOf = (value, allowed) => allowed.some((item) => item === value);

/**
 * The value if it is in the allowed list, otherwise the fallback.
 * @template {string} T
 * @param {unknown} value
 * @param {readonly T[]} allowed
 * @param {T} fallback
 * @returns {T}
 */
export const oneOf = (value, allowed, fallback) => (isOneOf(value, allowed) ? value : fallback);
