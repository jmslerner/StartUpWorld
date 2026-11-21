/**
 * Purchasable assets (src/engine/assets.ts): the office-upgrade kit, the
 * executive lounge, the helicopter, the jet and the yacht — plus
 * `makeBlueprint`, which turns any prop into the translucent "you could buy
 * this" ghost shown before it is owned.
 *
 * Each asset fills the ground rectangle the floor plans reserve for it
 * (ASSET_SIZES in ../footprints) and brings its own pad / apron / water.
 */
import * as THREE from "three";
import type { AssetId } from "../../../types/game";
import {
  bakeModel,
  C,
  circlePoints,
  createDynamicTexture,
  cssColor,
  darken,
  EMBER,
  glowMat,
  INK,
  LABEL_FONT,
  lighten,
  NEON,
  roundedRect,
  unitSphere,
} from "../../core/palette";
import type { CanvasDraw, ModelBuilder, Point2 } from "../../core/palette";
import { ASSET_SIZES } from "../footprints";
import { addLightPool } from "./building";
import { drawMonitor, drawMug, drawPlant, monitorScreen } from "./parts";
import { createScreenSurface, PropKit, screenQuads, shapeMesh } from "./shared";
import type { PropFootprint, PropHandle } from "./shared";

/** Ground rectangle of each asset as { w, d } (mirrors ASSET_SIZES). */
export const ASSET_FOOTPRINTS: Record<AssetId, PropFootprint> = {
  "office-upgrade": { w: ASSET_SIZES["office-upgrade"].width, d: ASSET_SIZES["office-upgrade"].depth },
  lounge: { w: ASSET_SIZES.lounge.width, d: ASSET_SIZES.lounge.depth },
  helicopter: { w: ASSET_SIZES.helicopter.width, d: ASSET_SIZES.helicopter.depth },
  jet: { w: ASSET_SIZES.jet.width, d: ASSET_SIZES.jet.depth },
  yacht: { w: ASSET_SIZES.yacht.width, d: ASSET_SIZES.yacht.depth },
};

// ─────────────────────────────────────────────────────────────────────────────
// Office upgrade — espresso bar + standing desk
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the "Office Upgrade" buys: a proper espresso bar and a standing desk,
 * as one piece that stands against a wall (front +Z). Steam rises from the
 * machine; `setGlow` lights the under-counter strip and the screen.
 */
export const createOfficeUpgradeKit = (): PropHandle => {
  const { w, d } = ASSET_FOOTPRINTS["office-upgrade"];
  const kit = new PropKit("asset:office-upgrade");
  const barW = w * 0.62;
  const barX = -w / 2 + barW / 2 + 0.02;
  const deskX = w / 2 - 0.28;
  const top = 0.95;
  const laptop = { kind: "laptop", x: deskX, y: 1.1, z: -0.02, yaw: Math.PI, shell: C.chrome } as const;

  kit.model("asset:office-upgrade", (b) => {
    // Bar: white carcass, oak top, slatted front.
    b.box(barW, top - 0.05, d - 0.1, C.white, barX, 0, -0.03, { r: 0.016 });
    b.box(barW + 0.04, 0.05, d - 0.02, C.oak, barX, top - 0.05, 0, { r: 0.016 });
    b.box(barW - 0.04, 0.07, d - 0.14, C.charcoal, barX, 0, -0.03, { r: 0 });
    for (let i = 0; i < 9; i += 1) b.box(0.05, top - 0.2, 0.02, C.oak, barX - barW / 2 + 0.08 + (i * (barW - 0.16)) / 8, 0.1, d / 2 - 0.075, { r: 0 });
    // Espresso machine.
    const mx = barX - 0.14;
    b.box(0.5, 0.06, 0.36, C.charcoal, mx, top, -0.04, { r: 0.012 });
    b.box(0.5, 0.2, 0.18, C.chrome, mx, top + 0.06, -0.12, { r: 0.02 });
    b.box(0.5, 0.13, 0.38, C.chrome, mx, top + 0.25, -0.03, { r: 0.03 });
    for (const sx of [-1, 1]) {
      b.cyl(0.04, 0.05, C.charcoal, mx + sx * 0.12, top + 0.2, 0.07, { seg: 8 });
      b.box(0.022, 0.022, 0.15, C.black, mx + sx * 0.12, top + 0.195, 0.16, { r: 0 });
      b.cyl(0.032, 0.05, C.white, mx + sx * 0.12, top + 0.06, 0.07, { seg: 8 });
      b.cyl(0.03, 0.045, C.white, mx + sx * 0.1, top + 0.38, -0.06, { seg: 8 });
    }
    b.cyl(0.035, 0.012, C.paper, mx - 0.18, top + 0.28, 0.162, { axis: "z", seg: 10 });
    // Grinder + a jar of beans.
    b.box(0.15, 0.24, 0.18, C.chrome, barX + 0.3, top, -0.08, { r: 0.02 });
    b.cyl(0.065, 0.15, 0x5a3a26, barX + 0.3, top + 0.24, -0.08, { taper: 1.35, seg: 10 });
    b.cyl(0.092, 0.015, C.charcoal, barX + 0.3, top + 0.39, -0.08, { seg: 10 });
    drawMug(b, barX + 0.34, top, 0.16, C.white, 0.6);

    // Standing desk: one slim column, a high top, a perch stool.
    b.box(0.5, 0.035, 0.36, C.white, deskX, 0, 0, { r: 0.012 });
    b.box(0.09, 0.62, 0.1, C.white, deskX, 0.035, -0.06, { r: 0.014 });
    b.box(0.065, 0.42, 0.075, C.chrome, deskX, 0.64, -0.06, { r: 0.01 });
    b.box(0.54, 0.045, d - 0.16, C.oak, deskX, 1.055, 0, { r: 0.02 });
    drawMonitor(b, laptop);
    drawPlant(b, "small", deskX + 0.17, 1.1, 0.18, C.white, 1);
  });

  const screen = createScreenSurface("design");
  kit.own(screen.material);
  kit.add(new THREE.Mesh(screenQuads("asset:office-upgrade", [monitorScreen(laptop)]), screen.material));
  const strip = kit.emissive(lighten(NEON, 0.2), NEON, 0.45, 1.3);
  kit.add(shapeMesh(bakeModel("asset:office-upgrade:strip", (b) => b.box(barW - 0.06, 0.025, 0.02, 0xffffff, barX, top - 0.09, d / 2 - 0.03, { r: 0 })), strip, false));
  kit.onGlow((amount) => screen.setGlow(amount));

  const steam = glowMat(0xffffff, { opacity: 0.7 });
  const puffs = [0, 1, 2].map(() => {
    const puff = new THREE.Mesh(unitSphere(8), steam);
    puff.scale.setScalar(0);
    kit.add(puff);
    return puff;
  });
  kit.onUpdate((_dt, elapsed) => {
    puffs.forEach((puff, i) => {
      const life = (elapsed * 0.45 + i / puffs.length) % 1;
      puff.position.set(barX - 0.14 + Math.sin(elapsed * 1.3 + i * 2.1) * 0.03 * life, top + 0.42 + life * 0.4, 0);
      puff.scale.setScalar(0.03 + Math.sin(life * Math.PI) * 0.1);
    });
  });
  return kit.finish({ w, d });
};

