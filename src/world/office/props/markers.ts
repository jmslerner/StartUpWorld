/**
 * Markers: attention-grabbers that are not furniture — the event beacon, the
 * low-runway alarm light and the "+N more people" overflow sign.
 * (The selection ring belongs to the interaction layer, not here.)
 */
import * as THREE from "three";
import { bakeModel, C, createDynamicTexture, cssColor, EMBER, glowMat, INK, LABEL_FONT, lighten, mat, unitPlane } from "../../core/palette";
import type { CanvasDraw } from "../../core/palette";
import { PropKit, shapeMesh } from "./shared";
import type { PropHandle } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Event beacon
// ─────────────────────────────────────────────────────────────────────────────

/** Height of the beacon's "!" above the floor — above the 2.6 back walls, so it shows from anywhere. */
export const EVENT_BEACON_HEIGHT = 3.0;

/**
 * "Something needs you": a tall ember "!" bobbing over a shaft of light, with
 * rings pulsing out across the floor. The "!" is a solid of revolution, so it
 * reads the same from every side. Origin on the floor under it.
 */
export const createEventBeacon = (): PropHandle => {
  const kit = new PropKit("event-beacon");

  const pin = new THREE.Group();
  kit.add(pin);
  const core = glowMat(lighten(EMBER, 0.55));
  const shell = glowMat(EMBER);
  const mark = (scale: number): THREE.BufferGeometry =>
    bakeModel(`event-beacon:mark:${scale}`, (b) => {
      b.lathe(
        [
          [0.001, 0.26],
          [0.085 * scale, 0.27],
          [0.15 * scale, 0.86],
          [0.13 * scale, 0.95],
          [0.001, 0.96],
        ],
        0xffffff,
        0,
        0,
        0,
        { seg: 14 }
      );
      b.ball(0.115 * scale, 0xffffff, 0, 0.115 - 0.115 * scale, 0, { seg: 12 });
    });
  // A pale core inside a slightly larger ember shell gives the mark a hot centre.
  pin.add(shapeMesh(mark(0.62), core, false));
  const halo = shapeMesh(mark(1), shell, false);
  pin.add(halo);

  const shaft = shapeMesh(
    bakeModel("event-beacon:shaft", (b) => b.cyl(0.2, EVENT_BEACON_HEIGHT - 0.1, 0xffffff, 0, 0, 0, { taper: 0.35, seg: 12 })),
    glowMat(EMBER, { additive: true, opacity: 0.22 }),
    false
  );
  kit.add(shaft);

  const ringGeometry = bakeModel("event-beacon:ring", (b) => b.torus(1, 0.035, 0xffffff, 0, 0, 0, { seg: 32 }));
  const rings = [0, 1].map(() => {
    const material = kit.own(glowMat(EMBER, { opacity: 1 }).clone());
    material.transparent = true;
    material.depthWrite = false;
    const ring = new THREE.Mesh(ringGeometry, material);
    ring.position.y = 0.03;
    kit.add(ring);
    return { ring, material };
  });

  kit.onUpdate((_dt, elapsed) => {
    pin.position.y = EVENT_BEACON_HEIGHT + Math.sin(elapsed * 2.6) * 0.12;
    pin.rotation.y = elapsed * 1.2;
    const throb = 1 + Math.sin(elapsed * 5.2) * 0.08;
    halo.scale.set(throb, 1, throb);
    shaft.scale.x = shaft.scale.z = 0.9 + Math.sin(elapsed * 5.2) * 0.12;
    rings.forEach(({ ring, material }, i) => {
      const life = (elapsed * 0.55 + i * 0.5) % 1;
      const radius = 0.25 + life * 0.95;
      ring.scale.set(radius, 1, radius);
      material.opacity = (1 - life) * 0.85;
    });
  });
  pin.position.y = EVENT_BEACON_HEIGHT;
  return kit.finish({ w: 1.0, d: 1.0 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Alarm light
// ─────────────────────────────────────────────────────────────────────────────

export interface AlarmLightHandle extends PropHandle {
  /** Off = dark dome, no beams. Starts on. */
  setActive(active: boolean): void;
}

/**
 * Rotating red warning light for when the runway is nearly gone. Stands on
 * whatever you put it on (floor, desk, wall top): origin at the base.
 */
export const createAlarmLight = (): AlarmLightHandle => {
  const kit = new PropKit("alarm-light");
  kit.model("alarm-light:base", (b) => {
    b.cyl(0.13, 0.07, C.charcoal, 0, 0, 0, { seg: 12 });
    b.cyl(0.1, 0.03, C.black, 0, 0.07, 0, { seg: 12 });
  });
  const dome = kit.own(mat(0x7a1f1f, { emissive: C.alarm, emissiveIntensity: 1 }).clone());
  kit.add(
    shapeMesh(
      bakeModel("alarm-light:dome", (b) => {
        b.cyl(0.085, 0.1, 0xffffff, 0, 0.1, 0, { seg: 12 });
        b.ball(0.085, 0xffffff, 0, 0.115, 0, { seg: 12 });
      }),
      dome,
      false
    )
  );
  // Two opposed beams sweeping round, and a pool of red on the surface below.
  const beams = shapeMesh(
    bakeModel("alarm-light:beams", (b) => {
      // Cones widening away from the lamp: the +X one grows toward its far end, the −X one toward its near end.
      for (const sx of [-1, 1]) {
        const radius = sx > 0 ? 0.04 : 0.2;
        b.cyl(radius, 1.1, 0xffffff, sx * 0.6, -radius, 0, { axis: "x", taper: sx > 0 ? 5 : 1 / 5, seg: 10 });
      }
    }),
    glowMat(C.alarm, { additive: true, opacity: 0.16 }),
    false
  );
  // High enough that the wide end of a beam never dips below the base.
  beams.position.y = 0.22;
  kit.add(beams);
  const pool = kit.own(glowMat(C.alarm, { additive: true, opacity: 1 }).clone());
  const poolMesh = shapeMesh(bakeModel("alarm-light:pool", (b) => b.cyl(0.9, 0.004, 0xffffff, 0, 0.004, 0, { seg: 20 })), pool, false);
  kit.add(poolMesh);

  let active = true;
  kit.onUpdate((dt, elapsed) => {
    if (!active) return;
    beams.rotation.y += dt * 4.2;
    const pulse = 0.5 + Math.sin(elapsed * 6.5) * 0.5;
    dome.emissiveIntensity = 0.7 + pulse * 1.1;
    pool.opacity = 0.08 + pulse * 0.14;
  });
  return kit.finish(
    { w: 0.3, d: 0.3 },
    {
      setActive: (next: boolean) => {
        active = next;
        beams.visible = next;
        poolMesh.visible = next;
        dome.emissiveIntensity = next ? 1 : 0;
      },
    }
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Overflow sign
// ─────────────────────────────────────────────────────────────────────────────

export interface OverflowSignHandle extends PropHandle {
  /** Show "+count". Hides the whole sign when count ≤ 0. */
  setCount(count: number): void;
}

const drawCount =
  (count: number): CanvasDraw =>
  (ctx, w, h) => {
    ctx.fillStyle = cssColor(INK);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = cssColor(EMBER);
    const label = `+${Math.max(0, Math.round(count))}`;
    ctx.font = `600 ${Math.round(h * (label.length > 3 ? 0.5 : 0.66))}px ${LABEL_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, w / 2, h / 2 + 3, w - 12);
  };

/**
 * "+N more people than the office can show": a picket sign with a little crowd
 * of heads peeking over it. The number is on both faces.
 */
export const createOverflowSign = (): OverflowSignHandle => {
  const kit = new PropKit("overflow-sign");
  const boardW = 0.74;
  const boardH = 0.46;
  const boardY = 0.82;
  kit.model("overflow-sign", (b) => {
    b.box(0.07, boardY + boardH * 0.6, 0.06, C.pallet, 0, 0, -0.02, { r: 0.012 });
    b.box(0.26, 0.04, 0.26, C.pallet, 0, 0, -0.02, { r: 0.012 });
    b.box(boardW + 0.06, boardH + 0.06, 0.05, C.plywood, 0, boardY - 0.03, 0.03, { r: 0.016, rz: -0.03 });
    b.box(boardW, boardH, 0.02, INK, 0, boardY, 0.052, { r: 0.008, rz: -0.03 });
    // Fallback mark for when the number cannot be drawn: an ember "+".
    b.box(0.2, 0.05, 0.01, EMBER, 0, boardY + boardH / 2 - 0.025, 0.06, { r: 0 });
    b.box(0.05, 0.2, 0.01, EMBER, 0, boardY + boardH / 2 - 0.1, 0.06, { r: 0 });
    // Three heads queuing behind the sign.
    [C.coral, C.teal, C.yellow].forEach((shirt, i) => {
      const x = -0.3 + i * 0.3;
      b.ball(0.12, [0xf3c998, 0x9a6038, 0xe2ad76][i], x, 1.3 + (i % 2) * 0.07, -0.24, { seg: 10 });
      b.box(0.26, 0.5, 0.18, shirt, x, 0.84 + (i % 2) * 0.07, -0.24, { r: 0.07 });
      b.box(0.2, 0.86, 0.14, C.charcoal, x, 0, -0.24, { r: 0.04 });
    });
  });

  let count = 1;
  const texture = createDynamicTexture(160, 100, drawCount(count));
  if (texture) {
    kit.own(texture);
    const material = kit.own(new THREE.MeshLambertMaterial({ color: 0x666666, map: texture.texture, emissive: 0xffffff, emissiveMap: texture.texture, emissiveIntensity: 0.8 }));
    const face = new THREE.Mesh(unitPlane(), material);
    face.scale.set(boardW - 0.02, boardH - 0.02, 1);
    face.position.set(0, boardY + boardH / 2, 0.067);
    face.rotation.z = -0.03;
    kit.add(face);
  }
  return kit.finish(
    { w: 0.9, d: 0.5 },
    {
      setCount: (next: number) => {
        kit.group.visible = next > 0;
        if (next === count) return;
        count = next;
        texture?.redraw(drawCount(count));
      },
    }
  );
};
