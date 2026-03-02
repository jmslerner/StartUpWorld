import type { GameState, InvestorLead, InvestorTrend, Stage } from "../types/game";
import { clamp } from "./utils";
import { chance, nextFloat01, nextIntInclusive, signedUnit } from "./rng";
import { successPenaltyFromStress } from "./stress";
import { calcRunwayWeeks } from "./economy";
import { founderMods } from "./founders";
import { STAGE_VALUATION_FLOOR } from "./valuation";
import { computeContext } from "./context";
import { STAGE_PERKS } from "./stagePerks";
import { addBoardMember } from "./board";

const pitchFailMessages = [
  "They pass for now. \"Come back with cleaner growth.\"",
  "They say 'interesting.' [[beat]] In VC, 'interesting' means no.",
  "The partner checks their phone during your demo. Twice.",
  "They loved the vision. They hated the numbers. [[beat]] The numbers win.",
  "'We're not investing right now.' (They invested in your competitor yesterday.)",
  "They ask about your moat. You describe a puddle. [[beat]] Meeting over.",
  "'Love the team. Hate the TAM.' [[beat]] Translation: your market is too small for their fund.",
  "The associate nods aggressively for 45 minutes. [[beat]] You never hear from them again.",
  "They want to see 'more traction.' [[beat]] You need money to get traction. The circle of startup life.",
  "'Can you come back in Q3?' [[beat]] It is Q3.",
  "The partner loved you. The partnership meeting did not.",
  "They pass, but offer to make an intro. [[beat]] The intro never comes.",
  "'We just invested in a competitor in the space.' [[beat]] They say it like an apology. It isn't.",
  "Mid-pitch, they ask: 'What happens if Google does this?' You don't have a good answer.",
  "Their body language says yes. Their email says 'pass with conviction.'",
  "They want unit economics. You have vibes and a Notion doc.",
  "'Strong pass.' [[beat]] You didn't know passes had adjectives.",
  "They say they'll 'follow the round.' [[beat]] Translation: call us when someone else leads.",
  "The meeting runs 15 minutes short. [[beat]] That's never good.",
  "'We love founders who've been through this before.' [[beat]] This is your first time.",
];

const pitchSuccessMessages = [
  "A partner leans in: \"Send the deck.\"",
  "They ask for a second meeting. [[beat]] Second meetings mean something.",
  "The partner says the magic words: \"I want to take this to the partnership.\"",
  "They start talking terms before you've even finished. [[beat]] Good sign.",
  "A partner nods slowly: \"This is the kind of thing we like.\"",
  "\"We've been looking for something exactly like this.\" [[beat]] Your heart rate doubles.",
  "They ask about your timeline. Investors only ask about timelines when they're interested.",
  "The meeting runs 30 minutes over. [[beat]] Nobody wants to leave.",
  "A partner pulls you aside after: \"Let me introduce you to my partner who leads this vertical.\"",
  "\"Your numbers are early, but the narrative is compelling.\" [[beat]] They request a data room.",
  "The energy in the room shifts. You can feel it. [[beat]] They're in.",
  "They ask what other firms are looking. [[beat]] FOMO is the most powerful force in venture.",
  "\"Don't sign anything until you talk to us.\" [[beat]] The power dynamic just flipped.",
  "You finish the demo. Silence. [[beat]] Then: \"How fast can you close?\"",
  "They share the deck with a colleague before you've left the building.",
];

const pitchNewLeadMessages = [
  "Warm intro lands. {name} ({trend} focus) takes the call.",
  "A mutual connection makes the intro to {name}. They're watching the {trend} space closely.",
  "Your name came up at a dinner. {name} reaches out. They invest in {trend}.",
  "{name} saw your tweet thread. They slide into the DMs. [[beat]] Trend bias: {trend}.",
  "A founder you helped last year returns the favor. Intro to {name} ({trend}).",
  "You run into {name} at a coffee shop. No, really. [[beat]] They're interested in {trend}.",
  "{name} heard your podcast clip. They want 30 minutes. Focus area: {trend}.",
  "An LP mentions your company to {name}. They call the next morning. Bias: {trend}.",
  "Your advisor opens a door: {name}, deep in {trend}, wants a first look.",
  "{name} cold-emails YOU. [[beat]] That never happens. Trend: {trend}.",
];

