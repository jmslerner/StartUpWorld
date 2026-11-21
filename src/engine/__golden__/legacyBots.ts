/**
 * Legacy golden master: the two legacy-only bots and the hashing they are judged by.
 * Shared by `scripts/legacyGolden.ts` (record / verify) and `src/engine/legacyGolden.test.ts`.
 * NOT imported by production code. The bots type only commands that exist in today's game,
 * so a run must hash identically before and after the tycoon systems land (the whole
 * GameState minus `people` and `product`, at fixed checkpoints and at run end).
 */
import type { CofounderArchetype, FounderArchetype, GameState, Stage, TeamRoster } from "../../types/game";
import { executeCommand } from "../commands";
import { createInitialState } from "../actions";
import { refreshDerivedNoLog } from "../derived";
import { STAGE_VALUATION_FLOOR } from "../valuation";
import { makeState } from "../testHelpers";

export type LegacyBotKind = "stock" | "wide";

export const FOUNDERS: FounderArchetype[] = ["visionary", "hacker", "sales-animal", "philosopher"];
export const COFOUNDERS: CofounderArchetype[] = ["operator", "builder", "rainmaker", "powderkeg"];
export const CHECKPOINTS = [5, 10, 20, 40, 80, 120, 200];
export const FULL_SEEDS = 12;
export const FULL_WEEKS = 200;

/** The seed `scripts/balanceSim.ts` uses for run i of a founder x cofounder pair. */
export const seedFor = (i: number, f: string, c: string): number =>
  (((i + 1) * 2654435761) ^ (f.length * 97) ^ (c.length * 193)) >>> 0;

/** Script-side PRNG for the wide bot's choices (never touches the game's RNG). */
export const mulberry = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
};

export const canonicalJson = (value: unknown): string => JSON.stringify(canonical(value));

export const fnv1a32 = (input: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
};

/** The whole state minus the two tycoon slices (absent on today's engine), canonicalised and hashed. */
export const hashLegacy = (state: GameState): string => {
  const rest: Record<string, unknown> = { ...(state as unknown as Record<string, unknown>) };
  delete rest.people;
  delete rest.product;
  return fnv1a32(canonicalJson(rest));
};

// ── Stock bot: scripts/balanceSim.ts's policy, verbatim ──

const stageSoftCap: Record<Stage, number> = {
  garage: 250_000,
  seed: 2_500_000,
  "series-a": 12_000_000,
  growth: 60_000_000,
};

const impliedValuation = (s: GameState) => Math.max(s.valuation, STAGE_VALUATION_FLOOR[s.stage]);

const desiredRaiseAmount = (s: GameState) => {
  const v = impliedValuation(s);
  return Math.min(stageSoftCap[s.stage], Math.max(50_000, Math.round((v * 0.15) / 1000) * 1000));
};

const safeCmd = (s: GameState, input: string): GameState => executeCommand(s, input).state;

const pickHireRole = (s: GameState): { role: string; count: number } => {
  const { engineering: eng, design, ops, marketing: mkt, sales } = s.team;
  const exec = eng + design + ops;
  const gtm = mkt + sales;
  if (gtm > exec) {
    if (ops < Math.ceil(gtm / 2)) return { role: "ops", count: 1 };
    return { role: "engineering", count: 1 };
  }
  if (eng < 3) return { role: "engineering", count: 1 };
  if (mkt < 2) return { role: "marketing", count: 1 };
  if (sales < 2) return { role: "sales", count: 1 };
  if (ops < 2) return { role: "ops", count: 1 };
  return s.week % 2 === 0 ? { role: "engineering", count: 1 } : { role: "marketing", count: 1 };
};

const playStockWeek = (state: GameState): GameState => {
  let s = state;
  if (s.pendingEvent) {
    s = safeCmd(s, "choose 1");
    if (s.gameOver) return s;
  }
  for (let i = 0; i < 3; i++) {
    if (s.gameOver) break;
    if (s.pendingEvent) {
      s = safeCmd(s, "choose 1");
      continue;
    }
    const runway = s.burn > 0 ? Math.floor(s.cash / Math.max(1, s.burn)) : 999;
    if (runway <= 4) {
      if (s.investors.pipeline.length === 0) {
        s = safeCmd(s, "pitch");
        continue;
      }
      s = safeCmd(s, `raise vc ${desiredRaiseAmount(s)}`);
      continue;
    }
    if (s.investors.pipeline.length < 2 && s.week % 3 === 0) {
      s = safeCmd(s, "pitch");
      continue;
    }
    if (runway >= 8) {
      const h = pickHireRole(s);
      const beforeCash = s.cash;
      s = safeCmd(s, `hire ${h.role} ${h.count}`);
      if (s.cash !== beforeCash) continue;
    }
    if (s.week % 2 === 1) {
      s = safeCmd(s, `ship feature-w${s.week}-a${s.ap}`);
    } else {
      s = safeCmd(s, `launch campaign-w${s.week}`);
    }
  }
  return safeCmd(s, "end");
};

