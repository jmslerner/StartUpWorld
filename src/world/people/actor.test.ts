import { describe, expect, it } from "vitest";
import {
  deskFootprint,
  doorExterior,
  findPath,
  footprintContains,
  forwardOf,
  makeFootprint,
  getLayoutObstacles,
  getOfficeLayout,
  pathLength,
} from "../office/layouts";
import type { CastMember } from "../cast";
import type { BubbleIcon, OfficeIndex, OfficeLayout, Placement, Seat, SeatKind } from "../types";
import { Actor, CHAIR_SECONDS, HURRY_FACTOR, MAX_WALK_SECONDS, POP_SECONDS, RISE_SECONDS, walkSpeedFor, WALK_SPEED } from "./actor";
import { chairApproach } from "./approach";
import type { ActorStage, ErrandLeg } from "./actor";

const DT = 1 / 60;

const person = (id = "p0", look = 4242): CastMember => ({ id, standing: "working", team: "product", look });

const seatAt = (placement: Placement, kind: SeatKind = "desk", index = 0): Seat => ({
  x: placement.x,
  z: placement.z,
  facing: placement.facing,
  kind,
  index,
});

class TestStage implements ActorStage {
  layout: OfficeLayout;
  readonly bubbles: Array<{ icon: BubbleIcon; seconds: number | undefined }> = [];
  settledCount = 0;

  constructor(layout: OfficeLayout) {
    this.layout = layout;
  }

  bubble(_actor: Actor, icon: BubbleIcon, seconds?: number): void {
    this.bubbles.push({ icon, seconds });
  }

  settled(): void {
    this.settledCount += 1;
  }
}

/** Step until `done` (or the limit); returns the seconds that took. */
const runUntil = (actor: Actor, stage: ActorStage, done: () => boolean, limit = 120, each?: () => void): number => {
  let time = 0;
  while (time < limit) {
    actor.update(DT, stage);
    time += DT;
    each?.();
    if (done()) return time;
  }
  return Infinity;
};

const run = (actor: Actor, stage: ActorStage, seconds: number, each?: () => void): void => {
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    actor.update(DT, stage);
    each?.();
  }
};

const OFFICES: readonly OfficeIndex[] = [0, 1, 2, 3, 4];
const layout = getOfficeLayout(1);
const desk = (slot: number): Seat => seatAt(layout.deskSeats[slot], "desk", slot);
const doorSpot = (slot: number): Seat => seatAt(layout.waitingSpots[slot], "waiting", slot);
const exterior = doorExterior(layout, 0.8);

const expectAtSeat = (actor: Actor, seat: Seat): void => {
  expect(actor.mode).toBe("seated");
  expect(actor.x).toBe(seat.x);
  expect(actor.z).toBe(seat.z);
  expect(actor.facing).toBeCloseTo(Math.atan2(Math.sin(seat.facing), Math.cos(seat.facing)));
};

describe("Actor at rest", () => {
  it("starts in the seat, visible and typing", () => {
    const actor = new Actor(person(), desk(2));
    expectAtSeat(actor, desk(2));
    expect([actor.pose, actor.poseSeated, actor.visible, actor.scale]).toEqual(["type", true, true, 1]);
    expect(actor.seatedIdle).toBe(true);
    expect(actor.away).toBe(false);
    expect(actor.busy).toBe(false);
  });

  it("stands at a spot by the door", () => {
    const actor = new Actor(person(), doorSpot(0));
    expectAtSeat(actor, doorSpot(0));
    expect([actor.pose, actor.poseSeated, actor.chairOut, actor.busy]).toEqual(["stand", false, 0, false]);
  });

  it("holds the box while standing at the door once they have packed", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), doorSpot(0));
    expect(actor.carrying).toBe(false);
    actor.packed = true;
    actor.update(DT, stage);
    expect([actor.pose, actor.carrying]).toEqual(["stand", true]);
    actor.packed = false;
    actor.resolvePose();
    expect(actor.carrying).toBe(false);
  });
});

