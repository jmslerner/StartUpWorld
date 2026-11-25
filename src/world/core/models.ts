/** Split from core/palette.ts (M5): ModelBuilder and the baked-model helpers (bakeModel, modelMesh, outline shapes). Re-exported by ./palette, so every existing import from "./palette" / "../core/palette" keeps working. */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { cachedGeometry, shadowed } from "./geometry";
import { vertexMat } from "./materials";

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
