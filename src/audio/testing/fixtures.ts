/**
 * Shared fixtures for the audio tests and the audio lab: a plausible WorldSnapshot and at
 * least one sample of every WorldEvent type (typed as a Record so a new event type that has
 * no sample fails the build).
 */
import type { WorldEvent, WorldEventType, WorldSnapshot } from "../../world/types";

/**
 * A complete snapshot. Built as a plain object and spread (not written as a `WorldSnapshot`
 * literal) so that it type-checks against both the reference copy of src/world/types.ts in this
 * worktree and the main checkout's newer one, which adds a required `pricingModel` (excess-
 * property checks do not apply to spread members). Fields this file does not know about yet
 * will fail `tsc` here — on purpose: that is the moment to add them.
 */
const BASE_SNAPSHOT = {
  runId: 1,
  setupComplete: true,
  companyName: "Acme AI",
  founderName: "Ada",
  founderArchetype: "hacker",
  cofounderArchetype: "operator",
  week: 12,
  ap: 3,
  maxAp: 3,
  phase: "office",
  stage: "seed",
  cash: 250_000,
  netBurn: 12_000,
  runwayWeeks: 20,
  valuation: 4_000_000,
  users: 1_800,
  mrr: 9_000,
  reputation: 40,
  morale: 62,
  cohesion: 58,
  stress: 30,
  volatility: 35,
  team: { engineering: 4, design: 1, marketing: 1, sales: 1, ops: 1, hr: 0, legal: 0, data: 0, product: 0, executive: 0 },
  teamSize: 8,
  people: [],
  hiddenPeople: 0,
  ownedAssets: [],
  availableAssets: [],
  pendingEventTitle: null,
  gameOver: null,
  pricingModel: "consumer",
} as const;

export const makeSnapshot = (overrides: Partial<WorldSnapshot> = {}): WorldSnapshot => ({
  ...BASE_SNAPSHOT,
  team: { ...BASE_SNAPSHOT.team },
  people: [],
  ownedAssets: [],
  availableAssets: [],
  ...overrides,
});

export const SAMPLE_EVENTS: Record<WorldEventType, readonly WorldEvent[]> = {
  "run-reset": [{ type: "run-reset" }],
  "setup-completed": [{ type: "setup-completed" }],
  "week-advanced": [{ type: "week-advanced", week: 13 }],
  hired: [
    { type: "hired", role: "engineering", personIds: ["engineering-4"] },
    { type: "hired", role: "sales", personIds: ["sales-1", "sales-2", "sales-3", "sales-4"] },
    { type: "hired", role: "ops", personIds: [] },
  ],
  departed: [{ type: "departed", role: "design", personIds: ["design-0"] }],
  ship: [
    { type: "ship", ok: true, reputationDelta: 4 },
    { type: "ship", ok: false, reputationDelta: -3 },
  ],
  launch: [
    { type: "launch", ok: true, usersDelta: 420 },
    { type: "launch", ok: true, usersDelta: 0 },
    { type: "launch", ok: false, usersDelta: 0 },
  ],
  pitch: [
    { type: "pitch", ok: true },
    { type: "pitch", ok: false },
  ],
  raise: [
    { type: "raise", ok: true, amount: 1_500_000, source: "vc" },
    { type: "raise", ok: true, amount: 15_000, source: "bootstrap" },
    { type: "raise", ok: false, amount: 0, source: "vc" },
  ],
  "board-action": [
    { type: "board-action", action: "dinner", ok: true },
    { type: "board-action", action: "gift", ok: true },
    { type: "board-action", action: "blackmail", ok: true },
    { type: "board-action", action: "blackmail", ok: false },
  ],
  "pricing-changed": [{ type: "pricing-changed" }],
  "cash-changed": [
    { type: "cash-changed", delta: 8_000 },
    { type: "cash-changed", delta: -12_000 },
  ],
  "users-changed": [
    { type: "users-changed", delta: 150 },
    { type: "users-changed", delta: -40 },
  ],
  "phase-changed": [{ type: "phase-changed", from: "coworking", to: "office" }],
  "stage-changed": [{ type: "stage-changed", from: "seed", to: "series-a" }],
  "asset-acquired": [
    { type: "asset-acquired", assetId: "office-upgrade" },
    { type: "asset-acquired", assetId: "lounge" },
    { type: "asset-acquired", assetId: "helicopter" },
    { type: "asset-acquired", assetId: "jet" },
    { type: "asset-acquired", assetId: "yacht" },
  ],
  "event-opened": [{ type: "event-opened", title: "A journalist calls" }],
  "event-resolved": [{ type: "event-resolved" }],
  "easter-egg": [
    { type: "easter-egg", command: "coffee" },
    { type: "easter-egg", command: "pivot" },
  ],
  "command-failed": [{ type: "command-failed", command: "ship" }],
  "game-over": [
    { type: "game-over", ending: "ipo" },
    { type: "game-over", ending: "acquisition" },
    { type: "game-over", ending: "ai-hype-exit" },
    { type: "game-over", ending: "bankruptcy" },
    { type: "game-over", ending: "founder-removal" },
    { type: "game-over", ending: "zombie-saas" },
    { type: "game-over", ending: "forced-acquisition" },
  ],
};

export const WORLD_EVENT_TYPES = Object.keys(SAMPLE_EVENTS) as WorldEventType[];

/** Short label for an event sample (lab buttons, test names). */
export const describeEvent = (event: WorldEvent): string => {
  switch (event.type) {
    case "ship":
    case "launch":
    case "pitch":
      return `${event.type} ${event.ok ? "ok" : "fail"}`;
    case "raise":
      return `raise ${event.ok ? `ok (${event.source})` : "fail"}`;
    case "board-action":
      return `board ${event.action} ${event.ok ? "ok" : "fail"}`;
    case "hired":
      return `hired ×${event.personIds.length}`;
    case "cash-changed":
    case "users-changed":
      return `${event.type} ${event.delta > 0 ? "+" : "−"}`;
    case "asset-acquired":
      return `asset ${event.assetId}`;
    case "easter-egg":
      return `easter-egg ${event.command}`;
    case "game-over":
      return `game-over ${event.ending}`;
    default:
      return event.type;
  }
};
