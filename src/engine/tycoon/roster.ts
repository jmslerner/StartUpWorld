import type { Build, BuildType, Employee, GameState, PeopleState, ProductState, QuirkId, TeamRole, TeamRoster } from "../../types/game";
import { roleComp } from "./comp";
import {
  ATTENTION, CRAFT_BASE, CRAFT_STEP, ENERGY_FLOOR_FACTOR, ENERGY_FULL, EXPERIENCE_BONUS, EXPERIENCE_MAX, JOB_AD_QUIRK_CHANCE,
  JOB_AD_TEMPERAMENTS, LEAD_LOSS, PEOPLE_SALT, PRODUCT_SALT, QUIRKS, ROLE_FIT, ROLE_ORDER, ROSTER_CAP, SALARY_STEP, SKILL_SLOPE,
} from "./constants";
import { chance, nextIntInclusive, pickWeightedIndex } from "../rng";
import { isSetupComplete } from "../founders";

// The roster kernel (TYCOON-SPEC §2.4, §2.6, §3, §5.1, §5.2, §9.1).
// Import rule: only types, tycoon/constants, tycoon/comp, founders, rng and utils. Never kit, derived, economy or
// context (economy imports this file; economy -> roster -> kit -> derived -> economy would be a cycle).

export { PEOPLE_SALT, PRODUCT_SALT };

// ── Slices and RNG streams ──

/**
 * murmur3's 32-bit finalizer: every input bit reaches every output bit. Without it, xorshift32's first output barely depends
 * on the low bits of its seed, so every small typed seed (`seed 1` … `seed 5000`) drew the same first person and the same
 * first codename (ERRATA 64).
 */
const fmix32 = (x: number): number => {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};

/** The first value of a tycoon stream: the run seed and the stream's salt, mixed. xorshift32 is stuck at 0 forever, hence `|| 1`. */
export const streamSeed = (seed: number, salt: number): number => fmix32((seed ^ salt) >>> 0) || 1;

export const emptyPeople = (): PeopleState => ({
  rng: 0, nextId: 1, nextCandidateId: 1, roster: [], candidates: {}, candidatesWeek: 0, departures: 0,
});

export const emptyProduct = (): ProductState => ({
  rng: 0, nextId: 1, active: [], shipped: [], shippedCount: 0,
  shippedByType: { feature: 0, growth: 0, premium: 0, plumbing: 0, moonshot: 0 },
  cruft: 0, moat: 0, arpuCarry: 0, lastHotfixWeek: 0,
});

/** Adds any missing slice. Returns the same reference when both exist. */
export const withSlices = (state: GameState): GameState =>
  state.people && state.product ? state : { ...state, people: state.people ?? emptyPeople(), product: state.product ?? emptyProduct() };

/**
 * Slices plus a roster that matches `team`, before a tycoon command reads anything (§3.5, §4.1).
 * Returns `state` itself when the slices exist and nothing needed doing.
 */
export const ensureSlices = (state: GameState): GameState => reconcileRoster(withSlices(state));

/** Current value of the people stream (seeded lazily from the run seed when the slice still says 0). */
export const peopleRng = (state: GameState): number => state.people?.rng || streamSeed(state.seed, PEOPLE_SALT);
/** Current value of the product stream (seeded lazily from the run seed when the slice still says 0). */
export const productRng = (state: GameState): number => state.product?.rng || streamSeed(state.seed, PRODUCT_SALT);

/** Shallow-merges into `state.people` (creating the slice if missing). Always returns a new object. */
export const setPeople = (state: GameState, patch: Partial<PeopleState>): GameState => ({ ...state, people: { ...(state.people ?? emptyPeople()), ...patch } });
/** Shallow-merges into `state.product` (creating the slice if missing). Always returns a new object. */
export const setProduct = (state: GameState, patch: Partial<ProductState>): GameState => ({ ...state, product: { ...(state.product ?? emptyProduct()), ...patch } });