// ─────────────────────────────────────────────────────────────────────────────
// Executive lounge
// ─────────────────────────────────────────────────────────────────────────────

const drawClubChair = (b: ModelBuilder, leather: number): void => {
  const shade = darken(leather, 0.16);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.cyl(0.035, 0.09, C.brass, sx * 0.34, 0, sz * 0.3, { taper: 1.3, seg: 6 });
  }
  b.box(0.92, 0.22, 0.84, shade, 0, 0.09, 0, { r: 0.06 });
  b.box(0.6, 0.15, 0.56, leather, 0, 0.3, 0.1, { r: 0.06, round: 2 });
  b.box(0.92, 0.56, 0.22, leather, 0, 0.26, -0.32, { r: 0.1, round: 2, rx: -0.14 });
  for (const sx of [-1, 1]) b.box(0.2, 0.36, 0.84, leather, sx * 0.37, 0.26, 0, { r: 0.09, round: 2 });
  // Button tufts.
  for (const sx of [-1, 0, 1]) b.ball(0.018, shade, sx * 0.18, 0.62, -0.215, { seg: 6 });
};

/**
 * Executive lounge: leather seating round a low table, a bar cart, a lamp, on
 * a rug the size of the reserved area. Low enough to read from any side.
 * `setGlow` lights the lamp.
 */