describe("Actor arriving", () => {
  it("waits out of sight, waves as it appears, walks in and sits down facing the desk", () => {
    const stage = new TestStage(layout);
    const seat = desk(5);
    const actor = new Actor(person(), seat);
    actor.enterFrom(exterior, layout.door.facing, 0.7, true);
    expect(actor.visible).toBe(false);
    expect(actor.mode).toBe("waiting");
    run(actor, stage, 0.6);
    expect(actor.visible).toBe(false);
    expect(stage.bubbles).toHaveLength(0);

    run(actor, stage, 0.2);
    expect(actor.visible).toBe(true);
    expect(actor.mode).toBe("walking");
    expect(actor.pose).toBe("walk");
    expect(stage.bubbles.map((bubble) => bubble.icon)).toEqual(["wave"]);
    expect(actor.scale).toBeLessThan(1);

    const seconds = runUntil(actor, stage, () => actor.mode === "seated");
    const ideal = pathLength(exterior, findPath(layout, exterior, seat)) / WALK_SPEED;
    expect(seconds).toBeGreaterThan(ideal * 0.95);
    expect(seconds).toBeLessThan(ideal * 1.35 + 1);
    expectAtSeat(actor, seat);
    expect(actor.pose).toBe("type");
    expect(actor.scale).toBe(1);
    expect(stage.settledCount).toBe(1);
  });

  it("walks at walking pace with the walk cycle driven by the real ground speed", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(7));
    actor.enterFrom(exterior, layout.door.facing, 0, false);
    let fastest = 0;
    runUntil(
      actor,
      stage,
      () => actor.mode === "seated",
      60,
      () => {
        fastest = Math.max(fastest, actor.walkSpeed);
      }
    );
    expect(fastest).toBeCloseTo(WALK_SPEED, 5);
    expect(actor.walkSpeed).toBe(0);
  });

  it.each(OFFICES)(
    "goes round the furniture in office %i: never through a desk or a station on the way to any seat",
    (office) => {
      const plan = getOfficeLayout(office);
      const stage = new TestStage(plan);
      const outside = doorExterior(plan, 0.8);
      const solid = getLayoutObstacles(plan).filter((obstacle) => obstacle.kind === "desk" || obstacle.kind === "station");
      const seats: Seat[] = [
        ...plan.deskSeats.map((placement, slot) => seatAt(placement, "desk", slot)),
        ...plan.waitingSpots.map((placement, slot) => seatAt(placement, "waiting", slot)),
      ];
      seats.forEach((seat, index) => {
        const own = deskFootprint(seat);
        const actor = new Actor(person(`p${index}`, 100 + index), seat);
        actor.enterFrom(outside, plan.door.facing, 0, false);
        let hits = 0;
        const seconds = runUntil(
          actor,
          stage,
          () => actor.mode === "seated",
          90,
          () => {
            for (const obstacle of solid) {
              // Their own desk is the one they sit at; the chair is tucked right up to it.
              if (obstacle.kind === "desk" && obstacle.x === own.x && obstacle.z === own.z) continue;
              if (footprintContains(obstacle, actor.x, actor.z)) hits += 1;
            }
          }
        );
        expect(Number.isFinite(seconds), `${seat.kind} ${seat.index}`).toBe(true);
        expect(hits, `${seat.kind} ${seat.index}`).toBe(0);
        expect([actor.x, actor.z]).toEqual([seat.x, seat.z]);
      });
    }
  );

  it("pops in at the seat with a scale-in when there is no walk to do", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(1));
    actor.popInAtHome(0.3);
    expect(actor.visible).toBe(false);
    expect(actor.present).toBe(true);
    run(actor, stage, 0.25);
    expect(actor.visible).toBe(false);
    run(actor, stage, 0.1);
    expect(actor.visible).toBe(true);
    expect(actor.scale).toBeGreaterThan(0);
    expect(actor.scale).not.toBe(1);
    expect(actor.seatedIdle).toBe(false);
    run(actor, stage, POP_SECONDS + 0.05);
    expect(actor.scale).toBe(1);
    expectAtSeat(actor, desk(1));
    expect(actor.seatedIdle).toBe(true);
    expect(stage.settledCount).toBe(0);
  });
});