const NO_PEOPLE: Employee[] = [];
const NO_BUILDS: Build[] = [];
/** The roster ([] without a people slice). */
export const rosterOf = (state: GameState): Employee[] => state.people?.roster ?? NO_PEOPLE;
/** Active builds, board order ([] without a product slice). */
export const buildsOf = (state: GameState): Build[] => state.product?.active ?? NO_BUILDS;
/** Everyone staffed on the given build, roster order. */
export const staffOf = (state: GameState, buildId: string): Employee[] => rosterOf(state).filter((e) => e.buildId === buildId);
/** "e12" → 12, "b3" → 3, "c7" → 7 (0 for anything else). */
export const serialOf = (id: string): number => Number(id.slice(1)) || 0;

/** Records a role can have: whole, finite, non-negative heads only (H[r] in §2.5). */
export const wantOf = (count: number): number => (Number.isFinite(count) && count > 0 ? Math.floor(count) : 0);

export const countByRole = (roster: Employee[]): Record<TeamRole, number> => {
  const out: Record<TeamRole, number> = { engineering: 0, design: 0, marketing: 0, sales: 0, ops: 0, hr: 0, legal: 0, data: 0, product: 0, executive: 0 };
  for (const e of roster) out[e.role] += 1;
  return out;
};

/** Whole heads of a role with no record behind them: `floor(team[r]) − count(roster, r)`, never negative. Fractional heads are not counted. */
export const unlistedOf = (state: GameState, role: TeamRole): number =>
  Math.max(0, wantOf(state.team[role]) - rosterOf(state).filter((e) => e.role === role).length);

// ── One person (§5.2) ──

export const round50 = (n: number): number => Math.round(n / SALARY_STEP) * SALARY_STEP;
export const standardSalary = (role: TeamRole): number => roleComp[role].salary;
export const skillFactorOf = (pace: number, craft: number): number => 1 + SKILL_SLOPE * (pace + craft - 6);
export const skillFactor = (e: Pick<Employee, "pace" | "craft">): number => skillFactorOf(e.pace, e.craft);
export const energyFactor = (energy: number): number =>
  energy >= ENERGY_FULL ? 1 : ENERGY_FLOOR_FACTOR + (1 - ENERGY_FLOOR_FACTOR) * (Math.max(0, energy) / ENERGY_FULL);
/** How many standard heads this person works like in the passive formulas. 1.0 for every rested job-ad hire. */
export const effectiveness = (e: Employee): number => skillFactor(e) * energyFactor(e.energy);
/** What the market pays for these stats (the going rate). */
export const marketSalary = (role: TeamRole, pace: number, craft: number): number => round50(standardSalary(role) * skillFactorOf(pace, craft));

const craftAdjust = (quirk: QuirkId | null): number => (quirk === "cowboy" ? -1 : quirk === "craftsperson" ? 1 : 0);
/** Craft as a build sees it: the quirk's adjustment applied, clamped 1..6. */
export const craftLevel = (e: Pick<Employee, "craft" | "quirk">): number => Math.min(6, Math.max(1, e.craft + craftAdjust(e.quirk)));
export const experienceBonus = (e: Pick<Employee, "shipped">): number => EXPERIENCE_BONUS * Math.min(EXPERIENCE_MAX, e.shipped);
/** What this person's work is worth on a build, 0..100: craft (with the quirk's adjustment) plus what they learned shipping here. */
export const craftScore = (e: Pick<Employee, "craft" | "quirk" | "shipped">): number => CRAFT_BASE + CRAFT_STEP * craftLevel(e) + experienceBonus(e);
/** 0 = cannot be staffed on that type. */
export const roleFit = (type: BuildType, role: TeamRole): number => ROLE_FIT[type][role] ?? 0;

