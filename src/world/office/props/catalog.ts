/**
 * Every prop factory, listed once, for a gallery page and the tests. The office
 * itself imports the factories, not this list.
 */
import { C } from "../../core/palette";
import type { LookId, OfficeIndex } from "../../types";
import {
  createCornerPost,
  createDoor,
  createDriveway,
  createFloor,
  createFloorLamp,
  createGarageDoor,
  createGround,
  createKerb,
  createNeonSign,
  createPendantLamp,
  createRoad,
  createRug,
  createSign,
  createWall,
  createWallArt,
  FLOOR_LAMP_STYLES,
  FLOOR_THICKNESS,
  GROUND_THICKNESS,
  wallStyleFor,
} from "./building";
import {
  BACKGROUND_BUILDING_VARIANTS,
  createArcadeCabinet,
  createBackgroundBuilding,
  createBench,
  createBicycle,
  createBookshelf,
  createBush,
  createCardboardBoxes,
  createCoffeeTable,
  createCouch,
  createFilingCabinet,
  createMeetingPod,
  createParkedCar,
  createPegboard,
  createPingPongTable,
  createPlant,
  createReceptionDesk,
  createStockTicker,
  createStreetLamp,
  createTree,
  createTrophyShelf,
  createVendingMachine,
  createWaterCooler,
  createWhiteboard,
  PLANT_SIZES,
  TREE_VARIANTS,
} from "./decor";
import { createOverflowSign } from "./markers";
import { createSignatureProp, SIGNATURE_SIZES } from "./signature";
import type { SignatureKind } from "./signature";
import type { PropHandle } from "./shared";
import { SCREEN_KINDS } from "./shared";
import {
  createBoardTable,
  createCoffeeMachine,
  createGrowthCorner,
  createInvestorLine,
  createPricingBoard,
  createProductWall,
  createServerRack,
  createWallCalendar,
} from "./stations";
import { createChair, createDesk, DESK_STYLES } from "./workstations";

export type PropSet = "workstations" | "stations" | "building" | "decor" | "markers";
export const PROP_SETS: readonly PropSet[] = ["workstations", "stations", "building", "decor", "markers"];

export type PropMount = "floor" | "wall" | "float";

export interface CatalogInstance {
  handle: PropHandle;
  /** Drives the prop's setters over time so the gallery shows its states. */
  demo?: (elapsed: number) => void;
}

export interface CatalogEntry {
  id: string;
  set: PropSet;
  label: string;
  /** Mesh budget class: hero ≤ 25 meshes, decor ≤ 10. */
  budget: "hero" | "decor";
  /** Lowest point of the prop relative to its origin (0 for floor-standing props; slabs go below). */
  minY: number;
  /** "floor" props stand on y = 0; "wall" props hang on the wall behind them; "float" props hover (markers). */
  mount: PropMount;
  /** Looks different from office to office, and from look to look. */
  styled: boolean;
  create(office: OfficeIndex, look?: LookId): CatalogInstance;
}

interface EntrySpec<H extends PropHandle> {
  id: string;
  set: PropSet;
  label: string;
  budget?: "hero" | "decor";
  minY?: number;
  mount?: PropMount;
  styled?: boolean;
  create: (office: OfficeIndex, look: LookId) => H;
  /** Returns the per-frame driver for one instance (so it can keep its own state). */
  demo?: (handle: H) => (elapsed: number) => void;
}

const entry = <H extends PropHandle>(spec: EntrySpec<H>): CatalogEntry => ({
  id: spec.id,
  set: spec.set,
  label: spec.label,
  budget: spec.budget ?? "decor",
  minY: spec.minY ?? 0,
  mount: spec.mount ?? "floor",
  styled: spec.styled ?? false,
  create: (office, look = "classic") => {
    const handle = spec.create(office, look);
    return spec.demo ? { handle, demo: spec.demo(handle) } : { handle };
  },
});

/** Wall-hung signs have their bottom edge at the origin: lift them to a sensible hanging height for review. */
const positioned = <H extends PropHandle>(handle: H, y: number): H => {
  for (const child of handle.group.children) child.position.y += y;
  return handle;
};

/** Flip every `period` seconds, offset so neighbouring props do not blink in unison. */
const blink = (elapsed: number, period: number, offset = 0): boolean => Math.floor((elapsed + offset) / period) % 2 === 0;

/** Call `fn(count)` once each time another `period` seconds has passed. */
const every = (period: number, fn: (count: number) => void, offset = 0): ((elapsed: number) => void) => {
  let last = -1;
  return (elapsed) => {
    const count = Math.floor((elapsed + offset) / period);
    if (count === last) return;
    last = count;
    fn(count);
  };
};

