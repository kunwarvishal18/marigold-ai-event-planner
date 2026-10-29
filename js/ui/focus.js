/**
 * @file Keeps keyboard focus in place across re-renders (WCAG 2.4.3 Focus Order).
 *
 * Panels are rebuilt from state after every change, which replaces the element that had focus.
 * preserveFocus() remembers which control was focused, runs the render, and puts focus back on the
 * same control (matched by id, or by its data-* key). If that control no longer exists, focus moves
 * to the panel it was in, or to the plan title, never to the page body.
 */

/** @typedef {{selector: string|null, container: Element|null}} FocusMemo */

/**
 * @param {Element} element
 * @returns {string|null} a selector that finds the same control after a re-render
 */
function selectorFor(element) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const key = [...element.attributes].find((attr) => attr.name.startsWith("data-") && attr.value);
  return key ? `[${key.name}="${CSS.escape(key.value)}"]` : null;
}

/** @returns {FocusMemo|null} what had focus, or null when nothing on the page did */
function remember() {
  const active = document.activeElement;
  if (!active || active === document.body) return null;
  return { selector: selectorFor(active), container: active.closest("[role=tabpanel]") };
}

/**
 * @param {Element|null} element
 * @returns {element is HTMLElement} true for a connected, visible, enabled element
 */
const isUsable = (element) =>
  element instanceof HTMLElement &&
  element.isConnected &&
  !element.closest("[hidden]") &&
  !(element instanceof HTMLButtonElement && element.disabled);

/**
 * Puts focus back after a render, but only if the render took it away.
 * @param {FocusMemo|null} memo
 */
function restore(memo) {
  if (!memo) return;
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  const candidates = [
    memo.selector ? document.querySelector(memo.selector) : null,
    memo.container,
    document.getElementById("pTitle"),
    document.getElementById("main"),
  ];
  const target = candidates.find(isUsable);
  target?.focus({ preventScroll: true });
}

/**
 * Runs a render without losing the keyboard user's place.
 * @param {() => void} render
 */
export function preserveFocus(render) {
  const memo = remember();
  render();
  restore(memo);
}
