/**
 * @file The view port. Logic modules (services and actions) report what happened through these
 * callbacks instead of importing the UI. app.js connects the real DOM implementation at start-up.
 *
 * This is dependency inversion: imports only ever point "down" (core ← services ← actions ← ui ←
 * app), so there are no circular imports, and logic can run without a DOM in tests.
 */

/**
 * @typedef {object} ViewPort
 * @property {() => void} render re-render everything from state
 * @property {(section: "form"|"saved"|"proposal"|"overview"|"budget"|"ideas"|"chat") => void} renderSection
 * @property {(message: string, isError?: boolean) => void} toast
 * @property {(brief: object) => void} fillForm put a brief into the event details form
 * @property {(status: "checking"|"on"|"off"|"declined") => void} setConnection Claude status chip
 * @property {() => void} revealProposal scroll to and focus the proposal preview
 * @property {(text: string) => void} setFormHint
 * @property {(id: string, message: string) => void} showInlineError e.g. "optErr", "ideaErr"
 * @property {() => void} showGenerationProgress
 * @property {(message: string, canRetry: boolean, fresh: boolean) => void} showGenerationError
 * @property {() => void} clearChatInput
 */

const noop = () => {};

/** @type {ViewPort} */
const handlers = {
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
};

/**
 * Connects the real view. Called once by app.js.
 * @param {ViewPort} implementation
 */
export function connectView(implementation) {
  for (const name of Object.keys(handlers)) {
    if (typeof implementation[name] !== "function") {
      throw new TypeError(`connectView: missing view method "${name}"`);
    }
    handlers[name] = implementation[name];
  }
}

/**
 * What logic modules call. Each method forwards to the connected view (a no-op until connected).
 * @type {ViewPort}
 */
export const view = Object.fromEntries(
  Object.keys(handlers).map((name) => [name, (...args) => handlers[name](...args)]),
);
