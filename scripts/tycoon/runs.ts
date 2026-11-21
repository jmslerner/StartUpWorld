// One bot run and its summary row (E4). Rows are written as JSONL, one file per bot and batch.
import { computeScore } from "../../src/engine/endingSummary";
import { executeCommand } from "../../src/engine/commands";
import { rosterOf } from "../../src/engine/tycoon/roster";
import { mulberry } from "../../src/engine/__golden__/legacyBots";
import type { CofounderArchetype, FounderArchetype, GameState } from "../../src/types/game";
import { newTally, playWeek, seededInitial } from "./bots";
import type { BotKind } from "./bots";

export const FOUNDERS: FounderArchetype[] = ["visionary", "hacker", "sales-animal", "philosopher"];
export const COFOUNDERS: CofounderArchetype[] = ["operator", "builder", "rainmaker", "powderkeg"];

/** The prototype's seed schedule: batch b, run i of a founder x cofounder pair (the same seeds for every bot). */
export const botSeed = (i: number, batch: number, f: string, c: string): number =>
  (((i + 1 + batch * 1000) * 2654435761) ^ (f.length * 97) ^ (c.length * 193)) >>> 0;

export interface Row {
  kind: BotKind; seed: number; founder: string; cofounder: string;
  end: string; endWeek: number; score: number; val: number; founderPct: number; ipo: number | null;
  tiers: Record<string, number>; releases: number; reception: number; offers: number; retains: number; departures: number;
  recruits: number; builds: number; crunchWeeks: number; lateShips: number; surprises: number; dodges: number;
  bySize: Record<string, number>; byType: Record<string, number>;
  heads: number; mrr20: number | null; mrr40: number | null; arpu40: number | null; cruft40: number | null; moat40: number | null;
  engaged40: number | null; bytes: number; inv: number;
}

const teamSize = (s: GameState): number => Object.values(s.team).reduce((a, n) => a + n, 0);
const sliceBytes = (s: GameState): number => JSON.stringify({ people: s.people, product: s.product }).length;

export const runOne = (seed: number, founder: FounderArchetype, cofounder: CofounderArchetype, maxWeek: number, kind: BotKind): Row => {
  let s = seededInitial(seed);
  for (const setup of ["name Sim", "company SimCo", `founder ${founder}`, `cofounder ${cofounder}`]) s = executeCommand(s, setup).state;
  const tally = newTally();
  const r = mulberry(seed ^ 0x51ed270b);
  const marks: Record<number, GameState> = {};
  let bytes = sliceBytes(s);
  for (let w = 0; w < maxWeek && !s.gameOver; w++) {
    s = playWeek(s, kind, tally, r);
    if (s.week === 20 || s.week === 40) marks[s.week] = s;
    // T11: both slices at every checkpoint (every 10 weeks and at the end).
    if (w % 10 === 9) bytes = Math.max(bytes, sliceBytes(s));
  }
  bytes = Math.max(bytes, sliceBytes(s));
  const score = s.gameOver ? computeScore(s) : computeScore({ ...s, gameOver: { ending: "zombie-saas", week: s.week, headline: "" } }) - 4;
  const m40 = marks[40];
  return {
    kind, seed, founder, cofounder,
    end: s.gameOver?.ending ?? "alive", endWeek: s.gameOver?.week ?? s.week, score, val: s.valuation, founderPct: s.capTable.founderPct,
    ipo: s.gameOver?.ending === "ipo" ? s.gameOver.week : null,
    tiers: tally.tiers, releases: tally.releases, reception: tally.receptionSum, offers: tally.offers, retains: tally.retains,
    departures: tally.departures, recruits: tally.recruits, builds: tally.builds, crunchWeeks: tally.crunchWeeks, lateShips: tally.lateShips,
    surprises: tally.surprises, dodges: tally.dodges, bySize: tally.bySize, byType: tally.byType,
    heads: teamSize(s), mrr20: marks[20]?.mrr ?? null, mrr40: m40?.mrr ?? null, arpu40: m40?.arpu ?? null,
    cruft40: m40 ? (m40.product?.cruft ?? 0) : null, moat40: m40 ? (m40.product?.moat ?? 0) : null,
    engaged40: m40 ? rosterOf(m40).filter((e) => e.engaged).length : null, bytes, inv: tally.invariantBreaks,
  };
};

/** One batch: 16 archetype pairs x runsPerPair seeds (192 runs at the default 12). */
export const runBatch = (kind: BotKind, batch: number, runsPerPair: number, maxWeek: number): Row[] => {
  const rows: Row[] = [];
  for (const f of FOUNDERS) for (const c of COFOUNDERS) for (let i = 0; i < runsPerPair; i++) rows.push(runOne(botSeed(i, batch, f, c), f, c, maxWeek, kind));
  return rows;
};