/** The person who sets the bar: highest craftScore among staffed members with fit > 0 (ties: higher pace, then lower serial). */
export const leadOf = (state: GameState, build: Build): Employee | null => {
  let best: Employee | null = null;
  for (const e of staffOf(state, build.id)) {
    if (roleFit(build.type, e.role) <= 0) continue;
    if (
      !best ||
      craftScore(e) > craftScore(best) ||
      (craftScore(e) === craftScore(best) && (e.pace > best.pace || (e.pace === best.pace && serialOf(e.id) < serialOf(best.id))))
    ) {
      best = e;
    }
  }
  return best;
};

// ── Effectiveness in the existing formulas, in delta form (§5.1) ──

/**
 * Headcount as the output formulas should see it: `team[r]` plus, for every backed record (the first floor(team[r])
 * records of role r), how far that person is from one standard head. No roster, or a roster in which nobody deviates
 * from one standard head, returns `state.team` ITSELF. `weekly` applies the day-job share (ATTENTION) of people on a build.
 */
export const effTeam = (state: GameState, weekly = false): TeamRoster => {
  const roster = state.people?.roster;
  if (!roster || roster.length === 0) return state.team;
  const delta: Partial<Record<TeamRole, number>> = {};
  const seen: Partial<Record<TeamRole, number>> = {};
  let any = false;
  for (const e of roster) {
    const n = seen[e.role] ?? 0;
    if (n >= wantOf(state.team[e.role])) continue; // never count more records than heads
    seen[e.role] = n + 1;
    const d = effectiveness(e) * (weekly && e.buildId !== null ? ATTENTION : 1) - 1;
    if (d !== 0) {
      delta[e.role] = (delta[e.role] ?? 0) + d;
      any = true;
    }
  }
  if (!any) return state.team;
  const out: TeamRoster = { ...state.team };
  for (const role of ROLE_ORDER) {
    const d = delta[role];
    if (d) out[role] = Math.max(0, state.team[role] + d);
  }
  return out;
};

/** Actual payroll minus "everyone on the standard salary" (backed records only). 0 without a roster. `roles` restricts it. */
export const payrollDelta = (state: GameState, roles?: TeamRole[]): number => {
  const roster = state.people?.roster;
  if (!roster || roster.length === 0) return 0;
  let delta = 0;
  const seen: Partial<Record<TeamRole, number>> = {};
  for (const e of roster) {
    const n = seen[e.role] ?? 0;
    if (n >= wantOf(state.team[e.role])) continue;
    seen[e.role] = n + 1;
    if (roles && !roles.includes(e.role)) continue;
    delta += e.salary - roleComp[e.role].salary;
  }
  return delta;
};

// ── Names (engine-owned neutral lists; none collides with the cofounder pools in actions.ts) ──

const FIRST_NAMES = [
  "Amara", "Dmitri", "Elif", "Tane", "Ingrid", "Samir", "Wren", "Paloma", "Kofi", "Yuki", "Mateo", "Zanele",
  "Oskar", "Leila", "Thabo", "Freya", "Rafael", "Mei", "Callum", "Nadia", "Emeka", "Sofia", "Hiro", "Greta",
  "Idris", "Bea", "Lukas", "Uma", "Felix", "Anouk", "Tomas", "Chidi", "Maren", "Vikram", "Juno", "Esme",
  "Bruno", "Aiko", "Soren", "Folake", "Nico", "Petra", "Arjun", "Lotte", "Omar", "Signe", "Dara", "Ivo",
];
const LAST_NAMES = [
  "Nwosu", "Petrov", "Ito", "Rahman", "Vogel", "Castillo", "Novak", "Zhao", "Mensah", "Tanaka", "Moreau", "Lindqvist",
  "Osei", "Virtanen", "Solberg", "Haddad", "Popescu", "Adeyemi", "Kealoha", "Nkosi", "Jansen", "Mukherjee", "Ekstrom", "Yoon",
  "Halloran", "Markovic", "Ueda", "Blanc", "Qureshi", "Lund", "Whitfield", "Marsh", "Pike", "Roth", "Rossi", "Nair",
  "Berg", "Shah", "Dunn", "Conti", "Tran", "Abara", "Sato", "Kowalski", "Reyes", "Demir", "Fontaine", "Okoro",
];