export const createLounge = (): PropHandle => {
  const { w, d } = ASSET_FOOTPRINTS.lounge;
  const kit = new PropKit("asset:lounge");
  kit.model("asset:lounge", (b) => {
    // Rug.
    b.plate(roundedRect(w - 0.1, d - 0.1, 0.16), 0.014, C.brass, 0, 0, 0);
    b.plate(roundedRect(w - 0.22, d - 0.22, 0.12), 0.004, C.burgundy, 0, 0.014, 0);
    b.plate(roundedRect(w - 0.7, d - 0.7, 0.08), 0.002, darken(C.burgundy, 0.18), 0, 0.018, 0);

    // Sofa along the back, club chairs facing each other across the table.
    b.at(0, 0, -d / 2 + 0.52, 0, () => {
      const leather = C.leather;
      const shade = darken(leather, 0.16);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) b.cyl(0.035, 0.09, C.brass, sx * 0.72, 0, sz * 0.3, { taper: 1.3, seg: 6 });
        b.box(0.2, 0.36, 0.84, leather, sx * 0.74, 0.26, 0, { r: 0.09, round: 2 });
      }
      b.box(1.68, 0.22, 0.84, shade, 0, 0.09, 0, { r: 0.06 });
      b.box(1.32, 0.56, 0.22, leather, 0, 0.26, -0.32, { r: 0.1, round: 2, rx: -0.14 });
      for (const sx of [-1, 1]) b.box(0.64, 0.15, 0.56, leather, sx * 0.33, 0.3, 0.1, { r: 0.06, round: 2 });
      for (const sx of [-2, -1, 0, 1, 2]) b.ball(0.018, shade, sx * 0.24, 0.62, -0.215, { seg: 6 });
    });
    b.at(-w / 2 + 0.55, 0, 0.3, Math.PI / 2 - 0.25, () => drawClubChair(b, C.leather));
    b.at(w / 2 - 0.55, 0, 0.3, -Math.PI / 2 + 0.25, () => drawClubChair(b, C.leatherDark));

    // Marble table: decanter and two tumblers.
    const tx = 0;
    const tz = 0.32;
    b.cyl(0.42, 0.04, C.marbleLight, tx, 0.36, tz, { seg: 20 });
    b.cyl(0.43, 0.012, C.brass, tx, 0.348, tz, { seg: 20 });
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      b.tube([tx + Math.cos(a) * 0.34, 0, tz + Math.sin(a) * 0.34], [tx + Math.cos(a) * 0.2, 0.36, tz + Math.sin(a) * 0.2], 0.016, C.brass, { seg: 6 });
    }
    b.lathe(
      [
        [0.06, 0],
        [0.07, 0.1],
        [0.03, 0.15],
        [0.025, 0.2],
        [0.035, 0.21],
      ],
      0xc9843a,
      tx - 0.08,
      0.4,
      tz - 0.05,
      { seg: 8 }
    );
    b.ball(0.028, 0xe9d8b0, tx - 0.08, 0.6, tz - 0.05, { seg: 6 });
    b.cyl(0.035, 0.07, 0xdcc48e, tx + 0.12, 0.4, tz + 0.08, { seg: 8 });
    b.cyl(0.035, 0.07, 0xdcc48e, tx + 0.02, 0.4, tz + 0.16, { seg: 8 });

    // Bar cart.
    const cx = w / 2 - 0.36;
    const cz = -d / 2 + 0.34;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.cyl(0.014, 0.8, C.brass, cx + sx * 0.24, 0.06, cz + sz * 0.15, { seg: 6 });
        b.torus(0.04, 0.014, C.black, cx + sx * 0.24, 0, cz + sz * 0.15, { axis: "x", seg: 8 });
      }
    }
    for (const y of [0.24, 0.72]) b.box(0.52, 0.025, 0.34, y > 0.5 ? 0xd9eef5 : C.walnut, cx, y, cz, { r: 0.008 });
    [0x2f7d55, 0xc9843a, 0x7c2a35, 0xd9eef5].forEach((bottle, i) => {
      b.cyl(0.04, 0.2, bottle, cx - 0.17 + i * 0.11, 0.745, cz - 0.05, { seg: 8 });
      b.cyl(0.015, 0.08, bottle, cx - 0.17 + i * 0.11, 0.945, cz - 0.05, { seg: 6 });
    });
    for (let i = 0; i < 3; i += 1) b.cyl(0.03, 0.06, 0xdff0f5, cx - 0.12 + i * 0.1, 0.745, cz + 0.09, { seg: 8 });
    b.cyl(0.09, 0.1, C.brass, cx, 0.265, cz, { seg: 10 });

    // Lamp stand (its shade is lit separately) and a palm.
    b.cyl(0.15, 0.03, C.marble, -w / 2 + 0.34, 0.014, -d / 2 + 0.34, { seg: 14 });
    b.cyl(0.018, 1.25, C.brass, -w / 2 + 0.34, 0.04, -d / 2 + 0.34, { seg: 6 });
    drawPlant(b, "medium", -w / 2 + 0.34, 0.014, d / 2 - 0.36, C.brass, 2);
  });
  const shade = kit.emissive(C.cream, C.lampWarm, 0.2, 1.1);
  kit.add(shapeMesh(bakeModel("asset:lounge:shade", (b) => b.cyl(0.19, 0.3, 0xffffff, -w / 2 + 0.34, 1.27, -d / 2 + 0.34, { taper: 0.78, seg: 14 })), shade));
  addLightPool(kit, 1.5, C.lampWarm, -w / 2 + 0.34, -d / 2 + 0.34);
  return kit.finish({ w, d });
};

// ─────────────────────────────────────────────────────────────────────────────
// Helicopter
// ─────────────────────────────────────────────────────────────────────────────

export interface HelicopterHandle extends PropHandle {
  /** Main rotor speed in revolutions per second (default 0.35, a lazy idle). */
  setRotorSpeed(revolutionsPerSecond: number): void;
}

