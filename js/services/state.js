/**
 * @file The single in-memory app state. Every module reads and writes this one object, so the UI
 * can always be re-rendered from it.
 */

/**
 * @typedef {object} AppState
 * @property {ClaudeSampleCapability|null} sample Claude sampling from the host (null when absent)
 * @property {ClaudeDownloadsCapability|null} downloads file downloads from the host (null when absent)
 * @property {"checking"|"on"|"off"|"declined"} ai Claude connection status
 * @property {import("../core/model.js").Plan|null} plan the open plan
 * @property {import("../core/proposal.js").Proposal|null} proposal the change awaiting approval
 * @property {string} tab the visible plan tab
 * @property {"create"|"edit"} mode whether the brief form creates a plan or edits the open one
 * @property {string} type event type picked in the brief form
 * @property {Record<string, boolean>} busy which long-running requests are in flight
 * @property {Record<string, number>} requestNumbers latest request number per kind; older
 *   replies are dropped
 * @property {Record<string, AbortController>} abortControllers per request kind (Stop buttons)
 * @property {Set<string>} expandedVendors ids of the vendor cards the person has opened
 * @property {"all"|"pending"|"overdue"|"high"} filter timeline filter
 * @property {string} protect optimizer "protect" note
 * @property {string} ideaFocus ideas "focus" note
 */

/** @type {AppState} */
export const state = {
  sample: null,
  downloads: null,
  ai: "checking",
  plan: null,
  proposal: null,
  tab: "overview",
  mode: "create",
  type: "Wedding",
  busy: {},
  requestNumbers: {},
  abortControllers: {},
  expandedVendors: new Set(),
  filter: "all",
  protect: "",
  ideaFocus: "",
};

/**
 * The open plan, for code that only runs while a plan is open (plan actions, plan tabs). Its
 * absence there is a bug, so this throws instead of handing back null.
 * @returns {import("../core/model.js").Plan}
 */
export function requirePlan() {
  if (!state.plan) throw new Error("Marigold: no plan is open");
  return state.plan;
}

/**
 * Starts a new request of the given kind and returns its sequence number. A reply is only used if
 * its number is still the latest when it arrives (see isLatest).
 * @param {string} kind e.g. "gen", "chat"
 * @returns {number}
 */
export function startRequest(kind) {
  state.requestNumbers[kind] = (state.requestNumbers[kind] || 0) + 1;
  return state.requestNumbers[kind];
}

/**
 * @param {string} kind
 * @param {number} seq the number startRequest returned
 * @returns {boolean} true if no newer request of this kind has started since
 */
export const isLatest = (kind, seq) => state.requestNumbers[kind] === seq;

/**
 * True when a reply for `planId` may still be applied: it's the latest request of its kind and the
 * same plan is still open.
 * @param {string} kind
 * @param {number} seq
 * @param {string} planId
 * @returns {boolean}
 */
export const isCurrentReply = (kind, seq, planId) =>
  isLatest(kind, seq) && !!state.plan && state.plan.id === planId;
