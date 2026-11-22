// Legacy golden master (spec §12.2).
//   npx tsx scripts/legacyGolden.ts record <file> [bots=stock,wide] [seeds=12] [weeks=200]
//   npx tsx scripts/legacyGolden.ts verify <file> [bots=stock,wide] [seeds=12] [weeks=200]
// First recorded on the untouched pre-tycoon engine (d641713), so the tycoon layer could prove legacy play unchanged. Re-record
// only for an intended change to legacy play, after checking that the old values replay the old file with 0 mismatches
// (last: the pricing/founder balance pass). Recording a subset of bots merges into an existing file, so the two bots can be
// recorded as separate batches (<= 192 runs each).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  CHECKPOINTS,
  FULL_SEEDS,
  FULL_WEEKS,
  compareRun,
  goldenPlan,
  runFixture,
  runLegacyBot,
} from "../src/engine/__golden__/legacyBots";
import type { FixtureName, FixtureRun, GoldenFile, GoldenRun, LegacyBotKind } from "../src/engine/__golden__/legacyBots";
import { withSlices } from "../src/engine/tycoon/roster";

const FIXTURES: FixtureName[] = ["plain", "fractional", "empty-roster"];
/** What the recording pins; update it with every re-record. */
const RECORDED_AT = "pricing/founder balance pass (enterprise, consumer, philosopher and visionary retuned) on 47c5c20";

const [mode, file, ...rest] = process.argv.slice(2);
const args = new Map<string, string>();
for (const a of rest) {
  const [k, v] = a.split("=");
  if (k && v) args.set(k, v);
}
const bots = (args.get("bots") ?? "stock,wide").split(",").filter((b): b is LegacyBotKind => b === "stock" || b === "wide");
const seeds = Number(args.get("seeds") ?? String(FULL_SEEDS));
const weeks = Number(args.get("weeks") ?? String(FULL_WEEKS));

if ((mode !== "record" && mode !== "verify") || !file || bots.length === 0) {
  console.error("Usage: tsx scripts/legacyGolden.ts record|verify <file> [bots=stock,wide] [seeds=12] [weeks=200]");
  process.exit(2);
}

const started = Date.now();
const plan = goldenPlan(bots, seeds);

if (mode === "record") {
  const previous: GoldenFile | null = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as GoldenFile) : null;
  const runs: GoldenRun[] = (previous?.runs ?? []).filter((r) => !bots.includes(r.bot));
  for (const p of plan) runs.push(runLegacyBot(p.bot, p.founder, p.cofounder, p.seed, weeks));
  const order: LegacyBotKind[] = ["stock", "wide"];
  runs.sort((a, b) => order.indexOf(a.bot) - order.indexOf(b.bot));
  const fixtures: FixtureRun[] = FIXTURES.map((name) => runFixture(name));
  const out: GoldenFile = { format: 1, recordedAt: RECORDED_AT, seeds, maxWeek: weeks, checkpoints: CHECKPOINTS, runs, fixtures };
  writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`recorded ${plan.length} runs (${bots.join(",")}) + ${fixtures.length} fixtures into ${file} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} else {
  const golden = JSON.parse(readFileSync(file, "utf8")) as GoldenFile;
  let mismatches = 0;
  let compared = 0;
  for (const p of plan) {
    const recorded = golden.runs.find((r) => r.bot === p.bot && r.founder === p.founder && r.cofounder === p.cofounder && r.seed === p.seed);
    if (!recorded) {
      console.log(`MISSING ${p.bot} ${p.founder}+${p.cofounder} seed=${p.seed}`);
      mismatches += 1;
      continue;
    }
    const diff = compareRun(recorded, runLegacyBot(p.bot, p.founder, p.cofounder, p.seed, Math.min(weeks, golden.maxWeek)), Math.min(weeks, golden.maxWeek));
    compared += 1;
    if (diff) {
      mismatches += 1;
      if (mismatches <= 10) console.log(`MISMATCH ${diff}`);
    }
  }
  for (const rec of golden.fixtures) {
    const fresh = runFixture(rec.name, rec.name === "empty-roster" ? withSlices : undefined);
    compared += 1;
    if (JSON.stringify(fresh) !== JSON.stringify(rec)) {
      mismatches += 1;
      console.log(`MISMATCH fixture ${rec.name}`);
    }
  }
  console.log(`verified ${compared} runs: ${mismatches} mismatches (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  process.exit(mismatches === 0 ? 0 : 1);
}
