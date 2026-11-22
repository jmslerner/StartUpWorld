// Balance bots (TYCOON-SPEC §10.1), ported from the spec prototype's designs/spec-final/bots.ts to the real modules.
// Read-only use of the engine: every move is a typed command through executeCommand.
//
//   climber      competent legacy-only player (fundraises to climb, balanced org, launch/ship, best event choice)
//   skilled      climber + recruits, builds, staffing, crunch when late, polish to 6, retains leads and stars
//   naive        random unlocked type / affordable size, auto-staffed, ships when built; no recruit, retain, crunch
//   crunch       skilled with crunch always on          rush      skilled, ships at 60%
//   small        skilled, S builds only                 polish0   skilled, ships at 100% without polishing
//   no-retain / retain-lead / retain-all               skilled with a different retention rule
//   no-recruit   skilled with job-ad hires only         recruit-only  climber that also recruits, no builds
//   climber-ent / skilled-ent                          pivot to enterprise pricing in week 2
//   climber-con / skilled-con                          pivot to consumer pricing in week 2
//   late-staff   skilled, but parks idle people on the other build before a kickoff (so the new build is kicked off
//                with as few available people as possible, for a long due window) and staffs it right after (T7)
//   lead-dodge   no-retain, but a lead holding notice is `staff off`'d the week before they leave (T7)
//   naive-ship60 naive, but ships every build the moment it reaches 60% (the exploits review's rush trap; diagnostic, no band)
//   late-staff-cap  ORACLE, not a legal player: skilled, but every kickoff gets the longest due window the understaffed-
//                kickoff trick could ever buy (start + the size's windowMax), written straight into the state. It is the
//                ceiling of the §5.4 soft spot, measured because `late-staff` cannot empty the available pool (see ERRATA).
import { executeCommand } from "../../src/engine/commands";
import { createInitialState } from "../../src/engine/actions";
import { refreshDerivedNoLog } from "../../src/engine/derived";
import { STAGE_VALUATION_FLOOR } from "../../src/engine/valuation";
import { calcNetBurn } from "../../src/engine/economy";
import { SIZES, SLOTS } from "../../src/engine/projects/constants";
import { BUILD_SIZES, BUILD_TYPES } from "../../src/engine/tycoon/constants";
import { craftScore, leadOf, roleFit, rosterInvariantHolds, rosterOf, skillFactorOf, staffOf, standardSalary } from "../../src/engine/tycoon/roster";
import { completeness, etaWeeks, isBuilt, sizeUnlocked, typeUnlocked } from "../../src/engine/projects/work";
import { retainBonus } from "../../src/engine/people/rules";
import type { BuildSize, BuildType, GameState, PricingModel, Stage, TeamRole } from "../../src/types/game";

export type BotKind =
  | "stock" | "climber" | "skilled" | "naive" | "crunch" | "rush" | "small" | "polish0" | "no-retain" | "retain-lead"
  | "retain-all" | "no-recruit" | "recruit-only" | "climber-ent" | "skilled-ent" | "climber-con" | "skilled-con" | "late-staff" | "lead-dodge" | "late-staff-cap"
  | "naive-ship60";

export const ALL_BOTS: BotKind[] = [
  "climber", "skilled", "naive", "crunch", "rush", "small", "polish0", "no-retain", "retain-lead", "retain-all",
  "no-recruit", "recruit-only", "climber-ent", "skilled-ent", "climber-con", "skilled-con", "late-staff", "lead-dodge", "late-staff-cap",
  "naive-ship60",
];
const BUILDERS: BotKind[] = [
  "retain-all", "retain-lead", "skilled", "naive", "crunch", "rush", "small", "no-retain", "no-recruit", "skilled-ent", "skilled-con", "polish0",
  "late-staff", "lead-dodge", "late-staff-cap", "naive-ship60",
];
/** Bots that play builds like `naive` (random bet, auto-staff, no recruit / retain / crunch). */
const isNaive = (kind: BotKind): boolean => kind === "naive" || kind === "naive-ship60";
/** The pricing model a bot pivots to in week 2 (null: stays on the default prosumer). */
const pivotOf = (kind: BotKind): PricingModel | null =>
  kind === "climber-ent" || kind === "skilled-ent" ? "enterprise" : kind === "climber-con" || kind === "skilled-con" ? "consumer" : null;
