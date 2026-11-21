import { describe, expect, it } from "vitest";
import { createInitialState } from "../../engine";
import { buildWorldSnapshot } from "../snapshot";
import type { WorldSystem } from "../types";
import { SystemRunner } from "./SystemRunner";

const snapshot = buildWorldSnapshot(createInitialState());

interface Probe {
  system: WorldSystem;
  /** Make the named method throw from now on (null = behave). */
  failOn: "applySnapshot" | "update" | "dispose" | null;
}

const makeProbe = (name: string, calls: string[]): Probe => {
  const probe: Probe = {
    failOn: null,
    system: {
      applySnapshot: () => {
        calls.push(`${name}.applySnapshot`);
        if (probe.failOn === "applySnapshot") throw new Error(`${name} cannot apply`);
      },
      update: () => {
        calls.push(`${name}.update`);
        if (probe.failOn === "update") throw new Error(`${name} cannot update`);
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
    runner.applySnapshot(snapshot, null, []);
    runner.update(0.016, 0.016);
    expect(calls).toEqual([]);

    runner.start();
    runner.applySnapshot(snapshot, null, []);
    runner.update(0.016, 0.016);
    runner.stop();
    expect(calls).toEqual([
      "office.create",
      "people.create",
      "fx.create",
      "office.applySnapshot",
      "people.applySnapshot",
      "fx.applySnapshot",
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
    probes.office.failOn = "applySnapshot";
    runner.applySnapshot(snapshot, null, []);
    runner.applySnapshot(snapshot, snapshot, []);
    expect(reports).toHaveLength(2);
    expect(reports[1]).toContain("office.applySnapshot");

    runner.forgetFailures();
    runner.applySnapshot(snapshot, snapshot, []);
    expect(reports).toHaveLength(3);
  });

  it("contains failures in applySnapshot and dispose as well", () => {
    const { runner, calls, probes } = makeRunner();
    runner.start();
    probes.office.failOn = "applySnapshot";
    calls.length = 0;
    expect(() => runner.applySnapshot(snapshot, null, [])).not.toThrow();
    expect(calls).toEqual(["office.applySnapshot", "people.applySnapshot", "fx.applySnapshot"]);

    probes.fx.failOn = "dispose";
    calls.length = 0;
    expect(() => runner.stop()).not.toThrow();
    expect(calls).toEqual(["fx.dispose", "people.dispose", "office.dispose"]);
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
