/**
 * Set dressing: what turns a floor plan with desks into a particular place.
 *
 * Two layers:
 *   • free-standing indoor pieces come from the floor plan (`getLayoutDecor`),
 *     because people have to walk around them — DECOR_FACTORIES turns each spot
 *     into its prop;
 *   • everything nobody can bump into (things on the walls, rugs, lamps
 *     overhead, the world outside) is listed per office in SCENES below.
 *
 * Nothing here is interactive, and nothing here changes after the office is
 * built. The signs say plain words: the world is told no company's name.
 */
import { C, NEON, phaseTier, themeFor } from "../core/palette";
import type { LookId, OfficeIndex } from "../types";
import { decorSize, getLayoutDecor, groundRect, LOFT_ANNEX_WIDTH, WALL_GAP } from "./layouts";
import { createSignatureProp, SIGNATURE_PROPS, SIGNATURE_SIZES } from "./props/signature";
import type { SignatureKind } from "./props/signature";
import type { DecorKind, DecorSpot, GroundRect } from "./layouts";
import {
  createArcadeCabinet,
  createBackgroundBuilding,
  createBench,
  createBicycle,
  createBookshelf,
  createBush,
  createCardboardBoxes,
  createChair,
  createCoffeeTable,
  createCouch,
  createDesk,
  createDriveway,
  createFilingCabinet,
  createFloorLamp,
  createMeetingPod,
  createNeonSign,
  createParkedCar,
  createPegboard,
  createPendantLamp,
  createPingPongTable,
  createPlant,
  createReceptionDesk,
  createRoad,
  createRug,
  createSign,
  createStockTicker,
  createStreetLamp,
  createTree,
  createTrophyShelf,
  createVendingMachine,
  createWall,
  createWallArt,
  createWaterCooler,
  createWhiteboard,
  PropKit,
} from "./props";
import type { PropFootprint, PropHandle } from "./props";
import type { Spot, StageKit } from "./StageKit";

// ─────────────────────────────────────────────────────────────────────────────
// Free-standing pieces from the floor plan
// ─────────────────────────────────────────────────────────────────────────────

/** Several props that stand, glow and go away as one. Parts are positioned by the caller. */
const combine = (name: string, footprint: PropFootprint, parts: readonly PropHandle[]): PropHandle => {
  const kit = new PropKit(name);
  for (const part of parts) kit.add(part.group);
  kit.onGlow((amount) => {
    for (const part of parts) part.setGlow?.(amount);
  });
  const handle = kit.finish(footprint);
  const disposeKit = handle.dispose;
  handle.dispose = () => {
    for (const part of parts) part.dispose();
    disposeKit();
  };
  return handle;
};

/** Somebody else's hot desk in the shared loft: plain, tidy, nobody home. */
const createGuestDesk = (variant: number): PropHandle => {
  const accent = [C.grey, C.greyLight, C.bone][variant % 3];
  const desk = createDesk({ style: "hotdesk", accent, variant, occupied: variant % 2 === 0 });
  const chair = createChair({ style: "hotdesk", accent });
  desk.group.position.z = 0.3;
  chair.group.position.z = -0.25;
  return combine("guest-desk", { w: 1.3, d: 1.25 }, [desk, chair]);
};

const COUCH_COLORS = [C.teal, C.coral, C.navy, C.purple, C.leather];
const LAMP_STYLES = ["classic", "arc", "work"] as const;

