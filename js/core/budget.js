/**
 * @file Exact budget arithmetic. Allocations are whole numbers that always add up to the total.
 */
import { isNumeric, sum } from "./util.js";

/** Tolerance for floating-point comparisons on money that is about to be rounded. */
const EPSILON = 1e-9;

/**
 * Either whole amounts, one per target, that add up exactly to the total, or why no fit was
 * possible (with how far the floors exceed the total when the reason is "floors").
 * @typedef {{ok: true, amounts: number[]}
 *   | {ok: false, reason: "no-lines"|"floors"|"locked"|"rounding", shortfall?: number}} FitResult
 */

/**
 * Turns target amounts into whole numbers that add up exactly to `total`, never below each floor
 * (committed spend), keeping locked lines exactly as given.
 *
 * Steps: clamp each target to its floor; spread the remaining difference over the unlocked lines
 * (in proportion to their size when growing, to their slack above the floor when shrinking); round
 * down; then hand out the leftover units by largest remainder.
 *
 * @param {Array<number|null>} targets wanted amount per line
 * @param {Array<number|null>} floors minimum per line (committed spend)
 * @param {number} requestedTotal the exact sum the result must reach (rounded to a whole number)
 * @param {number[]} [locked] indexes of lines that must keep their target exactly
 * @returns {FitResult}
 */
export function fitToTotal(targets, floors, requestedTotal, locked = []) {
  const count = targets.length;
  const total = Math.round(+requestedTotal || 0);
  if (!count) return total === 0 ? { ok: true, amounts: [] } : { ok: false, reason: "no-lines" };

  const lockedSet = new Set(locked);
  const floorOf = targets.map((_, i) => Math.max(0, Math.ceil(Number(floors[i]) || 0)));
  const wanted = targets.map((target, i) => {
    const value = isNumeric(target) && Number(target) > 0 ? Number(target) : 0;
    return Math.max(lockedSet.has(i) ? Math.round(value) : value, floorOf[i]);
  });
  lockedSet.forEach((i) => {
    floorOf[i] = wanted[i];
  });

  const floorSum = sum(floorOf);
  if (floorSum > total) return { ok: false, reason: "floors", shortfall: floorSum - total };

  const free = [...Array(count).keys()].filter((i) => !lockedSet.has(i));
  const exact = spreadDifference(wanted, floorOf, free, total);
  if (!exact.ok) return exact;

  return roundToTotal(exact.values, floorOf, free, lockedSet, total);
}

/**
 * Moves the gap between sum(wanted) and total onto the free lines, keeping fractions.
 * @param {number[]} wanted target per line, already at or above its floor
 * @param {number[]} floorOf minimum per line
 * @param {number[]} free indexes of the lines that may change
 * @param {number} total the sum to reach
 * @returns {{ok: true, values: number[]} | Extract<FitResult, {ok: false}>}
 */
function spreadDifference(wanted, floorOf, free, total) {
  const difference = total - sum(wanted);
  const values = wanted.slice();
  if (Math.abs(difference) <= EPSILON) return { ok: true, values };
  if (!free.length) return { ok: false, reason: "locked" };

  if (difference > 0) {
    const weights = free.map((i) => wanted[i]);
    const weightSum = sum(weights);
    free.forEach((i, k) => {
      const share = weightSum > 0 ? weights[k] / weightSum : 1 / free.length;
      values[i] += difference * share;
    });
    return { ok: true, values };
  }

  const slack = free.map((i) => wanted[i] - floorOf[i]);
  const slackSum = sum(slack);
  if (slackSum + 1e-6 < -difference) {
    return { ok: false, reason: "floors", shortfall: -difference - slackSum };
  }
  free.forEach((i, k) => {
    values[i] = floorOf[i] + slack[k] * (1 + difference / slackSum);
  });
  return { ok: true, values };
}

/**
 * Rounds fractional amounts down, then distributes the leftover units by largest remainder.
 * @param {number[]} values fractional amounts that add up to the total
 * @param {number[]} floorOf minimum per line
 * @param {number[]} free indexes of the lines that may change
 * @param {Set<number>} lockedSet indexes of lines kept exactly
 * @param {number} total the sum to reach
 * @returns {FitResult}
 */
function roundToTotal(values, floorOf, free, lockedSet, total) {
  const amounts = values.map((value, i) =>
    lockedSet.has(i) ? value : Math.max(floorOf[i], Math.floor(value + 1e-7)),
  );
  let remaining = total - sum(amounts);
  const fraction = (/** @type {number} */ i) => values[i] - Math.floor(values[i]);
  const order = free.slice().sort((a, b) => fraction(b) - fraction(a));

  for (let k = 0; remaining > 0 && order.length; k = (k + 1) % order.length) {
    amounts[order[k]]++;
    remaining--;
  }
  for (let k = 0; remaining < 0 && k < order.length * 3; k++) {
    const i = order[k % order.length];
    if (amounts[i] > floorOf[i]) {
      amounts[i]--;
      remaining++;
    }
  }
  return remaining === 0 ? { ok: true, amounts } : { ok: false, reason: "rounding" };
}

/**
 * Percentages to one decimal that always add up to exactly 100.0 (largest remainder method).
 * @param {number[]} amounts
 * @param {number} total
 * @returns {number[]}
 */
export function pctList(amounts, total) {
  if (!total) return amounts.map(() => 0);
  const raw = amounts.map((amount) => (amount / total) * 1000);
  const tenths = raw.map(Math.floor);
  let remaining = Math.round((sum(amounts) / total) * 1000) - sum(tenths);
  raw
    .map((value, i) => [value - tenths[i], i])
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (remaining > 0) {
        tenths[i]++;
        remaining--;
      }
    });
  return tenths.map((value) => value / 10);
}
