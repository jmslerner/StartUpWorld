import * as THREE from "three";
import { CAMERA_AZIMUTH } from "../core/CameraRig";
import { PARTICLE_SHAPES, SLOT_FREE, type ParticlePool, type ParticleShape } from "./particles";

const Y_AXIS = new THREE.Vector3(0, 1, 0);
/** How far (radians) and how fast (rad/s) camera-facing particles rock from side to side. */
const FACING_ROCK = 0.3;
const FACING_ROCK_RATE = 3;

const heartGeometry = (): THREE.BufferGeometry => {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.45);
  shape.bezierCurveTo(-0.15, -0.3, -0.5, -0.1, -0.5, 0.15);
  shape.bezierCurveTo(-0.5, 0.42, -0.14, 0.5, 0, 0.26);
  shape.bezierCurveTo(0.14, 0.5, 0.5, 0.42, 0.5, 0.15);
  shape.bezierCurveTo(0.5, -0.1, 0.15, -0.3, 0, -0.45);
  const depth = 0.32;
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 5 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
};

/** A chunky pawn: wide base, narrow neck, round head. One unit tall, centred on its middle. */
const pegGeometry = (): THREE.BufferGeometry => {
  const profile: ReadonlyArray<readonly [number, number]> = [
    [0, -0.5],
    [0.3, -0.5],
    [0.27, -0.22],
    [0.14, 0.06],
    [0.2, 0.13],
    [0.26, 0.27],
    [0.2, 0.42],
    [0.1, 0.5],
    [0, 0.5],
  ];
  return new THREE.LatheGeometry(
    profile.map(([radius, height]) => new THREE.Vector2(radius, height)),
    8
  );
};

const SHAPE_GEOMETRY: Record<ParticleShape, () => THREE.BufferGeometry> = {
  chip: () => new THREE.BoxGeometry(1, 1, 1),
  gem: () => new THREE.OctahedronGeometry(0.5, 0),
  puff: () => new THREE.IcosahedronGeometry(0.5, 1),
  heart: heartGeometry,
  peg: pegGeometry,
};

/**
 * Draws a ParticlePool: one InstancedMesh per shape, with per-instance colour.
 * Fading is done by shrinking (see ParticlePool.scaleOf), so everything stays
 * opaque — no sorting, no overdraw, and the particles pick up the scene's
 * light like the rest of the diorama.
 */
export class ParticleRenderer {
  readonly root = new THREE.Group();

  private readonly pool: ParticlePool;
  private readonly litMaterial: THREE.MeshLambertMaterial;
  /** Sparkles are unlit and skip tone mapping so they still glint at dusk. */
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly counts: number[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();

  constructor(pool: ParticlePool) {
    this.pool = pool;
    this.litMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.root.name = "fx-particles";

    for (const shape of PARTICLE_SHAPES) {
      const material = shape === "gem" ? this.glowMaterial : this.litMaterial;
      const mesh = new THREE.InstancedMesh(SHAPE_GEOMETRY[shape](), material, pool.capacity);
      mesh.name = `fx-${shape}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pool.capacity * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      // Instances roam the whole scene; a bounding sphere computed once would cull them wrongly.
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.counts.push(0);
      this.root.add(mesh);
    }
  }

  /** Copy the pool's current state into the instance buffers. Call once per frame after pool.step(). */
  sync(): void {
    const { pool, meshes, counts, matrix, position, scale, axis, quaternion } = this;
    counts.fill(0);

    for (let i = 0; i < pool.capacity; i += 1) {
      if (pool.state[i] === SLOT_FREE) continue;
      const size = pool.scaleOf(i);
      if (size <= 0) continue;
      const profile = pool.profileOf(i);
      const shapeIndex = PARTICLE_SHAPES.indexOf(profile.shape);
      const mesh = meshes[shapeIndex];
      const slot = counts[shapeIndex];
      counts[shapeIndex] = slot + 1;

      switch (profile.orientation) {
        case "tumble":
          quaternion.setFromAxisAngle(axis.set(pool.ax[i], pool.ay[i], pool.az[i]), pool.rot[i]);
          break;
        case "upright":
          quaternion.setFromAxisAngle(Y_AXIS, pool.rot[i]);
          break;
        case "facing":
          quaternion.setFromAxisAngle(
            Y_AXIS,
            CAMERA_AZIMUTH + Math.sin(pool.age[i] * FACING_ROCK_RATE + pool.phase[i]) * FACING_ROCK
          );
          break;
        case "heading":
          quaternion.setFromAxisAngle(Y_AXIS, Math.atan2(pool.vx[i], pool.vz[i]));
          break;
      }

      position.set(pool.px[i], pool.py[i], pool.pz[i]);
      scale.set(size * profile.proportions[0], size * profile.proportions[1], size * profile.proportions[2]);
      matrix.compose(position, quaternion, scale);
      matrix.toArray(mesh.instanceMatrix.array, slot * 16);

      const colors = (mesh.instanceColor as THREE.InstancedBufferAttribute).array;
      colors[slot * 3] = pool.r[i];
      colors[slot * 3 + 1] = pool.g[i];
      colors[slot * 3 + 2] = pool.b[i];
    }

    for (let s = 0; s < meshes.length; s += 1) {
      const mesh = meshes[s];
      const count = counts[s];
      mesh.count = count;
      mesh.visible = count > 0;
      if (count === 0) continue;
      const colors = mesh.instanceColor as THREE.InstancedBufferAttribute;
      // Upload only the live prefix of each buffer.
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      colors.clearUpdateRanges();
      colors.addUpdateRange(0, count * 3);
      colors.needsUpdate = true;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      // Frees the per-instance GPU buffers.
      mesh.dispose();
    }
    this.litMaterial.dispose();
    this.glowMaterial.dispose();
  }
}
