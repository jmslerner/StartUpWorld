import type { GameState, InvestorLead, InvestorTrend, Stage } from "../types/game";
import { clamp } from "./utils";
import { chance, nextFloat01, nextIntInclusive, signedUnit } from "./rng";
import { successPenaltyFromStress } from "./stress";
import { calcRunwayWeeks } from "./economy";
import { founderMods } from "./founders";
import { STAGE_VALUATION_FLOOR } from "./valuation";

const investorNames = [
  "Redwood Capital",
  "Halo Ventures",
  "Apex Partners",
  "Glasshouse",
  "NorthBridge",
  "Daybreak",
  "Metronome",
  "Citrine",
  "Signal Ridge",
  "Orchard",
  "Titan Seed",
  "Forklift Ventures",
];

const allTrends: InvestorTrend[] = ["ai", "crypto", "devtools", "consumer", "enterprise", "fintech", "biotech"];

const stageRaiseCaps: Record<Stage, { softCap: number; hardCap: number }> = {
  garage: { softCap: 250_000, hardCap: 1_000_000 },
  seed: { softCap: 2_500_000, hardCap: 6_000_000 },
  "series-a": { softCap: 12_000_000, hardCap: 30_000_000 },
  growth: { softCap: 60_000_000, hardCap: 250_000_000 },
};

const leadId = (state: GameState) => `lead-w${state.week}-n${state.logSeq}`;

export const pickTrend = (state: GameState, rng: number): { rng: number; trend: InvestorTrend } => {
  // Trend winds tilt toward your thesis, but not always.
  let r = rng;
  const tilt = nextFloat01(r);
  r = tilt.rng;
  if (tilt.value < 0.55) {
    return { rng: r, trend: state.thesis };
  }
  const idx = nextIntInclusive(r, 0, allTrends.length - 1);
  return { rng: idx.rng, trend: allTrends[idx.value] };
};

export const generateLead = (state: GameState): { state: GameState; lead: InvestorLead } => {
  let r = state.rng;
  const nameIdx = nextIntInclusive(r, 0, investorNames.length - 1);
  r = nameIdx.rng;
  const trendPick = pickTrend(state, r);
  r = trendPick.rng;
  const risk = nextIntInclusive(r, 15, 95);
  r = risk.rng;

  const lead: InvestorLead = {
    id: leadId(state),
    name: investorNames[nameIdx.value],
    riskTolerance: risk.value,
    trendBias: trendPick.trend,
    relationship: 35,
  };

  return { state: { ...state, rng: r }, lead };
};

