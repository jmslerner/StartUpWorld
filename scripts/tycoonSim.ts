// Tycoon balance harness (TYCOON-SPEC §10.3). Imports the engine read-only; every bot move is a typed command.
//
//   npm run sim:tycoon -- bots=climber,skilled,... [batches=4] [runs=12] [weeks=200] [out=e4] [from=0]     E4 (+ report)
//   npm run sim:tycoon -- bots=climber,skilled,climber-ent,skilled-ent,climber-con,skilled-con batches=16  pricing/founder balance (B1-B3)
//   npm run sim:tycoon -- report [out=e4[,e4b,...]]                                                      re-print E4 from files (pooled)
//   npx tsx scripts/tycoonSim.ts identity baseline=<dir> [runs=12] [weeks=200] variant=stock|wide           E2
//   npx tsx scripts/tycoonSim.ts fuzz [seeds=24] [commands=400]                                            E3
//   npx tsx scripts/tycoonSim.ts migrate baseline=<dir> [saves=240] [corrupt=2000]                         save migration
//   npx tsx scripts/tycoonSim.ts fixture [seed=86] [founder=hacker] [cofounder=builder] [weeks=28] [bot=no-retain]
//                                                     records src/engine/__fixtures__/seed<seed>-week<weeks+1>.commands.json
//
// Acceptance (ERRATA 75): run E4 with batches=16 (four seed sets, 3,072 runs per bot, still one 192-run batch at a time).
// One 768-run set sits at the noise floor of the T4-T6 bands: re-drawing only the tycoon streams moves engaged bots by up to
// ±2.5 IPO points on the same seeds, so a single set can FAIL by noise alone. The pooled report is the gate.
//
// One batch = 16 founder x cofounder pairs x `runs` seeds (192 at the default): the shared machine's limit. Batches run one
// after another and are written to node_modules/.cache/tycoon-sim/<out>/<bot>-<batch>.jsonl (git-ignored). E4 exits
// non-zero when a threshold of T4-T11 fails, E2/E3/migrate when anything mismatches.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mulberry } from "../src/engine/__golden__/legacyBots";
import type { CofounderArchetype, FounderArchetype } from "../src/types/game";
import { ALL_BOTS, keptCommands, newTally, playWeek, seededInitial, setJournal } from "./tycoon/bots";
import type { BotKind, Typed } from "./tycoon/bots";
import { runBatch } from "./tycoon/runs";
import type { Row } from "./tycoon/runs";
import { balanceChecks, byFounder, checkLines, summarize, table, thresholds } from "./tycoon/report";
import { runIdentity } from "./tycoon/identity";
import { runFuzz } from "./tycoon/fuzz";
import { runMigcheck } from "./tycoon/migcheck";
import { executeCommand } from "../src/engine/commands";

const argv = process.argv.slice(2);
const mode = argv[0] && !argv[0].includes("=") ? argv[0] : "bots";
const args = new Map<string, string>();
for (const a of argv) {
  const at = a.indexOf("=");
  if (at > 0) args.set(a.slice(0, at), a.slice(at + 1));
}
const num = (k: string, d: number): number => (args.has(k) ? Number(args.get(k)) : d);
const CACHE = "node_modules/.cache/tycoon-sim";

/** Aggregates every batch file under one or more result folders (`out=a,b` pools independent seed sets). */
const report = (out: string): boolean => {
  const dirs = out.split(",").map((o) => join(CACHE, o));
  const missing = dirs.filter((d) => !existsSync(d));
  if (missing.length > 0) {
    console.error(`no results in ${missing.join(", ")}`);
    return false;
  }
  const byKind = new Map<string, Row[]>();
  for (const dir of dirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
      for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
        if (!line.trim()) continue;
        const row = JSON.parse(line) as Row;
        byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
      }
    }
  }
  const order = [...ALL_BOTS, "stock"].filter((k) => byKind.has(k));
  const sums = order.map((k) => summarize(k, byKind.get(k) ?? []));
  const checks = [...thresholds(sums), ...balanceChecks(byKind)];
  const founders = byFounder(byKind, ["skilled", "naive", "rush", "naive-ship60", "climber-ent", "climber-con"]);
  const text = `${table(sums)}\n\n${checkLines(checks)}\n\n${founders}\n`;
  console.log(text);
  writeFileSync(join(dirs[0], dirs.length > 1 ? `report-${out.replace(/,/g, "+")}.txt` : "report.txt"), text);
  return checks.every((c) => c.pass);
};