describe("Actor walking a long way", () => {
  const campus = getOfficeLayout(4);
  const campusDoor = doorExterior(campus, 0.8);

  /** Seconds spent walking (not rising, settling or vanishing) until `done`, and the fastest ground speed. */
  const walkOf = (actor: Actor, stage: ActorStage, done: () => boolean): { walking: number; fastest: number } => {
    let walking = 0;
    let fastest = 0;
    runUntil(actor, stage, done, 120, () => {
      if (actor.mode === "walking") walking += DT;
      fastest = Math.max(fastest, actor.walkSpeed);
    });
    return { walking, fastest };
  };

  it("hurries a walk only as much as it takes to last at most nine seconds", () => {
    expect(MAX_WALK_SECONDS).toBe(9);
    expect(walkSpeedFor(0)).toBe(WALK_SPEED);
    expect(walkSpeedFor(WALK_SPEED * 8)).toBe(WALK_SPEED);
    // Raised in proportion beyond that: twice as far, twice as fast, with half a second kept for the corners.
    expect(walkSpeedFor(34)).toBeCloseTo(4, 10);
    expect(walkSpeedFor(68)).toBeCloseTo(2 * walkSpeedFor(34), 10);
    expect(walkSpeedFor(Number.NaN)).toBe(WALK_SPEED);
  });

  it("walks out of the campus from any desk, the farthest included, in nine seconds at most", () => {
    let longest = 0;
    let longestWalk = 0;
    campus.deskSeats.forEach((placement, index) => {
      const stage = new TestStage(campus);
      const actor = new Actor(person(), seatAt(placement, "desk", index));
      actor.leave(campusDoor, 0, true);
      const { walking } = walkOf(actor, stage, () => actor.gone);
      longest = Math.max(longest, walking);
      longestWalk = Math.max(longestWalk, pathLength(placement, findPath(campus, placement, campusDoor)));
    });
    // The farthest desk is a long way from the door: at the usual pace it would take far longer.
    expect(longestWalk / WALK_SPEED).toBeGreaterThan(12);
    expect(longest).toBeLessThanOrEqual(MAX_WALK_SECONDS);
  });

  it("walks in through the campus door to any desk in nine seconds at most", () => {
    let longest = 0;
    campus.deskSeats.forEach((placement, index) => {
      const stage = new TestStage(campus);
      const actor = new Actor(person(), seatAt(placement, "desk", index));
      actor.enterFrom(campusDoor, campus.door.facing, 0, false);
      longest = Math.max(longest, walkOf(actor, stage, () => actor.mode === "seated").walking);
    });
    expect(longest).toBeLessThanOrEqual(MAX_WALK_SECONDS);
  });

  it("walks from a spot at the door to a far desk in nine seconds at most", () => {
    const stage = new TestStage(campus);
    const far = campus.deskSeats.reduce((best, seat) => (Math.hypot(seat.x - campusDoor.x, seat.z - campusDoor.z) > Math.hypot(best.x - campusDoor.x, best.z - campusDoor.z) ? seat : best));
    const actor = new Actor(person(), seatAt(campus.waitingSpots[0], "waiting", 0));
    actor.rehome(seatAt(far, "desk", campus.deskSeats.indexOf(far)), stage);
    const { walking, fastest } = walkOf(actor, stage, () => actor.mode === "seated");
    expect(fastest).toBeGreaterThan(WALK_SPEED);
    expect(walking).toBeLessThanOrEqual(MAX_WALK_SECONDS);
  });

  it("keeps the usual pace on a short walk, and on a wander however long", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(7));
    actor.enterFrom(exterior, layout.door.facing, 0, false);
    expect(walkOf(actor, stage, () => actor.mode === "seated").fastest).toBeCloseTo(WALK_SPEED, 5);

    const campusStage = new TestStage(campus);
    const far = campus.deskSeats.reduce((best, seat) => (seat.x - seat.z > best.x - best.z ? seat : best));
    const spot = campus.deskSeats.reduce((best, seat) => (seat.x - seat.z < best.x - best.z ? seat : best));
    const wanderer = new Actor(person(), seatAt(far, "desk", campus.deskSeats.indexOf(far)));
    expect(pathLength(far, findPath(campus, far, spot)) / WALK_SPEED).toBeGreaterThan(MAX_WALK_SECONDS);
    wanderer.runErrand("wander", [{ x: spot.x, z: spot.z + 0.9, facing: null, pause: 0.5, bubble: null }], campusStage);
    expect(walkOf(wanderer, campusStage, () => wanderer.mode === "seated").fastest).toBeCloseTo(WALK_SPEED, 5);
  });
});

