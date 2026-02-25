import type { ActionResult, FounderArchetype, GameState, LogEntry, TeamRole } from "../types/game";
import { appendLog } from "./logging";
import { clamp } from "./utils";
import { BASE_AP, calcBurn, calcRunwayWeeks, roleComp } from "./economy";
import { applyHiringCohesionHit } from "./culture";
import { isFounderChosen, setFounder, founderMods } from "./founders";
import { chance, signedUnit } from "./rng";
import { successPenaltyFromStress } from "./stress";
import { endWeekTick } from "./tick";
import { applyPendingEventChoice } from "./events/applyChoice";
import { computeContext } from "./context";
import { pitch, raise } from "./investors";
import { evaluateEndings } from "./endings";

const withLogLines = (state: GameState, lines: Array<{ text: string; kind?: LogEntry["kind"] }>): ActionResult => {
  const logs: LogEntry[] = [];
  let s = state;
  for (const line of lines) {
    s = appendLog(s, logs, line.text, line.kind ?? "system");
  }
  return { state: s, logs };
};

const err = (state: GameState, message: string): ActionResult => withLogLines(state, [{ text: message, kind: "error" }]);

export const createInitialState = (): GameState => {
  const seed = (Date.now() >>> 0) || 1;
  const base: GameState = {
    week: 1,
    ap: BASE_AP,
    cash: 20_000,
    users: 50,
    arpu: 10,
    mrr: 50 * 10,
    burn: 0,
    team: { engineering: 1, design: 0, marketing: 0, sales: 0, ops: 0 },
    reputation: 10,
    vcReputation: 8,
    stage: "garage",
    thesis: "ai",
    companyPhase: "garage",
    founder: { archetype: null },
    cofounder: { trust: 72, ego: 55, ambition: 76 },
    culture: { cohesion: 78, morale: 72 },
    stress: 18,
    volatility: 22,
    investors: { pipeline: [] },
    pendingEvent: null,
    gameOver: null,
    seed,
    rng: (seed ^ 0x9e3779b9) >>> 0,
    logSeq: 0,
    lastWeek: { users: 50, mrr: 50 * 10, cash: 20_000, teamSize: 1 },
  };

  const burn = calcBurn(base);
  return { ...base, burn };
};

export const canSpendAp = (state: GameState, cost = 1): boolean => state.ap >= cost;

export const spendAp = (state: GameState, cost = 1): GameState => ({ ...state, ap: Math.max(0, state.ap - cost) });

