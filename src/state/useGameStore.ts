import { create } from "zustand";
import type { GameState, LogEntry } from "../types/game";
import { createInitialState, executeCommand } from "../engine";
import { toLog } from "../engine/utils";
import { pickWeeklyQuote } from "../ui/quotes";
import { SFX } from "../ui/sound";

const SAVE_KEY = "startupworld:save";
const SAVE_VERSION = 1;

interface SaveData {
  version: number;
  state: GameState;
  log: LogEntry[];
  commandHistory: string[];
}

function saveToDisk(state: GameState, log: LogEntry[], commandHistory: string[]): void {
  try {
    const data: SaveData = { version: SAVE_VERSION, state, log, commandHistory };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Quota exceeded or private browsing — silently ignore.
  }
}

function loadFromDisk(): SaveData | null {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== SAVE_VERSION) return null;
    if (typeof data.state?.week !== "number" || typeof data.state?.seed !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

function clearSave(): void {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Ignore.
  }
}

interface GameStore {
  state: GameState;
  log: LogEntry[];
  commandHistory: string[];
  runCommand: (input: string) => void;
  resetGame: () => void;
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

const saved = loadFromDisk();
const initialState = saved?.state ?? createInitialState();
const initialLog = saved?.log ?? makeIntroLogs(initialState);
const initialHistory = saved?.commandHistory ?? [];

export const useGameStore = create<GameStore>((set) => ({
  state: initialState,
  log: initialLog,
  commandHistory: initialHistory,
  runCommand: (input: string) =>
    set((current) => {
      const trimmed = input.trim();

      const lower = trimmed.toLowerCase();
      if (lower === "clear" || lower === "cls") {
        const next = {
          state: current.state,
          log: makeClearedLogs(current.state),
          commandHistory: current.commandHistory,
        };
        queueMicrotask(() => saveToDisk(next.state, next.log, next.commandHistory));
        return next;
      }

      const prevWeek = current.state.week;
      const hadEvent = current.state.pendingEvent;
      const userLog = trimmed ? [toLog(`> ${trimmed}`, "user")] : [];
      const result = executeCommand(current.state, trimmed);
      const advancedWeek = result.state.week > prevWeek;

      // --- Sound effects (fire-and-forget, never block state update) ---
      if (result.sound === "success") SFX.success();
      else if (result.sound === "fail") SFX.fail();
      else if (result.sound === "cash-in") SFX.cashIn();
      else if (result.sound === "warning") SFX.warning();
      else if (result.sound === "opportunity") SFX.opportunity();
      else if (result.sound === "crisis") SFX.crisis();
      else if (result.sound === "click") SFX.click();

      if (advancedWeek) SFX.tick();
      if (!hadEvent && result.state.pendingEvent) SFX.alert();
      if (result.state.gameOver && !current.state.gameOver) {
        setTimeout(() => SFX.gameOver(result.state.gameOver!.ending), 200);
      }

      const quoteLog = advancedWeek
        ? (() => {
            const q = pickWeeklyQuote(result.state.week);
            const suffix = q.note ? ` (${q.note})` : "";
            return [toLog(`Founder quote${suffix}: ${q.text} — ${q.by}`, "system")];
          })()
        : [];

      // Build updated command history (dedup consecutive, cap at 50)
      const newHistory = trimmed
        ? (current.commandHistory[0] === trimmed
            ? current.commandHistory
            : [trimmed, ...current.commandHistory].slice(0, 50))
        : current.commandHistory;

      const newLog = advancedWeek
        ? [...userLog, ...quoteLog, ...result.logs]
        : [...current.log, ...userLog, ...result.logs];

      const next = {
        state: result.state,
        log: newLog,
        commandHistory: newHistory,
      };

      queueMicrotask(() => saveToDisk(next.state, next.log, next.commandHistory));

      return next;
    }),
  resetGame: () =>
    set(() => {
      clearSave();
      const fresh = createInitialState();
      return { state: fresh, log: makeIntroLogs(fresh), commandHistory: [] };
    }),
}));
