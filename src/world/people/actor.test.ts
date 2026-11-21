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
import type { BubbleIcon, OfficeLayout, PersonView, Placement, Seat, SeatKind } from "../types";
import { Actor, CELEBRATE_SETTLE, CHAIR_SECONDS, HURRY_FACTOR, POP_SECONDS, RISE_SECONDS, WALK_SPEED } from "./actor";
import { chairApproach } from "./approach";
import type { ActorStage, ErrandLeg } from "./actor";

const DT = 1 / 60;

const person = (id = "engineering-0", look = 4242): PersonView => ({
  id,
  kind: id === "founder" ? "founder" : "employee",
  role: id === "founder" ? null : "engineering",
  name: "Ada Test",
  look,
});

const seatAt = (placement: Placement, kind: SeatKind = "desk", slotIndex = 0): Seat => ({
  x: placement.x,
  z: placement.z,
  facing: placement.facing,
  kind,
  slotIndex,
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

const layout = getOfficeLayout("coworking");
const desk = (slot: number): Seat => seatAt(layout.deskSeats[slot], "desk", slot);
const beanbag = (slot: number): Seat => seatAt(layout.overflowSpots[slot], "overflow", slot);
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
  });

  it("uses the floor pose on a beanbag", () => {
    const actor = new Actor(person(), beanbag(0));
    expect([actor.pose, actor.poseSeated]).toEqual(["floor-sit", false]);
  });

  it("shows the routine and the mood in the pose", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(0));
    actor.routine = "wait";
    actor.update(DT, stage);
    expect(actor.pose).toBe("sit");
    actor.routine = "defeat";
    actor.update(DT, stage);
    expect(actor.pose).toBe("slump");
    actor.routine = "work";
    actor.mood = "sleep";
    actor.update(DT, stage);
    expect(actor.pose).toBe("sleep");
    actor.mood = "slump";
    actor.update(DT, stage);
    expect(actor.pose).toBe("slump");
  });

  it("cheers in waves when the run is won, then calms down to the odd cheer without ever stopping", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(0));
    actor.routine = "celebrate";
    const share = (seconds: number): number => {
      let cheering = 0;
      let frames = 0;
      run(actor, stage, seconds, () => {
        frames += 1;
        if (actor.pose === "cheer") cheering += 1;
      });
      return cheering / frames;
    };
    const party = share(CELEBRATE_SETTLE - 1);
    expect(party).toBeGreaterThan(0.5);
    expect(party).toBeLessThan(1);
    expect(actor.poseSeated).toBe(true);
    run(actor, stage, 1.5);
    const calm = share(60);
    expect(calm).toBeGreaterThan(0.05);
    expect(calm).toBeLessThan(0.3);
  });

  it("plays an emote over the routine and then goes back to work", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(0));
    actor.emote("cheer", 1);
    actor.update(DT, stage);
    expect([actor.pose, actor.poseSeated]).toEqual(["cheer", true]);
    expect(actor.seatedIdle).toBe(false);
    run(actor, stage, 1.1);
    expect(actor.pose).toBe("type");
    expect(actor.seatedIdle).toBe(true);

    actor.emote("slump", 0.5);
    actor.update(DT, stage);
    expect(actor.pose).toBe("slump");
    actor.emote("phone", 0.5);
    actor.update(DT, stage);
    expect([actor.pose, actor.poseSeated]).toEqual(["phone", true]);
  });

  it("gets a beanbag sitter to their feet to cheer, but leaves them be for the chair-only emotes", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), beanbag(1));
    actor.emote("cheer", 1);
    actor.update(DT, stage);
    expect([actor.pose, actor.poseSeated]).toEqual(["cheer", false]);
    actor.emote("phone", 1);
    actor.update(DT, stage);
    expect(actor.pose).toBe("floor-sit");
    // A slump happens on the beanbag itself.
    actor.emote("slump", 1);
    actor.update(DT, stage);
    expect([actor.pose, actor.poseSeated, actor.poseFloor]).toEqual(["slump", false, true]);
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

  it.each(["garage", "coworking", "office", "unicorn", "public"] as const)(
    "goes round the furniture in the %s: never through a desk or a station on the way to any seat",
    (phase) => {
      const plan = getOfficeLayout(phase);
      const stage = new TestStage(plan);
      const outside = doorExterior(plan, 0.8);
      const solid = getLayoutObstacles(plan).filter((obstacle) => obstacle.kind === "desk" || obstacle.kind === "station");
      const seats: Seat[] = [
        seatAt(plan.founderSeat, "founder", -1),
        seatAt(plan.cofounderSeat, "cofounder", -1),
        ...plan.deskSeats.map((placement, slot) => seatAt(placement, "desk", slot)),
        ...plan.overflowSpots.map((placement, slot) => seatAt(placement, "overflow", slot)),
      ];
      seats.forEach((seat, index) => {
        const own = deskFootprint(seat);
        const actor = new Actor(person(`engineering-${index}`, 100 + index), seat);
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
        expect(Number.isFinite(seconds), `${seat.kind} ${seat.slotIndex}`).toBe(true);
        expect(hits, `${seat.kind} ${seat.slotIndex}`).toBe(0);
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
    const everything = ["office-upgrade", "lounge", "helicopter", "jet", "yacht"] as const;
    for (const [phase, assets] of (["garage", "coworking", "office", "unicorn", "public"] as const).flatMap(
      (phase) => [[phase, []], [phase, [...everything]]] as const
    )) {
      const plan = getOfficeLayout(phase, assets);
      const stage = new TestStage(plan);
      const seats = [seatAt(plan.founderSeat, "founder", -1), seatAt(plan.cofounderSeat, "cofounder", -1), ...plan.deskSeats.map((seat, i) => seatAt(seat, "desk", i))];
      for (const seat of seats) {
        expect(chairApproach(plan, seat, doorExterior(plan, 0.8)), `${phase} ${seat.slotIndex}`).not.toBeNull();
        const actor = new Actor(person(), seat);
        actor.enterFrom(doorExterior(plan, 0.8), plan.door.facing, 0, false);
        let through = 0;
        runUntil(actor, stage, () => actor.mode === "seated", 60, () => {
          if (actor.mode !== "walking" && actor.mode !== "settling") return;
          // A standing body (about 0.36 across) must stay clear of the chair wherever it is.
          if (footprintContains(chairAt(seat, actor.chairOut), actor.x, actor.z, 0.12)) through += 1;
        });
        expect(actor.mode, `${phase} ${seat.slotIndex}`).toBe("seated");
        expect(through, `${phase} seat ${seat.slotIndex}`).toBe(0);
        // …and out again the same way.
        run(actor, stage, CHAIR_SECONDS);
        actor.leave(doorExterior(plan, 0.8), 0, true);
        runUntil(actor, stage, () => actor.gone, 60, () => {
          if (actor.mode === "walking" && footprintContains(chairAt(seat, actor.chairOut), actor.x, actor.z, 0.12)) through += 1;
        });
        expect(actor.gone).toBe(true);
        expect(through, `${phase} seat ${seat.slotIndex}, leaving`).toBe(0);
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


  it("has no chair to move on a beanbag", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), beanbag(0));
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
    const actor = new Actor(person("founder"), seatAt(layout.founderSeat, "founder", -1));
    const a = layout.wanderSpots[0];
    const b = layout.wanderSpots[1];
    const visited: string[] = [];
    actor.runErrand(
      "pace",
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

  it("stops in its tracks to cheer, then carries on", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(0));
    actor.runErrand("wander", [coffee], stage);
    runUntil(actor, stage, () => actor.mode === "walking");
    run(actor, stage, 0.5);
    const { x, z } = actor;
    actor.emote("cheer", 1);
    run(actor, stage, 0.9);
    expect([actor.x, actor.z]).toEqual([x, z]);
    expect([actor.pose, actor.poseSeated, actor.walkSpeed]).toEqual(["cheer", false, 0]);
    run(actor, stage, 0.5);
    expect(actor.pose).toBe("walk");
    expect(Number.isFinite(runUntil(actor, stage, () => actor.mode === "seated"))).toBe(true);
  });

  it("is snapped back to the seat if the trip somehow never ends", () => {
    const stage = new TestStage(layout);
    const seat = desk(0);
    const actor = new Actor(person(), seat);
    actor.runErrand("wander", [coffee], stage);
    runUntil(actor, stage, () => actor.mode === "walking");
    // Held up for ever (here: by a cheer that keeps being renewed).
    const seconds = runUntil(
      actor,
      stage,
      () => actor.mode === "seated",
      120,
      () => actor.emote("cheer", 1)
    );
    expect(seconds).toBeLessThan(60);
    expectAtSeat(actor, seat);
    expect(actor.errand).toBeNull();
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
    const actor = new Actor(person(), beanbag(0));
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

  it("relocates by vanishing and popping in at the new seat", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(0));
    actor.runErrand("wander", [{ x: 0, z: 0, facing: null, pause: 1, bubble: null }], stage);
    run(actor, stage, 1);
    const office = getOfficeLayout("office");
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

  it("ignores errands, emotes and seat moves once leaving", () => {
    const stage = new TestStage(layout);
    const actor = new Actor(person(), desk(7));
    actor.leave(exterior, 0, true);
    run(actor, stage, 0.6);
    actor.emote("cheer", 5);
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
    // The same phase with an asset bought is a different layout object with the same furniture.
    stage.layout = getOfficeLayout("coworking", ["lounge"]);
    runUntil(actor, stage, () => actor.mode === "seated");
    expectAtSeat(actor, desk(0));
    expect(Number.isFinite(actor.x + actor.z + actor.facing)).toBe(true);
  });

  it("gives different people different rhythms but the same person the same one", () => {
    const a = new Actor(person("engineering-0", 1), desk(0));
    const b = new Actor(person("engineering-1", 2), desk(1));
    const again = new Actor(person("engineering-0", 1), desk(0));
    const draws = (actor: Actor): number[] => [actor.rng.next(), actor.rng.next(), actor.rng.next()];
    const first = draws(a);
    expect(draws(again)).toEqual(first);
    expect(draws(b)).not.toEqual(first);
  });
});
