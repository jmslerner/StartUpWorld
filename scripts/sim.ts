// Headless balance simulator.
//
//   npm run sim                              1,000 seeded games, printed report
//   npm run sim -- games=200 seed=5001       a different batch
//   npm run sim -- set=ipo.users=300000      one number changed for this run (repeatable)
//   npm run sim -- strict=1                  exit with code 1 if any target fails
//   npm run sim:career                       the career instead: 1,000 careers from 1990 to 2038 (mode=career)
//   npm run sim:career -- games=100 set=career.eras.2.values.quality.decay=7
//
// An argument it does not know, or a config path that does not exist, stops the run with a message.
//
// The baseline bot sits in the player's seat against the three CPUs. The report ends with every
// number src/config.ts changed from the design's starting values (src/config.design.ts).
// In a career run the same seeds are played seven times: by the baseline bot, by the three loophole pilots, and for
// the three measures (the baseline bot with the platform shifts switched off, the end-game pilot and the pilot that
// reads the timeline). Each batch's time is printed.
// All logic lives in src/sim; this file only reads the arguments and prints.

import { CAREER, CONFIG, type CareerGameConfig, type GameConfig } from "../src/config";
import { CAREER_DESIGN, DESIGN } from "../src/config.design";
import { USAGE, parseSimArgs, type SimArgs } from "../src/sim/args";
import { checkCareerTargets, checkLoophole, formatCareerReport, summarizeCareers, type CareerSummary } from "../src/sim/careerReport";
import { changedNumbers, formatChanges } from "../src/sim/changes";
import { applyOverrides } from "../src/sim/overrides";
import { PILOT_NAMES, endgamePilot, listLastPilot, neverListPilot, overspendPilot, shiftAwarePilot, withoutShifts } from "../src/sim/pilots";
import { checkTargets, formatReport, summarize } from "../src/sim/report";
import { runCareerBatch, type Pilot } from "../src/sim/runCareer";
import { runBatch } from "../src/sim/runGame";

let args: SimArgs;
try {
  args = parseSimArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(USAGE);
  process.exit(2);
}

/** The config with this run's overrides, or the usage and exit code 2 when one of them is wrong. */
const overridden = <T>(base: T): T => {
  try {
    return applyOverrides(base, args.overrides);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exit(2);
  }
};

const seconds = (since: number): string => `${((Date.now() - since) / 1000).toFixed(1)}s`;

const runRace = (): void => {
  const config: GameConfig = overridden(CONFIG);
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
};

const runCareers = (): void => {
  const config: CareerGameConfig = overridden(CAREER);
  const careers = args.games ?? config.sim.careers;
  const firstSeed = args.seed ?? config.sim.firstSeed;
  const overspendName = PILOT_NAMES.overspend(config.sim.overspendYear);

  const started = Date.now();
  const times: string[] = [];
  /** One batch on the same seeds, timed. */
  const batch = (name: string, on: CareerGameConfig, pilot?: Pilot): CareerSummary => {
    const at = Date.now();
    const summary = summarizeCareers(runCareerBatch(careers, firstSeed, on, pilot));
    times.push(`  ${name.padEnd(44)}${seconds(at).padStart(10)}`);
    return summary;
  };

  const baseline = batch("Baseline bot", config);
  const loopholes = [
    checkLoophole(PILOT_NAMES.neverList, batch(PILOT_NAMES.neverList, config, neverListPilot), baseline, config.sim.loopholeMargin),
    checkLoophole(PILOT_NAMES.listLast, batch(PILOT_NAMES.listLast, config, listLastPilot), baseline, config.sim.loopholeMargin),
    checkLoophole(overspendName, batch(overspendName, config, overspendPilot(config.sim.overspendYear)), baseline, config.sim.loopholeMargin),
  ];
  const measures = {
    withoutShifts: batch("Baseline bot, platform shifts switched off", withoutShifts(config)),
    endgame: batch(PILOT_NAMES.endgame, config, endgamePilot),
    shiftAware: batch(PILOT_NAMES.shiftAware, config, shiftAwarePilot),
  };
  const checks = checkCareerTargets(baseline, config.sim.targets, config.sim.leaderYear);

  console.log(formatCareerReport(baseline, checks, loopholes, config, measures));
  console.log("");
  console.log(`Seeds ${firstSeed} to ${firstSeed + careers - 1}, seven batches, ${seconds(started)}:`);
  for (const line of times) console.log(line);
  for (const [path, value] of Object.entries(args.overrides)) console.log(`Changed for this run only: ${path} = ${value}`);
  console.log("");
  // What src/config.ts changed from the career's design, whatever this run overrode.
  console.log(formatChanges(changedNumbers(CAREER_DESIGN, CAREER)));

  if (args.strict && checks.some((check) => !check.pass)) process.exit(1);
};

if (args.mode === "career") runCareers();
else runRace();
