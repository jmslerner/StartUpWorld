import { describe, expect, it } from "vitest";
import { nextCast } from "../cast";
import type { OfficeScene, WorldFrame, WorldSystem } from "../types";
import { SystemRunner } from "./SystemRunner";

const scene: OfficeScene = {
  runId: "run",
  seed: 7,
  year: 1995,
  office: 0,
  capacity: 4,
  era: "flat",
  teams: { product: 2, growth: 1, recruiting: 0 },
  away: 0,
  leaving: 0,
  arriving: 0,
  ending: null,
};
const frame: WorldFrame = { scene, cast: nextCast(null, scene), events: [] };

interface Probe {
  system: WorldSystem;
  /** Make the named method throw from now on (null = behave). */
  failOn: "applyFrame" | "update" | "busy" | "dispose" | null;
  /** What busy() answers. */
  moving: boolean;
}

const makeProbe = (name: string, calls: string[]): Probe => {
  const probe: Probe = {
    failOn: null,
    moving: false,
    system: {
      applyFrame: () => {
        calls.push(`${name}.applyFrame`);
        if (probe.failOn === "applyFrame") throw new Error(`${name} cannot apply`);
      },
      update: () => {
        calls.push(`${name}.update`);
        if (probe.failOn === "update") throw new Error(`${name} cannot update`);
      },
      busy: () => {
        if (probe.failOn === "busy") throw new Error(`${name} cannot tell`);
        return probe.moving;
      },
      dispose: () => {
        calls.push(`${name}.dispose`);
        if (probe.failOn === "dispose") throw new Error(`${name} cannot dispose`);
      },
    },
  };
  return probe;
};

const makeRunner = (): { runner: SystemRunner; calls: string[]; reports: string[]; probes: Record<string, Probe> } => {
  const calls: string[] = [];
  const reports: string[] = [];
  const runner = new SystemRunner((message) => reports.push(message));
  const probes: Record<string, Probe> = {};
  for (const name of ["office", "people", "fx"]) {
    probes[name] = makeProbe(name, calls);
    runner.register(name, () => {
      calls.push(`${name}.create`);
      return probes[name].system;
    });
  }
  return { runner, calls, reports, probes };
};

