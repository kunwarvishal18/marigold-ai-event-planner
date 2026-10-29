/**
 * @file Demo scenarios on the welcome screen. Each fills the brief form with a realistic example.
 */
import { addDays, toIsoDate, today } from "./dates.js";

/**
 * Demo briefs offered on the welcome screen. `days` is how far from today the event is set.
 */
export const SCENARIOS = [
  {
    label: "Jaipur wedding",
    sub: "250 guests · ₹25,00,000 · Rajasthani heritage",
    b: {
      type: "Wedding",
      name: "Aanya & Rohan's wedding",
      days: 240,
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
    sub: "40 guests · ₹25,000 · sustainable",
    b: {
      type: "Birthday",
      name: "Meera's 30th garden party",
      days: 21,
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
    sub: "500 guests · ₹1,00,000 · community",
    b: {
      type: "Community event",
      name: "Green Neighbourhood Festival",
      days: 60,
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
 * @param {(typeof SCENARIOS)[number]} scenario
 * @returns {object} an event brief
 */
export function scenarioBrief(scenario) {
  return { ...scenario.b, date: toIsoDate(addDays(today(), scenario.b.days)) };
}
