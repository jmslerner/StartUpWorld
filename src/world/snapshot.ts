/**
 * GameState → WorldSnapshot: the one place the world layer reads engine state.
 *
 * The snapshot is a pure, serialisable projection. Building it never touches the
 * engine RNG and never mutates the state, and two structurally equal states
 * always produce structurally equal snapshots — so it is safe to rebuild on every
 * store change and to diff consecutive snapshots (see events.ts).
 */
import type { AssetId, GameState, TeamRole, TeamRoster } from "../types/game";
import { calcNetBurn, calcRunwayWeeks, getEffectiveMaxAp } from "../engine/economy";
import { computeTeamSize } from "../engine/context";
import { ALL_ASSET_IDS, ASSET_CATALOG, phaseAtLeast } from "../engine/assets";
import { isSetupComplete } from "../engine/founders";
import { listCandidates, rosterForWorld } from "../engine/people";
import type { PersonFacts } from "../engine/people";
import { listBuilds, productSummary } from "../engine/projects";
import { hashText32 } from "./hash";
import { employeeName } from "./names";
import { worldPhaseOf } from "./phase";
import type { BuildView, CandidateView, CruftBand, EnergyBand, MoatBand, PersonView, ProductView, StaffView, WorldSnapshot } from "./types";

/**
 * Hard cap on characters in the scene (founder and cofounder included). It is a
 * render budget, not a game rule: employees past the cap still exist in
 * `team` / `teamSize` and are counted in `hiddenPeople`.
 */
export const MAX_WORLD_PEOPLE = 64;

/**
 * Canonical order of roles in `people`. Builders first, then go-to-market, then
 * support functions, so departments end up sitting together when an office is
 * (re)seated in roster order.
 */
export const ROLE_ORDER: TeamRole[] = [
  "engineering", "design", "product", "data", "marketing", "sales", "ops", "hr", "legal", "executive",
];

export const FOUNDER_ID = "founder";
export const COFOUNDER_ID = "cofounder";

/**
 * Stable id of the `index`-th (0-based) unlisted head in a role: one the engine has no named record
 * for (past the roster cap, a fractional hire, a legacy state). Named people use their engine id ("e17").
 */
export const employeeId = (role: TeamRole, index: number): string => `${role}-${index}`;

const ROLE_SET: ReadonlySet<string> = new Set(ROLE_ORDER);

/** Inverse of `employeeId`. Returns null for "founder", "cofounder" and anything malformed. */
export const parseEmployeeId = (id: string): { role: TeamRole; index: number } | null => {
  const dash = id.lastIndexOf("-");
  if (dash <= 0) return null;
  const role = id.slice(0, dash);
  const digits = id.slice(dash + 1);
  if (!ROLE_SET.has(role) || !/^\d+$/.test(digits)) return null;
  return { role: role as TeamRole, index: Number(digits) };
};

/**
 * Whole people in a role.
 *
 * The engine stores whatever number `hire <role> <count>` was given, so a count
 * can be fractional ("hire eng 1.5"). Half a person cannot sit at a desk; the
 * world always works with the floor.
 */
export const headcount = (team: TeamRoster, role: TeamRole): number => {
  const raw = team[role];
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
};

/** Is this the engine id of a named employee ("e17")? */
export const isNamedEmployeeId = (id: string): boolean => /^e\d+$/.test(id);

/** The engine's energy words, as bands (85 / 60 / 45 / 30). */
export const energyBandOf = (energy: number): EnergyBand =>
  energy >= 85 ? "fresh" : energy >= 60 ? "fine" : energy >= 45 ? "tired" : energy >= 30 ? "fumes" : "burnt-out";

/** Cruft bands for the server rack: tape at 15, spaghetti at 35, sparks at 60. */
export const cruftBandOf = (cruft: number): CruftBand =>
  cruft >= 60 ? "sparking" : cruft >= 35 ? "spaghetti" : cruft >= 15 ? "taped" : "clean";

/** Moat bands round the product wall: 10 / 25 / 50. */
export const moatBandOf = (moat: number): MoatBand =>
  moat >= 50 ? "alligator" : moat >= 25 ? "moat" : moat >= 10 ? "ditch" : "puddle";

const staffViewOf = (facts: PersonFacts): StaffView => ({
  id: facts.id,
  pace: facts.pace,
  craft: facts.craft,
  quirk: facts.quirk,
  energy: facts.energy,
  energyBand: energyBandOf(facts.energy),
  buildId: facts.buildId,
  isLead: facts.isLead,
  engaged: facts.engaged,
  shipped: facts.shipped,
  offer: facts.offer ? { kind: facts.offer.kind, weeksLeft: facts.offer.weeksLeft, buildAtRisk: facts.offer.buildAtRisk } : null,
});

