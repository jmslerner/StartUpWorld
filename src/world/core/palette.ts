/**
 * Art-department toolkit for the 3D world.
 *
 *  1. The palette: app UI colours, diorama colours, role / outfit / skin / hair
 *     colours and the per-phase furniture themes.
 *  2. Shared resource caches: materials (`mat`, `vertexMat`, `glowMat`,
 *     `glassMat`), unit geometries (`unitBox`, …), baked model geometries
 *     (`bakeModel`) and canvas textures (`canvasTexture`).
 *  3. `ModelBuilder`: stacks coloured primitives and bakes them into ONE
 *     vertex-coloured geometry, so a whole prop costs a single draw call.
 *
 * One lighting model everywhere: Lambert (hemisphere + one directional light).
 * Self-lit things (screens, LEDs, neon) use Lambert emissive or the unlit
 * `glowMat`.
 *
 * Everything cached here is freed by `disposeSharedResources()` and lazily
 * re-created on next use, so mount → dispose → mount (React StrictMode) works.
 * No DOM access happens at module load; canvas helpers return null in node.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { CompanyPhase, TeamRole } from "../../types/game";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Palette
// ─────────────────────────────────────────────────────────────────────────────

/** App UI colours (mirrors tailwind.config.js). */
export const INK = 0x0d0f12;
export const SLATE = 0x1a1f26;
export const STEEL = 0x2e3742;
export const MIST = 0xa9b3bf;
export const NEON = 0x7dd3fc;
export const EMBER = 0xf59e0b;

/** Diorama colours. Warm and slightly muted so neon / ember accents stay special. */
export const C = {
  // Woods
  plywood: 0xdcb785,
  birch: 0xecd5ae,
  oak: 0xcf9e66,
  walnut: 0x80523a,
  walnutDark: 0x573829,
  pallet: 0xb78f5f,
  // Neutrals
  white: 0xf6f2e9,
  cream: 0xf0e6d2,
  paper: 0xfbf9f1,
  bone: 0xe3d8c4,
  greyLight: 0xcdd2d8,
  grey: 0x9aa3ad,
  greyDark: 0x5d6773,
  charcoal: 0x363c45,
  black: 0x20242a,
  // Metals
  steel: 0x8d98a5,
  chrome: 0xd5dce4,
  brass: 0xd8ab4c,
  copper: 0xc67a4a,
  galvanised: 0xb0b6bb,
  // Masonry & packaging
  brick: 0xb9664b,
  brickDark: 0x9d513c,
  mortar: 0xd8c8b1,
  concrete: 0xacadad,
  concreteDark: 0x8e9092,
  oil: 0x6a6c70,
  asphalt: 0x4c5056,
  paving: 0xc4c1b8,
  pavingDark: 0xb1aea5,
  marble: 0x383c47,
  marbleLight: 0x4a4f5c,
  marbleVein: 0x737987,
  cardboard: 0xcaa675,
  cardboardDark: 0xad8959,
  tape: 0xe9dcc0,
  // Fabrics & pops
  red: 0xe4574a,
  coral: 0xf2795d,
  orange: 0xf28a3c,
  yellow: 0xf4c544,
  green: 0x5fb46b,
  teal: 0x36b3a6,
  blue: 0x4f8fdc,
  navy: 0x303f5e,
  purple: 0x8b70d6,
  pink: 0xf28db2,
  leather: 0x8c5434,
  leatherDark: 0x5f3625,
  burgundy: 0x7c2a35,
  // Paper goods
  noteYellow: 0xfde68a,
  notePink: 0xfda4af,
  noteBlue: 0x93c5fd,
  noteGreen: 0x86efac,
  noteOrange: 0xfdba74,
  // Nature
  grass: 0x88ba63,
  grassDark: 0x70a853,
  leaf: 0x4fa16b,
  leafLight: 0x80ca7c,
  leafDark: 0x2f7e56,
  soil: 0x5b4435,
  trunk: 0x7c5b3d,
  terracotta: 0xc9714a,
  water: 0x4aa9d9,
  waterDeep: 0x2e80b9,
  foam: 0xe9f6fb,
  // Glass & screens
  glass: 0xbfe6f5,
  screenOff: 0x1c2128,
  screenDim: 0x27425a,
  // Lights
  lampWarm: 0xffd58a,
  alarm: 0xef4444,
  good: 0x4ade80,
} as const;

/** Shirt colour per role (spec §2). `executive` is the suit colour; the tie is EXEC_TIE. */
export const ROLE_COLORS: Record<TeamRole, number> = {
  engineering: 0x7dd3fc,
  design: 0xf472b6,
  product: 0xa78bfa,
  data: 0x2dd4bf,
  marketing: 0xfb923c,
  sales: 0x4ade80,
  ops: 0xfacc15,
  hr: 0xfda4af,
  legal: 0x94a3b8,
  executive: 0x1f2937,
};
export const EXEC_TIE = 0xeab308;

export interface Outfit {
  top: number;
  trim: number;
  pants: number;
  shoes: number;
}
/** Founder: white hoodie, ember trim. */
export const FOUNDER_OUTFIT: Outfit = { top: 0xf4f1e8, trim: EMBER, pants: 0x39424f, shoes: 0xf4f1e8 };
/** Cofounder: dark hoodie, neon trim. */
export const COFOUNDER_OUTFIT: Outfit = { top: 0x3a4352, trim: NEON, pants: 0x5d6878, shoes: 0x2a2f37 };