// ── Wide bot: every legacy command the stock bot never types (spec §10.3) ──

const wideCommand = (s: GameState, r: () => number, i: number): string => {
  if (s.pendingEvent) return `choose ${1 + Math.floor(r() * s.pendingEvent.choices.length)}`;
  const runway = s.burn > 0 ? Math.floor(s.cash / Math.max(1, s.burn)) : 999;
  const v = impliedValuation(s);
  const x = r();
  if (x < 0.04) return `hire ux ${[1.5, 0.5, 2.5][Math.floor(r() * 3)]}`;
  if (x < 0.08) return `hire ${["hr", "legal", "data", "product", "executive", "ops"][Math.floor(r() * 6)]} ${1 + Math.floor(r() * 3)}`;
  if (x < 0.1) return `pricing ${["consumer", "prosumer", "enterprise"][Math.floor(r() * 3)]}`;
  if (x < 0.13) return `board dinner ${["a", "e", "i", "o"][Math.floor(r() * 4)]}`;
  if (x < 0.15) return `buy ${["office", "lounge", "helicopter"][Math.floor(r() * 3)]}`;
  if (x < 0.19) return `raise ${["friends", "cards", "loan", "preseed", "mortgage"][Math.floor(r() * 5)]}`;
  if (x < 0.21) return "status";
  if (x < 0.23) return `hire eng ${5 + Math.floor(r() * 40)}`;
  if (x < 0.25 && s.stage === "garage" && v >= 5_000_000) return "raise vc 500000";
  if (x < 0.27 && s.stage === "seed") return "raise vc 5000000";
  if (x < 0.29 && s.stage === "series-a") return "raise vc 25000000";
  if (x < 0.3) return "fire";
  if (x < 0.31) return "ship";
  if (x < 0.32) return "help";
  if (runway <= 4) {
    if (s.investors.pipeline.length === 0) return "pitch";
    return `raise vc ${desiredRaiseAmount(s)}`;
  }
  if (s.investors.pipeline.length < 2 && s.week % 3 === 0) return "pitch";
  if (runway >= 8 && s.cash >= 6000) return `hire ${pickHireRole(s).role} 1`;
  return s.week % 2 === 1 ? `ship feature-w${s.week}-a${s.ap}-${i}` : `launch campaign-w${s.week}`;
};

const playWideWeek = (state: GameState, r: () => number): GameState => {
  let s = state;
  for (let i = 0; i < 8 && s.ap > 0 && !s.gameOver; i++) s = safeCmd(s, wideCommand(s, r, i));
  if (s.gameOver) return s;
  if (s.pendingEvent) {
    s = safeCmd(s, wideCommand(s, r, 0));
    if (s.gameOver) return s;
  }
  return safeCmd(s, "end");
};

// ── Runs ──

export interface GoldenRun {
  bot: LegacyBotKind;
  founder: FounderArchetype;
  cofounder: CofounderArchetype;
  seed: number;
  /** hash after the week loop has played N weeks, for every N in CHECKPOINTS that was reached */
  checkpoints: Record<string, string>;
  /** weeks played when the run stopped (game over or the cap) */
  played: number;
  gameOver: boolean;
  end: string;
}

const seededInitial = (seed: number): GameState =>
  refreshDerivedNoLog({ ...createInitialState(), seed, rng: (seed ^ 0x9e3779b9) >>> 0, logSeq: 0 });

export const runLegacyBot = (
  bot: LegacyBotKind,
  founder: FounderArchetype,
  cofounder: CofounderArchetype,
  seed: number,
  maxWeek: number,
): GoldenRun => {
  let s = seededInitial(seed);
  for (const cmd of ["name Sim", "company SimCo", `founder ${founder}`, `cofounder ${cofounder}`]) s = safeCmd(s, cmd);
  const r = mulberry(seed ^ 0x1234567);
  const checkpoints: Record<string, string> = {};
  let played = 0;
  while (played < maxWeek && !s.gameOver) {
    s = bot === "stock" ? playStockWeek(s) : playWideWeek(s, r);
    played += 1;
    if (CHECKPOINTS.includes(played)) checkpoints[String(played)] = hashLegacy(s);
  }
  return { bot, founder, cofounder, seed, checkpoints, played, gameOver: Boolean(s.gameOver), end: hashLegacy(s) };
};