const stageSoftCap: Record<Stage, number> = { garage: 250_000, seed: 2_500_000, "series-a": 12_000_000, growth: 60_000_000 };

// ── Command plumbing: every typed command goes through `cmd`; dry runs (event look-ahead) through `probe` ──

export interface Typed { input: string; before: GameState; after: GameState }
let journal: Typed[] | null = null;
/** Start (or stop, with null) journaling every typed command; used to record the playthrough fixture. */
export const setJournal = (j: Typed[] | null): void => { journal = j; };

const cmd = (s: GameState, input: string): GameState => {
  const after = executeCommand(s, input).state;
  if (journal) journal.push({ input, before: s, after });
  return after;
};
const probe = (s: GameState, input: string): GameState => executeCommand(s, input).state;

/** The commands whose results were kept, from the seeded start to `final` (rejected tries the bot threw away are dropped). */
export const keptCommands = (j: Typed[], start: GameState, final: GameState): string[] => {
  const byAfter = new Map<GameState, Typed>();
  for (const t of j) byAfter.set(t.after, t);
  const out: string[] = [];
  let cur = final;
  while (cur !== start) {
    const t = byAfter.get(cur);
    if (!t) throw new Error("journal chain broken");
    out.push(t.input);
    cur = t.before;
  }
  return out.reverse();
};

const teamSize = (s: GameState): number => Object.values(s.team).reduce((a, n) => a + n, 0);
export const runwayOf = (s: GameState): number => {
  const net = calcNetBurn(s);
  return net <= 0 ? 999 : Math.floor(s.cash / net);
};
const implied = (s: GameState): number => Math.max(s.valuation, STAGE_VALUATION_FLOOR[s.stage]);

// ── Event choices: try each option on a copy (the engine is pure), keep the best ──

const choiceValue = (before: GameState, after: GameState): number => {
  if (after.gameOver) return after.gameOver.ending === "ipo" ? 1000 : -1000;
  const board = (x: GameState) => x.board.members.reduce((a, m) => a + m.confidence, 0);
  return (
    Math.max(-6, Math.min(6, (after.cash - before.cash) / Math.max(4000, before.burn))) * 2 +
    ((after.users - before.users) / Math.max(50, before.users)) * 20 +
    (after.reputation - before.reputation) * 1 +
    (after.vcReputation - before.vcReputation) * 0.7 +
    (after.culture.morale - before.culture.morale) * 0.5 +
    (after.culture.cohesion - before.culture.cohesion) * 0.3 +
    (after.cofounder.trust - before.cofounder.trust) * 0.3 -
    (after.stress - before.stress) * 0.3 -
    (after.volatility - before.volatility) * 0.2 +
    (after.arpu - before.arpu) * 2 +
    (board(after) - board(before)) * 0.2 +
    (teamSize(after) - teamSize(before)) * 1 -
    ((after.product?.cruft ?? 0) - (before.product?.cruft ?? 0)) * 0.3
  );
};
const resolveEvent = (s: GameState, stock: boolean): GameState => {
  const ev = s.pendingEvent;
  if (!ev) return s;
  if (stock) return cmd(s, "choose 1");
  let best = 1;
  let bestV = -Infinity;
  for (let i = 1; i <= ev.choices.length; i++) {
    const v = choiceValue(s, probe(s, `choose ${i}`));
    if (v > bestV) { bestV = v; best = i; }
  }
  return cmd(s, `choose ${best}`);
};

// ── Legacy play ──