const main = async (): Promise<number> => {
  if (mode === "bots") {
    const bots = (args.get("bots") ?? "climber,skilled").split(",") as BotKind[];
    const unknown = bots.filter((b) => !ALL_BOTS.includes(b) && b !== "stock");
    if (unknown.length > 0) {
      console.error(`unknown bots: ${unknown.join(", ")}`);
      return 2;
    }
    const batches = num("batches", 4);
    const from = num("from", 0);
    const runs = num("runs", 12);
    const weeks = num("weeks", 200);
    const out = args.get("out") ?? "e4";
    const dir = join(CACHE, out);
    mkdirSync(dir, { recursive: true });
    for (let batch = from; batch < from + batches; batch++) {
      for (const kind of bots) {
        const t = Date.now();
        const rows = runBatch(kind, batch, runs, weeks);
        writeFileSync(join(dir, `${kind}-${batch}.jsonl`), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
        console.log(`batch ${batch} ${kind}: ${rows.length} runs in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      }
    }
    return report(out) ? 0 : 1;
  }
  if (mode === "report") return report(args.get("out") ?? "e4") ? 0 : 1;
  if (mode === "identity") {
    const baseline = args.get("baseline");
    if (!baseline) {
      console.error("identity needs baseline=<dir of a pristine pre-tycoon checkout>");
      return 2;
    }
    const variant = args.get("variant") ?? "stock";
    const t = Date.now();
    const r = await runIdentity(baseline, num("runs", 12), num("weeks", 200), variant);
    console.log(
      `identity ${r.variant}: runs=${r.runs} weeks=${r.weeks} commands=${r.commands} mismatches=${r.mismatches} invariantBreaks=${r.invariantBreaks} ` +
        `maxHeads=${r.maxHeads} maxRoster=${r.maxRoster} (${((Date.now() - t) / 1000).toFixed(1)}s)`,
    );
    return r.mismatches === 0 && r.invariantBreaks === 0 ? 0 : 1;
  }
  if (mode === "fuzz") {
    const r = runFuzz(num("seeds", 24), num("commands", 400));
    for (const m of r.messages) console.log(`FAIL ${m}`);
    console.log(`fuzz: seeds=${r.seeds} commands=${r.commands} failures=${r.failures}`);
    return r.failures === 0 ? 0 : 1;
  }
  if (mode === "migrate") {
    const baseline = args.get("baseline");
    if (!baseline) {
      console.error("migrate needs baseline=<dir of a pristine pre-tycoon checkout>");
      return 2;
    }
    const r = await runMigcheck(baseline, num("saves", 240), num("corrupt", 2000));
    for (const m of r.messages) console.log(`FAIL ${m}`);
    console.log(`migration: ${r.saves} v2 saves checked, normalizer fuzz ${r.normalized}, failures ${r.failures}`);
    return r.failures === 0 ? 0 : 1;
  }
  if (mode === "fixture") {
    const seed = num("seed", 86); // the first seed in 1..200 with a lead on notice at week 29 (ERRATA 64)
    const founder = (args.get("founder") ?? "hacker") as FounderArchetype;
    const cofounder = (args.get("cofounder") ?? "builder") as CofounderArchetype;
    const weeks = num("weeks", 28);
    const bot = (args.get("bot") ?? "no-retain") as BotKind;
    const start = seededInitial(seed);
    const journal: Typed[] = [];
    setJournal(journal);
    let s = start;
    for (const setup of ["name Ada", "company Loopwell", `founder ${founder}`, `cofounder ${cofounder}`]) {
      const after = executeCommand(s, setup).state;
      journal.push({ input: setup, before: s, after });
      s = after;
    }
    // The same script-side PRNG the play script uses (only the naive bot reads it).
    const r = mulberry(seed);
    const tally = newTally();
    for (let i = 0; i < weeks && !s.gameOver; i++) s = playWeek(s, bot, tally, r);
    setJournal(null);
    const commands = keptCommands(journal, start, s);
    const file = `src/engine/__fixtures__/seed${seed}-week${s.week}.commands.json`;
    mkdirSync("src/engine/__fixtures__", { recursive: true });
    const body = { seed, founder, cofounder, bot, weeks, reachedWeek: s.week, note: "Recorded by `npx tsx scripts/tycoonSim.ts fixture`. Replay from the harness start state; do not edit by hand.", commands };
    writeFileSync(file, `${JSON.stringify(body, null, 1)}\n`);
    console.log(`recorded ${commands.length} commands (week ${s.week}) into ${file}`);
    return 0;
  }
  console.error(`unknown mode ${mode}`);
  return 2;
};

process.exit(await main());