const ensurePlayable = (state: GameState): ActionResult | null => {
  if (state.gameOver) {
    return err(state, "Game over. (Restart command coming soon.)");
  }
  if (state.pendingEvent) {
    return err(state, "Resolve the pending event first with `choose <n>`.");
  }
  if (!isFounderChosen(state)) {
    return err(state, "Choose your founder first: `founder visionary|hacker|sales-animal|philosopher`.");
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

  return withLogLines(updated, [
    { text: `Founder locked: ${archetype}.`, kind: "system" },
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

  return withLogLines(updated, lines);
};

export const shipFeature = (state: GameState, name: string): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  if (!canSpendAp(state)) {
    return err(state, "No AP left. End the week to refresh.");
  }
  if (!name.trim()) {
    return err(state, "Ship what? Provide a feature name.");
  }

  const archetype = state.founder.archetype!;
  const mods = founderMods[archetype];
  const stressPenalty = successPenaltyFromStress(state);

  const eng = state.team.engineering;
  const cohesion = clamp(state.culture.cohesion / 100, 0, 1);
  const base = 0.68 + eng * 0.03 + cohesion * 0.08 + mods.shipSuccess - stressPenalty;
  const p = clamp(base, 0.05, 0.92);

  let s = state;
  const roll = chance(s.rng, p);
  s = { ...s, rng: roll.rng };

  const vol = clamp(s.volatility / 100, 0, 1);
  const swing = signedUnit(s.rng);
  s = { ...s, rng: swing.rng };

  if (!roll.value) {
    const repLoss = Math.max(1, Math.round((2 + vol * 3) * (0.7 + Math.max(0, -swing.value))));
    const updated: GameState = spendAp({
      ...s,
      reputation: clamp(s.reputation - repLoss, 0, 100),
      culture: {
        cohesion: clamp(s.culture.cohesion - 2, 0, 100),
        morale: clamp(s.culture.morale - 4, 0, 100),
      },
    });
    return withLogLines(updated, [
      { text: `Tried to ship: ${name}.` },
      { text: "It’s not ready. You ship anyway. It’s a mess.", kind: "event" },
      { text: `Reputation -${repLoss}. Morale -4. Cohesion -2.`, kind: "event" },
    ]);
  }

  const repGain = Math.max(1, Math.round((2 + eng) * (0.55 + vol * 0.9 + Math.max(0, swing.value) * 0.6)));
  const arpuBump = Math.max(0, Math.round((Math.max(0, swing.value) * vol) * 2));
  const updated: GameState = spendAp({
    ...s,
    reputation: clamp(s.reputation + repGain, 0, 100),
    arpu: clamp(s.arpu + arpuBump, 2, 99),
    culture: {
      cohesion: clamp(s.culture.cohesion + 1, 0, 100),
      morale: clamp(s.culture.morale + 2, 0, 100),
    },
  });
  return withLogLines(updated, [
    { text: `Shipped feature: ${name}.` },
    { text: `Reputation +${repGain}. ${arpuBump ? `ARPU +${arpuBump}.` : ""}` },
  ]);
};

export const launchCampaign = (state: GameState, name: string): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  if (!canSpendAp(state)) {
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
  const rep = clamp(state.reputation / 100, 0, 1);
  const base = 0.55 + mkt * 0.05 + sales * 0.03 + rep * 0.08 + mods.launchSuccess - stressPenalty;
  const p = clamp(base, 0.04, 0.9);

  let s = { ...state, cash: state.cash - spend };
  const ok = chance(s.rng, p);
  s = { ...s, rng: ok.rng };

  const vol = clamp(s.volatility / 100, 0, 1);
  const swing = signedUnit(s.rng);
  s = { ...s, rng: swing.rng };

  const magnitude = 1 + vol * 1.2;
  const userDelta = Math.round((40 + mkt * 35 + sales * 20) * magnitude * (0.6 + Math.max(0, swing.value)));

  if (!ok.value) {
    const repLoss = 1 + Math.floor((1 + vol) * (0.3 + Math.max(0, -swing.value)) * 3);
    const updated = spendAp({
      ...s,
      reputation: clamp(s.reputation - repLoss, 0, 100),
      users: Math.max(0, s.users + Math.round(userDelta * 0.2)),
      burn: calcBurn(s),
    });
    return withLogLines(updated, [
      { text: `Campaign "${name}" launched.` },
      { text: "It flops in public. Private, too.", kind: "event" },
      { text: `Cash -$${spend.toLocaleString()}. Users +${Math.round(userDelta * 0.2)}. Reputation -${repLoss}.`, kind: "event" },
    ]);
  }

  const updated = spendAp({
    ...s,
    users: Math.max(0, s.users + userDelta),
    reputation: clamp(s.reputation + 1, 0, 100),
    burn: calcBurn(s),
  });

  return withLogLines(updated, [
    { text: `Campaign "${name}" launched.` },
    { text: `Cash -$${spend.toLocaleString()}. Users +${userDelta}.`, kind: "system" },
  ]);
};

export const pitchInvestors = (state: GameState): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  if (!canSpendAp(state)) {
    return err(state, "No AP left. End the week to refresh.");
  }

  const p = pitch(state);
  const updated = spendAp(p.state);
  return withLogLines(updated, p.logs.map((t) => ({ text: t, kind: "system" })));
};

export const raiseSeed = (state: GameState, amount: number): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  if (amount <= 0) {
    return err(state, "Raise amount must be positive.");
  }

  const r = raise(state, amount);
  const updated = { ...r.state, burn: calcBurn(r.state) };
  return withLogLines(updated, r.logs.map((t) => ({ text: t, kind: "event" })));
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
  return withLogLines(tick.state, lines);
};

export const status = (state: GameState): ActionResult => {
  const runway = calcRunwayWeeks(state);
  const founder = state.founder.archetype ?? "(unpicked)";
  const pipeline = state.investors.pipeline.length;

  const line =
    `Week ${state.week} | Cash $${state.cash.toLocaleString()} | Burn $${state.burn.toLocaleString()} | Runway ${runway}w` +
    `\nMRR $${state.mrr.toLocaleString()} | Users ${state.users.toLocaleString()} | ARPU $${state.arpu}` +
    `\nStage ${state.stage} | Phase ${state.companyPhase} | Founder ${founder} | Thesis ${state.thesis}` +
    `\nAP ${state.ap} | Rep ${state.reputation}/100 | VC ${state.vcReputation}/100 | Stress ${state.stress}/100 | Vol ${state.volatility}/100` +
    `\nTrust ${state.cofounder.trust}/100 | Ego ${state.cofounder.ego}/100 | Cohesion ${state.culture.cohesion}/100 | Morale ${state.culture.morale}/100` +
    `\nInvestor leads: ${pipeline}`;

  return withLogLines(state, [{ text: line, kind: "system" }]);
};
