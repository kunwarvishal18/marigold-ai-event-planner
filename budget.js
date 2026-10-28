// Marigold — budget.js
import { isNum, sum } from "./util.js";

/* ============ Budget math ============
   fitToTotal: turn target amounts into whole numbers that add up exactly to `total`,
   never below each floor (committed spend), keeping locked lines exactly as given. */
export function fitToTotal(targets, floors, total, locked = []) {
  const n = targets.length; total = Math.round(+total || 0);
  if (!n) return total === 0 ? { ok: true, amounts: [] } : { ok: false, reason: "no-lines" };
  const L = new Set(locked);
  const f = targets.map((_, i) => Math.max(0, Math.ceil(+floors[i] || 0)));
  const x = targets.map((t, i) => { const v = isNum(t) && +t > 0 ? +t : 0; return Math.max(L.has(i) ? Math.round(v) : v, f[i]); });
  L.forEach(i => { f[i] = x[i]; });
  const fsum = sum(f);
  if (fsum > total) return { ok: false, reason: "floors", shortfall: fsum - total };
  const free = [...Array(n).keys()].filter(i => !L.has(i));
  const diff = total - sum(x);
  const real = x.slice();
  if (Math.abs(diff) > 1e-9) {
    if (!free.length) return { ok: false, reason: "locked" };
    if (diff > 0) {
      const w = free.map(i => x[i]); const ws = sum(w);
      free.forEach((i, k) => { real[i] += diff * (ws > 0 ? w[k] / ws : 1 / free.length); });
    } else {
      const slack = free.map(i => x[i] - f[i]); const ss = sum(slack);
      if (ss + 1e-6 < -diff) return { ok: false, reason: "floors", shortfall: -diff - ss };
      free.forEach((i, k) => { real[i] = f[i] + slack[k] * (1 + diff / ss); });
    }
  }
  const out = real.map((v, i) => L.has(i) ? v : Math.max(f[i], Math.floor(v + 1e-7)));
  let rem = total - sum(out);
  const order = free.slice().sort((a, b) => (real[b] - Math.floor(real[b])) - (real[a] - Math.floor(real[a])));
  for (let k = 0; rem > 0 && order.length; k = (k + 1) % order.length) { out[order[k]]++; rem--; }
  for (let k = 0; rem < 0 && k < order.length * 3; k++) { const i = order[k % order.length]; if (out[i] > f[i]) { out[i]--; rem++; } }
  return rem === 0 ? { ok: true, amounts: out } : { ok: false, reason: "rounding" };
}
/* Percentages to one decimal that always add up to exactly 100.0 (largest remainder). */
export function pctList(amounts, total) {
  if (!total) return amounts.map(() => 0);
  const raw = amounts.map(a => a / total * 1000); const fl = raw.map(Math.floor);
  let rem = Math.round(sum(amounts) / total * 1000) - sum(fl);
  raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rem > 0) { fl[i]++; rem--; } });
  return fl.map(v => v / 10);
}