const workstations: CatalogEntry[] = [
  ...DESK_STYLES.flatMap((style, i) => [
    entry({
      id: `desk-${style}`,
      set: "workstations",
      label: `desk · ${style}`,
      budget: "hero",
      create: () => createDesk({ style, variant: i, screen: SCREEN_KINDS[i % SCREEN_KINDS.length] }),
    }),
    entry({
      id: `desk-${style}-vacant`,
      set: "workstations",
      label: `desk · ${style} · vacant ↔ busy`,
      budget: "hero",
      create: () => createDesk({ style, variant: i + 2, occupied: false }),
      demo: (desk) => (t) => desk.setOccupied(!blink(t, 2.5, i * 0.4)),
    }),
    entry({
      id: `chair-${style}`,
      set: "workstations",
      label: `chair · ${style}`,
      create: () => createChair({ style }),
    }),
  ]),
];

const stations: CatalogEntry[] = [
  entry({
    id: "station-ship",
    set: "stations",
    mount: "wall",
    label: "product wall",
    budget: "hero",
    styled: true,
    create: (office, look) => createProductWall(office, look),
    demo: (wall) =>
      every(1.2, (count) => {
        wall.setNoteCount((count * 3) % (wall.maxNotes + 3));
        if (count % 4 === 3) wall.pulse(count % 8 === 7 ? "bad" : "good");
      }),
  }),
  entry({
    id: "station-launch",
    set: "stations",
    label: "growth corner",
    budget: "hero",
    styled: true,
    create: (office, look) => createGrowthCorner(office, look),
    demo: (corner) => every(3, () => corner.flash(), 1),
  }),
  entry({
    id: "station-investors",
    set: "stations",
    label: "phone corner",
    budget: "hero",
    styled: true,
    create: (office, look) => createInvestorLine(office, look),
    demo: (line) => every(2.5, (count) => line.ring(count % 2 === 0)),
  }),
  entry({
    id: "station-boardroom",
    set: "stations",
    label: "board table",
    budget: "hero",
    styled: true,
    create: (office, look) => createBoardTable(office, look),
  }),
  entry({
    id: "station-calendar",
    set: "stations",
    mount: "wall",
    label: "wall calendar",
    budget: "hero",
    styled: true,
    create: (office, look) => createWallCalendar(office, look),
  }),
  entry({
    id: "station-coffee",
    set: "stations",
    label: "coffee machine",
    budget: "hero",
    styled: true,
    create: (office, look) => createCoffeeMachine(office, look),
  }),
  entry({
    id: "station-servers",
    set: "stations",
    label: "server rack",
    budget: "hero",
    styled: true,
    create: (office, look) => createServerRack(office, look),
  }),
  entry({
    id: "station-pricing",
    set: "stations",
    mount: "wall",
    label: "price board",
    budget: "hero",
    styled: true,
    create: (office, look) => createPricingBoard(office, look),
  }),
];

const building: CatalogEntry[] = [
  entry({
    id: "floor",
    set: "building",
    label: "floor",
    styled: true,
    minY: -FLOOR_THICKNESS,
    create: (office, look) => createFloor(4.4, 3.2, office, look),
  }),
  entry({
    id: "ground",
    set: "building",
    label: "ground",
    styled: true,
    minY: -GROUND_THICKNESS,
    create: (office, look) => createGround(4.4, 3.2, office, look),
  }),
  entry({ id: "road", set: "building", label: "road", create: () => createRoad(4.4) }),
  entry({ id: "driveway", set: "building", label: "driveway", create: () => createDriveway(2.6, 3.2) }),
  entry({
    id: "wall",
    set: "building",
    label: "wall",
    styled: true,
    create: (office, look) => createWall(4.2, { style: wallStyleFor(office, look), windows: office === 0 ? 1 : 2, look }),
  }),
  entry({ id: "wall-plain", set: "building", label: "wall · brick, no windows", create: () => createWall(2.4, { style: "brick" }) }),
  entry({ id: "corner-post", set: "building", label: "corner post", create: () => createCornerPost({ style: "plaster" }) }),
  entry({ id: "kerb", set: "building", label: "kerb", create: () => createKerb(2.4, { style: "plaster" }) }),
  entry({
    id: "door",
    set: "building",
    label: "door",
    budget: "hero",
    styled: true,
    create: (office, look) => createDoor(office, look),
    demo: (door) => every(2.2, (count) => door.setOpen(count % 2)),
  }),
  entry({ id: "garage-door", set: "building", label: "garage door (raised)", create: () => createGarageDoor(3.2) }),
  entry({ id: "rug-border", set: "building", label: "rug · border", create: () => createRug(2.4, 1.6, { color: C.teal }) }),
  entry({ id: "rug-stripes", set: "building", label: "rug · stripes", create: () => createRug(2.0, 1.4, { color: C.cream, accent: C.coral, pattern: "stripes" }) }),
  ...FLOOR_LAMP_STYLES.map((style) => entry({ id: `lamp-${style}`, set: "building", label: `floor lamp · ${style}`, create: () => createFloorLamp({ style }) })),
  entry({ id: "lamp-pendant", set: "building", label: "pendant lamp", mount: "float", create: () => createPendantLamp() }),
  entry({ id: "sign", set: "building", label: "sign", mount: "wall", create: () => positioned(createSign("OPEN LATE"), 1.5) }),
  entry({ id: "sign-lit", set: "building", label: "sign · lit", mount: "wall", create: () => positioned(createSign("WELCOME", { lit: true, color: C.good }), 1.5) }),
  entry({ id: "neon-sign", set: "building", label: "neon company sign", mount: "wall", create: () => positioned(createNeonSign("Your Company"), 1.5) }),
  ...[0, 1, 2, 3].map((variant) =>
    entry({ id: `wall-art-${variant}`, set: "building", label: `wall art · ${variant}`, mount: "wall", create: () => positioned(createWallArt(variant), 1.2) })
  ),
];