const pickHireRole = (s: GameState, competent: boolean): string => {
  const { engineering: eng, design, ops, marketing: mkt, sales } = s.team;
  const exec = eng + design + ops;
  const gtm = mkt + sales;
  if (gtm > exec) return ops < Math.ceil(gtm / 2) ? "ops" : "engineering";
  if (eng < 3) return "engineering";
  if (mkt < 2) return "marketing";
  if (sales < 2) return "sales";
  if (ops < 2) return "ops";
  if (competent) {
    if (design < 1) return "design";
    if (s.stage !== "garage" && s.team.data < 2) return "data";
    if ((s.stage === "series-a" || s.stage === "growth") && s.team.product < 2) return "product";
    if (s.stage === "growth" && s.team.executive < 3) return "executive";
  }
  return s.week % 2 === 0 ? "engineering" : "marketing";
};
const stageUpAsk = (s: GameState): number | null => {
  const v = implied(s);
  if (s.stage === "garage" && v >= 5_000_000) return 500_000;
  if (s.stage === "seed" && v >= 25_000_000 && s.companyPhase !== "garage" && s.companyPhase !== "coworking") return 5_000_000;
  if (s.stage === "series-a" && v >= 150_000_000 && (s.companyPhase === "unicorn" || s.companyPhase === "public")) return 25_000_000;
  return null;
};
const runwayAsk = (s: GameState): number => Math.min(stageSoftCap[s.stage], Math.max(50_000, Math.round((implied(s) * 0.15) / 1000) * 1000));

export interface Tally {
  builds: number; releases: number; receptionSum: number; tiers: Record<string, number>; bySize: Record<string, number>; byType: Record<string, number>;
  recruits: number; offers: number; retains: number; departures: number; crunchWeeks: number; lateShips: number; surprises: number; ageSum: number;
  dodges: number; invariantBreaks: number;
}
export const newTally = (): Tally => ({
  builds: 0, releases: 0, receptionSum: 0, tiers: {}, bySize: {}, byType: {}, recruits: 0, offers: 0, retains: 0, departures: 0,
  crunchWeeks: 0, lateShips: 0, surprises: 0, ageSum: 0, dodges: 0, invariantBreaks: 0,
});

const stockAction = (s: GameState): GameState => {
  const runway = s.burn > 0 ? Math.floor(s.cash / Math.max(1, s.burn)) : 999;
  if (runway <= 4) {
    if (s.investors.pipeline.length === 0) return cmd(s, "pitch");
    return cmd(s, `raise vc ${runwayAsk(s)}`);
  }
  if (s.investors.pipeline.length < 2 && s.week % 3 === 0) return cmd(s, "pitch");
  if (runway >= 8) {
    const after = cmd(s, `hire ${pickHireRole(s, false)} 1`);
    if (after.cash !== s.cash) return after;
  }
  return s.week % 2 === 1 ? cmd(s, `ship feature-w${s.week}-a${s.ap}`) : cmd(s, `launch campaign-w${s.week}`);
};

const legacyAction = (s0: GameState, useRecruit: boolean, tally: Tally): GameState => {
  let s = s0;
  const runway = runwayOf(s);
  const up = stageUpAsk(s);
  if (runway <= 6 || up !== null) {
    if (s.investors.pipeline.length === 0) return cmd(s, "pitch");
    const best = Math.max(...s.investors.pipeline.map((l) => l.relationship));
    if (runway > 3 && best < 45 && s.investors.pipeline.length < 3) return cmd(s, "pitch");
    if (s.ap >= 2) return cmd(s, `raise vc ${up ?? runwayAsk(s)}`);
    return cmd(s, "pitch");
  }
  if (s.investors.pipeline.length < 2 && s.week % 3 === 0) return cmd(s, "pitch");
  if (runway >= 8) {
    const role = pickHireRole(s, true) as TeamRole;
    const before = s.cash;
    if (useRecruit && (role === "engineering" || role === "design" || role === "product" || role === "data" || role === "marketing")) {
      const view = cmd(s, `recruit ${role}`);
      const list = view.people?.candidates[role] ?? [];
      // The bot only sees what the player sees: claimed stats when nobody vets, and the ask.
      let pick = -1;
      let bestVal = 1.03;
      list.forEach((c, i) => {
        const val = (skillFactorOf(c.claimedPace, c.claimedCraft) + 0.08 * (c.claimedCraft - 3) - (c.vetted ? 0 : 0.06)) / (c.ask / standardSalary(role));
        if (val > bestVal && c.claimedCraft >= 3) { bestVal = val; pick = i; }
      });
      if (pick >= 0) {
        const after = cmd(view, `recruit ${role} ${pick + 1}`);
        if (after.cash !== before) { tally.recruits += 1; return after; }
      }
      s = view;
    }
    const after = cmd(s, `hire ${role} 1`);
    if (after.cash !== before) return after;
  }
  if (s.week % 2 === 0) {
    const after = cmd(s, `launch campaign-w${s.week}`);
    if (after.ap !== s.ap || after.cash !== s.cash) return after;
  }
  return cmd(s, `ship patch-w${s.week}-a${s.ap}`);
};

