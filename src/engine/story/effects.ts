// Stat changes for the story pack, applied and described in one place so the effects line always matches the state.
// Never imports events/pool.ts (pool.ts imports the story events). Follows tycoonPool.ts: soft stats (users, reputation,
// VC rep, morale, cohesion, cofounder trust and ego) scale with volatility; cash, ARPU, board, leads, stress, volatility,
// cruft and moat do not. Costs are paid like tycoonPool's `pay`: never below 0, never by raising a negative balance.
// No RNG is drawn anywhere in here.
import type { GameState } from "../../types/game";
import { PRICING_MODELS } from "../pricing";
import { clamp } from "../utils";
import { impactMultiplier } from "../volatility";

export interface Fx {
  cash?: number; // dollars; negative is a cost paid from the bank
  users?: number; // fraction of current users (volatility-scaled)
  arpu?: number; // fraction of current ARPU, as whole dollars (at least $1 when non-zero), inside the pricing model's range
  rep?: number;
  vcRep?: number;
  board?: number; // confidence points on every director except the founder
  leads?: number; // relationship points on every investor lead in the pipeline
  morale?: number;
  cohesion?: number;
  trust?: number; // cofounder trust
  ego?: number; // cofounder ego
  stress?: number;
  volatility?: number;
  cruft?: number;
  moat?: number;
}

const scaled = (s: GameState, d: number): number => Math.round(d * impactMultiplier(s.volatility));
const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
export const usd = (n: number): string => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

/** A week of burn, floored so a tiny company still feels a cost: the unit story money is measured in. */
export const burnUnit = (s: GameState): number => Math.max(10_000, s.burn);

/** Rounds a story sum to a tidy figure ($1,000s above $10k, $100s below). */
export const money = (n: number): number => (Math.abs(n) >= 10_000 ? Math.round(n / 1000) * 1000 : Math.round(n / 100) * 100);

/** `money(burnUnit(s) * weeks)`. */
export const weeksOfBurn = (s: GameState, weeks: number): number => money(burnUnit(s) * weeks);

/** Pays a cost; returns what was actually paid. */
export const pay = (s: GameState, cost: number): { state: GameState; paid: number } => {
  const paid = Math.min(cost, Math.max(0, s.cash));
  return { state: paid > 0 ? { ...s, cash: s.cash - paid } : s, paid };
};

const cashPart = (cost: number, paid: number): string =>
  paid >= cost ? `Cash -${usd(cost)}.` : paid > 0 ? `Cash -${usd(paid)} (all there was).` : "No cash changes hands (there is none).";

const point = (v: number, d: number): number => clamp(v + d, 0, 100);

