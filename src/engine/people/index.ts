// The people module's public face (TYCOON-SPEC §11.2). Every export and its type is a contract with the shared engine
// files (commands.ts, tick.ts, actions.ts, hints.ts) and with the 3D office (the view selectors).
// Bare `fire` never reaches peopleCommand: commands.ts answers it (§4.5).
import type { Hint } from "../hints";
import type { CommandHandler, HintSource, StatusLine, WeekStep } from "../tycoon/contracts";
import { err } from "../tycoon/kit";
import { buildsOf, rosterOf } from "../tycoon/roster";
import { FUMES_BELOW, FUMES_FROM, TIRED_BELOW } from "./constants";
import { fireCommand, recruitCommand, retainCommand, teamCommand } from "./commands";
import { runPeopleWeek as peopleWeek } from "./weekly";

export { describeEmployee, listRoster, rosterForWorld, listCandidates, offerChance, QUIRK_BLURB } from "./view";
export type { CandidateFacts, EnergyWord, PersonFacts, WorldRoster } from "./view";

/** Top-level command names this module answers. */
export const PEOPLE_COMMANDS = ["team", "recruit", "fire", "retain"] as const;

/** Dispatches team | recruit | fire <args> | retain. */
export const peopleCommand: CommandHandler = (state, command, rest) => {
  if (command === "team") return teamCommand(state, rest);
  if (command === "recruit") return recruitCommand(state, rest);
  if (command === "fire") return fireCommand(state, rest);
  if (command === "retain") return retainCommand(state, rest);
  return err(state, `Unknown command: ${command}.`);
};

/** Tick step N2: departures, energy, "walks next week" lines, new notices. */
export const runPeopleWeek: WeekStep = peopleWeek;

/** "People: 22 named | 3 on builds | 1 holding an offer | 2 tired" for `status`, or null with an empty roster. */
export const peopleStatusLine: StatusLine = (state) => {
  const roster = rosterOf(state);
  if (roster.length === 0) return null;
  const onBuilds = roster.filter((e) => e.buildId !== null).length;
  const offers = roster.filter((e) => e.offerDueWeek > 0).length;
  const tired = roster.filter((e) => e.energy < TIRED_BELOW).length;
  return `People: ${roster.length} named | ${onBuilds} on builds${offers ? ` | ${offers} holding an offer` : ""}${tired ? ` | ${tired} tired` : ""}`;
};

/**
 * The one people hint (§7.1, priority 8): people on a crunching build are running on fumes. One hint per build, naming the
 * person when there is one and counting them when the whole crew is going under together (ERRATA 67). [] unless engaged.
 */
export const peopleHints: HintSource = (state) => {
  const hints: Hint[] = [];
  const builds = buildsOf(state);
  if (builds.length === 0) return hints;
  const roster = rosterOf(state);
  for (const b of builds) {
    if (!b.crunch) continue;
    const fumes = roster.filter((e) => e.buildId === b.id && e.energy >= FUMES_FROM && e.energy < FUMES_BELOW);
    if (fumes.length === 0) continue;
    const lowest = fumes.reduce((min, e) => Math.min(min, e.energy), 100);
    const crew = roster.filter((e) => e.buildId === b.id).length;
    hints.push({
      text: fumes.length === 1
        ? `Tip: ${fumes[0].name} is running on fumes (energy ${fumes[0].energy}). \`build crunch ${b.slug} off\` before they start interviewing.`
        : `Tip: ${fumes.length} of ${crew} people on ${b.name} are running on fumes (lowest energy ${lowest}). \`build crunch ${b.slug} off\` before they all start interviewing at once.`,
      priority: 8,
    });
  }
  return hints;
};
