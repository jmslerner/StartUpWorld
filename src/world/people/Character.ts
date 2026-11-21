/**
 * The little people: chunky peg characters built from eight baked meshes
 * (torso, head, two arms, two thighs, two shins) on a tiny rig, with
 * procedural poses.
 *
 * Conventions
 *  • `group` origin is on the floor between the feet; the character faces +Z.
 *  • Standing height ≈ 1.5 units (± 8 % by look).
 *  • Seated poses put the hips on a chair seat at y = SEAT_Y (0.45) with the
 *    group origin on the floor at the seat position; "floor-sit" puts them on a
 *    beanbag at FLOOR_SEAT_Y (0.24).
 *  • Everything is shared geometry + the shared vertex-colour material, so a
 *    character owns no GPU resources and `update` never allocates.
 *  • Eight meshes per person; the pose props (lap laptop, phone, the box of
 *    desk things somebody carries out on their last day) are only made the
 *    first time they are needed.
 */
import * as THREE from "three";
import type { TeamRole } from "../../types/game";
import type { PersonView } from "../types";
import {
  bakeModel,
  C,
  COFOUNDER_OUTFIT,
  darken,
  EXEC_TIE,
  FOUNDER_OUTFIT,
  HAIR_COLORS,
  lighten,
  mixColor,
  modelMesh,
  PANTS_COLORS,
  ROLE_COLORS,
  SCALE,
  SHOE_COLORS,
  SKIN_TONES,
  vertexMat,
} from "../core/palette";
import type { ModelBuilder } from "../core/palette";

export type CharacterPose = "stand" | "walk" | "sit" | "type" | "cheer" | "slump" | "sleep" | "phone" | "floor-sit";
export const CHARACTER_POSES: readonly CharacterPose[] = ["stand", "walk", "sit", "type", "cheer", "slump", "sleep", "phone", "floor-sit"];

/** Chair seat height the seated poses assume (matches the chair props). */
export const SEAT_Y = SCALE.seat;
/** Beanbag seat height the "floor-sit" pose assumes (matches the overflow-spot prop). */
export const FLOOR_SEAT_Y = SCALE.floorSeat;
/** Nominal standing height, before the ± 8 % look variation. */
export const CHARACTER_HEIGHT = SCALE.person;

export interface PoseOptions {
  /**
   * Lower-body posture for the poses that work both ways (cheer, slump, sleep,
   * phone). Defaults: cheer + phone stand, slump + sleep sit.
   */
  seated?: boolean;
  /**
   * "slump" and "sleep" only: sitting on the floor (a beanbag) rather than on a chair.
   * Ignored by every other pose.
   */
  floor?: boolean;
  /** Snap instead of blending (use when building a scene instantly). */
  immediate?: boolean;
}

