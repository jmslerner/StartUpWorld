import type { LogEntry } from "../types/game";

let logCounter = 0;

export const nextLogId = () => `log-${Date.now()}-${logCounter++}`;

export const toLog = (text: string, kind: LogEntry["kind"] = "system"): LogEntry => ({
  id: nextLogId(),
  text,
  kind,
});

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const parseAmount = (value: string): number | null => {
  const cleaned = value.replace(/[$,]/g, "").trim().toLowerCase();
  if (!cleaned) {
    return null;
  }
  const match = cleaned.match(/^([0-9]*\.?[0-9]+)(k|m)?$/);
  if (!match) {
    return null;
  }
  const base = Number(match[1]);
  if (Number.isNaN(base)) {
    return null;
  }
  const suffix = match[2];
  if (suffix === "k") {
    return base * 1_000;
  }
  if (suffix === "m") {
    return base * 1_000_000;
  }
  return base;
};