const DECOR_FACTORIES: Record<DecorKind, (office: OfficeIndex, look: LookId, spot: DecorSpot) => PropHandle> = {
  plant: (_office, _look, spot) => createPlant("medium", { variant: spot.variant }),
  "plant-large": (_office, _look, spot) => createPlant("large", { variant: spot.variant }),
  bookshelf: (office, look) => createBookshelf(office, look),
  "filing-cabinet": (_office, _look, spot) => createFilingCabinet({ drawers: 2 + (spot.variant % 2) }),
  boxes: (_office, _look, spot) => createCardboardBoxes(spot.variant),
  couch: (_office, _look, spot) => createCouch({ seats: 2, color: COUCH_COLORS[spot.variant % COUCH_COLORS.length] }),
  "couch-wide": (_office, _look, spot) => createCouch({ seats: 3, color: COUCH_COLORS[spot.variant % COUCH_COLORS.length] }),
  "coffee-table": (office, look) => createCoffeeTable(office, look),
  "water-cooler": () => createWaterCooler(),
  whiteboard: () => createWhiteboard(),
  bicycle: (_office, _look, spot) => createBicycle({ color: [C.red, C.teal, C.yellow][spot.variant % 3] }),
  "ping-pong": () => createPingPongTable(),
  arcade: (_office, _look, spot) => createArcadeCabinet({ color: [C.purple, C.teal, C.red][spot.variant % 3] }),
  vending: (_office, _look, spot) => createVendingMachine({ color: [C.red, C.blue][spot.variant % 2] }),
  "trophy-shelf": () => createTrophyShelf(),
  "stock-ticker": () => createStockTicker(),
  reception: (office, look) => createReceptionDesk(office, look),
  "meeting-pod": (office, look) => createMeetingPod(office, look),
  "floor-lamp": (_office, _look, spot) => createFloorLamp({ style: LAMP_STYLES[spot.variant % LAMP_STYLES.length] }),
  "guest-desk": (_office, _look, spot) => createGuestDesk(spot.variant),
  partition: (_office, _look, spot) => createWall(decorSize(spot).width, { style: "glass", height: 2.1 }),
};

/** Build the prop for one piece of floor-plan décor (exported for the size test). */
export const createDecorProp = (office: OfficeIndex, spot: DecorSpot, look: LookId = "classic"): PropHandle =>
  DECOR_FACTORIES[spot.kind](office, look, spot);

// ─────────────────────────────────────────────────────────────────────────────
// Signature props: what says which era it is
// ─────────────────────────────────────────────────────────────────────────────

/** Décor a signature prop may stand in for. Never reception, meeting pods, partitions, couches, tables or games. */
export const REPLACEABLE_DECOR: readonly DecorKind[] = ["plant", "plant-large", "boxes", "filing-cabinet", "water-cooler", "vending", "bookshelf"];

const NO_SIGNATURES: ReadonlyMap<number, SignatureKind> = new Map();

/**
 * Where a look's signature props stand, by index into `decor`. Each of the look's props in turn takes the smallest
 * free spot (by floor area; the earlier spot on a tie) of a replaceable kind with room for it in width and depth.
 * A prop with no such spot left is not shown; none stands twice. The classic look has none.
 */
export const signaturePlan = (decor: readonly DecorSpot[], look: LookId): ReadonlyMap<number, SignatureKind> => {
  if (look === "classic") return NO_SIGNATURES;
  const plan = new Map<number, SignatureKind>();
  for (const kind of SIGNATURE_PROPS[look]) {
    const need = SIGNATURE_SIZES[kind];
    let best = -1;
    let bestArea = Infinity;
    decor.forEach((spot, index) => {
      if (plan.has(index) || !REPLACEABLE_DECOR.includes(spot.kind)) return;
      const size = decorSize(spot);
      if (size.width < need.width || size.depth < need.depth) return;
      const area = size.width * size.depth;
      if (area < bestArea) {
        best = index;
        bestArea = area;
      }
    });
    if (best >= 0) plan.set(best, kind);
  }
  return plan;
};

/** The signature prop standing on spot `index` of `decor` in a look, or null for the spot's own décor. */
export const signatureAt = (decor: readonly DecorSpot[], index: number, look: LookId): SignatureKind | null =>
  signaturePlan(decor, look).get(index) ?? null;

/** An orange extension lead snaking across the garage floor to a power strip: flat, so nobody trips. */
const createExtensionLead = (): PropHandle => {
  const kit = new PropKit("extension-lead");
  const mesh = kit.model("extension-lead", (b) => {
    const cable = C.orange;
    const path: Array<[number, number]> = [
      [-2.9, -0.2],
      [-2.2, 0.25],
      [-1.3, 0.05],
      [-0.5, 0.35],
      [0.4, 0.1],
      [1.2, 0.3],
      [1.9, 0.0],
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      b.tube([path[i][0], 0.02, path[i][1]], [path[i + 1][0], 0.02, path[i + 1][1]], 0.018, cable, { seg: 5 });
    }
    b.box(0.34, 0.05, 0.1, C.paper, 2.05, 0, -0.02, { r: 0.012, ry: 0.3 });
    b.box(0.26, 0.012, 0.05, C.charcoal, 2.05, 0.05, -0.02, { r: 0, ry: 0.3 });
  });
  mesh.castShadow = false;
  return kit.finish({ w: 5, d: 0.8 });
};