const buildPeople = (state: GameState): { people: PersonView[]; hiddenPeople: number; staff: StaffView[] } => {
  const seed = state.seed;
  const people: PersonView[] = [
    {
      id: FOUNDER_ID,
      kind: "founder",
      role: null,
      name: state.founder.name.trim() || "Founder",
      look: hashText32(seed, FOUNDER_ID),
    },
  ];

  // The cofounder only exists in the world once the player has picked one; until
  // then the engine's placeholder ("Cofounder", no archetype) is not a person.
  if (state.cofounder.archetype) {
    people.push({
      id: COFOUNDER_ID,
      kind: "cofounder",
      role: null,
      name: state.cofounder.name.trim() || "Cofounder",
      look: hashText32(seed, COFOUNDER_ID),
    });
  }

  // Named people first (engaged ones are always among them), department by department, then the
  // unlisted standard heads in whatever room is left. For a legacy state (no roster) `named.people` is
  // empty and `named.unlisted[role]` is the role's whole head count, so the second loop is the old one.
  const named = rosterForWorld(state, MAX_WORLD_PEOPLE - people.length);
  const staff: StaffView[] = [];
  let hiddenPeople = named.hidden;
  // Group the named staff by role in one pass, then emit in canonical role
  // order (this used to re-scan the whole roster once per role).
  const namedByRole = new Map<TeamRole, PersonFacts[]>();
  for (const facts of named.people) {
    const bucket = namedByRole.get(facts.role);
    if (bucket) bucket.push(facts);
    else namedByRole.set(facts.role, [facts]);
  }
  for (const role of ROLE_ORDER) {
    for (const facts of namedByRole.get(role) ?? []) {
      people.push({ id: facts.id, kind: "employee", role, name: facts.name, look: hashText32(seed, facts.id) });
      staff.push(staffViewOf(facts));
    }
  }
  for (const role of ROLE_ORDER) {
    const extra = Math.max(0, Math.floor(named.unlisted[role] ?? 0));
    // Bound the loop by the remaining budget, not by the count: a head count is
    // player input and can be arbitrarily large.
    const visible = Math.max(0, Math.min(extra, MAX_WORLD_PEOPLE - people.length));
    for (let index = 0; index < visible; index += 1) {
      const id = employeeId(role, index);
      people.push({
        id,
        kind: "employee",
        role,
        name: employeeName(seed, role, index).full,
        look: hashText32(seed, id),
      });
    }
    hiddenPeople += extra - visible;
  }

  return { people, hiddenPeople, staff };
};

const buildBuilds = (state: GameState): BuildView[] =>
  listBuilds(state).map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    type: b.type,
    size: b.size,
    pct: b.pct,
    built: b.built,
    crunch: b.crunch,
    crunchWeeks: b.crunchWeeks,
    surprises: b.surprises,
    dueWeek: b.dueWeek,
    weeksLate: b.weeksLate,
    seats: b.seats,
    staffIds: [...b.staffIds],
    leadId: b.leadId,
    tierNow: b.forecast.tierNow,
    forecastNow: b.forecast.now,
    shippable: b.forecast.shippable,
  }));

const buildProduct = (state: GameState): ProductView => {
  const summary = productSummary(state);
  return {
    cruft: summary.cruft,
    moat: summary.moat,
    shippedCount: summary.shippedCount,
    slots: summary.slots,
    recent: summary.recent.map((release) => ({
      id: release.id,
      name: release.name,
      week: release.week,
      tier: release.tier,
      reception: release.reception,
    })),
  };
};

const buildCandidates = (state: GameState): Partial<Record<TeamRole, CandidateView[]>> => {
  const out: Partial<Record<TeamRole, CandidateView[]>> = {};
  const people = state.people;
  if (!people || people.candidatesWeek !== state.week) return out;
  for (const role of ROLE_ORDER) {
    if (!people.candidates[role]) continue;
    const pool = listCandidates(state, role);
    if (!pool) continue;
    out[role] = pool.map((c) => ({
      index: c.index,
      name: c.name,
      shownPace: c.shownPace,
      shownCraft: c.shownCraft,
      vetted: c.vetted,
      ask: c.ask,
    }));
  }
  return out;
};

export const buildWorldSnapshot = (saved: GameState): WorldSnapshot => {
  // A save can carry a phase that is not one of the five (nothing validates it
  // on load). The world shows such a company in the garage (see ./phase), and
  // every engine read below sees that phase too, so phase-keyed engine tables
  // (build slots, …) give garage values rather than undefined.
  const phase = worldPhaseOf(saved.companyPhase);
  const state = phase === saved.companyPhase ? saved : { ...saved, companyPhase: phase };
  const { people, hiddenPeople, staff } = buildPeople(state);

  const ownedAssets: AssetId[] = state.assets.map((asset) => asset.id);
  const ownedSet = new Set<AssetId>(ownedAssets);
  const availableAssets = ALL_ASSET_IDS.filter(
    (id) => !ownedSet.has(id) && phaseAtLeast(phase, ASSET_CATALOG[id].minPhase)
  );

  return {
    runId: state.seed,
    setupComplete: isSetupComplete(state),
    companyName: state.companyName,
    founderName: state.founder.name,
    founderArchetype: state.founder.archetype,
    cofounderArchetype: state.cofounder.archetype,

    week: state.week,
    ap: state.ap,
    maxAp: getEffectiveMaxAp(state),
    phase,
    stage: state.stage,

    cash: state.cash,
    netBurn: calcNetBurn(state),
    runwayWeeks: calcRunwayWeeks(state),
    valuation: state.valuation,
    users: state.users,
    mrr: state.mrr,
    pricingModel: state.pricingModel,

    reputation: state.reputation,
    morale: state.culture.morale,
    cohesion: state.culture.cohesion,
    stress: state.stress,
    volatility: state.volatility,

    team: { ...state.team },
    teamSize: computeTeamSize(state),
    people,
    hiddenPeople,
    staff,
    builds: buildBuilds(state),
    product: buildProduct(state),
    candidates: buildCandidates(state),

    ownedAssets,
    availableAssets,

    pendingEventTitle: state.pendingEvent?.title ?? null,
    gameOver: state.gameOver?.ending ?? null,
  };
};
