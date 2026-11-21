/**
 * Dev sandbox for the 3D world: /world-preview (dev server only).
 *
 * It fabricates a GameState from query parameters, shows it through the real
 * createWorld(), and offers buttons that mutate the state and push hand-built
 * WorldEvents — so every reaction in the world can be exercised without playing
 * the game (and without depending on events.ts).
 *
 * Query parameters
 *   phase=garage|coworking|office|unicorn|public
 *   team=eng:5,design:2,sales:3     role tokens are TeamRole keys (or eng/ux/pm/mkt/exec, or any unique prefix)
 *   n=12                            spread this many hires evenly over all roles (ignored when team= is given)
 *   assets=lounge,helicopter        owned assets
 *   ap=1  morale=20  stress=80      numbers
 *   runway=low                      three weeks of cash left
 *   event=1                         a pending event
 *   setup=0                         setup not completed yet
 *   over=ipo|bankruptcy|…           game over with that ending
 *   quality=low|high  motion=reduced
 *   ui=0                            hide the panels (clean screenshots)
 *
 * Scripting (used by the screenshot harness)
 *   window.__preview.fire(name, arg?)   every button is an action; see ACTION_GROUPS and PreviewController
 *   window.__preview.snapshot()         the WorldSnapshot currently shown
 *   window.__preview.world()            the WorldHandle
 *   window.__preview.stats()            draw calls, particles, zoom, GPU resource counts, duskAmount…
 *   window.__preview.debug()            the live WorldContext / camera rig / renderer, for poking at the scene
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createInitialState } from "../../engine";
import { ASSET_CATALOG } from "../../engine/assets";
import { calcBurn, calcNetBurn, getEffectiveMaxAp, roleComp } from "../../engine/economy";
import type {
  AssetId,
  CompanyPhase,
  EndingType,
  GameState,
  PendingEvent,
  Stage,
  TeamRole,
  TeamRoster,
} from "../../types/game";
import { getLightingState } from "../core/Lighting";
import { createWorld, inspectWorld, WorldUnsupportedError } from "../core/World";
import type { WorldDebug } from "../core/World";
import { BUBBLE_ICONS } from "../fx/bubbleIcons";
import type { FxSystem } from "../fx/FxSystem";
import { BURST_KINDS } from "../fx/particles";
import { buildWorldSnapshot } from "../snapshot";
import { targetKey } from "../targets";
import type {
  BubbleIcon,
  BurstKind,
  FloatTone,
  InteractableHit,
  QualityLevel,
  ScreenPoint,
  Vec3Like,
  WorldCallbacks,
  WorldEvent,
  WorldHandle,
  WorldSnapshot,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic game state
// ─────────────────────────────────────────────────────────────────────────────

const PHASES: readonly CompanyPhase[] = ["garage", "coworking", "office", "unicorn", "public"];
const ROLES: readonly TeamRole[] = [
  "engineering",
  "design",
  "product",
  "data",
  "marketing",
  "sales",
  "ops",
  "hr",
  "legal",
  "executive",
];
const ROLE_ALIASES: Record<string, TeamRole> = {
  eng: "engineering",
  ux: "design",
  pm: "product",
  mkt: "marketing",
  exec: "executive",
};
const ENDINGS: readonly EndingType[] = [
  "ipo",
  "acquisition",
  "ai-hype-exit",
  "bankruptcy",
  "founder-removal",
  "zombie-saas",
  "forced-acquisition",
];
const ASSET_IDS = Object.keys(ASSET_CATALOG) as AssetId[];
const FLOAT_SAMPLES: Record<FloatTone, string> = {
  good: "+12 rep",
  bad: "−$3,000",
  neutral: "Week 7",
  cash: "+$1.2M",
};
const FLOAT_TONES = Object.keys(FLOAT_SAMPLES) as FloatTone[];

/** A plausible funding stage for each phase, so AP limits and raise sizes look right. */
const STAGE_FOR_PHASE: Record<CompanyPhase, Stage> = {
  garage: "garage",
  coworking: "seed",
  office: "series-a",
  unicorn: "growth",
  public: "growth",
};
const NEXT_STAGE: Record<Stage, Stage> = { garage: "seed", seed: "series-a", "series-a": "growth", growth: "growth" };
const RAISE_FOR_STAGE: Record<Stage, number> = {
  garage: 150_000,
  seed: 1_500_000,
  "series-a": 8_000_000,
  growth: 40_000_000,
};

