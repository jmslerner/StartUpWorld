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

// ─────────────────────────────────────────────────────────────────────────────
// World events: discrete "something happened" cues derived from snapshot diffs
// ─────────────────────────────────────────────────────────────────────────────

export type WorldEvent =
  | { type: "run-reset" }
  | { type: "setup-completed" }
  | { type: "week-advanced"; week: number }
  /**
   * `personIds` are the people who now have a visible place in the office (capped);
   * `count` is the true head-count change for the role (absent = `personIds.length`).
   */
  | { type: "hired"; role: TeamRole; personIds: string[]; count?: number }
  | { type: "departed"; role: TeamRole; personIds: string[]; count?: number }
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
  | { type: "game-over"; ending: EndingType }
  // ── People and product builds ──
  /** Somebody handed in notice: a recruiter's offer, or burnout. */
  | { type: "offer-landed"; personId: string; kind: OfferKind; buildAtRisk: string | null }
  /** A person holding an offer was kept (`retain`). */
  | { type: "retained"; personId: string }
  /**
   * Somebody who was holding an offer walked out (follows their `departed`). `buildAtRisk` is the
   * slug of the build that lost its lead (and a quarter of its progress) with them.
   */
  | { type: "resigned"; personId: string; role: TeamRole; kind: OfferKind; buildAtRisk: string | null }
  /** Somebody was put on a build (or back on the day job: buildId null). */
  | { type: "staffed"; personId: string; buildId: string | null }
  /** Credited on a release. */
  | { type: "experience"; personIds: string[] }
  | { type: "energy-band"; personId: string; band: EnergyBand }
  | { type: "candidates-shown"; role: TeamRole }
  | { type: "build-started"; buildId: string }
  | { type: "build-cancelled"; buildId: string }
  /** A build shipped as a release (replaces the `ship` event for that command). */
  | { type: "released"; buildId: string; name: string; tier: ReceptionTier; reception: number }
  /** `to < from`: a lead walked out and took a quarter of the work with them. */
  | { type: "build-progress"; buildId: string; from: number; to: number }
  | { type: "surprise"; buildId: string }
  | { type: "crunch-changed"; buildId: string; on: boolean }
  | { type: "cruft-band"; band: CruftBand; rising: boolean }
  | { type: "moat-band"; band: MoatBand; rising: boolean };

/** Cruft at 15 / 35 / 60. */
export type CruftBand = "clean" | "taped" | "spaghetti" | "sparking";
/** Moat at 10 / 25 / 50. */
export type MoatBand = "puddle" | "ditch" | "moat" | "alligator";

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
  /**
   * Reference framing for this phase at a 3:2 viewport. The camera rig does not
   * read it directly: it frames from getLayoutFrame() so the shot adapts to the
   * canvas aspect and to owned outdoor assets.
   */
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

/** One person's move in the most recent seating reconcile. */
export interface SeatChange {
  personId: string;
  /** Where they were. null = nowhere visible (a new hire, or somebody the office had no room for). */
  from: Seat | null;
  /**
   * Where they are now. null = nowhere visible: they either left the company
   * (no longer in the roster) or the new office has no room for them.
   */
  to: Seat | null;
}

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
  /** Who moved, arrived or left in the most recent reconcile (empty when nothing changed). */
  lastChanges(): readonly SeatChange[];
  /** Person id sitting at layout.deskSeats[slotIndex], or null when that desk is empty. */
  deskOccupant(slotIndex: number): string | null;
  /** Person id at layout.overflowSpots[slotIndex], or null when that spot is empty. */
  overflowOccupant(slotIndex: number): string | null;
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
  /**
   * Skip the built-in hover/selection highlight (for objects that manage their own look).
   *
   * Picking notes: only objects attached to the scene and visible are hit. To give a small
   * or hollow object a generous click area, add a child mesh with `visible = false` and
   * `userData.hitProxy = true` — it is pickable while its parent is shown.
   */
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
  /**
   * Small icon bubble that follows `anchor` for `seconds` (default 2.2) then pops.
   * `heightOffset` defaults to 0: the bubble's tail tip sits on the anchor, which is what a
   * character's head anchor wants. For an object whose origin is on the floor pass ≈ 1.7.
   */
  bubble(anchor: THREE.Object3D, icon: BubbleIcon, seconds?: number, heightOffset?: number): void;
  /** Brief camera shake; `strength` 0..1. No-op when reduced motion is on. */
  shake(strength: number): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// System plumbing
// ─────────────────────────────────────────────────────────────────────────────

export type QualityLevel = "low" | "high";

/**
 * Live facts one system publishes for the others to read each frame — the few
 * places where the systems have to act in step without knowing each other.
 */