const pitchNoLeadMessages = [
  "You pitch the usual circuit. Lots of nodding. Little commitment.",
  "A dozen emails out. Three polite passes. Nine ghosts.",
  "You shake hands, exchange cards, and watch interest evaporate in the parking lot.",
  "The pitch goes fine. Fine is not a check.",
  "You do the circuit. People say 'exciting.' [[beat]] Nobody says 'yes.'",
  "Coffee meetings. Dinners. A demo day. [[beat]] Your pipeline stays the same size.",
  "Everyone loves the mission. Nobody loves the metrics. Yet.",
  "You deliver the pitch cleanly. The room smiles. [[beat]] Smiles don't wire money.",
  "Three meetings, three 'let me think about it's. [[beat]] Thinking is free. Runway is not.",
  "You work the room at a founder event. Lots of 'let's keep in touch.'",
];

const pickFrom = (rng: number, msgs: string[]): { rng: number; msg: string } => {
  const pick = nextIntInclusive(rng, 0, msgs.length - 1);
  return { rng: pick.rng, msg: msgs[pick.value] };
};

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

export const pitch = (state: GameState): { state: GameState; logs: string[]; ok: boolean } => {
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
    const leadMsg = pickFrom(s.rng, pitchNewLeadMessages);
    s = { ...s, rng: leadMsg.rng };
    logs.push(leadMsg.msg.replace("{name}", gen.lead.name).replace(/\{trend\}/g, gen.lead.trendBias));
  } else {
    const noLeadMsg = pickFrom(s.rng, pitchNoLeadMessages);
    s = { ...s, rng: noLeadMsg.rng };
    logs.push(noLeadMsg.msg);
  }

  // Pitch quality: traction + reputation + unit economics - stress.
  const ctx = computeContext(s);
  const stressPenalty = successPenaltyFromStress(s);
  const traction = clamp(Math.log10(Math.max(10, s.mrr)) / 4, 0, 1); // 0..1-ish
  const rep = clamp(s.vcReputation / 100, 0, 1);
  // LTV:CAC bonus: VCs love ratios > 3. Scales 0..0.12.
  const unitEconBonus = clamp((ctx.ltvCacRatio - 1) / 8, 0, 0.12);

  const stagePitchBonus = STAGE_PERKS[s.stage].pitchSuccessBonus;
  const base = 0.22 + traction * 0.35 + rep * 0.18 + unitEconBonus + stagePitchBonus - stressPenalty + (mods?.pitchSuccess ?? 0);
  const hype = signedUnit(s.rng);
  s = { ...s, rng: hype.rng };
  const p = clamp(base + hype.value * (s.volatility / 100) * 0.12, 0.02, 0.75);
  const yes = chance(s.rng, p);
  s = { ...s, rng: yes.rng };

  if (yes.value) {
    s = { ...s, vcReputation: clamp(s.vcReputation + 2, 0, 100) };
    const successMsg = pickFrom(s.rng, pitchSuccessMessages);
    s = { ...s, rng: successMsg.rng };
    logs.push(successMsg.msg);

    // Occasionally, a small angel check appears when you’re early and the vibe is right.
    const angelGate = chance(s.rng, s.stage === "garage" ? 0.38 : runway <= 2 ? 0.22 : 0);
    s = { ...s, rng: angelGate.rng };
    if (angelGate.value && !s.gameOver) {
      const size = nextIntInclusive(s.rng, 7_500, s.stage === "garage" ? 35_000 : 20_000);
      s = { ...s, rng: size.rng, cash: s.cash + size.value };
      logs.push(`An angel wires a SAFE: +$${size.value.toLocaleString()}.`);
    }
  } else {
    const fail = pickFrom(s.rng, pitchFailMessages);
    s = { ...s, rng: fail.rng, vcReputation: clamp(s.vcReputation - 1, 0, 100) };
    logs.push(fail.msg);
  }

  return { state: s, logs, ok: yes.value };
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

