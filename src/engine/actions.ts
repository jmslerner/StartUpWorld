import type {
  ActionResult,
  BootstrapFundingSource,
  CofounderArchetype,
  FounderArchetype,
  GameState,
  LogEntry,
  SoundHint,
  TeamRole,
} from "../types/game";
import { appendLog } from "./logging";
import { clamp } from "./utils";
import { BASE_AP, calcBurn, calcRunwayWeeks, roleComp, getApCost, markFreeActionUsed } from "./economy";
import { applyHiringCohesionHit } from "./culture";
import { isCofounderChosen, isFounderChosen, setFounder, founderMods } from "./founders";
import { chance, nextIntInclusive, signedUnit } from "./rng";
import { successPenaltyFromStress } from "./stress";
import { endWeekTick } from "./tick";
import { applyPendingEventChoice } from "./events/applyChoice";
import { computeContext } from "./context";
import { pitch, raise } from "./investors";
import { evaluateEndings } from "./endings";
import { refreshDerivedNoLog } from "./derived";

const withLogLines = (state: GameState, lines: Array<{ text: string; kind?: LogEntry["kind"] }>, sound?: SoundHint): ActionResult => {
  const logs: LogEntry[] = [];
  let s = state;
  for (const line of lines) {
    s = appendLog(s, logs, line.text, line.kind ?? "system");
  }
  return { state: refreshDerivedNoLog(s), logs, sound };
};

const err = (state: GameState, message: string): ActionResult => withLogLines(state, [{ text: message, kind: "error" }]);

const normalizeName = (input: string, maxLen: number): string => {
  const trimmed = input.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen).trim() : trimmed;
};

const fnv1a32 = (input: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const parseSeedToU32 = (raw: string): number => {
  const s = raw.trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return (Number.isFinite(n) ? (n >>> 0) : 0) || 1;
  }
  return fnv1a32(s) || 1;
};

type ArchetypeBlurb = {
  title: string;
  desc: string;
  edge: string;
  risk: string;
};

const FOUNDER_ARCHETYPE_BLURB: Record<FounderArchetype, ArchetypeBlurb> = {
  visionary: {
    title: "Visionary",
    desc: "You sell a future that doesn’t exist yet—and somehow people believe you.",
    edge: "Edge: narrative gravity, talent magnet, big swings upward.",
    risk: "Risk: hype debt, expectation whiplash, volatility spikes when you miss.",
  },
  hacker: {
    title: "Hacker",
    desc: "You ship. You iterate. You treat reality like a bug report.",
    edge: "Edge: execution velocity, technical leverage, calmer ops under pressure.",
    risk: "Risk: product tunnel vision, weaker narrative, harder fundraising when stressed.",
  },
  "sales-animal": {
    title: "Sales Animal",
    desc: "You can turn a cold stare into a signed contract and a referral.",
    edge: "Edge: deals, distribution, momentum—your numbers can jump fast.",
    risk: "Risk: burn appetite, overpromising, chaos follows the quota.",
  },
  philosopher: {
    title: "Philosopher",
    desc: "You build a company with principles. Sometimes that’s the moat.",
    edge: "Edge: culture resilience, long-term compounding, cleaner decisions.",
    risk: "Risk: slower aggression, missed windows, death by “thoughtful.”",
  },
};

const COFOUNDER_ARCHETYPE_BLURB: Record<CofounderArchetype, ArchetypeBlurb> = {
  operator: {
    title: "Operator",
    desc: "They turn chaos into checklists and feelings into processes. [[beat]] Annoying. Necessary.",
    edge: "Edge: stabilizes execution and reduces self-inflicted wounds.",
    risk: "Risk: slows speed, creates friction when you want to 'just ship it'.",
  },
  builder: {
    title: "Builder",
    desc: "They quietly make the impossible… boring. [[beat]] Which is the highest compliment.",
    edge: "Edge: execution reliability and higher odds your plans become real.",
    risk: "Risk: can check out if credit gets weird; resentment is silent.",
  },
  rainmaker: {
    title: "Rainmaker",
    desc: "They can walk into a room with nothing and walk out with a yes. [[beat]] Sometimes they also walk out with a problem.",
    edge: "Edge: intros, deals, fundraising momentum when it matters.",
    risk: "Risk: promises outpace reality; volatility follows the story.",
  },
  powderkeg: {
    title: "Powderkeg",
    desc: "Brilliant, intense, and one Slack message away from a full-length workplace drama. [[beat]] Good luck.",
    edge: "Edge: breakout creativity and unexpected upside in desperate weeks.",
    risk: "Risk: trust collapses fast; drama becomes a core mechanic.",
  },
};

