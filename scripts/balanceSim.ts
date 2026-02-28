import { executeCommand } from "../src/engine/commands";
import { createInitialState } from "../src/engine/actions";
import { refreshDerivedNoLog } from "../src/engine/derived";
import { STAGE_VALUATION_FLOOR } from "../src/engine/valuation";
import type { CofounderArchetype, FounderArchetype, GameState, Stage } from "../src/types/game";

type RunResult = {
  founder: FounderArchetype;
  cofounder: CofounderArchetype;
  seed: number;
  endWeek: number;
  gameOver: GameState["gameOver"];
  mrr: number;
  cash: number;
  valuation: number;
  founderPct: number;
  rounds: number;
};

const founderOptions: FounderArchetype[] = ["visionary", "hacker", "sales-animal", "philosopher"];
const cofounderOptions: CofounderArchetype[] = ["operator", "builder", "rainmaker", "powderkeg"];

const stageSoftCap: Record<Stage, number> = {
  garage: 250_000,
  seed: 2_500_000,
  "series-a": 12_000_000,
  growth: 60_000_000,
};

const formatPct = (v01: number) => `${Math.round(v01 * 100)}%`;

const q = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx] ?? 0;
};

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

const mkSeededInitial = (seed: number): GameState => {
  const base = createInitialState();
  const seeded: GameState = {
    ...base,
    seed,
    rng: (seed ^ 0x9e3779b9) >>> 0,
    logSeq: 0,
  };
  return refreshDerivedNoLog(seeded);
};

const impliedValuation = (s: GameState) => Math.max(s.valuation, STAGE_VALUATION_FLOOR[s.stage]);

const desiredRaiseAmount = (s: GameState) => {
  const v = impliedValuation(s);
  // Keep asks sane: target ~15% of implied value, but not above stage soft cap.
  const target = Math.min(stageSoftCap[s.stage], Math.max(50_000, Math.round((v * 0.15) / 1000) * 1000));
  return target;
};

const safeCmd = (s: GameState, input: string): GameState => executeCommand(s, input).state;

const pickHireRole = (s: GameState): { role: string; count: number } | null => {
  const { engineering: eng, design, ops, marketing: mkt, sales } = s.team;
  const exec = eng + design + ops;
  const gtm = mkt + sales;

  // Keep the org roughly balanced while still pushing growth.
  if (gtm > exec) {
    if (ops < Math.ceil(gtm / 2)) return { role: "ops", count: 1 };
    return { role: "engineering", count: 1 };
  }

  // Early: build enough execution, then add GTM.
  if (eng < 3) return { role: "engineering", count: 1 };
  if (mkt < 2) return { role: "marketing", count: 1 };
  if (sales < 2) return { role: "sales", count: 1 };
  if (ops < 2) return { role: "ops", count: 1 };

  // Late: alternate between eng and GTM.
  return (s.week % 2 === 0) ? { role: "engineering", count: 1 } : { role: "marketing", count: 1 };
};

const playWeek = (state: GameState): GameState => {
  let s = state;

  // Resolve event immediately (no AP cost).
  if (s.pendingEvent) {
    s = safeCmd(s, "choose 1");
    if (s.gameOver) return s;
  }

  // Spend AP.
  for (let i = 0; i < 3; i++) {
    if (s.gameOver) break;
    if (s.pendingEvent) {
      s = safeCmd(s, "choose 1");
      continue;
    }

    const runway = s.burn > 0 ? Math.floor(s.cash / Math.max(1, s.burn)) : 999;

    // Fundraising if runway is tight.
    if (runway <= 4) {
      if (s.investors.pipeline.length === 0) {
        s = safeCmd(s, "pitch");
        continue;
      }
      const amt = desiredRaiseAmount(s);
      s = safeCmd(s, `raise vs ${amt}`);
      continue;
    }

    // Build pipeline opportunistically.
    if (s.investors.pipeline.length < 2 && s.week % 3 === 0) {
      s = safeCmd(s, "pitch");
      continue;
    }

    // Hire if we can afford it and runway is healthy.
    if (runway >= 8) {
      const hire = pickHireRole(s);
      if (hire) {
        const beforeCash = s.cash;
        s = safeCmd(s, `hire ${hire.role} ${hire.count}`);
        if (s.cash !== beforeCash) continue; // hired successfully
      }
    }

    // Product vs growth alternation.
    if (s.week % 2 === 1) {
      s = safeCmd(s, `ship feature-w${s.week}-a${s.ap}`);
    } else {
      s = safeCmd(s, `launch campaign-w${s.week}`);
    }
  }

  // End the week.
  s = safeCmd(s, "end");
  return s;
};