export const SKIN_TONES: readonly number[] = [0xffdcb8, 0xf3c998, 0xe2ad76, 0xc98b55, 0x9a6038, 0x6b4126];
export const HAIR_COLORS: readonly number[] = [
  0x231c18, // black
  0x3d2b20, // dark brown
  0x6e4a2e, // brown
  0xa1502c, // auburn
  0xe2bf6c, // blonde
  0xb8bcc3, // grey
  0xd96a9c, // dyed pink
  0x4aa3c9, // dyed blue
];
export const PANTS_COLORS: readonly number[] = [0x34405a, 0x3a4049, 0xb79c6f, 0x2f4b7c, 0x5a4a42];
export const SHOE_COLORS: readonly number[] = [0x20242a, 0xf0ede4, 0x7a4a2e, 0xe4574a];

/** Furniture finish for one company phase: garage scrappy → public polished. */
export interface PhaseTheme {
  /** Table tops and casework. */
  wood: number;
  woodDark: number;
  /** Legs, frames, brackets. */
  frame: number;
  /** Cabinet bodies and flat panels. */
  panel: number;
  /** Upholstery and pop colours, most prominent first. */
  accents: readonly [number, number, number];
  /** Emissive accent used for strips and indicator lights. */
  glow: number;
}

export const PHASE_THEMES: Record<CompanyPhase, PhaseTheme> = {
  garage: { wood: C.plywood, woodDark: C.pallet, frame: C.galvanised, panel: C.cardboard, accents: [C.red, C.yellow, C.blue], glow: EMBER },
  coworking: { wood: C.birch, woodDark: C.oak, frame: C.white, panel: C.cream, accents: [C.teal, C.yellow, C.coral], glow: NEON },
  office: { wood: C.oak, woodDark: C.walnut, frame: C.steel, panel: C.greyLight, accents: [C.blue, C.teal, C.orange], glow: NEON },
  unicorn: { wood: C.birch, woodDark: C.oak, frame: C.white, panel: C.white, accents: [C.purple, C.leaf, C.pink], glow: NEON },
  public: { wood: C.walnut, woodDark: C.walnutDark, frame: C.brass, panel: C.marble, accents: [C.burgundy, C.navy, C.brass], glow: EMBER },
};

export const PHASES: readonly CompanyPhase[] = ["garage", "coworking", "office", "unicorn", "public"];

/** 0 for the garage … 4 for the public HQ. */
export const phaseTier = (phase: CompanyPhase): number => PHASES.indexOf(phase);

const _mixA = new THREE.Color();
const _mixB = new THREE.Color();

/** Blend two hex colours (t = 0 → a, t = 1 → b) in sRGB, which is what the eye expects. */
export const mixColor = (a: number, b: number, t: number): number => {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
};

export const darken = (color: number, amount: number): number => mixColor(color, 0x000000, amount);
export const lighten = (color: number, amount: number): number => mixColor(color, 0xffffff, amount);

/** Pull a colour toward its own grey (0 = unchanged, 1 = fully grey). */
export const desaturate = (color: number, amount: number): number => {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const grey = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  return mixColor(color, (grey << 16) | (grey << 8) | grey, amount);
};

/** CSS string for canvas drawing. */
export const cssColor = (color: number): string => `#${color.toString(16).padStart(6, "0")}`;

// ─────────────────────────────────────────────────────────────────────────────
// 2. Shared caches
// ─────────────────────────────────────────────────────────────────────────────

const materialCache = new Map<string, THREE.Material>();
const geometryCache = new Map<string, THREE.BufferGeometry>();

export interface MatOptions {
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  /** Faceted shading. */
  flat?: boolean;
  /** Multiply by the geometry's `color` attribute (baked models). */
  vertexColors?: boolean;
  doubleSided?: boolean;
  depthWrite?: boolean;
  /** Push the surface back in depth so coplanar geometry drawn on top never z-fights. */
  decal?: boolean;
  map?: THREE.Texture | null;
  /** Use `map` as the emissive map too (glowing signs / screens). */
  emissiveMap?: boolean;
}

/**
 * Shared Lambert material. Identical arguments return the same instance, so
 * NEVER mutate the result — clone it when a prop animates its own colour /
 * opacity / glow, and dispose the clone yourself.
 */
export const mat = (color: number, opts: MatOptions = {}): THREE.MeshLambertMaterial => {
  const key = [
    "lambert",
    color,
    opts.emissive ?? -1,
    opts.emissiveIntensity ?? 1,
    opts.transparent ? 1 : 0,
    opts.opacity ?? 1,
    opts.flat ? 1 : 0,
    opts.vertexColors ? 1 : 0,
    opts.doubleSided ? 1 : 0,
    opts.depthWrite === false ? 0 : 1,
    opts.decal ? 1 : 0,
    opts.map ? opts.map.id : -1,
    opts.emissiveMap ? 1 : 0,
  ].join("|");
  const cached = materialCache.get(key);
  if (cached) return cached as THREE.MeshLambertMaterial;

  const opacity = opts.opacity ?? 1;
  const material = new THREE.MeshLambertMaterial({
    color,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? opacity < 1,
    opacity,
    flatShading: opts.flat ?? false,
    vertexColors: opts.vertexColors ?? false,
    side: opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: opts.depthWrite ?? true,
    map: opts.map ?? null,
    emissiveMap: opts.emissiveMap ? (opts.map ?? null) : null,
  });
  if (opts.decal) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = 2;
    material.polygonOffsetUnits = 2;
  }
  materialCache.set(key, material);
  return material;
};

