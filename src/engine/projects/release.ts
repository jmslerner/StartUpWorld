import type { Build, Employee, GameState, ReceptionTier, Release, SoundHint } from "../../types/game";
import { RELEASE_LOG_MAX } from "../tycoon/constants";
import type { Line } from "../tycoon/kit";
import { assignEmployee, creditRelease, emptyProduct, leadOf, patchEmployee, productRng, roleFit, setProduct, staffOf } from "../tycoon/roster";
import { PRICING_MODELS } from "../pricing";
import { signedUnit } from "../rng";
import { clamp } from "../utils";
import {
  ARPU_PCT_CAP, CRUFT_PER_UNIT, LATE_PENALTY, PREMIUM_ARPU_BY_PRICING, REP_CAP, RUSH_CRUFT_PER_UNIT, SIZES, TIER_SIDE, TYPES, USERS_PCT_CAP,
  VC_REP_CAP,
} from "./constants";
import {
  completeFactor, completeness, fitOf, luckAmplitude, payMultiplier, pct, qualityOf, round1, stressPenalty, tierOf, weeksLate,
} from "./work";

// The release (TYCOON-SPEC §4.8, §5.5): one roll on product.rng, the payoff, the mess, the credit. Never touches state.rng.

const TIER_LINES: Record<ReceptionTier, string[]> = {
  breakout: [
    "Strangers are explaining your product to each other. Correctly.",
    "A competitor's PM screenshots it into their roadmap deck.",
    "Support asks if the dashboard is broken. It is not. That is just what up looks like.",
  ],
  solid: [
    "Support tickets go down. Nobody can explain it. Nobody tries.",
    "People use it without filing a ticket about it, which is the dream.",
    "Three strangers post about it without being asked.",
  ],
  shrug: [
    "Usage is 'directionally encouraging', which means flat.",
    "The changelog gets two likes. One is the intern.",
    "It works. People notice in the way people notice plumbing.",
  ],
  flop: [
    "The changelog has more upvotes than the feature.",
    "The launch tweet is quote-posted with a single emoji. Not a good one.",
    "Customers ask how to turn it off. There is no way to turn it off.",
  ],
};

export const TIER_SOUND: Record<ReceptionTier, SoundHint> = { breakout: "opportunity", solid: "success", shrug: "click", flop: "fail" };

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
/** Math.round without the -0 (a flop S's cohesion is round(-0.5) = 0, not -0). */
const rnd = (n: number): number => Math.round(n) || 0;

/** The reception of a release, given the luck it rolled (§5.5). Pure: the roll itself happens in `releaseBuild`. */
export interface Score {
  quality: number;
  c: number; // completeness
  fit: number;
  late: number; // weeks late
  stress: number;
  luck: number;
  reception: number;
  tier: ReceptionTier;
  m: number; // payoff multiplier
  u: number; // impact units actually delivered (units x C)
}

export const scoreRelease = (state: GameState, build: Build, luck: number): Score => {
  const c = completeness(build);
  const quality = qualityOf(state, build);
  const fit = fitOf(state, build.type);
  const late = weeksLate(build, state.week);
  const stress = stressPenalty(state);
  const reception = clamp(Math.round(quality * completeFactor(c) + fit - LATE_PENALTY * late - stress + luck), 0, 100);
  return { quality, c, fit, late, stress, luck, reception, tier: tierOf(reception), m: payMultiplier(reception), u: build.units * c };
};

/** The luck a release of `build` would roll from the given product stream value. */
export const rollLuck = (state: GameState, build: Build, rng: number): { rng: number; luck: number } => {
  const roll = signedUnit(rng);
  return { rng: roll.rng, luck: Math.round(roll.value * luckAmplitude(state, build.type)) };
};

export interface ReleaseOutcome {
  state: GameState;
  lines: Line[];
  sound: SoundHint;
  release: Release;
  score: Score;
}

/** The staffed members who get the credit: fit > 0 and joined before this week (parachuted stars get nothing). */
const creditable = (state: GameState, build: Build): Employee[] =>
  staffOf(state, build.id).filter((e) => roleFit(build.type, e.role) > 0 && e.joinedWeek < state.week);