const stripPrefix = (s: string, prefix: string) => (s.toLowerCase().startsWith(prefix.toLowerCase()) ? s.slice(prefix.length).trim() : s);

// ── Randomized flavor messages ──

const shipFailMessages = [
  "It's not ready. You ship anyway. It's a mess.",
  "The deploy succeeds. The product does not.",
  "You push to prod at 11pm. [[beat]] Prod pushes back.",
  "It ships. [[beat]] It sinks.",
  "Congratulations: you've automated disappointment.",
  "The feature works on your laptop. Your laptop is not production.",
];

const launchFailMessages = [
  "It flops in public. Private, too.",
  "Your campaign reaches millions. [[beat]] Of bots.",
  "The landing page loads. Nobody lands.",
  "Marketing spent. Awareness achieved. Revenue: unchanged.",
];

const pickMsg = (rng: number, msgs: string[]): { rng: number; msg: string } => {
  const pick = nextIntInclusive(rng, 0, msgs.length - 1);
  return { rng: pick.rng, msg: msgs[pick.value] };
};

const founderTldr = (a: FounderArchetype | null): string | null => {
  if (!a) return null;
  const b = FOUNDER_ARCHETYPE_BLURB[a];
  return `${b.title} — ${stripPrefix(b.edge, "Edge:")} / ${stripPrefix(b.risk, "Risk:")}`;
};

const cofounderTldr = (a: CofounderArchetype | null): string | null => {
  if (!a) return null;
  const b = COFOUNDER_ARCHETYPE_BLURB[a];
  return `${b.title} — ${stripPrefix(b.edge, "Edge:")} / ${stripPrefix(b.risk, "Risk:")}`;
};

export const setPlayerName = (state: GameState, name: string): ActionResult => {
  if (state.gameOver) {
    return err(state, "Game over.");
  }
  if (state.founder.name.trim()) {
    return err(state, "Name already locked for this run.");
  }
  const normalized = normalizeName(name, 32);
  if (!normalized) {
    return err(state, "Usage: name <your name>");
  }
  const updated: GameState = { ...state, founder: { ...state.founder, name: normalized } };
  return withLogLines(updated, [{ text: `You are now: ${normalized}.`, kind: "system" }]);
};

export const setCompanyName = (state: GameState, name: string): ActionResult => {
  if (state.gameOver) {
    return err(state, "Game over.");
  }
  if (state.companyName.trim()) {
    return err(state, "Company name already locked for this run.");
  }
  const normalized = normalizeName(name, 40);
  if (!normalized) {
    return err(state, "Usage: company <company name>");
  }
  const updated: GameState = { ...state, companyName: normalized };
  return withLogLines(updated, [{ text: `Company set: ${normalized}.`, kind: "system" }]);
};

