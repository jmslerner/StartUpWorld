import { describe, expect, it } from "vitest";
import type { GameState, TeamRole } from "../../types/game";
import { doorExterior, getOfficeLayout } from "../office/layouts";
import type { WorldEvent } from "../types";
import { POP_SECONDS } from "./actor";
import type { Actor } from "./actor";
import {
  Crew,
  DOOR_QUEUE_GAP,
  energyFor,
  ENTRY_STAGGER,
  MAX_GROUP_BUBBLES,
  pacePoints,
  spreadIndices,
  wanderCap,
} from "./crew";
import { company, departed, hired, RecordingHost, run, Studio } from "./testKit";
import type { CompanyOptions } from "./testKit";

interface Rig {
  studio: Studio;
  host: RecordingHost;
  crew: Crew;
  /** Push a state (and what happened) through, as the World would. */
  apply(state: GameState, events?: readonly WorldEvent[]): void;
}

const rig = (options: { reducedMotion?: boolean; seed?: number } = {}): Rig => {
  const studio = new Studio();
  const host = new RecordingHost();
  const crew = new Crew(host, studio.layout, { reducedMotion: options.reducedMotion ?? false, seed: options.seed });
  return { studio, host, crew, apply: (state, events = []) => void studio.apply(crew, state, events) };
};

/** A rig with a company already in place (first snapshot applied). */
const office = (options: CompanyOptions = {}, rigOptions: { reducedMotion?: boolean; seed?: number } = {}): Rig => {
  const built = rig(rigOptions);
  built.apply(company(options));
  return built;
};

/** Reduced motion keeps people from wandering off, for tests that are about something else. */
const STILL = { reducedMotion: true };

const must = (crew: Crew, id: string): Actor => {
  const actor = crew.actor(id);
  if (!actor) throw new Error(`no actor for ${id}`);
  return actor;
};

const ids = (actors: readonly Actor[]): string[] => actors.map((actor) => actor.id);

/** Everyone in the cast is in the seat the plan gives them. */
const expectAllSeated = ({ crew, studio }: Rig): void => {
  for (const actor of crew.cast) {
    const seat = studio.seating.seatOf(actor.id);
    expect(seat, actor.id).not.toBeNull();
    expect(actor.mode, actor.id).toBe("seated");
    expect([actor.x, actor.z], actor.id).toEqual([seat?.x, seat?.z]);
    expect(actor.visible, actor.id).toBe(true);
    expect(actor.scale, actor.id).toBe(1);
  }
};

/** The host has exactly one body per actor the crew still knows about. */
const expectBodiesMatch = ({ crew, host }: Rig): void => {
  expect(host.alive.size).toBe(crew.cast.length + crew.departing.length);
  for (const actor of crew.cast) expect(host.alive.has(actor)).toBe(true);
  for (const actor of crew.departing) expect(host.alive.has(actor)).toBe(true);
};

describe("helpers", () => {
  it("caps wanderers at about one in eight, between one and five", () => {
    expect([1, 3, 8, 12, 20, 28, 40, 64].map(wanderCap)).toEqual([1, 1, 1, 2, 3, 4, 5, 5]);
  });

  it("derives energy from morale, and docks the founder for stress", () => {
    expect(energyFor("employee", 100, 0)).toBeCloseTo(1);
    expect(energyFor("employee", 0, 100)).toBeCloseTo(0.3);
    expect(energyFor("employee", 50, 0)).toBeLessThan(energyFor("employee", 80, 0));
    expect(energyFor("founder", 60, 40)).toBeCloseTo(energyFor("employee", 60, 40));
    expect(energyFor("founder", 60, 95)).toBeLessThan(energyFor("founder", 60, 60));
    expect(energyFor("founder", 0, 100)).toBeGreaterThanOrEqual(0.15);
  });

  it("spreads a limited number of picks evenly over a group", () => {
    expect(spreadIndices(3, 8)).toEqual([0, 1, 2]);
    expect(spreadIndices(0, 8)).toEqual([]);
    const picks = spreadIndices(30, 8);
    expect(picks).toHaveLength(8);
    expect(new Set(picks).size).toBe(8);
    expect(picks[0]).toBe(0);
    expect(Math.max(...picks)).toBeLessThan(30);
    expect(spreadIndices(30, 8)).toEqual(picks);
  });

  it("finds clear floor near the founder's seat to pace on, in every office", () => {
    for (const phase of ["garage", "coworking", "office", "unicorn", "public"] as const) {
      const layout = getOfficeLayout(phase);
      const points = pacePoints(layout, layout.founderSeat);
      expect(points.length, phase).toBeGreaterThanOrEqual(1);
      for (const point of points) {
        const distance = Math.hypot(point.x - layout.founderSeat.x, point.z - layout.founderSeat.z);
        expect(distance, phase).toBeLessThan(2.2);
      }
    }
  });
});

describe("Crew: who is in the office", () => {
  it("seats everyone instantly on the first snapshot, one actor per person with a seat", () => {
    const r = office({ team: { engineering: 3, design: 1, sales: 2 } });
    expect(ids(r.crew.cast)).toEqual([
      "founder",
      "cofounder",
      "engineering-0",
      "engineering-1",
      "engineering-2",
      "design-0",
      "sales-0",
      "sales-1",
    ]);
    expectAllSeated(r);
    expectBodiesMatch(r);
    expect(r.host.bubbles).toHaveLength(0);
    expect(r.host.puffs).toHaveLength(0);
    for (const actor of r.crew.cast) expect(actor.pose).toBe("type");
  });

  it("gives nobody a body when the office has no room for them", () => {
    // Coworking has 8 desks and 6 beanbags.
    const r = office({ phase: "coworking", team: { engineering: 20 } });
    expect(r.crew.cast).toHaveLength(2 + 14);
    expect(r.studio.seating.hiddenCount()).toBe(6);
    expect(r.crew.actor("engineering-19")).toBeNull();
    const floor = r.crew.cast.filter((actor) => actor.home.kind === "overflow");
    expect(floor).toHaveLength(6);
    for (const actor of floor) expect(actor.pose).toBe("floor-sit");
  });

  it("shows only the founder, waiting, until setup completes", () => {
    const r = office({ setup: false, team: { engineering: 1 } });
    expect(ids(r.crew.cast)).toEqual(["founder"]);
    expect(must(r.crew, "founder").pose).toBe("sit");
    run(r.crew, 60);
    expect(must(r.crew, "founder").mode).toBe("seated");
    expect(r.host.bubbles).toHaveLength(0);
  });

  it("walks the cofounder and the first employee in when setup completes", () => {
    const r = office({ setup: false, team: { engineering: 1 } }, STILL);
    r.apply(company({ team: { engineering: 1 } }), [{ type: "setup-completed" }]);
    expect(ids(r.crew.cast)).toEqual(["founder", "cofounder", "engineering-0"]);
    const cofounder = must(r.crew, "cofounder");
    const engineer = must(r.crew, "engineering-0");
    expect(cofounder.mode).toBe("waiting");
    r.crew.update(1 / 60);
    // The cofounder leads; the engineer follows a beat later.
    expect(cofounder.visible).toBe(true);
    expect(engineer.visible).toBe(false);
    run(r.crew, ENTRY_STAGGER + 0.05);
    expect(engineer.visible).toBe(true);
    expect(r.host.icons()).toEqual(["wave", "wave"]);
    expect(must(r.crew, "founder").pose).toBe("type");
    run(r.crew, 20);
    expectAllSeated(r);
  });

  it("follows the founder's name as it is typed in during setup", () => {
    const r = office({ setup: false });
    const named = { ...company({ setup: false }), founder: { name: "Grace", archetype: null } };
    r.apply(named);
    expect(r.host.renames).toEqual(["founder"]);
    expect(must(r.crew, "founder").person.name).toBe("Grace");
    r.apply(named);
    expect(r.host.renames).toEqual(["founder"]);
  });
});