/** Company helicopter parked on its helipad. Nose toward +Z. The rotors turn in update(). */
export const createHelicopter = (): HelicopterHandle => {
  const { w, d } = ASSET_FOOTPRINTS.helicopter;
  const kit = new PropKit("asset:helicopter");
  const padR = Math.min(w, d) / 2 - 0.2;
  const hubY = 2.22;
  /** Airframe offset along the pad, and where its tail boom ends (airframe frame). */
  const HELI_Z = 0.3;
  const TAIL_Z = -2.5;

  kit.model("asset:helicopter", (b) => {
    // Pad.
    b.plate(circlePoints(padR, 28), 0.05, C.asphalt, 0, 0, 0);
    b.torus(padR - 0.14, 0.035, C.yellow, 0, 0.03, 0, { seg: 36 });
    b.torus(padR * 0.62, 0.03, C.paper, 0, 0.03, 0, { seg: 32 });
    for (const sx of [-1, 1]) b.box(0.16, 0.012, 1.0, C.paper, sx * 0.34, 0.05, 0, { r: 0 });
    b.box(0.68, 0.012, 0.16, C.paper, 0, 0.05, 0, { r: 0 });

    // The airframe sits a little forward of the pad centre so the tail stays inside the footprint.
    b.at(0, 0, HELI_Z, 0, () => {
      // Skids.
      for (const sx of [-1, 1]) {
        b.tube([sx * 0.62, 0.11, -0.95], [sx * 0.62, 0.11, 1.05], 0.035, C.charcoal, { seg: 6 });
        b.tube([sx * 0.62, 0.11, 1.05], [sx * 0.62, 0.24, 1.25], 0.035, C.charcoal, { seg: 6 });
        for (const sz of [-0.5, 0.55]) b.tube([sx * 0.62, 0.11, sz], [sx * 0.36, 0.7, sz], 0.028, C.charcoal, { seg: 6 });
      }
      // Cabin pod with a bubble canopy.
      b.ball(0.78, C.white, 0, 0.48, 0, { sx: 0.86, sy: 0.92, sz: 1.3, seg: 16 });
      b.ball(0.62, 0x3c556e, 0, 0.56, 0.5, { sx: 0.9, sy: 0.92, sz: 1.0, seg: 14 });
      // Ember belt: a wafer of the same pod shape, a hair wider, so it hugs the curve all the way round.
      b.ball(0.78, EMBER, 0, 1.14, 0, { sx: 0.875, sy: 0.075, sz: 1.31, seg: 16 });
      // Engine cowl, mast.
      b.box(0.66, 0.34, 1.2, C.white, 0, 1.72, -0.3, { r: 0.12, round: 2 });
      b.box(0.3, 0.14, 0.4, C.charcoal, 0, 1.74, -0.92, { r: 0.04 });
      b.cyl(0.05, 0.22, C.charcoal, 0, 2.02, -0.15, { seg: 8 });
      // Tail boom, fin, stabiliser.
      b.tube([0, 1.4, -0.75], [0, 1.62, TAIL_Z], 0.17, C.white, { taper: 0.4, seg: 10 });
      b.prism(
        [
          [-0.25, 0],
          [0.3, 0],
          [0.05, 0.75],
          [-0.3, 0.75],
        ],
        0.07,
        C.white,
        0,
        1.55,
        TAIL_Z + 0.03,
        { ry: -Math.PI / 2 }
      );
      b.box(0.07, 0.24, 0.3, NEON, 0, 2.06, TAIL_Z - 0.08, { r: 0.012 });
      b.box(0.9, 0.04, 0.26, C.white, 0, 1.56, TAIL_Z + 0.45, { r: 0.014 });
      b.cyl(0.045, 0.16, C.charcoal, 0.08, 1.74, TAIL_Z + 0.03, { axis: "x", seg: 8 });
    });
  });

  // Main rotor: four blades on a hub.
  const rotor = kit.model("asset:helicopter:rotor", (b) => {
    b.cyl(0.11, 0.08, C.charcoal, 0, -0.04, 0, { seg: 10 });
    for (let i = 0; i < 4; i += 1) {
      b.at(0, 0, 0, (i / 4) * Math.PI * 2, () => {
        b.box(0.16, 0.025, 2.1, C.charcoal, 0, 0, 1.12, { r: 0.008 });
        b.box(0.16, 0.027, 0.22, EMBER, 0, 0, 2.06, { r: 0 });
      });
    }
  });
  rotor.position.set(0, hubY, HELI_Z - 0.15);
  const tailRotor = kit.model("asset:helicopter:tail-rotor", (b) => {
    for (let i = 0; i < 2; i += 1) b.box(0.02, 0.84, 0.09, C.charcoal, 0, -0.42, 0, { rx: (i * Math.PI) / 2, r: 0 });
  });
  tailRotor.position.set(0.17, 1.82, HELI_Z + TAIL_Z + 0.03);
  // At speed the blades smear into a disc.
  const blur = new THREE.Mesh(
    bakeModel("asset:helicopter:blur", (b) => b.cyl(2.2, 0.01, 0xffffff, 0, 0, 0, { seg: 28 })),
    glowMat(0xdde6ee, { opacity: 0.14 })
  );
  blur.position.copy(rotor.position);
  blur.visible = false;
  kit.add(blur);

  // Pad lights.
  const lights = new THREE.Mesh(
    bakeModel("asset:helicopter:lights", (b) => {
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        b.cyl(0.06, 0.05, 0xffffff, Math.cos(a) * (padR - 0.14), 0.04, Math.sin(a) * (padR - 0.14), { seg: 8 });
      }
    }),
    glowMat(C.good)
  );
  kit.add(lights);

  let speed = 0.35;
  kit.onUpdate((dt, elapsed) => {
    rotor.rotation.y += dt * speed * Math.PI * 2;
    tailRotor.rotation.x += dt * speed * Math.PI * 2 * 3.1;
    lights.visible = elapsed % 1.6 < 1.1;
  });
  return kit.finish(
    { w, d },
    {
      setRotorSpeed: (revolutionsPerSecond: number) => {
        speed = Math.max(0, revolutionsPerSecond);
        blur.visible = speed > 2.5;
      },
    }
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Private jet
// ─────────────────────────────────────────────────────────────────────────────

/** Private jet on its apron. Nose toward +Z; 7.6 long, 7.2 across the wings. */
export const createJet = (): PropHandle => {
  const { w, d } = ASSET_FOOTPRINTS.jet;
  const kit = new PropKit("asset:jet");
  const axis = 1.3;
  const tail = -3.75;

  kit.model("asset:jet", (b) => {
    // Apron with a taxi line and a stop bar.
    b.plate(roundedRect(w - 0.3, d - 0.3, 0.4), 0.04, C.asphalt, 0, 0, 0);
    b.box(0.1, 0.008, d - 1.4, C.yellow, 0, 0.04, 0, { r: 0 });
    b.box(1.4, 0.008, 0.1, C.yellow, 0, 0.04, d / 2 - 0.8, { r: 0 });
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 5; i += 1) b.box(0.1, 0.008, 0.7, C.paper, sx * (w / 2 - 0.5), 0.04, -d / 2 + 1.1 + i * 1.65, { r: 0 });
    }

    // Fuselage: a lathe from tail to nose, laid along +Z.
    b.lathe(
      [
        [0.06, 0],
        [0.26, 0.5],
        [0.46, 1.6],
        [0.56, 2.9],
        [0.56, 5.6],
        [0.48, 6.4],
        [0.3, 7.0],
        [0.1, 7.36],
        [0.001, 7.42],
      ],
      C.white,
      0,
      axis,
      tail,
      { rx: Math.PI / 2, seg: 16 }
    );
    // Cheatline, cockpit glass, cabin windows.
    for (const sx of [-1, 1]) {
      b.box(0.02, 0.07, 4.6, EMBER, sx * 0.555, axis - 0.16, 0.2, { r: 0 });
      for (let i = 0; i < 6; i += 1) b.box(0.02, 0.15, 0.2, 0x3c556e, sx * 0.556, axis + 0.06, -1.5 + i * 0.52, { r: 0.008 });
    }
    b.box(0.62, 0.2, 0.5, 0x3c556e, 0, axis + 0.2, 2.86, { rx: 0.5, r: 0.06 });

    // Swept wings with winglets.
    const wing: Point2[] = [
      [0, 0.9],
      [3.55, -0.75],
      [3.55, -1.35],
      [0.5, -0.85],
      [-0.5, -0.85],
      [-3.55, -1.35],
      [-3.55, -0.75],
    ];
    b.plate(wing, 0.1, C.white, 0, axis - 0.38, 0.1, { bevel: 0.03 });
    for (const sx of [-1, 1]) {
      b.prism(
        [
          [-0.3, 0],
          [0.3, 0],
          [-0.05, 0.55],
          [-0.35, 0.55],
        ],
        0.05,
        EMBER,
        sx * 3.53,
        axis - 0.3,
        -0.95,
        { ry: -Math.PI / 2 }
      );
    }
    // T-tail.
    b.prism(
      [
        [-0.5, 0],
        [0.85, 0],
        [0.1, 1.3],
        [-0.55, 1.3],
      ],
      0.1,
      C.white,
      0,
      axis + 0.3,
      tail + 0.75,
      { ry: -Math.PI / 2 }
    );
    b.box(0.11, 0.42, 0.5, NEON, 0, axis + 1.16, tail + 0.55, { r: 0.012 });
    const stabiliser: Point2[] = [
      [0, 0.4],
      [1.35, -0.25],
      [1.35, -0.6],
      [0, -0.3],
      [-1.35, -0.6],
      [-1.35, -0.25],
    ];
    b.plate(stabiliser, 0.07, C.white, 0, axis + 1.6, tail + 0.55, { bevel: 0.02 });
    // Rear engines on stub pylons.
    for (const sx of [-1, 1]) {
      b.box(0.42, 0.09, 0.5, C.white, sx * 0.62, axis + 0.22, tail + 1.75, { r: 0.02 });
      b.cyl(0.27, 1.25, C.white, sx * 0.92, axis + 0.0, tail + 1.75, { axis: "z", seg: 12 });
      b.cyl(0.22, 0.04, C.charcoal, sx * 0.92, axis + 0.05, tail + 2.38, { axis: "z", seg: 12 });
      b.cyl(0.2, 0.08, C.greyDark, sx * 0.92, axis + 0.07, tail + 1.1, { axis: "z", seg: 10 });
      b.torus(0.27, 0.025, EMBER, sx * 0.92, axis + 0.0 - 0.025, tail + 2.3, { axis: "z", seg: 12 });
    }
    // Landing gear.
    b.cyl(0.035, axis - 0.75, C.grey, 0, 0.2, 2.5, { seg: 6 });
    b.cyl(0.17, 0.12, C.black, 0, 0.04, 2.5, { axis: "x", seg: 10 });
    for (const sx of [-1, 1]) {
      b.cyl(0.045, axis - 0.72, C.grey, sx * 1.05, 0.24, -0.2, { seg: 6 });
      b.cyl(0.2, 0.14, C.black, sx * 1.05, 0.04, -0.2, { axis: "x", seg: 10 });
    }
    // Airstair down on the port side: "you have arrived".
    b.box(0.7, 0.05, 0.62, C.greyLight, -0.92, axis - 0.42, 1.55, { rz: 0.82, r: 0.012 });
    for (let i = 0; i < 4; i += 1) b.box(0.18, 0.03, 0.56, C.grey, -0.72 - i * 0.14, axis - 0.34 - i * 0.2, 1.55, { r: 0 });
    b.box(0.03, 0.62, 0.62, 0x3c556e, -0.56, axis - 0.36, 1.55, { r: 0 });
    // Red carpet.
    b.box(1.5, 0.008, 0.6, C.burgundy, -2.05, 0.04, 1.55, { r: 0 });
  });

  // Wingtip and tail beacons.
  const beacons = new THREE.Mesh(
    bakeModel("asset:jet:beacons", (b) => {
      b.ball(0.06, C.alarm, -3.55, axis - 0.36, -1.05, { seg: 6 });
      b.ball(0.06, C.good, 3.55, axis - 0.36, -1.05, { seg: 6 });
      b.ball(0.06, 0xffffff, 0, axis + 1.68, tail + 0.2, { seg: 6 });
    }),
    glowMat(0xffffff, { vertexColors: true })
  );
  kit.add(beacons);
  kit.onUpdate((_dt, elapsed) => {
    beacons.visible = elapsed % 1.3 < 0.9;
  });
  return kit.finish({ w, d });
};