export const setCofounderArchetype = (state: GameState, archetype: CofounderArchetype): ActionResult => {
  if (state.gameOver) {
    return err(state, "Game over.");
  }
  if (state.cofounder.archetype) {
    return err(state, "Cofounder already locked for this run.");
  }

  const profiles: Record<
    CofounderArchetype,
    { base: { trust: number; ego: number; ambition: number }; names: string[]; tagline: string }
  > = {
    operator: {
      base: { trust: 78, ego: 48, ambition: 68 },
      names: ["Alex", "Morgan", "Sam", "Jordan", "Casey", "Taylor"],
      tagline: "Adult supervision. Process. Calm under fire.",
    },
    builder: {
      base: { trust: 72, ego: 52, ambition: 72 },
      names: ["Riley", "Avery", "Quinn", "Jamie", "Reese", "Drew"],
      tagline: "Craft obsession. Product instincts. Quiet intensity.",
    },
    rainmaker: {
      base: { trust: 64, ego: 66, ambition: 82 },
      names: ["Blake", "Cameron", "Parker", "Rowan", "Hayden", "Emerson"],
      tagline: "Network heat. Deals. Confidence that borders on delusion.",
    },
    powderkeg: {
      base: { trust: 56, ego: 80, ambition: 88 },
      names: ["Logan", "Sydney", "Harper", "Kai", "Sasha", "Noah"],
      tagline: "Brilliant. Volatile. Will either save the company or burn it down.",
    },
  };

  const profile = profiles[archetype];
  const pick = nextIntInclusive(state.rng, 0, profile.names.length - 1);
  const name = profile.names[pick.value] ?? "Cofounder";

  const updated: GameState = {
    ...state,
    rng: pick.rng,
    seedLocked: true,
    cofounder: {
      ...state.cofounder,
      name,
      archetype,
      trust: profile.base.trust,
      ego: profile.base.ego,
      ambition: profile.base.ambition,
    },
  };

  const b = COFOUNDER_ARCHETYPE_BLURB[archetype];

  return withLogLines(updated, [
    { text: `Cofounder locked: ${name} (${b.title}). [[beat]]`, kind: "system" },
    { text: profile.tagline, kind: "system" },
    { text: b.desc, kind: "system" },
    { text: b.edge, kind: "system" },
    { text: b.risk, kind: "system" },
  ]);
};

export const createInitialState = (): GameState => {
  const seed = (Date.now() >>> 0) || 1;
  const base: GameState = {
    companyName: "",
    week: 1,
    ap: BASE_AP,
    cash: 20_000,
    debtOutstanding: 0,
    debtService: 0,
    valuation: 0,

    capTable: { founderPct: 1, investorPct: 0 },
    lastRound: null,

    users: 50,
    arpu: 10,
    mrr: 50 * 10,
    burn: 0,
    team: { engineering: 1, design: 0, marketing: 0, sales: 0, ops: 0, hr: 0, legal: 0 },
    reputation: 10,
    vcReputation: 8,
    stage: "garage",
    thesis: "ai",
    companyPhase: "garage",
    founder: { name: "", archetype: null },
    cofounder: { name: "Cofounder", archetype: null, trust: 72, ego: 55, ambition: 76 },
    culture: { cohesion: 78, morale: 72 },
    stress: 18,
    volatility: 22,
    investors: { pipeline: [] },
    bootstrapFunding: { friends: 0, "credit-cards": 0, "personal-loan": 0, preseed: 0, mortgage: 0 },
    peakValuation: 0,
    totalRaised: 0,
    freeActionUsed: {},
    pendingEvent: null,
    eventHistory: [],
    gameOver: null,
    seed,
    rng: (seed ^ 0x9e3779b9) >>> 0,
    logSeq: 0,
    seedText: null,
    seedLocked: false,
    lastWeek: { users: 50, mrr: 50 * 10, cash: 20_000, teamSize: 1 },
  };

  return refreshDerivedNoLog(base);
};

export const canSpendAp = (state: GameState, cost = 1): boolean => state.ap >= cost;

export const spendAp = (state: GameState, cost = 1): GameState => ({
  ...state,
  ap: Math.max(0, state.ap - cost),
  seedLocked: true,
});

export const setSeed = (state: GameState, rawSeed: string): ActionResult => {
  if (state.gameOver) {
    return err(state, "Game over.");
  }
  if (state.week !== 1 || state.seedLocked || state.cofounder.archetype) {
    return err(state, "Seed is locked for this run. Set it before choosing your cofounder / starting play.");
  }

  const trimmed = rawSeed.trim();
  if (!trimmed) {
    return err(state, "Usage: seed <value> (number or text)");
  }

  const seed = parseSeedToU32(trimmed);
  const updated: GameState = {
    ...state,
    seed,
    rng: (seed ^ 0x9e3779b9) >>> 0,
    seedText: trimmed,
  };

  return withLogLines(updated, [{ text: `Seed set: ${trimmed}.`, kind: "system" }]);
};