// ── Product play ──

const chooseBuild = (s: GameState, n: number, kind: BotKind, r: () => number): { type: BuildType; size: BuildSize } | null => {
  const product = s.product!;
  const types = BUILD_TYPES.filter((t) => typeUnlocked(s, t));
  const sizes = BUILD_SIZES.filter((z) => sizeUnlocked(s, z));
  if (isNaive(kind)) {
    const affordable = sizes.filter((z) => s.cash >= SIZES[z].kickoff * 2);
    if (affordable.length === 0) return null;
    return { type: types[Math.floor(r() * types.length)], size: affordable[Math.floor(r() * affordable.length)] };
  }
  let type: BuildType = "feature";
  if (product.cruft >= 25) type = "plumbing";
  else {
    const cycle: BuildType[] = s.pricingModel === "enterprise" ? ["feature", "premium", "feature", "premium", "growth"] : ["feature", "growth", "feature", "premium", "feature", "moonshot"];
    type = cycle[n % cycle.length];
    if (!typeUnlocked(s, type)) type = "feature";
    if (type === "growth" && s.team.marketing + s.team.data < 1) type = "feature";
  }
  const idle = rosterOf(s).filter((e) => e.buildId === null && roleFit(type, e.role) >= 0.5).length;
  if (idle < 1 && teamSize(s) > 10) return null;
  const order: BuildSize[] = kind === "small" ? ["s"] : ["xl", "l", "m", "s"];
  for (const size of order) {
    if (!sizeUnlocked(s, size)) continue;
    const cfg = SIZES[size];
    if (s.cash < cfg.kickoff * 4) continue;
    if (idle >= Math.max(1, cfg.seats - 1)) return { type, size };
  }
  return { type, size: "s" };
};

/** late-staff: park idle people who fit `type` on the other active builds, so the new build kicks off nearly unstaffed. */
const parkIdle = (s0: GameState, type: BuildType): { state: GameState; parked: string[] } => {
  let s = s0;
  const parked: string[] = [];
  for (const other of s.product!.active) {
    for (const e of rosterOf(s)) {
      if (e.buildId !== null || e.offerDueWeek > 0 || roleFit(type, e.role) <= 0 || roleFit(other.type, e.role) <= 0) continue;
      if (staffOf(s, other.id).length >= SIZES[other.size].seats) break;
      const after = cmd(s, `staff ${other.slug} ${e.id}`);
      if (after !== s && rosterOf(after).find((x) => x.id === e.id)?.buildId === other.id) { s = after; parked.push(e.id); }
    }
  }
  return { state: s, parked };
};

