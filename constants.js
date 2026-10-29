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
export const PRIORITIES = ["high", "medium", "low"];

/** Risk severities mapped to sort order (most severe first). */
export const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

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