export const raiseBootstrap = (state: GameState, source: BootstrapFundingSource): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;

  if (!canSpendAp(state)) {
    return err(state, "No AP left. End the week to refresh.");
  }

  const uses = state.bootstrapFunding[source] ?? 0;

  const profile: Record<
    BootstrapFundingSource,
    { label: string; cash: number; debt: number; debtService: number; stress: number; vcRepDelta: number }
  > = {
    friends: { label: "Borrow from friends", cash: 15_000, debt: 15_000, debtService: 0, stress: 6, vcRepDelta: 0 },
    "credit-cards": { label: "Max credit cards", cash: 15_000, debt: 15_000, debtService: 450, stress: 9, vcRepDelta: -1 },
    "personal-loan": { label: "Personal loan", cash: 25_000, debt: 25_000, debtService: 650, stress: 11, vcRepDelta: -1 },
    preseed: { label: "Raise pre-seed", cash: 50_000, debt: 0, debtService: 0, stress: 5, vcRepDelta: 1 },
    mortgage: { label: "Mortgage your house", cash: 250_000, debt: 250_000, debtService: 1_400, stress: 18, vcRepDelta: -2 },
  };

  const p = profile[source];
  const stressDelta = p.stress; // reusable: same amount each time; pressure stacks via debt service

  const updated: GameState = spendAp({
    ...state,
    cash: state.cash + p.cash,
    debtOutstanding: state.debtOutstanding + p.debt,
    debtService: state.debtService + p.debtService,
    stress: clamp(state.stress + stressDelta, 0, 100),
    vcReputation: clamp(state.vcReputation + p.vcRepDelta, 0, 100),
    bootstrapFunding: { ...state.bootstrapFunding, [source]: uses + 1 },
    totalRaised: state.totalRaised + p.cash,
  });

  const lines: Array<{ text: string; kind?: LogEntry["kind"] }> = [
    { text: `${p.label}: +$${p.cash.toLocaleString()}.`, kind: "event" },
  ];
  if (p.debt > 0) {
    lines.push({ text: `Debt +$${p.debt.toLocaleString()}.`, kind: "event" });
  }
  if (p.debtService > 0) {
    lines.push({ text: `Debt service +$${p.debtService.toLocaleString()}/wk.`, kind: "event" });
  }
  lines.push({ text: `Stress +${stressDelta}.`, kind: "event" });

  return withLogLines(updated, lines, "cash-in");
};

const ensurePlayable = (state: GameState): ActionResult | null => {
  if (state.gameOver) {
    return err(state, "Game over. Click 'Play Again' or refresh to start a new run.");
  }
  if (state.pendingEvent) {
    return err(state, "Resolve the pending event first with `choose <n>`.");
  }
  if (!isFounderChosen(state)) {
    return err(state, "Choose your founder first: `founder visionary|hacker|sales-animal|philosopher`.");
  }
  if (!isCofounderChosen(state)) {
    return err(state, "Choose your cofounder first: `cofounder operator|builder|rainmaker|powderkeg`.");
  }
  return null;
};

export const setFounderArchetype = (state: GameState, archetype: FounderArchetype): ActionResult => {
  if (state.gameOver) {
    return err(state, "Game over.");
  }
  if (state.founder.archetype) {
    return err(state, "Founder archetype already locked for this run.");
  }

  const thesis: GameState["thesis"] =
    archetype === "visionary"
      ? "ai"
      : archetype === "hacker"
        ? "devtools"
        : archetype === "sales-animal"
          ? "enterprise"
          : "consumer";

  const updated = { ...setFounder(state, archetype), thesis, vcReputation: clamp(state.vcReputation + 2, 0, 100) };

  const b = FOUNDER_ARCHETYPE_BLURB[archetype];

  return withLogLines(updated, [
    { text: `Founder locked: ${b.title}. [[beat]]`, kind: "system" },
    { text: b.desc, kind: "system" },
    { text: b.edge, kind: "system" },
    { text: b.risk, kind: "system" },
    { text: `Thesis: ${thesis}.`, kind: "system" },
    { text: "Now build something people want. Or at least something investors want.", kind: "system" },
  ]);
};

