/**
 * Every prop factory, listed once, for the dev gallery (/world-gallery) and the
 * tests. Game code should import the factories themselves, not this list.
 */
import type { CompanyPhase, PricingModel } from "../../../types/game";
import { C } from "../../core/palette";
import { createHelicopter, createJet, createLounge, createOfficeUpgradeKit, createYacht, makeBlueprint } from "./assets";
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
  WALL_STYLE_FOR_PHASE,
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
import { createAlarmLight, createEventBeacon, createOverflowSign } from "./markers";
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
import { createChair, createDesk, createOverflowSpot, createVacantMarker, DESK_STYLES } from "./workstations";

export type PropSet = "workstations" | "stations" | "building" | "decor" | "assets" | "markers";
export const PROP_SETS: readonly PropSet[] = ["workstations", "stations", "building", "decor", "assets", "markers"];

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
  /** Looks different per company phase (honours the gallery's ?style=). */
  styled: boolean;
  create(phase: CompanyPhase): CatalogInstance;
}

interface EntrySpec<H extends PropHandle> {
  id: string;
  set: PropSet;
  label: string;
  budget?: "hero" | "decor";
  minY?: number;
  mount?: PropMount;
  styled?: boolean;
  create: (phase: CompanyPhase) => H;
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
  create: (phase) => {
    const handle = spec.create(phase);
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
      id: `desk-${style}-upgraded`,
      set: "workstations",
      label: `desk · ${style} · upgraded`,
      budget: "hero",
      create: () => createDesk({ style, upgraded: true, variant: i + 1, screen: SCREEN_KINDS[(i + 2) % SCREEN_KINDS.length] }),
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
  entry({ id: "vacant-marker", set: "workstations", label: "vacant marker", mount: "float", create: () => createVacantMarker() }),
  ...[0, 1, 2].map((variant) =>
    entry({
      id: `overflow-spot-${variant}`,
      set: "workstations",
      label: variant === 0 ? "overflow spot" : `overflow spot · ${variant}`,
      create: () => createOverflowSpot({ variant }),
      demo: (spot) => (t) => spot.setOccupied(variant === 2 && blink(t, 3)),
    })
  ),
];

const PRICING_CYCLE: readonly PricingModel[] = ["consumer", "prosumer", "enterprise"];

const stations: CatalogEntry[] = [
  entry({
    id: "station-ship",
    set: "stations",
    mount: "wall",
    label: "product wall (ship)",
    budget: "hero",
    styled: true,
    create: (phase) => createProductWall(phase),
    demo: (wall) =>
      every(1.2, (count) => {
        wall.setNoteCount((count * 3) % (wall.maxNotes + 3));
        if (count % 4 === 3) wall.pulse(count % 8 === 7 ? "bad" : "good");
      }),
  }),
  entry({
    id: "station-launch",
    set: "stations",
    label: "growth corner (launch)",
    budget: "hero",
    styled: true,
    create: (phase) => createGrowthCorner(phase),
    demo: (corner) => every(3, () => corner.flash(), 1),
  }),
  entry({
    id: "station-investors",
    set: "stations",
    label: "investor line (investors)",
    budget: "hero",
    styled: true,
    create: (phase) => createInvestorLine(phase),
    demo: (line) => every(2.5, (count) => line.ring(count % 2 === 0)),
  }),
  entry({
    id: "station-boardroom",
    set: "stations",
    label: "board table (boardroom)",
    budget: "hero",
    styled: true,
    create: (phase) => createBoardTable(phase),
  }),
  entry({
    id: "station-calendar",
    set: "stations",
    mount: "wall",
    label: "wall calendar (calendar)",
    budget: "hero",
    styled: true,
    create: (phase) => createWallCalendar(phase),
    demo: (calendar) => every(2.5, (count) => calendar.setWeek(7 + count)),
  }),
  entry({
    id: "station-coffee",
    set: "stations",
    label: "coffee machine (coffee)",
    budget: "hero",
    styled: true,
    create: (phase) => createCoffeeMachine(phase),
  }),
  entry({
    id: "station-coffee-upgraded",
    set: "stations",
    label: "coffee machine · espresso upgrade",
    budget: "hero",
    styled: true,
    create: (phase) => createCoffeeMachine(phase, { upgraded: true }),
  }),
  entry({
    id: "station-servers",
    set: "stations",
    label: "server rack (servers)",
    budget: "hero",
    styled: true,
    create: (phase) => createServerRack(phase),
    demo: (rack) => (t) => rack.setLoad(0.5 + Math.sin(t * 0.5) * 0.5),
  }),
  entry({
    id: "station-pricing",
    set: "stations",
    mount: "wall",
    label: "pricing board (pricing)",
    budget: "hero",
    styled: true,
    create: (phase) => createPricingBoard(phase),
    demo: (board) => every(1.8, (count) => board.setModel(PRICING_CYCLE[count % 3])),
  }),
];

const building: CatalogEntry[] = [
  entry({
    id: "floor",
    set: "building",
    label: "floor",
    styled: true,
    minY: -FLOOR_THICKNESS,
    create: (phase) => createFloor(4.4, 3.2, phase),
  }),
  entry({
    id: "ground",
    set: "building",
    label: "ground",
    styled: true,
    minY: -GROUND_THICKNESS,
    create: (phase) => createGround(4.4, 3.2, phase),
  }),
  entry({ id: "road", set: "building", label: "road", create: () => createRoad(4.4) }),
  entry({ id: "driveway", set: "building", label: "driveway", create: () => createDriveway(2.6, 3.2) }),
  entry({
    id: "wall",
    set: "building",
    label: "wall",
    styled: true,
    create: (phase) => createWall(4.2, { style: WALL_STYLE_FOR_PHASE[phase], windows: phase === "garage" ? 1 : 2 }),
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
    create: (phase) => createDoor(phase),
    demo: (door) => every(2.2, (count) => door.setOpen(count % 2)),
  }),
  entry({ id: "garage-door", set: "building", label: "garage door (raised)", create: () => createGarageDoor(3.2) }),
  entry({ id: "rug-border", set: "building", label: "rug · border", create: () => createRug(2.4, 1.6, { color: C.teal }) }),
  entry({ id: "rug-stripes", set: "building", label: "rug · stripes", create: () => createRug(2.0, 1.4, { color: C.cream, accent: C.coral, pattern: "stripes" }) }),
  ...FLOOR_LAMP_STYLES.map((style) => entry({ id: `lamp-${style}`, set: "building", label: `floor lamp · ${style}`, create: () => createFloorLamp({ style }) })),
  entry({ id: "lamp-pendant", set: "building", label: "pendant lamp", mount: "float", create: () => createPendantLamp() }),
  entry({ id: "sign", set: "building", label: "sign", mount: "wall", create: () => positioned(createSign("STARTUP WORLD"), 1.5) }),
  entry({ id: "sign-lit", set: "building", label: "sign · lit", mount: "wall", create: () => positioned(createSign("SHIP IT", { lit: true, color: C.good }), 1.5) }),
  entry({ id: "neon-sign", set: "building", label: "neon company sign", mount: "wall", create: () => positioned(createNeonSign("Acme Rockets"), 1.5) }),
  ...[0, 1, 2, 3].map((variant) =>
    entry({ id: `wall-art-${variant}`, set: "building", label: `wall art · ${variant}`, mount: "wall", create: () => positioned(createWallArt(variant), 1.2) })
  ),
];

const decor: CatalogEntry[] = [
  ...PLANT_SIZES.map((size, i) => entry({ id: `plant-${size}`, set: "decor", label: `plant · ${size}`, create: () => createPlant(size, { variant: i }) })),
  entry({ id: "bookshelf", set: "decor", label: "bookshelf", styled: true, create: (phase) => createBookshelf(phase) }),
  entry({ id: "couch-2", set: "decor", label: "couch · 2 seats", create: () => createCouch({ seats: 2, color: C.teal }) }),
  entry({ id: "couch-3", set: "decor", label: "couch · 3 seats", create: () => createCouch({ seats: 3, color: C.coral }) }),
  entry({ id: "coffee-table", set: "decor", label: "coffee table", styled: true, create: (phase) => createCoffeeTable(phase) }),
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
  entry({ id: "reception", set: "decor", label: "reception desk · unicorn", create: () => createReceptionDesk("unicorn") }),
  entry({ id: "reception-public", set: "decor", label: "reception desk · public", create: () => createReceptionDesk("public") }),
  entry({ id: "meeting-pod", set: "decor", label: "glass meeting pod", create: () => createMeetingPod("unicorn") }),
  ...Array.from({ length: TREE_VARIANTS }, (_, variant) => entry({ id: `tree-${variant}`, set: "decor", label: `tree · ${variant}`, create: () => createTree(variant) })),
  entry({ id: "bush-0", set: "decor", label: "bush", create: () => createBush(0) }),
  entry({ id: "bush-1", set: "decor", label: "bush · in flower", create: () => createBush(1) }),
  entry({ id: "street-lamp", set: "decor", label: "street lamp", create: () => createStreetLamp() }),
  entry({ id: "bench", set: "decor", label: "bench", create: () => createBench() }),
  ...Array.from({ length: BACKGROUND_BUILDING_VARIANTS }, (_, variant) =>
    entry({ id: `skyline-${variant}`, set: "decor", label: `background building · ${variant}`, create: () => createBackgroundBuilding(variant, { scale: 0.6 }) })
  ),
];

const assets: CatalogEntry[] = [
  entry({ id: "asset-office-upgrade", set: "assets", label: "office upgrade kit", budget: "hero", create: () => createOfficeUpgradeKit() }),
  entry({ id: "asset-lounge", set: "assets", label: "executive lounge", budget: "hero", create: () => createLounge() }),
  entry({
    id: "asset-helicopter",
    set: "assets",
    label: "helicopter",
    budget: "hero",
    create: () => createHelicopter(),
    demo: (helicopter) => every(4, (count) => helicopter.setRotorSpeed(count % 2 ? 4 : 0.35)),
  }),
  entry({ id: "asset-jet", set: "assets", label: "private jet", budget: "hero", create: () => createJet() }),
  entry({ id: "asset-yacht", set: "assets", label: "yacht", budget: "hero", minY: -0.12, create: () => createYacht() }),
  entry({ id: "blueprint-lounge", set: "assets", label: "blueprint · lounge", budget: "hero", create: () => makeBlueprint(createLounge(), "$100K") }),
  entry({ id: "blueprint-helicopter", set: "assets", label: "blueprint · helicopter", budget: "hero", create: () => makeBlueprint(createHelicopter(), "$500K") }),
  entry({ id: "blueprint-upgrade", set: "assets", label: "blueprint · office upgrade", budget: "hero", create: () => makeBlueprint(createOfficeUpgradeKit(), "$50K") }),
];

const markers: CatalogEntry[] = [
  entry({ id: "event-beacon", set: "markers", label: "event beacon", mount: "float", create: () => createEventBeacon() }),
  entry({
    id: "alarm-light",
    set: "markers",
    label: "alarm light",
    create: () => createAlarmLight(),
    demo: (alarm) => every(4, (count) => alarm.setActive(count % 3 !== 2)),
  }),
  entry({
    id: "overflow-sign",
    set: "markers",
    label: "overflow sign",
    create: () => createOverflowSign(),
    demo: (sign) => every(1.5, (count) => sign.setCount(1 + ((count * 7) % 40))),
  }),
];

export const PROP_CATALOG: readonly CatalogEntry[] = [...workstations, ...stations, ...building, ...decor, ...assets, ...markers];
