// Headless balance simulator.
//
//   npm run sim                              1,000 seeded games, printed report
//   npm run sim -- games=200 seed=5001       a different batch
//   npm run sim -- set=ipo.users=300000      one number changed for this run (repeatable)
//   npm run sim -- strict=1                  exit with code 1 if any target fails
//
// An argument it does not know, or a config path that does not exist, stops the run with a message.
//
// The baseline bot sits in the player's seat against the three CPUs. The report ends with every
// number src/config.ts changed from the design's starting values (src/config.design.ts).
// All logic lives in src/sim; this file only reads the arguments and prints.

import { CONFIG, type GameConfig } from "../src/config";
import { DESIGN } from "../src/config.design";
import { USAGE, parseSimArgs, type SimArgs } from "../src/sim/args";
import { changedNumbers, formatChanges } from "../src/sim/changes";
import { applyOverrides } from "../src/sim/overrides";
import { checkTargets, formatReport, summarize } from "../src/sim/report";
import { runBatch } from "../src/sim/runGame";

let args: SimArgs;
let config: GameConfig;
try {
  args = parseSimArgs(process.argv.slice(2));
  config = applyOverrides(CONFIG, args.overrides);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(USAGE);
  process.exit(2);
}
const games = args.games ?? config.sim.games;
const firstSeed = args.seed ?? config.sim.firstSeed;

const started = Date.now();
const summary = summarize(runBatch(games, firstSeed, config));
const checks = checkTargets(summary, config.sim.targets);

console.log(formatReport(summary, checks, config.game.maxTurns));
console.log("");
console.log(`Seeds ${firstSeed} to ${firstSeed + games - 1}, ${((Date.now() - started) / 1000).toFixed(1)}s.`);
for (const [path, value] of Object.entries(args.overrides)) console.log(`Changed for this run only: ${path} = ${value}`);
console.log("");
// What src/config.ts changed from the design, whatever this run overrode.
console.log(formatChanges(changedNumbers(DESIGN, CONFIG)));

if (args.strict && checks.some((check) => !check.pass)) process.exit(1);