describe("Actor and their chair", () => {
  // The chair at a seat when it is rolled `out` (0 … 1) of the way, as the office draws it (DeskSlots: CHAIR_PULL 0.5).
  const chairAt = (seat: Placement, out: number) => {
    const forward = forwardOf(seat.facing);
    return makeFootprint(
      { x: seat.x - forward.x * 0.5 * out, z: seat.z - forward.z * 0.5 * out },
      { width: 0.5, depth: 0.5 },
      seat.facing
    );
  };

  it("walks in and out beside the chair, never through it, in every office", () => {
    for (const phase of OFFICES) {
      const plan = getOfficeLayout(phase);
      const stage = new TestStage(plan);
      const seats = plan.deskSeats.map((seat, i) => seatAt(seat, "desk", i));
      for (const seat of seats) {
        expect(chairApproach(plan, seat, doorExterior(plan, 0.8)), `${phase} ${seat.index}`).not.toBeNull();
        const actor = new Actor(person(), seat);
        actor.enterFrom(doorExterior(plan, 0.8), plan.door.facing, 0, false);
        let through = 0;
        runUntil(actor, stage, () => actor.mode === "seated", 60, () => {
          if (actor.mode !== "walking" && actor.mode !== "settling") return;
          // A standing body (about 0.36 across) must stay clear of the chair wherever it is.
          if (footprintContains(chairAt(seat, actor.chairOut), actor.x, actor.z, 0.12)) through += 1;
        });
        expect(actor.mode, `${phase} ${seat.index}`).toBe("seated");
        expect(through, `${phase} seat ${seat.index}`).toBe(0);
        // …and out again the same way.
        run(actor, stage, CHAIR_SECONDS);
        actor.leave(doorExterior(plan, 0.8), 0, true);
        runUntil(actor, stage, () => actor.gone, 60, () => {
          if (actor.mode === "walking" && footprintContains(chairAt(seat, actor.chairOut), actor.x, actor.z, 0.12)) through += 1;
        });
        expect(actor.gone).toBe(true);
        expect(through, `${phase} seat ${seat.index}, leaving`).toBe(0);
      }
    }
  });

  it("rolls the chair back before standing up, and in under them as they sit", () => {
    const stage = new TestStage(layout);
    const seat = desk(3);
    const actor = new Actor(person(), seat);
    expect(actor.chairOut).toBe(0);
    actor.runErrand("wander", [{ x: layout.stationStandSpots.coffee.x, z: layout.stationStandSpots.coffee.z, facing: null, pause: 1, bubble: null }], stage);
    // Still seated while the chair is on its way back.
    run(actor, stage, 0.1);
    expect(actor.poseSeated).toBe(true);
    expect(actor.chairOut).toBeGreaterThan(0.2);
    run(actor, stage, RISE_SECONDS);
    expect(actor.mode).toBe("walking");
    expect(actor.chairOut).toBe(1);
    // Once they are clear of it the chair goes back to the desk; it rolls out again as they come back.
    runUntil(actor, stage, () => actor.mode === "pausing");
    expect(actor.chairOut).toBe(0);
    runUntil(actor, stage, () => actor.mode === "seated");
    expect(actor.chairOut).toBeGreaterThan(0.5);
    run(actor, stage, CHAIR_SECONDS + 0.05);
    expect(actor.chairOut).toBe(0);
    expectAtSeat(actor, seat);
  });


  it("has no chair to move at the door", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), doorSpot(0));
    actor.runErrand("wander", [{ x: layout.stationStandSpots.coffee.x, z: layout.stationStandSpots.coffee.z, facing: null, pause: 1, bubble: null }], stage);
    run(actor, stage, 1);
    expect(actor.chairOut).toBe(0);
  });
});