describe("Crew: hiring", () => {
  it("walks a new hire from outside the door to their seat, with a wave and a puff of dust", () => {
    const r = office({ team: { engineering: 1 } }, STILL);
    r.apply(company({ team: { engineering: 2 } }), [hired("engineering", 1)]);
    const hire = must(r.crew, "engineering-1");
    const outside = doorExterior(r.studio.layout, 0.8);
    r.crew.update(1 / 60);
    expect(hire.visible).toBe(true);
    expect(Math.hypot(hire.x - outside.x, hire.z - outside.z)).toBeLessThan(0.1);
    expect(r.host.icons("engineering-1")).toEqual(["wave"]);
    expect(r.host.puffs).toHaveLength(0);

    let walked = false;
    run(r.crew, 20, () => {
      if (hire.pose === "walk") walked = true;
    });
    expect(walked).toBe(true);
    expectAllSeated(r);
    const seat = r.studio.seating.seatOf("engineering-1");
    expect(r.host.dustAt(seat?.x ?? NaN, seat?.z ?? NaN)).toBe(true);
    // Nobody else moved.
    expect(r.host.puffs).toHaveLength(1);
  });

  it("files several hires in about a third of a second apart", () => {
    const r = office({ team: {} });
    r.apply(company({ team: { engineering: 4 } }), [hired("engineering", 0, 1, 2, 3)]);
    const appeared = new Map<string, number>();
    run(r.crew, 3, (time) => {
      for (const actor of r.crew.cast) if (actor.visible && !appeared.has(actor.id)) appeared.set(actor.id, time);
    });
    const times = [0, 1, 2, 3].map((index) => appeared.get(`engineering-${index}`) ?? NaN);
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeCloseTo(ENTRY_STAGGER, 1);
    expect(times[0]).toBeLessThan(0.05);
  });

  it("keeps the queue when hires are typed one after another", () => {
    const r = office({ team: {} }, STILL);
    r.apply(company({ team: { design: 1 } }), [hired("design", 0)]);
    run(r.crew, 0.1);
    r.apply(company({ team: { design: 2 } }), [hired("design", 1)]);
    r.crew.update(1 / 60);
    // The second has to wait their turn even though the command came 0.1 s later.
    expect(must(r.crew, "design-1").visible).toBe(false);
    run(r.crew, ENTRY_STAGGER);
    expect(must(r.crew, "design-1").visible).toBe(true);
    run(r.crew, 20);
    expectAllSeated(r);
  });

  it("is not disturbed by snapshots that arrive while someone is walking in", () => {
    const r = office({ team: { engineering: 1 } }, STILL);
    const state = company({ team: { engineering: 2 } });
    r.apply(state, [hired("engineering", 1)]);
    const hire = must(r.crew, "engineering-1");
    let last = { x: NaN, z: NaN };
    let biggestStep = 0;
    run(r.crew, 12, (time) => {
      // The player keeps typing: status, a failed command, another status…
      if (Math.round(time * 60) % 7 === 0) r.apply({ ...state, ap: Math.round(time) % 3 }, []);
      if (hire.visible && Number.isFinite(last.x)) biggestStep = Math.max(biggestStep, Math.hypot(hire.x - last.x, hire.z - last.z));
      if (hire.visible) last = { x: hire.x, z: hire.z };
    });
    // Never teleported: no frame moved them further than a brisk step.
    expect(biggestStep).toBeLessThan(0.1);
    expectAllSeated(r);
    expect(r.host.spawnCount).toBe(4);
  });

  it("pops in (no walk) somebody who gets a seat without having just been hired", () => {
    // 20 engineers in coworking: 6 have no seat. One of the seated leaves; a hidden one takes the spot.
    const r = office({ phase: "coworking", team: { engineering: 20, design: 1 } });
    expect(r.crew.actor("design-0")).toBeNull();
    r.apply(company({ phase: "coworking", team: { engineering: 13, design: 1 } }), [
      departed("engineering", 13, 14, 15, 16, 17, 18, 19),
    ]);
    const designer = must(r.crew, "design-0");
    run(r.crew, POP_SECONDS + 0.1);
    expect(designer.mode).toBe("seated");
    expect(r.host.icons("design-0")).toEqual([]);
  });
});

describe("Crew: leaving", () => {
  it("walks a departing person out, unclickable from the start, and frees the body at the door", () => {
    const r = office({ team: { engineering: 3 } });
    const leaver = must(r.crew, "engineering-2");
    r.apply(company({ team: { engineering: 2 } }), [departed("engineering", 2)]);
    expect(r.crew.actor("engineering-2")).toBeNull();
    expect(r.host.retired.has(leaver)).toBe(true);
    expect(r.host.alive.has(leaver)).toBe(true);
    expect(ids(r.crew.departing)).toEqual(["engineering-2"]);

    let walkedWithBox = false;
    run(r.crew, 20, () => {
      if (leaver.pose === "walk" && leaver.carrying) walkedWithBox = true;
    });
    expect(walkedWithBox).toBe(true);
    expect(r.crew.departing).toHaveLength(0);
    expect(r.host.alive.has(leaver)).toBe(false);
    expectBodiesMatch(r);
  });

  it("lets the same id be hired again while the old holder is still walking out", () => {
    const r = office({ team: { sales: 1 } }, STILL);
    const old = must(r.crew, "sales-0");
    r.apply(company({ team: {} }), [departed("sales", 0)]);
    run(r.crew, 1);
    r.apply(company({ team: { sales: 1 } }), [hired("sales", 0)]);
    const fresh = must(r.crew, "sales-0");
    expect(fresh).not.toBe(old);
    expect(r.host.alive.has(old)).toBe(true);
    expect(r.host.alive.has(fresh)).toBe(true);
    run(r.crew, 20);
    expect(r.host.alive.has(old)).toBe(false);
    expect(fresh.mode).toBe("seated");
    expectBodiesMatch(r);
  });

  it("copes with someone being let go before they have even reached their desk", () => {
    const r = office({ team: {} });
    r.apply(company({ team: { engineering: 1 } }), [hired("engineering", 0)]);
    run(r.crew, 1.5);
    const walker = must(r.crew, "engineering-0");
    expect(walker.mode).toBe("walking");
    r.apply(company({ team: {} }), [departed("engineering", 0)]);
    let satDown = false;
    run(r.crew, 20, () => {
      if (walker.mode === "seated") satDown = true;
    });
    expect(satDown).toBe(false);
    expect(r.host.alive.has(walker)).toBe(false);
    expect(r.host.puffs).toHaveLength(0);
  });

  it("drops someone who was fired before their turn to walk in", () => {
    const r = office({ team: {} }, STILL);
    r.apply(company({ team: { engineering: 3 } }), [hired("engineering", 0, 1, 2)]);
    const last = must(r.crew, "engineering-2");
    r.apply(company({ team: { engineering: 2 } }), [departed("engineering", 2)]);
    run(r.crew, 0.1);
    expect(r.host.alive.has(last)).toBe(false);
    run(r.crew, 20);
    expectAllSeated(r);
    expectBodiesMatch(r);
  });

  it("staggers a round of layoffs", () => {
    const r = office({ team: { marketing: 4 } });
    const leavers = [0, 1, 2, 3].map((index) => must(r.crew, `marketing-${index}`));
    r.apply(company({ team: {} }), [departed("marketing", 0, 1, 2, 3)]);
    const stoodUp = new Map<Actor, number>();
    run(r.crew, 3, (time) => {
      for (const actor of leavers) if (actor.mode !== "seated" && !stoodUp.has(actor)) stoodUp.set(actor, time);
    });
    const times = leavers.map((actor) => stoodUp.get(actor) ?? NaN).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeCloseTo(ENTRY_STAGGER, 1);
    run(r.crew, 30);
    expect(r.host.alive.size).toBe(2);
  });

  it("just fades out somebody who lost their seat without leaving the company", () => {
    // Setup toggled off (only the sandbox can do this): the staff are still employed, just not shown.
    const r = office({ team: { engineering: 2 } });
    r.apply(company({ setup: false, team: { engineering: 2 } }));
    expect(ids(r.crew.cast)).toEqual(["founder"]);
    let walked = false;
    run(r.crew, 0.5, () => {
      for (const actor of r.crew.departing) if (actor.mode === "walking") walked = true;
    });
    expect(walked).toBe(false);
    expect(r.host.alive.size).toBe(1);
  });
});

