// Turns a batch of simulated games into the balance report: who wins, how games end, how long
// they last, how often companies go under, and whether the four balance targets hold.

import type { BalanceTargets } from "../ai/types";
import type { EndingKind } from "../engine/types";
import { CHECKPOINT_TURNS, type SimGame } from "./runGame";

export type Seat = "baseline" | "blitzscaler" | "bootstrapper" | "incumbent";
export const SEATS: readonly Seat[] = ["baseline", "blitzscaler", "bootstrapper", "incumbent"];
const CPUS: readonly Seat[] = ["blitzscaler", "bootstrapper", "incumbent"];
const ENDINGS: readonly EndingKind[] = ["ipo", "turnLimit", "lastStanding", "wipeout"];

const SEAT_LABEL: Record<Seat, string> = { baseline: "Baseline bot", blitzscaler: "Blitzscaler", bootstrapper: "Bootstrapper", incumbent: "Incumbent" };
const endingLabel = (kind: EndingKind, maxTurns: number): string =>
  ({ ipo: "IPO", turnLimit: `Turn ${maxTurns}`, lastStanding: "Last one standing", wipeout: "Nobody left" })[kind];

export interface Position {
  /** Games that got as far as the checkpoint: one that has already ended has no position to count. */
  readonly reached: number;
  /** Of those games, the share in which this seat was still in the game. */
  readonly alive: number;
  /** Medians among those still in the game. */
  readonly users: number;
  readonly cash: number;
  readonly headcount: number;
  readonly quality: number;
}

export interface SimSummary {
  readonly games: number;
  /** Share of games won by each seat; "nobody" is a game where everyone went out. */
  readonly winShare: Readonly<Record<Seat | "nobody", number>>;
  /** Share of all games each seat won by each kind of ending. */
  readonly winsBy: Readonly<Record<Seat, Readonly<Record<EndingKind, number>>>>;
  readonly endingShare: Readonly<Record<EndingKind, number>>;
  readonly medianTurns: number;
  readonly meanTurns: number;
  /** Median turn of the IPO among games that ended in one; null if none did. */
  readonly medianIpoTurn: number | null;
  /** Share of each seat's games in which it went bankrupt, or had its founder fired. */
  readonly bankruptShare: Readonly<Record<Seat | "all", number>>;
  readonly firedShare: Readonly<Record<Seat | "all", number>>;
  /** Share of games in which at least one company went bankrupt. */
  readonly gamesWithBankruptcy: number;
  /** Median turn on which each seat went out, among the games where it did; null if it never did. */
  readonly medianExitTurn: Readonly<Record<Seat, number | null>>;
  readonly meanRaises: Readonly<Record<Seat, number>>;
  readonly positions: Readonly<Record<number, Readonly<Record<Seat, Position>>>>;
}

export const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

export const summarize = (games: readonly SimGame[]): SimSummary => {
  const total = Math.max(1, games.length);
  const share = (count: number): number => count / total;
  const seatOf = (game: SimGame, seat: Seat) => game.seats.find((s) => s.controller === seat);
  const perSeat = <T>(build: (seat: Seat) => T): Record<Seat, T> => ({
    baseline: build("baseline"),
    blitzscaler: build("blitzscaler"),
    bootstrapper: build("bootstrapper"),
    incumbent: build("incumbent"),
  });
  const perEnding = (count: (kind: EndingKind) => number): Record<EndingKind, number> => ({
    ipo: count("ipo"),
    turnLimit: count("turnLimit"),
    lastStanding: count("lastStanding"),
    wipeout: count("wipeout"),
  });

  const outShare = (reason: "bankrupt" | "fired") => ({
    ...perSeat((seat) => share(games.filter((game) => seatOf(game, seat)?.out === reason).length)),
    all: games.reduce((n, game) => n + game.seats.filter((s) => s.out === reason).length, 0) / Math.max(1, games.reduce((n, game) => n + game.seats.length, 0)),
  });

  const positions: Record<number, Record<Seat, Position>> = {};
  for (const turn of CHECKPOINT_TURNS) {
    positions[turn] = perSeat((seat) => {
      const reached = games.map((game) => game.checkpoints[turn]?.find((s) => s.controller === seat)).filter((s) => s !== undefined);
      const alive = reached.filter((s) => s.inGame);
      return {
        reached: reached.length,
        alive: reached.length === 0 ? 0 : alive.length / reached.length,
        users: median(alive.map((s) => s.users)),
        cash: median(alive.map((s) => s.cash)),
        headcount: median(alive.map((s) => s.headcount)),
        quality: median(alive.map((s) => s.quality)),
      };
    });
  }

  const ipoTurns = games.filter((game) => game.ending === "ipo").map((game) => game.turns);
  return {
    games: games.length,
    winShare: { ...perSeat((seat) => share(games.filter((game) => game.winner === seat).length)), nobody: share(games.filter((game) => game.winner === null).length) },
    winsBy: perSeat((seat) => perEnding((kind) => share(games.filter((game) => game.winner === seat && game.ending === kind).length))),
    endingShare: perEnding((kind) => share(games.filter((game) => game.ending === kind).length)),
    medianTurns: median(games.map((game) => game.turns)),
    meanTurns: mean(games.map((game) => game.turns)),
    medianIpoTurn: ipoTurns.length > 0 ? median(ipoTurns) : null,
    bankruptShare: outShare("bankrupt"),
    firedShare: outShare("fired"),
    gamesWithBankruptcy: share(games.filter((game) => game.seats.some((s) => s.out === "bankrupt")).length),
    medianExitTurn: perSeat((seat) => {
      const exits = games.map((game) => seatOf(game, seat)?.outTurn ?? null).filter((turn) => turn !== null);
      return exits.length > 0 ? median(exits) : null;
    }),
    meanRaises: perSeat((seat) => mean(games.map((game) => seatOf(game, seat)?.raises ?? 0))),
    positions,
  };
};

