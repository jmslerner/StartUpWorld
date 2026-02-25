import type { ActionResult, GameState, LogEntry, TeamRole } from "../types/game";
import { toLog, parseAmount } from "./utils";
import {
  canSpendAp,
  endWeek,
  hire,
  launchCampaign,
  pitchInvestors,
  raiseSeed,
  shipFeature,
  spendAp,
  status,
} from "./actions";

const roleMap: Record<string, TeamRole> = {
  engineering: "engineering",
  eng: "engineering",
  design: "design",
  marketing: "marketing",
  sales: "sales",
  ops: "ops",
  operations: "ops",
};

const helpText: LogEntry[] = [
  toLog("Commands:"),
  toLog("help - show commands"),
  toLog("status - show current stats"),
  toLog("hire <role> <count> - hire teammates"),
  toLog("ship <feature> - ship a feature"),
  toLog("launch <campaign> - run a growth campaign"),
  toLog("pitch - pitch investors"),
  toLog("raise <amount> - raise seed round"),
  toLog("end - end the week"),
];

export const executeCommand = (state: GameState, input: string): ActionResult => {
  const [rawCommand, ...rest] = input.trim().split(/\s+/);
  const command = rawCommand?.toLowerCase() ?? "";
  if (!command) {
    return { state, logs: [toLog("Type 'help' to see commands.", "system")] };
  }

  if (command === "help") {
    return { state, logs: helpText };
  }

  if (command === "status") {
    return status(state);
  }

  if (command === "hire") {
    if (!canSpendAp(state)) {
      return { state, logs: [toLog("No AP left. End the week to refresh.", "error")] };
    }
    const roleToken = rest[0]?.toLowerCase();
    const countToken = rest[1] ?? "1";
    const role = roleToken ? roleMap[roleToken] : undefined;
    if (!role) {
      return { state, logs: [toLog("Unknown role. Try engineering, design, marketing, sales, ops.", "error")] };
    }
    const count = Number(countToken);
    const result = hire(state, role, Number.isNaN(count) ? 1 : count);
    return { ...result, state: spendAp(result.state) };
  }

  if (command === "ship") {
    if (!canSpendAp(state)) {
      return { state, logs: [toLog("No AP left. End the week to refresh.", "error")] };
    }
    const name = rest.join(" ").trim();
    const result = shipFeature(state, name);
    return { ...result, state: spendAp(result.state) };
  }

  if (command === "launch") {
    if (!canSpendAp(state)) {
      return { state, logs: [toLog("No AP left. End the week to refresh.", "error")] };
    }
    const name = rest.join(" ").trim();
    const result = launchCampaign(state, name);
    return { ...result, state: spendAp(result.state) };
  }

  if (command === "pitch") {
    if (!canSpendAp(state)) {
      return { state, logs: [toLog("No AP left. End the week to refresh.", "error")] };
    }
    const result = pitchInvestors(state);
    return { ...result, state: spendAp(result.state) };
  }

  if (command === "raise") {
    const amount = parseAmount(rest[0] ?? "");
    if (!amount) {
      return { state, logs: [toLog("Provide an amount. Example: raise 25000 or raise 50k.", "error")] };
    }
    return raiseSeed(state, Math.round(amount));
  }

  if (command === "end") {
    return endWeek(state);
  }

  return { state, logs: [toLog(`Unknown command: ${command}`, "error")] };
};