describe("Crew: seats and offices changing", () => {
  it("walks someone from the floor to a desk when one frees up", () => {
    // Coworking has 8 desks: the ninth person, a designer, starts on a beanbag.
    const r = office({ phase: "coworking", team: { engineering: 8, design: 1 } }, STILL);
    const designer = must(r.crew, "design-0");
    expect(designer.home.kind).toBe("overflow");
    expect(designer.pose).toBe("floor-sit");
    // An engineer leaves, freeing a desk: the seating plan promotes the designer to it.
    r.apply(company({ phase: "coworking", team: { engineering: 7, design: 1 } }), [departed("engineering", 7)]);
    expect(designer.home.kind).toBe("desk");
    expect(designer.mode).toBe("rising");
    let walked = false;
    run(r.crew, 20, () => {
      if (designer.pose === "walk") walked = true;
    });
    expect(walked).toBe(true);
    expect(designer.pose).toBe("type");
    expectAllSeated(r);
  });

  it("hides everyone when the office is rebuilt and pops them in at their new seats within 1.5 s", () => {
    const r = office({ phase: "coworking", team: { engineering: 6, sales: 4 } });
    // Somebody is in the middle of walking out when it happens.
    r.apply(company({ phase: "coworking", team: { engineering: 6, sales: 3 } }), [departed("sales", 3)]);
    run(r.crew, 0.8);
    expect(r.crew.departing).toHaveLength(1);

    r.apply(company({ phase: "office", team: { engineering: 6, sales: 3 } }), [
      { type: "phase-changed", from: "coworking", to: "office" },
    ]);
    expect(r.crew.departing).toHaveLength(0);
    for (const actor of r.crew.cast) expect(actor.visible).toBe(false);
    expectBodiesMatch(r);

    run(r.crew, 1.5);
    expectAllSeated(r);
    const layout = getOfficeLayout("office");
    expect([must(r.crew, "founder").x, must(r.crew, "founder").z]).toEqual([layout.founderSeat.x, layout.founderSeat.z]);
  });

  it("cheers the new office as people pop in", () => {
    const r = office({ phase: "garage", team: { engineering: 2 } });
    r.apply(company({ phase: "coworking", team: { engineering: 2 } }), [
      { type: "phase-changed", from: "garage", to: "coworking" },
    ]);
    const cheered = new Set<string>();
    run(r.crew, 3, () => {
      for (const actor of r.crew.cast) if (actor.visible && actor.pose === "cheer") cheered.add(actor.id);
    });
    expect(cheered.size).toBe(4);
    for (const actor of r.crew.cast) expect(actor.emoting).toBeNull();
  });

  it("seats newcomers instantly when they arrive together with a new office", () => {
    const r = office({ phase: "garage", team: { engineering: 1 } });
    r.apply(company({ phase: "coworking", team: { engineering: 3 } }), [
      { type: "phase-changed", from: "garage", to: "coworking" },
      hired("engineering", 1, 2),
    ]);
    let walked = false;
    run(r.crew, 1.6, () => {
      for (const actor of r.crew.cast) if (actor.pose === "walk") walked = true;
    });
    expect(walked).toBe(false);
    expectAllSeated(r);
    expect(r.crew.cast).toHaveLength(5);
  });

  it("does not shuffle anyone when an asset purchase swaps the layout object", () => {
    const r = office({ phase: "office", team: { engineering: 5 } });
    const before = r.crew.cast.map((actor) => [actor.x, actor.z, actor.teleports]);
    const withLounge: GameState = {
      ...company({ phase: "office", team: { engineering: 5 } }),
      assets: [{ id: "lounge", name: "Lounge", purchaseWeek: 1 }],
    };
    r.apply(withLounge, [{ type: "asset-acquired", assetId: "lounge" }]);
    r.crew.update(1 / 60);
    expect(r.crew.cast.map((actor) => [actor.x, actor.z, actor.teleports])).toEqual(before);
    expectAllSeated(r);
  });

  it("rebuilds from nothing on a run reset, mid-animation", () => {
    const r = office({ team: { engineering: 2 } });
    r.apply(company({ team: { engineering: 4 } }), [hired("engineering", 2, 3)]);
    r.apply(company({ team: { engineering: 3 } }), [departed("engineering", 3)]);
    run(r.crew, 0.6);
    r.apply(company({ seed: 99, phase: "garage", team: { engineering: 1 } }), [{ type: "run-reset" }]);
    expect(ids(r.crew.cast)).toEqual(["founder", "cofounder", "engineering-0"]);
    expect(r.crew.departing).toHaveLength(0);
    expectAllSeated(r);
    expectBodiesMatch(r);
  });

  it("replaces the body when an id comes to mean a different person", () => {
    const r = office({ team: { engineering: 1 } });
    const before = must(r.crew, "engineering-0");
    // Same id, different seed-derived look: not the same person, even without a reset event.
    const frame = r.studio.frame(company({ team: { engineering: 1 } }));
    const people = frame.next.people.map((person) => (person.id === "engineering-0" ? { ...person, look: person.look + 1 } : person));
    r.crew.applySnapshot({ ...frame.next, people }, frame.prev, [], r.studio.seating, frame.layout);
    const after = must(r.crew, "engineering-0");
    expect(after).not.toBe(before);
    expect(r.host.alive.has(before)).toBe(false);
    expectBodiesMatch(r);
  });
});

