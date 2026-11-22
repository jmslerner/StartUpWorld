/** Split from core/palette.ts (M5): the palette — UI colours, diorama colours, role/outfit/skin/hair colours, per-phase themes, the scale guide and colour math. Re-exported by ./palette, so every existing import from "./palette" / "../core/palette" keeps working. */
import type { CompanyPhase, TeamRole } from "../../types/game";

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

/**
 * The scale guide every model is built to (spec §2), in world units ≈ metres.
 * Furniture and characters both read these, so a seated person always meets
 * their chair.
 */
export const SCALE = {
  /** Desk surface height. */
  deskTop: 0.72,
  /** Chair seat height: seated characters put their hips here. */
  seat: 0.45,
  /** Beanbag seat height, for the cross-legged "floor-sit" pose. */
  floorSeat: 0.24,
  /** Standing character, before the ± 8 % look variation. */
  person: 1.5,
  /** Back walls. */
  wall: 2.6,
} as const;

/** 0 for the garage … 4 for the public HQ. */
export const phaseTier = (phase: CompanyPhase): number => PHASES.indexOf(phase);

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
