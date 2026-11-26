/**
 * The market drawn on the office's canvas: four lots on a plaza, each company's building as tall as its users, the
 * bar for going public as one translucent plane across them, and the year's new users as dots that stream from a
 * source in front of the lots to whoever won them, then stand at their feet.
 *
 * It is not an office frame: applyFrame does nothing. The world hands it a market scene (show) and tells it when it
 * is on screen (setActive); only then are its companies hoverable and selectable.
 */
import * as THREE from "three";
import { C, EMBER, NEON, bakeModel, darken, lighten, lookFor, modelMesh, PHASE_THEMES } from "../core/palette";
import type { ModelBuilder } from "../core/palette";
import type { MarketCompany, MarketScene, WorldContext, WorldFrame, WorldSystem } from "../types";
import { flowDots, FLOW_DOTS, marketLayout, type MarketLayout, type MarketLot } from "./marketLayout";

/** How long the year's users take to arrive, in seconds. */
export const STREAM_SECONDS = 1.6;
/** Each dot's own trip; the rest of the stream staggers their departures. */
const TRIP_SECONDS = 1;
const DOT_RADIUS = 0.12;
const DOT_ARC = 1.4;
/** Height of one storey of a building. */
const FLOOR_HEIGHT = 0.5;
/** A building's footprint inside its lot. */
const BUILDING_WIDTH = 2.2;
const PLAZA_HEIGHT = 0.08;
/** Rivals' colours, in seat order, skipping the player's. */
const RIVAL_COLORS: readonly number[] = [C.blue, C.coral, C.leaf, C.purple, C.yellow, C.teal];

type MarketContext = Pick<WorldContext, "interactables" | "reducedMotion">;

interface Building {
  readonly company: MarketCompany;
  readonly lot: MarketLot;
  readonly mesh: THREE.Mesh;
}

/** Where a dot rests at the foot of its lot: rows in front of the building. */
const restPoint = (lot: MarketLot, index: number, out: THREE.Vector3): THREE.Vector3 => {
  const perRow = 8;
  const col = index % perRow;
  const row = Math.floor(index / perRow);
  const step = (lot.width - 0.6) / (perRow - 1);
  return out.set(lot.x - (lot.width - 0.6) / 2 + col * step, PLAZA_HEIGHT + DOT_RADIUS, lot.z + lot.width / 2 - 0.25 - row * 0.3);
};

/** Rivals' colours must sit at least this far round the colour wheel from the player's, in degrees. */
const RIVAL_HUE_APART = 30;
const scratchHsl = { h: 0, s: 0, l: 0 };
const hueOf = (colour: number): number => new THREE.Color(colour).getHSL(scratchHsl).h * 360;
const hueApart = (a: number, b: number): number => {
  const d = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return Math.min(d, 360 - d);
};

/** A company's colour: the player's is the era's first accent; each rival's is one well away from it. */
export const colourOf = (company: MarketCompany, player: number): number => {
  if (company.state === "player" || company.seat === 0) return player;
  const grey = new THREE.Color(player).getHSL(scratchHsl).s <= 0.25;
  const apart = RIVAL_COLORS.filter((colour) => colour !== player && (grey || hueApart(colour, player) >= RIVAL_HUE_APART));
  const rivals = apart.length >= 3 ? apart : RIVAL_COLORS.filter((colour) => colour !== player);
  return rivals[(Math.max(1, company.seat) - 1) % rivals.length];
};