describe("Crew: the working day", () => {
  it("sets everyone's energy from morale", () => {
    const happy = office({ morale: 90, team: { engineering: 2 } });
    const glum = office({ morale: 15, team: { engineering: 2 } });
    expect(must(happy.crew, "engineering-0").energy).toBeGreaterThan(must(glum.crew, "engineering-0").energy + 0.3);
  });

  it("lets a few people wander at a time — never more than the cap, never the same person twice running", () => {
    const r = office({ phase: "office", team: { engineering: 6, design: 3, marketing: 3, sales: 2 } });
    const cap = wanderCap(r.crew.cast.length);
    expect(cap).toBe(2);
    const trips: string[] = [];
    const out = new Set<Actor>();
    let most = 0;
    run(r.crew, 240, () => {
      let now = 0;
      for (const actor of r.crew.cast) {
        if (actor.errand !== "wander") {
          out.delete(actor);
          continue;
        }
        now += 1;
        if (!out.has(actor)) {
          out.add(actor);
          trips.push(actor.id);
        }
      }
      most = Math.max(most, now);
    });
    expect(trips.length).toBeGreaterThan(8);
    expect(most).toBeLessThanOrEqual(cap);
    for (let i = 1; i < trips.length; i += 1) expect(trips[i]).not.toBe(trips[i - 1]);
    // Several different people get up over a few minutes; it is not one restless soul.
    expect(new Set(trips).size).toBeGreaterThan(4);
    // Coffee drinkers say so.
    expect(r.host.icons()).toContain("coffee");

    // And everybody finds their way back.
    r.apply(company({ phase: "office", team: { engineering: 6, design: 3, marketing: 3, sales: 2 } }), [
      { type: "week-advanced", week: 2 },
    ]);
    run(r.crew, 1);
    expectAllSeated(r);
  });

  it("sends two wanderers to different spots", () => {
    const r = office({ phase: "public", team: { engineering: 30, sales: 10 } });
    let clashes = 0;
    run(r.crew, 120, () => {
      const stops = r.crew.cast.map((actor) => actor.errandStop).filter((stop) => stop !== null);
      for (let i = 0; i < stops.length; i += 1) {
        for (let j = i + 1; j < stops.length; j += 1) {
          if (Math.hypot(stops[i].x - stops[j].x, stops[i].z - stops[j].z) < 0.4) clashes += 1;
        }
      }
    });
    expect(clashes).toBe(0);
  });

  const neverWanders = (r: Rig, seconds = 120): void => {
    let away = 0;
    run(r.crew, seconds, () => {
      for (const actor of r.crew.cast) if (actor.away) away += 1;
    });
    expect(away).toBe(0);
  };

  it("keeps everyone at their desks under reduced motion", () => {
    neverWanders(office({ phase: "office", team: { engineering: 12 }, stress: 95 }, { reducedMotion: true }));
  });

  it("keeps the founder in their seat before setup is complete", () => {
    neverWanders(office({ setup: false, stress: 95 }));
  });

  it("keeps everyone in place after the run is over", () => {
    neverWanders(office({ phase: "office", team: { engineering: 12 }, over: "ipo", stress: 95 }));
  });

  it("holds wandering while a ship or launch reaction plays", () => {
    const r = office({ phase: "office", team: { engineering: 12 } });
    const state = company({ phase: "office", team: { engineering: 12 } });
    let started = 0;
    const seen = new Set<Actor>();
    run(r.crew, 60, (time) => {
      // Ship something every two and a half seconds: the room never gets a quiet moment.
      if (Math.round(time * 60) % 150 === 0) r.apply(state, [{ type: "ship", ok: true, reputationDelta: 2 }]);
      for (const actor of r.crew.cast) {
        if (actor.errand === "wander" && !seen.has(actor)) {
          seen.add(actor);
          started += 1;
        }
      }
    });
    expect(started).toBe(0);
  });

  it("shows good morale with the occasional heart or idea — sparse, not a shower", () => {
    const r = office({ phase: "office", morale: 90, team: { engineering: 6, design: 3, marketing: 3 } }, { reducedMotion: true });
    run(r.crew, 180);
    const icons = r.host.icons();
    expect(icons.every((icon) => icon === "heart" || icon === "idea")).toBe(true);
    expect(icons).toContain("heart");
    expect(icons).toContain("idea");
    // Roughly one every 3–6 s.
    expect(icons.length).toBeGreaterThanOrEqual(180 / 6 - 4);
    expect(icons.length).toBeLessThanOrEqual(180 / 3 + 4);
  });

  it("shows nothing in particular at middling morale", () => {
    const r = office({ phase: "office", morale: 50, team: { engineering: 12 } }, { reducedMotion: true });
    run(r.crew, 120);
    expect(r.host.bubbles).toHaveLength(0);
    for (const actor of r.crew.cast) expect(actor.pose).toBe("type");
  });

  it("has some people slump and doze when morale is low, with zzz over the sleepers only", () => {
    const r = office({ phase: "office", morale: 10, team: { engineering: 10, sales: 6 } }, { reducedMotion: true });
    const dozed = new Set<string>();
    let dozingFrames = 0;
    let frames = 0;
    const sleepersAt: string[][] = [];
    run(r.crew, 180, () => {
      frames += 1;
      const sleepers: string[] = [];
      for (const actor of r.crew.cast) {
        if (actor.pose === "sleep" || actor.pose === "slump") {
          dozed.add(actor.id);
          dozingFrames += 1;
        }
        if (actor.pose === "sleep") sleepers.push(actor.id);
      }
      sleepersAt.push(sleepers);
    });
    const share = dozingFrames / (frames * r.crew.cast.length);
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.7);
    expect(dozed.size).toBeGreaterThan(8);
    // The founder is the player and stays awake.
    expect(dozed.has("founder")).toBe(false);
    const icons = r.host.icons();
    expect(icons.length).toBeGreaterThan(5);
    expect(icons.every((icon) => icon === "zzz")).toBe(true);

    // Morale recovers: everyone is back at work at once.
    r.apply(company({ phase: "office", morale: 60, team: { engineering: 10, sales: 6 } }));
    r.crew.update(1 / 60);
    for (const actor of r.crew.cast) expect(actor.pose).toBe("type");
  });

  it("shows low morale within a few seconds of it being reported", () => {
    const r = office({ phase: "office", morale: 60, team: { engineering: 20 } }, { reducedMotion: true });
    run(r.crew, 30);
    r.apply(company({ phase: "office", morale: 5, team: { engineering: 20 } }));
    run(r.crew, 4);
    expect(r.crew.cast.some((actor) => actor.pose === "sleep" || actor.pose === "slump")).toBe(true);
  });

  it("has a stressed founder fret and pace near their desk, and come back", () => {
    const r = office({ phase: "office", stress: 90, team: { engineering: 3 } });
    const founder = must(r.crew, "founder");
    let paced = 0;
    let furthest = 0;
    let wasPacing = false;
    run(r.crew, 120, () => {
      const pacing = founder.errand === "pace";
      if (pacing && !wasPacing) paced += 1;
      wasPacing = pacing;
      if (pacing) furthest = Math.max(furthest, Math.hypot(founder.x - founder.home.x, founder.z - founder.home.z));
    });
    expect(paced).toBeGreaterThanOrEqual(3);
    expect(furthest).toBeGreaterThan(0.6);
    expect(furthest).toBeLessThan(3);
    expect(r.host.icons("founder").filter((icon) => icon === "stress").length).toBeGreaterThanOrEqual(3);

    // Calm again: no more pacing.
    r.apply(company({ phase: "office", stress: 20, team: { engineering: 3 } }), [{ type: "week-advanced", week: 2 }]);
    run(r.crew, 1);
    r.host.clearLog();
    let pacedAgain = false;
    run(r.crew, 60, () => {
      if (founder.errand === "pace") pacedAgain = true;
    });
    expect(pacedAgain).toBe(false);
    expect(r.host.icons("founder")).not.toContain("stress");
  });
});