describe("Actor on an errand", () => {
  const stop = layout.stationStandSpots.coffee;
  const coffee: ErrandLeg = { x: stop.x, z: stop.z, facing: stop.facing, pause: 1.5, bubble: "coffee" };

  it("stands up, walks there, pauses with a bubble, walks back and sits", () => {
    const stage = new TestStage(layout);
    const seat = desk(3);
    const actor = new Actor(person(), seat);
    actor.runErrand("wander", [coffee], stage);
    expect(actor.mode).toBe("rising");
    expect(actor.errand).toBe("wander");
    // Still sitting while the chair rolls back, then on their feet.
    actor.update(DT, stage);
    expect(actor.poseSeated).toBe(true);
    expect(actor.chairOut).toBeGreaterThan(0);
    run(actor, stage, RISE_SECONDS / 2);
    expect(actor.pose).toBe("stand");
    run(actor, stage, RISE_SECONDS / 2);
    expect(actor.mode).toBe("walking");

    const there = runUntil(actor, stage, () => actor.mode === "pausing");
    expect(Number.isFinite(there)).toBe(true);
    expect(actor.x).toBe(stop.x);
    expect(actor.z).toBe(stop.z);
    expect(stage.bubbles.map((bubble) => bubble.icon)).toEqual(["coffee"]);
    expect(actor.errandStop).toBe(coffee);

    run(actor, stage, 1);
    expect(actor.mode).toBe("pausing");
    expect(actor.pose).toBe("stand");
    // Turned to face the machine while standing there.
    expect(Math.cos(actor.facing - stop.facing)).toBeCloseTo(1, 3);

    const back = runUntil(actor, stage, () => actor.mode === "seated");
    expect(Number.isFinite(back)).toBe(true);
    expectAtSeat(actor, seat);
    expect(actor.errand).toBeNull();
    expect(actor.errandStop).toBeNull();
    // Coming back from the coffee machine is not worth a puff of dust.
    expect(stage.settledCount).toBe(0);
  });

  it("visits several stops in order", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(4));
    const a = layout.wanderSpots[0];
    const b = layout.wanderSpots[1];
    const visited: string[] = [];
    actor.runErrand(
      "wander",
      [
        { x: a.x, z: a.z, facing: null, pause: 0.3, bubble: "stress" },
        { x: b.x, z: b.z, facing: null, pause: 0.3, bubble: null },
      ],
      stage
    );
    runUntil(
      actor,
      stage,
      () => actor.mode === "seated",
      120,
      () => {
        if (actor.mode !== "pausing") return;
        const label = actor.x === a.x && actor.z === a.z ? "a" : actor.x === b.x && actor.z === b.z ? "b" : "?";
        if (visited[visited.length - 1] !== label) visited.push(label);
      }
    );
    expect(visited).toEqual(["a", "b"]);
    expect(actor.mode).toBe("seated");
  });

  it("cannot be stranded by an absurdly long pause either", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(0));
    actor.runErrand("wander", [{ ...coffee, pause: 1000 }], stage);
    runUntil(actor, stage, () => actor.mode === "pausing");
    const seconds = runUntil(actor, stage, () => actor.mode === "seated", 200);
    expect(seconds).toBeLessThan(60);
    expectAtSeat(actor, desk(0));
  });

  it("hurries home and is snapped there when time is up", () => {
    const stage = new TestStage(layout);
    const seat = desk(6);
    const actor = new Actor(person(), seat);
    actor.runErrand("wander", [coffee], stage);
    runUntil(actor, stage, () => actor.mode === "pausing");
    actor.hurry(0.7, stage);
    actor.update(DT, stage);
    expect(actor.mode).toBe("walking");
    run(actor, stage, 0.3);
    expect(actor.walkSpeed).toBeCloseTo(WALK_SPEED * HURRY_FACTOR, 5);
    const teleports = actor.teleports;
    run(actor, stage, 0.5);
    expectAtSeat(actor, seat);
    expect(actor.teleports).toBeGreaterThan(teleports);
    expect(actor.errand).toBeNull();
  });

  it("ignores hurry when already sitting", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(0));
    const teleports = actor.teleports;
    actor.hurry(0.5, stage);
    run(actor, stage, 1);
    expect(actor.teleports).toBe(teleports);
    expect(actor.seatedIdle).toBe(true);
  });
});

