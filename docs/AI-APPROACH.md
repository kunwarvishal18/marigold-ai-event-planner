# Marigold AI: How the Planning Assistant Works

> Submission companion for Hack2Skill PromptWars — Celebration & Event Planner.
>
> This document describes the implementation in the repository. Live Claude behaviour must be verified in the Claude Artifact runtime; automated browser tests use a mock and do not establish the quality of real model responses.

## The problem

Planning a wedding, birthday or community event involves connected decisions: a fixed budget, tasks with deadlines and dependencies, vendors with booking dates, guest needs and last-minute changes. A conversational answer alone is not enough if its totals are inconsistent or if changes silently overwrite the plan.

## The approach: Claude proposes; code validates; people decide

Marigold combines generative AI with deterministic planning rules.

1. **Describe the event.** The user provides event details such as type, date, guest count, budget, city, style and priorities.
2. **Generate a structured plan.** In the Claude Artifact runtime, Claude proposes a plan as structured JSON. The app validates the response and can retry once with validation feedback.
3. **Enforce invariants in code.** Budget allocation, totals, committed-spend floors, dates and task dependencies are checked by JavaScript rather than trusted to the model's arithmetic.
4. **Review changes before applying them.** Conversational edits are represented as a before/after proposal. The user can apply or reject it; history supports undo. A stale proposal is blocked if the plan changes before it is applied.
5. **Keep checking the plan.** Rule-based risk checks and a health score identify issues such as over-budget plans, overdue tasks, capacity constraints and missing contingency arrangements. An optional Claude review can add contextual observations.
6. **Help the user act.** The dependency-aware “Do next” list ranks eligible tasks and explains why each action is recommended.

## What uses AI, and what does not

| Capability                                                | Implementation                                              |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| Personalised event plan, ideas and contextual risk review | Claude in the Artifact runtime                              |
| Conversational responses and proposed edits               | Claude, followed by validation and a user-reviewed proposal |
| Exact budget totals and committed-spend floors            | Deterministic JavaScript                                    |
| Scheduling and dependency handling                        | Deterministic JavaScript                                    |
| Rule-based risk checks and health score                   | Deterministic JavaScript                                    |
| Apply, reject, undo and stale-proposal protection         | Application logic                                           |
| Standalone mode without the Claude runtime                | Clearly labelled templates and rule-based functionality     |

The standalone build is useful as a fallback, but it should not be represented as a live Claude session when the Claude runtime is unavailable.

## Reliability and safety measures

The implementation documents the following safeguards:

- Structured model output is validated before use.
- Invalid responses can trigger one retry with validation feedback.
- Duplicate in-flight requests are ignored and stale responses are discarded.
- Budget and scheduling invariants are enforced in code.
- Consequential plan edits require explicit user approval.
- Stored plans and proposals are sanitised against allow-listed fields.
- CSV export guards against spreadsheet-formula injection.
- The jsPDF CDN asset is pinned with a Subresource Integrity hash.
- User-provided text is treated as data in prompts, rather than as instructions to follow.

These controls reduce predictable failure modes; they do not guarantee that every AI suggestion is correct. Users should review estimates, vendor details and important event decisions.

## Testing: what the results mean

The repository's `TESTING.md` records unit tests, browser journeys on the modular and standalone builds, coverage checks, mutation checks and a performance benchmark. The browser suite substitutes a mock Claude runtime with controlled responses, including malformed and delayed responses.

That testing verifies application behaviour under those test conditions. It **does not measure the quality, latency or consistency of live Claude responses**. Before submission, manually smoke-test the Artifact with:

1. A normal event brief.
2. A budget reduction that conflicts with committed spend.
3. A major requested change, checking preview, approval, rejection or undo.
4. A slow or failed model call, if reproducible, checking that the UI communicates the failure clearly.

Record the date, scenario and observed result for each live test. Do not claim a scenario passed unless it was actually run.

## Demo story

A concise demonstration should follow one event from start to finish:

1. Enter a realistic event brief.
2. Generate and inspect the budget, timeline and vendor checklist.
3. Ask the co-planner to reduce the budget or move the event date.
4. Show the before/after proposal and explain why user approval matters.
5. Demonstrate a constraint or risk, then show the “Do next” recommendation.
6. End with the event-day command center and the repository's test evidence.

Use the real application and genuine output. Clearly distinguish Claude-generated results from templates and deterministic calculations.

## Links

- Repository: https://github.com/kunwarvishal18/marigold-ai-event-planner
- Claude Artifact: https://claude.ai/artifact/RcrBY95y94zQQPAEgWdWAa
- Architecture: [ARCHITECTURE.md](../ARCHITECTURE.md)
- Testing record: [TESTING.md](../TESTING.md)

## Before submitting

- [ ] Confirm the live Artifact opens in a fresh browser session.
- [ ] Verify that a real Claude request completes successfully.
- [ ] Run the live smoke tests above and record the actual results.
- [ ] Check the challenge portal for required links, tools, format and deadline.
- [ ] Confirm the video and narrative use genuine output and accurately describe the tools used.
