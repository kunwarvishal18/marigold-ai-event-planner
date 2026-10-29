/**
 * @file Small DOM helpers shared by the UI modules.
 */

/**
 * First element matching a selector.
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement|null}
 */
export const $ = (selector, root = document) => root.querySelector(selector);

/**
 * Every element matching a selector, as an array.
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement[]}
 */
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Replaces an element's content with markup, then applies dynamic sizes.
 *
 * Markup never carries style="" attributes, because the Content-Security-Policy doesn't allow
 * inline styles. Bars instead carry data-width="<percent>", and the width is set here through the
 * CSSOM, which the policy permits. Callers escape every dynamic value with escapeHtml().
 * @param {HTMLElement} element
 * @param {string} html
 */
export function setHtml(element, html) {
  element.innerHTML = html;
  applyWidths(element);
}

/**
 * Sets the width of every [data-width] element inside `root` from its percentage.
 * @param {ParentNode} root
 */
export function applyWidths(root) {
  for (const element of root.querySelectorAll("[data-width]")) {
    const pct = Math.max(0, Math.min(100, Number(element.dataset.width) || 0));
    element.style.width = `${pct}%`;
  }
}

/**
 * Attaches the same listener to every element matching a selector.
 * @param {string} selector
 * @param {string} type event type
 * @param {(element: HTMLElement, event: Event) => void} handler
 * @param {ParentNode} [root]
 */
export function onEach(selector, type, handler, root = document) {
  for (const element of $$(selector, root)) {
    element.addEventListener(type, (event) => handler(element, event));
  }
}

/**
 * Adds a submit handler that never reloads the page.
 * @param {HTMLFormElement|null} form
 * @param {(event: SubmitEvent) => void} handler
 */
export function onSubmit(form, handler) {
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    handler(event);
  });
}

/**
 * Shows a message in an inline error element (role="alert"), if it's on the page.
 * @param {string} id
 * @param {string} message
 */
export function showInlineError(id, message) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
}

/**
 * `attribute` when the condition holds, otherwise "". For boolean HTML attributes in templates.
 * @param {boolean} condition
 * @param {string} attribute e.g. "disabled", "checked"
 */
export const attrIf = (condition, attribute) => (condition ? attribute : "");

/** @returns {boolean} true when the person asked for reduced motion */
export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
