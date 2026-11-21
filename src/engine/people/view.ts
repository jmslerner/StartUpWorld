// Read-only selectors for the terminal and the 3D office (TYCOON-SPEC §9.1). Keep every export and its type:
// the 3D team codes against them. All selectors are side-effect free, draw no RNG and accept legacy (slice-less) states.
import type { Employee, GameState, OfferKind, QuirkId, TeamRole } from "../../types/game";
import { ROLE_ORDER } from "../tycoon/constants";
import { roleComp } from "../tycoon/comp";
import {
  buildsOf, craftScore, effectiveness, findEmployee, marketSalary, roleFit, rosterOf, serialOf, unlistedOf,
} from "../tycoon/roster";
import { WORLD_ROSTER_LIMIT, TIRED_BELOW } from "./constants";
import { storedPool } from "./candidates";
import { buildAtRisk, buildById, energyWordOf, isLeadNow, retainBonus, retainSalary, severanceOf } from "./rules";

export { offerChance } from "./rules";

export type EnergyWord = "fresh" | "fine" | "tired" | "running on fumes" | "burnt out";

/** §5.2 card text per quirk. */
export const QUIRK_BLURB: Record<QuirkId, string> = {
  cowboy: "builds 25% faster; their craft counts one lower",
  craftsperson: "craft counts one higher; builds 10% slower",
  firefighter: "crunch drains them half as fast",
  glue: "any build they are on runs 10% faster; losing them hurts cohesion",
  mercenary: "asks 10% more; recruiters have them on speed dial",
  believer: "asks 10% less; never takes a recruiter's call; crunch drains them faster",
};

export interface PersonFacts {
  id: string;
  name: string;
  role: TeamRole;
  pace: number;
  craft: number;
  craftScore: number;
  effectiveness: number;
  energy: number;
  energyWord: EnergyWord;
  quirk: QuirkId | null;
  quirkBlurb: string | null;
  salary: number;
  marketSalary: number;
  hiredWeek: number;
  shipped: number;
  engaged: boolean;
  buildId: string | null;
  buildSlug: string | null;
  isLead: boolean;
  /** active builds this person's role can work on (fit > 0), board order: one "Put on <build>" button each */
  fitBuildIds: string[];
  /** weeksLeft = max(1, offerDueWeek - week); buildAtRisk = slug of the active build that loses LEAD_LOSS if they go */
  offer: { kind: OfferKind; weeksLeft: number; buildAtRisk: string | null } | null;
  retainQuote: { bonus: number; newSalary: number };
  /** 2 x salary */
  severance: number;
}

export interface WorldRoster {
  /** at most `limit`: engaged people first (by serial), then the rest (by serial) */
  people: PersonFacts[];
  /** floor(team[r]) − records of role r: whole heads with no record (past the cap) */
  unlisted: Partial<Record<TeamRole, number>>;
  /** records not returned because of `limit` */
  hidden: number;
}

export interface CandidateFacts {
  /** 1..3, what `recruit <role> <n>` takes */
  index: number;
  id: string;
  name: string;
  role: TeamRole;
  /** claimed stats unless vetted */
  shownPace: number;
  shownCraft: number;
  vetted: boolean;
  quirk: QuirkId | null | "hidden";
  ask: number;
  /** roleComp[role].hireCost */
  signing: number;
  /** ask / roleComp[role].salary − 1, e.g. 0.11 → "+11% vs standard" */
  askVsStandard: number;
}

/** Weeks until someone holding notice leaves (at least 1 while they are still here). */
export const weeksLeftOf = (state: GameState, e: Employee): number => Math.max(1, e.offerDueWeek - state.week);