/**
 * THE workhorse material: white Lambert that shows a baked model's vertex
 * colours. `tint` multiplies everything (used for dimmed / ghosted looks);
 * `decal` is for ground planes that other surfaces sit flush on.
 */
export const vertexMat = (tint = 0xffffff, decal = false): THREE.MeshLambertMaterial => mat(tint, { vertexColors: true, decal });

export interface GlowOptions {
  opacity?: number;
  /** Additive blending, for light pools and beams. */
  additive?: boolean;
  vertexColors?: boolean;
  doubleSided?: boolean;
  map?: THREE.Texture | null;
}

/** Shared unlit material for things that are their own light source (LEDs, beacons, light pools). */
export const glowMat = (color: number, opts: GlowOptions = {}): THREE.MeshBasicMaterial => {
  const opacity = opts.opacity ?? 1;
  const translucent = opacity < 1 || Boolean(opts.additive) || Boolean(opts.map);
  const key = ["basic", color, opacity, opts.additive ? 1 : 0, opts.vertexColors ? 1 : 0, opts.doubleSided ? 1 : 0, opts.map ? opts.map.id : -1].join("|");
  const cached = materialCache.get(key);
  if (cached) return cached as THREE.MeshBasicMaterial;
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: translucent,
    opacity,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    // Translucent glows must not hide what is behind them in the depth buffer.
    depthWrite: !translucent,
    vertexColors: opts.vertexColors ?? false,
    side: opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    map: opts.map ?? null,
    toneMapped: false,
  });
  materialCache.set(key, material);
  return material;
};

/** Shared window / partition glass. */
export const glassMat = (tint: number = C.glass, opacity = 0.32): THREE.MeshLambertMaterial =>
  mat(tint, { transparent: true, opacity, depthWrite: false, doubleSided: true });

/** Shared geometry by key. `build` runs only on a cache miss. */
export const cachedGeometry = <T extends THREE.BufferGeometry>(key: string, build: () => T): T => {
  const cached = geometryCache.get(key);
  if (cached) return cached as T;
  const geometry = build();
  geometryCache.set(key, geometry);
  return geometry;
};

/** 1 × 1 × 1 box centred on the origin — scale the mesh, not the geometry. */
export const unitBox = (): THREE.BoxGeometry => cachedGeometry("unit:box", () => new THREE.BoxGeometry(1, 1, 1));
/** Radius 0.5, height 1, Y axis, centred. */
export const unitCylinder = (segments = 16): THREE.CylinderGeometry =>
  cachedGeometry(`unit:cyl:${segments}`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, segments));
/** Base radius 0.5, height 1, Y axis, centred. */
export const unitCone = (segments = 16): THREE.ConeGeometry => cachedGeometry(`unit:cone:${segments}`, () => new THREE.ConeGeometry(0.5, 1, segments));
/** Radius 0.5 (diameter 1), centred. */
export const unitSphere = (segments = 14): THREE.SphereGeometry =>
  cachedGeometry(`unit:sphere:${segments}`, () => new THREE.SphereGeometry(0.5, segments, Math.max(6, Math.round(segments * 0.65))));
/** 1 × 1 plane in XY facing +Z, centred, with UVs (labels, screens). */
export const unitPlane = (): THREE.PlaneGeometry => cachedGeometry("unit:plane", () => new THREE.PlaneGeometry(1, 1));
/** Radius 0.5 disc in XY facing +Z (rotate −90° about X to lay it on the floor). */
export const unitDisc = (segments = 24): THREE.CircleGeometry => cachedGeometry(`unit:disc:${segments}`, () => new THREE.CircleGeometry(0.5, segments));

// ── One-line mesh helpers ────────────────────────────────────────────────────
// Positions are (x, yBase, z): x/z are the centre, yBase is the BOTTOM of the
// part, because furniture is built from the floor up.

type MaterialOrColor = THREE.Material | number;
const resolveMaterial = (material: MaterialOrColor): THREE.Material => (typeof material === "number" ? mat(material) : material);

/** Set the shadow flags and hand the object back (for chaining). */
export const shadowed = <T extends THREE.Object3D>(object: T, cast = true, receive = true): T => {
  object.castShadow = cast;
  object.receiveShadow = receive;
  return object;
};

export const boxMesh = (w: number, h: number, d: number, material: MaterialOrColor, x = 0, yBase = 0, z = 0): THREE.Mesh => {
  const mesh = new THREE.Mesh(unitBox(), resolveMaterial(material));
  mesh.scale.set(w, h, d);
  mesh.position.set(x, yBase + h / 2, z);
  return shadowed(mesh);
};

export const cylinderMesh = (radius: number, h: number, material: MaterialOrColor, x = 0, yBase = 0, z = 0, segments = 16): THREE.Mesh => {
  const mesh = new THREE.Mesh(unitCylinder(segments), resolveMaterial(material));
  mesh.scale.set(radius * 2, h, radius * 2);
  mesh.position.set(x, yBase + h / 2, z);
  return shadowed(mesh);
};