describe("Actor changing seats", () => {
  it("walks from the old seat to the new one", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), doorSpot(0));
    actor.rehome(desk(4), stage);
    expect(actor.mode).toBe("rising");
    const seconds = runUntil(actor, stage, () => actor.mode === "seated");
    expect(seconds).toBeGreaterThan(0.5);
    expectAtSeat(actor, desk(4));
    expect(actor.pose).toBe("type");
    expect(stage.settledCount).toBe(1);
  });

  it("does nothing when the new seat is the same place", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(4));
    actor.rehome(desk(4), stage);
    expect(actor.mode).toBe("seated");
  });

  it("re-routes when the seat changes mid-walk", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(0));
    actor.enterFrom(exterior, layout.door.facing, 0, false);
    run(actor, stage, 1.2);
    expect(actor.mode).toBe("walking");
    const { x, z } = actor;
    actor.rehome(desk(7), stage);
    // No jump: the new route starts from where they are.
    expect([actor.x, actor.z]).toEqual([x, z]);
    runUntil(actor, stage, () => actor.mode === "seated");
    expectAtSeat(actor, desk(7));
  });

  it("comes back to the new seat when it changes during an errand", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(0));
    const stop = layout.wanderSpots[0];
    actor.runErrand("wander", [{ x: stop.x, z: stop.z, facing: stop.facing, pause: 0.5, bubble: null }], stage);
    runUntil(actor, stage, () => actor.mode === "pausing");
    actor.rehome(desk(3), stage);
    expect(actor.mode).toBe("pausing");
    runUntil(actor, stage, () => actor.mode === "seated");
    expectAtSeat(actor, desk(3));
  });

  it("still pops in where it was due to when the seat changes before the pop, then walks over to the new seat", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), doorSpot(0));
    actor.popInAtHome(0.5);
    actor.rehome(desk(4), stage);
    run(actor, stage, 0.5 + DT);
    expect(actor.visible).toBe(true);
    expect([actor.x, actor.z]).toEqual([doorSpot(0).x, doorSpot(0).z]);
    let walked = false;
    runUntil(actor, stage, () => actor.mode === "seated" && actor.x === desk(4).x, 120, () => {
      if (actor.mode === "walking") walked = true;
    });
    expect(walked).toBe(true);
    expectAtSeat(actor, desk(4));
    expect(stage.settledCount).toBe(1);
  });

  it("relocates by vanishing and popping in at the new seat", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(0));
    actor.runErrand("wander", [{ x: 0, z: 0, facing: null, pause: 1, bubble: null }], stage);
    run(actor, stage, 1);
    const office = getOfficeLayout(2);
    stage.layout = office;
    const seat = seatAt(office.deskSeats[9], "desk", 9);
    actor.relocate(seat, 0.4);
    expect(actor.visible).toBe(false);
    expect(actor.errand).toBeNull();
    run(actor, stage, 0.4 + POP_SECONDS + 0.1);
    expect(actor.visible).toBe(true);
    expectAtSeat(actor, seat);
  });
});