export interface WorldSignals {
  /**
   * How many people are walking through the doorway right now (arriving or
   * leaving). Written by the people system every frame; the office holds the
   * front door open while it is above zero.
   */
  doorTraffic: number;
  /**
   * The desk chairs somebody is using, and how far each is pulled out: 0 (sitting in
   * it) … 1 (rolled back out of the way: getting up, sitting down, or away from the
   * desk). Keyed by `chairKey(seat)`: the desk's slot index, or −1 / −2 for the
   * founder's / cofounder's chair. A chair nobody is using is not listed (the office
   * tucks it in). Rewritten in place by the people system every frame; absent while
   * there is no people system.
   */
  chairsOut?: ReadonlyMap<number, number>;
  /**
   * People who still hold a seat in the seating plan but are no longer in the office
   * (after a lost run the staff go home). Their desks look vacant. Replaced — never
   * modified — whenever its contents change, so readers can compare by reference.
   */
  vacated?: ReadonlySet<string>;
}

export interface WorldContext {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly quality: QualityLevel;
  readonly reducedMotion: boolean;
  readonly interactables: InteractableRegistry;
  readonly fx: FxApi;
  readonly seating: SeatingApi;
  readonly signals: WorldSignals;
  /** The layout for the snapshot currently being applied / last applied. */
  getLayout(): OfficeLayout;
  /** Smoothly re-frame the camera on a point (e.g. on phase change). */
  focusCamera(target: Vec2, viewHeight?: number, seconds?: number): void;
  /**
   * Where systems report the moments only they can time (see WorldSoundListener), in world
   * coordinates. Absent unless the app asked for them: systems call it with `?.`.
   */
  readonly sound?: WorldSoundSink;
}

/** The world-coordinate side of WorldSoundListener, for systems (positions on the ground). */
export interface WorldSoundSink {
  /** Footsteps from `from` toward `to`; `approach` +1 arriving, −1 leaving, 0 passing by. */
  footsteps(from: Vec2, to: Vec2, steps: number, approach: number): void;
  /** Somebody sat down at `at` after walking in. */
  chairSit(at: Vec2): void;
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

/** An axis-aligned rectangle in the same CSS-pixel space as ScreenPoint. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface WorldFocusOptions {
  /**
   * CSS pixels at the bottom of the canvas that are covered (a docked card):
   * the target is brought into the area above them.
   */
  avoidBottomPx?: number;
  /** CSS pixels at the top of the canvas that are covered (the HUD row). */
  avoidTopPx?: number;
  /** Glide length in seconds (snaps under reduced motion). */
  seconds?: number;
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
  /** The WebGL context came back after a loss; the world has already resumed rendering. */
  onContextRestored?(): void;
  /**
   * The zoom actually changed by `factor` (> 1 closer) because of the player: a wheel notch, a
   * pinch, or WorldHandle.zoomBy. Not called at the zoom limits, nor for camera moves the
   * world makes by itself (re-framing, reset).
   */
  onZoom?(factor: number): void;
}

/** Where on screen a sound comes from: −1 the canvas's left edge … 1 its right edge (kept moderate). */
export interface WorldSoundCue {
  pan: number;
}

export interface WorldFootstepsCue extends WorldSoundCue {
  /** How many steps to play (1–6). */
  steps: number;
  /** +1 arriving (swells), −1 leaving (fades), 0 passing by. */
  approach: number;
  /** Where the walker is heading, on the same scale as `pan`. */
  panTo: number;
}

/**
 * Optional listener for the sounds only the world can time: real footsteps, a chair taking a
 * new arrival's weight, a thought bubble popping up, and the lighting's time of day. The
 * world behaves exactly the same with or without it; every method is optional and a listener
 * that throws is ignored.
 */
export interface WorldSoundListener {
  /**
   * Somebody walks through the front door: an arrival a couple of seconds before reaching
   * their seat (approach +1), somebody leaving as they set off (−1), and the founder's
   * `coffee` errand there and back (0). Ordinary wandering stays silent.
   */
  onFootsteps?(cue: WorldFootstepsCue): void;
  /** An arrival sits down at their desk. */
  onChairSit?(cue: WorldSoundCue): void;
  /** A thought bubble pops up over somebody's head. */
  onBubble?(cue: WorldSoundCue): void;
  /** The lighting's dusk amount (0 daylight … 1 dusk and night) whenever it has moved noticeably. */
  onDusk?(amount: number): void;
}

export interface WorldOptions {
  quality?: QualityLevel;
  reducedMotion?: boolean;
  /** Optional: report sound-worthy moments (see WorldSoundListener). */
  sound?: WorldSoundListener;
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
  /** Where a target is drawn: the projected box around its visible meshes and its anchor. Null if not in the scene. */
  screenBounds(target: InteractableTarget): ScreenRect | null;
  /**
   * Pan (never zoom) so the target sits in the visible part of the canvas, e.g.
   * above a docked card. Does nothing when it is already comfortably in view.
   */
  focus(target: InteractableTarget, options?: WorldFocusOptions): void;
  /** Indices into the current layout's desks that nobody sits at, lowest first. */
  freeDeskSlots(): readonly number[];
  /** People on the team the office has no visible spot for (the overflow sign's count). */
  hiddenCount(): number;
  /** Multiply the current zoom (>1 zooms in). Clamped to sane limits. */
  zoomBy(factor: number): void;
  /** Return to the phase's default framing. */
  resetCamera(): void;
  /** Pause/resume the render loop (tab hidden, canvas off-screen). */
  setPaused(paused: boolean): void;
  dispose(): void;
}