/** Everything a card or a row needs about one person. */
export const factsOf = (state: GameState, e: Employee): PersonFacts => {
  const build = buildById(state, e.buildId);
  const atRisk = e.offerDueWeek > 0 ? buildAtRisk(state, e) : null;
  return {
    id: e.id,
    name: e.name,
    role: e.role,
    pace: e.pace,
    craft: e.craft,
    craftScore: craftScore(e),
    effectiveness: effectiveness(e),
    energy: e.energy,
    energyWord: energyWordOf(e.energy),
    quirk: e.quirk,
    quirkBlurb: e.quirk ? QUIRK_BLURB[e.quirk] : null,
    salary: e.salary,
    marketSalary: marketSalary(e.role, e.pace, e.craft),
    hiredWeek: e.hiredWeek,
    shipped: e.shipped,
    engaged: e.engaged,
    buildId: build ? build.id : null,
    buildSlug: build ? build.slug : null,
    isLead: isLeadNow(state, e),
    fitBuildIds: buildsOf(state).filter((b) => roleFit(b.type, e.role) > 0).map((b) => b.id),
    offer: e.offerDueWeek > 0 && e.offerKind
      ? { kind: e.offerKind, weeksLeft: weeksLeftOf(state, e), buildAtRisk: atRisk ? atRisk.slug : null }
      : null,
    retainQuote: { bonus: retainBonus(e), newSalary: retainSalary(e) },
    severance: severanceOf(e.salary),
  };
};

/** `team` sort bucket: holding an offer, then tired, then on a build, then engaged, then everyone else. */
const urgency = (e: Employee): number =>
  e.offerDueWeek > 0 ? 0 : e.energy < TIRED_BELOW ? 1 : e.buildId !== null ? 2 : e.engaged ? 3 : 4;

/** The roster in `team` order (§4.2): urgency, then pace + craft descending, then serial. */
export const sortedRoster = (state: GameState, role?: TeamRole): Employee[] =>
  rosterOf(state)
    .filter((e) => !role || e.role === role)
    .sort((a, b) => urgency(a) - urgency(b) || (b.pace + b.craft) - (a.pace + a.craft) || serialOf(a.id) - serialOf(b.id));

export const describeEmployee = (s: GameState, idOrName: string): PersonFacts | null => {
  const found = findEmployee(s, idOrName);
  return found.ok ? factsOf(s, found.employee) : null;
};

/** `team` order (§4.2). */
export const listRoster = (s: GameState, opts?: { role?: TeamRole }): PersonFacts[] => sortedRoster(s, opts?.role).map((e) => factsOf(s, e));

/** limit defaults to 64 */
export const rosterForWorld = (s: GameState, limit: number = WORLD_ROSTER_LIMIT): WorldRoster => {
  const roster = rosterOf(s);
  const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : WORLD_ROSTER_LIMIT;
  const bySerial = (a: Employee, b: Employee): number => serialOf(a.id) - serialOf(b.id);
  const ordered = [...roster.filter((e) => e.engaged).sort(bySerial), ...roster.filter((e) => !e.engaged).sort(bySerial)];
  const shown = ordered.slice(0, max);
  const unlisted: Partial<Record<TeamRole, number>> = {};
  for (const role of ROLE_ORDER) {
    const n = unlistedOf(s, role);
    if (n > 0) unlisted[role] = n;
  }
  return { people: shown.map((e) => factsOf(s, e)), unlisted, hidden: ordered.length - shown.length };
};

/** This week's stored pool, or null when nobody looked yet this week (the UI runs `recruit <role>` to generate it). */
export const listCandidates = (s: GameState, role: TeamRole): CandidateFacts[] | null => {
  const pool = storedPool(s, role);
  if (!pool) return null;
  return pool.map((c, i) => ({
    index: i + 1,
    id: c.id,
    name: c.name,
    role: c.role,
    shownPace: c.vetted ? c.pace : c.claimedPace,
    shownCraft: c.vetted ? c.craft : c.claimedCraft,
    vetted: c.vetted,
    quirk: c.vetted ? c.quirk : "hidden",
    ask: c.ask,
    signing: roleComp[c.role].hireCost,
    askVsStandard: c.ask / roleComp[c.role].salary - 1,
  }));
};