export const hire = (state: GameState, role: TeamRole, count: number): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;

  if (!canSpendAp(state)) {
    return err(state, "No AP left. End the week to refresh.");
  }
  if (count <= 0) {
    return err(state, "Hire count must be at least 1.");
  }

  const { hireCost } = roleComp[role];
  const totalHireCost = hireCost * count;
  if (state.cash < totalHireCost) {
    return err(state, "Not enough cash to hire that many.");
  }

  let updated: GameState = {
    ...state,
    cash: state.cash - totalHireCost,
    team: { ...state.team, [role]: state.team[role] + count },
  };

  updated = applyHiringCohesionHit(updated, count);
  updated = { ...updated, burn: calcBurn(updated) };
  updated = spendAp(updated);

  const lines: Array<{ text: string; kind?: LogEntry["kind"] }> = [
    { text: `Hired ${count} ${role} ${count === 1 ? "hire" : "hires"}.` },
    { text: `Cash -$${totalHireCost.toLocaleString()}. Burn now $${updated.burn.toLocaleString()}/wk.` },
  ];
  if (count >= 3) {
    lines.push({ text: "Rapid hiring strains cohesion.", kind: "event" });
  }

  return withLogLines(updated, lines, "success");
};

export const shipFeature = (state: GameState, name: string): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  const shipCost = getApCost(state, "ship");
  if (!canSpendAp(state, shipCost)) {
    return err(state, "No AP left. End the week to refresh.");
  }
  if (!name.trim()) {
    return err(state, "Ship what? Provide a feature name.");
  }

  const archetype = state.founder.archetype!;
  const mods = founderMods[archetype];
  const stressPenalty = successPenaltyFromStress(state);

  const eng = state.team.engineering;
  const design = state.team.design;
  const ops = state.team.ops;
  const sales = state.team.sales;
  const mkt = state.team.marketing;
  const hr = state.team.hr;
  const legal = state.team.legal;
  const cohesion = clamp(state.culture.cohesion / 100, 0, 1);

  // If go-to-market outpaces execution capacity, delivery suffers.
  const execCapacity = eng + design + ops;
  const gtm = sales + mkt;
  const execGap = Math.max(0, gtm - execCapacity);
  const imbalancePenalty = Math.min(0.18, execGap * 0.025);

  // HR adds process overhead (slower shipping); Legal adds operational efficiency.
  const processDrag = hr * 0.015;
  const efficiencyBoost = legal * 0.01;
  const base =
    0.68 +
    eng * 0.03 +
    cohesion * 0.08 +
    mods.shipSuccess -
    stressPenalty -
    processDrag +
    efficiencyBoost -
    imbalancePenalty;
  const p = clamp(base, 0.05, 0.92);

  let s = state;
  const roll = chance(s.rng, p);
  s = { ...s, rng: roll.rng };

  const vol = clamp(s.volatility / 100, 0, 1);
  const swing = signedUnit(s.rng);
  s = { ...s, rng: swing.rng };

  const freeShipLog = shipCost === 0 ? [{ text: "Hacker perk: first ship of the week is free.", kind: "event" as const }] : [];

  if (!roll.value) {
    const repLoss = Math.max(1, Math.round((2 + vol * 3) * (0.7 + Math.max(0, -swing.value))));
    const failPick = pickMsg(s.rng, shipFailMessages);
    s = { ...s, rng: failPick.rng };
    const updated: GameState = markFreeActionUsed(spendAp({
      ...s,
      reputation: clamp(s.reputation - repLoss, 0, 100),
      culture: {
        cohesion: clamp(s.culture.cohesion - 2, 0, 100),
        morale: clamp(s.culture.morale - 4, 0, 100),
      },
    }, shipCost), "ship");
    return withLogLines(updated, [
      { text: `Tried to ship: ${name}.` },
      ...freeShipLog,
      ...(imbalancePenalty > 0
        ? ([{ text: "Execution is slipping: too much GTM, not enough operators/builders.", kind: "event" }] as const)
        : []),
      { text: failPick.msg, kind: "event" },
      { text: `Reputation -${repLoss}. Morale -4. Cohesion -2.`, kind: "event" },
    ], "fail");
  }

  const repGain = Math.max(1, Math.round((2 + eng) * (0.55 + vol * 0.9 + Math.max(0, swing.value) * 0.6)));
  const arpuBump = Math.max(0, Math.round((Math.max(0, swing.value) * vol) * 2));
  const updated: GameState = markFreeActionUsed(spendAp({
    ...s,
    reputation: clamp(s.reputation + repGain, 0, 100),
    arpu: clamp(s.arpu + arpuBump, 2, 99),
    culture: {
      cohesion: clamp(s.culture.cohesion + 1, 0, 100),
      morale: clamp(s.culture.morale + 2, 0, 100),
    },
  }, shipCost), "ship");
  return withLogLines(updated, [
    { text: `Shipped feature: ${name}.` },
    ...freeShipLog,
    ...(imbalancePenalty > 0
      ? ([{ text: "You barely shipped it. The org is skewed toward GTM.", kind: "event" }] as const)
      : []),
    { text: `Reputation +${repGain}. ${arpuBump ? `ARPU +${arpuBump}.` : ""}` },
  ], "success");
};

