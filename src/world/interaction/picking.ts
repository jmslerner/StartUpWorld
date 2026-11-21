import * as THREE from "three";
import { targetKey } from "../targets";
import type { InteractableOptions, InteractableRegistry, InteractableTarget, ScreenPoint } from "../types";

/** World units above the anchor's origin where cards/markers attach when the caller does not say. */
export const DEFAULT_ANCHOR_HEIGHT = 1.6;

/**
 * Lines and points are infinitely thin, so three.js picks them within a
 * threshold. Its default of 1 world unit would give a wire or a chart line a
 * metre-wide invisible hitbox.
 */
const THIN_PRIMITIVE_THRESHOLD = 0.06;

export interface InteractableEntry {
  readonly key: string;
  readonly target: InteractableTarget;
  readonly object: THREE.Object3D;
  readonly label: string;
  readonly anchor: THREE.Object3D;
  readonly anchorHeight: number;
  readonly noHighlight: boolean;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * The registry of clickable things plus the raycast that picks between them.
 *
 * Deliberately DOM-free: it is handed a camera and a function returning the
 * canvas size, so the whole picking path runs under node in unit tests.
 *
 * An entry only counts while its object is *live* — attached (through any
 * number of parents) to `root` and not hidden by itself or an ancestor. Systems
 * that forget to unregister a removed object therefore cannot leave ghosts
 * behind: stale entries are simply never hit, never projected, and are replaced
 * the next time their target key is registered.
 */
export class InteractableStore implements InteractableRegistry {
  private readonly root: THREE.Object3D;
  private readonly camera: THREE.Camera;
  private readonly getSize: () => ViewportSize;
  private readonly byKey = new Map<string, InteractableEntry>();
  private readonly byObject = new Map<THREE.Object3D, InteractableEntry>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly scratch = new THREE.Vector3();
  private readonly candidates: THREE.Object3D[] = [];
  private readonly hits: THREE.Intersection[] = [];
  private revisionCount = 0;

  constructor(root: THREE.Object3D, camera: THREE.Camera, getSize: () => ViewportSize) {
    this.root = root;
    this.camera = camera;
    this.getSize = getSize;
    this.raycaster.params.Line.threshold = THIN_PRIMITIVE_THRESHOLD;
    this.raycaster.params.Points.threshold = THIN_PRIMITIVE_THRESHOLD;
  }

  /** Bumped on every register/unregister so callers can invalidate what they cached per entry. */
  get revision(): number {
    return this.revisionCount;
  }

  get size(): number {
    return this.byKey.size;
  }

  register(object: THREE.Object3D, target: InteractableTarget, options: InteractableOptions): void {
    const key = targetKey(target);
    // One object ↔ one target: drop whatever either side was paired with before.
    const previousForKey = this.byKey.get(key);
    if (previousForKey) this.byObject.delete(previousForKey.object);
    const previousForObject = this.byObject.get(object);
    if (previousForObject) this.byKey.delete(previousForObject.key);

    const entry: InteractableEntry = {
      key,
      target,
      object,
      label: options.label,
      anchor: options.anchor ?? object,
      anchorHeight: options.anchorHeight ?? DEFAULT_ANCHOR_HEIGHT,
      noHighlight: options.noHighlight ?? false,
    };
    this.byKey.set(key, entry);
    this.byObject.set(object, entry);
    this.revisionCount += 1;
  }

  unregister(object: THREE.Object3D): void {
    const entry = this.byObject.get(object);
    if (!entry) return;
    this.byObject.delete(object);
    this.byKey.delete(entry.key);
    this.revisionCount += 1;
  }

  clear(): void {
    if (this.byKey.size === 0) return;
    this.byKey.clear();
    this.byObject.clear();
    this.revisionCount += 1;
  }

  getByKey(key: string): InteractableEntry | null {
    return this.byKey.get(key) ?? null;
  }

  get(target: InteractableTarget): InteractableEntry | null {
    return this.getByKey(targetKey(target));
  }

  /** Attached to the scene and not hidden: the entry can be seen, hit and projected. */
  isLive(entry: InteractableEntry): boolean {
    return this.isShown(entry.object);
  }

  /**
   * The registered thing drawn nearest the camera at a canvas position (CSS
   * pixels), or null. The camera's world/projection matrices must be current.
   */
  pick(screen: ScreenPoint): InteractableEntry | null {
    const { width, height } = this.getSize();
    if (width <= 0 || height <= 0 || this.byObject.size === 0) return null;

    const candidates = this.candidates;
    candidates.length = 0;
    for (const entry of this.byObject.values()) {
      // A registered object nested inside another registered object is reached
      // by its ancestor's recursive test; listing it too would test it twice.
      if (this.isShown(entry.object) && !this.hasRegisteredAncestor(entry.object)) candidates.push(entry.object);
    }
    if (candidates.length === 0) return null;

    this.ndc.set((screen.x / width) * 2 - 1, 1 - (screen.y / height) * 2);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.hits;
    hits.length = 0;
    this.raycaster.intersectObjects(candidates, true, hits);

    let picked: InteractableEntry | null = null;
    for (const hit of hits) {
      // three.js raycasts hidden meshes too; hits arrive sorted nearest-first.
      if (!this.isHittable(hit.object)) continue;
      picked = this.entryFor(hit.object);
      if (picked) break;
    }
    // Do not keep scene objects alive through the scratch arrays.
    candidates.length = 0;
    hits.length = 0;
    return picked;
  }

  /** World-space point where UI attaches to an entry (anchor origin + anchorHeight). */
  anchorWorld(entry: InteractableEntry, out: THREE.Vector3): THREE.Vector3 {
    entry.anchor.getWorldPosition(out);
    out.y += entry.anchorHeight;
    return out;
  }

  /** Canvas position (CSS pixels) of an entry's anchor, or null when it is not live. */
  projectEntry(entry: InteractableEntry, out: ScreenPoint = { x: 0, y: 0 }): ScreenPoint | null {
    if (!this.isLive(entry)) return null;
    const { width, height } = this.getSize();
    const point = this.anchorWorld(entry, this.scratch).project(this.camera);
    out.x = (point.x * 0.5 + 0.5) * width;
    out.y = (0.5 - point.y * 0.5) * height;
    return out;
  }

  /** Walk up from a hit mesh to the nearest registered ancestor (or itself). */
  private entryFor(object: THREE.Object3D): InteractableEntry | null {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      const entry = this.byObject.get(node);
      if (entry) return entry;
      if (node === this.root) break;
    }
    return null;
  }

  private hasRegisteredAncestor(object: THREE.Object3D): boolean {
    for (let node = object.parent; node && node !== this.root; node = node.parent) {
      if (this.byObject.has(node)) return true;
    }
    return false;
  }

  /** Visible all the way up, and the chain ends at our root (i.e. it is in the scene). */
  private isShown(object: THREE.Object3D): boolean {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      if (!node.visible) return false;
      if (node === this.root) return true;
    }
    return false;
  }

  /**
   * Like isShown, except the hit object itself may be an invisible click proxy:
   * a mesh with `visible = false` and `userData.hitProxy = true`, used to give a
   * thin or tiny prop a comfortable click area.
   */
  private isHittable(object: THREE.Object3D): boolean {
    if (object.visible) return this.isShown(object);
    return object.userData.hitProxy === true && object.parent !== null && this.isShown(object.parent);
  }
}