describe("Actor leaving", () => {
  it("carries on until the delay is up, then stands, walks out with a box and is gone", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(2));
    actor.leave(exterior, 0.5, true);
    expect(actor.leaving).toBe(true);
    expect(actor.seatedIdle).toBe(false);
    run(actor, stage, 0.4);
    expect(actor.mode).toBe("seated");
    expect(actor.carrying).toBe(false);
    run(actor, stage, 0.2);
    expect(actor.mode).toBe("rising");
    expect(actor.carrying).toBe(true);

    let sawWalk = false;
    const seconds = runUntil(
      actor,
      stage,
      () => actor.gone,
      60,
      () => {
        if (actor.mode === "walking") sawWalk = true;
        // Once on the way out there is no going back to the desk.
        expect(actor.mode).not.toBe("seated");
      }
    );
    expect(sawWalk).toBe(true);
    expect(Number.isFinite(seconds)).toBe(true);
    expect(actor.visible).toBe(false);
  });

  it("shrinks away at the door rather than blinking out", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(2));
    actor.leave(exterior, 0, false);
    runUntil(actor, stage, () => actor.mode === "vanishing");
    expect(Math.hypot(actor.x - exterior.x, actor.z - exterior.z)).toBeLessThan(1e-9);
    const scales: number[] = [];
    runUntil(
      actor,
      stage,
      () => actor.gone,
      5,
      () => scales.push(actor.scale)
    );
    expect(scales.length).toBeGreaterThan(5);
    expect(scales[0]).toBeGreaterThan(scales[scales.length - 2]);
  });

  it("leaves from wherever it is when the delay runs out mid-errand", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(2));
    const stop = layout.stationStandSpots.coffee;
    actor.runErrand("wander", [{ x: stop.x, z: stop.z, facing: null, pause: 30, bubble: null }], stage);
    runUntil(actor, stage, () => actor.mode === "pausing");
    actor.leave(exterior, 0.2, true);
    run(actor, stage, 0.3);
    expect(actor.mode).toBe("walking");
    expect(actor.goal).toBe("exit");
    expect(Number.isFinite(runUntil(actor, stage, () => actor.gone, 60))).toBe(true);
  });

  it("keeps its exit when it has to be snapped home first", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(2));
    const stop = layout.stationStandSpots.coffee;
    actor.runErrand("wander", [{ x: stop.x, z: stop.z, facing: null, pause: 30, bubble: null }], stage);
    runUntil(actor, stage, () => actor.mode === "pausing");
    actor.hurry(0.3, stage);
    actor.leave(exterior, 2, true);
    run(actor, stage, 0.5);
    expect(actor.mode).toBe("seated");
    expect(actor.leaving).toBe(true);
    expect(Number.isFinite(runUntil(actor, stage, () => actor.gone, 60))).toBe(true);
  });

  it("is simply gone if it never made it on stage", () => {
    const actor = new Actor(person(), desk(2));
    actor.enterFrom(exterior, 0, 5, true);
    actor.leave(exterior, 1, true);
    expect(actor.gone).toBe(true);
  });

  it("a hurried leaver is gone by the deadline", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(7));
    actor.leave(exterior, 0, true);
    run(actor, stage, 0.6);
    expect(actor.mode).toBe("walking");
    actor.hurry(0.5, stage);
    run(actor, stage, 0.6);
    expect(actor.gone).toBe(true);
  });

  it("vanish() shrinks on the spot and never walks", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(7));
    actor.vanish();
    const { x, z, pose } = actor;
    const seconds = runUntil(
      actor,
      stage,
      () => actor.gone,
      5,
      () => expect([actor.x, actor.z, actor.pose]).toEqual([x, z, pose])
    );
    expect(seconds).toBeLessThan(0.5);
  });

  it("ignores errands and seat moves once leaving", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(7));
    actor.leave(exterior, 0, true);
    run(actor, stage, 0.6);
    actor.runErrand("wander", [{ x: 0, z: 0, facing: null, pause: 1, bubble: null }], stage);
    actor.rehome(desk(0), stage);
    actor.update(DT, stage);
    expect(actor.goal).toBe("exit");
    expect(actor.pose).toBe("walk");
    expect(Number.isFinite(runUntil(actor, stage, () => actor.gone, 60))).toBe(true);
  });
});

describe("Actor robustness", () => {
  it("survives zero-length frames and a layout swap mid-walk", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(0));
    actor.enterFrom(exterior, layout.door.facing, 0, false);
    for (let i = 0; i < 10; i += 1) actor.update(0, stage);
    run(actor, stage, 0.8);
    // Another layout object with the same furniture.
    stage.layout = { ...layout };
    runUntil(actor, stage, () => actor.mode === "seated");
    expectAtSeat(actor, desk(0));
    expect(Number.isFinite(actor.x + actor.z + actor.facing)).toBe(true);
  });

});

