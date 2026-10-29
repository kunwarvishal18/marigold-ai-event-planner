/**
 * @file The toast: one short message at a time. Errors are announced assertively (role="alert"),
 * everything else politely (role="status").
 */
import { $ } from "./dom.js";

const INFO_MS = 4000;
const ERROR_MS = 7000;
let hideTimer;

/**
 * Shows a toast message.
 * @param {string} message
 * @param {boolean} [isError]
 */
export function toast(message, isError = false) {
  const element = $("#toast");
  element.setAttribute("role", isError ? "alert" : "status");
  element.setAttribute("aria-live", isError ? "assertive" : "polite");
  element.textContent = message;
  element.className = isError ? "toast err" : "toast";
  element.hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(
    () => {
      element.hidden = true;
    },
    isError ? ERROR_MS : INFO_MS,
  );
}
