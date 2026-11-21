/**
 * Shared contracts for the 3D world layer.
 *
 * The world is a *view* of the game: the engine (src/engine) stays the single
 * source of truth and remains turn-based. Everything here is either
 *  - a pure, serializable projection of GameState (WorldSnapshot, WorldEvent), or
 *  - an interface between the three.js systems and the React shell.
 *
 * Keep this file type-only (no runtime code) so it can be imported anywhere.
 */
import type * as THREE from "three";
import type {
  AssetId,
  CofounderArchetype,
  CompanyPhase,
  EndingType,
  FounderArchetype,
  SoundHint,
  Stage,
  TeamRole,
  TeamRoster,
} from "../types/game";

// ─────────────────────────────────────────────────────────────────────────────
// Geometry conventions
//   • Right-handed, Y up. 1 world unit ≈ 1 metre. The office floor sits at y = 0.
//   • `facing` is a yaw in radians about +Y. facing = 0 looks toward +Z,
//     facing = Math.PI / 2 looks toward +X (i.e. Object3D.rotation.y = facing).
//   • The camera is isometric and looks from (+X, +Y, +Z) toward the origin, so
//     tall back walls belong on the −X and −Z edges; the +X / +Z edges are open
//     (or low cut-away walls) so the interior is always visible.
// ─────────────────────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface Placement extends Vec2 {
  /** Yaw in radians; see conventions above. */
  facing: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot: what the world needs to know about the game
// ─────────────────────────────────────────────────────────────────────────────

export type PersonKind = "founder" | "cofounder" | "employee";

