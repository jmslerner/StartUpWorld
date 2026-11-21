/**
 * The moments where the store's outcome stinger and the world's diegetic layer sound together,
 * as data — so the lab can render both layers through one engine (one limiter) and check that
 * the pair stays clean: nothing clips, the stinger still reads first, the world only adds room.
 *
 * `storeStingersFor` mirrors what src/state/useGameStore.ts plays for one command:
 *   result.sound (success | fail | cash-in | warning …)  at once
 *   + tick       if the week advanced
 *   + alert      if an event opened and none was open before (not for a chained event)
 *   + gameOver   200 ms later if the run ended
 */
import type { EndingType } from "../../types/game";
import type { WorldEvent } from "../../world/types";
import type { SoundName } from "../sounds";

export interface StingerCue {
  sound: SoundName;
  /** Seconds after the command. */
  delay: number;
}

export interface PairSpec {
  label: string;
  /** The world events of one command, as the world layer would receive them. */
  events: readonly WorldEvent[];
  /** The store's stingers for that command. */
  stingers: readonly StingerCue[];
}

const GAME_OVER_SOUND: Record<EndingType, SoundName> = {
  ipo: "gameover-ipo",
  acquisition: "gameover-acquisition",
  bankruptcy: "gameover-bankruptcy",
  "founder-removal": "gameover-founder-removal",
  "zombie-saas": "gameover-zombie-saas",
  "ai-hype-exit": "gameover-ai-hype-exit",
  "forced-acquisition": "gameover-forced-acquisition",
};

/** The command's own result sound, for the events that always come with one. */
const resultSound = (event: WorldEvent): SoundName | null => {
  switch (event.type) {
    case "hired":
    case "asset-acquired":
      return "success";
    case "ship":
    case "launch":
    case "pitch":
    case "board-action":
      return event.ok ? "success" : "fail";
    case "raise":
      return event.ok ? "cash-in" : "fail";
    case "pricing-changed":
    case "build-cancelled":
      return "warning";
    case "retained":
      return "success";
    case "build-started":
      return "click";
    case "crunch-changed":
      return event.on ? "warning" : "click";
    case "released":
      return event.tier === "breakout" ? "opportunity" : event.tier === "solid" ? "success" : event.tier === "shrug" ? "click" : "fail";
    default:
      return null;
  }
};

/** What the store plays for a command that produced these world events ("always" cases only). */
export const storeStingersFor = (events: readonly WorldEvent[]): StingerCue[] => {
  const out: StingerCue[] = [];
  // One command → at most one result sound.
  for (const event of events) {
    const sound = resultSound(event);
    if (sound) {
      out.push({ sound, delay: 0 });
      break;
    }
  }
  if (events.some((event) => event.type === "week-advanced")) out.push({ sound: "tick", delay: 0 });
  // The store alerts only when an event opens with none open before: in a batch that also
  // resolves one (a chained event), there was.
  if (events.some((event) => event.type === "event-opened") && !events.some((event) => event.type === "event-resolved")) {
    out.push({ sound: "alert", delay: 0 });
  }
  for (const event of events) {
    if (event.type === "game-over") out.push({ sound: GAME_OVER_SOUND[event.ending], delay: 0.2 });
  }
  return out;
};

const pair = (label: string, events: readonly WorldEvent[], extra: readonly StingerCue[] = []): PairSpec => ({
  label,
  events,
  stingers: [...storeStingersFor(events), ...extra],
});

const ENDINGS: readonly EndingType[] = ["ipo", "acquisition", "ai-hype-exit", "bankruptcy", "founder-removal", "zombie-saas", "forced-acquisition"];

/**
 * The commonly co-occurring pairs (and the busiest batches) the lab renders together. The
 * batches follow deriveWorldEvents in src/world/events.ts: no cash-changed with a raise, no
 * users-changed with a launch, a cash-changed (the price) with every purchase, hire, launch,
 * board dinner and gift, game-over last.
 */
