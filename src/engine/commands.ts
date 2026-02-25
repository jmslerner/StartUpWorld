import type { ActionResult, GameState, LogEntry, TeamRole } from "../types/game";
import { toLog, parseAmount } from "./utils";
import {
  choose,
  endWeek,
  hire,
  launchCampaign,
  pitchInvestors,
  raiseSeed,
  setCompanyName,
  setFounderArchetype,
  setPlayerName,
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

const founderOptions = ["visionary", "hacker", "sales-animal", "philosopher"] as const;
type FounderToken = (typeof founderOptions)[number];

const allowDuringPending = new Set(["choose", "status", "help", "name", "company"]);
const allowBeforeFounder = new Set(["founder", "status", "help", "name", "company"]);

const helpText: LogEntry[] = [
  toLog("Commands:"),
  toLog("name <your name> - set your name"),
  toLog("company <name> - set company name"),
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
  if (state.pendingEvent && !allowDuringPending.has(command)) {
    return { state, logs: [toLog("Resolve the pending event first with `choose <n>`.", "error")] };
  }

  // Founder must be chosen before Week 1 begins.
  if (!state.founder.archetype && !allowBeforeFounder.has(command)) {
    return {
      state,
      logs: [toLog("Pick your founder archetype first: `founder visionary|hacker|sales-animal|philosopher`.", "error")],
    };
  }

  switch (command) {
    case "help":
      return { state, logs: helpText };
    case "name":
      return setPlayerName(state, rest.join(" "));
    case "company":
      return setCompanyName(state, rest.join(" "));
    case "founder": {
      const token = (rest[0] ?? "").toLowerCase();
      if (!founderOptions.includes(token as FounderToken)) {
        return {
          state,
          logs: [toLog("Usage: founder visionary|hacker|sales-animal|philosopher", "error")],
        };
      }
      return setFounderArchetype(state, token as FounderToken);
    }
    case "choose": {
      const n = Number(rest[0] ?? "");
      if (!Number.isFinite(n) || n <= 0) {
        return { state, logs: [toLog("Usage: choose <n>", "error")] };
      }
      return choose(state, Math.floor(n));
    }
    case "status":
      return status(state);
    case "hire": {
      const roleToken = rest[0]?.toLowerCase();
      const role = roleToken ? roleMap[roleToken] : undefined;
      if (!role) {
        return { state, logs: [toLog("Unknown role. Try engineering, design, marketing, sales, ops.", "error")] };
      }
      const count = Number(rest[1] ?? "1");
      return hire(state, role, Number.isNaN(count) ? 1 : count);
    }
    case "ship":
      return shipFeature(state, rest.join(" ").trim());
    case "launch":
      return launchCampaign(state, rest.join(" ").trim());
    case "pitch":
      return pitchInvestors(state);
    case "raise": {
      const amount = parseAmount(rest[0] ?? "");
      if (!amount) {
        return { state, logs: [toLog("Provide an amount. Example: raise 25000 or raise 50k.", "error")] };
      }
      return raiseSeed(state, Math.round(amount));
    }
    case "end":
      return endWeek(state);
    default:
      return { state, logs: [toLog(`Unknown command: ${command}`, "error")] };
  }
};
