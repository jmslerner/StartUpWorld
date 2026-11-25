// Turns a batch of simulated careers into the career's balance report: who wins, the baseline bot's career, how often
// the leader of one year holds on, the rivals, the typical position at each checkpoint year, the dated cards that hit
// one company, the loophole checks, what the final year and the timeline are worth, and the five targets.
// Everything it prints is in years.

import type { CareerTargets } from "../ai/types";
import type { CareerGameConfig } from "../config";
import { yearOf } from "../engine/career";
import { PILOT_NAMES } from "./pilots";
import { SEATS, median, type Seat } from "./report";
import type { CareerSnapshot, SimCareer } from "./runCareer";

const CPUS: readonly Seat[] = ["blitzscaler", "bootstrapper", "incumbent"];
const STYLE_LABEL: Record<Seat, string> = { baseline: "Baseline bot", blitzscaler: "Blitzscaler", bootstrapper: "Bootstrapper", incumbent: "Incumbent" };

/** Medians among the companies of one style in the game in a checkpoint year; `companies` is how many per career, `listed` the share public. */
export interface CareerPosition {
  readonly companies: number;
  readonly listed: number;
  readonly users: number;
  readonly cash: number;
  readonly headcount: number;
  readonly quality: number;
  readonly equity: number;
}

export interface CareerSummary {
  readonly careers: number;
  /** By the style the winner plays, newcomers included; "nobody" is a career with no company left at the end. */
  readonly winShare: Readonly<Record<Seat | "nobody", number>>;
  /** The part of `winShare` won by the four companies of 1990. */
  readonly originalWinShare: Readonly<Record<Seat, number>>;
  /** Careers whose `winnerFounded` is above 1. */
  readonly newcomerWinShare: number;
  readonly baselineOutShare: number;
  readonly baselineRescuedShare: number;
  readonly baselineListedShare: number;
  /** Among the careers where it happened; null when it never did. */
  readonly medianOutYear: number | null;
  readonly medianListingYear: number | null;
  /** The median of `player.finalStake`. */
  readonly playerMedianStake: number;
  /** Among careers where `leaderHeld` is not null; 0 when there are none. */
  readonly leaderHeldShare: number;
  readonly rivalsOutPerCareer: number;
  readonly idleRivalYearsPerCareer: number;
  /** By year: how often a card that hits one company found one. */
  readonly cardHitShare: Readonly<Record<number, number>>;
  /** By year: how often the player's seat was rescued that year. Years with no rescue are left out. */
  readonly rescuedInYearShare: Readonly<Record<number, number>>;
  /** Medians among companies in the game, by year and style. */
  readonly positions: Readonly<Record<number, Readonly<Record<Seat, CareerPosition>>>>;
}

export type CareerCheckId = "cpu-cap" | "baseline" | "early-end" | "listed" | "lead";

export interface CareerCheck {
  readonly id: CareerCheckId;
  readonly label: string;
  readonly pass: boolean;
  readonly detail: string;
}

export interface LoopholeResult {
  readonly name: string;
  readonly winShare: number;
  readonly baselineWinShare: number;
  readonly flagged: boolean;
  /** The pilot's median final stake over the baseline bot's; null when the baseline bot's is $0. Reported, never flagged on. */
  readonly stakeRatio: number | null;
  /** In what share of careers the pilot's company was rescued. */
  readonly rescuedShare: number;
}

/** The batches that measure rather than check: the same careers without shifts, the end-game pilot's and the timeline reader's. */
export interface CareerMeasures {
  readonly withoutShifts?: CareerSummary;
  readonly endgame?: CareerSummary;
  readonly shiftAware?: CareerSummary;
}

const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

const perSeat = <T>(build: (seat: Seat) => T): Record<Seat, T> => ({
  baseline: build("baseline"),
  blitzscaler: build("blitzscaler"),
  bootstrapper: build("bootstrapper"),
  incumbent: build("incumbent"),
});

