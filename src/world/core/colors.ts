/** Split from core/palette.ts (M5): the palette — UI colours, diorama colours, team/outfit/skin/hair colours, the looks and the per-office themes, the scale guide and colour math. Re-exported by ./palette, so every existing import from "./palette" / "../core/palette" keeps working. */
import type { LookId, OfficeIndex, Team } from "../types";

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

/**
 * Shirt colour per team, and the accent of that team's desks. Three colours far apart in hue, so a team reads as
 * a block of colour from across the office.
 */
export const ROLE_COLORS: Record<Team, number> = {
  product: 0x7dd3fc,
  growth: 0xfb923c,
  recruiting: 0x4ade80,
};

export interface Outfit {
  top: number;
  trim: number;
  pants: number;
  shoes: number;
}

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

/** Every look there is. A look is how an office of a given size is dressed: the classic one, then one per decade. */
export const LOOKS: readonly LookId[] = ["classic", "nineties", "noughties", "twenties"];

/**
 * The look of each era the career has, by its decade's furniture. Era ids are free text to the world (the rules
 * name the eras); these are the ids the shipped career uses.
 */
export const ERA_LOOKS: Readonly<Record<string, LookId>> = Object.freeze({
  "dial-up": "nineties",
  "gold-rush": "nineties",
  bust: "noughties",
  phones: "noughties",
  "cheap-money": "noughties",
  "winter-ai": "twenties",
  agents: "twenties",
  ambient: "twenties",
});

/** The look of an era. Any string has one: an era not listed (or a name an object inherits) keeps the classic look. */
export const lookFor = (era: string): LookId => (Object.hasOwn(ERA_LOOKS, era) ? ERA_LOOKS[era] : "classic");

/** Furniture finish for one office in one look: the garage scrappy → the campus polished. */
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

/** One theme per office (0 the garage … 4 the campus). */
export type OfficeThemes = readonly [PhaseTheme, PhaseTheme, PhaseTheme, PhaseTheme, PhaseTheme];

/** The themes, by look and then by office. "classic" is the old polish for each size of office. */
export const PHASE_THEMES: Record<LookId, OfficeThemes> = {
  classic: [
    { wood: C.plywood, woodDark: C.pallet, frame: C.galvanised, panel: C.cardboard, accents: [C.red, C.yellow, C.blue], glow: EMBER },
    { wood: C.birch, woodDark: C.oak, frame: C.white, panel: C.cream, accents: [C.teal, C.yellow, C.coral], glow: NEON },
    { wood: C.oak, woodDark: C.walnut, frame: C.steel, panel: C.greyLight, accents: [C.blue, C.teal, C.orange], glow: NEON },
    { wood: C.birch, woodDark: C.oak, frame: C.white, panel: C.white, accents: [C.purple, C.leaf, C.pink], glow: NEON },
    { wood: C.walnut, woodDark: C.walnutDark, frame: C.brass, panel: C.marble, accents: [C.burgundy, C.navy, C.brass], glow: EMBER },
  ],
  // Beige casework and grey metal: the office furniture of the dial-up years.
  nineties: [
    { wood: C.pallet, woodDark: C.cardboardDark, frame: C.grey, panel: C.bone, accents: [C.teal, C.purple, C.yellow], glow: EMBER },
    { wood: C.oak, woodDark: C.pallet, frame: C.grey, panel: C.cream, accents: [C.navy, C.teal, C.coral], glow: EMBER },
    { wood: C.oak, woodDark: C.walnut, frame: C.greyDark, panel: C.bone, accents: [C.burgundy, C.teal, C.yellow], glow: NEON },
    { wood: C.birch, woodDark: C.oak, frame: C.grey, panel: C.cream, accents: [C.navy, C.burgundy, C.teal], glow: NEON },
    { wood: C.walnut, woodDark: C.walnutDark, frame: C.brass, panel: C.bone, accents: [C.navy, C.burgundy, C.green], glow: EMBER },
  ],
  // Light woods on steel frames.
  noughties: [
    { wood: C.birch, woodDark: C.plywood, frame: C.steel, panel: C.greyLight, accents: [C.orange, C.blue, C.leaf], glow: NEON },
    { wood: C.plywood, woodDark: C.oak, frame: C.steel, panel: C.white, accents: [C.orange, C.leafLight, C.blue], glow: NEON },
    { wood: C.birch, woodDark: C.oak, frame: C.steel, panel: C.white, accents: [C.blue, C.orange, C.leafLight], glow: NEON },
    { wood: C.oak, woodDark: C.walnut, frame: C.chrome, panel: C.greyLight, accents: [C.blue, C.pink, C.orange], glow: NEON },
    { wood: C.oak, woodDark: C.walnut, frame: C.steel, panel: C.charcoal, accents: [C.orange, C.blue, C.chrome], glow: NEON },
  ],
  // Birch and white with green and teal.
  twenties: [
    { wood: C.birch, woodDark: C.plywood, frame: C.white, panel: C.bone, accents: [C.leaf, C.teal, C.yellow], glow: NEON },
    { wood: C.birch, woodDark: C.oak, frame: C.charcoal, panel: C.white, accents: [C.leaf, C.teal, C.coral], glow: NEON },
    { wood: C.birch, woodDark: C.oak, frame: C.white, panel: C.greyLight, accents: [C.teal, C.leaf, C.pink], glow: NEON },
    { wood: C.plywood, woodDark: C.oak, frame: C.white, panel: C.white, accents: [C.leafDark, C.teal, C.yellow], glow: NEON },
    { wood: C.oak, woodDark: C.walnut, frame: C.black, panel: C.white, accents: [C.leaf, C.teal, C.brass], glow: EMBER },
  ],
};

/** The five offices, smallest first. */
export const PHASES: readonly OfficeIndex[] = [0, 1, 2, 3, 4];

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
  /** Standing character, before the ± 8 % look variation. */
  person: 1.5,
  /** Back walls. */
  wall: 2.6,
} as const;

/** 0 for the garage … 4 for the campus. Anything that is not one of the five offices counts as the garage. */
export const phaseTier = (office: OfficeIndex): number => Math.max(0, PHASES.indexOf(office));

/** The furniture finish of an office in a look. An office out of range is dressed as the garage. */
export const themeFor = (office: OfficeIndex, look: LookId): PhaseTheme => PHASE_THEMES[look][phaseTier(office)];

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