export const coneMesh = (radius: number, h: number, material: MaterialOrColor, x = 0, yBase = 0, z = 0, segments = 16): THREE.Mesh => {
  const mesh = new THREE.Mesh(unitCone(segments), resolveMaterial(material));
  mesh.scale.set(radius * 2, h, radius * 2);
  mesh.position.set(x, yBase + h / 2, z);
  return shadowed(mesh);
};

export const sphereMesh = (radius: number, material: MaterialOrColor, x = 0, yBase = 0, z = 0, segments = 14): THREE.Mesh => {
  const mesh = new THREE.Mesh(unitSphere(segments), resolveMaterial(material));
  mesh.scale.setScalar(radius * 2);
  mesh.position.set(x, yBase + radius, z);
  return shadowed(mesh);
};

/** Upright plane facing +Z. Does not cast shadows (it is a label / screen / glow). */
export const planeMesh = (w: number, h: number, material: MaterialOrColor, x = 0, yBase = 0, z = 0): THREE.Mesh => {
  const mesh = new THREE.Mesh(unitPlane(), resolveMaterial(material));
  mesh.scale.set(w, h, 1);
  mesh.position.set(x, yBase + h / 2, z);
  return shadowed(mesh, false, false);
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. ModelBuilder
// ─────────────────────────────────────────────────────────────────────────────

export interface PartOpts {
  /** Euler rotation (XYZ order, radians) about the part's centre. */
  rx?: number;
  ry?: number;
  rz?: number;
  /** Box: bevel radius (0 = sharp). Defaults to a hairline bevel on anything chunky enough. */
  r?: number;
  /**
   * Box: number of segments in the rounded edge. The default (1) is a cheap
   * smooth-shaded chamfer; 2–4 give a truly round silhouette for hero shapes
   * such as heads and cushions.
   */
  round?: number;
  /** Box: X/Z scale at the top relative to the bottom. Cylinder: top radius ÷ bottom radius. */
  taper?: number;
  /** Box: taper only along X or only along Z (override `taper` per axis). */
  taperX?: number;
  taperZ?: number;
  /** Radial segments for round parts. */
  seg?: number;
  /** Cylinder / torus axis. Default "y". */
  axis?: "x" | "y" | "z";
  /** Ball / blob squash factors (also an elliptical cross-section for cylinders, and strut cross-section). */
  sx?: number;
  sy?: number;
  sz?: number;
  /** Faceted (per-face) normals instead of smooth ones. */
  flat?: boolean;
  /** Torus: sweep angle (default full circle). Blob: subdivision detail. */
  arc?: number;
  detail?: number;
  /** Prism / plate: edge bevel size. */
  bevel?: number;
}

export type Point2 = readonly [number, number];
export type Point3 = readonly [number, number, number];
export type ColorFilter = (color: THREE.Color) => void;

const DEFAULT_BEVEL = 0.014;
/** Parts thinner than this get sharp edges: a bevel would be invisible and cost 3× the triangles. */
const BEVEL_MIN_SIZE = 0.05;

// Bevelled box topology. Every corner owns three vertices — one on each face it
// touches, inset by the bevel radius — which yields 6 face quads, 12 edge quads
// and 8 corner triangles. Vertex normals are the face normals, so faces shade
// flat while edges and corners interpolate into a soft rounded highlight.
const cornerSign = (corner: number, axis: number): number => ((corner >> axis) & 1 ? 1 : -1);
const cornerVertexId = (corner: number, axis: number): number => corner * 3 + axis;

const writeCornerVertex = (out: number[], corner: number, axis: number, half: readonly number[], r: number): void => {
  for (let a = 0; a < 3; a += 1) {
    out[a] = cornerSign(corner, a) * (a === axis ? half[a] : half[a] - r);
  }
};

const buildBoxTopology = (): { faces: number[]; bevels: number[] } => {
  const half = [0.5, 0.5, 0.5];
  const r = 0.2;
  const p: number[][] = [];
  for (let corner = 0; corner < 8; corner += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const v = [0, 0, 0];
      writeCornerVertex(v, corner, axis, half, r);
      p[cornerVertexId(corner, axis)] = v;
    }
  }
  const cornerWith = (signs: readonly number[]): number =>
    (signs[0] > 0 ? 1 : 0) | (signs[1] > 0 ? 2 : 0) | (signs[2] > 0 ? 4 : 0);

  /** Triangulate a convex polygon so its winding faces `outward`. */
  const emit = (target: number[], ids: number[], outward: readonly number[]): void => {
    const [a, b, c] = [p[ids[0]], p[ids[1]], p[ids[2]]];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const ordered = nx * outward[0] + ny * outward[1] + nz * outward[2] >= 0 ? ids : [...ids].reverse();
    for (let i = 1; i < ordered.length - 1; i += 1) target.push(ordered[0], ordered[i], ordered[i + 1]);
  };

  const faces: number[] = [];
  const bevels: number[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    for (const s of [-1, 1]) {
      const ring = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([su, sv]) => {
        const signs = [0, 0, 0];
        signs[axis] = s;
        signs[u] = su;
        signs[v] = sv;
        return cornerVertexId(cornerWith(signs), axis);
      });
      const outward = [0, 0, 0];
      outward[axis] = s;
      emit(faces, ring, outward);
    }
    // Edges running along `axis`, between the faces perpendicular to u and v.
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        const ends = [-1, 1].map((se) => {
          const signs = [0, 0, 0];
          signs[axis] = se;
          signs[u] = su;
          signs[v] = sv;
          return cornerWith(signs);
        });
        const outward = [0, 0, 0];
        outward[u] = su;
        outward[v] = sv;
        emit(bevels, [cornerVertexId(ends[0], u), cornerVertexId(ends[1], u), cornerVertexId(ends[1], v), cornerVertexId(ends[0], v)], outward);
      }
    }
  }
  for (let corner = 0; corner < 8; corner += 1) {
    emit(
      bevels,
      [cornerVertexId(corner, 0), cornerVertexId(corner, 1), cornerVertexId(corner, 2)],
      [cornerSign(corner, 0), cornerSign(corner, 1), cornerSign(corner, 2)]
    );
  }
  return { faces, bevels };
};

