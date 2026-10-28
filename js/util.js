// Marigold — util.js
import { S } from "./state.js";

/* ============ Utilities ============ */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const sum = a => a.reduce((x, y) => x + (+y || 0), 0);
export const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
export const uid = () => Math.random().toString(36).slice(2, 9) + (Date.now() % 1e6).toString(36);
export const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const clone = o => JSON.parse(JSON.stringify(o));
export const isNum = v => v !== null && v !== "" && Number.isFinite(+v);
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  /* Raw text access, used to back up unreadable data instead of overwriting it. */
  raw(k) { try { return localStorage.getItem(k); } catch { return null; } },
  setRaw(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
};
export const hasOwn = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
/* Largest money amount Marigold accepts anywhere (one trillion). Keeps sums exact in floating point. */
export const MAX_AMOUNT = 1e12;
/* A whole, finite, non-negative amount within MAX_AMOUNT, or null. */
export function safeAmount(v) { if (!isNum(v)) return null; const n = Math.round(+v); return n >= 0 && n <= MAX_AMOUNT ? n : null; }
export const DAY = 86400000;
export function sod(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function today() { return sod(new Date()); }
export function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
/* Strict YYYY-MM-DD: the date must survive a full round trip, so values JavaScript would quietly
   normalise (Feb 31, month 13, two-digit years mapped to 19xx) are rejected. */
export function parseISO(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(2000, 0, 1); dt.setFullYear(y, m - 1, d); dt.setHours(0, 0, 0, 0);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function daysBetween(a, b) { return Math.round((sod(b) - sod(a)) / DAY); }
export function fmtDate(d) { return d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "No date"; }
export function fmtShort(d) { return d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"; }
export function money(n, cur) { cur = cur || (S.plan && S.plan.brief.currency) || "INR"; try { return new Intl.NumberFormat(cur === "INR" ? "en-IN" : "en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(Math.round(+n || 0)); } catch { return `${cur} ${Math.round(+n || 0).toLocaleString()}`; } }
export function moneyPlain(n, cur) { return `${cur} ${new Intl.NumberFormat(cur === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 0 }).format(Math.round(+n || 0))}`; }
export const CONT_RE = /contingen|buffer|reserve|emergency fund|miscellaneous|misc\b/i;
export const STATUSES = ["Not started", "Shortlisted", "Contacted", "Negotiating", "Booked", "Completed"];
export const PAYMENTS = ["Unpaid", "Deposit paid", "Paid in full"];
export const isBooked = v => v.status === "Booked" || v.status === "Completed";
