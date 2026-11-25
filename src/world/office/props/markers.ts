/**
 * Markers: the one thing in the office that is not furniture — the sign beside the door that counts the people
 * of the company who are not drawn ("+100").
 * (The selection ring belongs to the interaction layer, not here.)
 */
import * as THREE from "three";
import { C, createDynamicTexture, cssColor, EMBER, INK, LABEL_FONT, unitPlane } from "../../core/palette";
import type { CanvasDraw } from "../../core/palette";
import { PropKit } from "./shared";
import type { PropHandle } from "./shared";

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
 * "+N": so many more people work here than are drawn. A picket sign with a little crowd of heads peeking over
 * it. A plus and a number, no words and no names.
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