/** Shares by year of the careers in which `years` gives that year. */
const byYear = (careers: readonly SimCareer[], years: (career: SimCareer) => readonly number[]): Record<number, number> => {
  const counts = new Map<number, number>();
  for (const career of careers) for (const year of years(career)) counts.set(year, (counts.get(year) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => a - b).map(([year, count]) => [year, count / careers.length]));
};

export const summarizeCareers = (careers: readonly SimCareer[]): CareerSummary => {
  const total = Math.max(1, careers.length);
  const share = (test: (career: SimCareer) => boolean): number => careers.filter(test).length / total;
  const players = careers.map((career) => career.player);
  const outYears = players.flatMap((player) => (player.outYear === null ? [] : [player.outYear]));
  const listingYears = players.flatMap((player) => (player.listedYear === null ? [] : [player.listedYear]));
  const judged = careers.filter((career) => career.leaderHeld !== null);

  const cardYears = [...new Set(careers.flatMap((career) => career.targetedCards.map((card) => card.year)))].sort((a, b) => a - b);
  const cardHitShare = Object.fromEntries(
    cardYears.map((year) => {
      const dealt = careers.flatMap((career) => career.targetedCards.filter((card) => card.year === year));
      return [year, dealt.length === 0 ? 0 : dealt.filter((card) => card.hit).length / dealt.length];
    }),
  );

  const checkpointYears = [...new Set(careers.flatMap((career) => Object.keys(career.checkpoints).map(Number)))].sort((a, b) => a - b);
  const positions: Record<number, Record<Seat, CareerPosition>> = {};
  for (const year of checkpointYears) {
    positions[year] = perSeat((seat) => {
      const inGame: CareerSnapshot[] = careers.flatMap((career) => (career.checkpoints[year] ?? []).filter((each) => each.controller === seat && each.inGame));
      return {
        companies: inGame.length / total,
        listed: inGame.length === 0 ? 0 : inGame.filter((each) => each.listed).length / inGame.length,
        users: median(inGame.map((each) => each.users)),
        cash: median(inGame.map((each) => each.cash)),
        headcount: median(inGame.map((each) => each.headcount)),
        quality: median(inGame.map((each) => each.quality)),
        equity: median(inGame.map((each) => each.equity)),
      };
    });
  }

  return {
    careers: careers.length,
    winShare: { ...perSeat((seat) => share((career) => career.winner === seat)), nobody: share((career) => career.winner === null) },
    originalWinShare: perSeat((seat) => share((career) => career.winner === seat && career.winnerFounded === 1)),
    newcomerWinShare: share((career) => career.winnerFounded !== null && career.winnerFounded > 1),
    baselineOutShare: share((career) => career.player.outYear !== null),
    baselineRescuedShare: share((career) => career.player.rescuedYear !== null),
    baselineListedShare: share((career) => career.player.listedYear !== null),
    medianOutYear: outYears.length === 0 ? null : median(outYears),
    medianListingYear: listingYears.length === 0 ? null : median(listingYears),
    playerMedianStake: median(players.map((player) => player.finalStake)),
    leaderHeldShare: judged.length === 0 ? 0 : judged.filter((career) => career.leaderHeld === true).length / judged.length,
    rivalsOutPerCareer: mean(careers.map((career) => career.companies.filter((each) => each.seat !== 0 && each.outYear !== null).length)),
    idleRivalYearsPerCareer: mean(careers.map((career) => career.idleRivalYears)),
    cardHitShare,
    rescuedInYearShare: byYear(careers, (career) => (career.player.rescuedYear === null ? [] : [career.player.rescuedYear])),
    positions,
  };
};

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
/** A measured share: one decimal, or two when one would round it onto a figure it is not (40.04% is over a 40.0% cap). */
const measured = (value: number): string => {
  const points = value * 100;
  return Math.abs(Number(points.toFixed(1)) - points) < 1e-9 ? percent(value) : `${points.toFixed(2)}%`;
};
const within = (value: number, [low, high]: readonly [number, number]): boolean => value >= low && value <= high;

