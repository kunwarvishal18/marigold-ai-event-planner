/**
 * @file The view port. Logic modules (services and actions) report what happened through these
 * callbacks instead of importing the UI. app.js connects the real DOM implementation at start-up.
 *
 * This is dependency inversion: imports only ever point "down" (core ← services ← actions ← ui ←
 * app), so there are no circular imports, and logic can run without a DOM in tests.
 */

/**
 * A brief as the form shows it: any field may be missing, and a number may still be "" (empty).
 * @typedef {{[K in keyof import("../core/model.js").Brief]?:
 *   import("../core/model.js").Brief[K] | ""}} BriefDraft
 */

/**
 * @typedef {object} ViewPort
 * @property {() => void} render re-render everything from state
 * @property {(section: "form"|"saved"|"proposal"|"overview"|"budget"|"ideas"|"chat") => void} renderSection
 * @property {(message: string, isError?: boolean) => void} toast
 * @property {(brief: BriefDraft) => void} fillForm put a brief into the event details form
 * @property {(status: "checking"|"on"|"off"|"declined") => void} setConnection Claude status chip
 * @property {() => void} revealProposal scroll to and focus the proposal preview
 * @property {(text: string) => void} setFormHint
 * @property {(id: string, message: string) => void} showInlineError e.g. "optErr", "ideaErr"
 * @property {() => void} showGenerationProgress
 * @property {(message: string, canRetry: boolean, fresh: boolean) => void} showGenerationError
 * @property {() => void} clearChatInput
 */

const noop = () => {};

/** The connected view; every method is a no-op until app.js connects the DOM view. */
let connected = /** @type {ViewPort} */ ({
  render: noop,
  renderSection: noop,
  toast: noop,
  fillForm: noop,
  setConnection: noop,
  revealProposal: noop,
  setFormHint: noop,
  showInlineError: noop,
  showGenerationProgress: noop,
  showGenerationError: noop,
  clearChatInput: noop,
});

/**
 * Connects the real view. Called once by app.js.
 * @param {ViewPort} implementation
 */
export function connectView(implementation) {
  for (const name of Object.keys(connected)) {
    if (typeof Reflect.get(implementation, name) !== "function") {
      throw new TypeError(`connectView: missing view method "${name}"`);
    }
  }
  connected = implementation;
}

/**
 * What logic modules call. Each method forwards to the connected view, so modules can import
 * `view` before app.js has connected it.
 * @type {ViewPort}
 */
export const view = {
  render: () => connected.render(),
  renderSection: (section) => connected.renderSection(section),
  toast: (message, isError) => connected.toast(message, isError),
  fillForm: (brief) => connected.fillForm(brief),
  setConnection: (status) => connected.setConnection(status),
  revealProposal: () => connected.revealProposal(),
  setFormHint: (text) => connected.setFormHint(text),
  showInlineError: (id, message) => connected.showInlineError(id, message),
  showGenerationProgress: () => connected.showGenerationProgress(),
  showGenerationError: (message, canRetry, fresh) =>
    connected.showGenerationError(message, canRetry, fresh),
  clearChatInput: () => connected.clearChatInput(),
};
