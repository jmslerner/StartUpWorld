/**
 * Shared plumbing for prop factories: the handle contract, a small kit that
 * tracks what a prop owns, and the textures / parts several props reuse
 * (monitor screens, terminal-style command plates).
 */
import * as THREE from "three";
import {
  bakeModel,
  C,
  cachedGeometry,
  canvasTexture,
  cssColor,
  EMBER,
  INK,
  LABEL_FONT,
  mat,
  MIST,
  modelMesh,
  NEON,
  planeMesh,
  STEEL,
  unitPlane,
} from "../../core/palette";
import type { CanvasDraw, MatOptions, ModelBuilder } from "../../core/palette";

export interface Footprint {
  /** Extent along local X. */
  w: number;
  /** Extent along local Z. */
  d: number;
}

/**
 * What every prop factory returns.
 *
 * `group` has its origin on the floor (y = 0) at the centre of `footprint`,
 * with the prop's front facing +Z — so callers do
 * `group.position.set(p.x, 0, p.z); group.rotation.y = p.facing`.
 */
export interface PropHandle {
  readonly group: THREE.Group;
  readonly footprint: Footprint;
  /** Present only on props that animate. Call once per frame. */
  update?(dt: number, elapsed: number): void;
  /** Present only on props with emissive parts: 0 = daylight, 1 = full dusk glow. */
  setGlow?(amount: number): void;
  /** Detaches `group` from its parent and frees everything this prop owns (never the shared caches). */
  dispose(): void;
}

type UpdateFn = (dt: number, elapsed: number) => void;
type GlowFn = (amount: number) => void;
interface Disposable {
  dispose(): void;
}
const noop = (): void => undefined;

/** Builds one prop: collects meshes, owned resources, per-frame updaters and glow hooks. */
export class PropKit {
  readonly group = new THREE.Group();
  private readonly owned: Disposable[] = [];
  private readonly updaters: UpdateFn[] = [];
  private readonly glowers: GlowFn[] = [];
  private glow = 0;

  constructor(name: string) {
    this.group.name = name;
  }

  /** Current setGlow amount (for props that animate their own emissive every frame). */
  get glowAmount(): number {
    return this.glow;
  }

  /** Add a baked, shared model (cached by `key`; the builder only runs on a cache miss). */
  model(key: string, build: (b: ModelBuilder) => void, parent: THREE.Object3D = this.group): THREE.Mesh {
    const mesh = modelMesh(bakeModel(key, build));
    parent.add(mesh);
    return mesh;
  }

  /** Add a baked model whose geometry depends on arguments, so this prop owns (and disposes) it. */
  ownModel(build: (b: ModelBuilder) => void, parent: THREE.Object3D = this.group): THREE.Mesh {
    const geometry = bakeModel(null, build);
    this.owned.push(geometry);
    const mesh = modelMesh(geometry);
    parent.add(mesh);
    return mesh;
  }

  add<T extends THREE.Object3D>(object: T, parent: THREE.Object3D = this.group): T {
    parent.add(object);
    return object;
  }

  /** Register a resource to dispose with the prop (cloned materials, owned geometries / textures). */
  own<T extends Disposable>(resource: T): T {
    this.owned.push(resource);
    return resource;
  }

  onUpdate(fn: UpdateFn): void {
    this.updaters.push(fn);
  }

  onGlow(fn: GlowFn): void {
    this.glowers.push(fn);
  }

  /**
   * For props that read `glowAmount` in their own update() instead of reacting
   * to setGlow: makes sure the handle gets a setGlow at all.
   */
  tracksGlow(): void {
    this.glowers.push(noop);
  }

  /**
   * Per-instance emissive Lambert material that follows setGlow: `min`
   * intensity in daylight, `max` at dusk. Owned by the prop.
   */
  emissive(base: number, glow: number, min = 0.2, max = 1, opts: MatOptions = {}): THREE.MeshLambertMaterial {
    const material = mat(base, { ...opts, emissive: glow }).clone();
    material.emissiveIntensity = min;
    this.owned.push(material);
    this.glowers.push((amount) => {
      material.emissiveIntensity = min + (max - min) * amount;
    });
    return material;
  }

