import type { ActionResult, GameState, LogEntry, PricingModel, Stage, TeamRole } from "../types/game";
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
  setPricingModel,
  shipFeature,
  showPricingInfo,
  status,
  boardStatus,
  boardDinner,
  boardGift,
  boardBlackmail,
  showPhases,
  buyAsset,
  listAssets,
} from "./actions";
import { STAGE_PERKS, ROLE_MIN_STAGE } from "./stagePerks";

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
  data: "data",
  analytics: "data",
  product: "product",
  pm: "product",
  executive: "executive",
  exec: "executive",
  vp: "executive",
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
  toLog("  unlocks: data (seed), product (series-a), executive (growth)"),
  toLog("ship <feature> - ship a feature"),
  toLog("launch <campaign> - run a growth campaign"),
  toLog("pitch - pitch investors"),
  toLog("raise [vc <amount>|friends|cards|loan|preseed|mortgage] - funding (run `raise` for options)"),
  toLog("pricing [consumer|prosumer|enterprise] - view or change pricing model"),
  toLog("perks - view stage perks and upcoming unlocks"),
  toLog("board - view board of directors"),
  toLog("board dinner <name> - take a director to dinner (1 AP, $2K)"),
  toLog("board gift <name> - send a director a gift (1 AP, $5K)"),
  toLog("board blackmail <name> - risky leverage play (1 AP, 35% success)"),
  toLog("phases - view company phase progression and unlock requirements"),
  toLog("buy [asset] - purchase company assets (type `buy` for options) (1 AP)"),
  toLog("assets - list owned assets"),
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
  toLog("  unlocks: data (seed), product (series-a), executive (growth)"),
  toLog("ship <feature> - ship a feature"),
  toLog("launch <campaign> - run a growth campaign"),
  toLog("pitch - pitch investors"),
  toLog("raise [vc <amount>|friends|cards|loan|preseed|mortgage] - funding (run `raise` for options)"),
  toLog("pricing [consumer|prosumer|enterprise] - view or change pricing model"),
  toLog("perks - view stage perks and upcoming unlocks"),
  toLog("board - view board of directors"),
  toLog("board dinner <name> - take a director to dinner (1 AP, $2K)"),
  toLog("board gift <name> - send a director a gift (1 AP, $5K)"),
  toLog("board blackmail <name> - risky leverage play (1 AP, 35% success)"),
  toLog("phases - view company phase progression and unlock requirements"),
  toLog("buy [asset] - purchase company assets (type `buy` for options) (1 AP)"),
  toLog("assets - list owned assets"),
  toLog("end - end the week"),
  toLog("choose <n> - resolve a pending event choice"),
];

const isSetupComplete = (state: GameState) =>
  Boolean(state.founder.name.trim() && state.companyName.trim() && state.founder.archetype && state.cofounder.archetype);

const STAGE_ORDER: Stage[] = ["garage", "seed", "series-a", "growth"];

// ── Easter-egg lookup ──

const EASTER_EGGS: Record<string, string> = {
  sudo: "Nice try. Sudo doesn't work on capitalism.",
  exit: "There is no exit. There is only pivot.",
  quit: "There is no exit. There is only pivot.",
  coffee: "You drink the coffee. [[beat]] It's cold. It's always cold.",
  panic: "Panic acknowledged. [[beat]] Routing to /dev/null.",
  blame: "Blame is not a command. It is, however, a management strategy.",
  pivot: "Looking to pivot? Try `pricing consumer|prosumer|enterprise`.",
  pray: "Prayer received. [[beat]] Routing to /dev/null.",
  fire: "HR says you need to file a PIP first. [[beat]] You don't have HR.",
  sleep: "Sleep is a feature your body keeps requesting. You keep deferring it.",
  meditate: "You close your eyes for 10 seconds. [[beat]] Slack has 47 new messages.",
  disrupt: "You can't disrupt from a terminal. [[beat]] Or can you?",
  synergy: "Synergy detected. [[beat]] Just kidding. That word means nothing.",
  scale: "You can't scale what doesn't work. [[beat]] But you can try.",
  network: "Your network is your net worth. [[beat]] Your network is mostly bots.",
  hustle: "Rise and grind. [[beat]] The grind doesn't care about your sleep schedule.",
  ai: "You whisper 'AI' into the void. [[beat]] Your valuation doubles.",
  blockchain: "The board has voted to pretend you didn't say that.",
  vibe: "Vibes are not a business model. [[beat]] Except on Sand Hill Road.",
  ramen: "Ramen profitability: when you can afford ramen. [[beat]] You're not there yet.",
  vc: "A VC slides into your DMs: 'Love what you're building.' [[beat]] They say that to everyone.",
  traction: "Traction is just another word for 'please stop asking about revenue.'",
};

