/**
 * @file Demo scenarios on the welcome screen. Each fills the brief form with a realistic example.
 */
import { addDays, toIsoDate, today } from "./dates.js";

/**
 * @typedef {object} Scenario
 * @property {string} label
 * @property {string} summary one line shown under the label
 * @property {Omit<import("./model.js").Brief, "date"> & {daysAway: number}} brief the event is
 *   set `daysAway` days from today
 */

/**
 * Demo briefs offered on the welcome screen.
 * @type {Scenario[]}
 */
export const SCENARIOS = [
  {
    label: "Jaipur wedding",
    summary: "250 guests · ₹25,00,000 · Rajasthani heritage",
    brief: {
      type: "Wedding",
      name: "Aanya & Rohan's wedding",
      daysAway: 240,
      time: "17:00",
      guests: 250,
      venueCapacity: 300,
      budget: 2500000,
      currency: "INR",
      city: "Jaipur",
      style: "Rajasthani heritage, marigold and pastel",
      notes:
        "Three functions: mehendi, sangeet, wedding. Vegetarian catering. Step-free access and seating for grandparents.",
    },
  },
  {
    label: "Bengaluru garden birthday",
    summary: "40 guests · ₹25,000 · sustainable",
    brief: {
      type: "Birthday",
      name: "Meera's 30th garden party",
      daysAway: 21,
      time: "16:00",
      guests: 40,
      venueCapacity: null,
      budget: 25000,
      currency: "INR",
      city: "Bengaluru",
      style: "Sustainable garden birthday",
      notes: "Vegetarian food. Minimal plastic: steel plates, cloth décor, no balloons.",
    },
  },
  {
    label: "Bengaluru sustainability festival",
    summary: "500 guests · ₹1,00,000 · community",
    brief: {
      type: "Community event",
      name: "Green Neighbourhood Festival",
      daysAway: 60,
      time: "09:00",
      guests: 500,
      venueCapacity: 800,
      budget: 100000,
      currency: "INR",
      city: "Bengaluru",
      style: "Community sustainability festival",
      notes:
        "Volunteer-run. Waste segregation and composting. Accessible entry with ramps. Free entry.",
    },
  },
];
/**
 * Turns a scenario into a brief dated relative to today.
 * @param {Scenario} scenario
 * @returns {import("./model.js").Brief}
 */
export function scenarioBrief(scenario) {
  const { daysAway, ...brief } = scenario.brief;
  return { ...brief, date: toIsoDate(addDays(today(), daysAway)) };
}