// ─────────────────────────────────────────────────────────────────────────────
// The scene of each office
// ─────────────────────────────────────────────────────────────────────────────

/** Placement vocabulary for a scene, in floor-plan coordinates. */
class Dresser {
  readonly kit: StageKit;
  readonly ground: GroundRect;
  readonly floor: StageKit["layout"]["floor"];

  constructor(kit: StageKit) {
    this.kit = kit;
    this.ground = groundRect(kit.layout);
    this.floor = kit.layout.floor;
  }

  /** Stand a prop on the floor or the ground outside. */
  put<T extends PropHandle>(prop: T, x: number, z: number, facing = 0): T {
    return this.kit.place(prop, { x, z, facing });
  }

  /** Lay something flat on the office floor (a rug, a cable): part of the building, it rises with the shell. */
  lay<T extends PropHandle>(prop: T, x: number, z: number, facing = 0): T {
    return this.kit.build(prop, { x, z, facing });
  }

  /**
   * Lay a road or a driveway on the ground outside. It sits at floor level rather
   * than down on the (slightly sunken) ground: the slab is then proud enough to
   * cover the lawn's flowers, and the sliver of air under it cannot be seen.
   */
  pave<T extends PropHandle>(prop: T, x: number, z: number, facing = 0): T {
    return this.kit.build(prop, { x, z, facing });
  }

  /** Hang a sign / poster / neon on the −Z wall: centred on `x`, bottom edge at height `y`. */
  hangBack<T extends PropHandle>(prop: T, x: number, y: number): T {
    return this.kit.place(prop, this.backWallSpot(x, y));
  }

  /** Hang a sign / poster / neon on the −X wall: centred on `z`, bottom edge at height `y`. */
  hangSide<T extends PropHandle>(prop: T, z: number, y: number): T {
    return this.kit.place(prop, this.sideWallSpot(z, y));
  }

  /** Stand a wall-hugging prop (origin at its footprint centre) against the −Z wall. */
  againstBack<T extends PropHandle>(prop: T, x: number): T {
    return this.kit.place(prop, { x, z: this.floor.minZ + WALL_GAP + prop.footprint.d / 2 });
  }

  /** Stand a wall-hugging prop against the −X wall. */
  againstSide<T extends PropHandle>(prop: T, z: number): T {
    return this.kit.place(prop, { x: this.floor.minX + WALL_GAP + prop.footprint.d / 2, z, facing: Math.PI / 2 });
  }

  backWallSpot(x: number, y: number): Spot {
    return { x, y, z: this.floor.minZ + 0.004 };
  }

  sideWallSpot(z: number, y: number): Spot {
    return { x: this.floor.minX + 0.004, y, z, facing: Math.PI / 2 };
  }
}

type Scene = (d: Dresser) => void;

/**
 * A suburban garage: tools on the wall, one bare bulb, an extension lead, the
 * driveway running out to a quiet street, lawn and a tree.
 */
