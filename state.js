/**
 * @file The single in-memory app state. Every module reads and writes this one object, so the UI
 * can always be re-rendered from it.
 */

/**
 * @typedef {object} AppState
 * @property {Function|null} sample Claude sampling capability from the host (null when absent)
 * @property {object|null} downloads file-download capability from the host (null when absent)
 * @property {"checking"|"on"|"off"|"declined"} ai Claude connection status
 * @property {import("../core/model.js").Plan|null} plan the open plan
 * @property {import("../core/proposal.js").Proposal|null} proposal the change awaiting approval
 * @property {string} tab the visible plan tab
 * @property {"create"|"edit"} mode whether the brief form creates a plan or edits the open one
 * @property {string} type event type picked in the brief form
 * @property {Record<string, boolean>} busy which long-running requests are in flight
 * @property {Record<string, number>} seq latest request number per kind; older replies are dropped
 * @property {Record<string, AbortController>} ctl abort controllers per request kind
 * @property {Set<string>} openV vendor cards the person has expanded
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
  seq: {},
  ctl: {},
  openV: new Set(),
  filter: "all",
  protect: "",
  ideaFocus: "",
};

/**
 * Starts a new request of the given kind and returns its sequence number. A reply is only used if
 * its number is still the latest when it arrives (see isLatest).
 * @param {string} kind e.g. "gen", "chat"
 * @returns {number}
 */
export function startRequest(kind) {
  state.seq[kind] = (state.seq[kind] || 0) + 1;
  return state.seq[kind];
}

/**
 * @param {string} kind
 * @param {number} seq the number startRequest returned
 * @returns {boolean} true if no newer request of this kind has started since
 */
export const isLatest = (kind, seq) => state.seq[kind] === seq;

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
