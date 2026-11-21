/**
 * What hangs over people's heads and sits on their desks because of the tycoon layer:
 *   • an envelope with a "2w" countdown over anyone holding an outside offer (a cardboard box
 *     for a burnout notice), dropping in when the offer lands;
 *   • a small gold star over the lead of each build;
 *   • pizza boxes on the desks of a crunching crew, one per crunched week (up to three).
 *
 * Sprites are children of the character's head anchor, so they bob, slouch and walk with the
 * person and vanish with them. All pizza boxes are one instanced mesh: one draw call.
 */
import * as THREE from "three";
import { bakeModel, C, canvasTexture, cssColor, EMBER, INK, LABEL_FONT, vertexMat } from "../core/palette";
import { DESK_OFFSET, forwardOf } from "../office/layouts";
import { DESK_TOP_Y } from "../office/props/workstations";
import type { OfferKind } from "../../types/game";
import type { Seat, StaffView, WorldSnapshot } from "../types";

/** What one person's overhead marker shows. */
export interface MarkerSpec {
  offer: { kind: OfferKind; weeksLeft: number } | null;
  lead: boolean;
}

/** The marker a staff member gets (null = nothing over their head). */
export const markerFor = (view: StaffView | undefined): MarkerSpec | null => {
  if (!view) return null;
  const offer = view.offer ? { kind: view.offer.kind, weeksLeft: Math.max(1, Math.min(9, view.offer.weeksLeft)) } : null;
  if (!offer && !view.isLead) return null;
  return { offer, lead: view.isLead };
};

/** Cache key of a marker's picture. */
export const markerKey = (spec: MarkerSpec): string =>
  spec.offer ? `offer:${spec.offer.kind}:${spec.offer.weeksLeft}:${spec.lead ? "lead" : ""}` : "lead";

/** Pizza boxes per desk for a crunching build: at least one the moment crunch starts, at most three. */
export const pizzaBoxesFor = (crunchWeeks: number): number => Math.max(1, Math.min(3, Math.floor(crunchWeeks)));

/** Desk positions (and how many boxes on each) for everyone on a crunching build who has a desk. */
export const pizzaPlan = (
  snapshot: WorldSnapshot,
  seatOf: (personId: string) => Seat | null
): Array<{ seat: Seat; boxes: number }> => {
  const crunching = new Map<string, number>();
  for (const build of snapshot.builds) if (build.crunch) crunching.set(build.id, pizzaBoxesFor(build.crunchWeeks));
  if (crunching.size === 0) return [];
  const plan: Array<{ seat: Seat; boxes: number }> = [];
  for (const view of snapshot.staff) {
    const boxes = view.buildId ? crunching.get(view.buildId) : undefined;
    if (!boxes) continue;
    const seat = seatOf(view.id);
    // Only a real desk has room for a pizza box; the floor spots make do without.
    if (seat && seat.kind === "desk") plan.push({ seat, boxes });
  }
  return plan;
};

const MARKER_PX = 128;
/** World size of a marker and how far above the head anchor it floats. */
const MARKER_SIZE = 0.46;
const LEAD_SIZE = 0.26;
const MARKER_LIFT = 0.36;
/** An offer marker drops in from this high, over this long. */
const DROP_HEIGHT = 0.9;
const DROP_SECONDS = 0.45;

const drawOffer = (kind: OfferKind, weeksLeft: number, lead: boolean) => (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
  ctx.clearRect(0, 0, w, h);
  // A round badge so it reads against any floor or wall.
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = cssColor(INK);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = cssColor(kind === "burnout" ? EMBER : C.alarm);
  ctx.stroke();
  if (kind === "burnout") {
    // A cardboard box, packed.
    ctx.fillStyle = "#c8a06a";
    ctx.fillRect(w * 0.27, h * 0.3, w * 0.46, h * 0.3);
    ctx.fillStyle = "#a47b45";
    ctx.fillRect(w * 0.27, h * 0.3, w * 0.46, h * 0.06);
    ctx.fillRect(w * 0.47, h * 0.3, w * 0.06, h * 0.3);
  } else {
    // An envelope.
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(w * 0.25, h * 0.28, w * 0.5, h * 0.33);
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w * 0.25, h * 0.28);
    ctx.lineTo(w * 0.5, h * 0.47);
    ctx.lineTo(w * 0.75, h * 0.28);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${Math.round(h * 0.25)}px ${LABEL_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`${weeksLeft}w`, w / 2, h * 0.86);
  if (lead) {
    ctx.fillStyle = "#fbbf24";
    ctx.font = `700 ${Math.round(h * 0.26)}px ${LABEL_FONT}`;
    ctx.fillText("★", w * 0.82, h * 0.26);
  }
};

const drawLead = (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
  ctx.clearRect(0, 0, w, h);
  const spikes = 5;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i += 1) {
    const r = i % 2 === 0 ? w * 0.46 : w * 0.2;
    const a = -Math.PI / 2 + (i * Math.PI) / spikes;
    const x = w / 2 + Math.cos(a) * r;
    const y = h / 2 + Math.sin(a) * r + h * 0.04;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "#fbbf24";
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = cssColor(INK);
  ctx.stroke();
};