export const checkCareerTargets = (summary: CareerSummary, targets: CareerTargets, leaderYear: number): CareerCheck[] => {
  const topCpu = [...CPUS].sort((a, b) => summary.winShare[b] - summary.winShare[a])[0];
  const pooled = `${STYLE_LABEL[topCpu]} ${measured(summary.winShare[topCpu])} (1990 company ${measured(summary.originalWinShare[topCpu])})`;
  return [
    {
      id: "cpu-cap",
      label: `No CPU type wins more than ${percent(targets.maxCpuWinShare)}`,
      pass: summary.winShare[topCpu] <= targets.maxCpuWinShare,
      detail: `highest: ${pooled}`,
    },
    {
      id: "baseline",
      label: `Baseline bot wins ${percent(targets.baselineWinShare[0])} to ${percent(targets.baselineWinShare[1])}`,
      pass: within(summary.winShare.baseline, targets.baselineWinShare),
      detail: measured(summary.winShare.baseline),
    },
    {
      id: "early-end",
      label: `Baseline bot's career ends early in ${percent(targets.baselineOutShare[0])} to ${percent(targets.baselineOutShare[1])}`,
      pass: within(summary.baselineOutShare, targets.baselineOutShare),
      detail: measured(summary.baselineOutShare),
    },
    {
      id: "listed",
      label: `Baseline bot goes public in ${percent(targets.baselineListedShare[0])} to ${percent(targets.baselineListedShare[1])}`,
      pass: within(summary.baselineListedShare, targets.baselineListedShare),
      detail: measured(summary.baselineListedShare),
    },
    {
      id: "lead",
      label: `The leader of ${leaderYear} wins in less than ${percent(targets.leaderHoldsBelow)}`,
      pass: summary.leaderHeldShare < targets.leaderHoldsBelow,
      detail: measured(summary.leaderHeldShare),
    },
  ];
};

/** Shares compared to a billionth, so that 0.26 − 0.23 is not taken for more than 0.03. */
const billionths = (value: number): number => Math.round(value * 1e9);

export const checkLoophole = (name: string, pilot: CareerSummary, baseline: CareerSummary, margin: number): LoopholeResult => ({
  name,
  winShare: pilot.winShare.baseline,
  baselineWinShare: baseline.winShare.baseline,
  flagged: billionths(pilot.winShare.baseline - baseline.winShare.baseline) > billionths(margin),
  stakeRatio: baseline.playerMedianStake === 0 ? null : pilot.playerMedianStake / baseline.playerMedianStake,
  rescuedShare: pilot.baselineRescuedShare,
});

const money = (value: number): string => {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  return `${sign}$${Math.round(abs / 1_000)}K`;
};
const count = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
};
const year = (value: number | null): string => (value === null ? "-" : Number.isInteger(value) ? String(value) : value.toFixed(1));

