import type { GameState, LogEntry } from "../types/game";
import { toLog } from "./utils";

export const makeDeterministicLogId = (state: GameState): string => `w${state.week}-l${state.logSeq}`;

export const appendLog = (
  state: GameState,
  logs: LogEntry[],
  text: string,
  kind: LogEntry["kind"] = "system"
): GameState => {
  logs.push(toLog(text, kind, makeDeterministicLogId(state)));
  return { ...state, logSeq: state.logSeq + 1 };
};

export const appendBlankLine = (state: GameState, logs: LogEntry[]): GameState => appendLog(state, logs, "", "system");