interface Marker {
  sprite: THREE.Sprite;
  key: string;
  /** Seconds left of the drop-in. */
  drop: number;
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

const PIZZA_CAPACITY = 96;
const PIZZA_W = 0.36;
const PIZZA_H = 0.05;

/** A delivery box: cardboard, a red band across the lid and a little logo. Origin at its base. */
const bakePizzaBox = (): THREE.BufferGeometry =>
  bakeModel(null, (b) => {
    b.box(PIZZA_W, PIZZA_H, PIZZA_W, 0xe0b47a, 0, 0, 0, { r: 0.006 });
    b.box(PIZZA_W + 0.004, 0.006, 0.09, 0xc0392b, 0, PIZZA_H - 0.002, 0, { r: 0 });
    b.box(0.08, 0.008, 0.08, 0xfff4d6, 0.09, PIZZA_H - 0.001, 0.09, { r: 0 });
  });

export class PersonMarkers {
  readonly pizzaMesh: THREE.InstancedMesh;
  private readonly markers = new Map<string, Marker>();
  private readonly materials = new Map<string, THREE.SpriteMaterial>();
  private readonly pizzaGeometry: THREE.BufferGeometry;
  private readonly reducedMotion: boolean;

  constructor(root: THREE.Object3D, reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
    this.pizzaGeometry = bakePizzaBox();
    // The shared vertex-colour material (owned by the palette cache, not by us).
    this.pizzaMesh = new THREE.InstancedMesh(this.pizzaGeometry, vertexMat(), PIZZA_CAPACITY);
    this.pizzaMesh.name = "pizza-boxes";
    this.pizzaMesh.count = 0;
    this.pizzaMesh.castShadow = false;
    this.pizzaMesh.frustumCulled = false;
    root.add(this.pizzaMesh);
  }

  /**
   * Put the right marker over one person (`anchor` is their head anchor), or take it away.
   * `dropIn` animates a newly landed offer.
   */
  sync(personId: string, anchor: THREE.Object3D, spec: MarkerSpec | null, dropIn: boolean): void {
    const current = this.markers.get(personId);
    if (!spec) {
      if (current) this.remove(personId);
      return;
    }
    const key = markerKey(spec);
    if (current && current.key === key && current.sprite.parent === anchor) return;
    const material = this.material(key, spec);
    if (!material) return;
    if (current) {
      current.sprite.material = material;
      current.key = key;
      if (current.sprite.parent !== anchor) anchor.add(current.sprite);
      if (dropIn && !this.reducedMotion) current.drop = DROP_SECONDS;
      this.place(current);
      return;
    }
    const sprite = new THREE.Sprite(material);
    sprite.name = "person-marker";
    sprite.renderOrder = 20;
    const size = spec.offer ? MARKER_SIZE : LEAD_SIZE;
    sprite.scale.set(size, size, 1);
    // A marker is decoration on the person, never something the shadow pass needs.
    sprite.castShadow = false;
    anchor.add(sprite);
    const marker: Marker = { sprite, key, drop: dropIn && !this.reducedMotion ? DROP_SECONDS : 0 };
    this.markers.set(personId, marker);
    this.place(marker);
  }

  /** Forget everyone not in `keep` (they left, or the scene was rebuilt). */
  prune(keep: ReadonlySet<string>): void {
    for (const id of [...this.markers.keys()]) if (!keep.has(id)) this.remove(id);
  }

  /** Pizza boxes on the given desks (stacked, beside the keyboard). */
  setPizza(plan: ReadonlyArray<{ seat: Seat; boxes: number }>): void {
    let index = 0;
    for (const { seat, boxes } of plan) {
      const forward = forwardOf(seat.facing);
      // To the person's right of the desk's centre, off the keyboard.
      const side = { x: -forward.z, z: forward.x };
      const cx = seat.x + forward.x * DESK_OFFSET + side.x * 0.42;
      const cz = seat.z + forward.z * DESK_OFFSET + side.z * 0.42;
      for (let k = 0; k < boxes && index < PIZZA_CAPACITY; k += 1) {
        _position.set(cx, DESK_TOP_Y + k * (PIZZA_H + 0.004), cz);
        // Each box a little askew: nobody stacks pizza boxes neatly at 2 a.m.
        _quaternion.setFromAxisAngle(_up, seat.facing + (k - 1) * 0.2);
        _matrix.compose(_position, _quaternion, _scale);
        this.pizzaMesh.setMatrixAt(index, _matrix);
        index += 1;
      }
    }
    this.pizzaMesh.count = index;
    this.pizzaMesh.visible = index > 0;
    this.pizzaMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    for (const marker of this.markers.values()) {
      if (marker.drop <= 0) continue;
      marker.drop = Math.max(0, marker.drop - dt);
      this.place(marker);
    }
  }

  /** How many overhead markers are up (tests, the dev sandbox). */
  get count(): number {
    return this.markers.size;
  }

  dispose(): void {
    for (const id of [...this.markers.keys()]) this.remove(id);
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.pizzaMesh.removeFromParent();
    this.pizzaMesh.dispose();
    this.pizzaGeometry.dispose();
  }

  private place(marker: Marker): void {
    // Ease out: it lands, rather than stops.
    const t = marker.drop / DROP_SECONDS;
    marker.sprite.position.set(0, MARKER_LIFT + DROP_HEIGHT * t * t, 0);
  }

  private remove(personId: string): void {
    const marker = this.markers.get(personId);
    if (!marker) return;
    marker.sprite.removeFromParent();
    this.markers.delete(personId);
  }

  private material(key: string, spec: MarkerSpec): THREE.SpriteMaterial | null {
    const known = this.materials.get(key);
    if (known) return known;
    const texture = spec.offer
      ? canvasTexture(`person-marker:${key}`, MARKER_PX, MARKER_PX, drawOffer(spec.offer.kind, spec.offer.weeksLeft, spec.lead))
      : canvasTexture("person-marker:lead", MARKER_PX, MARKER_PX, drawLead);
    // No DOM (unit tests): no picture, so no marker either.
    if (!texture) return null;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    this.materials.set(key, material);
    return material;
  }
}
