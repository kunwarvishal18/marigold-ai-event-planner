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
  if (!state.sample) throw new AIError("unavailable", "Claude isn't connected.");
  let input = prompt;
  let errors = [];

  for (let attempt = 0; attempt <= retries; attempt++) {
    const text = await sampleText(input, tier, signal);
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

async function sampleText(input, tier, signal) {
  try {
    const { text } = await state.sample(input, { modelTier: tier, signal, cache: false });
    return text;
  } catch (error) {
    if (error?.code === "not_granted") setConnection("declined");
    throw new AIError(error?.code || "upstream_error", error?.message || "Claude request failed");
  }
}

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
 * @param {AIError|Error|null} error
 * @returns {string}
 */
export function errorMessage(error) {
  const code = error?.code;
  if (code === "invalid_output") {
    const reasons = error.details?.length ? ` (${error.details.slice(0, 2).join("; ")})` : "";
    return (
      `Claude's answer didn't pass Marigold's checks after a retry${reasons}. ` +
      "Nothing was changed. Try again."
    );
  }
  if (code && Object.hasOwn(ERROR_MESSAGES, code)) return ERROR_MESSAGES[code];
  return `Claude couldn't complete this request${code ? ` (${code})` : ""}. Nothing was changed. Try again.`;
}
