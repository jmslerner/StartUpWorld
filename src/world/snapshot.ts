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
import { hashText32 } from "./hash";
import { employeeName } from "./names";
import type { PersonView, WorldSnapshot } from "./types";

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

/** Stable id of the `index`-th (0-based) employee in a role. */
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

/** Mirrors `isSetupComplete` in src/engine/commands.ts (not exported there). */
const isSetupComplete = (state: GameState): boolean =>
  Boolean(
    state.founder.name.trim() &&
      state.companyName.trim() &&
      state.founder.archetype &&
      state.cofounder.archetype
  );

const buildPeople = (state: GameState): { people: PersonView[]; hiddenPeople: number } => {
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

  let hiddenPeople = 0;
  for (const role of ROLE_ORDER) {
    const count = headcount(state.team, role);
    // Bound the loop by the remaining budget, not by `count`: a head count is
    // player input and can be arbitrarily large.
    const visible = Math.min(count, MAX_WORLD_PEOPLE - people.length);
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
    hiddenPeople += count - visible;
  }

  return { people, hiddenPeople };
};

export const buildWorldSnapshot = (state: GameState): WorldSnapshot => {
  const { people, hiddenPeople } = buildPeople(state);

  const ownedAssets: AssetId[] = state.assets.map((asset) => asset.id);
  const availableAssets = ALL_ASSET_IDS.filter(
    (id) => !ownedAssets.includes(id) && phaseAtLeast(state.companyPhase, ASSET_CATALOG[id].minPhase)
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
    phase: state.companyPhase,
    stage: state.stage,

    cash: state.cash,
    netBurn: calcNetBurn(state),
    runwayWeeks: calcRunwayWeeks(state),
    valuation: state.valuation,
    users: state.users,
    mrr: state.mrr,

    reputation: state.reputation,
    morale: state.culture.morale,
    cohesion: state.culture.cohesion,
    stress: state.stress,
    volatility: state.volatility,

    team: { ...state.team },
    teamSize: computeTeamSize(state),
    people,
    hiddenPeople,

    ownedAssets,
    availableAssets,

    pendingEventTitle: state.pendingEvent?.title ?? null,
    gameOver: state.gameOver?.ending ?? null,
  };
};