const decor: CatalogEntry[] = [
  ...PLANT_SIZES.map((size, i) => entry({ id: `plant-${size}`, set: "decor", label: `plant · ${size}`, create: () => createPlant(size, { variant: i }) })),
  entry({ id: "bookshelf", set: "decor", label: "bookshelf", styled: true, create: (office, look) => createBookshelf(office, look) }),
  entry({ id: "couch-2", set: "decor", label: "couch · 2 seats", create: () => createCouch({ seats: 2, color: C.teal }) }),
  entry({ id: "couch-3", set: "decor", label: "couch · 3 seats", create: () => createCouch({ seats: 3, color: C.coral }) }),
  entry({ id: "coffee-table", set: "decor", label: "coffee table", styled: true, create: (office, look) => createCoffeeTable(office, look) }),
  entry({ id: "water-cooler", set: "decor", label: "water cooler", create: () => createWaterCooler() }),
  entry({ id: "whiteboard", set: "decor", label: "whiteboard on wheels", create: () => createWhiteboard() }),
  entry({ id: "filing-cabinet", set: "decor", label: "filing cabinet", create: () => createFilingCabinet() }),
  ...[0, 1, 2].map((variant) => entry({ id: `boxes-${variant}`, set: "decor", label: `cardboard boxes · ${variant}`, create: () => createCardboardBoxes(variant) })),
  entry({ id: "car", set: "decor", label: "parked car", create: () => createParkedCar() }),
  entry({ id: "bicycle", set: "decor", label: "bicycle", create: () => createBicycle() }),
  entry({ id: "pegboard", set: "decor", label: "tool pegboard", mount: "wall", create: () => createPegboard() }),
  entry({ id: "ping-pong", set: "decor", label: "ping-pong table", create: () => createPingPongTable() }),
  entry({ id: "arcade", set: "decor", label: "arcade cabinet", create: () => createArcadeCabinet() }),
  entry({ id: "vending", set: "decor", label: "vending machine", create: () => createVendingMachine() }),
  entry({ id: "trophy-shelf", set: "decor", label: "trophy shelf", create: () => createTrophyShelf() }),
  entry({ id: "ticker", set: "decor", label: "stock ticker", create: () => createStockTicker() }),
  entry({ id: "reception", set: "decor", label: "reception desk · full floor", create: (_office, look) => createReceptionDesk(3, look) }),
  entry({ id: "reception-campus", set: "decor", label: "reception desk · campus", create: (_office, look) => createReceptionDesk(4, look) }),
  entry({ id: "meeting-pod", set: "decor", label: "glass meeting pod", create: (_office, look) => createMeetingPod(3, look) }),
  ...Array.from({ length: TREE_VARIANTS }, (_, variant) => entry({ id: `tree-${variant}`, set: "decor", label: `tree · ${variant}`, create: () => createTree(variant) })),
  entry({ id: "bush-0", set: "decor", label: "bush", create: () => createBush(0) }),
  entry({ id: "bush-1", set: "decor", label: "bush · in flower", create: () => createBush(1) }),
  entry({ id: "street-lamp", set: "decor", label: "street lamp", create: () => createStreetLamp() }),
  entry({ id: "bench", set: "decor", label: "bench", create: () => createBench() }),
  ...Array.from({ length: BACKGROUND_BUILDING_VARIANTS }, (_, variant) =>
    entry({ id: `skyline-${variant}`, set: "decor", label: `background building · ${variant}`, create: () => createBackgroundBuilding(variant, { scale: 0.6 }) })
  ),
  // Every signature prop, each once (eras share some), at the least size it is ever given.
  ...(Object.keys(SIGNATURE_SIZES) as SignatureKind[])
    .map((kind) =>
      entry({ id: `signature-${kind}`, set: "decor", label: `signature · ${kind.replace("-", " ")}`, create: () => createSignatureProp(kind, SIGNATURE_SIZES[kind], 0) })
    ),
];

const markers: CatalogEntry[] = [
  entry({
    id: "overflow-sign",
    set: "markers",
    label: "sign of people not drawn",
    create: () => createOverflowSign(),
    demo: (sign) => every(1.5, (count) => sign.setCount(1 + ((count * 7) % 40))),
  }),
];

export const PROP_CATALOG: readonly CatalogEntry[] = [...workstations, ...stations, ...building, ...decor, ...markers];
