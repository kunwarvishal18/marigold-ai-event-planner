/**
 * @file Badges that say where content came from (AI, template, rule, the person).
 * Static markup only; nothing dynamic is interpolated.
 */

/** @type {Readonly<Record<string, string>>} */
const SOURCE_BADGES = {
  ai: '<span class="badge ai">AI generated</span>',
  template: '<span class="badge tpl">Template plan</span>',
  example: '<span class="badge tpl ex">Example data · template</span>',
  legacy: '<span class="badge tpl">Imported from earlier version</span>',
};

/** @type {Readonly<Record<string, string>>} */
const ORIGIN_BADGES = {
  ai: '<span class="badge ai">AI</span>',
  you: '<span class="badge">Added by you</span>',
  rule: '<span class="badge rule">Rule-based</span>',
};

/**
 * @param {string} source a plan's source
 * @returns {string} badge markup, or "" for unknown sources
 */
export const sourceBadge = (source) =>
  Object.hasOwn(SOURCE_BADGES, source) ? SOURCE_BADGES[source] : "";

/**
 * @param {string} origin an item's origin
 * @returns {string} badge markup (template for anything unknown)
 */
export const originBadge = (origin) =>
  Object.hasOwn(ORIGIN_BADGES, origin)
    ? ORIGIN_BADGES[origin]
    : '<span class="badge tpl">Template</span>';