export interface PersonView {
  /** Stable id: "founder", "cofounder", or `${role}-${index}` (index is 0-based within the role). */
  id: string;
  kind: PersonKind;
  /** null for founder / cofounder. */
  role: TeamRole | null;
  /** Display name. Deterministic per run (derived from the run seed) for employees. */
  name: string;
  /** uint32 driving deterministic look variety (skin, hair, outfit shade, height). */
  look: number;
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
   */
  people: PersonView[];
  /** Employees beyond the cap that are not in `people`. */
  hiddenPeople: number;

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
  /** True when the engine refused the command (error log, state unchanged) — e.g. "No AP left". */
  rejected: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// World events: discrete "something happened" cues derived from snapshot diffs
// ─────────────────────────────────────────────────────────────────────────────

export type WorldEvent =
  | { type: "run-reset" }
  | { type: "setup-completed" }
  | { type: "week-advanced"; week: number }
  | { type: "hired"; role: TeamRole; personIds: string[] }
  | { type: "departed"; role: TeamRole; personIds: string[] }
  | { type: "ship"; ok: boolean; reputationDelta: number }
  | { type: "launch"; ok: boolean; usersDelta: number }
  | { type: "pitch"; ok: boolean }
  | { type: "raise"; ok: boolean; amount: number; source: "vc" | "bootstrap" }
  | { type: "board-action"; action: "dinner" | "gift" | "blackmail"; ok: boolean }
  | { type: "pricing-changed" }
  | { type: "cash-changed"; delta: number }
  | { type: "users-changed"; delta: number }
  | { type: "phase-changed"; from: CompanyPhase; to: CompanyPhase }
  | { type: "stage-changed"; from: Stage; to: Stage }
  | { type: "asset-acquired"; assetId: AssetId }
  | { type: "event-opened"; title: string }
  | { type: "event-resolved" }
  | { type: "easter-egg"; command: string }
  | { type: "command-failed"; command: string }
  | { type: "game-over"; ending: EndingType };

export type WorldEventType = WorldEvent["type"];

// ─────────────────────────────────────────────────────────────────────────────
// Office layout (pure data — see office/layouts.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixed points of interest. Every phase's layout provides every station so the
 * same interactions exist from the garage to the public-company HQ (they just
 * look different: a folding table in the garage, a glass boardroom later).
 */
export type StationKind =
  | "ship" // whiteboard / kanban wall — ship a feature
  | "launch" // marketing corner — launch a campaign
  | "investors" // phone / pitch corner — pitch + raise
  | "boardroom" // board table
  | "calendar" // wall calendar — end the week
  | "coffee" // coffee machine
  | "servers" // server rack — users / MRR
  | "pricing"; // pricing board

export interface OfficeLayout {
  phase: CompanyPhase;
  /** Interior floor rectangle. */
  floor: { minX: number; maxX: number; minZ: number; maxZ: number };
  /**
   * For every seat below, the Placement is where the PERSON sits and the
   * direction they face. The desk surface goes in front of them, centred at
   * seat + forward × DESK_OFFSET (see office/layouts.ts).
   */
  founderSeat: Placement;
  cofounderSeat: Placement;
  /** Employee desks, in fill order. */
  deskSeats: Placement[];
  /** Floor spots (beanbags / laptops on the floor) used once desks run out. */
  overflowSpots: Placement[];
  /** Where people walk in and out. Position is just inside the doorway, facing into the room. */
  door: Placement;
  /** Station object centre + the direction its front faces. */
  stations: Record<StationKind, Placement>;
  /** Where a person stands to use a station (in front of it, facing it). */
  stationStandSpots: Record<StationKind, Placement>;
  /** Places idle people wander to (coffee, windows, lounge). */
  wanderSpots: Placement[];
  /** Where each purchasable asset is shown (owned = real, available = blueprint ghost). */
  assetAnchors: Record<AssetId, Placement>;
  /** Default camera framing for this phase. */
  camera: {
    target: Vec2;
    /** World units visible vertically at default zoom. */
    viewHeight: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Seating (pure logic — see people/seating.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type SeatKind = "founder" | "cofounder" | "desk" | "overflow";

export interface Seat extends Placement {
  kind: SeatKind;
  /** Index into layout.deskSeats (kind "desk") or layout.overflowSpots (kind "overflow"); −1 otherwise. */
  slotIndex: number;
}

export interface SeatingApi {
  /** null when the person has no visible spot (office is over capacity). */
  seatOf(personId: string): Seat | null;
  /** Indices into layout.deskSeats that nobody occupies. */
  freeDeskSlots(): number[];
  /** People in the snapshot (plus snapshot.hiddenPeople) that have no visible spot. */
  hiddenCount(): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactables
// ─────────────────────────────────────────────────────────────────────────────

export type InteractableTarget =
  | { kind: "person"; personId: string }
  | { kind: "empty-desk"; slotIndex: number }
  | { kind: "station"; station: StationKind }
  | { kind: "asset"; assetId: AssetId }
  | { kind: "door" }
  | { kind: "event-beacon" }
  | { kind: "overflow-sign" };

export interface InteractableOptions {
  /** Short hover label, e.g. "Whiteboard". */
  label: string;
  /** Object whose world position anchors the inspector card. Defaults to the registered object. */
  anchor?: THREE.Object3D;
  /** World-unit offset above the anchor origin where the card/marker attaches. Default 1.6. */
  anchorHeight?: number;
  /** Skip the built-in hover/selection highlight (for objects that manage their own look). */
  noHighlight?: boolean;
}

export interface InteractableRegistry {
  /**
   * Make `object` (and all of its descendants) hoverable/clickable.
   * Registering a target key that is already registered replaces the old entry.
   */
  register(object: THREE.Object3D, target: InteractableTarget, options: InteractableOptions): void;
  unregister(object: THREE.Object3D): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// FX
// ─────────────────────────────────────────────────────────────────────────────

export type BurstKind = "confetti" | "sparkle" | "smoke" | "money" | "hearts" | "bugs" | "users" | "dust";
export type FloatTone = "good" | "bad" | "neutral" | "cash";
export type BubbleIcon =
  | "code"
  | "idea"
  | "coffee"
  | "money"
  | "heart"
  | "stress"
  | "zzz"
  | "exclaim"
  | "question"
  | "megaphone"
  | "bug"
  | "rocket"
  | "chart"
  | "phone"
  | "wave";

export interface FxApi {
  /** One-shot particle burst at a world position. `intensity` ≈ 1 is a normal burst. */
  burst(kind: BurstKind, at: Vec3Like, intensity?: number): void;
  /** Particles that arc from one point to another (e.g. code bubbles flying to the product wall). */
  stream(kind: BurstKind, from: Vec3Like, to: Vec3Like, count?: number): void;
  /** Short text that floats up and fades, e.g. "+12 rep", "−$3,000". */
  floatText(text: string, at: Vec3Like, tone?: FloatTone): void;
  /** Small icon bubble that follows `anchor` for `seconds` (default 2.2) then pops. */
  bubble(anchor: THREE.Object3D, icon: BubbleIcon, seconds?: number, heightOffset?: number): void;
  /** Brief camera shake; `strength` 0..1. No-op when reduced motion is on. */
  shake(strength: number): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// System plumbing
// ─────────────────────────────────────────────────────────────────────────────

export type QualityLevel = "low" | "high";

export interface WorldContext {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly quality: QualityLevel;
  readonly reducedMotion: boolean;
  readonly interactables: InteractableRegistry;
  readonly fx: FxApi;
  readonly seating: SeatingApi;
  /** The layout for the snapshot currently being applied / last applied. */
  getLayout(): OfficeLayout;
  /** Smoothly re-frame the camera on a point (e.g. on phase change). */
  focusCamera(target: Vec2, viewHeight?: number, seconds?: number): void;
}

export interface WorldSystem {
  /**
   * Called on every game-state change, in system order (office → people → fx).
   * `prev` is null on the first call: build the scene instantly, with no
   * entrance animations. `events` describes what changed since `prev`.
   */
  applySnapshot(next: WorldSnapshot, prev: WorldSnapshot | null, events: readonly WorldEvent[]): void;
  /** Per frame. `dt` is seconds since last frame (clamped to ≤ 0.1); `elapsed` is total seconds. */
  update(dt: number, elapsed: number): void;
  /** Remove everything this system added to the scene and free GPU resources. */
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// React-facing handle
// ─────────────────────────────────────────────────────────────────────────────

/** CSS pixels relative to the canvas's top-left corner. */
export interface ScreenPoint {
  x: number;
  y: number;
}

export interface InteractableHit {
  target: InteractableTarget;
  label: string;
  /** Projected anchor position (not the pointer position). */
  screen: ScreenPoint;
}

export interface WorldCallbacks {
  onHover(hit: InteractableHit | null): void;
  /** Click / tap on an interactable (or on empty space → null). */
  onSelect(hit: InteractableHit | null): void;
  /** The selected target's projected anchor moved (camera pan/zoom, person walking). null = no longer visible. */
  onSelectedAnchorMove?(screen: ScreenPoint | null): void;
  onContextLost?(): void;
}

export interface WorldOptions {
  quality?: QualityLevel;
  reducedMotion?: boolean;
}

export interface WorldHandle {
  /** Push the latest game state. `events` should come from deriveWorldEvents(prev, next, action). */
  setSnapshot(next: WorldSnapshot, events?: readonly WorldEvent[]): void;
  /** Canvas CSS size changed. */
  resize(width: number, height: number): void;
  /** Highlight a target as selected (null clears). */
  setSelected(target: InteractableTarget | null): void;
  /** Projected anchor of a target, or null if it is not in the scene. */
  project(target: InteractableTarget): ScreenPoint | null;
  /** Multiply the current zoom (>1 zooms in). Clamped to sane limits. */
  zoomBy(factor: number): void;
  /** Return to the phase's default framing. */
  resetCamera(): void;
  /** Pause/resume the render loop (tab hidden, canvas off-screen). */
  setPaused(paused: boolean): void;
  dispose(): void;
}