const garageScene: Scene = (d) => {
  const { floor, ground } = d;
  const { door } = d.kit.layout;

  d.againstSide(createPegboard(), 0.15);
  d.put(createPendantLamp({ shade: C.galvanised, drop: 1.75 }), -2.1, -0.9);
  d.lay(createExtensionLead(), -1.0, 0.75);

  // Driveway from the roll-up door to the street, a car at the kerb.
  const roadWidth = 2.2;
  const roadX = ground.maxX - 0.14 - roadWidth / 2;
  const drivewayEnd = roadX - roadWidth / 2 - 0.14;
  d.pave(createDriveway(drivewayEnd - floor.maxX, 3.2), (floor.maxX + drivewayEnd) / 2, door.z);
  d.pave(createRoad(ground.maxZ - ground.minZ, { width: roadWidth }), roadX, (ground.minZ + ground.maxZ) / 2, Math.PI / 2);
  d.put(createParkedCar({ color: C.teal }), roadX + 0.1, -1.9);
  d.put(createBicycle({ color: C.red }), floor.maxX + 0.55, -0.55, 0.2);

  // Lawn.
  d.put(createTree(0), floor.minX - 0.3, floor.maxZ + 1.25);
  d.put(createBush(1), floor.minX + 1.6, floor.maxZ + 0.75, 0.2);
  d.put(createBush(0), floor.minX + 4.4, floor.maxZ + 0.7, -0.15);
  d.put(createBush(0), floor.maxX + 1.2, floor.minZ + 0.4, 0.4);
};

/**
 * A shared loft: brick, a neon greeting, a rug under the hot desks — and, past the
 * open +X side, the rest of the floor with other startups' desks. City outside.
 */
const sharedScene: Scene = (d) => {
  const { floor, ground } = d;
  const theme = themeFor(1, d.kit.look);

  d.lay(createRug(6.2, 3.6, { color: theme.accents[0], pattern: "border" }), 0.05, 0);
  // Above the coffee corner, clear of everything that hangs lower on that wall.
  d.kit.place(createNeonSign("hello", { color: NEON, height: 0.42 }), d.backWallSpot(4.35, 1.98));
  d.hangSide(createWallArt(0), 4.5, 1.15);
  d.put(createPendantLamp({ shade: theme.accents[1] }), -1.05, 0.15);
  d.put(createPendantLamp({ shade: theme.accents[2] }), 1.75, 0.15);

  // The neighbours: three plain desks, a shelf and a plant on their side of the loft.
  const annexX = floor.maxX + LOFT_ANNEX_WIDTH / 2;
  d.lay(createRug(1.9, 6.0, { color: C.bone, accent: C.grey, pattern: "border" }), annexX + 0.1, 1.6);
  [-0.6, 1.5, 3.6].forEach((z, i) => d.put(createGuestDesk(i), annexX + 0.15, z, -Math.PI / 2));
  d.put(createBookshelf(1, d.kit.look), annexX - 0.35, floor.minZ + WALL_GAP + 0.17);
  d.put(createPlant("large", { variant: 2 }), annexX + 0.75, floor.minZ + 0.6);
  d.put(createPlant("medium", { variant: 3 }), floor.maxX + 0.45, -2.0);

  // The street: a pavement, then the road.
  const roadWidth = 2.2;
  const roadZ = ground.maxZ - 0.14 - roadWidth / 2;
  d.pave(createRoad(ground.maxX - ground.minX, { width: roadWidth }), (ground.minX + ground.maxX) / 2, roadZ);
  d.put(createStreetLamp(), 6.6, floor.maxZ + 0.55, Math.PI);
  d.put(createBench(), -1.6, floor.maxZ + 0.5, Math.PI);
  d.put(createTree(1), floor.minX - 0.35, floor.maxZ + 0.55);
  d.put(createBicycle({ color: C.teal }), 2.4, floor.maxZ + 0.55, Math.PI / 2 + 0.1);
};

/** The company's own office: a sign on the wall, carpet, proper rooms. */
const ownScene: Scene = (d) => {
  const { floor } = d;

  d.kit.place(createSign("welcome", { height: 0.46, lit: true }), d.backWallSpot(6.0, 1.85));
  d.hangSide(createWallArt(2), -5.6, 1.2);

  d.put(createTree(0), floor.minX - 0.2, floor.maxZ + 1.3);
  d.put(createStreetLamp(), floor.maxX + 1.0, floor.maxZ + 1.0, Math.PI);
  d.put(createBench(), floor.maxX + 1.0, 2.0, -Math.PI / 2);
  d.put(createBush(0), floor.maxX + 0.9, -4.6);
  d.put(createBush(1), floor.maxX + 0.9, -2.9);
  d.put(createBush(0), floor.maxX + 0.9, 4.6);
};

