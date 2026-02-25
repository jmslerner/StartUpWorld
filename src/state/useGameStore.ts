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
  toLog("", "system", "intro-3"),
  toLog("Optional: name yourself and your company.", "system", "intro-3b"),
  toLog("Try: name Ada | company Stealth Tiger", "system", "intro-3c"),
  toLog("First: pick your founder archetype.", "system", "intro-4"),
  toLog("Try: founder visionary | hacker | sales-animal | philosopher", "system", "intro-5"),
  toLog("Then: type 'help' to see available commands.", "system", "intro-6"),
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