export const pitch = (state: GameState): { state: GameState; logs: string[] } => {
  const logs: string[] = [];
  let s: GameState = state;

  const mods = s.founder.archetype ? founderMods[s.founder.archetype] : null;
  const runway = calcRunwayWeeks(s);

  // If pipeline is small, you usually get a new lead.
  // Desperation + attention can help when runway is short.
  const baseNewLeadChance = (s.investors.pipeline.length < 2 ? 0.75 : 0.45) + (runway <= 3 ? 0.08 : 0);
  let r = s.rng;
  const newLeadRoll = chance(r, baseNewLeadChance);
  r = newLeadRoll.rng;

  // Relationship drift upward on pitch.
  const pipeline = s.investors.pipeline.map((lead) => ({
    ...lead,
    relationship: clamp(lead.relationship + 4, 0, 100),
  }));

  s = { ...s, rng: r, investors: { pipeline } };

  if (newLeadRoll.value) {
    const gen = generateLead(s);
    s = gen.state;
    const nextPipeline = [gen.lead, ...s.investors.pipeline].slice(0, 6);
    s = { ...s, investors: { pipeline: nextPipeline } };
    logs.push(`Warm intro: ${gen.lead.name}. Trend bias: ${gen.lead.trendBias}.`);
  } else {
    logs.push("You pitch the usual circuit. Lots of nodding. Little commitment.");
  }

  // Pitch quality: traction + reputation - stress.
  const stressPenalty = successPenaltyFromStress(s);
  const traction = clamp(Math.log10(Math.max(10, s.mrr)) / 4, 0, 1); // 0..1-ish
  const rep = clamp(s.vcReputation / 100, 0, 1);

  const base = 0.22 + traction * 0.35 + rep * 0.18 - stressPenalty + (mods?.pitchSuccess ?? 0);
  const hype = signedUnit(s.rng);
  s = { ...s, rng: hype.rng };
  const p = clamp(base + hype.value * (s.volatility / 100) * 0.12, 0.02, 0.75);
  const yes = chance(s.rng, p);
  s = { ...s, rng: yes.rng };

  if (yes.value) {
    s = { ...s, vcReputation: clamp(s.vcReputation + 2, 0, 100) };
    logs.push("A partner leans in: \"Send the deck.\"");

    // Occasionally, a small angel check appears when you’re early and the vibe is right.
    const angelGate = chance(s.rng, s.stage === "garage" ? 0.38 : runway <= 2 ? 0.22 : 0);
    s = { ...s, rng: angelGate.rng };
    if (angelGate.value && !s.gameOver) {
      const size = nextIntInclusive(s.rng, 7_500, s.stage === "garage" ? 35_000 : 20_000);
      s = { ...s, rng: size.rng, cash: s.cash + size.value };
      logs.push(`An angel wires a SAFE: +$${size.value.toLocaleString()}.`);
    }
  } else {
    s = { ...s, vcReputation: clamp(s.vcReputation - 1, 0, 100) };
    logs.push("They pass for now. \"Come back with cleaner growth.\"");
  }

  return { state: s, logs };
};

const alignmentScore = (state: GameState, lead: InvestorLead): number => {
  if (lead.trendBias === state.thesis) return 1;
  // AI money hates non-AI right now.
  if (lead.trendBias === "ai") return 0.6;
  return 0.75;
};

const stageFromAmount = (state: GameState, amount: number): Stage => {
  const v = Math.max(state.valuation, STAGE_VALUATION_FLOOR[state.stage]);

  if (state.stage === "garage" && amount >= 500_000 && v >= 5_000_000) return "seed";
  if (state.stage === "seed" && amount >= 5_000_000 && v >= 25_000_000 && state.companyPhase !== "garage" && state.companyPhase !== "coworking") {
    return "series-a";
  }
  if (state.stage === "series-a" && amount >= 25_000_000 && v >= 150_000_000 && (state.companyPhase === "unicorn" || state.companyPhase === "public")) {
    return "growth";
  }
  return state.stage;
};

