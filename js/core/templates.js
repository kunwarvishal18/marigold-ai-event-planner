/**
 * @file Expands the compact template data into the same shape as a generated plan.
 */
import { TEMPLATES } from "./template-data.js";

/**
 * Wedding lead times in TEMPLATES are in weeks; the other event types use days.
 * @param {string} type
 * @param {number} value
 * @returns {number}
 */
const leadTimeInDays = (type, value) => (type === "Wedding" ? value * 7 : value);

/**
 * Expands the compact template for an event type into the same shape Claude's plan uses.
 * Unknown types fall back to the wedding template.
 * @param {string} type event type
 * @returns {import("./validation.js").GeneratedPlan}
 */
export function templateData(type) {
  const template = TEMPLATES[type] || TEMPLATES.Wedding;
  /** @type {import("./validation.js").GeneratedTask[]} */
  const tasks = [];
  template.phases.forEach(([leadTime, phase, titles]) => {
    titles.forEach((title) => {
      tasks.push({
        key: `k${tasks.length}`,
        title: title.replace(/^!/, ""),
        phase,
        daysBefore: leadTimeInDays(type, leadTime),
        priority: title.startsWith("!") ? "high" : "medium",
        dependsOn: [],
      });
    });
  });
  return {
    summary: "",
    budget: template.budget.map(([category, pct, note]) => ({ category, pct, note })),
    tasks,
    vendors: template.vendors.map(
      ([category, critical, bookBy, budgetCategory, checklist, questions]) => ({
        category,
        critical,
        bookByDaysBefore: leadTimeInDays(type, bookBy),
        budgetCategory,
        checklist,
        questions,
      }),
    ),
    ideas: template.ideas.map(([title, detail, tag]) => ({ title, detail, tag })),
    runOfShow: template.run.map(([time, item, owner]) => ({ time, item, owner })),
  };
}