const BOX_TOPOLOGY = buildBoxTopology();

const _local = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _axisFix = new THREE.Matrix4();
const _normalMatrix = new THREE.Matrix3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _color = new THREE.Color();
const _corner: number[] = [0, 0, 0];
const _half: number[] = [0, 0, 0];

/**
 * Accumulates coloured primitives and bakes them into one indexed geometry with
 * `position`, `normal` and `color` attributes (render with `vertexMat()`).
 *
 * Coordinates: every part is placed with (x, yBase, z) — x/z centre, yBase the
 * bottom of the un-rotated part — and optional rotation about its own centre.
 */
export class ModelBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];
  private readonly transform = new THREE.Matrix4();
  private filter: ColorFilter | null = null;

  /** Number of indices written so far (lets a prop reveal parts via `geometry.setDrawRange`). */
  get indexCount(): number {
    return this.indices.length;
  }

  /** Post-process every subsequent part colour (linear RGB) — e.g. desaturate a "vacant" variant. */
  setColorFilter(filter: ColorFilter | null): this {
    this.filter = filter;
    return this;
  }

  /** Run `build` with everything translated / yawed — for stamping sub-assemblies (chairs round a table). */
  at(x: number, y: number, z: number, yaw: number, build: () => void): this {
    const saved = this.transform.clone();
    _quat.setFromAxisAngle(_v.set(0, 1, 0), yaw);
    _local.compose(_pos.set(x, y, z), _quat, _scale.set(1, 1, 1));
    this.transform.multiply(_local);
    build();
    this.transform.copy(saved);
    return this;
  }

  /** Like `at`, with a full Euler rotation and uniform scale. */
  place(x: number, y: number, z: number, rotation: { rx?: number; ry?: number; rz?: number; scale?: number }, build: () => void): this {
    const saved = this.transform.clone();
    _euler.set(rotation.rx ?? 0, rotation.ry ?? 0, rotation.rz ?? 0);
    _quat.setFromEuler(_euler);
    const s = rotation.scale ?? 1;
    _local.compose(_pos.set(x, y, z), _quat, _scale.set(s, s, s));
    this.transform.multiply(_local);
    build();
    this.transform.copy(saved);
    return this;
  }

  /** Box, bevelled unless tiny. */
  box(w: number, h: number, d: number, color: number, x = 0, yBase = 0, z = 0, opts: PartOpts = {}): this {
    this.composeLocal(x, yBase + h / 2, z, opts);
    return this.emitBox(w, h, d, color, opts);
  }

  /**
   * Square-section bar from one point to another — the easy way to draw slanted
   * legs, braces and arms without doing trigonometry at the call site.
   * `opts.sx` / `opts.sz` stretch the cross-section.
   */
  strut(from: Point3, to: Point3, thickness: number, color: number, opts: PartOpts = {}): this {
    const length = this.composeSpan(from, to);
    return this.emitBox(thickness * (opts.sx ?? 1), length, thickness * (opts.sz ?? 1), color, opts);
  }

  /** Round bar from one point to another (poles, cables, dowels). `taper` narrows the `to` end. */
  tube(from: Point3, to: Point3, radius: number, color: number, opts: PartOpts = {}): this {
    const length = this.composeSpan(from, to);
    const seg = opts.seg ?? (radius <= 0.04 ? 8 : 12);
    return this.append(new THREE.CylinderGeometry(radius * (opts.taper ?? 1), radius, length, seg), color, opts.flat);
  }

  /** Cylinder / truncated cone (`taper` = top radius ÷ bottom radius; 0 makes a cone). */
  cyl(radius: number, h: number, color: number, x = 0, yBase = 0, z = 0, opts: PartOpts = {}): this {
    const seg = opts.seg ?? (radius <= 0.04 ? 8 : radius <= 0.16 ? 12 : radius <= 0.5 ? 18 : 28);
    const axis = opts.axis ?? "y";
    const geometry = new THREE.CylinderGeometry(radius * (opts.taper ?? 1), radius, h, seg);
    const centreY = axis === "y" ? yBase + h / 2 : yBase + radius;
    this.composeLocal(x, centreY, z, opts, opts.sx ?? 1, 1, opts.sz ?? 1);
    if (axis === "x") _local.multiply(_axisFix.makeRotationZ(-Math.PI / 2));
    else if (axis === "z") _local.multiply(_axisFix.makeRotationX(Math.PI / 2));
    return this.append(geometry, color, opts.flat);
  }

  /** Sphere, optionally squashed with sx / sy / sz. */
  ball(radius: number, color: number, x = 0, yBase = 0, z = 0, opts: PartOpts = {}): this {
    const seg = opts.seg ?? (radius <= 0.06 ? 8 : radius <= 0.2 ? 12 : 16);
    const geometry = new THREE.SphereGeometry(radius, seg, Math.max(5, Math.round(seg * 0.65)));
    const sy = opts.sy ?? 1;
    this.composeLocal(x, yBase + radius * sy, z, opts, opts.sx ?? 1, sy, opts.sz ?? 1);
    return this.append(geometry, color, opts.flat);
  }

  /** Faceted low-poly blob (icosahedron) — foliage, rocks, clouds. */
  blob(radius: number, color: number, x = 0, yBase = 0, z = 0, opts: PartOpts = {}): this {
    const geometry = new THREE.IcosahedronGeometry(radius, opts.detail ?? 1);
    const sy = opts.sy ?? 1;
    this.composeLocal(x, yBase + radius * sy, z, opts, opts.sx ?? 1, sy, opts.sz ?? 1);
    return this.append(geometry, color, opts.flat ?? true);
  }

  /** Ring. Axis "y" (default) lays it flat like a tyre on the ground; yBase is its lowest point. */
  torus(radius: number, tube: number, color: number, x = 0, yBase = 0, z = 0, opts: PartOpts = {}): this {
    const seg = opts.seg ?? 16;
    const axis = opts.axis ?? "y";
    const geometry = new THREE.TorusGeometry(radius, tube, 6, seg, opts.arc ?? Math.PI * 2);
    const centreY = axis === "y" ? yBase + tube : yBase + radius + tube;
    this.composeLocal(x, centreY, z, opts);
    // TorusGeometry lies in the XY plane (axis Z).
    if (axis === "y") _local.multiply(_axisFix.makeRotationX(Math.PI / 2));
    else if (axis === "x") _local.multiply(_axisFix.makeRotationY(Math.PI / 2));
    return this.append(geometry, color, opts.flat);
  }

  /**
   * Surface of revolution about Y. `profile` is [radius, height] pairs from the
   * bottom up; repeat a point to get a hard edge. Origin (and rotation pivot) is
   * the base centre.
   */
  lathe(profile: readonly Point2[], color: number, x = 0, yBase = 0, z = 0, opts: PartOpts = {}): this {
    const points = profile.map(([radius, height]) => new THREE.Vector2(Math.max(radius, 1e-4), height));
    const geometry = new THREE.LatheGeometry(points, opts.seg ?? 14);
    this.composeLocal(x, yBase, z, opts);
    return this.append(geometry, color, opts.flat, true);
  }

  /**
   * Extruded polygon standing upright: `points` are [x, y] in the part's own XY
   * plane, extruded `depth` along Z and centred on Z. Origin = polygon origin.
   */
  prism(points: readonly Point2[], depth: number, color: number, x = 0, y = 0, z = 0, opts: PartOpts = {}): this {
    this.composeLocal(x, y, z, opts);
    return this.append(extrude(points, depth, opts.bevel ?? 0), color, true);
  }

  /**
   * Extruded polygon lying flat: `points` are [x, z] plan coordinates,
   * `thickness` goes up from yBase. Rugs, pads, road markings, hulls.
   */
  plate(points: readonly Point2[], thickness: number, color: number, x = 0, yBase = 0, z = 0, opts: PartOpts = {}): this {
    this.composeLocal(x, yBase + thickness / 2, z, opts);
    // Rx(+90°) maps the polygon's +Y to world +Z and keeps it un-mirrored.
    _local.multiply(_axisFix.makeRotationX(Math.PI / 2));
    return this.append(extrude(points, thickness, opts.bevel ?? 0), color, true);
  }

  /** Any geometry, with an explicit local matrix. */
  geometry(geometry: THREE.BufferGeometry, color: number, matrix: THREE.Matrix4, flat = false): this {
    _local.copy(matrix);
    return this.append(geometry, color, flat);
  }

  /** Finish. The builder can keep being used afterwards (the geometry is a snapshot). */
  bake(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private composeLocal(x: number, y: number, z: number, opts: PartOpts, sx = 1, sy = 1, sz = 1): void {
    _euler.set(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0);
    _quat.setFromEuler(_euler);
    _local.compose(_pos.set(x, y, z), _quat, _scale.set(sx, sy, sz));
  }

  /** Point `_local`'s +Y along from → to, centred between them. Returns the span length. */
  private composeSpan(from: Point3, to: Point3): number {
    _v.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const length = _v.length();
    _quat.setFromUnitVectors(_n.set(0, 1, 0), _v.divideScalar(length || 1));
    _local.compose(_pos.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2), _quat, _scale.set(1, 1, 1));
    return length;
  }

  /** Write a (bevelled) box centred on `_local`. */
  private emitBox(w: number, h: number, d: number, color: number, opts: PartOpts): this {
    const minSide = Math.min(w, h, d);
    const wanted = opts.r ?? (minSide >= BEVEL_MIN_SIZE ? DEFAULT_BEVEL : 0);
    const r = Math.max(0, Math.min(wanted, minSide / 2 - 1e-4));
    const taperX = opts.taperX ?? opts.taper ?? 1;
    const taperZ = opts.taperZ ?? opts.taper ?? 1;
    if (r > 0 && (opts.round ?? 1) > 1) {
      const rounded = new RoundedBoxGeometry(w, h, d, opts.round, r);
      if (taperX !== 1 || taperZ !== 1) {
        const position = rounded.getAttribute("position");
        for (let i = 0; i < position.count; i += 1) {
          const k = (position.getY(i) + h / 2) / h;
          position.setX(i, position.getX(i) * (1 + (taperX - 1) * k));
          position.setZ(i, position.getZ(i) * (1 + (taperZ - 1) * k));
        }
      }
      return this.append(rounded, color);
    }
    _world.multiplyMatrices(this.transform, _local);
    _normalMatrix.getNormalMatrix(_world);
    this.resolveColor(color);

    _half[0] = w / 2;
    _half[1] = h / 2;
    _half[2] = d / 2;
    const base = this.positions.length / 3;
    for (let corner = 0; corner < 8; corner += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        writeCornerVertex(_corner, corner, axis, _half, r);
        const k = h > 0 ? (_corner[1] + h / 2) / h : 0;
        _v.set(_corner[0] * (1 + (taperX - 1) * k), _corner[1], _corner[2] * (1 + (taperZ - 1) * k)).applyMatrix4(_world);
        _n.set(0, 0, 0).setComponent(axis, cornerSign(corner, axis)).applyMatrix3(_normalMatrix).normalize();
        this.pushVertex();
      }
    }
    for (const index of BOX_TOPOLOGY.faces) this.indices.push(base + index);
    if (r > 0) for (const index of BOX_TOPOLOGY.bevels) this.indices.push(base + index);
    return this;
  }

  /** Leaves the part colour (linear RGB, filtered) in `_color`. */
  private resolveColor(color: number): void {
    _color.setHex(color);
    if (this.filter) this.filter(_color);
  }

  private pushVertex(): void {
    this.positions.push(_v.x, _v.y, _v.z);
    this.normals.push(_n.x, _n.y, _n.z);
    this.colors.push(_color.r, _color.g, _color.b);
  }

  /** Append `source` transformed by `_local` (then the builder transform). */
  private append(source: THREE.BufferGeometry, color: number, flat = false, fixWinding = false): this {
    let geometry = source;
    if (flat) {
      geometry = source.index ? source.toNonIndexed() : source;
      geometry.computeVertexNormals();
    }
    _world.multiplyMatrices(this.transform, _local);
    _normalMatrix.getNormalMatrix(_world);
    this.resolveColor(color);

    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const index = geometry.getIndex();
    const base = this.positions.length / 3;
    for (let i = 0; i < position.count; i += 1) {
      _v.fromBufferAttribute(position, i).applyMatrix4(_world);
      _n.fromBufferAttribute(normal, i).applyMatrix3(_normalMatrix).normalize();
      this.pushVertex();
    }
    // A mirrored transform flips triangle winding; so does a lathe whose profile
    // normals point the "wrong" way. Detect both instead of trusting the caller.
    let flip = _world.determinant() < 0;
    if (fixWinding && windingDisagreesWithNormals(geometry)) flip = !flip;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      const a = base + (index ? index.getX(i) : i);
      const b = base + (index ? index.getX(i + 1) : i + 1);
      const c = base + (index ? index.getX(i + 2) : i + 2);
      if (flip) this.indices.push(a, c, b);
      else this.indices.push(a, b, c);
    }
    return this;
  }
}

