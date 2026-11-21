import { describe, expect, it } from "vitest";
import type { GameState } from "../../types/game";
import type { Vec2, WorldEvent, WorldSoundSink } from "../types";
import { Crew } from "./crew";
import { ARRIVAL_STEPS_FROM, Footfall, MAX_STEPS, STEP_LENGTH, stepsFor } from "./footfall";
import { company, departed, hired, RecordingHost, run, Studio } from "./testKit";
import type { CompanyOptions } from "./testKit";

type Heard =
  | { sound: "footsteps"; from: Vec2; to: Vec2; steps: number; approach: number; at: number; who: string }
  | { sound: "chair-sit"; at: number; where: Vec2 };

/** A crew, the studio around it, and a Footfall listening to it frame by frame, as the EmployeeSystem wires it. */
const listen = (options: CompanyOptions, rig: { reducedMotion?: boolean; seed?: number } = {}) => {
  const studio = new Studio();
  const host = new RecordingHost();
  const crew = new Crew(host, studio.layout, { reducedMotion: rig.reducedMotion ?? false, seed: rig.seed });
  const heard: Heard[] = [];
  let time = 0;
  let current = "";
  const sink: WorldSoundSink = {
    footsteps: (from, to, steps, approach) =>
      heard.push({ sound: "footsteps", from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, steps, approach, at: time, who: current }),
    chairSit: (where) => heard.push({ sound: "chair-sit", at: time, where: { x: where.x, z: where.z } }),
  };
  const footfall = new Footfall(sink);
  const observeAll = (): void => {
    const door = studio.layout.door;
    for (const actor of [...crew.cast, ...crew.departing]) {
      current = actor.id;
      footfall.observe(actor, door);
    }
  };
  const apply = (state: GameState, events: readonly WorldEvent[] = []): void => {
    studio.apply(crew, state, events);
    observeAll();
  };
  const advance = (seconds: number): void =>
    run(crew, seconds, () => {
      time += 1 / 60;
      observeAll();
    });
  apply(company(options));
  return { studio, crew, heard, apply, advance };
};

const footsteps = (heard: readonly Heard[]) => heard.filter((h) => h.sound === "footsteps");
const chairs = (heard: readonly Heard[]) => heard.filter((h) => h.sound === "chair-sit");

describe("stepsFor", () => {
  it("plays one step per stride of ground, between one and six", () => {
    expect(stepsFor(0)).toBe(1);
    expect(stepsFor(STEP_LENGTH * 3)).toBe(3);
    expect(stepsFor(100)).toBe(MAX_STEPS);
    expect(stepsFor(Number.NaN)).toBe(1);
  });
});

