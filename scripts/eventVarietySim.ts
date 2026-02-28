import { createInitialState } from "../src/engine/actions";
import { executeCommand } from "../src/engine/commands";
import { refreshDerivedNoLog } from "../src/engine/derived";
import { STAGE_VALUATION_FLOOR } from "../src/engine/valuation";
import type { CofounderArchetype, EventHistoryEntry, FounderArchetype, GameState } from "../src/types/game";

const EVENT_COOLDOWN_WEEKS = 7;

const safeCmd = (s: GameState, input: string): GameState => executeCommand(s, input).state;

const stageSoftCap: Record<GameState["stage"], number> = {
  garage: 250_000,
  seed: 2_500_000,
  "series-a": 12_000_000,
  growth: 60_000_000,
};

const impliedValuation = (s: GameState) => Math.max(s.valuation, STAGE_VALUATION_FLOOR[s.stage]);

const desiredRaiseAmount = (s: GameState) => {
  const v = impliedValuation(s);
  // target ~15% of implied value, but not above stage soft cap.
  return Math.min(stageSoftCap[s.stage], Math.max(50_000, Math.round((v * 0.15) / 1000) * 1000));
};

const pickHireRole = (s: GameState): { role: string; count: number } | null => {
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

    if (runway <= 4) {
      if (s.investors.pipeline.length === 0) {
        s = safeCmd(s, "pitch");
        continue;
      }
      const amt = desiredRaiseAmount(s);
      s = safeCmd(s, `raise vs ${amt}`);
      continue;
    }

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
        if (s.cash !== beforeCash) continue;
      }
    }

    // Product vs growth alternation.
    if (s.week % 2 === 1) s = safeCmd(s, `ship feature-w${s.week}-a${s.ap}`);
    else s = safeCmd(s, `launch campaign-w${s.week}`);
  }

  s = safeCmd(s, "end");
  return s;
};

const runOne = (seed: number, founder: FounderArchetype, cofounder: CofounderArchetype, maxWeeks: number): GameState => {
  let s = mkSeededInitial(seed);

  // Setup.
  s = safeCmd(s, "name Sim");
  s = safeCmd(s, "company SimCo");
  s = safeCmd(s, `founder ${founder}`);
  s = safeCmd(s, `cofounder ${cofounder}`);

  for (let w = 0; w < maxWeeks; w++) {
    if (s.gameOver) break;
    s = playWeek(s);
  }

  return s;
};

const countBy = (items: string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const id of items) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
};

const topN = (m: Map<string, number>, n: number): Array<{ id: string; count: number }> =>
  [...m.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);

const analyzeOne = (history: EventHistoryEntry[]) => {
  const byIdWeeks = new Map<string, number[]>();
  for (const h of history) {
    const arr = byIdWeeks.get(h.id) ?? [];
    arr.push(h.week);
    byIdWeeks.set(h.id, arr);
  }

  let repeatWithinCooldown = 0;
  let minGap = Number.POSITIVE_INFINITY;

  for (const weeks of byIdWeeks.values()) {
    weeks.sort((a, b) => a - b);
    for (let i = 1; i < weeks.length; i++) {
      const gap = weeks[i] - weeks[i - 1];
      minGap = Math.min(minGap, gap);
      if (gap <= EVENT_COOLDOWN_WEEKS) repeatWithinCooldown += 1;
    }
  }

  return {
    repeatWithinCooldown,
    minGap: Number.isFinite(minGap) ? minGap : null,
  };
};

const main = () => {
  const args = new Map<string, string>();
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.split("=");
    if (k && v) args.set(k, v);
  }

  const runs = Number(args.get("runs") ?? "40");
  const weeks = Number(args.get("weeks") ?? "80");
  const seed0 = Number(args.get("seed") ?? "1337");

  const founder = (args.get("founder") as FounderArchetype | undefined) ?? "hacker";
  const cofounder = (args.get("cofounder") as CofounderArchetype | undefined) ?? "operator";

  if (!Number.isFinite(runs) || runs <= 0) throw new Error("runs must be a positive number");
  if (!Number.isFinite(weeks) || weeks <= 0) throw new Error("weeks must be a positive number");

  const allIds: string[] = [];
  let totalEvents = 0;
  let repeatWithinCooldown = 0;
  let minGap: number | null = null;

  for (let i = 0; i < runs; i++) {
    const seed = (seed0 + i) >>> 0;
    const s = runOne(seed, founder, cofounder, weeks);
    totalEvents += s.eventHistory.length;
    allIds.push(...s.eventHistory.map((h) => h.id));

    const one = analyzeOne(s.eventHistory);
    repeatWithinCooldown += one.repeatWithinCooldown;
    if (one.minGap !== null) minGap = minGap === null ? one.minGap : Math.min(minGap, one.minGap);
  }

  const counts = countBy(allIds);
  const top = topN(counts, 12);

  console.log(`\n=== Event Variety Sim (${founder} + ${cofounder}) ===`);
  console.log(`runs=${runs} weeks=${weeks} (seed start=${seed0})`);
  console.log(`events fired: ${totalEvents} | unique events: ${counts.size}`);
  console.log(
    `repeat within cooldown (<=${EVENT_COOLDOWN_WEEKS}w gap): ${repeatWithinCooldown} | min repeat gap: ${minGap ?? "n/a"}`
  );

  console.log("\nTop events:");
  for (const t of top) console.log(`- ${t.id}: ${t.count}`);

  // Quick confirmation that the new batch shows up.
  const newIds = [
    "wellness-stipend-arms-race",
    "swag-palooza",
    "offsite-vineyard",
    "reorg-without-headcount",
    "founder-podcast-canceled",
    "growth-hack-backfires",
    "dark-pattern-debate",
    "data-leak-screenshot",
    "cloud-bill-surprise",
    "payments-freeze",
    "ai-pivot-week",
    "press-hit-piece",
    "talent-poach",
    "union-whisper",
    "pricing-backlash",
    "competitor-mega-round",
    "regulator-side-quest",
    "macro-rate-shock",
  ] as const;

  console.log("\nNew-event sightings:");
  for (const id of newIds) console.log(`- ${id}: ${counts.get(id) ?? 0}`);
};

main();