const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _pa = new THREE.Vector3();

/** True when most triangles' geometric normals oppose their vertex normals (i.e. the mesh is inside-out). */
const windingDisagreesWithNormals = (geometry: THREE.BufferGeometry): boolean => {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  let against = 0;
  let total = 0;
  for (let i = 0; i < count; i += 3) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const c = index ? index.getX(i + 2) : i + 2;
    _pa.fromBufferAttribute(position, a);
    _ab.fromBufferAttribute(position, b).sub(_pa);
    _ac.fromBufferAttribute(position, c).sub(_pa);
    _ab.cross(_ac);
    if (_ab.lengthSq() < 1e-14) continue;
    _ac.fromBufferAttribute(normal, a);
    total += 1;
    if (_ab.dot(_ac) < 0) against += 1;
  }
  return against * 2 > total;
};

const extrude = (points: readonly Point2[], depth: number, bevel: number): THREE.BufferGeometry => {
  const shape = new THREE.Shape(points.map(([px, py]) => new THREE.Vector2(px, py)));
  const b = Math.max(0, Math.min(bevel, depth / 2 - 1e-4));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * b,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    // Keep the outline at its stated size: grow the bevel inward, not outward.
    bevelOffset: -b,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 6,
  });
  geometry.translate(0, 0, -depth / 2 + b);
  return geometry;
};