const productPhase = (s0: GameState, kind: BotKind, tally: Tally, r: () => number): GameState => {
  let s = s0;
  const skilledStaffing = !isNaive(kind);
  // Offers first: keep leads and stars, wave the rest.
  if (!isNaive(kind) && kind !== "no-retain" && kind !== "lead-dodge") {
    for (const e of rosterOf(s)) {
      if (e.offerDueWeek === 0 || s.ap < 1 || s.pendingEvent) continue;
      const b = s.product!.active.find((x) => x.id === e.buildId);
      const isLead = b ? leadOf(s, b)?.id === e.id : false;
      const midBuild = Boolean(b && isLead && completeness(b) >= 0.3 && SIZES[b.size].weight >= 1);
      const worth = kind === "retain-all" ? true : kind === "retain-lead" ? midBuild || (e.shipped >= 2 && e.craft >= 4) : isLead || e.craft >= 4 || e.pace + e.craft >= 8;
      if (worth && s.cash >= retainBonus(e) * 4 && runwayOf(s) >= 5) {
        const after = cmd(s, `retain ${e.id}`);
        if (after.ap !== s.ap) { tally.retains += 1; s = after; }
      }
    }
  }
  // lead-dodge: un-staff a lead holding notice in the week before they walk.
  if (kind === "lead-dodge") {
    for (const e of rosterOf(s)) {
      if (e.offerDueWeek === 0 || e.buildId === null || e.offerDueWeek - s.week !== 1) continue;
      const b = s.product!.active.find((x) => x.id === e.buildId);
      if (!b || leadOf(s, b)?.id !== e.id) continue;
      const after = cmd(s, `staff off ${e.id}`);
      if (after !== s) { tally.dodges += 1; s = after; }
    }
  }
  for (const b0 of [...s.product!.active]) {
    if (s.gameOver || s.pendingEvent) return s;
    const b = s.product!.active.find((x) => x.id === b0.id);
    if (!b) continue;
    const runway = runwayOf(s);
    const c = completeness(b);
    const done = isBuilt(b);
    const polishTarget = isNaive(kind) || kind === "polish0" || kind === "rush" ? 0 : 6;
    const wantShip = kind === "naive" ? done
      : kind === "naive-ship60" ? c >= 0.6
      : (kind === "rush" && c >= 0.6) ||
        (done && (b.polish >= polishTarget || s.week >= b.dueWeek || runway <= 5)) ||
        (c >= 0.6 && (s.week > b.dueWeek + 1 || runway <= 3));
    if (wantShip && s.ap >= 1) {
      const before = s;
      s = cmd(s, `ship ${b.slug}`);
      const rel = s.product!.shipped[0];
      if (s.product!.shippedCount > before.product!.shippedCount && rel) {
        tally.releases += 1;
        tally.receptionSum += rel.reception;
        tally.tiers[rel.tier] = (tally.tiers[rel.tier] ?? 0) + 1;
        tally.bySize[b.size] = (tally.bySize[b.size] ?? 0) + 1;
        tally.byType[b.type] = (tally.byType[b.type] ?? 0) + 1;
        tally.crunchWeeks += b.crunchWeeks;
        tally.surprises += b.surprises;
        tally.ageSum += before.week - b.startedWeek;
        if (before.week > b.dueWeek) tally.lateShips += 1;
      }
      continue;
    }
    // Staffing (free).
    const seats = SIZES[b.size].seats;
    if (skilledStaffing) {
      // Put the most careful idle person on it as lead if they beat the current one.
      const lead = leadOf(s, b);
      const best = rosterOf(s)
        .filter((e) => e.buildId === null && roleFit(b.type, e.role) >= 0.8)
        .sort((x, y) => craftScore(y) - craftScore(x) || y.pace - x.pace)[0];
      if (best && (!lead || craftScore(best) > craftScore(lead))) {
        if (staffOf(s, b.id).length >= seats) {
          const weakest = staffOf(s, b.id).sort((x, y) => craftScore(x) - craftScore(y) || x.pace - y.pace)[0];
          if (weakest && craftScore(weakest) < craftScore(best)) s = cmd(s, `staff off ${weakest.id}`);
        }
        if (staffOf(s, b.id).length < seats) s = cmd(s, `staff ${b.slug} ${best.id}`);
      }
    }
    if (staffOf(s, b.id).length < seats) s = cmd(s, `staff ${b.slug} auto`);
    const cur = s.product!.active.find((x) => x.id === b.id);
    if (!cur || isNaive(kind)) continue;
    const staffNow = staffOf(s, cur.id);
    const minEnergy = staffNow.reduce((a, e) => Math.min(a, e.energy), 100);
    if (kind === "crunch") {
      if (!cur.crunch && !isBuilt(cur)) s = cmd(s, `build crunch ${cur.slug}`);
      continue;
    }
    const eta = etaWeeks(s, cur);
    const left = cur.dueWeek - s.week;
    if (cur.crunch && (minEnergy < 50 || isBuilt(cur))) { s = cmd(s, `build crunch ${cur.slug} off`); continue; }
    if (!isBuilt(cur) && !cur.crunch && eta !== null && eta > left && minEnergy >= 70 && staffNow.length > 0) s = cmd(s, `build crunch ${cur.slug}`);
  }
  const p2 = s.product!;
  if (!s.gameOver && !s.pendingEvent && p2.active.length < SLOTS[s.companyPhase] && s.ap >= 1 && runwayOf(s) >= 6) {
    const pick = chooseBuild(s, tally.builds, kind, r);
    if (pick) {
      let pre = s;
      let parked: string[] = [];
      if (kind === "late-staff" && p2.active.length > 0) ({ state: pre, parked } = parkIdle(s, pick.type));
      const after = cmd(pre, `build ${pick.type} ${pick.size}`);
      if (after.product!.active.length > p2.active.length) {
        tally.builds += 1;
        s = after;
        if (kind === "late-staff-cap") {
          const fresh = s.product!.active[s.product!.active.length - 1];
          const due = fresh.startedWeek + SIZES[fresh.size].windowMax;
          if (due > fresh.dueWeek) tally.dodges += 1;
          s = { ...s, product: { ...s.product!, active: s.product!.active.map((b) => (b.id === fresh.id ? { ...b, dueWeek: Math.max(b.dueWeek, due) } : b)) } };
        }
        if (kind === "late-staff") {
          const fresh = s.product!.active[s.product!.active.length - 1];
          // Probe bookkeeping: `dodges` counts kickoffs that went out short of a full crew (the soft spot it probes).
          if (staffOf(s, fresh.id).length < SIZES[fresh.size].seats) tally.dodges += 1;
          for (const id of parked) s = cmd(s, `staff ${fresh.slug} ${id}`);
          if (staffOf(s, fresh.id).length < SIZES[fresh.size].seats) s = cmd(s, `staff ${fresh.slug} auto`);
        }
      }
    }
  }
  return s;
};