/**
 * Applies a scored release: payoff in today's currencies (each capped), cruft, side effects by tier x size weight, the Release
 * record, credit and the lead's visibility, and everyone back to the day job. Pure, no RNG. The caller has checked the 60% rule,
 * AP and gating, and writes the product stream.
 */
export const applyRelease = (state: GameState, build: Build, score: Score): ReleaseOutcome => {
  const type = TYPES[build.type];
  const size = SIZES[build.size];
  const product = state.product ?? emptyProduct();
  const { quality, c, m, u, tier, reception } = score;
  const side = TIER_SIDE[tier];
  const w = size.weight;
  const members = creditable(state, build);
  const lead = leadOf({ ...state, people: state.people ? { ...state.people, roster: members } : state.people }, build);

  // Payoff, each capped per release. m = 0 (a flop) pays nothing and takes no users.
  const repGain = m > 0 ? Math.min(REP_CAP, rnd(type.rep * u * m)) : rnd(side.rep * w);
  const usersGain = m > 0 ? rnd(type.usersFlat * u * m) + rnd(state.users * Math.min(USERS_PCT_CAP, type.usersPct * u * m)) : 0;
  const pm = PRICING_MODELS[state.pricingModel];
  const headroom = pm.arpuMax > pm.arpuDefault ? clamp((pm.arpuMax - state.arpu) / (pm.arpuMax - pm.arpuDefault), 0, 1) : 0;
  const pricingMult = build.type === "premium" ? PREMIUM_ARPU_BY_PRICING[state.pricingModel] : 1;
  const arpuPct = m > 0 ? Math.min(ARPU_PCT_CAP, type.arpuPct * u * m * pricingMult * headroom) : 0;
  const carry = product.arpuCarry + state.arpu * arpuPct;
  const arpuWhole = Math.floor(carry + 1e-9);
  const nextArpu = clamp(state.arpu + arpuWhole, pm.arpuMin, pm.arpuMax);
  const nextCarry = clamp(carry - arpuWhole, 0, 0.999999);
  const moatGain = m > 0 ? type.moat * u * m : 0;
  const nextMoat = round1(clamp(product.moat + moatGain, 0, 100));
  const vcGain = m > 0 ? Math.min(VC_REP_CAP, rnd(type.vcRep * u * m)) : 0;

  // The mess: low quality and unfinished work leave cruft; plumbing pays it down.
  const cruftDelta = type.cruft < 0
    ? type.cruft * u * (0.5 + m)
    : CRUFT_PER_UNIT * build.units * (1 - quality / 100) + RUSH_CRUFT_PER_UNIT * build.units * (1 - c) + type.cruft * build.units;
  const nextCruft = round1(clamp(product.cruft + cruftDelta, 0, 100));

  const morale = rnd(side.morale * w);
  const cohesion = rnd(side.cohesion * w);
  const board = rnd(side.board * w);
  const trust = rnd(side.trust * w);
  const hasDirectors = state.board.members.some((d) => d.role !== "founder");

  const users = Math.max(0, state.users + usersGain);
  const release: Release = {
    id: build.id, name: build.name, type: build.type, size: build.size, week: state.week, reception, tier, quality, leadName: lead?.name ?? null,
  };

  let s: GameState = {
    ...state,
    reputation: clamp(state.reputation + repGain, 0, 100),
    vcReputation: clamp(state.vcReputation + vcGain, 0, 100),
    users,
    arpu: nextArpu,
    mrr: Math.max(0, Math.round(users * nextArpu)),
    volatility: clamp(state.volatility + type.volatility, 0, 100),
    culture: { cohesion: clamp(state.culture.cohesion + cohesion, 0, 100), morale: clamp(state.culture.morale + morale, 0, 100) },
    cofounder: trust === 0 ? state.cofounder : { ...state.cofounder, trust: clamp(state.cofounder.trust + trust, 0, 100) },
    board: board === 0 || !hasDirectors ? state.board : {
      ...state.board,
      members: state.board.members.map((d) => (d.role === "founder" ? d : { ...d, confidence: clamp(d.confidence + board, 0, 100) })),
    },
  };
  s = setProduct(s, {
    active: product.active.filter((b) => b.id !== build.id),
    shipped: [release, ...product.shipped].slice(0, RELEASE_LOG_MAX),
    shippedCount: product.shippedCount + 1,
    shippedByType: { ...product.shippedByType, [build.type]: product.shippedByType[build.type] + 1 },
    cruft: nextCruft,
    moat: nextMoat,
    arpuCarry: nextCarry,
  });

  // Credit (experience) only on a paying release; the lead among those members becomes visible on a SOLID or better.
  const credited = m > 0 ? members.map((e) => e.id) : [];
  s = creditRelease(s, credited);
  const famous = lead !== null && (tier === "solid" || tier === "breakout");
  if (lead && famous) s = patchEmployee(s, lead.id, { ledWeek: state.week });
  for (const e of staffOf(state, build.id)) s = assignEmployee(s, e.id, null);

  const flavour = TIER_LINES[tier][(reception + build.name.length) % TIER_LINES[tier].length];
  const parts = [`quality ${quality} x ${completeFactor(c).toFixed(2)} complete`, `fit ${signed(score.fit)}`, `luck ${signed(score.luck)}`, `stress -${score.stress}`];
  if (score.late > 0) parts.push(`late -${LATE_PENALTY * score.late}`);
  const effects: string[] = [];
  if (repGain !== 0) effects.push(`Reputation ${signed(repGain)}`);
  if (usersGain !== 0) effects.push(`Users ${signed(usersGain)}`);
  if (arpuWhole > 0) effects.push(`ARPU +$${nextArpu - state.arpu} → $${nextArpu}`);
  else if (arpuPct > 0) effects.push(`ARPU +$${(state.arpu * arpuPct).toFixed(2)} banked`);
  if (vcGain !== 0) effects.push(`VC rep ${signed(vcGain)}`);
  if (moatGain > 0) effects.push(`Moat +${round1(moatGain)} → ${nextMoat}`);
  effects.push(`Cruft ${signed(round1(nextCruft - product.cruft))} → ${nextCruft}`);
  if (morale !== 0) effects.push(`Morale ${signed(morale)}`);
  if (cohesion !== 0) effects.push(`Cohesion ${signed(cohesion)}`);
  if (board !== 0 && hasDirectors) effects.push(`Board ${signed(board)}`);

  const lines: Line[] = [
    { text: `Shipping ${build.name} — ${type.label} ${size.label}, ${pct(build)}% built, quality ${quality}.` },
    { text: "The deploy goes out. [[beat]] The team refreshes the dashboard. [[beat]] Then refreshes it again.", kind: "event" },
    { text: `RECEPTION ${reception}/100 — ${tier.toUpperCase()}. ${flavour}`, kind: "event" },
    { text: `  ${parts.join(" · ")}` },
    { text: `${effects.join(". ")}.`, kind: "event" },
  ];
  if (m <= 0) lines.push({ text: "It pays nothing. It also costs nothing you can't earn back." });
  if (lead && famous) lines.push({ text: `${lead.name} led it. Recruiters have noticed.` });
  if (credited.length > 0) {
    const others = credited.length - 1;
    lines.push({
      text: `${members[0].name}${others > 0 ? ` and ${others} other${others > 1 ? "s" : ""}` : ""} add${others > 0 ? "" : "s"} a line to their LinkedIn. (Experience +1: they build better here now.)`,
    });
  }
  return { state: s, lines, sound: TIER_SOUND[tier], release, score };
};

/** Ships a build: one luck roll on product.rng, then `applyRelease`. Never touches state.rng. */
export const releaseBuild = (state: GameState, build: Build): ReleaseOutcome => {
  const roll = rollLuck(state, build, productRng(state));
  const out = applyRelease(state, build, scoreRelease(state, build, roll.luck));
  return { ...out, state: setProduct(out.state, { rng: roll.rng }) };
};