// ─────────────────────────────────────────────────────────────────────────────
// Yacht
// ─────────────────────────────────────────────────────────────────────────────

/** Company yacht afloat on its patch of water. Bow toward +Z; the jetty is on the +X side. Bobs in update(). */
export const createYacht = (): PropHandle => {
  const { w, d } = ASSET_FOOTPRINTS.yacht;
  const kit = new PropKit("asset:yacht");

  const water = kit.model("asset:yacht:water", (b) => {
    b.plate(roundedRect(w - 0.1, d - 0.1, 0.5), 0.06, C.waterDeep, 0, -0.02, 0);
    b.plate(roundedRect(w - 0.4, d - 0.4, 0.4), 0.012, C.water, 0, 0.04, 0);
    // Jetty out from the +X shore (with the layouts' yacht facing, +X is the side nearest the office).
    for (const z of [-1.9, -1.3]) {
      b.cyl(0.07, 0.5, C.trunk, w / 2 - 0.3, -0.02, z, { seg: 8 });
      b.cyl(0.07, 0.5, C.trunk, 1.05, -0.02, z, { seg: 8 });
    }
    for (let i = 0; i < 6; i += 1) b.box(0.16, 0.04, 0.82, i % 2 ? C.oak : C.pallet, w / 2 - 0.16 - i * 0.172, 0.4, -1.6, { r: 0.006 });
    b.torus(0.12, 0.04, C.red, 1.1, 0.44, -1.86, { seg: 10 });
  });
  water.castShadow = false;

  const boat = new THREE.Group();
  kit.add(boat);
  kit.model(
    "asset:yacht:boat",
    (b) => {
      const hull: Point2[] = [
        [-0.7, -3.05],
        [0.7, -3.05],
        [0.86, -1.0],
        [0.8, 0.9],
        [0.5, 2.2],
        [0, 3.1],
        [-0.5, 2.2],
        [-0.8, 0.9],
        [-0.86, -1.0],
      ];
      const grow = (points: readonly Point2[], k: number): Point2[] => points.map(([x, z]) => [x * k, z * (1 + (k - 1) * 0.25)] as const);
      // Navy boot stripe at the waterline, white topsides, teak deck.
      b.plate(grow(hull, 0.9), 0.3, C.navy, 0, -0.12, 0, { bevel: 0.05 });
      b.plate(hull, 0.62, C.white, 0, 0.14, 0, { bevel: 0.06 });
      b.plate(grow(hull, 0.9), 0.02, C.oak, 0, 0.76, 0);
      b.box(1.6, 0.05, 0.02, EMBER, 0, 0.5, -3.06, { r: 0 });
      // Swim platform and tender garage.
      b.box(1.3, 0.06, 0.4, C.oak, 0, 0.16, -3.2, { r: 0.014 });
      // Main deck saloon with a wrap of dark glass.
      b.box(1.36, 0.52, 2.5, C.white, 0, 0.78, -0.55, { r: 0.1, round: 2 });
      b.box(1.39, 0.2, 2.1, 0x34485c, 0, 0.98, -0.55, { r: 0.04 });
      // Bridge deck, raked windscreen, hardtop.
      b.box(1.14, 0.44, 1.5, C.white, 0, 1.3, -0.4, { r: 0.1, round: 2 });
      b.box(1.17, 0.18, 1.2, 0x34485c, 0, 1.46, -0.38, { r: 0.04 });
      b.box(1.0, 0.3, 0.05, 0x34485c, 0, 1.36, 0.37, { rx: -0.5, r: 0 });
      b.box(1.24, 0.06, 1.7, C.white, 0, 1.92, -0.6, { r: 0.03 });
      for (const sx of [-1, 1]) {
        b.strut([sx * 0.5, 1.74, 0.1], [sx * 0.5, 1.92, 0.0], 0.05, C.white);
        b.strut([sx * 0.5, 1.74, -1.1], [sx * 0.5, 1.92, -1.2], 0.05, C.white);
      }
      // Radar arch, mast and pennant.
      for (const sx of [-1, 1]) b.strut([sx * 0.42, 1.98, -1.1], [sx * 0.3, 2.42, -1.25], 0.06, C.white);
      b.box(0.72, 0.06, 0.2, C.white, 0, 2.4, -1.25, { r: 0.02 });
      b.cyl(0.14, 0.08, C.greyLight, 0, 2.46, -1.25, { seg: 10 });
      b.cyl(0.02, 1.1, C.chrome, 0, 2.5, -1.3, { seg: 6 });
      b.prism(
        [
          [0, 0],
          [0.5, 0.11],
          [0, 0.22],
        ],
        0.012,
        EMBER,
        0,
        3.32,
        -1.3,
        { ry: Math.PI / 2 }
      );
      // Foredeck sun pads and rail.
      for (const sx of [-1, 1]) b.box(0.42, 0.07, 0.9, C.cream, sx * 0.24, 0.78, 1.3, { r: 0.03 });
      for (const sx of [-1, 1]) {
        b.tube([sx * 0.76, 1.0, 0.9], [sx * 0.46, 1.0, 2.2], 0.014, C.chrome, { seg: 5 });
        b.tube([sx * 0.46, 1.0, 2.2], [0, 1.0, 2.95], 0.014, C.chrome, { seg: 5 });
        for (const [px, pz] of [
          [0.76, 0.9],
          [0.6, 1.6],
          [0.46, 2.2],
        ]) {
          b.cyl(0.012, 0.24, C.chrome, sx * px, 0.78, pz, { seg: 5 });
        }
      }
      b.cyl(0.012, 0.24, C.chrome, 0, 0.78, 2.95, { seg: 5 });
      // Aft deck: hot tub and a pair of loungers.
      b.cyl(0.36, 0.2, C.white, 0, 0.78, -2.3, { seg: 14 });
      b.cyl(0.3, 0.02, 0x8fd8ee, 0, 0.97, -2.3, { seg: 14 });
      // Stern flag.
      b.cyl(0.014, 0.5, C.chrome, 0.6, 0.78, -2.95, { seg: 5, rx: -0.2 });
      b.box(0.3, 0.18, 0.012, C.red, 0.6, 1.1, -3.16, { ry: Math.PI / 2, r: 0 });
    },
    boat
  );

  // Ripples drifting out from the hull.
  const ripple = bakeModel("asset:yacht:ripple", (b) => b.torus(1, 0.02, 0xffffff, 0, 0, 0, { seg: 28 }));
  const ripples = [0, 1].map(() => {
    const ring = new THREE.Mesh(ripple, glowMat(C.foam, { opacity: 0.5 }));
    ring.position.y = 0.06;
    kit.add(ring);
    return ring;
  });

  kit.onUpdate((_dt, elapsed) => {
    boat.position.y = Math.sin(elapsed * 1.1) * 0.035;
    boat.rotation.z = Math.sin(elapsed * 0.8) * 0.022;
    boat.rotation.x = Math.sin(elapsed * 0.6 + 1) * 0.01;
    ripples.forEach((ring, i) => {
      const life = (elapsed * 0.22 + i * 0.5) % 1;
      ring.scale.set(0.9 + life * 0.75, 1 - life, 2.9 + life * 0.8);
      ring.visible = life < 0.92;
    });
  });
  return kit.finish({ w, d });
};

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