  finish(footprint: Footprint): PropHandle;
  // NoInfer: E must come from `extra`, never from the caller's expected return type.
  finish<E extends object>(footprint: Footprint, extra: E): PropHandle & NoInfer<E>;
  finish(footprint: Footprint, extra?: object): PropHandle {
    const { group, owned, updaters, glowers } = this;
    const handle: PropHandle = {
      group,
      footprint,
      dispose: () => {
        group.removeFromParent();
        for (const resource of owned) resource.dispose();
        owned.length = 0;
      },
    };
    if (updaters.length > 0) {
      handle.update = (dt, elapsed) => {
        for (const fn of updaters) fn(dt, elapsed);
      };
    }
    if (glowers.length > 0) {
      handle.setGlow = (amount) => {
        const clamped = Math.min(1, Math.max(0, amount));
        this.glow = clamped;
        for (const fn of glowers) fn(clamped);
      };
    }
    return extra ? Object.assign(handle, extra) : handle;
  }
}

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * A baked shape drawn with an explicit material instead of its vertex colours —
 * for the parts of a prop that glow (lamp shades, LED strips, neon tubes).
 */
export const shapeMesh = (geometry: THREE.BufferGeometry, material: THREE.Material, castShadow = true): THREE.Mesh => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = castShadow;
  return mesh;
};