/** Draws a name nobody in `taken` has: two draws (first, last) from the given stream, then linear probing over last names. */
export const drawName = (rng: number, taken: Set<string>, serial: number): { rng: number; name: string } => {
  const a = nextIntInclusive(rng, 0, FIRST_NAMES.length - 1);
  const b = nextIntInclusive(a.rng, 0, LAST_NAMES.length - 1);
  for (let i = 0; i < LAST_NAMES.length; i++) {
    const name = `${FIRST_NAMES[a.value]} ${LAST_NAMES[(b.value + i) % LAST_NAMES.length]}`;
    if (!taken.has(name)) return { rng: b.rng, name };
  }
  return { rng: b.rng, name: `${FIRST_NAMES[a.value]} ${LAST_NAMES[b.value]} ${serial}` };
};

/** Every name on the roster and in the current candidate pools. */
export const takenNames = (people: PeopleState): Set<string> => {
  const taken = new Set(people.roster.map((e) => e.name));
  for (const pool of Object.values(people.candidates)) for (const c of pool ?? []) taken.add(c.name);
  return taken;
};

// ── Minting and reconciliation (§3) ──

/** A job-ad hire (§3.2): temperament with pace + craft = 6, standard salary, full energy. Worth exactly one standard head. */
export const mintJobAdHire = (people: PeopleState, rng: number, role: TeamRole, week: number): { people: PeopleState; rng: number } => {
  const t = pickWeightedIndex(rng, JOB_AD_TEMPERAMENTS.map((row) => row[2]));
  const [pace, craft] = JOB_AD_TEMPERAMENTS[t.value ?? 0];
  const hasQuirk = chance(t.rng, JOB_AD_QUIRK_CHANCE);
  let r = hasQuirk.rng;
  let quirk: QuirkId | null = null;
  if (hasQuirk.value) {
    const q = nextIntInclusive(r, 0, QUIRKS.length - 1);
    r = q.rng;
    quirk = QUIRKS[q.value];
  }
  const named = drawName(r, takenNames(people), people.nextId);
  const employee: Employee = {
    id: `e${people.nextId}`, name: named.name, role, pace, craft, quirk, salary: standardSalary(role), energy: 100,
    hiredWeek: week, shipped: 0, buildId: null, joinedWeek: 0, engaged: false,
    offerDueWeek: 0, offerKind: null, leadOnNotice: null, retainedWeek: 0, ledWeek: 0,
  };
  return { people: { ...people, nextId: people.nextId + 1, roster: [...people.roster, employee] }, rng: named.rng };
};

/**
 * THE reconciliation (G2). Makes the roster follow `state.team`, never the other way round:
 *   count(role r) === floor(team[r]) for every role while the total fits under ROSTER_CAP;
 *   count(role r) <=  floor(team[r]) and roster.length === ROSTER_CAP above it.
 * Pure, never logs, never touches `state.rng`, `team`, culture or cash, and returns the SAME reference when nothing needs doing.
 */
