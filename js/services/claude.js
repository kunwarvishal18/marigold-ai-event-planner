/**
 * @file The Claude client: sends a prompt, parses and validates the JSON reply, and retries once
 * with the validator's reasons when the reply is rejected.
 */
import { MAX_REPLY_CHARS, extractJSON } from "../core/safety.js";
import { state } from "./state.js";
import { view } from "./view.js";

/** How many reasons from a rejected reply are sent back to Claude. */
const MAX_REASONS_SENT = 8;

/** An error from a Claude request, with a machine-readable code (see errorMessage). */
export class AIError extends Error {
  /**
   * @param {string} code e.g. "rate_limited", "invalid_output", "cancelled"
   * @param {string} message
   * @param {string[]} [details] validator reasons, for "invalid_output"
   */
  constructor(code, message, details) {
    super(message);
    this.name = "AIError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Records the Claude connection status and shows it.
 * @param {"checking"|"on"|"off"|"declined"} status
 */
export function setConnection(status) {
  state.ai = status;
  view.setConnection(status);
}

/** @returns {boolean} true when Claude is connected and usable */
export const isClaudeOn = () => state.ai === "on" && !!state.sample;

/**
 * Asks Claude for JSON and validates it.
 * @template T
 * @param {string} prompt
 * @param {(reply: unknown, context: {attempt: number, final: boolean}) => import("../core/validation.js").Validation<T>} validate
 * @param {{tier?: string, signal?: AbortSignal, retries?: number}} [options]
 * @returns {Promise<T>} the validated value
 * @throws {AIError}
 */
export async function askClaudeForJSON(
  prompt,
  validate,
  { tier = "default", signal, retries = 1 } = {},
) {
  const sample = state.sample;
  if (!sample) throw new AIError("unavailable", "Claude isn't connected.");
  let input = prompt;
  /** @type {string[]} */
  let errors = [];

  for (let attempt = 0; attempt <= retries; attempt++) {
    const text = await sampleText(sample, input, tier, signal);
    const tooLong = typeof text === "string" && text.length > MAX_REPLY_CHARS;
    const parsed = tooLong ? undefined : extractJSON(text);

    if (parsed === undefined) {
      errors = [tooLong ? "The answer was too long." : "The answer was not valid JSON."];
    } else {
      const checked = validate(parsed, { attempt, final: attempt === retries });
      if (checked.ok) return checked.value;
      errors = checked.errors;
    }
    input =
      `${prompt}\n\nIMPORTANT: your previous answer was rejected by the app's validator for these ` +
      `reasons: ${errors.slice(0, MAX_REASONS_SENT).join("; ")}. Reply again with ONLY the ` +
      "corrected JSON object, no prose, no code fences.";
  }
  throw new AIError("invalid_output", "Claude's answer failed validation twice.", errors);
}

/**
 * One request to the host's sampling capability. Its errors become AIErrors.
 * @param {ClaudeSampleCapability} sample
 * @param {string} input
 * @param {string} tier
 * @param {AbortSignal} [signal]
 * @returns {Promise<string|undefined>}
 */
async function sampleText(sample, input, tier, signal) {
  try {
    const { text } = await sample(input, { modelTier: tier, signal, cache: false });
    return text;
  } catch (error) {
    const code = errorField(error, "code");
    if (code === "not_granted") setConnection("declined");
    throw new AIError(
      code || "upstream_error",
      errorField(error, "message") || "Claude request failed",
    );
  }
}

/**
 * A string property of whatever the host threw, or "".
 * @param {unknown} error
 * @param {"code"|"message"} key
 * @returns {string}
 */
const errorField = (error, key) => {
  const value = error && typeof error === "object" ? Reflect.get(error, key) : "";
  return typeof value === "string" ? value : "";
};

/**
 * The machine-readable code of a failed request ("" when there is none).
 * @param {unknown} error
 * @returns {string}
 */
export const errorCode = (error) => errorField(error, "code");

/** @type {Readonly<Record<string, string>>} */
const ERROR_MESSAGES = {
  rate_limited: "Claude is rate-limited for you right now. Wait about a minute, then try again.",
  queue_overflow: "Too many Claude requests are waiting. Wait a moment, then try again.",
  not_granted:
    "Claude access was declined for this page. Reload the page to be asked again. Templates and " +
    "rule-based tools still work.",
  cancelled: "Stopped. Nothing was changed.",
  prompt_too_large:
    "This plan is too large to send to Claude in one request. Try a shorter message.",
  refused: "Claude declined this request. Try rephrasing it.",
  session_expired: "Your Claude session expired. Reload the page.",
  unavailable: "Claude isn't connected in this view.",
  sampling_disabled: "Claude access is turned off for this page.",
};

/**
 * A plain-language message for a failed Claude request.
 * @param {unknown} error usually an AIError; anything else with a string `code` works too
 * @returns {string}
 */
export function errorMessage(error) {
  const code = errorCode(error);
  if (code === "invalid_output") {
    const details = error instanceof AIError ? error.details : undefined;
    const reasons = details?.length ? ` (${details.slice(0, 2).join("; ")})` : "";
    return (
      `Claude's answer didn't pass Marigold's checks after a retry${reasons}. ` +
      "Nothing was changed. Try again."
    );
  }
  if (code && Object.hasOwn(ERROR_MESSAGES, code)) return ERROR_MESSAGES[code];
  return `Claude couldn't complete this request${code ? ` (${code})` : ""}. Nothing was changed. Try again.`;
}