const usesRecruit = (kind: BotKind): boolean => kind === "recruit-only" || (BUILDERS.includes(kind) && !isNaive(kind) && kind !== "no-recruit");

export const playWeek = (state: GameState, kind: BotKind, tally: Tally, r: () => number): GameState => {
  let s = state;
  const stock = kind === "stock";
  if (s.pendingEvent) { s = resolveEvent(s, stock); if (s.gameOver) return s; }
  const pivot = pivotOf(kind);
  if (pivot && s.week === 2 && s.pricingModel !== pivot) s = cmd(s, `pricing ${pivot}`);
  if (BUILDERS.includes(kind)) s = productPhase(s, kind, tally, r);
  let guard = 0;
  while (s.ap > 0 && !s.gameOver && guard < 10) {
    guard += 1;
    if (s.pendingEvent) { s = resolveEvent(s, stock); continue; }
    const before = s;
    s = stock ? stockAction(s) : legacyAction(s, usesRecruit(kind), tally);
    if (s.ap === before.ap && s.cash === before.cash && s.rng === before.rng) break;
  }
  if (s.gameOver) return s;
  const offersBefore = rosterOf(s).filter((e) => e.offerDueWeek > 0).length;
  const departedBefore = s.people?.departures ?? 0;
  s = cmd(s, "end");
  const departed = (s.people?.departures ?? 0) - departedBefore;
  tally.departures += departed;
  tally.offers += Math.max(0, rosterOf(s).filter((e) => e.offerDueWeek > 0).length - offersBefore + departed);
  if (!rosterInvariantHolds(s)) tally.invariantBreaks += 1;
  return s;
};

/** The harness's seeded start (same as scripts/balanceSim.ts and the golden bots). */
export const seededInitial = (seed: number): GameState =>
  refreshDerivedNoLog({ ...createInitialState(), seed, rng: (seed ^ 0x9e3779b9) >>> 0, logSeq: 0 });