export const reconcileRoster = (state: GameState): GameState => {
  if (!state.people) return state; // a legacy state stays a legacy state
  if (!isSetupComplete(state)) return state; // the seed can still change; nobody is minted before the run is locked
  let people = state.people;
  let changed = false;

  // 1. People pointing at a build that no longer exists go back to the day job.
  const activeIds = new Set((state.product?.active ?? []).map((b) => b.id));
  if (people.roster.some((e) => e.buildId !== null && !activeIds.has(e.buildId))) {
    people = { ...people, roster: people.roster.map((e) => (e.buildId !== null && !activeIds.has(e.buildId) ? { ...e, buildId: null, joinedWeek: 0 } : e)) };
    changed = true;
  }

  // 2. More records than heads (something outside the tycoon code lowered `team`): the record follows the head out.
  let counts = countByRole(people.roster);
  for (const role of ROLE_ORDER) {
    const surplus = counts[role] - wantOf(state.team[role]);
    if (surplus <= 0) continue;
    const victims = new Set(
      people.roster
        .filter((e) => e.role === role)
        .sort((a, b) =>
          Number(a.engaged) - Number(b.engaged) ||
          Number(a.buildId !== null) - Number(b.buildId !== null) ||
          (a.pace + a.craft) - (b.pace + b.craft) ||
          serialOf(b.id) - serialOf(a.id))
        .slice(0, surplus)
        .map((e) => e.id),
    );
    people = { ...people, roster: people.roster.filter((e) => !victims.has(e.id)), departures: people.departures + victims.size };
    changed = true;
  }

  // 3. More heads than records: mint job-ad hires, one per role per pass (round-robin), until every role matches or the roster is full.
  counts = countByRole(people.roster);
  let rng = people.rng || streamSeed(state.seed, PEOPLE_SALT);
  let drew = false;
  let minted = true;
  while (minted && people.roster.length < ROSTER_CAP) {
    minted = false;
    for (const role of ROLE_ORDER) {
      if (people.roster.length >= ROSTER_CAP) break;
      if (counts[role] >= wantOf(state.team[role])) continue;
      const made = mintJobAdHire(people, rng, role, state.week);
      people = made.people;
      rng = made.rng;
      counts[role] += 1;
      minted = true;
      drew = true;
      changed = true;
    }
  }
  if (!changed) return state;
  // A pass that only trimmed or cleared never drew: keep the stream exactly as it was (0 stays "not seeded yet").
  return { ...state, people: drew ? { ...people, rng } : people };
};

/** True when I1 + I2 hold (used by tests and the sims). */
export const rosterInvariantHolds = (state: GameState): boolean => {
  if (!state.people) return true;
  const counts = countByRole(state.people.roster);
  const total = ROLE_ORDER.reduce((acc, r) => acc + wantOf(state.team[r]), 0);
  if (state.people.roster.length > ROSTER_CAP) return false;
  for (const role of ROLE_ORDER) {
    const want = wantOf(state.team[role]);
    if (counts[role] > want) return false;
    if (total <= ROSTER_CAP && isSetupComplete(state) && counts[role] !== want) return false;
  }
  if (total > ROSTER_CAP && isSetupComplete(state) && state.people.roster.length !== ROSTER_CAP) return false;
  const activeIds = new Set((state.product?.active ?? []).map((b) => b.id));
  return state.people.roster.every((e) => (e.buildId === null ? e.joinedWeek === 0 : activeIds.has(e.buildId) && e.joinedWeek > 0));
};

// ── The only functions that add or remove a specific person, or move them between builds ──

/** Shallow-patches one record. Returns `state` itself without a roster; never changes `buildId` legitimately (use assignEmployee). */
export const patchEmployee = (state: GameState, id: string, patch: Partial<Employee>): GameState =>
  state.people ? setPeople(state, { roster: state.people.roster.map((e) => (e.id === id ? { ...e, ...patch } : e)) }) : state;

/**
 * Puts someone on a build (or back on the day job with `null`): sets `buildId` and `joinedWeek` (= state.week, 0 for null).
 * Being staffed makes a person engaged for good. Same reference when the person is missing or already there.
 */
export const assignEmployee = (state: GameState, id: string, buildId: string | null): GameState => {
  const e = rosterOf(state).find((x) => x.id === id);
  if (!e || e.buildId === buildId) return state;
  return patchEmployee(state, id, { buildId, joinedWeek: buildId === null ? 0 : state.week, engaged: e.engaged || buildId !== null });
};

export type NewEmployee = Omit<
  Employee,
  "id" | "hiredWeek" | "shipped" | "buildId" | "joinedWeek" | "offerDueWeek" | "offerKind" | "leadOnNotice" | "retainedWeek" | "ledWeek"
>;

/** Room on the roster: under the cap, or a never-engaged unstaffed record can give up its nameplate. */
export const canAddEmployee = (state: GameState): boolean =>
  rosterOf(state).length < ROSTER_CAP || rosterOf(state).some((e) => !e.engaged && e.buildId === null);