const runOne = (seed: number, founder: FounderArchetype, cofounder: CofounderArchetype, maxWeek: number): RunResult => {
  let s = mkSeededInitial(seed);

  // Setup.
  s = safeCmd(s, "name Sim");
  s = safeCmd(s, "company SimCo");
  s = safeCmd(s, `founder ${founder}`);
  s = safeCmd(s, `cofounder ${cofounder}`);

  let rounds = 0;

  for (let w = 0; w < maxWeek; w++) {
    if (s.gameOver) break;
    const hadRound = Boolean(s.lastRound);
    s = playWeek(s);
    if (!hadRound && s.lastRound) rounds += 1;
    // also count additional rounds
    if (hadRound && s.lastRound && s.lastRound.week === s.week - 1) rounds += 1;

    // Sanity invariants (throw = fail fast).
    const sum = s.capTable.founderPct + s.capTable.investorPct;
    if (Math.abs(sum - 1) > 0.02) {
      throw new Error(`Cap table drift too large: founder=${s.capTable.founderPct} investor=${s.capTable.investorPct}`);
    }
    if (s.capTable.founderPct < -0.001 || s.capTable.founderPct > 1.001) {
      throw new Error(`Founder pct out of bounds: ${s.capTable.founderPct}`);
    }
  }

  return {
    founder,
    cofounder,
    seed,
    endWeek: s.week,
    gameOver: s.gameOver,
    mrr: s.mrr,
    cash: s.cash,
    valuation: s.valuation,
    founderPct: s.capTable.founderPct,
    rounds,
  };
};

const summarize = (label: string, results: RunResult[], maxWeek: number) => {
  const ended = results.filter((r) => Boolean(r.gameOver));
  const survived = results.filter((r) => !r.gameOver && r.endWeek >= maxWeek);

  const endWeeks = results.map((r) => r.gameOver?.week ?? maxWeek);
  const mrr = results.map((r) => r.mrr);
  const ownership = results.map((r) => r.founderPct);
  const rounds = results.map((r) => r.rounds);

  const bank = ended.filter((r) => r.gameOver?.ending === "bankruptcy").length;

  console.log(`\n=== ${label} ===`);
  console.log(`runs: ${results.length} | survived to week ${maxWeek}: ${Math.round((survived.length / results.length) * 100)}%`);
  console.log(`bankruptcy: ${Math.round((bank / results.length) * 100)}%`);
  console.log(
    `end week p50=${q(endWeeks, 0.5).toFixed(0)} p10=${q(endWeeks, 0.1).toFixed(0)} p90=${q(endWeeks, 0.9).toFixed(0)}`
  );
  console.log(
    `MRR p50=$${q(mrr, 0.5).toLocaleString()} p10=$${q(mrr, 0.1).toLocaleString()} p90=$${q(mrr, 0.9).toLocaleString()}`
  );
  console.log(
    `ownership p50=${formatPct(q(ownership, 0.5))} p10=${formatPct(q(ownership, 0.1))} p90=${formatPct(q(ownership, 0.9))}`
  );
  console.log(`rounds avg=${mean(rounds).toFixed(2)} p90=${q(rounds, 0.9).toFixed(0)}`);
};

const main = () => {
  const args = new Map<string, string>();
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.split("=");
    if (k && v) args.set(k, v);
  }

  const runsPerCombo = Number(args.get("runs") ?? "80");
  const maxWeek = Number(args.get("weeks") ?? "24");
  const mode = (args.get("mode") ?? "sweep").toLowerCase(); // sweep | single

  if (!Number.isFinite(runsPerCombo) || runsPerCombo <= 0) {
    throw new Error("runs must be a positive number");
  }

  if (mode === "single") {
    const founder = (args.get("founder") as FounderArchetype | undefined) ?? "hacker";
    const cofounder = (args.get("cofounder") as CofounderArchetype | undefined) ?? "operator";

    const results: RunResult[] = [];
    for (let i = 0; i < runsPerCombo; i++) {
      results.push(runOne((i + 1) >>> 0, founder, cofounder, maxWeek));
    }
    summarize(`${founder} + ${cofounder}`, results, maxWeek);
    return;
  }

  const all: RunResult[] = [];
  for (const f of founderOptions) {
    for (const c of cofounderOptions) {
      const results: RunResult[] = [];
      for (let i = 0; i < runsPerCombo; i++) {
        // Mix in archetype identity so each combo gets a different seed stream.
        const seed = (((i + 1) * 2654435761) ^ (f.length * 97) ^ (c.length * 193)) >>> 0;
        results.push(runOne(seed, f, c, maxWeek));
      }
      summarize(`${f} + ${c}`, results, maxWeek);
      all.push(...results);
    }
  }

  summarize("ALL", all, maxWeek);
};

main();