export interface Check {
  readonly id: "cpu-cap" | "baseline" | "length" | "ipo";
  readonly label: string;
  readonly pass: boolean;
  readonly detail: string;
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const within = (value: number, [low, high]: readonly [number, number]): boolean => value >= low && value <= high;

export const checkTargets = (summary: SimSummary, targets: BalanceTargets): Check[] => {
  const topCpu = [...CPUS].sort((a, b) => summary.winShare[b] - summary.winShare[a])[0];
  return [
    {
      id: "cpu-cap",
      label: `No CPU type wins more than ${percent(targets.maxCpuWinShare)}`,
      pass: summary.winShare[topCpu] <= targets.maxCpuWinShare,
      detail: `highest: ${SEAT_LABEL[topCpu]} ${percent(summary.winShare[topCpu])}`,
    },
    {
      id: "baseline",
      label: `Baseline bot wins ${percent(targets.baselineWinShare[0])} to ${percent(targets.baselineWinShare[1])}`,
      pass: within(summary.winShare.baseline, targets.baselineWinShare),
      detail: percent(summary.winShare.baseline),
    },
    {
      id: "length",
      label: `Median game lasts ${targets.medianTurns[0]} to ${targets.medianTurns[1]} turns`,
      pass: within(summary.medianTurns, targets.medianTurns),
      detail: `${summary.medianTurns} turns`,
    },
    {
      id: "ipo",
      label: `${percent(targets.ipoShare[0])} to ${percent(targets.ipoShare[1])} of games end in an IPO`,
      pass: within(summary.endingShare.ipo, targets.ipoShare),
      detail: percent(summary.endingShare.ipo),
    },
  ];
};

const money = (value: number): string => {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  return `${sign}$${Math.round(abs / 1_000)}K`;
};
const count = (value: number): string => (value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : String(Math.round(value)));

/** `maxTurns` is the game's turn limit, for the labels. */
export const formatReport = (summary: SimSummary, checks: readonly Check[], maxTurns: number): string => {
  const lines: string[] = [];
  const row = (label: string, ...cells: string[]): string => `  ${label.padEnd(24)}${cells.map((cell) => cell.padStart(12)).join("")}`;

  lines.push(`Balance simulation: ${summary.games.toLocaleString("en-US")} games`, "");

  lines.push("Win rate by player type", row("", "wins", "by IPO", `at turn ${maxTurns}`, "last one"));
  for (const seat of SEATS) {
    const by = summary.winsBy[seat];
    lines.push(row(SEAT_LABEL[seat], percent(summary.winShare[seat]), percent(by.ipo), percent(by.turnLimit), percent(by.lastStanding)));
  }
  if (summary.winShare.nobody > 0) lines.push(row("Nobody", percent(summary.winShare.nobody)));
  lines.push("");

  lines.push("How games end");
  for (const kind of ENDINGS) {
    if (kind === "wipeout" && summary.endingShare.wipeout === 0) continue;
    lines.push(row(endingLabel(kind, maxTurns), percent(summary.endingShare[kind])));
  }
  lines.push("");

  lines.push("Game length");
  lines.push(row("Median", `${summary.medianTurns} turns`));
  lines.push(row("Mean", `${summary.meanTurns.toFixed(1)} turns`));
  if (summary.medianIpoTurn !== null) lines.push(row("Median IPO turn", String(summary.medianIpoTurn)));
  lines.push("");

  lines.push("Out of the game", row("", "bankrupt", "fired", "median exit", "raises"));
  for (const seat of SEATS) {
    const exit = summary.medianExitTurn[seat];
    lines.push(row(SEAT_LABEL[seat], percent(summary.bankruptShare[seat]), percent(summary.firedShare[seat]), exit === null ? "-" : `turn ${exit}`, summary.meanRaises[seat].toFixed(1)));
  }
  lines.push(row("All companies", percent(summary.bankruptShare.all), percent(summary.firedShare.all)));
  lines.push(row("Games with a bankruptcy", percent(summary.gamesWithBankruptcy)));
  lines.push("");

  lines.push("Typical position (medians of companies still in the game)", row("", "in game", "users", "cash", "team", "quality"));
  for (const turn of CHECKPOINT_TURNS) {
    const positions = summary.positions[turn];
    if (positions === undefined) continue;
    // "In game" is a share of the games still going at that turn, so say so when some were already over.
    const reached = positions[SEATS[0]].reached;
    if (reached === 0) continue;
    if (reached < summary.games) lines.push(`  T${turn}: ${reached.toLocaleString("en-US")} of ${summary.games.toLocaleString("en-US")} games got this far`);
    for (const seat of SEATS) {
      const p = positions[seat];
      lines.push(row(`T${turn} ${SEAT_LABEL[seat]}`, percent(p.alive), count(p.users), money(p.cash), String(p.headcount), p.quality.toFixed(0)));
    }
  }
  lines.push("");

  lines.push("Targets");
  for (const check of checks) lines.push(`  ${check.pass ? "PASS" : "FAIL"}  ${check.label.padEnd(48)} ${check.detail}`);
  return lines.join("\n");
};