describe("Footfall: what the people system lets the player hear", () => {
  it("is silent for an office that is simply there (first snapshot, restored save)", () => {
    const { heard, advance } = listen({ team: { engineering: 3 } }, { reducedMotion: true });
    advance(5);
    expect(heard).toEqual([]);
  });

  it("times an arrival's steps to end at the seat, then the chair takes their weight", () => {
    const { studio, crew, heard, apply, advance } = listen({ phase: "office", team: { engineering: 1 } }, { reducedMotion: true });
    apply(company({ phase: "office", team: { engineering: 2 } }), [hired("engineering", 1)]);
    const hire = crew.actor("engineering-1");
    let leftWhenHeard = Number.NaN;
    let sat = Number.NaN;
    // Frame by frame, so the distance left at the moment of the steps can be read.
    for (let frame = 1; frame <= 20 * 60; frame += 1) {
      const before = footsteps(heard).length;
      advance(1 / 60);
      if (footsteps(heard).length > before && Number.isNaN(leftWhenHeard)) leftWhenHeard = hire?.distanceLeft ?? Number.NaN;
      if (Number.isNaN(sat) && hire?.mode === "seated") sat = frame / 60;
    }
    const steps = footsteps(heard);
    expect(steps).toHaveLength(1);
    const [arrival] = steps;
    if (arrival.sound !== "footsteps") throw new Error("unreachable");
    expect(arrival.who).toBe("engineering-1");
    expect(arrival.approach).toBe(1);
    // Close to the seat (a couple of seconds out), not as they come through the door.
    expect(leftWhenHeard).toBeLessThanOrEqual(ARRIVAL_STEPS_FROM);
    const seat = studio.seating.seatOf("engineering-1");
    expect(arrival.to).toEqual({ x: seat?.x, z: seat?.z });

    const sits = chairs(heard);
    expect(sits).toHaveLength(1);
    expect(sits[0].at).toBeGreaterThan(arrival.at);
    // The steps (about 0.3 s each) are over by the time they sit.
    expect(sits[0].at - arrival.at).toBeGreaterThanOrEqual(arrival.steps * 0.3 - 0.35);
    expect(sits[0].at).toBeCloseTo(sat, 1);
  });

  it("files a row of hires in as a row of arrivals: one set of steps and one chair each", () => {
    const { heard, apply, advance } = listen({ phase: "office", team: {} }, { reducedMotion: true });
    apply(company({ phase: "office", team: { engineering: 3 } }), [hired("engineering", 0, 1, 2)]);
    advance(25);
    const steps = footsteps(heard);
    expect(steps.map((s) => (s.sound === "footsteps" ? s.who : "")).sort()).toEqual(["engineering-0", "engineering-1", "engineering-2"]);
    expect(chairs(heard)).toHaveLength(3);
  });

  it("walks a leaver out with fading steps toward the door, and no chair", () => {
    const { studio, heard, apply, advance } = listen({ team: { engineering: 3 } }, { reducedMotion: true });
    apply(company({ team: { engineering: 2 } }), [departed("engineering", 2)]);
    advance(20);
    const steps = footsteps(heard);
    expect(steps).toHaveLength(1);
    const [leaving] = steps;
    if (leaving.sound !== "footsteps") throw new Error("unreachable");
    expect(leaving.who).toBe("engineering-2");
    expect(leaving.approach).toBe(-1);
    expect(leaving.to).toEqual({ x: studio.layout.door.x, z: studio.layout.door.z });
    expect(chairs(heard)).toHaveLength(0);
  });

  it("follows the founder to the coffee machine and back", () => {
    const { studio, heard, apply, advance } = listen({ phase: "office", team: { engineering: 2 } });
    apply(company({ phase: "office", team: { engineering: 2 } }), [{ type: "easter-egg", command: "coffee" }]);
    advance(30);
    const founderSteps = footsteps(heard).filter((s) => s.sound === "footsteps" && s.who === "founder");
    expect(founderSteps).toHaveLength(2);
    const machine = studio.layout.stationStandSpots.coffee;
    const [there, back] = founderSteps;
    if (there.sound !== "footsteps" || back.sound !== "footsteps") throw new Error("unreachable");
    expect(there.to).toEqual({ x: machine.x, z: machine.z });
    expect(there.approach).toBe(0);
    expect(back.at).toBeGreaterThan(there.at);
  });

  it("leaves ordinary wandering silent: a busy floor is the ambience's job", () => {
    const { heard, crew, advance } = listen({ phase: "office", team: { engineering: 10, design: 4 } }, { seed: 7 });
    let wandered = false;
    for (let i = 0; i < 90; i += 1) {
      advance(1);
      if (crew.cast.some((actor) => actor.errand === "wander" && actor.mode === "walking")) wandered = true;
    }
    expect(wandered).toBe(true);
    expect(heard).toEqual([]);
  });

  it("hears nothing when people pop in rather than walk (an office rebuilt around them)", () => {
    const { heard, apply, advance } = listen({ phase: "coworking", team: { engineering: 3 } }, { reducedMotion: true });
    apply(company({ phase: "office", team: { engineering: 3 } }), [{ type: "phase-changed", from: "coworking", to: "office" }]);
    advance(10);
    expect(heard).toEqual([]);
  });
});
