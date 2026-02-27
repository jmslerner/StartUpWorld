import type { ActionResult, GameState, LogEntry, TeamRole } from "../types/game";
import { toLog, parseAmount } from "./utils";
import {
  choose,
  endWeek,
  hire,
  launchCampaign,
  pitchInvestors,
  raiseBootstrap,
  raiseSeed,
  setCofounderArchetype,
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
  hr: "hr",
  legal: "legal",
  lawyer: "legal",
};

const founderOptions = ["visionary", "hacker", "sales-animal", "philosopher"] as const;
type FounderToken = (typeof founderOptions)[number];

const cofounderOptions = ["operator", "builder", "rainmaker", "powderkeg"] as const;
type CofounderToken = (typeof cofounderOptions)[number];

const allowDuringPending = new Set(["choose", "status", "help", "name", "company", "cofounder"]);
const allowBeforeSetup = new Set(["founder", "cofounder", "status", "help", "name", "company"]);

const helpText: LogEntry[] = [
  toLog("Commands:"),
  toLog("name <your name> - set your name"),
  toLog("company <name> - set company name"),
  toLog("founder <visionary|hacker|sales-animal|philosopher> - pick your founder (required)"),
  toLog("cofounder <operator|builder|rainmaker|powderkeg> - pick your cofounder (required)"),
  toLog("help - show commands"),
  toLog("clear / cls - reset the log output"),
  toLog("status - show current stats"),
  toLog("hire <role> <count> - hire teammates (engineering|design|marketing|sales|ops|hr|legal)"),
  toLog("ship <feature> - ship a feature"),
  toLog("launch <campaign> - run a growth campaign"),
  toLog("pitch - pitch investors"),
  toLog("raise - show funding options"),
  toLog("raise friends|cards|loan|preseed|mortgage - bootstrap funding"),
  toLog("raise <amount> - raise from investors (VC)"),
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

  // Founder + cofounder must be chosen before normal gameplay begins.
  if ((!state.founder.archetype || !state.cofounder.archetype) && !allowBeforeSetup.has(command)) {
    if (!state.founder.archetype) {
      return {
        state,
        logs: [toLog("Pick your founder archetype first: `founder visionary|hacker|sales-animal|philosopher`.", "error")],
      };
    }
    return {
      state,
      logs: [toLog("Pick your cofounder next: `cofounder operator|builder|rainmaker|powderkeg`.", "error")],
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
    case "cofounder": {
      const token = (rest[0] ?? "").toLowerCase();
      if (!cofounderOptions.includes(token as CofounderToken)) {
        return {
          state,
          logs: [toLog("Usage: cofounder operator|builder|rainmaker|powderkeg", "error")],
        };
      }
      return setCofounderArchetype(state, token as CofounderToken);
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
        return { state, logs: [toLog("Unknown role. Try engineering, design, marketing, sales, ops, hr, legal.", "error")] };
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
      if (rest.length === 0) {
        return {
          state,
          logs: [
            toLog("Funding options:"),
            toLog("raise friends   (+$15k)"),
            toLog("raise cards     (+$15k)"),
            toLog("raise loan      (+$25k)"),
            toLog("raise preseed   (+$50k)"),
            toLog("raise mortgage  (+$250k)"),
            toLog("Or: raise <amount> to raise from investors (e.g. raise 500k, raise 2.5m)."),
          ],
        };
      }

      const token = (rest[0] ?? "").toLowerCase();
      const source =
        token === "friends"
          ? ("friends" as const)
          : token === "cards" || token === "credit" || token === "credit-cards" || token === "creditcards"
            ? ("credit-cards" as const)
            : token === "loan" || token === "personal-loan" || token === "personalloan"
              ? ("personal-loan" as const)
              : token === "preseed" || token === "pre-seed"
                ? ("preseed" as const)
                : token === "mortgage"
                  ? ("mortgage" as const)
                  : null;

      if (source) {
        return raiseBootstrap(state, source);
      }

      const amount = parseAmount(rest[0] ?? "");
      if (!amount) {
        return { state, logs: [toLog("Usage: raise <amount> OR raise friends|cards|loan|preseed|mortgage", "error")] };
      }
      return raiseSeed(state, Math.round(amount));
    }
    case "end":
      return endWeek(state);
    default:
      return { state, logs: [toLog(`Unknown command: ${command}`, "error")] };
  }
};