const SAMPLE_EVENT: PendingEvent = {
  id: "preview-event",
  title: "A journalist is on the line",
  prompt: "They want a quote about your burn rate.",
  choices: [
    { id: "talk", text: "Talk" },
    { id: "decline", text: "Decline" },
  ],
};

const includes = <T extends string>(list: readonly T[], value: string | null | undefined): value is T =>
  value != null && (list as readonly string[]).includes(value);

const resolveRole = (token: string): TeamRole | null => {
  const key = token.trim().toLowerCase();
  if (includes(ROLES, key)) return key;
  if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];
  const matches = key ? ROLES.filter((role) => role.startsWith(key)) : [];
  return matches.length === 1 ? matches[0] : null;
};

const emptyRoster = (): TeamRoster => ({
  engineering: 0,
  design: 0,
  marketing: 0,
  sales: 0,
  ops: 0,
  hr: 0,
  legal: 0,
  data: 0,
  product: 0,
  executive: 0,
});

const parseTeam = (params: URLSearchParams): TeamRoster | null => {
  const spec = params.get("team");
  if (spec) {
    const team = emptyRoster();
    for (const part of spec.split(",")) {
      const [token, amount = "1"] = part.split(":");
      const role = resolveRole(token);
      const count = Number.parseInt(amount, 10);
      if (role && Number.isFinite(count)) team[role] += Math.max(0, count);
    }
    return team;
  }
  const total = Number.parseInt(params.get("n") ?? "", 10);
  if (!Number.isFinite(total)) return null;
  const team = emptyRoster();
  for (let i = 0; i < Math.max(0, total); i += 1) team[ROLES[i % ROLES.length]] += 1;
  return team;
};

