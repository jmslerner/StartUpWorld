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
  setSeed,
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
  ux: "design",
  marketing: "marketing",
  gtm: "marketing",
  sales: "sales",
  ae: "sales",
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

const allowDuringPending = new Set(["choose", "status", "help", "seed", "name", "company", "cofounder"]);

const allowBeforeName = new Set(["status", "help", "seed", "name"]);
const allowBeforeCompany = new Set(["status", "help", "seed", "name", "company"]);
const allowBeforeFounder = new Set(["status", "help", "seed", "name", "company", "founder"]);
const allowBeforeCofounder = new Set(["status", "help", "seed", "name", "company", "founder", "cofounder"]);

const setupHelpText: LogEntry[] = [
  toLog("Commands:"),
  toLog("seed <value> - set run seed (optional; locked once you start)"),
  toLog("seed - show current seed"),
  toLog("name <your name> - set your name (locked after set)"),
  toLog("company <name> - set company name (locked after set)"),
  toLog("founder <visionary|hacker|sales-animal|philosopher> - pick your founder (required)"),
  toLog("cofounder <operator|builder|rainmaker|powderkeg> - pick your cofounder (required)"),
  toLog("help - show commands"),
  toLog("clear / cls - reset the log output"),
  toLog("status - show current stats"),
  toLog("hire <role> <count> - hire teammates"),
  toLog("  roles: eng, ux, marketing, sales, ops, hr, legal"),
  toLog("ship <feature> - ship a feature"),
  toLog("launch <campaign> - run a growth campaign"),
  toLog("pitch - pitch investors"),
  toLog("raise [vc <amount>|friends|cards|loan|preseed|mortgage] - funding (run `raise` for options)"),
  toLog("end - end the week"),
  toLog("choose <n> - resolve a pending event choice"),
];

const mainHelpText: LogEntry[] = [
  toLog("Commands:"),
  toLog("help - show commands"),
  toLog("clear / cls - reset the log output"),
  toLog("seed - show current seed"),
  toLog("status - show current stats"),
  toLog("hire <role> <count> - hire teammates"),
  toLog("  roles: eng, ux, marketing, sales, ops, hr, legal"),
  toLog("ship <feature> - ship a feature"),
  toLog("launch <campaign> - run a growth campaign"),
  toLog("pitch - pitch investors"),
  toLog("raise [vc <amount>|friends|cards|loan|preseed|mortgage] - funding (run `raise` for options)"),
  toLog("end - end the week"),
  toLog("choose <n> - resolve a pending event choice"),
];

const isSetupComplete = (state: GameState) =>
  Boolean(state.founder.name.trim() && state.companyName.trim() && state.founder.archetype && state.cofounder.archetype);

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

  // Setup order: name -> company -> founder -> cofounder.
  if (!state.founder.name.trim() && !allowBeforeName.has(command)) {
    return { state, logs: [toLog("Set your name first: `name <your name>`.", "error")] };
  }

  if (state.founder.name.trim() && !state.companyName.trim() && !allowBeforeCompany.has(command)) {
    return { state, logs: [toLog("Set your company name next: `company <company name>`.", "error")] };
  }

  if (state.companyName.trim() && !state.founder.archetype && !allowBeforeFounder.has(command)) {
    return {
      state,
      logs: [toLog("Pick your founder archetype next: `founder visionary|hacker|sales-animal|philosopher`.", "error")],
    };
  }

  if (state.founder.archetype && !state.cofounder.archetype && !allowBeforeCofounder.has(command)) {
    return {
      state,
      logs: [toLog("Pick your cofounder next: `cofounder operator|builder|rainmaker|powderkeg`.", "error")],
    };
  }

  switch (command) {
    case "help":
      return { state, logs: isSetupComplete(state) ? mainHelpText : setupHelpText };
    case "seed": {
      if (rest.length === 0) {
        const shown = state.seedText?.trim() ? state.seedText : String(state.seed);
        const lock = state.seedLocked || state.week !== 1 || Boolean(state.cofounder.archetype);
        return { state, logs: [toLog(`Seed: ${shown}${lock ? " (locked)" : ""}`)] };
      }
      return setSeed(state, rest.join(" "));
    }
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
        return {
          state,
          logs: [toLog("Unknown role. Try engineering/design/marketing/sales/ops/hr/legal (aliases: eng, ux, gtm, ae).", "error")],
        };
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
            toLog("Funding:"),
            toLog("Investors: raise vc <amount> (e.g. raise vc 500k, raise vc 2.5m)"),
            toLog("Bootstrap: raise friends|cards|loan|preseed|mortgage"),
            toLog("raise friends   (+$15k)"),
            toLog("raise cards     (+$15k)"),
            toLog("raise loan      (+$25k)"),
            toLog("raise preseed   (+$50k)"),
            toLog("raise mortgage  (+$250k)"),
          ],
        };
      }

      const token = (rest[0] ?? "").toLowerCase();

      if (token === "vc" || token === "vs") {
        const amount = parseAmount(rest[1] ?? "");
        if (!amount) {
          return { state, logs: [toLog("Usage: raise vc <amount>", "error")] };
        }
        return raiseSeed(state, Math.round(amount));
      }

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

      return { state, logs: [toLog("Usage: raise vc <amount> OR raise friends|cards|loan|preseed|mortgage", "error")] };
    }
    case "end":
      return endWeek(state);

    // ── Easter eggs ──
    case "sudo":
      return { state, logs: [toLog("Nice try. Sudo doesn't work on capitalism.", "system")] };
    case "exit":
    case "quit":
      return { state, logs: [toLog("There is no exit. There is only pivot.", "system")] };
    case "coffee":
      return { state, logs: [toLog("You drink the coffee. [[beat]] It's cold. It's always cold.", "system")] };
    case "panic":
      return { state, logs: [toLog("Panic acknowledged. [[beat]] Routing to /dev/null.", "system")] };
    case "blame":
      return { state, logs: [toLog("Blame is not a command. It is, however, a management strategy.", "system")] };
    case "pivot":
      return { state, logs: [toLog("You can't just type 'pivot.' You have to actually do something different. [[beat]] That's the joke.", "system")] };
    case "pray":
      return { state, logs: [toLog("Prayer received. [[beat]] Routing to /dev/null.", "system")] };
    case "fire":
      return { state, logs: [toLog("HR says you need to file a PIP first. [[beat]] You don't have HR.", "system")] };
    case "sleep":
      return { state, logs: [toLog("Sleep is a feature your body keeps requesting. You keep deferring it.", "system")] };

    default: {
      const suggestion = findClosestCommand(command);
      const msg = suggestion
        ? `Unknown command: ${command}. Did you mean \`${suggestion}\`?`
        : `Unknown command: ${command}. Type \`help\` to see commands.`;
      return { state, logs: [toLog(msg, "error")] };
    }
  }
};

// ── Fuzzy matching for unknown commands ──

const knownCommands = [
  "help", "clear", "cls", "status", "seed", "name", "company",
  "founder", "cofounder", "choose", "hire", "ship", "launch",
  "pitch", "raise", "end",
];

const levenshtein = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
};

const findClosestCommand = (input: string): string | null => {
  const lower = input.toLowerCase();
  let best: string | null = null;
  let bestDist = Infinity;
  for (const cmd of knownCommands) {
    const d = levenshtein(lower, cmd);
    if (d < bestDist && d <= 2) {
      best = cmd;
      bestDist = d;
    }
  }
  return best;
};
