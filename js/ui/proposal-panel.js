/**
 * @file The approval preview for a proposed change: what changes, Marigold's checks, and the
 * Apply / Reject buttons.
 */
import { applyProposal, rejectProposal } from "../actions/history.js";
import { pctList } from "../core/budget.js";
import { escapeHtml, formatMoney } from "../core/format.js";
import { sum } from "../core/util.js";
import { state } from "../services/state.js";
import { $, attrIf, prefersReducedMotion, setHtml } from "./dom.js";

const changeClass = (change) => (change > 0 ? "diff-up" : change < 0 ? "diff-down" : "");

function budgetTable(proposal, money) {
  const { diff, after } = proposal;
  if (!diff.budgetChanged) return "";
  const rows = diff.budget
    .map((row) => {
      const change = row.after - row.before;
      const tags =
        (row.added ? ' <span class="badge">new</span>' : "") +
        (row.removed ? ' <span class="badge">removed</span>' : "");
      const committed = row.committed
        ? `<div class="note">${money(row.committed)} committed, protected</div>`
        : "";
      return `<tr>
        <td>${escapeHtml(row.category)}${tags}${committed}</td>
        <td class="num">${money(row.before)}</td>
        <td class="num">${money(row.after)}</td>
        <td class="num ${changeClass(change)}">${change > 0 ? "+" : ""}${change ? money(change) : "—"}</td>
      </tr>`;
    })
    .join("");
  const totalChange = diff.totalAfter - diff.totalBefore;
  const allocatedPct = sum(
    pctList(
      after.budget.map((line) => line.amount),
      after.brief.budget,
    ),
  ).toFixed(1);
  return `<div class="tablewrap"><table>
      <caption class="sr">Budget before and after</caption>
      <thead><tr><th>Category</th><th class="num">Before</th><th class="num">After</th><th class="num">Change</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <th>Total</th>
        <th class="num">${money(diff.totalBefore)}</th>
        <th class="num">${money(diff.totalAfter)}</th>
        <th class="num">${totalChange ? money(totalChange) : "—"}</th>
      </tr></tfoot>
    </table></div>
    <p class="note">After: ${allocatedPct}% allocated, ${money(diff.totalAfter)} of ${money(after.brief.budget)}.</p>`;
}

function briefTable(rows) {
  if (!rows.length) return "";
  const body = rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.from)}</td><td><b>${escapeHtml(row.to)}</b></td></tr>`,
    )
    .join("");
  return `<div class="tablewrap"><table><thead><tr><th>Detail</th><th>Before</th><th>After</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function timelineNote(timeline) {
  if (!timeline) return "";
  const shift =
    timeline.shift == null
      ? "is recalculated"
      : `moves ${Math.abs(timeline.shift)} days ${timeline.shift < 0 ? "earlier" : "later"}`;
  const compressed = timeline.compressed ? ". Deadlines are compressed to fit the time left." : ".";
  return `<div class="callout info">Timeline: every date ${shift}. Overdue tasks: ${timeline.overdueBefore} → ${timeline.overdueAfter}${compressed}</div>`;
}

/** A labelled bullet list; items are already-escaped markup. */
const itemList = (label, items) =>
  items.length
    ? `<div><span class="lbl">${label}</span><ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul></div>`
    : "";

function callouts(proposal, stale) {
  const parts = [];
  if (proposal.blocked) {
    parts.push(
      `<div class="callout err"><b>Can't apply.</b> ${escapeHtml(proposal.blocked)}</div>`,
    );
  }
  if (stale) {
    parts.push(
      '<div class="callout err"><b>Out of date.</b> The plan changed after this was proposed. Reject it and ask again.</div>',
    );
  }
  if (proposal.warnings.length) {
    const items = proposal.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("");
    parts.push(`<div class="callout warn"><b>Marigold's checks:</b><ul>${items}</ul></div>`);
  }
  return parts.join("\n");
}

/** Renders the pending proposal for the open plan, or clears the area. */
export function renderProposal() {
  const host = $("#proposalHost");
  const proposal = state.proposal;
  if (!proposal || !state.plan || proposal.planId !== state.plan.id) {
    setHtml(host, "");
    return;
  }
  const { diff } = proposal;
  const money = (amount) => formatMoney(amount, proposal.after.brief.currency);
  const stale = proposal.status === "stale";
  const originBadge =
    proposal.origin === "ai"
      ? '<span class="badge ai">AI proposal</span>'
      : '<span class="badge rule">Rule-based proposal</span>';
  const vendorAdded = (vendor) =>
    `${escapeHtml(vendor.category)}${vendor.critical ? " (critical)" : ""}: ${vendor.checklist.length} checklist items`;

  setHtml(
    host,
    `<section class="proposal" aria-labelledby="propTitle">
      <div class="badges">${originBadge}<span class="badge">Needs your approval</span></div>
      <h3 id="propTitle" tabindex="-1">${escapeHtml(proposal.title)}</h3>
      ${proposal.explanation ? `<p class="flush">${escapeHtml(proposal.explanation)}</p>` : ""}
      ${callouts(proposal, stale)}
      ${briefTable(diff.brief)}
      ${budgetTable(proposal, money)}
      ${timelineNote(diff.timeline)}
      ${itemList(
        "Tasks added",
        diff.tasksAdded.map(
          (task) =>
            `${escapeHtml(task.title)} <span class="pri ${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>`,
        ),
      )}
      ${itemList(
        "Tasks removed",
        diff.tasksRemoved.map((task) => escapeHtml(task.title)),
      )}
      ${itemList("Vendors added", diff.vendorsAdded.map(vendorAdded))}
      ${itemList(
        "Vendor checklists updated",
        diff.vendorsChanged.map((v) => escapeHtml(v.category)),
      )}
      ${itemList(
        "Ideas added",
        diff.ideasAdded.map((idea) => escapeHtml(idea.title)),
      )}
      ${itemList("Trade-offs", proposal.tradeoffs.map(escapeHtml))}
      <div class="btnrow">
        <button class="btn" type="button" id="applyBtn" ${attrIf(proposal.blocked || stale, "disabled")}>Apply changes</button>
        <button class="btn ghost" type="button" id="rejectBtn">Reject</button>
      </div>
    </section>`,
  );
  $("#applyBtn").addEventListener("click", applyProposal);
  $("#rejectBtn").addEventListener("click", rejectProposal);
}

/** Scrolls the proposal into view and moves focus to its title. */
export function revealProposal() {
  const host = $("#proposalHost");
  host.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  $("#propTitle")?.focus();
}