export const launchCampaign = (state: GameState, name: string): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  const launchCost = getApCost(state, "launch");
  if (!canSpendAp(state, launchCost)) {
    return err(state, "No AP left. End the week to refresh.");
  }
  if (!name.trim()) {
    return err(state, "Launch what? Provide a campaign name.");
  }

  const spend = state.stage === "garage" ? 900 : state.stage === "seed" ? 1800 : 3500;
  if (state.cash < spend) {
    return err(state, "Not enough cash to launch a campaign.");
  }

  const archetype = state.founder.archetype!;
  const mods = founderMods[archetype];
  const stressPenalty = successPenaltyFromStress(state);

  const mkt = state.team.marketing;
  const sales = state.team.sales;
  const hr = state.team.hr;
  const legal = state.team.legal;
  const rep = clamp(state.reputation / 100, 0, 1);
  const processDrag = hr * 0.006;
  const efficiencyBoost = legal * 0.008;
  const base = 0.55 + mkt * 0.05 + sales * 0.03 + rep * 0.08 + mods.launchSuccess - stressPenalty - processDrag + efficiencyBoost;
  const p = clamp(base, 0.04, 0.9);

  let s = { ...state, cash: state.cash - spend };
  const ok = chance(s.rng, p);
  s = { ...s, rng: ok.rng };

  const vol = clamp(s.volatility / 100, 0, 1);
  const swing = signedUnit(s.rng);
  s = { ...s, rng: swing.rng };

  const magnitude = 1 + vol * 1.2;
  const userDelta = Math.round((40 + mkt * 35 + sales * 20) * magnitude * (0.6 + Math.max(0, swing.value)));

  const freeLaunchLog = launchCost === 0 ? [{ text: "Visionary perk: first launch of the week is free.", kind: "event" as const }] : [];

  if (!ok.value) {
    const repLoss = 1 + Math.floor((1 + vol) * (0.3 + Math.max(0, -swing.value)) * 3);
    const failPick = pickMsg(s.rng, launchFailMessages);
    s = { ...s, rng: failPick.rng };
    const updated = markFreeActionUsed(spendAp({
      ...s,
      reputation: clamp(s.reputation - repLoss, 0, 100),
      users: Math.max(0, s.users + Math.round(userDelta * 0.2)),
      burn: calcBurn(s),
    }, launchCost), "launch");
    return withLogLines(updated, [
      { text: `Campaign "${name}" launched.` },
      ...freeLaunchLog,
      { text: failPick.msg, kind: "event" },
      { text: `Cash -$${spend.toLocaleString()}. Users +${Math.round(userDelta * 0.2)}. Reputation -${repLoss}.`, kind: "event" },
    ], "fail");
  }

  const updated = markFreeActionUsed(spendAp({
    ...s,
    users: Math.max(0, s.users + userDelta),
    reputation: clamp(s.reputation + 1, 0, 100),
    burn: calcBurn(s),
  }, launchCost), "launch");

  return withLogLines(updated, [
    { text: `Campaign "${name}" launched.` },
    ...freeLaunchLog,
    { text: `Cash -$${spend.toLocaleString()}. Users +${userDelta}.`, kind: "system" },
  ], "success");
};

export const pitchInvestors = (state: GameState): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  const pitchCost = getApCost(state, "pitch");
  if (!canSpendAp(state, pitchCost)) {
    return err(state, "No AP left. End the week to refresh.");
  }

  const p = pitch(state);
  const updated = markFreeActionUsed(spendAp(p.state, pitchCost), "pitch");
  const freePitchLog = pitchCost === 0 ? [{ text: "Sales Animal perk: first pitch of the week is free.", kind: "system" as const }] : [];
  return withLogLines(updated, [...freePitchLog, ...p.logs.map((t) => ({ text: t, kind: "system" as const }))], p.ok ? "success" : "fail");
};