/** A whole floor, and a flashy one: glass, plants everywhere, toys. */
const floorScene: Scene = (d) => {
  const { floor } = d;
  const theme = themeFor(3, d.kit.look);

  d.kit.place(createNeonSign("onwards", { color: theme.accents[2], height: 0.5 }), d.sideWallSpot(-1.35, 1.75));
  d.lay(createRug(4.4, 3.4, { color: theme.accents[0], pattern: "stripes" }), 8.35, 4.05);
  d.lay(createRug(3.4, 2.6, { color: theme.accents[1], pattern: "border" }), -1.2, 6.4);
  d.lay(createRug(2.2, 1.5, { color: theme.accents[2], pattern: "plain" }), 4.3, 6.0);

  // Trees only where their crowns hang over nothing but pavement: off the back corners.
  d.put(createTree(1), floor.minX - 0.3, floor.maxZ + 1.2);
  d.put(createTree(0), floor.maxX + 1.1, floor.minZ - 0.6);
  d.put(createBush(0), floor.maxX + 1.0, -6.4);
  d.put(createBush(1), floor.maxX + 1.0, 3.6);
  d.put(createStreetLamp(), floor.maxX + 1.1, floor.maxZ + 1.0, Math.PI);
  d.put(createBench(), 5.0, floor.maxZ + 0.9, Math.PI);
  d.put(createBush(1), 2.6, floor.maxZ + 0.8);
  d.put(createBush(0), 7.2, floor.maxZ + 0.8);
};

/** The campus: marble, brass, a ticker, trophies, and a skyline behind the walls. */
const campusScene: Scene = (d) => {
  const { floor } = d;

  d.kit.place(createSign("HQ", { height: 0.5, background: C.marble, color: C.brass, lit: true }), d.backWallSpot(11.6, 1.55));
  // A ticker above the calendar: set dressing, the same made-up prices whatever the company does.
  d.put(createStockTicker(), 0.2, floor.minZ + 0.32);
  d.lay(createRug(2.2, 2.4, { color: C.burgundy, accent: C.brass, pattern: "border" }), 10.5, 7.9);
  d.hangSide(createWallArt(3), -0.6, 1.25);

  // Skyline hints: towers close behind the back walls, which hide where they meet the ground.
  d.put(createBackgroundBuilding(0, { scale: 0.56 }), -8.2, floor.minZ - 1.5);
  d.put(createBackgroundBuilding(1, { scale: 0.6 }), 1.6, floor.minZ - 1.6);
  d.put(createBackgroundBuilding(3, { scale: 0.8 }), 9.6, floor.minZ - 2.0);
  d.put(createBackgroundBuilding(1, { scale: 0.5 }), floor.minX - 1.5, -5.4, Math.PI / 2);
  d.put(createBackgroundBuilding(0, { scale: 0.48 }), floor.minX - 1.4, 2.4, Math.PI / 2);

  d.put(createStreetLamp(), floor.maxX + 1.1, floor.maxZ + 1.0, Math.PI);
  d.put(createTree(2), floor.maxX + 1.1, floor.minZ - 0.6);
  d.put(createTree(2), floor.minX - 0.5, floor.maxZ + 1.1);
  d.put(createBush(0), floor.maxX + 1.0, -7.0);
  d.put(createBush(0), floor.maxX + 1.0, 5.2);
  d.put(createBench(), 4.6, floor.maxZ + 0.9, Math.PI);
};

/** By office: the garage, the shared office, the company's own office, the full floor, the campus. */
const SCENES: readonly Scene[] = [garageScene, sharedScene, ownScene, floorScene, campusScene];

/** Dress the office that `kit` is building: floor-plan décor first, then the office's scene. */
export const dressOffice = (kit: StageKit): void => {
  const decor = getLayoutDecor(kit.layout);
  const signatures = signaturePlan(decor, kit.look);
  decor.forEach((spot, index) => {
    const signature = signatures.get(index);
    kit.place(signature === undefined ? createDecorProp(kit.office, spot, kit.look) : createSignatureProp(signature, decorSize(spot), spot.variant), spot);
  });
  SCENES[phaseTier(kit.office)](new Dresser(kit));
};