const ASSET_FACTORIES: Record<AssetId, () => PropHandle> = {
  "office-upgrade": createOfficeUpgradeKit,
  lounge: createLounge,
  helicopter: createHelicopter,
  jet: createJet,
  yacht: createYacht,
};

/** Build the prop for a purchasable asset. (Call createHelicopter directly when you want setRotorSpeed.) */
export const createAsset = (assetId: AssetId): PropHandle => ASSET_FACTORIES[assetId]();

// ─────────────────────────────────────────────────────────────────────────────
// Blueprint ghosts
// ─────────────────────────────────────────────────────────────────────────────

export interface BlueprintHandle extends PropHandle {
  /** Change (or with null hide) the floating price tag. */
  setPriceLabel(label: string | null): void;
}

const drawPriceTag =
  (label: string): CanvasDraw =>
  (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const radius = h * 0.3;
    ctx.fillStyle = cssColor(INK);
    ctx.strokeStyle = cssColor(NEON);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, radius);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = cssColor(NEON);
    ctx.font = `600 ${Math.round(h * 0.5)}px ${LABEL_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, w / 2, h / 2 + 2, w - 24);
  };

const TAG_HEIGHT = 0.55;
const TAG_TEXTURE_HEIGHT = 72;
const tagTextureWidth = (label: string): number => Math.round(TAG_TEXTURE_HEIGHT * Math.max(2.2, label.length * 0.34 + 0.9));

/**
 * Turn a prop into its "available to buy" ghost: translucent neon cyan, gently
 * pulsing, with a dashed plot outline on the ground and a floating price tag.
 *
 * The prop is converted in place (its meshes are re-skinned) and owned by the
 * returned handle from then on: dispose the blueprint, then build a fresh prop
 * when the asset is bought. The prop's own update() keeps running, so ghost
 * rotors still turn.
 */
export const makeBlueprint = (source: PropHandle, priceLabel?: string): BlueprintHandle => {
  const kit = new PropKit("blueprint");
  kit.add(source.group);

  const fill = kit.own(new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false }));
  // Triangle wireframe over the fill: the drafting-table look that says "plan, not object".
  const wire = kit.own(new THREE.MeshBasicMaterial({ color: lighten(NEON, 0.35), wireframe: true, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false }));
  // Depth-only pre-pass: without it every overlapping part would stack up its own
  // layer of cyan. Drawn after the opaque scene so the ghost never hides what is behind it.
  const depthOnly = kit.own(new THREE.MeshBasicMaterial({ colorWrite: false }));

  const meshes: THREE.Mesh[] = [];
  source.group.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  for (const mesh of meshes) {
    mesh.material = fill;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;
    const prepass = new THREE.Mesh(mesh.geometry, depthOnly);
    prepass.renderOrder = 1;
    const lines = new THREE.Mesh(mesh.geometry, wire);
    lines.renderOrder = 3;
    mesh.add(prepass, lines);
  }

  // Plot outline: dashes round the footprint.
  const { w, d } = source.footprint;
  const outline = shapeMesh(
    bakeModel(null, (b) => {
      const dash = 0.3;
      const side = (length: number, place: (t: number) => void): void => {
        const count = Math.max(2, Math.round(length / (dash * 2)));
        for (let i = 0; i < count; i += 1) place(-length / 2 + (length / count) * (i + 0.5));
      };
      side(w, (t) => {
        b.box(dash, 0.015, 0.04, 0xffffff, t, 0.01, d / 2, { r: 0 });
        b.box(dash, 0.015, 0.04, 0xffffff, t, 0.01, -d / 2, { r: 0 });
      });
      side(d, (t) => {
        b.box(0.04, 0.015, dash, 0xffffff, w / 2, 0.01, t, { r: 0 });
        b.box(0.04, 0.015, dash, 0xffffff, -w / 2, 0.01, t, { r: 0 });
      });
    }),
    glowMat(NEON, { opacity: 0.7 }),
    false
  );
  kit.own(outline.geometry);
  kit.add(outline);

  // Price tag above the highest point.
  const top = new THREE.Box3().setFromObject(source.group).max.y;
  const tagY = (Number.isFinite(top) ? top : 1.5) + 0.6;
  let tag: THREE.Sprite | null = null;
  let tagTexture: ReturnType<typeof createDynamicTexture> = null;
  const setPriceLabel = (label: string | null): void => {
    if (tag) tag.visible = label !== null;
    if (label === null) return;
    const width = tagTextureWidth(label);
    if (!tag) {
      tagTexture = createDynamicTexture(width, TAG_TEXTURE_HEIGHT, drawPriceTag(label));
      if (!tagTexture) return;
      kit.own(tagTexture);
      const material = kit.own(new THREE.SpriteMaterial({ map: tagTexture.texture, depthTest: false, toneMapped: false }));
      tag = new THREE.Sprite(material);
      tag.renderOrder = 4;
      tag.position.set(0, tagY, 0);
      tag.scale.set((TAG_HEIGHT * width) / TAG_TEXTURE_HEIGHT, TAG_HEIGHT, 1);
      kit.add(tag);
      return;
    }
    tagTexture?.redraw(drawPriceTag(label));
  };
  if (priceLabel) setPriceLabel(priceLabel);

  kit.onUpdate((dt, elapsed) => {
    source.update?.(dt, elapsed);
    const pulse = Math.sin(elapsed * 2.4);
    fill.opacity = 0.34 + pulse * 0.09;
    wire.opacity = 0.3 + pulse * 0.12;
    if (tag) tag.position.y = tagY + Math.sin(elapsed * 1.7) * 0.06;
  });

  const handle = kit.finish(source.footprint, { setPriceLabel });
  const disposeKit = handle.dispose;
  handle.dispose = () => {
    disposeKit();
    source.dispose();
  };
  return handle;
};