/**
 * Bake a model. With a `key` the geometry is shared and cached (do NOT dispose
 * it — `disposeSharedResources` will); with `null` the caller owns it.
 */
export const bakeModel = (key: string | null, build: (b: ModelBuilder) => void): THREE.BufferGeometry => {
  const run = (): THREE.BufferGeometry => {
    const builder = new ModelBuilder();
    build(builder);
    return builder.bake();
  };
  return key === null ? run() : cachedGeometry(`model:${key}`, run);
};

/** Mesh for a baked model: vertex-colour Lambert, casts and receives shadows. */
export const modelMesh = (geometry: THREE.BufferGeometry, material: THREE.Material = vertexMat()): THREE.Mesh =>
  shadowed(new THREE.Mesh(geometry, material));

/** Outline of a rounded rectangle centred on the origin (for `prism` / `plate`). */
export const roundedRect = (w: number, h: number, radius: number, cornerSegments = 4): Point2[] => {
  const r = Math.min(radius, w / 2, h / 2);
  const points: Point2[] = [];
  const corners: Array<[number, number, number]> = [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
    [w / 2 - r, -h / 2 + r, (Math.PI * 3) / 2],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= cornerSegments; i += 1) {
      const angle = start + (i / cornerSegments) * (Math.PI / 2);
      points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
  }
  return points;
};