export const PAIRS: readonly PairSpec[] = [
  pair("hire 1 + success", [
    { type: "hired", role: "engineering", personIds: ["engineering-4"] },
    { type: "cash-changed", delta: -3_000 },
  ]),
  pair("hire 3 + success", [
    { type: "hired", role: "sales", personIds: ["sales-1", "sales-2", "sales-3"] },
    { type: "cash-changed", delta: -9_000 },
  ]),
  pair("ship ok + success", [{ type: "ship", ok: true, reputationDelta: 4 }]),
  pair("ship fail + fail", [{ type: "ship", ok: false, reputationDelta: -3 }]),
  pair("launch ok + success", [
    { type: "launch", ok: true, usersDelta: 420 },
    { type: "cash-changed", delta: -1_800 },
  ]),
  pair("launch fail + fail", [
    { type: "launch", ok: false, usersDelta: 0 },
    { type: "cash-changed", delta: -900 },
  ]),
  pair("pitch ok + success", [{ type: "pitch", ok: true }]),
  pair("pitch fail + fail", [{ type: "pitch", ok: false }]),
  pair("raise ok (vc) + cash-in", [{ type: "raise", ok: true, amount: 10_000_000, source: "vc" }]),
  pair("raise ok (bootstrap) + cash-in", [{ type: "raise", ok: true, amount: 15_000, source: "bootstrap" }]),
  pair("raise fail + fail", [{ type: "raise", ok: false, amount: 0, source: "vc" }]),
  pair("raise + stage change + cash-in", [
    { type: "stage-changed", from: "seed", to: "series-a" },
    { type: "raise", ok: true, amount: 2_000_000, source: "vc" },
  ]),
  pair("board dinner + success", [
    { type: "board-action", action: "dinner", ok: true },
    { type: "cash-changed", delta: -2_000 },
  ]),
  pair("board gift + success", [
    { type: "board-action", action: "gift", ok: true },
    { type: "cash-changed", delta: -5_000 },
  ]),
  pair("board blackmail + success", [{ type: "board-action", action: "blackmail", ok: true }]),
  pair("board blackmail fail + fail", [{ type: "board-action", action: "blackmail", ok: false }]),
  pair("pricing + warning", [{ type: "pricing-changed" }]),
  pair("release breakout + opportunity", [
    { type: "released", buildId: "b1", name: "Halo", tier: "breakout", reception: 96 },
    { type: "experience", personIds: ["e1", "e2"] },
  ]),
  pair("release solid + success", [{ type: "released", buildId: "b1", name: "Halo", tier: "solid", reception: 70 }]),
  pair("release flop + fail", [{ type: "released", buildId: "b1", name: "Halo", tier: "flop", reception: 22 }]),
  pair("retain + success", [
    { type: "retained", personId: "e1" },
    { type: "cash-changed", delta: -7_000 },
  ]),
  pair("crunch on + warning", [{ type: "crunch-changed", buildId: "b1", on: true }]),
  pair("build cancel + warning", [{ type: "build-cancelled", buildId: "b1" }]),
  pair("asset office-upgrade + success", [
    { type: "asset-acquired", assetId: "office-upgrade" },
    { type: "cash-changed", delta: -250_000 },
  ]),
  pair("asset lounge + success", [
    { type: "asset-acquired", assetId: "lounge" },
    { type: "cash-changed", delta: -250_000 },
  ]),
  pair("asset helicopter + success", [
    { type: "asset-acquired", assetId: "helicopter" },
    { type: "cash-changed", delta: -250_000 },
  ]),
  pair("asset jet + success", [
    { type: "asset-acquired", assetId: "jet" },
    { type: "cash-changed", delta: -250_000 },
  ]),
  pair("asset yacht + success", [
    { type: "asset-acquired", assetId: "yacht" },
    { type: "cash-changed", delta: -250_000 },
  ]),
  pair("week + tick", [
    { type: "week-advanced", week: 13 },
    { type: "cash-changed", delta: -12_000 },
    { type: "users-changed", delta: 60 },
  ]),
  pair("week + event + tick + alert", [
    { type: "week-advanced", week: 13 },
    { type: "cash-changed", delta: -12_000 },
    { type: "event-opened", title: "A journalist calls" },
  ]),
  pair("week + departure + tick", [
    { type: "week-advanced", week: 13 },
    { type: "departed", role: "design", personIds: ["design-0"] },
  ]),
  pair("week + phase change + tick", [
    { type: "week-advanced", week: 13 },
    { type: "phase-changed", from: "coworking", to: "office" },
  ]),
  pair("event resolved + cash-in", [{ type: "event-resolved" }, { type: "cash-changed", delta: 50_000 }], [{ sound: "cash-in", delay: 0 }]),
  pair("event resolved + warning", [{ type: "event-resolved" }, { type: "cash-changed", delta: -30_000 }], [{ sound: "warning", delay: 0 }]),
  // A chained event: one resolved and the next opened by the same choice — the store plays the
  // choice's result sound but no alert.
  pair("chained event + success", [{ type: "event-resolved" }, { type: "event-opened", title: "An acquisition offer" }], [{ sound: "success", delay: 0 }]),
  ...ENDINGS.map((ending) =>
    pair(`game over ${ending} (+ week tick)`, [
      { type: "week-advanced", week: 40 },
      { type: "game-over", ending },
    ]),
  ),
];