/** Every bot x pair x seed combination, in a fixed order. */
export const goldenPlan = (bots: LegacyBotKind[], seeds: number): Array<{ bot: LegacyBotKind; founder: FounderArchetype; cofounder: CofounderArchetype; seed: number }> => {
  const out: Array<{ bot: LegacyBotKind; founder: FounderArchetype; cofounder: CofounderArchetype; seed: number }> = [];
  for (const bot of bots) {
    for (const founder of FOUNDERS) {
      for (const cofounder of COFOUNDERS) {
        for (let i = 0; i < seeds; i++) out.push({ bot, founder, cofounder, seed: seedFor(i, founder, cofounder) });
      }
    }
  }
  return out;
};

/**
 * Compares a fresh run (possibly shorter than the recorded one) with its recording.
 * Returns null when every hash both runs can share matches, else a description of the first mismatch.
 */
export const compareRun = (recorded: GoldenRun, fresh: GoldenRun, maxWeek: number): string | null => {
  const tag = `${recorded.bot} ${recorded.founder}+${recorded.cofounder} seed=${recorded.seed}`;
  for (const w of CHECKPOINTS) {
    if (w > maxWeek) break;
    const a = recorded.checkpoints[String(w)];
    const b = fresh.checkpoints[String(w)];
    if (a !== b) return `${tag}: week ${w} hash ${a ?? "(none)"} recorded, ${b ?? "(none)"} now`;
  }
  // The recorded run stopped inside this window: the fresh one must stop at the same week, the same way.
  if (recorded.played <= maxWeek) {
    if (fresh.played !== recorded.played || fresh.gameOver !== recorded.gameOver) {
      return `${tag}: ended after ${recorded.played} weeks (gameOver=${recorded.gameOver}) recorded, ${fresh.played} (gameOver=${fresh.gameOver}) now`;
    }
    if (fresh.end !== recorded.end) return `${tag}: end hash ${recorded.end} recorded, ${fresh.end} now`;
  }
  return null;
};

// ── Fixture sessions from makeState() variants ──

const team = (counts: Partial<TeamRoster>): TeamRoster => ({
  engineering: 0, design: 0, marketing: 0, sales: 0, ops: 0, hr: 0, legal: 0, data: 0, product: 0, executive: 0,
  ...counts,
});

export type FixtureName = "plain" | "fractional" | "empty-roster";

export const FIXTURE_WEEKS = 40;

export const fixtureState = (name: FixtureName): GameState => {
  if (name === "plain") return makeState();
  if (name === "fractional") {
    return makeState({
      team: team({ engineering: 6.5, design: 1.5, marketing: 2, sales: 1, ops: 0.5 }),
      pricingModel: "prosumer",
      stress: 50,
      seed: 777,
      rng: 777,
      cash: 250_000,
    });
  }
  return makeState({
    team: team({ engineering: 4, marketing: 2, sales: 1, hr: 1 }),
    pricingModel: "enterprise",
    arpu: 80,
    stress: 70,
    seed: 4242,
    rng: 4242,
    cash: 400_000,
  });
};

export interface FixtureRun {
  name: FixtureName;
  checkpoints: Record<string, string>;
  played: number;
  end: string;
}

/**
 * Replays the stock policy on a makeState() variant (setup already complete there).
 * `prepare` lets the verifier attach empty tycoon slices to the "empty-roster" fixture once they exist;
 * the recording was made without them, so the stripped hashes must not care.
 */
export const runFixture = (name: FixtureName, prepare: (s: GameState) => GameState = (s) => s): FixtureRun => {
  let s = prepare(fixtureState(name));
  const checkpoints: Record<string, string> = {};
  let played = 0;
  while (played < FIXTURE_WEEKS && !s.gameOver) {
    s = playStockWeek(s);
    played += 1;
    if (played % 5 === 0) checkpoints[String(played)] = hashLegacy(s);
  }
  return { name, checkpoints, played, end: hashLegacy(s) };
};

export interface GoldenFile {
  format: 1;
  recordedAt: string;
  seeds: number;
  maxWeek: number;
  checkpoints: number[];
  runs: GoldenRun[];
  fixtures: FixtureRun[];
}
