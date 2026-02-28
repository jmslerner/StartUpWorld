import { create } from "zustand";
import type { GameState, LogEntry } from "../types/game";
import { createInitialState, executeCommand } from "../engine";
import { toLog } from "../engine/utils";
import { pickWeeklyQuote } from "../ui/quotes";

interface GameStore {
  state: GameState;
  log: LogEntry[];
  runCommand: (input: string) => void;
}

const seedLabel = (state: GameState): string => {
  const t = state.seedText?.trim();
  return t ? t : String(state.seed);
};

const makeIntroLogs = (state: GameState): LogEntry[] => [
  toLog("=== STARTUP WORLD ===", "system", "intro-1"),
  toLog(`Seed: ${seedLabel(state)}`, "system", "intro-seed"),
  toLog("Build your AI startup from garage to IPO.", "system", "intro-2"),
  toLog("Set up: name → company → founder → cofounder", "system", "intro-3"),
  toLog("(You can still type commands anytime.)", "system", "intro-4"),
  toLog("Type 'help' for commands.", "system", "intro-6"),
];

const makeClearedLogs = (state: GameState): LogEntry[] => [
  toLog("=== STARTUP WORLD ===", "system", "intro-1"),
  toLog(`Seed: ${seedLabel(state)}`, "system", "intro-seed"),
  toLog("Type 'help' for commands.", "system", "intro-6"),
];

const initialState = createInitialState();

export const useGameStore = create<GameStore>((set) => ({
  state: initialState,
  log: makeIntroLogs(initialState),
  runCommand: (input: string) =>
    set((current) => {
      const trimmed = input.trim();

      const lower = trimmed.toLowerCase();
      if (lower === "clear" || lower === "cls") {
        return {
          state: current.state,
          log: makeClearedLogs(current.state),
        };
      }

      const prevWeek = current.state.week;
      const userLog = trimmed ? [toLog(`> ${trimmed}`, "user")] : [];
      const result = executeCommand(current.state, trimmed);
      const advancedWeek = result.state.week > prevWeek;

      const quoteLog = advancedWeek
        ? (() => {
            const q = pickWeeklyQuote(result.state.week);
            const suffix = q.note ? ` (${q.note})` : "";
            return [toLog(`Founder quote${suffix}: ${q.text} — ${q.by}`, "system")];
          })()
        : [];

      return {
        state: result.state,
        log: advancedWeek
          ? [...userLog, ...quoteLog, ...result.logs]
          : [...current.log, ...userLog, ...result.logs],
      };
    }),
}));
