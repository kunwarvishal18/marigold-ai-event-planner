/**
 * @file Co-planner tab: the conversation, suggested prompts and the message box.
 */
import { sendChat } from "../actions/assistant.js";
import { escapeHtml, formatMoney } from "../core/format.js";
import { isClaudeOn } from "../services/claude.js";
import { state } from "../services/state.js";
import { $, attrIf, onEach, setHtml } from "./dom.js";

const MESSAGES_SHOWN = 40;
/** Suggested budget cuts are rounded to a lakh for INR, or a thousand otherwise. */
const ROUNDING = { INR: 100_000, other: 1000 };

/** Example requests tailored to the plan. */
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

/** Renders the conversation and the controls that depend on Claude being available. */
export function renderChat() {
  const plan = state.plan;
  const claudeOn = isClaudeOn();
  const busy = !!state.busy.chat;
  const box = $("#msgs");
  let messages = plan.chat.length
    ? plan.chat
        .slice(-MESSAGES_SHOWN)
        .map((message) => `<div class="msg ${message.role}">${escapeHtml(message.text)}</div>`)
        .join("")
    : `<div class="msg note">${claudeOn ? "Try one of the suggestions below." : "The co-planner needs Claude. Everything else works in template mode."}</div>`;
  if (busy) {
    messages +=
      '<div class="msg assistant"><span class="progress"><span class="spinner"></span>Thinking and checking the numbers…</span></div>';
  }
  setHtml(box, messages);
  box.scrollTop = box.scrollHeight;

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
  onEach("[data-sugg]", "click", (button) => sendChat(button.dataset.sugg), suggest);

  $("#askBtn").disabled = !claudeOn || busy;
  $("#askInput").disabled = !claudeOn;
  $("#stopChat").hidden = !busy;
  $("#chatHint").textContent = claudeOn ? "" : "Needs Claude";
}

/** Empties the message box after a message is sent. */
export function clearChatInput() {
  $("#askInput").value = "";
}

/** Wires the message form: Enter sends, Shift+Enter adds a new line, Stop cancels. */
export function bindChat() {
  $("#askForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat($("#askInput").value);
  });
  $("#askInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChat($("#askInput").value);
    }
  });
  $("#stopChat").addEventListener("click", () => state.ctl.chat?.abort());
}
