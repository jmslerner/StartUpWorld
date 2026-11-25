/**
 * Split from src/world/types.ts (M5): geometry conventions and the basic
 * vector/placement types. Re-exported by ../types.
 *
 * Geometry conventions
 *   • Right-handed, Y up. 1 world unit ≈ 1 metre. The office floor sits at y = 0.
 *   • `facing` is a yaw in radians about +Y. facing = 0 looks toward +Z,
 *     facing = Math.PI / 2 looks toward +X (i.e. Object3D.rotation.y = facing).
 *   • The camera is isometric and looks from (+X, +Y, +Z) toward the origin, so
 *     tall back walls belong on the −X and −Z edges; the +X / +Z edges are open
 *     (or low cut-away walls) so the interior is always visible.
 */

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