export const raiseSeed = (state: GameState, amount: number): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  const vcCost = getApCost(state, "raise-vc");
  if (!canSpendAp(state, vcCost)) {
    return err(state, `Not enough AP. raise vc costs ${vcCost} AP.`);
  }
  if (amount <= 0) {
    return err(state, "Raise amount must be positive.");
  }

  const r = raise(state, amount);
  const updated = spendAp({ ...r.state, burn: calcBurn(r.state) }, vcCost);
  return withLogLines(updated, r.logs.map((t) => ({ text: t, kind: "event" })), r.ok ? "cash-in" : "fail");
};

export const choose = (state: GameState, choiceIndex: number): ActionResult => {
  if (state.gameOver) {
    return err(state, "Game over.");
  }
  if (!state.pendingEvent) {
    return err(state, "No pending event.");
  }
  const ctx = computeContext(state);
  const result = applyPendingEventChoice(state, ctx, choiceIndex);

  // Re-evaluate endings after consequences.
  const end = evaluateEndings(result.state, computeContext(result.state));
  const lines = [...result.logs, ...end.logs].map((t) => ({ text: t, kind: "event" as const }));
  return withLogLines(end.state, lines);
};

export const endWeek = (state: GameState): ActionResult => {
  const tick = endWeekTick(state);

  const eventPrefixes = ["EVENT:", "1)", "2)", "3)", "Type `choose"];
  const isEventLine = (text: string): boolean => eventPrefixes.some((prefix) => text.startsWith(prefix));

  // Heuristically mark EVENT block as event-kind.
  const lines: Array<{ text: string; kind?: LogEntry["kind"] }> = tick.logs.map((t) => ({
    text: t,
    kind: isEventLine(t) ? "event" : "system",
  }));
  return withLogLines({ ...tick.state, seedLocked: true }, lines);
};

export const status = (state: GameState): ActionResult => {
  const runway = calcRunwayWeeks(state);
  const founder = state.founder.archetype ?? "(unpicked)";
  const cofounder = state.cofounder.archetype ?? "(unpicked)";
  const pipeline = state.investors.pipeline.length;

  const founderOwnershipPct = Math.round(state.capTable.founderPct * 100);
  const lastRoundSummary = state.lastRound
    ? `Last +$${state.lastRound.amount.toLocaleString()} @ $${state.lastRound.preMoney.toLocaleString()} pre (dilution ${Math.round(state.lastRound.dilutionPct * 100)}%)`
    : "No priced rounds";

  const fTldr = founderTldr(state.founder.archetype);
  const cTldr = cofounderTldr(state.cofounder.archetype);
  const tldrBlock =
    (fTldr ? `\nFounder TL;DR: ${fTldr}` : "") +
    (cTldr ? `\nCofounder TL;DR: ${cTldr}` : "");

  const line =
    `${state.companyName} | ${state.founder.name}` +
    `\nWeek ${state.week} | Cash $${state.cash.toLocaleString()} | Burn $${state.burn.toLocaleString()} | Runway ${runway}w` +
    `\nDebt $${state.debtOutstanding.toLocaleString()} | DebtSvc $${state.debtService.toLocaleString()}/wk` +
    `\nValuation ~$${state.valuation.toLocaleString()}` +
    `\nOwnership Founder ${founderOwnershipPct}% | ${lastRoundSummary}` +
    `\nMRR $${state.mrr.toLocaleString()} | Users ${state.users.toLocaleString()} | ARPU $${state.arpu}` +
    `\nStage ${state.stage} | Phase ${state.companyPhase} | Founder ${founder} | Thesis ${state.thesis}` +
    `\nAP ${state.ap} | Rep ${state.reputation}/100 | VC ${state.vcReputation}/100 | Stress ${state.stress}/100 | Vol ${state.volatility}/100` +
    `\nCofounder ${state.cofounder.name} (${cofounder}) | Trust ${state.cofounder.trust}/100 | Ego ${state.cofounder.ego}/100` +
    `\nCohesion ${state.culture.cohesion}/100 | Morale ${state.culture.morale}/100` +
    `\nInvestor leads: ${pipeline}` +
    tldrBlock;

  return withLogLines(state, [{ text: line, kind: "system" }]);
};
