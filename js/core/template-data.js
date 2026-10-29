/**
 * @file Built-in starter content for each event type (data only). Used when the person picks
 * "template", when Claude is unavailable, and for the sample wedding.
 */

/**
 * Template data per event type. Tuples keep this table compact:
 * budget [category, percent, note]; phases [lead time, phase, tasks ("!" = high priority)];
 * vendors [category, critical, lead time, budget category, checklist, questions];
 * ideas [title, detail, tag]; run [time, item, owner].
 * Wedding lead times are in weeks, the others in days.
 */
/**
 * @typedef {object} Template
 * @property {Array<[string, number, string]>} budget [category, percent, note]
 * @property {Array<[number, string, string[]]>} phases [lead time, phase, task titles]
 * @property {Array<[string, boolean, number, string, string[], string[]]>} vendors
 *   [category, critical, lead time, budget category, checklist, questions]
 * @property {Array<[string, string, string]>} ideas [title, detail, tag]
 * @property {Array<[string, string, string]>} run [time, item, owner]
 */

/** @type {Readonly<Record<string, Template>>} */
export const TEMPLATES = {
  Wedding: {
    budget: [
      ["Venue & accommodation", 28, "Peak-season dates often book 9–12 months out."],
      ["Catering & bar", 25, "Per-plate pricing; confirm a tasting and a 5% headcount buffer."],
      ["Décor & florals", 12, "Reuse ceremony florals at the reception."],
      ["Photography & video", 8, "Get raw-file delivery and turnaround in writing."],
      ["Attire & beauty", 9, "Include trials and alterations."],
      ["Entertainment & music", 6, "DJ or live band, sound and lighting."],
      ["Invitations & favours", 3, "Digital save-the-dates cut print costs."],
      ["Transport & logistics", 3, "Guest shuttles and arrival car."],
      ["Contingency", 6, "Keep untouched until the final month."],
    ],
    phases: [
      [
        52,
        "Foundation",
        [
          "!Agree total budget and who contributes",
          "!Draft the guest list",
          "!Shortlist and book the venue",
          "Choose date and functions",
        ],
      ],
      [
        40,
        "Key vendors",
        [
          "!Book photographer and videographer",
          "!Book caterer and schedule a tasting",
          "Book decorator",
          "Send save-the-dates",
        ],
      ],
      [
        26,
        "Design",
        [
          "Finalise theme and colour palette",
          "Order outfits",
          "Book makeup and mehendi artists",
          "Book entertainment",
        ],
      ],
      [
        16,
        "Guest experience",
        [
          "!Send invitations",
          "Reserve guest room blocks",
          "Plan guest transport",
          "Draft the event-day schedule",
        ],
      ],
      [
        8,
        "Confirm details",
        [
          "Final menu and tasting",
          "Approve décor mock-up",
          "Outfit fittings",
          "Buy favours and gifts",
        ],
      ],
      [
        3,
        "Final checks",
        [
          "!Give final headcount to caterer",
          "!Share run sheet with all vendors",
          "Seating plan",
          "Pay balances due",
        ],
      ],
      [0, "Event week", ["Pack the emergency kit", "Hand coordination to a point person"]],
    ],
    vendors: [
      [
        "Venue",
        true,
        48,
        "Venue",
        [
          "Visit at the same time of day as the event",
          "Check capacity, parking and step-free access",
          "Confirm curfew and noise limits",
        ],
        ["What is included in the hire fee?", "Can we bring outside caterers or décor?"],
      ],
      [
        "Caterer",
        true,
        40,
        "Catering",
        ["Book a tasting", "Confirm dietary options", "Agree service staff ratio"],
        ["How do you price overtime and leftovers?", "What is the minimum guarantee?"],
      ],
      [
        "Photographer & videographer",
        true,
        40,
        "Photography",
        ["Review full galleries, not highlights", "Agree a shot list", "Confirm delivery date"],
        ["Do you bring a second shooter?", "Who owns usage rights?"],
      ],
      [
        "Decorator",
        false,
        30,
        "Décor",
        ["Share a mood board", "Approve a mock-up", "Confirm set-up and tear-down times"],
        ["Which items are rented versus bought?", "What is the rain plan for outdoor décor?"],
      ],
      [
        "Entertainment",
        false,
        26,
        "Entertainment",
        ["Share must-play and do-not-play lists", "Check sound limits with the venue"],
        ["What do you need from the venue?"],
      ],
      [
        "Makeup & mehendi artists",
        false,
        24,
        "Attire",
        ["Book a trial", "Confirm number of people and timing"],
        ["How early do you need to start?"],
      ],
    ],
    ideas: [
      [
        "Welcome drink with a story",
        "A signature mocktail named after how the couple met, served on arrival.",
        "Experience",
      ],
      [
        "Marigold string canopy",
        "Fresh marigold strands overhead at the mehendi; affordable and photogenic.",
        "Décor",
      ],
      [
        "Grandparents' lounge",
        "A shaded seating corner with water, cushions and a clear view of the stage.",
        "Comfort",
      ],
      [
        "Live portrait artist",
        "Sketches guests at the sangeet and doubles as a take-home favour.",
        "Entertainment",
      ],
    ],
    run: [
      ["08:00", "Vendor set-up begins", "Decorator"],
      ["11:00", "Getting ready", "Makeup team"],
      ["16:00", "Guests arrive, welcome drinks", "Hospitality"],
      ["17:30", "Ceremony", "Family"],
      ["19:30", "Dinner service", "Caterer"],
      ["21:00", "Music and dancing", "Entertainment"],
      ["23:00", "Send-off", "Family"],
      ["23:30", "Teardown", "Decorator"],
    ],
  },
  Birthday: {
    budget: [
      ["Venue", 25, "Home or a community hall cuts this sharply."],
      ["Food & cake", 35, "Order the cake two weeks ahead."],
      ["Decorations", 12, "One photo backdrop goes a long way."],
      ["Entertainment & activities", 14, "Games host, magician or a playlist."],
      ["Invitations & return gifts", 8, "Digital invites are free."],
      ["Contingency", 6, "Extra snacks and last-minute supplies."],
    ],
    phases: [
      [42, "Plan", ["!Set budget and guest count", "Pick a theme", "!Book the venue"]],
      [28, "Book", ["!Send invitations", "Book entertainment", "!Order the cake"]],
      [14, "Prepare", ["Buy decorations", "Plan the menu", "Order return gifts"]],
      [7, "Confirm", ["!Chase RSVPs", "Make a playlist", "Confirm cake pickup time"]],
      [0, "Party day", ["Set up décor", "Charge camera and speaker"]],
    ],
    vendors: [
      [
        "Venue",
        true,
        35,
        "Venue",
        ["Check capacity and timing", "Confirm cleaning rules"],
        ["Can we decorate the night before?"],
      ],
      [
        "Bakery",
        true,
        21,
        "Food",
        ["Choose flavour and size", "Confirm delivery or pickup"],
        ["Can you do an eggless option?"],
      ],
      [
        "Entertainment",
        false,
        21,
        "Entertainment",
        ["Agree run time", "Share age group"],
        ["What space do you need?"],
      ],
      [
        "Décor",
        false,
        14,
        "Decorations",
        ["Order backdrop and table décor"],
        ["Do you install and take down?"],
      ],
    ],
    ideas: [
      [
        "Memory lane wall",
        "Photos from each year of the guest of honour, with string lights.",
        "Décor",
      ],
      ["Time capsule", "Guests write a note to be opened at the next birthday.", "Experience"],
      [
        "Build-your-own dessert bar",
        "Plain cupcakes with toppings so guests decorate their own.",
        "Food",
      ],
    ],
    run: [
      ["15:00", "Set-up and décor", "Host"],
      ["16:00", "Guests arrive", "Host"],
      ["16:30", "Games and activities", "Entertainment"],
      ["17:30", "Cake cutting", "Family"],
      ["18:00", "Food", "Host"],
      ["19:00", "Return gifts and goodbyes", "Host"],
    ],
  },
  "Community event": {
    budget: [
      ["Venue & permits", 20, "Public spaces may need a permit; apply early."],
      ["Food & refreshments", 25, "Partner with local stalls on a revenue share."],
      ["Stage, sound & lighting", 18, "Get two quotes."],
      ["Marketing & signage", 10, "Posters, social posts, banners."],
      ["Activities & performers", 12, "Local talent often performs for a small fee."],
      ["Safety & cleanup", 8, "First aid, volunteers, bins."],
      ["Contingency", 7, "Weather backups and extras."],
    ],
    phases: [
      [
        84,
        "Organise",
        [
          "!Form a volunteer committee",
          "Set goals and budget",
          "!Pick date and venue",
          "!Apply for permits",
        ],
      ],
      [
        56,
        "Line up partners",
        ["Approach sponsors", "!Book stage and sound", "Invite performers and stalls"],
      ],
      [
        28,
        "Promote",
        [
          "Launch posters and social posts",
          "!Recruit volunteers",
          "Plan site layout and accessible entry",
        ],
      ],
      [
        7,
        "Final prep",
        ["!Volunteer briefing", "Confirm all vendors", "Prepare signage and first aid"],
      ],
      [0, "Event day", ["Set up early", "Run registration desk", "Cleanup crew after"]],
    ],
    vendors: [
      [
        "Venue / local authority",
        true,
        70,
        "Venue",
        ["Confirm permit requirements", "Check power and water"],
        ["What are the noise and curfew rules?"],
      ],
      [
        "Sound & stage",
        true,
        50,
        "Stage",
        ["Agree set-up time", "Run a sound check"],
        ["Do you supply a technician?"],
      ],
      [
        "Waste & cleanup crew",
        true,
        28,
        "Safety",
        ["Agree bin and segregation plan", "Confirm post-event cleanup time"],
        ["Do you handle recycling and compost?"],
      ],
      [
        "Food stalls",
        false,
        35,
        "Food",
        ["Check food safety licences", "Agree pitch fees"],
        ["Do you bring your own power?"],
      ],
      [
        "Printing",
        false,
        30,
        "Marketing",
        ["Order posters and banners"],
        ["What is the turnaround time?"],
      ],
    ],
    ideas: [
      [
        "Neighbourhood skills fair",
        "Residents run 10-minute demos: cooking, repairs, crafts.",
        "Activity",
      ],
      [
        "Quiet zone",
        "A low-noise area for families with young children or sensory needs.",
        "Comfort",
      ],
      [
        "Zero-waste pledge",
        "Reusable cups with a small deposit and a water refill station.",
        "Sustainability",
      ],
    ],
    run: [
      ["07:00", "Set-up and safety walk", "Volunteer lead"],
      ["09:00", "Registration opens", "Volunteers"],
      ["10:00", "Opening", "Organisers"],
      ["11:00", "Activities and stalls", "Stall leads"],
      ["13:00", "Performances", "Stage manager"],
      ["16:00", "Closing", "Organisers"],
      ["16:30", "Cleanup", "Cleanup crew"],
    ],
  },
};
/** Starter items for the event-day emergency checklist. */
export const EMERGENCY = [
  "First-aid kit packed and its location known",
  "Emergency numbers shared with the coordination team",
  "Power banks and spare chargers ready",
  "Some cash for last-minute payments",
  "Repair kit: safety pins, tape, scissors",
  "A named point person for each vendor",
];
/** Starter items for the weather contingency checklist. */
export const WEATHER = [
  "Check a trusted forecast 3 days and 1 day before",
  "Covered backup area or tent option confirmed with the venue",
  "Shade, fans or heaters planned for guests",
  "Rain plan for décor, sound and power",
  "Plan for telling guests about any change",
];