const handleEasterEgg = (state: GameState, command: string): ActionResult | null => {
  const msg = EASTER_EGGS[command];
  return msg ? { state, logs: [toLog(msg, "system")] } : null;
};

// ── Raise sub-command ──

const handleRaise = (state: GameState, rest: string[]): ActionResult => {
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
};

// ── Board sub-command ──

const handleBoard = (state: GameState, rest: string[]): ActionResult => {
  const sub = rest[0]?.toLowerCase();
  if (!sub) return boardStatus(state);
  const target = rest.slice(1).join(" ").trim();
  if (!target) {
    return { state, logs: [toLog(`Usage: board ${sub} <name>`, "error")] };
  }
  if (sub === "dinner") return boardDinner(state, target);
  if (sub === "gift") return boardGift(state, target);
  if (sub === "blackmail") return boardBlackmail(state, target);
  return { state, logs: [toLog("Board actions: board, board dinner <name>, board gift <name>, board blackmail <name>", "error")] };
};

const showPerks = (state: GameState): ActionResult => {
  const perks = STAGE_PERKS[state.stage];
  const logs: LogEntry[] = [toLog(`Stage: ${state.stage}`, "system")];

  const active: string[] = [];
  if (perks.shipSuccessBonus > 0) active.push(`Ship success +${Math.round(perks.shipSuccessBonus * 100)}%`);
  if (perks.launchSuccessBonus > 0) active.push(`Launch success +${Math.round(perks.launchSuccessBonus * 100)}%`);
  if (perks.pitchSuccessBonus > 0) active.push(`Pitch success +${Math.round(perks.pitchSuccessBonus * 100)}%`);
  if (perks.apBonus > 0) active.push(`+${perks.apBonus} max AP`);
  if (perks.overheadDiscount > 0) active.push(`Overhead -${Math.round(perks.overheadDiscount * 100)}%`);

  if (active.length > 0) {
    logs.push(toLog("Active perks:", "system"));
    for (const p of active) logs.push(toLog(`  ${p}`));
  } else {
    logs.push(toLog("No stage perks yet. Raise to advance.", "system"));
  }

  // Unlocked roles at this stage
  const unlockedRoles = Object.entries(ROLE_MIN_STAGE)
    .filter(([, minStage]) => STAGE_ORDER.indexOf(state.stage) >= STAGE_ORDER.indexOf(minStage))
    .map(([role]) => role);
  if (unlockedRoles.length > 0) {
    logs.push(toLog(`Unlocked roles: ${unlockedRoles.join(", ")}`, "system"));
  }

  // Upcoming unlocks
  const currentIdx = STAGE_ORDER.indexOf(state.stage);
  if (currentIdx < STAGE_ORDER.length - 1) {
    const nextStage = STAGE_ORDER[currentIdx + 1];
    const nextPerks = STAGE_PERKS[nextStage];
    logs.push(toLog(""));
    logs.push(toLog(`Next stage (${nextStage}):`, "system"));
    for (const msg of nextPerks.unlockMessages) {
      logs.push(toLog(`  ${msg}`));
    }
  } else {
    logs.push(toLog(""));
    logs.push(toLog("All stage perks unlocked.", "system"));
  }

  return { state, logs };
};

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
          logs: [toLog("Unknown role. Try eng, ux, marketing, sales, ops, hr, legal (unlocks: data, product, executive).", "error")],
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
    case "raise":
      return handleRaise(state, rest);
    case "pricing": {
      const model = (rest[0] ?? "").toLowerCase();
      if (!model) {
        return showPricingInfo(state);
      }
      if (!["consumer", "prosumer", "enterprise"].includes(model)) {
        return { state, logs: [toLog("Usage: pricing consumer|prosumer|enterprise", "error")] };
      }
      return setPricingModel(state, model as PricingModel);
    }
    case "perks":
      return showPerks(state);
    case "board":
      return handleBoard(state, rest);
    case "phases":
    case "roadmap":
      return showPhases(state);
    case "buy": {
      const target = rest.join(" ").trim();
      return buyAsset(state, target);
    }
    case "assets":
      return listAssets(state);
    case "end":
      return endWeek(state);

    default: {
      const egg = handleEasterEgg(state, command);
      if (egg) return egg;
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
  "pitch", "raise", "pricing", "perks", "board", "phases",
  "buy", "assets", "end",
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