export const formatCareerReport = (
  summary: CareerSummary,
  checks: readonly CareerCheck[],
  loopholes: readonly LoopholeResult[],
  config: CareerGameConfig,
  measures: CareerMeasures = {},
): string => {
  const lines: string[] = [];
  const row = (label: string, ...cells: string[]): string => `  ${label.padEnd(42)}${cells.map((cell) => cell.padStart(14)).join("")}`;
  const firstYear = config.career.firstYear;
  const lastYear = yearOf(config.game.maxTurns, config.career);
  const leaderYear = config.sim.leaderYear;

  lines.push(`Career simulation: ${summary.careers.toLocaleString("en-US")} careers, ${firstYear} to ${lastYear}`, "");

  lines.push("Who wins, by the style the winner plays", row("", "wins", `the ${firstYear} one`, "newcomers"));
  for (const seat of SEATS) {
    const original = summary.originalWinShare[seat];
    // The player's seat is never refilled, so the baseline bot has no newcomers.
    const newcomers = seat === "baseline" ? "-" : percent(Math.max(0, summary.winShare[seat] - original));
    lines.push(row(STYLE_LABEL[seat], percent(summary.winShare[seat]), percent(original), newcomers));
  }
  if (summary.winShare.nobody > 0) lines.push(row("Nobody left", percent(summary.winShare.nobody)));
  lines.push(row("Won by a newcomer, in all", percent(summary.newcomerWinShare)), "");

  lines.push("The baseline bot's career");
  lines.push(row("Ends early (out for good)", percent(summary.baselineOutShare), `median ${year(summary.medianOutYear)}`));
  lines.push(row("Rescued", percent(summary.baselineRescuedShare)));
  lines.push(row("Goes public", percent(summary.baselineListedShare), `median ${year(summary.medianListingYear)}`));
  lines.push(row(`Median founder's stake, ${lastYear}`, money(summary.playerMedianStake)));
  const rescueYears = Object.entries(summary.rescuedInYearShare)
    .sort(([a, x], [b, y]) => y - x || Number(a) - Number(b))
    .slice(0, 3);
  if (rescueYears.length > 0) lines.push(row("Most rescues in", ...rescueYears.map(([when, often]) => `${when} ${percent(often)}`)));
  lines.push("");

  lines.push("Leads");
  lines.push(row(`The leader of ${leaderYear} wins`, percent(summary.leaderHeldShare)));
  if (measures.withoutShifts !== undefined) lines.push(row("  with the platform shifts switched off", percent(measures.withoutShifts.leaderHeldShare)));
  lines.push("");

  lines.push("Rivals");
  lines.push(row("Out, per career", summary.rivalsOutPerCareer.toFixed(2)));
  lines.push(row("Years spent doing nothing, per career", summary.idleRivalYearsPerCareer.toFixed(2)));
  lines.push("");

  lines.push(
    "Typical position as the year closes (medians of companies in the game)",
    row("", "companies", "public", "users", "cash", "team", "quality", "founder's"),
  );
  for (const [when, positions] of Object.entries(summary.positions)) {
    for (const seat of SEATS) {
      const p = positions[seat];
      if (p.companies === 0) {
        lines.push(row(`${when} ${STYLE_LABEL[seat]}`, "0"));
        continue;
      }
      lines.push(row(`${when} ${STYLE_LABEL[seat]}`, p.companies.toFixed(2), percent(p.listed), count(p.users), money(p.cash), String(p.headcount), p.quality.toFixed(0), percent(p.equity)));
    }
  }
  lines.push("");

  lines.push("Dated cards that hit one company", row("", "found one"));
  for (const [when, often] of Object.entries(summary.cardHitShare)) lines.push(row(when, percent(often)));
  lines.push("");

  const overspender = PILOT_NAMES.overspend(config.sim.overspendYear);
  lines.push(
    `Loophole checks: the pilot in the player's seat on the same seeds, flagged above the baseline bot's wins by more than ${percent(config.sim.loopholeMargin)}`,
    row("", "wins", "baseline bot", "stake ratio", "rescued", "verdict"),
  );
  if (loopholes.length === 0) lines.push("  none run");
  for (const result of loopholes) {
    // An overspending pilot that is never rescued has not tried the loophole it is there to try.
    const verdict = result.name === overspender && result.rescuedShare === 0 ? "not tried" : result.flagged ? "flagged" : "not flagged";
    const ratio = result.stakeRatio === null ? "-" : `x${result.stakeRatio.toFixed(2)}`;
    lines.push(row(result.name, percent(result.winShare), percent(result.baselineWinShare), ratio, percent(result.rescuedShare), verdict));
  }
  lines.push("");

  const worth = (title: string, name: string, measure: CareerSummary | undefined): void => {
    lines.push(title, row("", "wins", "baseline bot", "median stake", "baseline bot"));
    if (measure === undefined) lines.push("  not measured in this run");
    else lines.push(row(name, percent(measure.winShare.baseline), percent(summary.winShare.baseline), money(measure.playerMedianStake), money(summary.playerMedianStake)));
    lines.push("");
  };
  worth("What the final year alone is worth", PILOT_NAMES.endgame, measures.endgame);
  worth("What reading the timeline is worth", PILOT_NAMES.shiftAware, measures.shiftAware);

  lines.push("Targets");
  for (const check of checks) lines.push(`  ${check.pass ? "PASS" : "FAIL"}  ${check.label.padEnd(52)} ${check.detail}`);
  return lines.join("\n");
};