describe("SystemRunner", () => {
  it("creates, applies and updates in registration order, and disposes in reverse", () => {
    const { runner, calls } = makeRunner();
    runner.applyFrame(frame, null);
    runner.update(0.016, 0.016);
    expect(calls).toEqual([]);

    runner.start();
    runner.applyFrame(frame, null);
    runner.update(0.016, 0.016);
    runner.stop();
    expect(calls).toEqual([
      "office.create",
      "people.create",
      "fx.create",
      "office.applyFrame",
      "people.applyFrame",
      "fx.applyFrame",
      "office.update",
      "people.update",
      "fx.update",
      "fx.dispose",
      "people.dispose",
      "office.dispose",
    ]);

    // Stopped systems are not called again, and stopping twice is harmless.
    calls.length = 0;
    runner.update(0.016, 0.032);
    runner.stop();
    expect(calls).toEqual([]);
  });

  it("can rebuild a subset in place, keeping the overall order", () => {
    const { runner, calls } = makeRunner();
    runner.start();
    calls.length = 0;

    runner.stop(["office", "people"]);
    expect(calls).toEqual(["people.dispose", "office.dispose"]);
    calls.length = 0;
    runner.update(0.016, 0.016);
    expect(calls).toEqual(["fx.update"]);

    calls.length = 0;
    runner.start(["office", "people"]);
    runner.update(0.016, 0.032);
    expect(calls).toEqual(["office.create", "people.create", "office.update", "people.update", "fx.update"]);

    // start() never duplicates a running system.
    calls.length = 0;
    runner.start();
    expect(calls).toEqual([]);
  });

  it("keeps the other systems running when one throws, every frame", () => {
    const { runner, calls, probes } = makeRunner();
    runner.start();
    probes.people.failOn = "update";
    calls.length = 0;

    for (let frame = 0; frame < 3; frame += 1) runner.update(0.016, frame * 0.016);
    expect(calls.filter((call) => call === "office.update")).toHaveLength(3);
    expect(calls.filter((call) => call === "fx.update")).toHaveLength(3);
    // The failing system is retried each frame, so a transient fault can heal.
    expect(calls.filter((call) => call === "people.update")).toHaveLength(3);

    probes.people.failOn = null;
    expect(() => runner.update(0.016, 1)).not.toThrow();
  });

  it("reports each failing step once, not once per frame", () => {
    const { runner, reports, probes } = makeRunner();
    runner.start();
    probes.office.failOn = "update";
    for (let frame = 0; frame < 120; frame += 1) runner.update(0.016, frame * 0.016);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("office.update");

    // A different step of the same system is a different problem and is reported too.
    probes.office.failOn = "applyFrame";
    runner.applyFrame(frame, null);
    runner.applyFrame(frame, frame);
    expect(reports).toHaveLength(2);
    expect(reports[1]).toContain("office.applyFrame");

    runner.forgetFailures();
    runner.applyFrame(frame, frame);
    expect(reports).toHaveLength(3);
  });

  it("contains failures in applyFrame and dispose as well", () => {
    const { runner, calls, probes } = makeRunner();
    runner.start();
    probes.office.failOn = "applyFrame";
    calls.length = 0;
    expect(() => runner.applyFrame(frame, null)).not.toThrow();
    expect(calls).toEqual(["office.applyFrame", "people.applyFrame", "fx.applyFrame"]);

    probes.fx.failOn = "dispose";
    calls.length = 0;
    expect(() => runner.stop()).not.toThrow();
    expect(calls).toEqual(["fx.dispose", "people.dispose", "office.dispose"]);
  });

  it("a system that throws is reported and the others still run", () => {
    const { runner, calls, reports, probes } = makeRunner();
    runner.start();
    probes.people.failOn = "update";
    calls.length = 0;
    runner.update(0.016, 0.016);
    expect(calls).toEqual(["office.update", "people.update", "fx.update"]);
    expect(reports).toEqual(["[world] people.update failed; carrying on without it."]);
  });

  it("the runner is busy while any system is, and rests when none is", () => {
    const { runner, probes } = makeRunner();
    // Nothing is running yet, so nothing can be moving.
    probes.office.moving = true;
    expect(runner.busy()).toBe(false);

    runner.start();
    expect(runner.busy()).toBe(true);
    probes.office.moving = false;
    expect(runner.busy()).toBe(false);
    probes.fx.moving = true;
    expect(runner.busy()).toBe(true);
    probes.people.moving = true;
    probes.fx.moving = false;
    expect(runner.busy()).toBe(true);
    probes.people.moving = false;
    expect(runner.busy()).toBe(false);

    // A stopped system no longer keeps the loop awake.
    probes.people.moving = true;
    runner.stop(["people"]);
    expect(runner.busy()).toBe(false);
  });

  it("a system that cannot say whether it is busy counts as at rest, and is reported once", () => {
    const { runner, reports, probes } = makeRunner();
    runner.start();
    probes.office.failOn = "busy";
    for (let frame = 0; frame < 5; frame += 1) expect(runner.busy()).toBe(false);
    expect(reports).toEqual(["[world] office.busy failed; carrying on without it."]);
    // The others are still asked.
    probes.fx.moving = true;
    expect(runner.busy()).toBe(true);
  });

  it("leaves out a system whose constructor throws and still runs the rest", () => {
    const calls: string[] = [];
    const reports: string[] = [];
    const runner = new SystemRunner((message) => reports.push(message));
    const good = makeProbe("fx", calls);
    let attempts = 0;
    runner.register("office", () => {
      attempts += 1;
      throw new Error("no office today");
    });
    runner.register("fx", () => good.system);

    runner.start();
    runner.update(0.016, 0.016);
    expect(calls).toEqual(["fx.update"]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("office.create");

    // A later start() gets another go at it.
    runner.start();
    expect(attempts).toBe(2);
  });

  it("offers the same containment for one-off steps", () => {
    const reports: string[] = [];
    const runner = new SystemRunner((message) => reports.push(message));
    expect(runner.run("layout", () => undefined)).toBe(true);
    expect(
      runner.run("layout", () => {
        throw new Error("bad plan");
      })
    ).toBe(false);
    expect(reports).toEqual(["[world] layout failed; carrying on without it."]);
  });
});
