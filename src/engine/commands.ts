import type { ActionResult, GameState, LogEntry, TeamRole } from "../types/game";
import { toLog, parseAmount } from "./utils";
import {
  choose,
  endWeek,
  hire,
  launchCampaign,
  pitchInvestors,
  raiseSeed,
  setFounderArchetype,
  shipFeature,
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
  toLog("founder <visionary|hacker|sales-animal|philosopher> - pick your founder (required)"),
  toLog("help - show commands"),
  toLog("status - show current stats"),
  toLog("hire <role> <count> - hire teammates"),
  toLog("ship <feature> - ship a feature"),
  toLog("launch <campaign> - run a growth campaign"),
  toLog("pitch - pitch investors"),
  toLog("raise <amount> - raise seed round"),
  toLog("end - end the week"),
  toLog("choose <n> - resolve a pending event choice"),
];

export const executeCommand = (state: GameState, input: string): ActionResult => {
  const [rawCommand, ...rest] = input.trim().split(/\s+/);
  const command = rawCommand?.toLowerCase() ?? "";
  if (!command) {
    return { state, logs: [toLog("Type 'help' to see commands.", "system")] };
  }

  // Pending events block normal gameplay commands.
  if (state.pendingEvent && command !== "choose" && command !== "status" && command !== "help") {
    return { state, logs: [toLog("Resolve the pending event first with `choose <n>`.", "error")] };
  }

  // Founder must be chosen before Week 1 begins.
  if (!state.founder.archetype && command !== "founder" && command !== "status" && command !== "help") {
    return {
      state,
      logs: [toLog("Pick your founder archetype first: `founder visionary|hacker|sales-animal|philosopher`.", "error")],
    };
  }

  if (command === "help") {
    return { state, logs: helpText };
  }

  if (command === "founder") {
    const token = (rest[0] ?? "").toLowerCase();
    const valid = ["visionary", "hacker", "sales-animal", "philosopher"] as const;
    if (!valid.includes(token as (typeof valid)[number])) {
      return {
        state,
        logs: [toLog("Usage: founder visionary|hacker|sales-animal|philosopher", "error")],
      };
    }
    return setFounderArchetype(state, token as (typeof valid)[number]);
  }

  if (command === "choose") {
    const n = Number(rest[0] ?? "");
    if (!Number.isFinite(n) || n <= 0) {
      return { state, logs: [toLog("Usage: choose <n>", "error")] };
    }
    return choose(state, Math.floor(n));
  }

  if (command === "status") {
    return status(state);
  }

  if (command === "hire") {
    const roleToken = rest[0]?.toLowerCase();
    const countToken = rest[1] ?? "1";
    const role = roleToken ? roleMap[roleToken] : undefined;
    if (!role) {
      return { state, logs: [toLog("Unknown role. Try engineering, design, marketing, sales, ops.", "error")] };
    }
    const count = Number(countToken);
    return hire(state, role, Number.isNaN(count) ? 1 : count);
  }

  if (command === "ship") {
    const name = rest.join(" ").trim();
    return shipFeature(state, name);
  }

  if (command === "launch") {
    const name = rest.join(" ").trim();
    return launchCampaign(state, name);
  }

  if (command === "pitch") {
    return pitchInvestors(state);
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