export const raise = (state: GameState, amount: number): { state: GameState; logs: string[]; ok: boolean } => {
  const logs: string[] = [];
  let s = state;

  if (s.investors.pipeline.length === 0) {
    logs.push("You have no active investor leads. Try `pitch` first.");
    return { state: s, logs, ok: false };
  }

  const caps = stageRaiseCaps[s.stage];
  if (amount > caps.hardCap) {
    logs.push(`That ask is delusional for ${s.stage}. Hard cap is ~$${caps.hardCap.toLocaleString()}.`);
    return { state: s, logs, ok: false };
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
    return { state: s, logs, ok: false };
  }

  let r = s.rng;
  const best = [...s.investors.pipeline].sort((a, b) => b.relationship - a.relationship)[0];

  const raiseCtx = computeContext(s);
  const stressPenalty = successPenaltyFromStress(s);
  const traction = clamp(Math.log10(Math.max(10, s.mrr)) / 4, 0, 1);
  const rep = clamp(s.vcReputation / 100, 0, 1);
  const rel = clamp(best.relationship / 100, 0, 1);
  const align = alignmentScore(s, best);
  // LTV:CAC bonus for raises too — strong unit economics close deals.
  const raiseUnitEconBonus = clamp((raiseCtx.ltvCacRatio - 1) / 8, 0, 0.1);

  const askPressure = amount <= caps.softCap ? 0 : clamp((amount - caps.softCap) / (caps.hardCap - caps.softCap), 0, 1);
  const valuationAskPenalty = clamp((askAsPctOfValue - 0.18) / 0.32, 0, 1); // starts biting above ~18% of implied value

  // Core probability: dramatic but not coin-flippy.
  const base = 0.12 + traction * 0.45 + rep * 0.15 + rel * 0.25 + raiseUnitEconBonus;
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
    return { state: s, logs, ok: false };
  }

  const nextStage = stageFromAmount(s, amount);

  // Price the round at impliedValuation as pre-money.
  // Post-money jumps immediately: this makes raises feel like real market repricing.
  const preMoney = impliedValuation;
  const postMoney = preMoney + amount;
  const dilutionPct = postMoney > 0 ? clamp(amount / postMoney, 0.01, 0.6) : 0.15;

  // Old "dilution" was a narrative proxy used to punish VC rep; keep a mild effect but
  // make it scale with actual dilution.
  const dilutionRepHit = clamp(Math.round(dilutionPct * 14), 1, 10);

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
    vcReputation: clamp(s.vcReputation + 6 - dilutionRepHit, 0, 100),
    reputation: clamp(s.reputation + 2, 0, 100),
    investors: {
      pipeline: s.investors.pipeline.filter((l) => l.id !== best.id),
    },
    capTable: {
      founderPct: clamp(s.capTable.founderPct * (1 - dilutionPct), 0, 1),
      investorPct: clamp(s.capTable.investorPct * (1 - dilutionPct) + dilutionPct, 0, 1),
    },
    totalRaised: s.totalRaised + amount,
    lastRound: {
      week: s.week,
      stage: s.stage,
      investorName: best.name,
      amount,
      preMoney,
      postMoney,
      dilutionPct,
    },
  };

  logs.push(`Term sheet signed with ${best.name}.`);
  logs.push(
    `Round priced: $${preMoney.toLocaleString()} pre / $${postMoney.toLocaleString()} post. Dilution: ${Math.round(
      dilutionPct * 100
    )}%.`
  );
  logs.push(`Founder ownership: ${Math.round(s.capTable.founderPct * 100)}%.`);
  if (repaid > 0) {
    logs.push(`Debt repaid: -$${repaid.toLocaleString()}. Debt left: $${debtAfter.toLocaleString()}.`);
    logs.push(`Debt service now: $${debtServiceAfter.toLocaleString()}/wk.`);
  }
  if (nextStage !== state.stage) {
    logs.push(`Cash +$${netCash.toLocaleString()}. Stage: ${state.stage} → ${nextStage}.`);
    for (const msg of STAGE_PERKS[nextStage].unlockMessages) {
      logs.push(msg);
    }
  } else {
    logs.push(`Cash +$${netCash.toLocaleString()}. Stage holds at ${state.stage}.`);
    logs.push("The money buys you time, not a new label.");
  }

  // Board formation and expansion on raises
  if (s.board.members.length === 0) {
    s = addBoardMember(s, "founder", "cheerleader");
    s = addBoardMember(s, "cofounder", "operator");
    s = addBoardMember(s, "investor");
    logs.push("Board formed: 3 seats — you, your cofounder, and an investor director.");
  }
  if (nextStage === "series-a" && state.stage !== "series-a") {
    s = addBoardMember(s, "investor");
    s = addBoardMember(s, "independent");
    logs.push("Board expanded: +1 investor seat, +1 independent. 5 total.");
  }
  if (nextStage === "growth" && state.stage !== "growth") {
    s = addBoardMember(s, "independent");
    logs.push("Board expanded: +1 independent director. 6 total.");
  }

  return { state: s, logs, ok: true };
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