describe("Crew: reactions", () => {
  const bigTeam: Partial<Record<TeamRole, number>> = { engineering: 20, design: 6, product: 4, marketing: 5, sales: 5 };

  it("ship ok: builders think in code, sparkles fly to the product wall, then a cheer — rippling, with capped bubbles", () => {
    const r = office({ phase: "public", team: bigTeam }, { reducedMotion: true });
    const state = company({ phase: "public", team: bigTeam });
    r.apply(state, [{ type: "ship", ok: true, reputationDelta: 3 }]);
    const cheered = new Set<string>();
    const bubbleTimes: number[] = [];
    let logged = 0;
    run(r.crew, 4, (time) => {
      for (const actor of r.crew.cast) if (actor.pose === "cheer") cheered.add(actor.id);
      for (; logged < r.host.bubbles.length; logged += 1) bubbleTimes.push(time);
    });
    const builders = r.crew.cast.filter((actor) => actor.role === "engineering" || actor.role === "design" || actor.role === "product");
    expect(builders).toHaveLength(30);
    expect([...cheered].sort()).toEqual(ids(builders).sort());

    expect(r.host.bubbles).toHaveLength(MAX_GROUP_BUBBLES);
    expect(r.host.icons().every((icon) => icon === "code")).toBe(true);
    expect(new Set(r.host.bubbles.map((bubble) => bubble.id)).size).toBe(MAX_GROUP_BUBBLES);
    // A ripple, not a single frame.
    expect(bubbleTimes[bubbleTimes.length - 1] - bubbleTimes[0]).toBeGreaterThan(0.2);
    expect(bubbleTimes[bubbleTimes.length - 1] - bubbleTimes[0]).toBeLessThan(0.7);

    expect(r.host.streams).toHaveLength(MAX_GROUP_BUBBLES);
    expect(r.host.streams.every((stream) => stream.station === "ship")).toBe(true);
    expect(new Set(r.host.streams.map((stream) => stream.id))).toEqual(new Set(r.host.bubbles.map((bubble) => bubble.id)));

    run(r.crew, 2);
    for (const actor of r.crew.cast) expect(actor.pose).toBe("type");
  });

  it("shows fewer bubbles when asked to (small screens)", () => {
    const studio = new Studio();
    const host = new RecordingHost();
    const crew = new Crew(host, studio.layout, { reducedMotion: true, maxGroupBubbles: 4 });
    const state = company({ phase: "public", team: bigTeam });
    studio.apply(crew, state);
    studio.apply(crew, state, [{ type: "ship", ok: true, reputationDelta: 3 }]);
    run(crew, 3);
    expect(host.bubbles).toHaveLength(4);
    expect(host.streams).toHaveLength(4);
  });

  it("ship fail: builders see bugs and slump for a couple of seconds", () => {
    const r = office({ team: { engineering: 2, design: 1, sales: 1 } }, { reducedMotion: true });
    r.apply(company({ team: { engineering: 2, design: 1, sales: 1 } }), [{ type: "ship", ok: false, reputationDelta: -3 }]);
    run(r.crew, 1);
    expect(r.host.icons().sort()).toEqual(["bug", "bug", "bug"]);
    expect(must(r.crew, "engineering-0").pose).toBe("slump");
    expect(must(r.crew, "design-0").pose).toBe("slump");
    expect(must(r.crew, "sales-0").pose).toBe("type");
    expect(r.host.streams).toHaveLength(0);
    run(r.crew, 2);
    expect(must(r.crew, "engineering-0").pose).toBe("type");
  });

  it("with no builders hired yet, the founder ships it themselves", () => {
    const r = office({ team: {} }, { reducedMotion: true });
    r.apply(company({ team: {} }), [{ type: "ship", ok: true, reputationDelta: 3 }]);
    run(r.crew, 1.2);
    expect(r.host.icons("founder")).toEqual(["code"]);
    expect(r.host.streams).toEqual([{ id: "founder", station: "ship" }]);
    expect(must(r.crew, "founder").pose).toBe("cheer");
  });

  it("launch: marketing and sales get the megaphone out (ok) or wonder what happened (fail)", () => {
    const r = office({ team: { engineering: 2, marketing: 2, sales: 1 } }, { reducedMotion: true });
    const state = company({ team: { engineering: 2, marketing: 2, sales: 1 } });
    r.apply(state, [{ type: "launch", ok: true, usersDelta: 300 }]);
    run(r.crew, 1);
    expect(r.host.icons().sort()).toEqual(["megaphone", "megaphone", "megaphone"]);
    expect(must(r.crew, "marketing-1").pose).toBe("cheer");
    expect(must(r.crew, "engineering-0").pose).toBe("type");
    run(r.crew, 3);
    r.host.clearLog();
    r.apply(state, [{ type: "launch", ok: false, usersDelta: 0 }]);
    run(r.crew, 1);
    expect(r.host.icons().sort()).toEqual(["question", "question", "question"]);
    expect(must(r.crew, "marketing-1").pose).toBe("type");
  });

  it("pitch: the founder takes the call, then the verdict", () => {
    for (const ok of [true, false]) {
      const r = office({ team: { engineering: 1 } }, { reducedMotion: true });
      r.apply(company({ team: { engineering: 1 } }), [{ type: "pitch", ok }]);
      const founder = must(r.crew, "founder");
      run(r.crew, 0.5);
      expect([founder.pose, founder.poseSeated]).toEqual(["phone", true]);
      expect(r.host.icons("founder")).toEqual(["phone"]);
      run(r.crew, 2);
      expect(r.host.icons("founder")).toEqual(["phone", ok ? "idea" : "question"]);
      expect(founder.pose).toBe("type");
      expect(r.host.icons().length).toBe(2);
    }
  });

  it("raise ok: the whole room cheers for about two seconds and the founder sees money", () => {
    const r = office({ phase: "coworking", team: { engineering: 9, sales: 3 } }, { reducedMotion: true });
    r.apply(company({ phase: "coworking", team: { engineering: 9, sales: 3 } }), [
      { type: "raise", ok: true, amount: 1_500_000, source: "vc" },
      { type: "stage-changed", from: "seed", to: "series-a" },
    ]);
    const firstCheer = new Map<string, number>();
    const lastCheer = new Map<string, number>();
    run(r.crew, 5, (time) => {
      for (const actor of r.crew.cast) {
        if (actor.pose !== "cheer") continue;
        if (!firstCheer.has(actor.id)) firstCheer.set(actor.id, time);
        lastCheer.set(actor.id, time);
      }
    });
    expect(firstCheer.size).toBe(r.crew.cast.length);
    for (const [id, start] of firstCheer) expect((lastCheer.get(id) ?? 0) - start).toBeCloseTo(2, 0);
    // It ripples: not everyone starts on the same frame.
    const starts = [...firstCheer.values()];
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(0.2);
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(0.7);
    expect(r.host.icons()).toEqual(["money"]);
    // Floor sitters got to their feet for it.
    const floorSitter = r.crew.cast.find((actor) => actor.home.kind === "overflow");
    expect(floorSitter).toBeDefined();
    expect(floorSitter?.pose).toBe("floor-sit");
  });

  it("raise fail: only the founder takes it hard", () => {
    const r = office({ team: { engineering: 2 } }, { reducedMotion: true });
    r.apply(company({ team: { engineering: 2 } }), [{ type: "raise", ok: false, amount: 0, source: "vc" }]);
    run(r.crew, 1);
    expect(must(r.crew, "founder").pose).toBe("slump");
    expect(must(r.crew, "engineering-0").pose).toBe("type");
    expect(r.host.icons()).toEqual(["stress"]);
    run(r.crew, 2.5);
    expect(must(r.crew, "founder").pose).toBe("type");
  });

  it("stage change on its own is also worth a cheer", () => {
    const r = office({ team: { engineering: 2 } }, { reducedMotion: true });
    r.apply(company({ team: { engineering: 2 } }), [{ type: "stage-changed", from: "garage", to: "seed" }]);
    run(r.crew, 0.5);
    for (const actor of r.crew.cast) expect(actor.pose).toBe("cheer");
  });

  it("gives the founder an exclamation mark for an event and a question mark for a bad command", () => {
    const r = office({ team: {} }, { reducedMotion: true });
    r.apply(company({ team: {} }), [{ type: "event-opened", title: "A journalist calls" }]);
    run(r.crew, 0.1);
    expect(r.host.icons("founder")).toEqual(["exclaim"]);
    r.host.clearLog();
    run(r.crew, 3);
    r.apply(company({ team: {} }), [{ type: "command-failed", command: "ship" }]);
    run(r.crew, 0.1);
    expect(r.host.icons("founder")).toEqual(["question"]);
  });

  it("plays the founder's bubbles one after another when several land at once", () => {
    const r = office({ team: {} }, { reducedMotion: true });
    r.apply(company({ team: {} }), [
      { type: "raise", ok: true, amount: 100, source: "vc" },
      { type: "event-opened", title: "A journalist calls" },
    ]);
    run(r.crew, 0.5);
    expect(r.host.icons("founder")).toEqual(["money"]);
    run(r.crew, 2.5);
    expect(r.host.icons("founder")).toEqual(["money", "exclaim"]);
  });

  it("coffee: the founder walks to the machine, has one, and walks back", () => {
    const r = office({ phase: "office", team: { engineering: 2 } });
    const founder = must(r.crew, "founder");
    const machine = r.studio.layout.stationStandSpots.coffee;
    r.apply(company({ phase: "office", team: { engineering: 2 } }), [{ type: "easter-egg", command: "coffee" }]);
    expect(founder.errand).toBe("coffee");
    let reached = false;
    run(r.crew, 40, () => {
      if (founder.mode === "pausing" && Math.hypot(founder.x - machine.x, founder.z - machine.z) < 1e-6) reached = true;
    });
    expect(reached).toBe(true);
    expect(r.host.icons("founder")).toContain("coffee");
    expect(founder.mode).toBe("seated");
  });

  it("coffee under reduced motion (or any other easter egg) keeps the founder seated", () => {
    const r = office({ team: {} }, { reducedMotion: true });
    r.apply(company({ team: {} }), [{ type: "easter-egg", command: "coffee" }]);
    run(r.crew, 0.2);
    expect(must(r.crew, "founder").mode).toBe("seated");
    expect(r.host.icons("founder")).toEqual(["coffee"]);
    r.host.clearLog();
    r.apply(company({ team: {} }), [{ type: "easter-egg", command: "sudo" }]);
    run(r.crew, 2);
    expect(r.host.bubbles).toHaveLength(0);
  });

  it("plays nothing for events on the very first snapshot", () => {
    const r = rig();
    r.apply(company({ team: { engineering: 3 } }), [
      { type: "ship", ok: true, reputationDelta: 1 },
      { type: "raise", ok: true, amount: 1, source: "vc" },
    ]);
    run(r.crew, 3, () => {
      for (const actor of r.crew.cast) expect(actor.pose).not.toBe("cheer");
    });
    expect(r.host.bubbles).toHaveLength(0);
    expect(r.host.streams).toHaveLength(0);
  });

  it("drops a pending reaction for someone who leaves before it plays", () => {
    const r = office({ team: { engineering: 3 } }, { reducedMotion: true });
    r.apply(company({ team: { engineering: 3 } }), [{ type: "ship", ok: true, reputationDelta: 1 }]);
    r.apply(company({ team: { engineering: 2 } }), [departed("engineering", 2)]);
    run(r.crew, 3);
    expect(r.host.bubbles.some((bubble) => bubble.id === "engineering-2")).toBe(false);
    expect(r.host.streams.some((stream) => stream.id === "engineering-2")).toBe(false);
  });
});