export const raise = (state: GameState, amount: number): { state: GameState; logs: string[] } => {
  const logs: string[] = [];
  let s = state;

  if (s.investors.pipeline.length === 0) {
    logs.push("You have no active investor leads. Try `pitch` first.");
    return { state: s, logs };
  }

  const caps = stageRaiseCaps[s.stage];
  if (amount > caps.hardCap) {
    logs.push(`That ask is delusional for ${s.stage}. Hard cap is ~$${caps.hardCap.toLocaleString()}.`);
    return { state: s, logs };
  }

  // If your valuation hasn't caught up, the market won't price you into a new stage.
  // Also penalize extreme asks relative to implied value.
  const impliedValuation = Math.max(s.valuation, STAGE_VALUATION_FLOOR[s.stage]);
  const askAsPctOfValue = impliedValuation > 0 ? amount / impliedValuation : 1;
  if (askAsPctOfValue >= 0.6) {
    const best = [...s.investors.pipeline].sort((a, b) => b.relationship - a.relationship)[0];
    s = {
      ...s,
      investors: {
        pipeline: s.investors.pipeline.map((l) =>
          l.id === best.id ? { ...l, relationship: clamp(l.relationship - 8, 0, 100) } : l
        ),
      },
      vcReputation: clamp(s.vcReputation - 3, 0, 100),
    };
    logs.push(`You push a $${amount.toLocaleString()} ask.`);
    logs.push(`They do the math. That's ~${Math.round(askAsPctOfValue * 100)}% of your implied value.`);
    logs.push("They pass instantly. \"Come back when the numbers are real.\"");
    return { state: s, logs };
  }

  let r = s.rng;
  const best = [...s.investors.pipeline].sort((a, b) => b.relationship - a.relationship)[0];

  const stressPenalty = successPenaltyFromStress(s);
  const traction = clamp(Math.log10(Math.max(10, s.mrr)) / 4, 0, 1);
  const rep = clamp(s.vcReputation / 100, 0, 1);
  const rel = clamp(best.relationship / 100, 0, 1);
  const align = alignmentScore(s, best);

  const askPressure = amount <= caps.softCap ? 0 : clamp((amount - caps.softCap) / (caps.hardCap - caps.softCap), 0, 1);
  const valuationAskPenalty = clamp((askAsPctOfValue - 0.18) / 0.32, 0, 1); // starts biting above ~18% of implied value

  // Core probability: dramatic but not coin-flippy.
  const base = 0.12 + traction * 0.45 + rep * 0.15 + rel * 0.25;
  const p = clamp(base * align - stressPenalty - askPressure * 0.25 - valuationAskPenalty * 0.22, 0.02, 0.8);

  // Volatility can both help and hurt.
  const swing = signedUnit(r);
  r = swing.rng;
  const p2 = clamp(p + swing.value * (s.volatility / 100) * 0.18, 0.01, 0.9);

  const ok = chance(r, p2);
  r = ok.rng;
  s = { ...s, rng: r };

  if (!ok.value) {
    s = {
      ...s,
      investors: {
        pipeline: s.investors.pipeline.map((l) =>
          l.id === best.id ? { ...l, relationship: clamp(l.relationship - 6, 0, 100) } : l
        ),
      },
      vcReputation: clamp(s.vcReputation - 2, 0, 100),
    };
    logs.push(`You push a $${amount.toLocaleString()} ask to ${best.name}.`);
    logs.push("They stall. Your lawyer sends three follow-ups. Silence.");
    return { state: s, logs };
  }

  const nextStage = stageFromAmount(s, amount);
  const dilution = clamp(Math.round(amount / 400_000), 1, 18);

  // Auto-repay debt from any successful investor raise.
  const debtBefore = Math.max(0, s.debtOutstanding);
  const debtServiceBefore = Math.max(0, s.debtService);
  const repaid = Math.min(amount, debtBefore);
  const debtAfter = Math.max(0, debtBefore - repaid);
  const debtServiceAfter = debtBefore > 0 ? Math.round(debtServiceBefore * (debtAfter / debtBefore)) : 0;
  const netCash = amount - repaid;

  s = {
    ...s,
    cash: s.cash + netCash,
    debtOutstanding: debtAfter,
    debtService: debtServiceAfter,
    stage: nextStage,
    vcReputation: clamp(s.vcReputation + 4 - dilution, 0, 100),
    reputation: clamp(s.reputation + 2, 0, 100),
    investors: {
      pipeline: s.investors.pipeline.filter((l) => l.id !== best.id),
    },
  };

  logs.push(`Term sheet signed with ${best.name}.`);
  if (repaid > 0) {
    logs.push(`Debt repaid: -$${repaid.toLocaleString()}. Debt left: $${debtAfter.toLocaleString()}.`);
    logs.push(`Debt service now: $${debtServiceAfter.toLocaleString()}/wk.`);
  }
  if (nextStage !== state.stage) {
    logs.push(`Cash +$${netCash.toLocaleString()}. Stage: ${state.stage} → ${nextStage}.`);
  } else {
    logs.push(`Cash +$${netCash.toLocaleString()}. Stage holds at ${state.stage}.`);
    logs.push("The money buys you time, not a new label.");
  }

  return { state: s, logs };
};

export const formatPipeline = (state: GameState): string[] => {
  if (state.investors.pipeline.length === 0) {
    return ["Investor pipeline: empty."];
  }
  return [
    "Investor pipeline:",
    ...state.investors.pipeline.map(
      (l, i) => `${i + 1}. ${l.name} | trend ${l.trendBias} | risk ${l.riskTolerance}/100 | rel ${l.relationship}/100`
    ),
  ];
};