/** Regular polygon / circle outline centred on the origin. */
export const circlePoints = (radius: number, segments = 20, startAngle = 0): Point2[] => {
  const points: Point2[] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = startAngle + (i / segments) * Math.PI * 2;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return points;
};

/** Outline of a star with `points` tips, the first one pointing up. */
export const starPoints = (outer: number, inner: number, points = 5): Point2[] => {
  const outline: Point2[] = [];
  for (let i = 0; i < points * 2; i += 1) {
    const angle = Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const radius = i % 2 === 0 ? outer : inner;
    outline.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return outline;
};

// ─────────────────────────────────────────────────────────────────────────────
// Canvas textures (browser only — every helper returns null in node)
// ─────────────────────────────────────────────────────────────────────────────

export type CanvasDraw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

/** Font stack for anything drawn into a texture; matches the app's terminal font. */
export const LABEL_FONT = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';

interface CanvasEntry {
  texture: THREE.CanvasTexture;
  ctx: CanvasRenderingContext2D;
  draw: CanvasDraw;
}

const textureCache = new Map<string, CanvasEntry>();
/** Caller-owned textures that are still alive (so a late font load can repaint them). */
const liveDynamicTextures = new Set<CanvasEntry>();
let fontWatchStarted = false;

/** True when canvas textures can be drawn (i.e. we are in a browser). */
export const canDrawTextures = (): boolean => typeof document !== "undefined";

const repaint = (entry: CanvasEntry): void => {
  const { canvas } = entry.ctx;
  entry.ctx.clearRect(0, 0, canvas.width, canvas.height);
  entry.draw(entry.ctx, canvas.width, canvas.height);
  entry.texture.needsUpdate = true;
};

/**
 * Text drawn before the web font arrives uses a fallback face. Repaint every
 * live texture once the real font is ready so signs match the terminal.
 */
const watchLabelFont = (): void => {
  if (fontWatchStarted || typeof document === "undefined" || !document.fonts) return;
  fontWatchStarted = true;
  const probe = '600 32px "IBM Plex Mono"';
  if (document.fonts.check(probe)) return;
  document.fonts
    .load(probe)
    .then(() => {
      for (const entry of textureCache.values()) repaint(entry);
      for (const entry of liveDynamicTextures) repaint(entry);
    })
    .catch(() => {
      // Offline / blocked font: the fallback face is fine.
    });
};

const createCanvasEntry = (width: number, height: number, draw: CanvasDraw): CanvasEntry | null => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const entry: CanvasEntry = { texture, ctx, draw };
  repaint(entry);
  watchLabelFont();
  return entry;
};

/**
 * Shared, cached canvas texture. Returns null where there is no DOM (tests) —
 * callers must fall back to a flat colour.
 */
export const canvasTexture = (key: string, width: number, height: number, draw: CanvasDraw): THREE.CanvasTexture | null => {
  const cached = textureCache.get(key);
  if (cached) return cached.texture;
  const entry = createCanvasEntry(width, height, draw);
  if (!entry) return null;
  textureCache.set(key, entry);
  return entry.texture;
};

/** A canvas texture owned by one prop that repaints on demand (calendar week, "+N" sign). */
export interface DynamicTexture {
  readonly texture: THREE.CanvasTexture;
  /** Replace the picture. */
  redraw(draw: CanvasDraw): void;
  dispose(): void;
}

/** Caller-owned repaintable texture, or null where there is no DOM. Dispose it with the prop. */
export const createDynamicTexture = (width: number, height: number, draw: CanvasDraw): DynamicTexture | null => {
  const entry = createCanvasEntry(width, height, draw);
  if (!entry) return null;
  liveDynamicTextures.add(entry);
  return {
    texture: entry.texture,
    redraw(next: CanvasDraw): void {
      entry.draw = next;
      repaint(entry);
    },
    dispose(): void {
      liveDynamicTextures.delete(entry);
      entry.texture.dispose();
    },
  };
};

/** Counts of live cached resources — for leak checks in tests and the gallery HUD. */
export const sharedResourceStats = (): { materials: number; geometries: number; textures: number } => ({
  materials: materialCache.size,
  geometries: geometryCache.size,
  textures: textureCache.size,
});

/**
 * Free every cached material, geometry and texture and empty the caches. Safe to
 * call repeatedly; the next `mat()` / `bakeModel()` / `canvasTexture()` call
 * simply rebuilds what it needs.
 */
export const disposeSharedResources = (): void => {
  for (const material of materialCache.values()) material.dispose();
  for (const geometry of geometryCache.values()) geometry.dispose();
  for (const entry of textureCache.values()) entry.texture.dispose();
  materialCache.clear();
  geometryCache.clear();
  textureCache.clear();
};

// Kept for callers that want to blend in linear space with THREE.Color scratch objects.
export const lerpColorInto = (target: THREE.Color, a: number, b: number, t: number): THREE.Color =>
  target.copy(_mixA.setHex(a)).lerp(_mixB.setHex(b), t);