/**
 * Adds a specific person AND their head (`team[role] + 1`). At the cap the newest never-engaged unstaffed record gives up
 * its nameplate (its head stays, unlisted). Returns null when the roster is full of engaged or staffed people.
 * Does not touch `engaged` (the caller decides; `recruit` passes true) and never applies a cohesion hit.
 */
export const addEmployee = (state: GameState, fresh: NewEmployee): { state: GameState; id: string } | null => {
  if (!canAddEmployee(state)) return null;
  const base = withSlices(state);
  let people = base.people ?? emptyPeople();
  if (people.roster.length >= ROSTER_CAP) {
    const spare = [...people.roster].reverse().find((e) => !e.engaged && e.buildId === null);
    if (!spare) return null;
    people = { ...people, roster: people.roster.filter((e) => e.id !== spare.id) };
  }
  const id = `e${people.nextId}`;
  const employee: Employee = {
    ...fresh, id, hiredWeek: base.week, shipped: 0, buildId: null, joinedWeek: 0,
    offerDueWeek: 0, offerKind: null, leadOnNotice: null, retainedWeek: 0, ledWeek: 0,
  };
  return {
    state: { ...base, people: { ...people, nextId: people.nextId + 1, roster: [...people.roster, employee] }, team: { ...base.team, [fresh.role]: base.team[fresh.role] + 1 } },
    id,
  };
};

/** Lowers headcount without a named person (layoffs of unlisted heads). Also lowers `lastWeek.teamSize` (floored at 0) so `hiresThisWeek` stays gross. */
export const removeHeads = (state: GameState, role: TeamRole, count: number): GameState => ({
  ...state,
  team: { ...state.team, [role]: Math.max(0, state.team[role] - count) },
  lastWeek: { ...state.lastWeek, teamSize: Math.max(0, state.lastWeek.teamSize - count) },
});

export interface Removal {
  state: GameState;
  employee: Employee | null; // the record as it was before removal; null when the id was not found
  ledBuild: Build | null; // the build that lost LEAD_LOSS of its progress, AFTER the loss; null when none did
}

/** The build a departure of `e` costs a quarter of (§3.3): the notice build if still active, else the active build they lead now. */
export const leadLossBuild = (state: GameState, e: Employee): Build | null => {
  const active = buildsOf(state);
  if (e.offerDueWeek > 0 && e.leadOnNotice !== null) {
    const noticed = active.find((b) => b.id === e.leadOnNotice);
    if (noticed) return noticed;
  }
  if (e.buildId === null) return null;
  const current = active.find((b) => b.id === e.buildId);
  return current && leadOf(state, current)?.id === e.id ? current : null;
};

export interface BatchRemoval {
  state: GameState;
  removed: Employee[]; // the records as they were before removal, in the order given (unknown and repeated ids skipped)
  /** Each build that lost LEAD_LOSS, AFTER the loss, with the leaver it is charged to (the first one given whose loss it is). */
  lost: Array<{ build: Build; byId: string }>;
}

/**
 * Removes several specific people AND their heads in one go: a layoff, or every notice that runs out in the same tick.
 * The lead rule is decided on the state BEFORE anyone in the batch leaves, and each build loses LEAD_LOSS at most once per
 * batch: when a build's lead goes, whoever would inherit the lead is not charged again for leaving in the same breath
 * (ERRATA 65). The loss scales `progress`, `qSum` and `qPts` (the quality average is unchanged); polish is kept; a build that
 * drops below 100% loses its built status. `departures` + the number removed. No culture effect (callers own fallout).
 */
