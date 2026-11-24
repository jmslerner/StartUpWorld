// Headless balance simulator.
//
//   npm run sim                              1,000 seeded games, printed report
//   npm run sim -- games=200 seed=5001       a different batch
//   npm run sim -- set=ipo.users=300000      one number changed for this run (repeatable)
//   npm run sim -- strict=1                  exit with code 1 if any target fails
//
// The baseline bot sits in the player's seat against the three CPUs. All logic lives in src/sim;
// this file only reads the arguments and prints.

import { CONFIG } from "../src/config";
import { applyOverrides } from "../src/sim/overrides";
import { checkTargets, formatReport, summarize } from "../src/sim/report";
import { runBatch } from "../src/sim/runGame";

const overrides: Record<string, number | string> = {};
const options: Record<string, string> = {};
for (const arg of process.argv.slice(2)) {
  const [key, ...rest] = arg.split("=");
  const value = rest.join("=");
  if (key === "set") {
    const [path, ...raw] = value.split("=");
    const text = raw.join("=");
    overrides[path] = text !== "" && Number.isFinite(Number(text)) ? Number(text) : text;
  } else {
    options[key] = value;
  }
}

const config = applyOverrides(CONFIG, overrides);
const games = Number(options.games ?? config.sim.games);
const firstSeed = Number(options.seed ?? config.sim.firstSeed);
if (!Number.isInteger(games) || games < 1 || !Number.isInteger(firstSeed)) {
  console.error("Usage: npm run sim -- [games=1000] [seed=1] [set=path=value ...] [strict=1]");
  process.exit(2);
}

const started = Date.now();
const summary = summarize(runBatch(games, firstSeed, config));
const checks = checkTargets(summary, config.sim.targets);

console.log(formatReport(summary, checks));
console.log("");
console.log(`Seeds ${firstSeed} to ${firstSeed + games - 1}, ${((Date.now() - started) / 1000).toFixed(1)}s.`);
for (const [path, value] of Object.entries(overrides)) console.log(`Changed for this run: ${path} = ${value}`);

if (options.strict === "1" && checks.some((check) => !check.pass)) process.exit(1);