describe("Crew: a new week", () => {
  it("has whoever is away trot back, and snaps them into their seat within a second", () => {
    const r = office({ phase: "office", team: { engineering: 12 } });
    const state = company({ phase: "office", team: { engineering: 12 } });
    r.apply(state, [{ type: "easter-egg", command: "coffee" }]);
    run(r.crew, 2);
    const founder = must(r.crew, "founder");
    expect(founder.away).toBe(true);
    r.apply({ ...state, week: 2 }, [{ type: "week-advanced", week: 2 }]);
    run(r.crew, 0.3);
    expect(founder.away).toBe(true);
    run(r.crew, 0.6);
    expectAllSeated(r);
    expect(founder.errand).toBeNull();
  });

  it("snaps at once under reduced motion", () => {
    const r = office({ team: { engineering: 1 } }, { reducedMotion: true });
    r.apply(company({ team: { engineering: 2 } }), [hired("engineering", 1)]);
    run(r.crew, 1);
    expect(must(r.crew, "engineering-1").away).toBe(true);
    r.apply(company({ team: { engineering: 2 }, week: 2 }), [{ type: "week-advanced", week: 2 }]);
    expectAllSeated(r);
  });

  it("clears reactions that were still playing", () => {
    const r = office({ team: { engineering: 3 } }, { reducedMotion: true });
    r.apply(company({ team: { engineering: 3 } }), [{ type: "raise", ok: true, amount: 5, source: "vc" }]);
    run(r.crew, 0.5);
    r.apply(company({ team: { engineering: 3 }, week: 2 }), [{ type: "week-advanced", week: 2 }]);
    r.crew.update(1 / 60);
    for (const actor of r.crew.cast) expect(actor.pose).toBe("type");
  });

  it("lets people who quit or join at the week's end do so after sunrise, at a walk", () => {
    const r = office({ team: { engineering: 3 } }, STILL);
    const quitter = must(r.crew, "engineering-2");
    r.apply(company({ team: { engineering: 2, design: 1 }, week: 2 }), [
      departed("engineering", 2),
      hired("design", 0),
      { type: "week-advanced", week: 2 },
    ]);
    run(r.crew, 1.2);
    // Still night: nobody has moved yet.
    expect(quitter.mode).toBe("seated");
    expect(must(r.crew, "design-0").visible).toBe(false);
    let quitterWalked = false;
    let joinerWalked = false;
    run(r.crew, 20, () => {
      if (quitter.pose === "walk") quitterWalked = true;
      if (r.crew.actor("design-0")?.pose === "walk") joinerWalked = true;
    });
    expect(quitterWalked).toBe(true);
    expect(joinerWalked).toBe(true);
    expectAllSeated(r);
    expectBodiesMatch(r);
  });
});