/** Applies `fx` and returns the house-style effects line ("Cash -$12,000. Morale -2."). */
export const applyFx = (s0: GameState, fx: Fx): { state: GameState; line: string } => {
  let s = s0;
  const parts: string[] = [];

  if (fx.cash && fx.cash < 0) {
    const cost = -fx.cash;
    const r = pay(s, cost);
    s = r.state;
    parts.push(cashPart(cost, r.paid));
  } else if (fx.cash && fx.cash > 0) {
    s = { ...s, cash: s.cash + fx.cash };
    parts.push(`Cash +${usd(fx.cash)}.`);
  }

  let mrrDirty = false;
  if (fx.users) {
    const d = Math.round(s.users * fx.users * impactMultiplier(s.volatility));
    if (d !== 0) {
      const next = Math.max(0, s.users + d);
      parts.push(`Users ${d > 0 ? "+" : "-"}${Math.abs(next - s.users).toLocaleString("en-US")}.`);
      s = { ...s, users: next };
      mrrDirty = true;
    }
  }
  if (fx.arpu) {
    const pm = PRICING_MODELS[s.pricingModel];
    const raw = Math.round(s.arpu * fx.arpu);
    const d = raw !== 0 ? raw : fx.arpu > 0 ? 1 : -1;
    const next = clamp(s.arpu + d, Math.min(pm.arpuMin, s.arpu), Math.max(pm.arpuMax, s.arpu));
    if (next !== s.arpu) {
      parts.push(`ARPU ${next > s.arpu ? "+" : "-"}${usd(Math.abs(next - s.arpu))} → ${usd(next)}.`);
      s = { ...s, arpu: next };
      mrrDirty = true;
    }
  }
  if (mrrDirty) s = { ...s, mrr: Math.max(0, Math.round(s.users * s.arpu)) };

  if (fx.rep) {
    s = { ...s, reputation: point(s.reputation, scaled(s, fx.rep)) };
    parts.push(`Reputation ${signed(fx.rep)}.`);
  }
  if (fx.vcRep) {
    s = { ...s, vcReputation: point(s.vcReputation, scaled(s, fx.vcRep)) };
    parts.push(`VC rep ${signed(fx.vcRep)}.`);
  }
  if (fx.board) {
    const d = fx.board;
    if (s.board.members.some((m) => m.role !== "founder")) {
      s = { ...s, board: { ...s.board, members: s.board.members.map((m) => (m.role === "founder" ? m : { ...m, confidence: point(m.confidence, d) })) } };
      parts.push(`Board confidence ${signed(d)}.`);
    }
  }
  if (fx.leads) {
    const d = fx.leads;
    if (s.investors.pipeline.length > 0) {
      s = { ...s, investors: { pipeline: s.investors.pipeline.map((l) => ({ ...l, relationship: point(l.relationship, d) })) } };
      parts.push(`Investor relationships ${signed(d)}.`);
    }
  }
  if (fx.morale) {
    s = { ...s, culture: { ...s.culture, morale: point(s.culture.morale, scaled(s, fx.morale)) } };
    parts.push(`Morale ${signed(fx.morale)}.`);
  }
  if (fx.cohesion) {
    s = { ...s, culture: { ...s.culture, cohesion: point(s.culture.cohesion, scaled(s, fx.cohesion)) } };
    parts.push(`Cohesion ${signed(fx.cohesion)}.`);
  }
  if (fx.trust) {
    s = { ...s, cofounder: { ...s.cofounder, trust: point(s.cofounder.trust, scaled(s, fx.trust)) } };
    parts.push(`Cofounder trust ${signed(fx.trust)}.`);
  }
  if (fx.ego) {
    s = { ...s, cofounder: { ...s.cofounder, ego: point(s.cofounder.ego, scaled(s, fx.ego)) } };
    parts.push(`Cofounder ego ${signed(fx.ego)}.`);
  }
  if (fx.stress) {
    s = { ...s, stress: point(s.stress, fx.stress) };
    parts.push(`Stress ${signed(fx.stress)}.`);
  }
  if (fx.volatility) {
    s = { ...s, volatility: point(s.volatility, fx.volatility) };
    parts.push(`Volatility ${signed(fx.volatility)}.`);
  }
  if (fx.cruft && s.product) {
    s = { ...s, product: { ...s.product, cruft: Math.round(point(s.product.cruft, fx.cruft) * 10) / 10 } };
    parts.push(`Cruft ${signed(fx.cruft)}.`);
  }
  if (fx.moat && s.product) {
    s = { ...s, product: { ...s.product, moat: Math.round(point(s.product.moat, fx.moat) * 10) / 10 } };
    parts.push(`Moat ${signed(fx.moat)}.`);
  }

  return { state: s, line: parts.join(" ") || "Nothing measurable changes." };
};

/** Small number words for prose ("nine weeks"); digits above twenty. */
export const numberWord = (n: number): string => {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  return n >= 0 && n <= 20 && Number.isInteger(n) ? words[n] : n.toLocaleString("en-US");
};

/** "$2.1 million", "$640,000", "$1.3 billion". */
export const moneyWords = (n: number): string => {
  const a = Math.abs(n);
  const one = (x: number): string => x.toFixed(1).replace(/\.0$/, "");
  if (a >= 1_000_000_000) return `$${one(n / 1_000_000_000)} billion`;
  if (a >= 1_000_000) return `$${one(n / 1_000_000)} million`;
  return usd(money(n));
};