const drawLot = (b: ModelBuilder, company: MarketCompany, lot: MarketLot, colour: number): void => {
  const w = lot.width;
  b.box(w, PLAZA_HEIGHT, w, C.paving, 0, 0, 0, { r: 0.02 });
  if (company.state === "out") {
    // A low fence round an empty lot.
    const post = 0.06;
    const fence = 0.35;
    const inset = w / 2 - 0.15;
    for (const [x, z] of [
      [-inset, -inset],
      [inset, -inset],
      [-inset, inset],
      [inset, inset],
    ]) {
      b.box(post, fence, post, C.greyDark, x, PLAZA_HEIGHT, z, { r: 0 });
    }
    for (const y of [0.12, 0.28]) {
      b.box(inset * 2, 0.03, 0.03, C.grey, 0, PLAZA_HEIGHT + y, -inset, { r: 0 });
      b.box(inset * 2, 0.03, 0.03, C.grey, 0, PLAZA_HEIGHT + y, inset, { r: 0 });
      b.box(0.03, 0.03, inset * 2, C.grey, -inset, PLAZA_HEIGHT + y, 0, { r: 0 });
      b.box(0.03, 0.03, inset * 2, C.grey, inset, PLAZA_HEIGHT + y, 0, { r: 0 });
    }
    return;
  }
  const height = Math.max(lot.height, 0.01);
  // The stack of floors, a darker band between storeys.
  const floors = Math.max(1, Math.round(height / FLOOR_HEIGHT));
  const storey = height / floors;
  for (let floor = 0; floor < floors; floor++) {
    const y = PLAZA_HEIGHT + floor * storey;
    const band = Math.min(0.06, storey * 0.2);
    b.box(BUILDING_WIDTH, storey - band, BUILDING_WIDTH, floor % 2 === 0 ? colour : lighten(colour, 0.06), 0, y, 0, { r: 0.02 });
    b.box(BUILDING_WIDTH - 0.08, band, BUILDING_WIDTH - 0.08, darken(colour, 0.35), 0, y + storey - band, 0, { r: 0 });
  }
  const roof = PLAZA_HEIGHT + height;
  b.box(BUILDING_WIDTH + 0.06, 0.06, BUILDING_WIDTH + 0.06, darken(colour, 0.2), 0, roof, 0, { r: 0.01 });
  if (company.listed) {
    // A flag on the roof: the company is public.
    b.cyl(0.03, 1.1, C.chrome, 0.7, roof + 0.06, 0.7, { seg: 8 });
    b.box(0.55, 0.32, 0.02, C.red, 0.7 + 0.29, roof + 0.8, 0.7, { r: 0 });
  }
  if (company.newcomer) {
    // A crane beside the building: founded this year.
    const mast = Math.max(roof + 1, 2);
    const x = -w / 2 + 0.2;
    const z = w / 2 - 0.2;
    b.box(0.12, mast, 0.12, C.yellow, x, PLAZA_HEIGHT, z, { r: 0 });
    b.box(1.6, 0.1, 0.1, C.yellow, x + 0.6, PLAZA_HEIGHT + mast, z, { r: 0 });
    b.box(0.3, 0.2, 0.2, C.greyDark, x - 0.3, PLAZA_HEIGHT + mast - 0.2, z, { r: 0 });
    b.box(0.02, 0.8, 0.02, C.black, x + 1.2, PLAZA_HEIGHT + mast - 0.8, z, { r: 0 });
  }
};

export class MarketSystem implements WorldSystem {
  readonly root = new THREE.Group();

  private readonly ctx: MarketContext;
  private scene: MarketScene | null = null;
  private plan: MarketLayout | null = null;
  private buildings: Building[] = [];
  private bar: THREE.Mesh | null = null;
  private source: THREE.Mesh | null = null;
  private dots: THREE.InstancedMesh | null = null;
  /** The lot each dot goes to, and its place among that lot's dots; only the first `dotCount` are used. */
  private dotLots: number[] = [];
  private dotPlaces: number[] = [];
  private dotCount = 0;
  private active = false;
  private streaming = false;
  private streamTime = 0;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(ctx: MarketContext) {
    this.ctx = ctx;
    this.root.name = "market";
  }

  /** Show this scene. The same object again changes nothing; another one is built anew (and streams if active). */
  show(scene: MarketScene): void {
    if (scene === this.scene) return;
    this.unregister();
    this.clear();
    this.scene = scene;
    this.build(scene);
    if (this.active) this.register();
    if (this.active) this.startStream();
    else this.placeAtRest();
  }

  /** On screen (true) or not: companies are targets only while on screen, and the users stream on coming on. */
  setActive(on: boolean): void {
    // Off and on again registers the targets anew: how the world brings them back after a new run cleared its registry.
    if (on === this.active) return;
    this.active = on;
    if (on) {
      this.register();
      this.startStream();
    } else {
      this.unregister();
      this.streaming = false;
      this.placeAtRest();
    }
  }

  layout(): MarketLayout | null {
    return this.plan;
  }

  /** Meshes the market draws (its own count for the check). */
  meshCount(): number {
    let count = 0;
    this.root.traverseVisible((node) => {
      if ((node as THREE.Mesh).isMesh) count += 1;
    });
    return count;
  }

  applyFrame(next: WorldFrame, prev: WorldFrame | null): void {
    // The market is not an office frame.
    void next;
    void prev;
  }

  update(dt: number, elapsed?: number): void {
    void elapsed;
    if (!this.streaming) return;
    this.streamTime += dt;
    if (this.streamTime >= STREAM_SECONDS) {
      this.streaming = false;
      this.placeAtRest();
      return;
    }
    this.placeStreaming(this.streamTime);
  }

  busy(): boolean {
    return this.streaming;
  }

  dispose(): void {
    this.unregister();
    this.clear();
    this.scene = null;
    this.active = false;
    this.root.removeFromParent();
  }

  // ── Building ──────────────────────────────────────────────────────────────

