import { create } from "zustand";
import type { GameState, LogEntry } from "../types/game";
import { createInitialState, executeCommand } from "../engine";
import { toLog } from "../engine/utils";

interface GameStore {
  state: GameState;
  log: LogEntry[];
  runCommand: (input: string) => void;
}

const introLogs: LogEntry[] = [
  toLog("=== STARTUP WORLD ===", "system", "intro-1"),
  toLog("Build your AI startup from garage to IPO.", "system", "intro-2"),
  toLog("Start: founder visionary|hacker|sales-animal|philosopher", "system", "intro-3"),
  toLog("Then: cofounder operator|builder|rainmaker|powderkeg", "system", "intro-4"),
  toLog("Optional: name Ada | company Stealth Tiger", "system", "intro-5"),
  toLog("Type 'help' for commands.", "system", "intro-6"),
];

export const useGameStore = create<GameStore>((set) => ({
  state: createInitialState(),
  log: introLogs,
  runCommand: (input: string) =>
    set((current) => {
      const trimmed = input.trim();
      const prevWeek = current.state.week;
      const userLog = trimmed ? [toLog(`> ${trimmed}`, "user")] : [];
      const result = executeCommand(current.state, trimmed);
      const advancedWeek = result.state.week > prevWeek;
      return {
        state: result.state,
        log: advancedWeek ? [...userLog, ...result.logs] : [...current.log, ...userLog, ...result.logs],
      };
    }),
}));