export const removeEmployees = (state: GameState, ids: string[]): BatchRemoval => {
  if (!state.people) return { state, removed: [], lost: [] };
  const byId = new Map(rosterOf(state).map((e) => [e.id, e] as const));
  const removed: Employee[] = [];
  for (const id of ids) {
    const e = byId.get(id);
    if (e && !removed.includes(e)) removed.push(e);
  }
  if (removed.length === 0) return { state, removed, lost: [] };

  const charged = new Map<string, string>(); // build id -> leaver id
  for (const e of removed) {
    const target = leadLossBuild(state, e);
    if (target && !charged.has(target.id)) charged.set(target.id, e.id);
  }
  let s = state;
  const lost: BatchRemoval["lost"] = [];
  if (charged.size > 0 && s.product) {
    const keep = 1 - LEAD_LOSS;
    const active = s.product.active.map((b) => {
      const leaver = charged.get(b.id);
      if (!leaver) return b;
      const progress = b.progress * keep;
      const hit: Build = { ...b, progress, qSum: b.qSum * keep, qPts: b.qPts * keep, readyWeek: progress < b.scope ? 0 : b.readyWeek };
      lost.push({ build: hit, byId: leaver });
      return hit;
    });
    s = setProduct(s, { active });
  }
  const gone = new Set(removed.map((e) => e.id));
  const people = s.people ?? emptyPeople();
  s = setPeople(s, { roster: people.roster.filter((e) => !gone.has(e.id)), departures: people.departures + removed.length });
  for (const e of removed) s = removeHeads(s, e.role, 1);
  return { state: s, removed, lost };
};

/**
 * Removes a specific person AND their head. The single place a named person leaves the company (a batch of one).
 * The lead rule: `leadLossBuild` loses LEAD_LOSS of `progress`, `qSum` and `qPts` (so the quality average is unchanged);
 * polish is kept; a build that drops below 100% loses its built status. `departures + 1`. No culture effect (callers own fallout).
 */
export const removeEmployee = (state: GameState, id: string): Removal => {
  const out = removeEmployees(state, [id]);
  return { state: out.state, employee: out.removed[0] ?? null, ledBuild: out.lost[0]?.build ?? null };
};

/** Credits a release to the given people (`shipped + 1` each). Experience is what makes a veteran worth keeping. */
export const creditRelease = (state: GameState, ids: string[]): GameState => {
  if (!state.people || ids.length === 0) return state;
  return setPeople(state, { roster: state.people.roster.map((e) => (ids.includes(e.id) ? { ...e, shipped: e.shipped + 1 } : e)) });
};

// ── Lookup (§4.1) ──

export type Lookup = { ok: true; employee: Employee } | { ok: false; error: string };

/** Id ("e12" or "#12"), exact full name (case-insensitive), or a unique prefix of the full name or of any word in it. */
export const findEmployee = (state: GameState, query: string): Lookup => {
  const q = query.trim().toLowerCase().replace(/^#/, "e");
  const roster = rosterOf(state);
  if (!q) return { ok: false, error: "Who? Use a name or an id from `team`." };
  const byId = roster.find((e) => e.id === q);
  if (byId) return { ok: true, employee: byId };
  const exact = roster.filter((e) => e.name.toLowerCase() === q);
  const matches = exact.length > 0 ? exact : roster.filter((e) => {
    const name = e.name.toLowerCase();
    return name.startsWith(q) || name.split(" ").some((part) => part.startsWith(q));
  });
  if (matches.length === 1) return { ok: true, employee: matches[0] };
  if (matches.length === 0) return { ok: false, error: `Nobody called "${query.trim()}" works here. \`team\` lists who does.` };
  const shown = matches.slice(0, 4).map((e) => `${e.name} (${e.id})`).join(", ");
  return { ok: false, error: `"${query.trim()}" matches ${matches.length} people: ${shown}${matches.length > 4 ? ", ..." : ""}. Use the id.` };
};

/**
 * How a list names someone (the build board, its team and lead): the first name when typing it would find exactly this
 * person, else "Arjun (e5)". With 48 first names, duplicates are the norm past about fifteen people.
 */
export const shortName = (state: GameState, e: Employee): string => {
  const first = e.name.split(" ")[0];
  const found = findEmployee(state, first);
  return found.ok && found.employee.id === e.id ? first : `${first} (${e.id})`;
};