describe("Actor coming to rest", () => {
  const stop = layout.stationStandSpots.coffee;
  const coffee: ErrandLeg = { x: stop.x, z: stop.z, facing: stop.facing, pause: 1.5, bubble: null };

  it("is busy from the moment it is told to walk in until the chair has rolled in under it", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(5));
    actor.enterFrom(exterior, layout.door.facing, 0.5, false);
    // Waiting for its turn at the door counts: a staggered arrival must not be cut off by a resting loop.
    expect([actor.mode, actor.busy]).toEqual(["waiting", true]);
    const seconds = runUntil(actor, stage, () => !actor.busy, 120, () => {
      if (actor.mode !== "seated") expect(actor.busy).toBe(true);
    });
    expect(Number.isFinite(seconds)).toBe(true);
    expectAtSeat(actor, desk(5));
    expect(actor.chairOut).toBe(0);
    // And it stays at rest for as long as nothing is asked of it.
    run(actor, stage, 30, () => expect(actor.busy).toBe(false));
  });

  it("is busy through an errand, a seat change and a pop-in, and at rest after each", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(0));
    actor.runErrand("wander", [coffee], stage);
    expect(actor.busy).toBe(true);
    expect(Number.isFinite(runUntil(actor, stage, () => !actor.busy))).toBe(true);
    actor.rehome(desk(7), stage);
    expect(actor.busy).toBe(true);
    expect(Number.isFinite(runUntil(actor, stage, () => !actor.busy))).toBe(true);
    expectAtSeat(actor, desk(7));
    actor.rehome(doorSpot(0), stage);
    expect(Number.isFinite(runUntil(actor, stage, () => !actor.busy))).toBe(true);
    expectAtSeat(actor, doorSpot(0));
    actor.relocate(desk(2), 0.4);
    expect(actor.busy).toBe(true);
    expect(runUntil(actor, stage, () => !actor.busy)).toBeLessThan(0.4 + POP_SECONDS + 0.1);
  });

  it("is busy until it is gone, and never after", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(3));
    actor.leave(exterior, 1, true);
    // The exit that has not started yet counts too.
    expect([actor.mode, actor.busy]).toEqual(["seated", true]);
    expect(Number.isFinite(runUntil(actor, stage, () => !actor.busy))).toBe(true);
    expect(actor.gone).toBe(true);
    const gone = new Actor(person(), desk(3));
    gone.vanish();
    expect(runUntil(gone, stage, () => !gone.busy)).toBeLessThan(1);
    expect(gone.gone).toBe(true);
  });

  it("comes to rest when the watchdog has to rescue a walk", () => {
    // A stage whose door never clears and whose queue never moves: only the watchdogs can end this.
    class Jammed extends TestStage {
      holdArrival(): boolean {
        return true;
      }
      holdExit(): boolean {
        return true;
      }
      queueBehind(): boolean {
        return true;
      }
    }
    const stage = new Jammed(layout);
    const arriving = new Actor(person("p1"), desk(1));
    arriving.enterFrom(exterior, layout.door.facing, 0, false);
    expect(Number.isFinite(runUntil(arriving, stage, () => !arriving.busy, 200))).toBe(true);
    expectAtSeat(arriving, desk(1));
    const leaving = new Actor(person("p2"), desk(2));
    leaving.leave(exterior, 0, true);
    expect(Number.isFinite(runUntil(leaving, stage, () => !leaving.busy, 200))).toBe(true);
    expect(leaving.gone).toBe(true);

    // A pause that would last for ever is cut short by the trip limit.
    const stuck = new Actor(person("p3"), desk(3));
    stuck.runErrand("wander", [{ ...coffee, pause: 1e9 }], stage);
    expect(runUntil(stuck, stage, () => !stuck.busy, 200)).toBeLessThan(60);
    expectAtSeat(stuck, desk(3));
  });
});