describe("Crew: the end of the run", () => {
  it("win: sustained cheering, with wanderers called back first", () => {
    const r = office({ phase: "office", team: { engineering: 10 } });
    const state = company({ phase: "office", team: { engineering: 10 } });
    r.apply(state, [{ type: "easter-egg", command: "coffee" }]);
    run(r.crew, 1.5);
    r.apply({ ...state, gameOver: { ending: "ipo", week: 9, headline: "IPO" } }, [{ type: "game-over", ending: "ipo" }]);
    run(r.crew, 2);
    expectAllSeated(r);
    // A party for the first quarter of a minute or so, then the odd cheer — forever.
    for (const [seconds, least, most] of [
      [5, 0.5, 1],
      [10, 0.5, 1],
      [10, 0, 1],
      [60, 0.05, 0.3],
    ] as const) {
      let cheering = 0;
      run(r.crew, seconds, () => {
        for (const actor of r.crew.cast) if (actor.pose === "cheer") cheering += 1;
      });
      const share = cheering / (seconds * 60 * r.crew.cast.length);
      expect(share).toBeGreaterThanOrEqual(least);
      expect(share).toBeLessThanOrEqual(most);
    }
    expect(r.crew.cast).toHaveLength(12);
  });

  it("loss: everyone slumps, then the staff walk out one by one and the founders stay", () => {
    const r = office({ phase: "coworking", team: { engineering: 4, sales: 2 } });
    const state = company({ phase: "coworking", team: { engineering: 4, sales: 2 } });
    const staff = r.crew.cast.filter((actor) => actor.kind === "employee");
    r.apply({ ...state, gameOver: { ending: "bankruptcy", week: 9, headline: "Bust" } }, [
      { type: "game-over", ending: "bankruptcy" },
    ]);
    expect(ids(r.crew.cast)).toEqual(["founder", "cofounder"]);
    expect(r.crew.departing).toHaveLength(6);

    run(r.crew, 1);
    for (const actor of [...r.crew.cast, ...staff]) expect(actor.pose, actor.id).toBe("slump");

    const stoodUp = new Map<Actor, number>();
    run(r.crew, 40, (time) => {
      for (const actor of staff) if (actor.mode !== "seated" && !stoodUp.has(actor)) stoodUp.set(actor, time);
    });
    const times = staff.map((actor) => stoodUp.get(actor) ?? NaN).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeGreaterThan(0.3);
    expect(r.crew.departing).toHaveLength(0);
    expect(r.host.alive.size).toBe(2);
    expect(must(r.crew, "founder").pose).toBe("slump");
    expect(must(r.crew, "cofounder").pose).toBe("slump");

    // The player keeps typing after the end: nobody comes back.
    r.apply({ ...state, gameOver: { ending: "bankruptcy", week: 9, headline: "Bust" } }, []);
    run(r.crew, 5);
    expect(r.host.alive.size).toBe(2);
  });

  it("loss with a big company: the exodus still finishes in reasonable time", () => {
    const team = { engineering: 30, sales: 20 };
    const r = office({ phase: "public", team });
    r.apply({ ...company({ phase: "public", team }), gameOver: { ending: "zombie-saas", week: 30, headline: "Zombie" } }, [
      { type: "game-over", ending: "zombie-saas" },
    ]);
    run(r.crew, 45);
    expect(r.host.alive.size).toBe(2);
  });

  it("loss: the staff file out through the door without walking through each other", () => {
    const team = { engineering: 6, design: 2, product: 2, marketing: 2, sales: 2 };
    const r = office({ phase: "office", team });
    run(r.crew, 1);
    r.apply({ ...company({ phase: "office", team }), gameOver: { ending: "bankruptcy", week: 9, headline: "Bust" } }, [
      { type: "game-over", ending: "bankruptcy" },
    ]);
    let closest = Infinity;
    run(r.crew, 30, () => {
      const walking = r.crew.departing.filter((actor) => actor.visible && actor.mode === "walking");
      for (let i = 0; i < walking.length; i += 1) {
        for (let j = i + 1; j < walking.length; j += 1) {
          closest = Math.min(closest, Math.hypot(walking[i].x - walking[j].x, walking[i].z - walking[j].z));
        }
      }
    });
    expect(closest).toBeGreaterThan(0.4);
    expect(r.crew.departing).toHaveLength(0);
    expect(r.host.alive.size).toBe(2);
  });

  it("layoffs file out a step apart: nobody walks up to the leaver ahead, or waits behind one fading out at the door", () => {
    // Rounds of layoffs a moment apart, so a new round gets up while the last one is
    // still filing out. Every queue decision is checked against the cast as it stands
    // at that moment, not as it stood at the top of the frame: leavers ahead may have
    // set off, re-pathed or reached the door earlier in the same frame.
    const layoffs = [
      { phase: "office" as const, staff: 16, round: 4, every: 2 },
      { phase: "public" as const, staff: 32, round: 8, every: 1 },
    ];
    let decisions = 0;
    const wrong: string[] = [];
    for (const { phase, staff, round, every } of layoffs) {
      const team = (engineering: number) => ({ engineering, sales: 6, design: 4 });
      for (let seed = 1; seed <= 4; seed += 1) {
        const r = office({ phase, team: team(staff) }, { seed });
        const queueBehind = r.crew.queueBehind.bind(r.crew);
        r.crew.queueBehind = (actor: Actor): boolean => {
          const waits = queueBehind(actor);
          decisions += 1;
          const ahead = r.crew.departing.find(
            (other) =>
              other !== actor &&
              other.mode === "walking" &&
              other.visible &&
              other.distanceLeft < actor.distanceLeft &&
              Math.hypot(other.x - actor.x, other.z - actor.z) < DOOR_QUEUE_GAP,
          );
          if (waits !== (ahead !== undefined)) {
            wrong.push(`${phase} seed ${seed}: ${actor.id} ${waits ? "waited with nobody walking just ahead" : `walked up to ${ahead?.id ?? "?"}`}`);
          }
          return waits;
        };
        run(r.crew, 2 + seed);
        for (let left = staff; left > 0; left -= round) {
          const out = Array.from({ length: round }, (_, index) => left - round + index);
          r.apply(company({ phase, team: team(left - round) }), [departed("engineering", ...out)]);
          run(r.crew, every);
        }
        run(r.crew, 40);
        expect(r.crew.departing, `${phase} seed ${seed}`).toHaveLength(0);
      }
    }
    expect(decisions).toBeGreaterThan(10_000);
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it("a newcomer waits outside while somebody is walking out, and a leaver waits for a newcomer to get in", () => {
    const r = office({ phase: "office", team: { engineering: 3 } }, STILL);
    // One out, one in, in the same batch: the leaver goes first and the newcomer waits for the doorway.
    r.apply(company({ phase: "office", team: { engineering: 2, design: 1 } }), [departed("engineering", 2), hired("design", 0)]);
    let together = 0;
    run(r.crew, 30, () => {
      const leaver = r.crew.departing.find((actor) => actor.exiting);
      const newcomer = r.crew.cast.find((actor) => actor.arriving);
      if (leaver && newcomer) together += 1;
    });
    expect(together).toBe(0);
    expect(r.crew.actor("design-0")?.mode).toBe("seated");
    expect(r.crew.departing).toHaveLength(0);
    // And the other way round: somebody already walking in holds up a leaver at their desk.
    r.apply(company({ phase: "office", team: { engineering: 2, design: 2 } }), [hired("design", 1)]);
    run(r.crew, 0.5);
    expect(r.crew.actor("design-1")?.arriving).toBe(true);
    r.apply(company({ phase: "office", team: { engineering: 1, design: 2 } }), [departed("engineering", 1)]);
    run(r.crew, 0.5);
    const leaver = r.crew.departing.find((actor) => actor.id === "engineering-1");
    expect(leaver?.mode).toBe("seated");
    run(r.crew, 30);
    expect(r.crew.departing).toHaveLength(0);
  });

  it("a lost run loaded from a save shows just the founders, slumped", () => {
    const r = office({ team: { engineering: 5 }, over: "founder-removal" });
    expect(ids(r.crew.cast)).toEqual(["founder", "cofounder"]);
    expect(must(r.crew, "founder").pose).toBe("slump");
    expectBodiesMatch(r);
  });

  it("a won run loaded from a save is already celebrating", () => {
    const r = office({ team: { engineering: 5 }, over: "acquisition" });
    expect(r.crew.cast).toHaveLength(7);
    let cheering = 0;
    run(r.crew, 10, () => {
      for (const actor of r.crew.cast) if (actor.pose === "cheer") cheering += 1;
    });
    expect(cheering).toBeGreaterThan(0);
  });
});

describe("Crew: lifecycle", () => {
  it("dispose frees every body, including people who were walking out", () => {
    const r = office({ team: { engineering: 4 } });
    r.apply(company({ team: { engineering: 3 } }), [departed("engineering", 3)]);
    run(r.crew, 0.5);
    r.crew.dispose();
    expect(r.host.alive.size).toBe(0);
    expect(r.host.spawnCount).toBe(r.host.despawnCount);
    expect(r.crew.cast).toHaveLength(0);
  });

  it("plays out identically for the same inputs", () => {
    const play = (): string => {
      const r = office({ phase: "office", morale: 20, stress: 80, team: { engineering: 8, sales: 4 } }, { seed: 7 });
      const trace: string[] = [];
      run(r.crew, 60, (time) => {
        if (Math.round(time * 60) % 30 === 0) trace.push(r.crew.cast.map((actor) => `${actor.mode}:${actor.pose}:${actor.x.toFixed(3)}`).join("|"));
      });
      return trace.join("\n") + r.host.icons().join(",");
    };
    expect(play()).toBe(play());
  });

  it("survives a long, hostile sequence of snapshots with nobody stuck or leaked", () => {
    const r = rig({ seed: 3 });
    const phases = ["garage", "coworking", "office", "unicorn", "public"] as const;
    const roles: TeamRole[] = ["engineering", "design", "marketing", "sales", "ops"];
    const team: Record<string, number> = { engineering: 1, design: 0, marketing: 0, sales: 0, ops: 0 };
    let phase = 0;
    let week = 1;
    // A fixed pseudo-random script so a failure is reproducible.
    let state = 12345;
    const roll = (n: number): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return (state >>> 8) % n;
    };
    const build = (): GameState =>
      company({ phase: phases[phase], team, week, morale: 10 + roll(90), stress: roll(100) });

    r.apply(build());
    for (let step = 0; step < 400; step += 1) {
      const events: WorldEvent[] = [];
      const role = roles[roll(roles.length)];
      switch (roll(9)) {
        case 0:
        case 1: {
          const count = 1 + roll(4);
          events.push(hired(role, ...Array.from({ length: count }, (_, i) => team[role] + i)));
          team[role] += count;
          break;
        }
        case 2:
          if (team[role] > 0) {
            team[role] -= 1;
            events.push(departed(role, team[role]));
          }
          break;
        case 3:
          if (roll(3) === 0) {
            const from = phases[phase];
            phase = Math.min(phases.length - 1, Math.max(0, phase + (roll(3) === 0 ? -1 : 1)));
            if (phases[phase] !== from) events.push({ type: "phase-changed", from, to: phases[phase] });
          }
          break;
        case 4:
          week += 1;
          events.push({ type: "week-advanced", week });
          break;
        case 5:
          events.push({ type: "ship", ok: roll(2) === 0, reputationDelta: 1 });
          break;
        case 6:
          events.push({ type: "raise", ok: roll(2) === 0, amount: 10, source: "vc" });
          break;
        case 7:
          events.push({ type: "easter-egg", command: "coffee" });
          break;
        default:
          break;
      }
      r.apply(build(), events);
      // Anything from a single frame to a few seconds between commands, in uneven frames.
      const frames = 1 + roll(120);
      for (let i = 0; i < frames; i += 1) r.crew.update(roll(4) === 0 ? 0.1 : 1 / 60);

      expectBodiesMatch(r);
      for (const actor of r.crew.cast) {
        expect(r.studio.seating.seatOf(actor.id), actor.id).toBe(actor.home);
        expect(Number.isFinite(actor.x + actor.z + actor.facing + actor.scale), actor.id).toBe(true);
      }
      expect(new Set(ids(r.crew.cast)).size).toBe(r.crew.cast.length);
    }

    // Leave the room alone for a while with nothing to wander for: everyone ends up seated.
    r.apply(company({ phase: phases[phase], team, week, morale: 50, stress: 0, over: "ipo" }), [
      { type: "game-over", ending: "ipo" },
    ]);
    run(r.crew, 30);
    expectAllSeated(r);
    expect(r.crew.departing).toHaveLength(0);
    expectBodiesMatch(r);
  });
});