const numberParam = (params: URLSearchParams, name: string): number | null => {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/** `burn` is a derived field the engine keeps in step with the team; the sandbox must do the same. */
const withDerived = (state: GameState): GameState => ({ ...state, burn: calcBurn(state) });

const setupFields = (state: GameState, complete: boolean): GameState => ({
  ...state,
  companyName: complete ? "Preview Labs" : "",
  founder: { name: complete ? "Robin" : "", archetype: complete ? "hacker" : null },
  cofounder: { ...state.cofounder, name: "Sam", archetype: complete ? "operator" : null },
});

const stateFromParams = (params: URLSearchParams): GameState => {
  const phaseParam = params.get("phase");
  const phase: CompanyPhase = includes(PHASES, phaseParam) ? phaseParam : "garage";
  const base = createInitialState();

  let state = setupFields(base, params.get("setup") !== "0");
  state = {
    ...state,
    companyPhase: phase,
    stage: STAGE_FOR_PHASE[phase],
    team: parseTeam(params) ?? base.team,
    assets: (params.get("assets") ?? "")
      .split(",")
      .filter((id): id is AssetId => includes(ASSET_IDS, id))
      .map((id) => ({ id, name: ASSET_CATALOG[id].name, purchaseWeek: 1 })),
    culture: { ...base.culture, morale: numberParam(params, "morale") ?? base.culture.morale },
    stress: numberParam(params, "stress") ?? base.stress,
    pendingEvent: params.get("event") === "1" ? SAMPLE_EVENT : null,
  };
  state = withDerived(state);

  const ap = numberParam(params, "ap");
  state = { ...state, ap: ap === null ? getEffectiveMaxAp(state) : Math.max(0, ap) };
  if (params.get("runway") === "low") state = { ...state, cash: Math.max(1, calcNetBurn(state)) * 3 };

  const over = params.get("over");
  if (includes(ENDINGS, over)) {
    state = { ...state, gameOver: { ending: over, week: state.week, headline: "Preview ending" } };
  }
  return state;
};

interface PreviewConfig {
  initial: GameState;
  quality: QualityLevel | undefined;
  reducedMotion: boolean | undefined;
  showUi: boolean;
}

const readConfig = (): PreviewConfig => {
  const params = new URLSearchParams(window.location.search);
  const quality = params.get("quality");
  return {
    initial: stateFromParams(params),
    quality: quality === "low" || quality === "high" ? quality : undefined,
    reducedMotion: params.get("motion") === "reduced" ? true : undefined,
    showUi: params.get("ui") !== "0",
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Controller: applies actions to the state and tells the world what happened
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewStats {
  drawCalls: number;
  triangles: number;
  particles: number;
  /** Live GPU resources; these should stay flat over a long session (leak check). */
  geometries: number;
  textures: number;
  programs: number;
  zoom: number;
  viewHeight: number;
  /** LightingState.duskAmount, as the other systems read it. */
  duskAmount: number;
}

interface PreviewApi {
  fire(name: string, arg?: string): void;
  snapshot(): WorldSnapshot;
  world(): WorldHandle;
  stats(): PreviewStats;
  /**
   * The world's internals. Scripts must come through here rather than
   * importing World.ts themselves: a second copy of the module (which is what a
   * dynamic import in the console gets after any hot update) knows no worlds.
   */
  debug(): WorldDebug | null;
}

type PreviewWindow = Window & { __preview?: PreviewApi };

type Action = (arg?: string) => void;

class PreviewController {
  state: GameState;
  snapshot: WorldSnapshot;

  private readonly world: WorldHandle;
  private readonly onChange: (snapshot: WorldSnapshot) => void;
  private readonly actions: Record<string, Action>;
  /** Fixed points in mid-air to hang demo bubbles on. Created on first use. */
  private bubbleAnchors: THREE.Group | null = null;
  /** Pale floor + back walls for judging the lighting on bright surfaces. */
  private shell: THREE.Group | null = null;

  constructor(world: WorldHandle, initial: GameState, onChange: (snapshot: WorldSnapshot) => void) {
    this.world = world;
    this.onChange = onChange;
    this.state = withDerived(initial);
    this.snapshot = buildWorldSnapshot(this.state);
    world.setSnapshot(this.snapshot);

    this.actions = {
      // Game actions (each pushes hand-built events)
      hire: (arg) => this.hire(resolveRole(arg ?? "") ?? "engineering"),
      fire: (arg) => this.dismiss(resolveRole(arg ?? "") ?? "engineering"),
      "ship-ok": () => this.ship(true),
      "ship-fail": () => this.ship(false),
      "launch-ok": () => this.launch(true),
      "launch-fail": () => this.launch(false),
      "pitch-ok": () => this.commit(this.spendAp(this.state), [{ type: "pitch", ok: true }]),
      "pitch-fail": () => this.commit(this.spendAp(this.state), [{ type: "pitch", ok: false }]),
      "raise-ok": () => this.raise(true),
      "raise-fail": () => this.raise(false),
      "board-ok": () => this.commit(this.state, [{ type: "board-action", action: "dinner", ok: true }]),
      "board-fail": () => this.commit(this.state, [{ type: "board-action", action: "blackmail", ok: false }]),
      pricing: () => this.commit(this.state, [{ type: "pricing-changed" }]),
      "end-week": () => this.endWeek(),
      "next-phase": () => this.shiftPhase(1),
      "prev-phase": () => this.shiftPhase(-1),
      "buy-asset": () => this.buyAsset(),
      event: () => this.toggleEvent(),
      coffee: () => this.commit(this.state, [{ type: "easter-egg", command: "coffee" }]),
      "command-failed": () => this.commit(this.state, [{ type: "command-failed", command: "ship" }]),
      win: (arg) => this.endRun(includes(ENDINGS, arg) ? arg : "ipo"),
      loss: (arg) => this.endRun(includes(ENDINGS, arg) ? arg : "bankruptcy"),
      reset: () => this.resetRun(),
      setup: () => this.toggleSetup(),
      ap: (arg) => this.commit({ ...this.state, ap: Math.max(0, Number(arg ?? 0) || 0) }, []),
      // Direct FX (bypass events; for looking at one effect in isolation)
      burst: (arg) => this.demoBurst(includes(BURST_KINDS, arg) ? arg : "confetti"),
      stream: (arg) => this.demoStream(includes(BURST_KINDS, arg) ? arg : "users"),
      float: (arg) => this.demoFloat(includes(FLOAT_TONES, arg) ? arg : "good"),
      floats: () => FLOAT_TONES.forEach((tone) => this.demoFloat(tone)),
      bubble: (arg) => this.demoBubbles(includes(BUBBLE_ICONS, arg) ? [arg] : BUBBLE_ICONS.slice(0, 1)),
      bubbles: () => this.demoBubbles(BUBBLE_ICONS),
      shake: (arg) => this.fx()?.shake(Number(arg ?? 0.4) || 0.4),
      shell: () => this.toggleShell(),
      // Camera + lifecycle
      "zoom-in": () => this.world.zoomBy(1.25),
      "zoom-out": () => this.world.zoomBy(0.8),
      "reset-camera": () => this.world.resetCamera(),
      pause: () => this.world.setPaused(true),
      resume: () => this.world.setPaused(false),
    };
  }

  fire(name: string, arg?: string): void {
    const action = this.actions[name];
    if (!action) {
      console.warn(`[world-preview] unknown action "${name}"`);
      return;
    }
    action(arg);
  }

  stats(): PreviewStats {
    const debug = inspectWorld(this.world);
    const info = debug?.renderer.info;
    return {
      drawCalls: info?.render.calls ?? 0,
      triangles: info?.render.triangles ?? 0,
      particles: this.fx()?.particles.activeCount ?? 0,
      geometries: info?.memory.geometries ?? 0,
      textures: info?.memory.textures ?? 0,
      programs: info?.programs?.length ?? 0,
      zoom: debug?.rig.zoom ?? 1,
      viewHeight: debug?.rig.viewHeight ?? 0,
      duskAmount: debug ? getLightingState(debug.ctx.scene).duskAmount : 0,
    };
  }

  dispose(): void {
    this.bubbleAnchors?.removeFromParent();
    this.bubbleAnchors = null;
    this.removeShell();
  }

  // ── State changes ─────────────────────────────────────────────────────────

  private commit(next: GameState, events: WorldEvent[]): void {
    this.state = withDerived(next);
    this.snapshot = buildWorldSnapshot(this.state);
    this.world.setSnapshot(this.snapshot, events);
    this.onChange(this.snapshot);
  }

  private spendAp(state: GameState): GameState {
    return { ...state, ap: Math.max(0, state.ap - 1) };
  }

  private hire(role: TeamRole): void {
    const count = this.state.team[role];
    const cost = roleComp[role].hireCost;
    const next = this.spendAp({
      ...this.state,
      team: { ...this.state.team, [role]: count + 1 },
      cash: this.state.cash - cost,
    });
    this.commit(next, [
      { type: "hired", role, personIds: [`${role}-${count}`] },
      { type: "cash-changed", delta: -cost },
    ]);
  }

  private dismiss(role: TeamRole): void {
    const count = this.state.team[role];
    if (count === 0) return;
    this.commit({ ...this.state, team: { ...this.state.team, [role]: count - 1 } }, [
      { type: "departed", role, personIds: [`${role}-${count - 1}`] },
    ]);
  }

  private ship(ok: boolean): void {
    const delta = ok ? 4 : -3;
    const reputation = Math.min(100, Math.max(0, this.state.reputation + delta));
    this.commit(this.spendAp({ ...this.state, reputation }), [{ type: "ship", ok, reputationDelta: delta }]);
  }

  private launch(ok: boolean): void {
    const usersDelta = ok ? 340 : 0;
    const spend = 900;
    const next = this.spendAp({ ...this.state, users: this.state.users + usersDelta, cash: this.state.cash - spend });
    const events: WorldEvent[] = [{ type: "launch", ok, usersDelta }];
    if (usersDelta > 0) events.push({ type: "users-changed", delta: usersDelta });
    events.push({ type: "cash-changed", delta: -spend });
    this.commit(next, events);
  }

  private raise(ok: boolean): void {
    const { stage } = this.state;
    const amount = RAISE_FOR_STAGE[stage];
    if (!ok) {
      this.commit(this.spendAp(this.state), [{ type: "raise", ok: false, amount, source: "vc" }]);
      return;
    }
    const nextStage = NEXT_STAGE[stage];
    const events: WorldEvent[] = [
      { type: "raise", ok: true, amount, source: "vc" },
      { type: "cash-changed", delta: amount },
    ];
    if (nextStage !== stage) events.push({ type: "stage-changed", from: stage, to: nextStage });
    this.commit(this.spendAp({ ...this.state, cash: this.state.cash + amount, stage: nextStage }), events);
  }

  private endWeek(): void {
    const burn = calcNetBurn(this.state);
    const usersDelta = Math.round(this.state.users * 0.06);
    const next: GameState = {
      ...this.state,
      week: this.state.week + 1,
      cash: this.state.cash - burn,
      users: this.state.users + usersDelta,
    };
    this.commit({ ...next, ap: getEffectiveMaxAp(next) }, [
      { type: "week-advanced", week: next.week },
      { type: "cash-changed", delta: -burn },
      { type: "users-changed", delta: usersDelta },
    ]);
  }

  private shiftPhase(step: number): void {
    const from = this.state.companyPhase;
    const to = PHASES[Math.min(PHASES.length - 1, Math.max(0, PHASES.indexOf(from) + step))];
    if (to === from) return;
    this.commit({ ...this.state, companyPhase: to, stage: STAGE_FOR_PHASE[to] }, [{ type: "phase-changed", from, to }]);
  }

  private buyAsset(): void {
    const assetId = this.snapshot.availableAssets[0];
    if (!assetId) return;
    const definition = ASSET_CATALOG[assetId];
    const next: GameState = {
      ...this.state,
      cash: this.state.cash - definition.cost,
      assets: [...this.state.assets, { id: assetId, name: definition.name, purchaseWeek: this.state.week }],
    };
    this.commit(next, [
      { type: "asset-acquired", assetId },
      { type: "cash-changed", delta: -definition.cost },
    ]);
  }

  private toggleEvent(): void {
    if (this.state.pendingEvent) {
      this.commit({ ...this.state, pendingEvent: null }, [{ type: "event-resolved" }]);
    } else {
      this.commit({ ...this.state, pendingEvent: SAMPLE_EVENT }, [{ type: "event-opened", title: SAMPLE_EVENT.title }]);
    }
  }

  private toggleSetup(): void {
    const complete = !this.snapshot.setupComplete;
    this.commit(setupFields(this.state, complete), complete ? [{ type: "setup-completed" }] : []);
  }

  private endRun(ending: EndingType): void {
    const gameOver = { ending, week: this.state.week, headline: "Preview ending" };
    this.commit({ ...this.state, gameOver }, [{ type: "game-over", ending }]);
  }

  private resetRun(): void {
    const fresh = setupFields(createInitialState(), true);
    // createInitialState seeds from the clock; make sure the run id really differs.
    const seed = fresh.seed === this.state.seed ? fresh.seed + 1 : fresh.seed;
    this.commit({ ...fresh, seed }, [{ type: "run-reset" }]);
  }

  // ── FX demos ──────────────────────────────────────────────────────────────

  private fx(): FxSystem | null {
    // The sandbox knows the concrete class behind ctx.fx; app code only ever sees FxApi.
    return (inspectWorld(this.world)?.ctx.fx as FxSystem | undefined) ?? null;
  }

  /** A point above the middle of the floor. */
  private floorPoint(y: number): Vec3Like {
    const floor = inspectWorld(this.world)?.ctx.getLayout().floor;
    if (!floor) return { x: 0, y, z: 0 };
    return { x: (floor.minX + floor.maxX) / 2, y, z: (floor.minZ + floor.maxZ) / 2 };
  }

  private demoBurst(kind: BurstKind): void {
    this.fx()?.burst(kind, this.floorPoint(1.2), 1);
  }

  private demoStream(kind: BurstKind): void {
    const layout = inspectWorld(this.world)?.ctx.getLayout();
    if (!layout) return;
    const { door, stations } = layout;
    this.fx()?.stream(kind, { x: door.x, y: 0.3, z: door.z }, { x: stations.servers.x, y: 1, z: stations.servers.z }, 12);
  }

  private demoFloat(tone: FloatTone): void {
    this.fx()?.floatText(FLOAT_SAMPLES[tone], this.floorPoint(1.4), tone);
  }

  /**
   * The stub office is dark boxes on a dark slab, which says little about how
   * the lighting treats the pale floors and off-white walls of the real thing.
   * This drops a light floor and the two back walls over the current layout.
   */
  private toggleShell(): void {
    if (this.shell?.parent) {
      this.removeShell();
      return;
    }
    const debug = inspectWorld(this.world);
    if (!debug) return;
    const { minX, maxX, minZ, maxZ } = debug.ctx.getLayout().floor;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const wallHeight = 2.6;
    const wallThickness = 0.2;
    const shell = new THREE.Group();
    shell.name = "preview-shell";
    const slab = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      shell.add(mesh);
    };
    slab(width, 0.04, depth, 0xd9c7a8, (minX + maxX) / 2, 0.02, (minZ + maxZ) / 2);
    slab(wallThickness, wallHeight, depth + wallThickness, 0xf1ece4, minX - wallThickness / 2, wallHeight / 2, (minZ + maxZ) / 2 - wallThickness / 2);
    slab(width, wallHeight, wallThickness, 0xf1ece4, (minX + maxX) / 2, wallHeight / 2, minZ - wallThickness / 2);
    debug.ctx.scene.add(shell);
    this.shell = shell;
  }

  private removeShell(): void {
    const shell = this.shell;
    if (!shell) return;
    this.shell = null;
    shell.removeFromParent();
    shell.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      (node.material as THREE.Material).dispose();
    });
  }

  /** Lay the given icons out on a camera-facing grid above the floor. */
  private demoBubbles(icons: readonly BubbleIcon[]): void {
    const debug = inspectWorld(this.world);
    if (!debug) return;
    if (!this.bubbleAnchors) {
      this.bubbleAnchors = new THREE.Group();
      this.bubbleAnchors.name = "preview-bubble-anchors";
      for (let i = 0; i < BUBBLE_ICONS.length; i += 1) this.bubbleAnchors.add(new THREE.Object3D());
    }
    // A run reset sweeps everything it does not recognise out of the scene, including these.
    if (this.bubbleAnchors.parent !== debug.ctx.scene) debug.ctx.scene.add(this.bubbleAnchors);
    const centre = this.floorPoint(0);
    const columns = 5;
    icons.forEach((icon, i) => {
      const anchor = this.bubbleAnchors?.children[i];
      if (!anchor) return;
      const column = (i % columns) - (columns - 1) / 2;
      const row = Math.floor(i / columns);
      // (1, 0, −1) is screen-right for the isometric camera.
      anchor.position.set(centre.x + column * 0.95, 3.1 - row * 1.25, centre.z - column * 0.95);
      debug.ctx.fx.bubble(anchor, icon, 8, 0);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────

interface ActionButton {
  label: string;
  name: string;
  arg?: string;
}

const ACTION_GROUPS: ReadonlyArray<{ title: string; actions: readonly ActionButton[] }> = [
  {
    title: "work",
    actions: [
      { label: "ship ok", name: "ship-ok" },
      { label: "ship fail", name: "ship-fail" },
      { label: "launch ok", name: "launch-ok" },
      { label: "launch fail", name: "launch-fail" },
      { label: "pitch ok", name: "pitch-ok" },
      { label: "pitch fail", name: "pitch-fail" },
      { label: "raise ok", name: "raise-ok" },
      { label: "raise fail", name: "raise-fail" },
      { label: "board ok", name: "board-ok" },
      { label: "board fail", name: "board-fail" },
      { label: "coffee", name: "coffee" },
    ],
  },
  {
    title: "company",
    actions: [
      { label: "end week", name: "end-week" },
      { label: "prev phase", name: "prev-phase" },
      { label: "next phase", name: "next-phase" },
      { label: "buy asset", name: "buy-asset" },
      { label: "event", name: "event" },
      { label: "setup", name: "setup" },
      { label: "win", name: "win" },
      { label: "loss", name: "loss" },
      { label: "reset run", name: "reset" },
    ],
  },
  {
    title: "fx",
    actions: [
      ...BURST_KINDS.map((kind) => ({ label: kind, name: "burst", arg: kind })),
      { label: "stream", name: "stream", arg: "users" },
      { label: "floats", name: "floats" },
      { label: "bubbles", name: "bubbles" },
      { label: "shake", name: "shake", arg: "0.6" },
    ],
  },
  {
    title: "view",
    actions: [
      { label: "zoom +", name: "zoom-in" },
      { label: "zoom −", name: "zoom-out" },
      { label: "reset cam", name: "reset-camera" },
      { label: "test walls", name: "shell" },
      { label: "pause", name: "pause" },
      { label: "resume", name: "resume" },
    ],
  },
];

const BUTTON_CLASS =
  "rounded border border-white/10 bg-steel/50 px-1.5 py-0.5 text-[0.65rem] leading-4 text-slate-100 hover:bg-steel active:bg-neon/30";

const summarise = (snapshot: WorldSnapshot): string =>
  [
    snapshot.phase,
    `week ${snapshot.week}`,
    `AP ${snapshot.ap}/${snapshot.maxAp}`,
    `team ${snapshot.teamSize}`,
    `$${Math.round(snapshot.cash).toLocaleString()}`,
    snapshot.setupComplete ? null : "setup pending",
    snapshot.pendingEventTitle ? "event pending" : null,
    snapshot.gameOver ? `over: ${snapshot.gameOver}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

const describeHit = (hit: InteractableHit | null): string => (hit ? `${hit.label} (${targetKey(hit.target)})` : "—");

const WorldPreview = () => {
  const [config] = useState(readConfig);
  const [generation, setGeneration] = useState(0);
  const [role, setRole] = useState<TeamRole>("engineering");
  const [summary, setSummary] = useState(() => summarise(buildWorldSnapshot(config.initial)));
  const [hovered, setHovered] = useState("—");
  const [selected, setSelected] = useState("—");
  const [stats, setStats] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PreviewController | null>(null);
  /** The game state survives a world re-creation (StrictMode remount, "recreate" button). */
  const carriedStateRef = useRef<GameState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;

    const moveMarker = (screen: ScreenPoint | null): void => {
      const marker = markerRef.current;
      if (!marker) return;
      marker.style.display = screen ? "block" : "none";
      if (screen) marker.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
    };

    let world: WorldHandle;
    const callbacks: WorldCallbacks = {
      onHover: (hit) => setHovered(describeHit(hit)),
      onSelect: (hit) => {
        setSelected(describeHit(hit));
        // The world already highlights what was clicked; echoing it back is
        // what the real shell does and must be harmless.
        world.setSelected(hit ? hit.target : null);
      },
      onSelectedAnchorMove: moveMarker,
      onContextLost: () => setError("The WebGL context was lost. It will resume if the browser restores it."),
    };

    try {
      world = createWorld(canvas, callbacks, { quality: config.quality, reducedMotion: config.reducedMotion });
    } catch (cause) {
      const message =
        cause instanceof WorldUnsupportedError
          ? `3D view unavailable: ${cause.message}`
          : `The world failed to start: ${cause instanceof Error ? cause.message : String(cause)}`;
      // Deferred: effects must not set state synchronously.
      queueMicrotask(() => {
        if (active) setError(message);
      });
      return () => {
        active = false;
      };
    }

    const controller = new PreviewController(world, carriedStateRef.current ?? config.initial, (snapshot) =>
      setSummary(summarise(snapshot))
    );
    controllerRef.current = controller;

    const resize = (): void => world.resize(canvas.clientWidth, canvas.clientHeight);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const statsTimer = window.setInterval(() => {
      const { drawCalls, triangles, particles, zoom } = controller.stats();
      setStats(`${drawCalls} draws · ${triangles} tris · ${particles} particles · zoom ${zoom.toFixed(2)}`);
    }, 500);

    const api: PreviewApi = {
      fire: (name, arg) => {
        if (name === "recreate") setGeneration((value) => value + 1);
        else controller.fire(name, arg);
      },
      snapshot: () => controller.snapshot,
      world: () => world,
      stats: () => controller.stats(),
      debug: () => inspectWorld(world),
    };
    (window as PreviewWindow).__preview = api;

    return () => {
      active = false;
      window.clearInterval(statsTimer);
      observer.disconnect();
      if ((window as PreviewWindow).__preview === api) delete (window as PreviewWindow).__preview;
      carriedStateRef.current = controller.state;
      controllerRef.current = null;
      controller.dispose();
      world.dispose();
      moveMarker(null);
    };
  }, [config, generation]);

  const fire = (name: string, arg?: string): void => {
    if (name === "recreate") setGeneration((value) => value + 1);
    else controllerRef.current?.fire(name, arg);
  };

  return (
    <div className="fixed inset-0 overflow-hidden font-mono text-slate-100">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />

      {/* Proves project()/onSelectedAnchorMove: this dot must stay glued to the selected thing. */}
      <div ref={markerRef} className="pointer-events-none absolute left-0 top-0 hidden">
        <div className="-ml-1.5 -mt-1.5 h-3 w-3 rounded-full border-2 border-ink bg-ember shadow" />
      </div>

      {error ? (
        <div className="panel-surface absolute left-1/2 top-1/2 w-[min(90vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      {config.showUi ? (
        <>
          <div className="panel-surface pointer-events-none absolute left-2 top-2 max-w-[calc(100vw-1rem)] rounded-lg px-2.5 py-1.5 text-[0.7rem] leading-5">
            <div className="font-semibold text-white">{summary}</div>
            <div className="text-mist">
              hover: <span className="text-neon">{hovered}</span>
            </div>
            <div className="text-mist">
              selected: <span className="text-ember">{selected}</span>
            </div>
            <div className="text-mist/70">{stats}</div>
          </div>

          <div className="panel-surface absolute inset-x-2 bottom-2 flex max-h-[40vh] flex-wrap items-center gap-x-3 gap-y-1 overflow-y-auto rounded-lg px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[0.6rem] uppercase tracking-wide text-mist/70">team</span>
              <select
                aria-label="Role"
                value={role}
                onChange={(event) => setRole(event.target.value as TeamRole)}
                className="rounded border border-white/10 bg-ink px-1 py-0.5 text-[0.65rem] text-slate-100"
              >
                {ROLES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <button type="button" className={BUTTON_CLASS} onClick={() => fire("hire", role)}>
                hire
              </button>
              <button type="button" className={BUTTON_CLASS} onClick={() => fire("fire", role)}>
                fire
              </button>
            </div>
            {ACTION_GROUPS.map((group) => (
              <div key={group.title} className="flex flex-wrap items-center gap-1">
                <span className="text-[0.6rem] uppercase tracking-wide text-mist/70">{group.title}</span>
                {group.actions.map((action) => (
                  <button
                    key={`${action.name}:${action.arg ?? ""}`}
                    type="button"
                    className={BUTTON_CLASS}
                    onClick={() => fire(action.name, action.arg)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ))}
            <button type="button" className={BUTTON_CLASS} onClick={() => fire("recreate")}>
              recreate world
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default WorldPreview;