export interface CharacterHandle {
  readonly group: THREE.Group;
  /** Sits just above the top of the head and follows it — anchor bubbles and inspector cards here. */
  readonly headAnchor: THREE.Object3D;
  /** The resolved look (handy for UI swatches and tests). */
  readonly look: CharacterLook;
  /** Standing height of this particular character in world units. */
  readonly height: number;
  setPose(pose: CharacterPose, options?: PoseOptions): void;
  getPose(): CharacterPose;
  /** Ground speed in units / second; drives the walk cycle's cadence and stride. */
  setWalkSpeed(unitsPerSecond: number): void;
  /** 0 = drained (slow, slouched) … 1 = buzzing. Default 0.75. */
  setEnergy(energy: number): void;
  /**
   * Hold a cardboard box of desk things in both arms. Only shows in the upright
   * poses ("stand" and "walk"): it is what somebody leaving the company carries out.
   */
  setCarrying(carrying: boolean): void;
  /** Greyed-out look for "setup incomplete" / game over. */
  setDimmed(dimmed: boolean): void;
  /** Multiply the whole character by a colour (null restores it). Use a handful of distinct tints at most — each is a cached material. */
  setTint(tint: number | null): void;
  update(dt: number, elapsed: number): void;
  /** Detaches the group. Characters own no GPU resources. */
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Look
// ─────────────────────────────────────────────────────────────────────────────

export type HairStyle = "bald" | "crop" | "quiff" | "bob" | "long" | "bun" | "ponytail" | "afro" | "cap" | "beanie";
export const HAIR_STYLES: readonly HairStyle[] = ["bald", "crop", "quiff", "bob", "long", "bun", "ponytail", "afro", "cap", "beanie"];
export type Accessory = "none" | "glasses" | "headphones";
export type OutfitKind = "hoodie" | "suit" | "shirt";

export interface CharacterLook {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  /** Colour of a cap / beanie / headphone cups. */
  gear: number;
  accessory: Accessory;
  outfit: OutfitKind;
  /** Role flavour drawn on the torso (null for founders). */
  role: TeamRole | null;
  top: number;
  trim: number;
  pants: number;
  shoes: number;
  shortSleeves: boolean;
  /** Height factor, 0.92 … 1.08. */
  scale: number;
  /** Animation phase offset so a room of people does not move in sync. */
  phase: number;
}

/** Small deterministic PRNG (mulberry32) so a `look` seed always yields the same person. */
const seededRandom = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = <T>(items: readonly T[], roll: number): T => items[Math.min(items.length - 1, Math.floor(roll * items.length))];

/** How likely each role is to wear what — a little flavour, never a uniform. */
const ACCESSORY_ODDS: Record<TeamRole, { glasses: number; headphones: number }> = {
  engineering: { glasses: 0.3, headphones: 0.4 },
  design: { glasses: 0.2, headphones: 0.3 },
  product: { glasses: 0.3, headphones: 0.05 },
  data: { glasses: 0.55, headphones: 0.15 },
  marketing: { glasses: 0.15, headphones: 0.05 },
  sales: { glasses: 0.1, headphones: 0.3 },
  ops: { glasses: 0.2, headphones: 0.05 },
  hr: { glasses: 0.25, headphones: 0 },
  legal: { glasses: 0.5, headphones: 0 },
  executive: { glasses: 0.35, headphones: 0 },
};

const GEAR_COLORS: readonly number[] = [C.red, C.navy, C.teal, C.yellow, C.charcoal, C.purple, C.orange];

export const deriveLook = (view: PersonView): CharacterLook => {
  const random = seededRandom(view.look);
  const skin = pick(SKIN_TONES, random());
  // Dyed hair is rare: the last two palette entries share one slot's worth of odds.
  const hairRoll = random();
  const naturalCount = HAIR_COLORS.length - 2;
  const hair = hairRoll < 0.92 ? HAIR_COLORS[Math.floor((hairRoll / 0.92) * naturalCount)] : HAIR_COLORS[naturalCount + (hairRoll < 0.96 ? 0 : 1)];
  const hairStyle = pick(HAIR_STYLES, random());
  const gear = pick(GEAR_COLORS, random());
  const accessoryRoll = random();
  const scale = 0.92 + random() * 0.16;
  const shade = random();
  const pants = pick(PANTS_COLORS, random());
  const shoes = pick(SHOE_COLORS, random());
  const shortSleeves = random() < 0.35;
  const phase = random() * Math.PI * 2;

  if (view.kind === "founder" || view.kind === "cofounder") {
    const outfit = view.kind === "founder" ? FOUNDER_OUTFIT : COFOUNDER_OUTFIT;
    return {
      skin,
      hair,
      hairStyle,
      gear: outfit.trim,
      accessory: accessoryRoll < 0.25 ? "glasses" : "none",
      outfit: "hoodie",
      role: null,
      top: outfit.top,
      trim: outfit.trim,
      pants: outfit.pants,
      shoes: outfit.shoes,
      shortSleeves: false,
      scale,
      phase,
    };
  }

  const role = view.role ?? "engineering";
  const odds = ACCESSORY_ODDS[role];
  const accessory: Accessory = accessoryRoll < odds.glasses ? "glasses" : accessoryRoll < odds.glasses + odds.headphones ? "headphones" : "none";
  if (role === "executive") {
    return {
      skin,
      hair,
      // Executives keep it tidy.
      hairStyle: hairStyle === "cap" || hairStyle === "beanie" || hairStyle === "afro" ? "crop" : hairStyle,
      gear,
      accessory,
      outfit: "suit",
      role,
      top: ROLE_COLORS.executive,
      trim: EXEC_TIE,
      pants: ROLE_COLORS.executive,
      shoes: 0x20242a,
      shortSleeves: false,
      scale,
      phase,
    };
  }
  // A whisker of shade variety keeps a row of same-role people from looking stamped.
  const base = ROLE_COLORS[role];
  const top = shade < 0.5 ? mixColor(base, 0xffffff, (0.5 - shade) * 0.24) : mixColor(base, 0x000000, (shade - 0.5) * 0.2);
  return { skin, hair, hairStyle, gear, accessory, outfit: "shirt", role, top, trim: darken(top, 0.22), pants, shoes, shortSleeves, scale, phase };
};

// ─────────────────────────────────────────────────────────────────────────────
// Body parts (baked, cached by look)
// ─────────────────────────────────────────────────────────────────────────────

// Rig dimensions at scale 1. The hips are the root of the upper body.
const LEG_LEN = 0.48;
/** Hip → knee. The shin (with the shoe) makes up the rest of LEG_LEN. */
const THIGH_LEN = 0.24;
const LEG_W = 0.155;
const LEG_D = 0.17;
const LEG_X = 0.105;
const TORSO_W = 0.44;
const TORSO_D = 0.3;
const NECK_Y = 0.58;
const SHOULDER_Y = 0.5;
const SHOULDER_X = TORSO_W / 2 + 0.058;
const ARM_LEN = 0.4;
const HEAD_W = 0.4;
const HEAD_H = 0.4;
const HEAD_D = 0.38;
const EYE = 0x2b2420;

const hex = (color: number): string => color.toString(16);

const drawTorso = (b: ModelBuilder, look: CharacterLook): void => {
  const { top, trim } = look;
  const front = TORSO_D / 2;
  b.box(TORSO_W, NECK_Y + 0.04, TORSO_D, top, 0, -0.04, 0, { r: 0.085, round: 2, taper: 0.9 });
  if (look.outfit === "hoodie") {
    // Trim hem, kangaroo pocket, drawstrings and a hood bunched at the nape.
    b.box(TORSO_W + 0.014, 0.065, TORSO_D + 0.014, trim, 0, -0.035, 0, { r: 0.03 });
    b.box(0.26, 0.13, 0.03, darken(top, 0.1), 0, 0.08, front - 0.012, { r: 0.012 });
    for (const sx of [-1, 1]) b.box(0.016, 0.13, 0.016, trim, sx * 0.05, 0.36, front - 0.012, { r: 0 });
    b.box(0.34, 0.17, 0.14, top, 0, 0.44, -front + 0.0, { r: 0.06 });
    b.box(0.3, 0.03, 0.1, trim, 0, 0.585, -front + 0.01, { r: 0.012 });
    return;
  }
  if (look.outfit === "suit") {
    // White shirt wedge, tie, lapels, pocket square.
    b.box(0.13, 0.22, 0.02, C.white, 0, 0.34, front - 0.014, { r: 0 });
    b.box(0.05, 0.2, 0.02, trim, 0, 0.3, front - 0.008, { r: 0 });
    b.box(0.065, 0.045, 0.024, trim, 0, 0.49, front - 0.01, { r: 0 });
    for (const sx of [-1, 1]) {
      b.box(0.045, 0.26, 0.02, lighten(top, 0.14), sx * 0.085, 0.3, front - 0.012, { rz: sx * 0.2, r: 0 });
    }
    b.box(0.05, 0.02, 0.016, trim, 0.13, 0.36, front - 0.012, { r: 0 });
    return;
  }
  // Shirt: collar + darker hem + a small role tell.
  b.box(TORSO_W + 0.01, 0.05, TORSO_D + 0.01, trim, 0, -0.03, 0, { r: 0.025 });
  b.box(0.2, 0.05, 0.03, lighten(top, 0.4), 0, 0.535, front - 0.03, { r: 0.012 });
  switch (look.role) {
    case "engineering":
      // Hoodie pocket.
      b.box(0.25, 0.12, 0.028, trim, 0, 0.09, front - 0.012, { r: 0.012 });
      break;
    case "design":
      // Neck scarf.
      b.box(0.3, 0.07, TORSO_D * 0.86, lighten(top, 0.55), 0, 0.5, 0, { r: 0.03 });
      b.box(0.07, 0.14, 0.03, lighten(top, 0.55), 0.06, 0.38, front - 0.02, { rz: -0.2, r: 0.01 });
      break;
    case "product":
    case "hr":
      // Lanyard + badge.
      for (const sx of [-1, 1]) b.box(0.014, 0.2, 0.014, C.charcoal, sx * 0.045, 0.32, front - 0.012, { rz: sx * 0.22, r: 0 });
      b.box(0.075, 0.09, 0.016, C.paper, 0, 0.22, front - 0.008, { r: 0 });
      break;
    case "data":
      // Pocket protector with pens.
      b.box(0.1, 0.09, 0.02, C.paper, 0.1, 0.32, front - 0.014, { r: 0 });
      b.box(0.016, 0.05, 0.02, C.red, 0.08, 0.39, front - 0.012, { r: 0 });
      b.box(0.016, 0.05, 0.02, C.navy, 0.115, 0.39, front - 0.012, { r: 0 });
      break;
    case "marketing":
    case "sales":
      // Open blazer look: light tee panel down the middle.
      b.box(0.12, 0.44, 0.02, lighten(top, 0.6), 0, 0.06, front - 0.012, { r: 0 });
      break;
    case "ops":
      // Utility belt.
      b.box(TORSO_W + 0.016, 0.055, TORSO_D + 0.016, C.charcoal, 0, 0.07, 0, { r: 0.02 });
      b.box(0.06, 0.05, 0.02, C.brass, 0, 0.072, front + 0.004, { r: 0 });
      break;
    case "legal":
      // Sober tie.
      b.box(0.045, 0.24, 0.02, C.navy, 0, 0.27, front - 0.01, { r: 0 });
      break;
    default:
      break;
  }
};

const drawHair = (b: ModelBuilder, look: CharacterLook): void => {
  const h = look.hair;
  const back = -HEAD_D / 2;
  const crop = (): void => {
    b.box(HEAD_W + 0.03, 0.15, HEAD_D + 0.03, h, 0, HEAD_H - 0.11, -0.006, { r: 0.075, round: 2 });
    b.box(HEAD_W + 0.03, 0.24, 0.12, h, 0, 0.12, back + 0.035, { r: 0.055 });
  };
  switch (look.hairStyle) {
    case "bald":
      return;
    case "crop":
      crop();
      return;
    case "quiff":
      crop();
      b.box(0.27, 0.11, 0.17, h, 0, HEAD_H - 0.015, 0.09, { rx: -0.3, r: 0.05 });
      return;
    case "bob":
      crop();
      for (const sx of [-1, 1]) b.box(0.075, 0.3, HEAD_D * 0.82, h, sx * (HEAD_W / 2 + 0.008), 0.04, -0.03, { r: 0.032 });
      b.box(HEAD_W + 0.03, 0.32, 0.1, h, 0, 0.02, back + 0.02, { r: 0.045 });
      return;
    case "long":
      crop();
      for (const sx of [-1, 1]) b.box(0.075, 0.44, HEAD_D * 0.7, h, sx * (HEAD_W / 2 + 0.008), -0.1, -0.05, { r: 0.032 });
      b.box(HEAD_W + 0.03, 0.52, 0.12, h, 0, -0.17, back + 0.015, { r: 0.05 });
      return;
    case "bun":
      crop();
      b.ball(0.09, h, 0, HEAD_H - 0.01, -0.09);
      return;
    case "ponytail":
      crop();
      b.box(0.1, 0.09, 0.09, look.gear, 0, 0.25, back - 0.045, { r: 0.03 });
      b.strut([0, 0.3, back - 0.07], [0, 0.0, back - 0.13], 0.09, h, { r: 0.04 });
      return;
    case "afro":
      b.ball(0.235, h, 0, 0.095, -0.05, { seg: 14 });
      return;
    case "cap":
      b.box(HEAD_W + 0.02, 0.13, 0.09, h, 0, 0.13, back + 0.025, { r: 0.04 });
      b.box(HEAD_W + 0.035, 0.16, HEAD_D + 0.035, look.gear, 0, HEAD_H - 0.11, 0, { r: 0.078, round: 2 });
      b.box(0.3, 0.03, 0.18, darken(look.gear, 0.18), 0, HEAD_H - 0.095, HEAD_D / 2 + 0.07, { r: 0.012 });
      b.ball(0.022, darken(look.gear, 0.18), 0, HEAD_H + 0.04, 0, { seg: 6 });
      return;
    case "beanie":
      b.box(HEAD_W + 0.035, 0.21, HEAD_D + 0.035, look.gear, 0, HEAD_H - 0.14, 0, { r: 0.1, round: 2 });
      b.box(HEAD_W + 0.055, 0.075, HEAD_D + 0.055, darken(look.gear, 0.18), 0, HEAD_H - 0.14, 0, { r: 0.03 });
      b.ball(0.05, lighten(look.gear, 0.35), 0, HEAD_H + 0.055, 0, { seg: 8 });
      return;
  }
};

const drawHead = (b: ModelBuilder, look: CharacterLook): void => {
  const front = HEAD_D / 2;
  b.cyl(0.085, 0.08, look.skin, 0, -0.05, 0, { seg: 10 });
  b.box(HEAD_W, HEAD_H, HEAD_D, look.skin, 0, 0, 0, { r: 0.12, round: 3 });
  if (look.accessory === "glasses") {
    for (const sx of [-1, 1]) {
      b.box(0.125, 0.095, 0.02, C.black, sx * 0.085, 0.145, front - 0.004, { r: 0 });
      b.box(0.092, 0.062, 0.02, 0xe4f4fa, sx * 0.085, 0.1615, front - 0.001, { r: 0 });
      b.box(0.03, 0.036, 0.02, EYE, sx * 0.08, 0.172, front + 0.002, { r: 0 });
      b.box(0.014, 0.02, HEAD_D * 0.55, C.black, sx * (HEAD_W / 2 + 0.002), 0.19, 0.04, { r: 0 });
    }
    b.box(0.06, 0.02, 0.018, C.black, 0, 0.19, front - 0.003, { r: 0 });
  } else {
    for (const sx of [-1, 1]) b.cyl(0.03, 0.02, EYE, sx * 0.082, 0.155, front - 0.006, { axis: "z", seg: 10 });
  }
  drawHair(b, look);
  if (look.accessory === "headphones") {
    const radius = HEAD_W / 2 + 0.05;
    b.torus(radius, 0.024, C.charcoal, 0, 0.2 - radius - 0.024, 0, { axis: "z", arc: Math.PI, seg: 10 });
    for (const sx of [-1, 1]) {
      b.cyl(0.085, 0.07, C.charcoal, sx * (HEAD_W / 2 + 0.025), 0.2 - 0.085, 0, { axis: "x", seg: 10 });
      b.cyl(0.055, 0.02, look.gear, sx * (HEAD_W / 2 + 0.065), 0.2 - 0.055, 0, { axis: "x", seg: 10 });
    }
  }
};

/** Arm hanging from the shoulder pivot (origin) down −Y. */
const drawArm = (b: ModelBuilder, look: CharacterLook): void => {
  const sleeve = look.shortSleeves ? 0.2 : 0.35;
  b.box(0.105, ARM_LEN - sleeve + 0.03, 0.115, look.skin, 0, -ARM_LEN, 0, { r: 0.045 });
  b.box(0.125, sleeve, 0.135, look.top, 0, 0.05 - sleeve, 0, { r: 0.058, round: 2 });
  if (look.outfit === "hoodie") b.box(0.132, 0.045, 0.142, look.trim, 0, 0.05 - sleeve, 0, { r: 0.02 });
  if (look.outfit === "suit") b.box(0.128, 0.03, 0.138, C.white, 0, 0.04 - sleeve, 0, { r: 0.012 });
};

/** Thigh hanging from the hip pivot (origin) down −Y to the knee. */
const drawThigh = (b: ModelBuilder, look: CharacterLook): void => {
  b.box(LEG_W, THIGH_LEN + 0.07, LEG_D, look.pants, 0, -THIGH_LEN - 0.03, 0, { r: 0.055 });
};

/** Shin hanging from the knee pivot (origin) down −Y, shoe pointing +Z. */
const drawShin = (b: ModelBuilder, look: CharacterLook): void => {
  const length = LEG_LEN - THIGH_LEN;
  b.box(LEG_W - 0.006, length + 0.01, LEG_D - 0.006, look.pants, 0, -length + 0.05, 0, { r: 0.05 });
  b.box(LEG_W + 0.012, 0.09, LEG_D + 0.075, look.shoes, 0, -length, 0.032, { r: 0.04 });
  if (look.outfit === "hoodie") b.box(LEG_W + 0.016, 0.022, LEG_D + 0.079, look.trim, 0, -length + 0.012, 0.032, { r: 0 });
};

const drawLapLaptop = (b: ModelBuilder): void => {
  b.box(0.34, 0.018, 0.23, C.chrome, 0, 0, 0, { r: 0.007 });
  b.box(0.28, 0.004, 0.1, C.charcoal, 0, 0.018, -0.02, { r: 0 });
  b.place(0, 0.016, 0.115, { rx: 0.35 }, () => {
    b.box(0.34, 0.22, 0.014, C.chrome, 0, 0, 0, { r: 0.006 });
    b.box(0.3, 0.18, 0.004, 0x9fdcf5, 0, 0.02, -0.008, { r: 0 });
  });
};

const drawPhone = (b: ModelBuilder): void => {
  b.box(0.022, 0.14, 0.075, C.black, 0, 0, 0, { r: 0.008 });
};

/** A box of desk things: taped cardboard with a plant and some papers poking out. */
const drawCarryBox = (b: ModelBuilder): void => {
  b.box(0.33, 0.2, 0.25, C.cardboard, 0, 0, 0, { r: 0.012 });
  b.box(0.34, 0.035, 0.26, C.cardboardDark, 0, 0.17, 0, { r: 0.006 });
  b.box(0.07, 0.204, 0.254, C.tape, 0, 0, 0, { r: 0 });
  b.box(0.12, 0.11, 0.018, C.paper, -0.07, 0.15, -0.04, { rz: 0.12, r: 0 });
  b.cyl(0.04, 0.07, C.terracotta, 0.09, 0.17, 0.03, { seg: 8 });
  b.ball(0.07, C.leaf, 0.09, 0.22, 0.03, { seg: 7 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Pose channels
// ─────────────────────────────────────────────────────────────────────────────

const HIP_Y = 0;
const HIP_Z = 1;
const CHEST_PITCH = 2;
const HEAD_PITCH = 3;
const HEAD_YAW = 4;
const HEAD_ROLL = 5;
const ARM_L_PITCH = 6;
const ARM_L_ROLL = 7;
const ARM_R_PITCH = 8;
const ARM_R_ROLL = 9;
const LEG_L_PITCH = 10;
const LEG_R_PITCH = 11;
const LEG_SPLAY = 12;
const BOUNCE = 13;
const KNEE_L = 14;
const KNEE_R = 15;
const CHANNEL_COUNT = 16;

/** Seconds to blend from one pose to the next. */
const BLEND_SECONDS = 0.2;
/** Radians of walk cycle per unit travelled: one full stride (two steps) ≈ 0.95 units. */
const STRIDE_RATE = (Math.PI * 2) / 0.95;
const SEATED_BY_DEFAULT: Record<CharacterPose, boolean> = {
  stand: false,
  walk: false,
  sit: true,
  type: true,
  cheer: false,
  slump: true,
  sleep: true,
  phone: false,
  "floor-sit": false,
};
const DIM_TINT = 0x6d7480;
/** Seated: thighs level along the seat, shins hanging from the knee. */
const THIGHS_FORWARD = -Math.PI / 2 + 0.04;
const SHINS_DOWN = Math.PI / 2 - 0.12;

export const createCharacter = (view: PersonView): CharacterHandle => {
  const look = deriveLook(view);
  const material = vertexMat();

  const group = new THREE.Group();
  group.name = `character:${view.id}`;
  const rig = new THREE.Group();
  rig.scale.setScalar(look.scale);
  group.add(rig);
  const hips = new THREE.Group();
  rig.add(hips);
  const chest = new THREE.Group();
  hips.add(chest);

  const outfitKey = `${look.outfit}:${look.role ?? "none"}:${hex(look.top)}:${hex(look.trim)}`;
  const meshes: THREE.Mesh[] = [];
  const part = (key: string, draw: (b: ModelBuilder) => void, parent: THREE.Object3D): THREE.Mesh => {
    const mesh = modelMesh(bakeModel(`character:${key}`, draw), material);
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  part(`torso:${outfitKey}`, (b) => drawTorso(b, look), chest);

  const head = new THREE.Group();
  head.position.set(0, NECK_Y, 0);
  chest.add(head);
  part(`head:${hex(look.skin)}:${look.hairStyle}:${hex(look.hair)}:${look.accessory}:${hex(look.gear)}`, (b) => drawHead(b, look), head);
  const headAnchor = new THREE.Object3D();
  headAnchor.name = "head-anchor";
  headAnchor.position.set(0, HEAD_H + 0.16, 0);
  head.add(headAnchor);

  const armKey = `arm:${look.outfit}:${hex(look.top)}:${hex(look.trim)}:${hex(look.skin)}:${look.shortSleeves ? "s" : "l"}`;
  const shinKey = `shin:${hex(look.pants)}:${hex(look.shoes)}:${look.outfit === "hoodie" ? hex(look.trim) : "plain"}`;
  const makeLimb = (x: number, y: number, key: string, draw: (b: ModelBuilder) => void, parent: THREE.Object3D, castShadow = true): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    parent.add(pivot);
    part(key, draw, pivot).castShadow = castShadow;
    return pivot;
  };
  // "L" is the character's own left, which is +X when it faces +Z.
  // Arms do not cast shadows: theirs fall inside the torso's anyway, and with 64 people on
  // screen that is 128 fewer draws in the shadow pass.
  const armL = makeLimb(SHOULDER_X, SHOULDER_Y, armKey, (b) => drawArm(b, look), chest, false);
  const armR = makeLimb(-SHOULDER_X, SHOULDER_Y, armKey, (b) => drawArm(b, look), chest, false);
  const legL = makeLimb(LEG_X, 0, `thigh:${hex(look.pants)}`, (b) => drawThigh(b, look), hips);
  const legR = makeLimb(-LEG_X, 0, `thigh:${hex(look.pants)}`, (b) => drawThigh(b, look), hips);
  const legMeshes = [legL.children[0], legR.children[0]];
  // Pitch first, then splay about the vertical, so splayed legs stay level.
  legL.rotation.order = "YXZ";
  legR.rotation.order = "YXZ";
  const kneeL = makeLimb(0, -THIGH_LEN, shinKey, (b) => drawShin(b, look), legL);
  const kneeR = makeLimb(0, -THIGH_LEN, shinKey, (b) => drawShin(b, look), legR);
  legMeshes.push(kneeL.children[0], kneeR.children[0]);
  /**
   * Legs cast shadows only while the person is up: seated legs are under a desk (or
   * folded on a beanbag), inside the shadow of the furniture and the body, and with
   * a full office that is four shadow-pass draws per person nobody would miss.
   */
  const setLegShadows = (cast: boolean): void => {
    for (const mesh of legMeshes) mesh.castShadow = cast;
  };

  // Pose props are created on first use: most characters never sit on a beanbag or take a call.
  let laptop: THREE.Mesh | null = null;
  let phone: THREE.Mesh | null = null;
  const showLaptop = (visible: boolean): void => {
    if (!laptop && visible) {
      laptop = part("lap-laptop", drawLapLaptop, hips);
      laptop.castShadow = false;
      laptop.position.set(0, LEG_D / 2, 0.27);
    }
    if (laptop) laptop.visible = visible;
  };
  const showPhone = (visible: boolean): void => {
    if (!phone && visible) {
      phone = part("phone", drawPhone, armL);
      phone.castShadow = false;
      phone.position.set(-0.075, -ARM_LEN - 0.02, 0.0);
    }
    if (phone) phone.visible = visible;
  };
  let carryBox: THREE.Mesh | null = null;
  const showCarryBox = (visible: boolean): void => {
    if (!carryBox && visible) {
      carryBox = part("carry-box", drawCarryBox, chest);
      carryBox.castShadow = false;
      // Resting in the hands of two arms held forward (see the carry override in computeTarget).
      carryBox.position.set(0, 0.16, TORSO_D / 2 + 0.17);
    }
    if (carryBox) carryBox.visible = visible;
  };

  const standHip = LEG_LEN;
  // Seat heights are world units, the rig is scaled: divide so every height of person lands on the seat.
  const seatHip = SEAT_Y / look.scale + LEG_D / 2;
  const floorHip = FLOOR_SEAT_Y / look.scale + LEG_D / 2;

  const from = new Float32Array(CHANNEL_COUNT);
  const target = new Float32Array(CHANNEL_COUNT);
  const current = new Float32Array(CHANNEL_COUNT);
  let pose: CharacterPose = "stand";
  let seated = false;
  let floor = false;
  let blend = 1;
  let clock = look.phase;
  let stride = look.phase;
  let walkSpeed = 0;
  let energy = 0.75;
  let carrying = false;
  /** The box is in the arms only while upright; a seated pose puts it out of sight. */
  const refreshCarryBox = (): void => showCarryBox(carrying && (pose === "stand" || pose === "walk"));

  /** Hips on a beanbag, legs out in front and a little apart. */
  const floorLegs = (): void => {
    target[HIP_Y] = floorHip;
    target[LEG_L_PITCH] = THIGHS_FORWARD;
    target[LEG_R_PITCH] = THIGHS_FORWARD;
    target[KNEE_L] = 0;
    target[KNEE_R] = 0;
    target[LEG_SPLAY] = 0.5;
  };

  /** Fill `target` for the active pose at animation time `t`. */
  const computeTarget = (t: number): void => {
    const slouch = (1 - energy) * 0.17;
    target.fill(0);
    target[HIP_Y] = seated ? seatHip : standHip;
    target[ARM_L_ROLL] = 0.07;
    target[ARM_R_ROLL] = -0.07;
    target[CHEST_PITCH] = slouch;
    target[HEAD_PITCH] = slouch * 1.1;
    if (seated) {
      target[LEG_L_PITCH] = THIGHS_FORWARD;
      target[LEG_R_PITCH] = THIGHS_FORWARD;
      target[KNEE_L] = SHINS_DOWN;
      target[KNEE_R] = SHINS_DOWN;
    }

    switch (pose) {
      case "stand": {
        const sway = Math.sin(t * 1.4);
        target[CHEST_PITCH] += sway * 0.012;
        target[ARM_L_PITCH] = sway * 0.045;
        target[ARM_R_PITCH] = -sway * 0.045;
        target[HEAD_YAW] = Math.sin(t * 0.5) * 0.18;
        break;
      }
      case "walk": {
        const amount = Math.min(1, walkSpeed / 0.9);
        const swing = Math.sin(stride) * amount;
        target[LEG_L_PITCH] = swing * 0.62;
        target[LEG_R_PITCH] = -swing * 0.62;
        // The trailing leg folds at the knee so the foot clears the floor.
        target[KNEE_L] = Math.max(0, Math.cos(stride + 0.6)) * 0.95 * amount;
        target[KNEE_R] = Math.max(0, -Math.cos(stride + 0.6)) * 0.95 * amount;
        target[ARM_L_PITCH] = -swing * 0.5;
        target[ARM_R_PITCH] = swing * 0.5;
        target[BOUNCE] = Math.abs(Math.cos(stride)) * 0.035 * amount;
        target[CHEST_PITCH] += 0.05 * amount;
        break;
      }
      case "sit": {
        // Feet swing a little, like someone who does not quite reach the floor.
        target[KNEE_L] += Math.sin(t * 1.9) * 0.1;
        target[KNEE_R] += Math.sin(t * 1.9 + 2.2) * 0.1;
        target[ARM_L_PITCH] = -0.62;
        target[ARM_R_PITCH] = -0.62;
        target[HEAD_YAW] = Math.sin(t * 0.45) * 0.22;
        target[CHEST_PITCH] += Math.sin(t * 1.3) * 0.012;
        break;
      }
      case "type": {
        // Hands hover over the keyboard at desk height; fingers = fast alternating jitter.
        target[CHEST_PITCH] += 0.1;
        target[ARM_L_PITCH] = -0.97 + Math.sin(t * 13) * 0.07;
        target[ARM_R_PITCH] = -0.97 + Math.cos(t * 11.3) * 0.07;
        target[ARM_L_ROLL] = -0.1;
        target[ARM_R_ROLL] = 0.1;
        target[HEAD_PITCH] += 0.1 + Math.sin(t * 3.1) * 0.03;
        target[HEAD_YAW] = Math.sin(t * 0.7) * 0.06;
        break;
      }
      case "cheer": {
        const wave = Math.sin(t * 9);
        target[CHEST_PITCH] = -0.06;
        target[HEAD_PITCH] = -0.22;
        target[ARM_L_PITCH] = -2.85 + wave * 0.14;
        target[ARM_R_PITCH] = -2.85 - wave * 0.14;
        target[ARM_L_ROLL] = 0.42 + wave * 0.08;
        target[ARM_R_ROLL] = -0.42 + wave * 0.08;
        target[BOUNCE] = Math.abs(Math.sin(t * 5.5)) * (seated ? 0.035 : 0.13);
        break;
      }
      case "slump": {
        const sigh = Math.sin(t * 1.1) * 0.02;
        target[CHEST_PITCH] = (seated ? 0.36 : 0.26) + sigh;
        target[HEAD_PITCH] = 0.62;
        target[ARM_L_PITCH] = seated ? -0.2 : 0.08;
        target[ARM_R_PITCH] = seated ? -0.2 : 0.08;
        target[ARM_L_ROLL] = 0.02;
        target[ARM_R_ROLL] = -0.02;
        break;
      }
      case "sleep": {
        // Slow breathing; head lolled to one side.
        const breath = Math.sin(t * 0.9);
        target[CHEST_PITCH] = (seated ? 0.5 : 0.2) + breath * 0.035;
        target[HEAD_PITCH] = 0.5 + breath * 0.03;
        target[HEAD_ROLL] = 0.32;
        target[ARM_L_PITCH] = seated ? -0.75 : 0.05;
        target[ARM_R_PITCH] = seated ? -0.75 : 0.05;
        target[ARM_L_ROLL] = -0.12;
        target[ARM_R_ROLL] = 0.12;
        break;
      }
      case "phone": {
        // Left hand to the ear, right hand talking.
        target[ARM_L_PITCH] = -2.5;
        target[ARM_L_ROLL] = -0.28;
        target[ARM_R_PITCH] = (seated ? -0.7 : -0.35) + Math.sin(t * 2.3) * 0.22;
        target[ARM_R_ROLL] = -0.16;
        target[HEAD_ROLL] = -0.12;
        target[HEAD_PITCH] += Math.sin(t * 1.7) * 0.06;
        target[HEAD_YAW] = Math.sin(t * 0.6) * 0.15;
        break;
      }
      case "floor-sit": {
        floorLegs();
        target[CHEST_PITCH] += 0.16;
        target[ARM_L_PITCH] = -0.82 + Math.sin(t * 12) * 0.06;
        target[ARM_R_PITCH] = -0.82 + Math.cos(t * 10.5) * 0.06;
        target[ARM_L_ROLL] = -0.16;
        target[ARM_R_ROLL] = 0.16;
        target[HEAD_PITCH] += 0.22 + Math.sin(t * 2.7) * 0.025;
        break;
      }
    }

    // A beanbag slump or doze: the same upper body, on the floor.
    if (floor) floorLegs();

    if (carrying && (pose === "stand" || pose === "walk")) {
      // Both arms forward and slightly in, under the box; they do not swing.
      target[ARM_L_PITCH] = -1.02;
      target[ARM_R_PITCH] = -1.02;
      target[ARM_L_ROLL] = -0.14;
      target[ARM_R_ROLL] = 0.14;
    }
  };

  const applyChannels = (): void => {
    hips.position.set(0, current[HIP_Y] + current[BOUNCE], current[HIP_Z]);
    chest.rotation.x = current[CHEST_PITCH];
    head.rotation.set(current[HEAD_PITCH], current[HEAD_YAW], current[HEAD_ROLL]);
    armL.rotation.set(current[ARM_L_PITCH], 0, current[ARM_L_ROLL]);
    armR.rotation.set(current[ARM_R_PITCH], 0, current[ARM_R_ROLL]);
    legL.rotation.set(current[LEG_L_PITCH], current[LEG_SPLAY], 0);
    legR.rotation.set(current[LEG_R_PITCH], -current[LEG_SPLAY], 0);
    kneeL.rotation.x = current[KNEE_L];
    kneeR.rotation.x = current[KNEE_R];
  };

  const settle = (): void => {
    computeTarget(clock);
    current.set(target);
    blend = 1;
    applyChannels();
  };
  settle();

  const setMaterial = (next: THREE.Material): void => {
    for (const mesh of meshes) mesh.material = next;
  };
  let tint: number | null = null;
  let dimmed = false;
  const refreshMaterial = (): void => setMaterial(vertexMat(dimmed ? DIM_TINT : (tint ?? 0xffffff)));

  return {
    group,
    headAnchor,
    look,
    height: (LEG_LEN + NECK_Y + HEAD_H) * look.scale,

    setPose(next, options = {}) {
      const nextFloor = (next === "slump" || next === "sleep") && options.floor === true;
      const nextSeated = next === "floor-sit" || nextFloor ? false : (options.seated ?? SEATED_BY_DEFAULT[next]);
      if (next !== pose || nextSeated !== seated || nextFloor !== floor) {
        pose = next;
        seated = nextSeated;
        floor = nextFloor;
        setLegShadows(!seated && pose !== "floor-sit" && !floor);
        from.set(current);
        blend = 0;
        showLaptop(pose === "floor-sit");
        showPhone(pose === "phone");
        refreshCarryBox();
      }
      if (options.immediate) settle();
    },
    getPose: () => pose,
    setWalkSpeed(unitsPerSecond) {
      walkSpeed = Math.max(0, unitsPerSecond);
    },
    setEnergy(next) {
      energy = Math.min(1, Math.max(0, next));
    },
    setCarrying(next) {
      if (next === carrying) return;
      carrying = next;
      // Ease the arms into (or out of) the hold instead of snapping them.
      from.set(current);
      blend = 0;
      refreshCarryBox();
    },
    setDimmed(next) {
      dimmed = next;
      refreshMaterial();
    },
    setTint(next) {
      tint = next;
      refreshMaterial();
    },
    update(dt) {
      // Low energy slows every gesture down as well as slouching the posture.
      clock += dt * (0.55 + 0.6 * energy);
      stride += dt * walkSpeed * STRIDE_RATE;
      computeTarget(clock);
      if (blend < 1) {
        blend = Math.min(1, blend + dt / BLEND_SECONDS);
        const k = blend * blend * (3 - 2 * blend);
        for (let i = 0; i < CHANNEL_COUNT; i += 1) current[i] = from[i] + (target[i] - from[i]) * k;
      } else {
        current.set(target);
      }
      applyChannels();
    },
    dispose() {
      group.removeFromParent();
    },
  };
};
