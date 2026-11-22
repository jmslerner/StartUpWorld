/** Split from src/world/types.ts (M5): the WorldSnapshot projection and the ActionSignal. Re-exported by ../types. */

import type {
  AssetId,
  BuildSize,
  BuildType,
  CofounderArchetype,
  CompanyPhase,
  EndingType,
  FounderArchetype,
  OfferKind,
  PricingModel,
  QuirkId,
  ReceptionTier,
  SoundHint,
  Stage,
  TeamRole,
  TeamRoster,
} from "../../types/game";

export type PersonKind = "founder" | "cofounder" | "employee";

export interface PersonView {
  /**
   * Stable id: "founder", "cofounder", the engine employee id ("e17") for a named person, or
   * `${role}-${index}` for an unlisted standard head (index 0-based within that role's unlisted heads:
   * past the roster cap, a fractional hire, or a legacy state without a roster).
   */
  id: string;
  kind: PersonKind;
  /** null for founder / cofounder. */
  role: TeamRole | null;
  /** Display name. Deterministic per run (derived from the run seed) for employees. */
  name: string;
  /** uint32 driving deterministic look variety (skin, hair, outfit shade, height). */
  look: number;
}

/** Energy, in the bands the engine names (85 fresh / 60 fine / 45 tired / 30 running on fumes / below: burnt out). */
export type EnergyBand = "fresh" | "fine" | "tired" | "fumes" | "burnt-out";

/** One visible named employee's working facts (same order as their PersonView in `people`). */
export interface StaffView {
  id: string;
  /** 1–5, 3 = standard. */
  pace: number;
  craft: number;
  quirk: QuirkId | null;
  /** 0–100. */
  energy: number;
  energyBand: EnergyBand;
  /** The build they are on, or null for the day job. */
  buildId: string | null;
  isLead: boolean;
  engaged: boolean;
  /** Releases credited to them. */
  shipped: number;
  /** An outside offer they are holding (notice handed in), or null. */
  offer: { kind: OfferKind; weeksLeft: number; buildAtRisk: string | null } | null;
}

/** One active product build (board order). */
export interface BuildView {
  id: string;
  name: string;
  slug: string;
  type: BuildType;
  size: BuildSize;
  /** 0–100. */
  pct: number;
  /** Reached 100%. */
  built: boolean;
  crunch: boolean;
  crunchWeeks: number;
  surprises: number;
  dueWeek: number;
  weeksLate: number;
  seats: number;
  staffIds: string[];
  leadId: string | null;
  /** The reception tier a release shipped right now would most likely get. */
  tierNow: ReceptionTier;
  forecastNow: number;
  /** At least 60% built: `ship <slug>` would be accepted on progress. */
  shippable: boolean;
}

export interface ReleaseView {
  id: string;
  name: string;
  week: number;
  tier: ReceptionTier;
  reception: number;
}

export interface ProductView {
  cruft: number;
  moat: number;
  /** Lifetime releases. */
  shippedCount: number;
  /** Build slots this office has (garage 1 … unicorn 3). */
  slots: number;
  /** Most recent first, at most 12. */
  recent: ReleaseView[];
}

export interface CandidateView {
  /** 1–3, what `recruit <role> <n>` takes. */
  index: number;
  name: string;
  shownPace: number;
  shownCraft: number;
  vetted: boolean;
  ask: number;
}

export interface WorldSnapshot {
  /** Identifies the run (the run seed). When it changes the world hard-resets. */
  runId: number;
  /** False until name + company + founder + cofounder archetypes are chosen. */
  setupComplete: boolean;
  companyName: string;
  founderName: string;
  founderArchetype: FounderArchetype | null;
  cofounderArchetype: CofounderArchetype | null;

  week: number;
  ap: number;
  maxAp: number;
  /** Always one of the five: buildWorldSnapshot shows an unknown phase from a save as "garage" (see ../phase). */
  phase: CompanyPhase;
  stage: Stage;

  cash: number;
  /** burn − weekly revenue. ≤ 0 means profitable. */
  netBurn: number;
  /** 999 when profitable. */
  runwayWeeks: number;
  valuation: number;
  users: number;
  mrr: number;
  /** Which of the three pricing models the company sells under (shown on the pricing board). */
  pricingModel: PricingModel;

  /** All 0–100. */
  reputation: number;
  morale: number;
  cohesion: number;
  stress: number;
  volatility: number;

  team: TeamRoster;
  teamSize: number;
  /**
   * Founder first, cofounder second (cofounder only once chosen), then employees
   * grouped by role in canonical role order. Capped at MAX_WORLD_PEOPLE.
   *
   * Employees are listed even while `setupComplete` is false (the engine starts
   * every run with one engineer). The World hides them until setup completes by
   * seating only the founder, so systems should treat `ctx.seating.seatOf(id)`
   * — not presence in this list — as "this person is in the office".
   */
  people: PersonView[];
  /** Employees beyond the cap that are not in `people`. */
  hiddenPeople: number;
  /** One per visible named employee, in `people` order. [] for a legacy state. */
  staff: StaffView[];
  /** Active product builds, board order. [] for a legacy state. */
  builds: BuildView[];
  product: ProductView;
  /** This week's candidate pools, for the roles someone looked at (`recruit <role>`). */
  candidates: Partial<Record<TeamRole, CandidateView[]>>;

  ownedAssets: AssetId[];
  /** Not owned, and the current company phase allows buying them. */
  availableAssets: AssetId[];

  pendingEventTitle: string | null;
  gameOver: EndingType | null;
}

/**
 * Emitted by the store every time a command runs. `seq` increments per command so
 * consumers can tell "new action" from "re-render".
 */
export interface ActionSignal {
  seq: number;
  /** Lower-cased first token, e.g. "ship", "hire", "end", "choose". */
  command: string;
  /** Remaining tokens, lower-cased, e.g. ["eng", "2"]. */
  args: string[];
  /** The engine's outcome hint for this command, if any. */
  sound: SoundHint | null;
  /**
   * True when the engine refused the command — e.g. "No AP left". Defined exactly as:
   * the result carried no sound hint AND at least one of its logs has kind "error".
   * (A backfired `board blackmail` logs an error line but is a real outcome with sound
   * "fail", so it is not a rejection; an invalid `choose 9` logs kind "event" and is not one either.)
   */
  rejected: boolean;
}