/** Deterministic 0..1 hash of an integer — for variety that must not change between rebuilds. */
export const hash01 = (n: number): number => {
  let h = (n | 0) + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

// ─────────────────────────────────────────────────────────────────────────────
// Screens
// ─────────────────────────────────────────────────────────────────────────────

export type ScreenKind = "code" | "terminal" | "chart" | "design" | "sheet" | "deck" | "arcade";
export const SCREEN_KINDS: readonly ScreenKind[] = ["code", "terminal", "chart", "design", "sheet", "deck", "arcade"];

/** Dominant colour of each screen, used as the flat fallback when canvases are unavailable. */
const SCREEN_TINT: Record<ScreenKind, number> = {
  code: 0x3d6f8f,
  terminal: 0x2b5a78,
  chart: 0x3f7a6c,
  design: 0xd9a8c7,
  sheet: 0xbfd6c2,
  deck: 0xc9b98f,
  arcade: 0x4a3a8a,
};

const bars = (ctx: CanvasRenderingContext2D, rows: Array<Array<[number, number, string]>>, top: number, rowHeight: number, barHeight: number): void => {
  rows.forEach((row, i) => {
    for (const [x, width, colour] of row) {
      ctx.fillStyle = colour;
      ctx.fillRect(x, top + i * rowHeight, width, barHeight);
    }
  });
};

const SCREEN_DRAW: Record<ScreenKind, CanvasDraw> = {
  code: (ctx, w, h) => {
    ctx.fillStyle = "#111821";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1b2531";
    ctx.fillRect(0, 0, w * 0.16, h);
    const [neon, ember, pink, green, mist] = [cssColor(NEON), cssColor(EMBER), "#f472b6", "#86efac", cssColor(MIST)];
    bars(
      ctx,
      [
        [[26, 22, pink], [52, 40, neon]],
        [[34, 30, mist], [68, 18, ember]],
        [[34, 14, pink], [52, 44, green]],
        [[42, 36, mist], [82, 22, neon]],
        [[42, 20, ember], [66, 30, mist]],
        [[34, 46, neon]],
        [[26, 12, pink]],
        [[26, 30, green], [60, 26, mist]],
      ],
      8,
      10,
      5
    );
  },
  terminal: (ctx, w, h) => {
    ctx.fillStyle = cssColor(INK);
    ctx.fillRect(0, 0, w, h);
    const neon = cssColor(NEON);
    const ember = cssColor(EMBER);
    const mist = cssColor(MIST);
    bars(
      ctx,
      [
        [[8, 6, ember], [18, 40, neon]],
        [[8, 70, mist]],
        [[8, 52, mist]],
        [[8, 6, ember], [18, 28, neon]],
        [[8, 60, mist]],
        [[8, 6, ember], [18, 10, neon]],
      ],
      10,
      13,
      6
    );
    ctx.fillStyle = ember;
    ctx.fillRect(32, 75, 8, 8);
  },
  chart: (ctx, w, h) => {
    ctx.fillStyle = "#101a1c";
    ctx.fillRect(0, 0, w, h);
    const heights = [0.22, 0.3, 0.27, 0.42, 0.5, 0.64, 0.8];
    heights.forEach((v, i) => {
      ctx.fillStyle = i === heights.length - 1 ? cssColor(EMBER) : "#2dd4bf";
      const bw = (w - 28) / heights.length - 4;
      ctx.fillRect(14 + i * (bw + 4), h - 12 - v * (h - 26), bw, v * (h - 26));
    });
    ctx.strokeStyle = cssColor(NEON);
    ctx.lineWidth = 3;
    ctx.beginPath();
    heights.forEach((v, i) => {
      const bw = (w - 28) / heights.length;
      const x = 14 + i * bw + bw / 2;
      const y = h - 20 - v * (h - 30);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  },
  design: (ctx, w, h) => {
    ctx.fillStyle = "#f3ede4";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#2a303a";
    ctx.fillRect(0, 0, 14, h);
    ctx.fillStyle = "#f472b6";
    ctx.fillRect(26, 12, 44, 44);
    ctx.fillStyle = "#a78bfa";
    ctx.beginPath();
    ctx.arc(98, 38, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fde68a";
    ctx.fillRect(26, 64, 96, 16);
    ctx.fillStyle = cssColor(NEON);
    ctx.fillRect(76, 50, 26, 8);
  },
  sheet: (ctx, w, h) => {
    ctx.fillStyle = "#f4f6f1";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#4ade80";
    ctx.fillRect(0, 0, w, 12);
    ctx.strokeStyle = "#b9c4bb";
    ctx.lineWidth = 1;
    for (let y = 12; y < h; y += 12) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }
    for (let x = 24; x < w; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 12);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
    ctx.fillStyle = "#7c8a80";
    [
      [30, 28, 14],
      [56, 28, 18],
      [30, 40, 18],
      [82, 40, 12],
      [56, 52, 10],
      [30, 64, 16],
      [82, 64, 18],
    ].forEach(([x, y, width]) => ctx.fillRect(x, y, width, 5));
  },
  deck: (ctx, w, h) => {
    ctx.fillStyle = "#f6f1e6";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#2a303a";
    ctx.fillRect(12, 12, 60, 9);
    ctx.fillStyle = "#9aa3ad";
    ctx.fillRect(12, 28, 44, 5);
    ctx.fillRect(12, 38, 38, 5);
    ctx.fillStyle = cssColor(EMBER);
    ctx.beginPath();
    ctx.moveTo(70, 80);
    ctx.lineTo(118, 80);
    ctx.lineTo(118, 34);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#2dd4bf";
    ctx.fillRect(12, 56, 16, 24);
    ctx.fillRect(34, 66, 16, 14);
  },
  arcade: (ctx, w, h) => {
    ctx.fillStyle = "#120a2a";
    ctx.fillRect(0, 0, w, h);
    // Rows of blocky invaders, a cannon and a shot.
    const invader = (x: number, y: number, colour: string): void => {
      ctx.fillStyle = colour;
      ctx.fillRect(x + 2, y, 8, 3);
      ctx.fillRect(x, y + 3, 12, 4);
      ctx.fillRect(x, y + 7, 3, 3);
      ctx.fillRect(x + 9, y + 7, 3, 3);
    };
    ["#f472b6", "#fde68a", cssColor(NEON)].forEach((colour, row) => {
      for (let i = 0; i < 6; i += 1) invader(14 + i * 17 + (row % 2) * 4, 10 + row * 16, colour);
    });
    ctx.fillStyle = "#4ade80";
    ctx.fillRect(w / 2 - 9, h - 14, 18, 6);
    ctx.fillRect(w / 2 - 2, h - 19, 4, 6);
    ctx.fillStyle = cssColor(EMBER);
    ctx.fillRect(w / 2 - 1, h - 36, 3, 9);
  },
};

const SCREEN_TEXTURE_SIZE = { w: 128, h: 96 };

/** Shared screen-content texture, or null in node. */
export const screenTexture = (kind: ScreenKind): THREE.CanvasTexture | null =>
  canvasTexture(`screen:${kind}`, SCREEN_TEXTURE_SIZE.w, SCREEN_TEXTURE_SIZE.h, SCREEN_DRAW[kind]);

/** Screen emissive intensity in daylight and at full dusk glow. */
const SCREEN_GLOW_DAY = 0.62;
const SCREEN_GLOW_DUSK = 1.05;

/**
 * A lit screen surface: per-instance material so each screen can glow, change
 * content and switch off on its own. The caller owns `material` (dispose it).
 */
export interface ScreenSurface {
  readonly material: THREE.MeshLambertMaterial;
  setKind(kind: ScreenKind): void;
  /** 0 = daylight, 1 = dusk. */
  setGlow(amount: number): void;
  /** Off = dark glass (vacant desks, powered-down kiosks). */
  setOn(on: boolean): void;
}

export const createScreenSurface = (initial: ScreenKind): ScreenSurface => {
  const material = new THREE.MeshLambertMaterial({ color: 0x8a8a8a });
  let kind = initial;
  let glow = 0;
  let on = true;

  const apply = (): void => {
    const texture = on ? screenTexture(kind) : null;
    if (material.map !== texture) {
      material.map = texture;
      material.emissiveMap = texture;
      material.needsUpdate = true;
    }
    if (!on) {
      material.color.setHex(C.screenOff);
      material.emissive.setHex(0x000000);
      return;
    }
    // With a texture the map supplies the colour; without one (node, or canvas
    // failure) fall back to the screen's dominant tint.
    material.color.setHex(texture ? 0x8a8a8a : SCREEN_TINT[kind]);
    material.emissive.setHex(texture ? 0xffffff : SCREEN_TINT[kind]);
    material.emissiveIntensity = SCREEN_GLOW_DAY + (SCREEN_GLOW_DUSK - SCREEN_GLOW_DAY) * glow;
  };
  apply();

  return {
    material,
    setKind(next) {
      kind = next;
      apply();
    },
    setGlow(amount) {
      glow = clamp01(amount);
      apply();
    },
    setOn(next) {
      on = next;
      apply();
    },
  };
};

/** One flat rectangle of a multi-screen geometry. `yaw` 0 faces +Z; `tilt` leans the top backwards. */
export interface ScreenQuad {
  x: number;
  /** Centre height. */
  y: number;
  z: number;
  w: number;
  h: number;
  yaw?: number;
  tilt?: number;
}

const _quadMatrix = new THREE.Matrix4();
const _quadEuler = new THREE.Euler(0, 0, 0, "YXZ");
const _quadQuat = new THREE.Quaternion();
const _quadPos = new THREE.Vector3();
const _quadScale = new THREE.Vector3();

/** All of a prop's screens as one UV-mapped geometry (one draw call). Cached by key. */
export const screenQuads = (key: string, quads: readonly ScreenQuad[]): THREE.BufferGeometry =>
  cachedGeometry(`screens:${key}`, () => {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const corner = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (const quad of quads) {
      _quadEuler.set(-(quad.tilt ?? 0), quad.yaw ?? 0, 0);
      _quadQuat.setFromEuler(_quadEuler);
      _quadMatrix.compose(_quadPos.set(quad.x, quad.y, quad.z), _quadQuat, _quadScale.set(quad.w, quad.h, 1));
      normal.set(0, 0, 1).applyQuaternion(_quadQuat);
      const base = positions.length / 3;
      for (const [u, v] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]) {
        corner.set(u - 0.5, v - 0.5, 0).applyMatrix4(_quadMatrix);
        positions.push(corner.x, corner.y, corner.z);
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(u, v);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    return geometry;
  });

// ─────────────────────────────────────────────────────────────────────────────
// Command plates — little terminal-style nameplates ("> ship") on every station
// ─────────────────────────────────────────────────────────────────────────────

const PLATE_TEXTURE_HEIGHT = 64;
const PLATE_CHAR_WIDTH = 0.6; // IBM Plex Mono advance ÷ font size
const PLATE_FONT_SIZE = 38;
const PLATE_PADDING = 16;

const plateTextureWidth = (text: string): number =>
  Math.ceil((text.length + 2) * PLATE_FONT_SIZE * PLATE_CHAR_WIDTH + PLATE_PADDING * 2);

/** World width of a command plate of the given height (it grows with the text). */
export const plateWidth = (text: string, height: number): number => (plateTextureWidth(text) / PLATE_TEXTURE_HEIGHT) * height;

const drawPlate =
  (text: string): CanvasDraw =>
  (ctx, w, h) => {
    ctx.fillStyle = cssColor(INK);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = cssColor(STEEL);
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.font = `600 ${PLATE_FONT_SIZE}px ${LABEL_FONT}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = cssColor(EMBER);
    ctx.fillText(">", PLATE_PADDING, h / 2 + 2);
    ctx.fillStyle = cssColor(NEON);
    ctx.fillText(text, PLATE_PADDING + PLATE_FONT_SIZE * PLATE_CHAR_WIDTH * 2, h / 2 + 2);
  };

/**
 * The glowing face of a command plate: a plane showing "> text" in the
 * terminal's colours. Returns null in node — bake `plateBack` into the model so
 * the sign still reads as a dark plaque with a neon underline.
 */
export const plateFace = (text: string, height: number): THREE.Mesh | null => {
  const texture = canvasTexture(`plate:${text}`, plateTextureWidth(text), PLATE_TEXTURE_HEIGHT, drawPlate(text));
  if (!texture) return null;
  const material = mat(0x555555, { map: texture, emissive: 0xffffff, emissiveIntensity: 0.75, emissiveMap: true });
  return planeMesh(plateWidth(text, height), height, material);
};

/** Dark backing board for a command plate, centred at (x, yBase + height / 2, z). */
export const plateBack = (b: ModelBuilder, text: string, height: number, x: number, yBase: number, z: number, tilt = 0): void => {
  const w = plateWidth(text, height) + 0.05;
  b.place(x, yBase + height / 2, z, { rx: -tilt }, () => {
    b.box(w, height + 0.05, 0.04, INK, 0, -(height + 0.05) / 2, -0.02, { r: 0.012 });
    // Underline that survives when the text texture is unavailable.
    b.box(w * 0.7, 0.014, 0.012, NEON, 0, -height / 2 + 0.012, 0.004, { r: 0 });
  });
};

/**
 * Add a full command plate (back + glowing text) to a prop.
 * `tilt` leans the top backwards so it faces up toward the isometric camera.
 * When the builder is inside `b.place(...)`, pass the matching `parent` group so
 * the text lands on the baked back.
 */
export const addCommandPlate = (
  kit: PropKit,
  b: ModelBuilder,
  text: string,
  x: number,
  yBase: number,
  z: number,
  height = 0.22,
  tilt = 0.3,
  parent: THREE.Object3D = kit.group
): void => {
  plateBack(b, text, height, x, yBase, z, tilt);
  const face = plateFace(text, height);
  if (!face) return;
  const pivot = new THREE.Group();
  pivot.position.set(x, yBase + height / 2, z);
  pivot.rotation.x = -tilt;
  face.position.set(0, 0, 0.004);
  pivot.add(face);
  parent.add(pivot);
};

/** A decaying 0..1 impulse for flashes and bounces: `trigger()`, then `step(dt)` each frame. */
export class Pulse {
  value = 0;
  private readonly rate: number;

  constructor(seconds: number) {
    this.rate = 1 / seconds;
  }

  trigger(strength = 1): void {
    this.value = strength;
  }

  step(dt: number): number {
    this.value = Math.max(0, this.value - dt * this.rate);
    return this.value;
  }
}

/** Flat label plane with arbitrary canvas art (signs, posters). Null in node. */
export const texturedPlane = (
  key: string,
  w: number,
  h: number,
  pixelsPerUnit: number,
  draw: CanvasDraw,
  emissiveIntensity = 0
): THREE.Mesh | null => {
  const texture = canvasTexture(key, Math.max(8, Math.round(w * pixelsPerUnit)), Math.max(8, Math.round(h * pixelsPerUnit)), draw);
  if (!texture) return null;
  const material =
    emissiveIntensity > 0
      ? mat(0x666666, { map: texture, emissive: 0xffffff, emissiveIntensity, emissiveMap: true })
      : mat(0xffffff, { map: texture });
  const mesh = new THREE.Mesh(unitPlane(), material);
  mesh.scale.set(w, h, 1);
  return mesh;
};
