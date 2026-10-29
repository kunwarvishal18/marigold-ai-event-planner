/**
 * @file Small DOM helpers shared by the UI modules.
 */

/** @typedef {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} FormField */

/**
 * The element matching a selector. For elements the page always has at that point: a missing one
 * is a bug, so this throws rather than letting a null slip through. Use find() for optional ones.
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement}
 */
export function $(selector, root = document) {
  const element = find(selector, root);
  if (!element) throw new Error(`Marigold: no element matches ${selector}`);
  return element;
}

/**
 * The element matching a selector, or null when there isn't one (e.g. a button that is only
 * rendered in some states).
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement|null}
 */
export function find(selector, root = document) {
  const element = root.querySelector(selector);
  return element instanceof HTMLElement ? element : null;
}

/**
 * Every element matching a selector, as an array.
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement[]}
 */
export const $$ = (selector, root = document) =>
  [...root.querySelectorAll(selector)].filter((element) => element instanceof HTMLElement);

/**
 * The element matching a selector, checked to be of a given type (e.g. HTMLButtonElement).
 * @template {HTMLElement} T
 * @param {new () => T} type
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {T}
 */
export function $as(type, selector, root = document) {
  const element = $(selector, root);
  if (!(element instanceof type)) throw new Error(`Marigold: ${selector} is not a ${type.name}`);
  return element;
}

/**
 * An element checked to be a form field (input, select or textarea), so its value can be read.
 * @param {Element|EventTarget|null} element
 * @returns {FormField}
 */
export function asField(element) {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return element;
  }
  throw new Error("Marigold: expected a form field");
}

/**
 * @param {HTMLElement} element
 * @returns {boolean} true for a ticked checkbox
 */
export const isChecked = (element) => element instanceof HTMLInputElement && element.checked;

/**
 * The form field matching a selector.
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {FormField}
 */
export const field = (selector, root = document) => asField($(selector, root));

/**
 * The closest element to an event's target that matches a selector (event delegation).
 * @param {Event} event
 * @param {string} selector
 * @returns {HTMLElement|null}
 */
export function closestTo(event, selector) {
  const match = event.target instanceof Element ? event.target.closest(selector) : null;
  return match instanceof HTMLElement ? match : null;
}

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
function applyWidths(root) {
  for (const element of $$("[data-width]", root)) {
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
 * @param {HTMLElement|null} form
 * @param {(event: Event) => void} handler
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
 * @returns {string}
 */
export const attrIf = (condition, attribute) => (condition ? attribute : "");

/** @returns {boolean} true when the person asked for reduced motion */
export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