  private build(scene: MarketScene): void {
    const plan = marketLayout(scene);
    this.plan = plan;
    const player = PHASE_THEMES[lookFor(scene.era)][0].accents[0];
    this.buildings = scene.companies.map((company, index) => {
      const lot = plan.lots[index];
      const colour = colourOf(company, player);
      const geometry = bakeModel(null, (b) => drawLot(b, company, lot, colour));
      const mesh = modelMesh(geometry);
      mesh.position.set(lot.x, 0, lot.z);
      mesh.name = `company:${company.seat}`;
      this.root.add(mesh);
      return { company, lot, mesh };
    });

    // The bar for going public: one translucent plane across every lot.
    const first = plan.lots[0];
    const last = plan.lots[plan.lots.length - 1];
    if (first && last) {
      const span = last.x - first.x + first.width + 0.6;
      const bar = new THREE.Mesh(
        new THREE.PlaneGeometry(span, first.width + 0.4),
        new THREE.MeshBasicMaterial({ color: EMBER, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide })
      );
      bar.rotation.x = -Math.PI / 2;
      bar.position.set((first.x + last.x) / 2, PLAZA_HEIGHT + plan.barY, first.z);
      bar.renderOrder = 1;
      bar.name = "market:bar";
      this.root.add(bar);
      this.bar = bar;
    }

    // Where the users come from: a glowing pad in front of the lots.
    const source = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.8, 0.12, 24),
      new THREE.MeshLambertMaterial({ color: C.greyLight, emissive: new THREE.Color(NEON), emissiveIntensity: 0.35 })
    );
    source.position.set(plan.source.x, 0.06, plan.source.z);
    source.receiveShadow = true;
    source.name = "market:source";
    this.root.add(source);
    this.source = source;

    // The year's new users.
    const counts = flowDots(
      scene.companies.map((company) => (company.state === "out" ? 0 : company.won)),
      FLOW_DOTS
    );
    this.dotLots = [];
    this.dotPlaces = [];
    counts.forEach((count, lot) => {
      for (let place = 0; place < count; place++) {
        this.dotLots.push(lot);
        this.dotPlaces.push(place);
      }
    });
    this.dotCount = this.dotLots.length;
    const dots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(DOT_RADIUS, 10, 8),
      new THREE.MeshLambertMaterial({ color: NEON, emissive: new THREE.Color(NEON), emissiveIntensity: 0.5 }),
      FLOW_DOTS
    );
    dots.count = this.dotCount;
    dots.visible = this.dotCount > 0;
    dots.castShadow = false;
    dots.frustumCulled = false;
    dots.name = "market:dots";
    for (let i = 0; i < FLOW_DOTS; i++) dots.setMatrixAt(i, this.hidden);
    this.root.add(dots);
    this.dots = dots;
  }

  /** Take everything down and free what the market owns. */
  private clear(): void {
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      // The buildings share the cached vertex-colour material; the rest of the materials are the market's own.
      if (child !== this.bar && child !== this.source && child !== this.dots) continue;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.dispose();
    }
    this.dots?.dispose();
    this.buildings = [];
    this.bar = null;
    this.source = null;
    this.dots = null;
    this.plan = null;
    this.dotLots = [];
    this.dotPlaces = [];
    this.dotCount = 0;
    this.streaming = false;
  }

  // ── Targets ───────────────────────────────────────────────────────────────

  private register(): void {
    for (const { company, lot, mesh } of this.buildings) {
      if (company.state === "out") continue;
      this.ctx.interactables.register(
        mesh,
        { kind: "company", seat: company.seat },
        { label: company.name, anchorHeight: PLAZA_HEIGHT + lot.height + 0.4 }
      );
    }
  }

  private unregister(): void {
    for (const { mesh } of this.buildings) this.ctx.interactables.unregister(mesh);
  }

  // ── The stream of users ───────────────────────────────────────────────────

  private startStream(): void {
    if (this.ctx.reducedMotion || this.dotCount === 0) {
      this.streaming = false;
      this.placeAtRest();
      return;
    }
    this.streaming = true;
    this.streamTime = 0;
    this.placeStreaming(0);
  }

  private placeAtRest(): void {
    const dots = this.dots;
    const plan = this.plan;
    if (!dots || !plan) return;
    for (let i = 0; i < this.dotCount; i++) {
      restPoint(plan.lots[this.dotLots[i]], this.dotPlaces[i], this.at);
      dots.setMatrixAt(i, this.matrix.makeTranslation(this.at.x, this.at.y, this.at.z));
    }
    dots.instanceMatrix.needsUpdate = true;
  }

  private placeStreaming(time: number): void {
    const dots = this.dots;
    const plan = this.plan;
    if (!dots || !plan) return;
    const stagger = STREAM_SECONDS - TRIP_SECONDS;
    for (let i = 0; i < this.dotCount; i++) {
      const start = this.dotCount > 1 ? (i / (this.dotCount - 1)) * stagger : 0;
      const t = (time - start) / TRIP_SECONDS;
      if (t <= 0) {
        dots.setMatrixAt(i, this.hidden);
        continue;
      }
      const lot = plan.lots[this.dotLots[i]];
      restPoint(lot, this.dotPlaces[i], this.to);
      const k = Math.min(1, t);
      const eased = k * k * (3 - 2 * k);
      this.from.set(plan.source.x + ((i % 5) - 2) * 0.12, 0.2, plan.source.z);
      this.at.lerpVectors(this.from, this.to, eased);
      this.at.y += Math.sin(Math.PI * k) * DOT_ARC;
      dots.setMatrixAt(i, this.matrix.makeTranslation(this.at.x, this.at.y, this.at.z));
    }
    dots.instanceMatrix.needsUpdate = true;
  }
}
