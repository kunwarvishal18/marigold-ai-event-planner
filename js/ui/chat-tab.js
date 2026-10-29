/**
 * @file Co-planner tab: the conversation, suggested prompts and the message box.
 */
import { sendChat } from "../actions/assistant.js";
import { escapeHtml, formatMoney } from "../core/format.js";
import { isClaudeOn } from "../services/claude.js";
import { requirePlan, state } from "../services/state.js";
import { $, $$, $as, attrIf, field, onEach, setHtml } from "./dom.js";

const MESSAGES_SHOWN = 40;
/** Suggested budget cuts are rounded to a lakh for INR, or a thousand otherwise. */
const ROUNDING = { INR: 100_000, other: 1000 };

/** @typedef {import("../core/model.js").Plan} Plan */
/** @typedef {import("../core/model.js").ChatMessage} ChatMessage */

/**
 * Example requests tailored to the plan.
 * @param {Plan} plan
 * @returns {string[]}
 */
function suggestions(plan) {
  const { brief } = plan;
  const step = brief.currency === "INR" ? ROUNDING.INR : ROUNDING.other;
  const reduced = Math.round((brief.budget * 0.8) / step) * step || Math.round(brief.budget * 0.8);
  return [
    `My budget has been reduced to ${formatMoney(reduced, brief.currency)}. Keep the guest count unchanged and protect the catering quality.`,
    `Our guest count went up from ${brief.guests} to ${Math.round(brief.guests * 1.2)}. Recalculate the budget.`,
    "Move the event two weeks earlier and adjust my timeline.",
    `Make this ${brief.type.toLowerCase()} more sustainable without increasing the budget.`,
    "What should I focus on this week?",
  ];
}

/**
 * Identifies a message across renders, so unchanged messages are never re-inserted.
 * @param {ChatMessage} message
 * @param {string} planId
 * @returns {string}
 */
const messageKey = (message, planId) =>
  `${planId}:${message.at || 0}:${message.role}:${message.text.length}`;

/**
 * @param {ChatMessage} message
 * @param {string} key
 * @returns {string}
 */
const messageHtml = (message, key) =>
  `<div class="msg ${escapeHtml(message.role)}" data-key="${escapeHtml(key)}">${escapeHtml(message.text)}</div>`;

const THINKING =
  '<div class="msg assistant" data-thinking><span class="progress"><span class="spinner"></span>Thinking and checking the numbers…</span></div>';

/**
 * Updates the conversation, a role="log" live region. New messages are appended to what is
 * already there, so screen readers announce only the new reply rather than the whole conversation.
 * The list is rebuilt only when it no longer starts with what's on screen (another plan, or older
 * messages trimmed).
 * @param {HTMLElement} box
 * @param {Plan} plan
 * @param {boolean} claudeOn
 * @param {boolean} busy
 */
function renderMessages(box, plan, claudeOn, busy) {
  box.querySelector("[data-thinking]")?.remove();
  const messages = plan.chat.slice(-MESSAGES_SHOWN);
  const keys = messages.map((message) => messageKey(message, plan.id));
  const shown = $$("[data-key]", box).map((element) => element.dataset.key);
  const isPrefix = shown.length > 0 && shown.every((key, i) => key === keys[i]);

  if (!messages.length) {
    const hint = claudeOn
      ? "Try one of the suggestions below."
      : "The co-planner needs Claude. Everything else works in template mode.";
    setHtml(box, `<div class="msg note">${hint}</div>`);
  } else if (isPrefix) {
    const added = messages.slice(shown.length).map((message, i) => {
      return messageHtml(message, keys[shown.length + i]);
    });
    box.insertAdjacentHTML("beforeend", added.join(""));
  } else {
    setHtml(box, messages.map((message, i) => messageHtml(message, keys[i])).join(""));
  }
  if (busy) box.insertAdjacentHTML("beforeend", THINKING);
  box.scrollTop = box.scrollHeight;
}

/** Renders the conversation and the controls that depend on Claude being available. */
export function renderChat() {
  const plan = requirePlan();
  const claudeOn = isClaudeOn();
  const busy = !!state.busy.chat;
  renderMessages($("#msgs"), plan, claudeOn, busy);

  const suggest = $("#suggest");
  setHtml(
    suggest,
    suggestions(plan)
      .map(
        (text) =>
          `<button type="button" data-sugg="${escapeHtml(text)}" ${attrIf(!claudeOn || busy, "disabled")}>${escapeHtml(text)}</button>`,
      )
      .join(""),
  );
  onEach("[data-sugg]", "click", (button) => sendChat(button.dataset.sugg || ""), suggest);

  $as(HTMLButtonElement, "#askBtn").disabled = !claudeOn || busy;
  field("#askInput").disabled = !claudeOn;
  $("#stopChat").hidden = !busy;
  $("#chatHint").textContent = claudeOn ? "" : "Needs Claude";
}

/** Empties the message box after a message is sent. */
export function clearChatInput() {
  field("#askInput").value = "";
}

/** Wires the message form: Enter sends, Shift+Enter adds a new line, Stop cancels. */
export function bindChat() {
  $("#askForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat(field("#askInput").value);
  });
  field("#askInput").addEventListener("keydown", (event) => {
    if (event instanceof KeyboardEvent && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChat(field("#askInput").value);
    }
  });
  $("#stopChat").addEventListener("click", () => state.abortControllers.chat?.abort());
}
