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
  toLog("=== STARTUP WORLD ==="),
  toLog("Build your AI startup from garage to IPO."),
  toLog(""),
  toLog("Type 'help' to see available commands."),
];

export const useGameStore = create<GameStore>((set) => ({
  state: createInitialState(),
  log: introLogs,
  runCommand: (input: string) =>
    set((current) => {
      const trimmed = input.trim();
      const userLog = trimmed ? [toLog(`> ${trimmed}`, "user")] : [];
      const result = executeCommand(current.state, trimmed);
      return {
        state: result.state,
        log: [...current.log, ...userLog, ...result.logs],
      };
    }),
}));
