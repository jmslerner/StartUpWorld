import { describe, expect, it } from "vitest";
import { MAX_STAFF_DRAWN, nextCast } from "../cast";
import type { Cast } from "../cast";
import { doorExterior } from "../office/layouts";
import type { OfficeIndex, OfficeScene } from "../types";
import { POP_SECONDS } from "./actor";
import type { Actor } from "./actor";
import { alreadyInside, Crew, DOOR_QUEUE_GAP, ENTRY_STAGGER, MAX_FIGURES, wanderCap, YEAR_DELAY } from "./crew";
import { RecordingHost, run, scene, Studio } from "./testKit";

type Teams = readonly [number, number, number];

interface Rig {
  studio: Studio;
  host: RecordingHost;
  crew: Crew;
  /** Push a scene through, as the World would. */
  apply(teams: Teams, patch?: Partial<OfficeScene>): void;
}

const rig = (options: { reducedMotion?: boolean; seed?: number } = {}): Rig => {
  const studio = new Studio();
  const host = new RecordingHost();
  const crew = new Crew(host, studio.layout, { reducedMotion: options.reducedMotion ?? false, seed: options.seed });
  return { studio, host, crew, apply: (teams, patch = {}) => void studio.apply(crew, scene(teams, patch)) };
};

/** A rig with a company already in place (first scene applied). */
const office = (teams: Teams, patch: Partial<OfficeScene> = {}, rigOptions: { reducedMotion?: boolean; seed?: number } = {}): Rig => {
  const built = rig(rigOptions);
  built.apply(teams, patch);
  return built;
};

const must = (crew: Crew, id: string): Actor => {
  const actor = crew.actor(id);
  if (!actor) throw new Error(`no actor for ${id}`);
  return actor;
};

const ids = (actors: readonly Actor[]): string[] => actors.map((actor) => actor.id);

/** Long enough for anything a frame set in motion to have ended, a wander that started late included. */
const SETTLED = 80;

/** Everyone in the cast is at the place the plan gives them. */
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
    expect([0, 1, 8, 12, 16, 24, 40, 56, 200].map(wanderCap)).toEqual([1, 1, 1, 2, 2, 3, 5, 5, 5]);
  });

  describe("who was in the building all along", () => {
    const at = (prev: OfficeScene, next: OfficeScene): { cast: Cast; before: Cast } => {
      const before = nextCast(null, prev);
      return { cast: nextCast(before, next), before };
    };

    it("is nobody while everyone is drawn", () => {
      const { cast, before } = at(scene([2, 0, 0]), scene([5, 0, 0]));
      expect(cast.arrived).toHaveLength(3);
      expect(alreadyInside(cast, before)).toEqual(new Set());
      expect(alreadyInside(cast, null)).toEqual(new Set());
    });

    it("is as many staff arrivals as the last cast had people on the sign, in id order", () => {
      // 52 people, 50 drawn (45 at work, 5 leaving), 2 on the sign. A year on, five take the leavers' places.
      const { cast, before } = at(scene([47, 0, 0], { office: 4, leaving: 5 }), scene([52, 0, 0], { office: 4, year: 1991 }));
      expect(before.hidden).toBe(2);
      expect(cast.arrived).toEqual(["p50", "p51", "p52", "p53", "p54"]);
      expect(alreadyInside(cast, before)).toEqual(new Set(["p50", "p51"]));
    });

    it("never includes the people expected at the door", () => {
      const { cast, before } = at(scene([150, 0, 0], { office: 4 }), scene([150, 0, 0], { office: 4, arriving: 3 }));
      expect(before.hidden).toBe(100);
      expect(cast.arrived).toHaveLength(3);
      expect(alreadyInside(cast, before)).toEqual(new Set());
    });
  });
});

describe("Crew: who is in the office", () => {
  it("places everyone at once on a fresh cast: one actor per person with a seat who is not away", () => {
    const r = office([3, 2, 1], { away: 1, leaving: 1, arriving: 2 });
    // p0 … p5 at work, p6 away, p7 leaving, p8 and p9 expected.
    expect(ids(r.crew.cast)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p7", "p8", "p9"]);
    expect(r.crew.actor("p6")).toBeNull();
    expect(r.studio.seating.seatOf("p6")?.kind).toBe("desk");
    expectAllSeated(r);
    expectBodiesMatch(r);
    expect(r.crew.busy()).toBe(false);
    expect(r.host.bubbles).toEqual([]);
    expect(r.host.puffs).toEqual([]);
    expect(must(r.crew, "p0").pose).toBe("type");
    // At the door people stand; the one let go holds a box.
    expect([must(r.crew, "p7").pose, must(r.crew, "p7").carrying]).toEqual(["stand", true]);
    expect([must(r.crew, "p8").pose, must(r.crew, "p8").carrying]).toEqual(["stand", false]);
  });

  it("gives nobody a body when the office has no room for them", () => {
    const r = office([6, 0, 0], { office: 0, arriving: 6 });
    // Four desks and four spots at the door.
    expect(ids(r.crew.cast)).toEqual(["p0", "p1", "p2", "p3", "p6", "p7", "p8", "p9"]);
    expect(r.studio.seating.hiddenCount()).toBe(2);
    expectBodiesMatch(r);
  });

  it("gives people their team, and nobody one they do not have", () => {
    const r = office([1, 1, 1], { leaving: 1, arriving: 1 });
    expect(r.crew.cast.map((actor) => actor.team)).toEqual(["product", "growth", "recruiting", null, null]);
  });
});

describe("Crew: arriving", () => {
  it("walks somebody who arrives from outside the door to their seat, with a wave and a puff of dust", () => {
    const r = office([1, 0, 0]);
    r.apply([2, 0, 0]);
    expect(r.studio.cast?.arrived).toEqual(["p1"]);
    const hire = must(r.crew, "p1");
    const outside = doorExterior(r.studio.layout, 0.8);
    expect(r.crew.busy()).toBe(true);
    r.crew.update(1 / 60);
    expect(hire.visible).toBe(true);
    expect(Math.hypot(hire.x - outside.x, hire.z - outside.z)).toBeLessThan(0.1);
    expect(r.host.icons("p1")).toEqual(["wave"]);
    expect(r.host.puffs).toHaveLength(0);

    let walked = false;
    run(r.crew, SETTLED, () => {
      if (hire.pose === "walk") walked = true;
    });
    expect(walked).toBe(true);
    expectAllSeated(r);
    const seat = r.studio.seating.seatOf("p1");
    expect(r.host.dustAt(seat?.x ?? NaN, seat?.z ?? NaN)).toBe(true);
    // Nobody else changed seats.
    expect(r.host.puffs).toHaveLength(1);
    expect(r.crew.busy()).toBe(false);
  });

  it("files several arrivals in about a third of a second apart", () => {
    const r = office([0, 0, 0]);
    r.apply([4, 0, 0]);
    const appeared = new Map<string, number>();
    run(r.crew, 3, (time) => {
      for (const actor of r.crew.cast) if (actor.visible && !appeared.has(actor.id)) appeared.set(actor.id, time);
    });
    const times = [0, 1, 2, 3].map((index) => appeared.get(`p${index}`) ?? NaN);
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeCloseTo(ENTRY_STAGGER, 1);
    expect(times[0]).toBeLessThan(0.05);
  });

  it("keeps the queue when arrivals come one scene after another", () => {
    const r = office([0, 0, 0]);
    r.apply([0, 1, 0]);
    run(r.crew, 0.1);
    r.apply([0, 2, 0]);
    r.crew.update(1 / 60);
    // The second has to wait their turn even though the scene came 0.1 s later.
    expect(must(r.crew, "p1").visible).toBe(false);
    expect(r.crew.busy()).toBe(true);
    run(r.crew, ENTRY_STAGGER);
    expect(must(r.crew, "p1").visible).toBe(true);
    run(r.crew, SETTLED);
    expectAllSeated(r);
  });

  it("is not disturbed by the same scene arriving again while someone is walking in", () => {
    const r = office([1, 0, 0]);
    r.apply([2, 0, 0]);
    const hire = must(r.crew, "p1");
    let last = { x: NaN, z: NaN };
    let biggestStep = 0;
    run(r.crew, 12, (time) => {
      if (Math.round(time * 60) % 7 === 0) r.apply([2, 0, 0]);
      if (hire.visible && Number.isFinite(last.x)) biggestStep = Math.max(biggestStep, Math.hypot(hire.x - last.x, hire.z - last.z));
      if (hire.visible) last = { x: hire.x, z: hire.z };
    });
    // Never teleported: no frame moved them further than a brisk step.
    expect(biggestStep).toBeLessThan(0.1);
    expect(must(r.crew, "p1")).toBe(hire);
    expect(r.host.spawnCount).toBe(2);
    run(r.crew, SETTLED);
    expectAllSeated(r);
  });

  it("walks the people expected in to stand at the door, and from there to a desk when they are hired", () => {
    const r = office([2, 0, 0]);
    r.apply([2, 0, 0], { arriving: 2 });
    const first = must(r.crew, "p2");
    run(r.crew, SETTLED);
    expectAllSeated(r);
    expect(r.host.icons()).toContain("wave");
    expect([first.home.kind, first.pose, first.team]).toEqual(["waiting", "stand", null]);
    const spawned = r.host.spawnCount;

    // The year plays out: they are on the staff now. The same two people, walking from the door to a desk.
    r.apply([4, 0, 0], { year: 1991 });
    expect(r.studio.cast?.arrived).toEqual([]);
    expect(must(r.crew, "p2")).toBe(first);
    expect(first.team).toBe("product");
    expect(r.crew.busy()).toBe(true);
    run(r.crew, 0.6);
    expect(first.mode).toBe("walking");
    // From where they stood, not from outside.
    const spot = r.studio.layout.waitingSpots[0];
    expect(Math.hypot(first.x - spot.x, first.z - spot.z)).toBeLessThan(1);
    run(r.crew, SETTLED);
    expectAllSeated(r);
    expect([first.home.kind, first.pose]).toEqual(["desk", "type"]);
    expect(r.host.spawnCount).toBe(spawned);
  });

  it("pops in (no walk) somebody who gets a seat without arriving", () => {
    // The garage: four desks, all Product's; the one of Growth has none.
    const r = office([4, 1, 0], { office: 0 });
    expect(r.crew.actor("p4")).toBeNull();
    // One of Product's goes, so Growth's area reaches the last desk.
    r.apply([3, 1, 0], { office: 0 });
    expect(r.studio.cast?.arrived).toEqual([]);
    const shown = must(r.crew, "p4");
    r.crew.update(1 / 60);
    expect(shown.visible).toBe(true);
    expect([shown.x, shown.z]).toEqual([shown.home.x, shown.home.z]);
    run(r.crew, POP_SECONDS + 0.1);
    expect(shown.mode).toBe("seated");
    expect(shown.scale).toBe(1);
    expect(r.host.icons("p4")).toEqual([]);
  });

  it("at the cap, people who were counted on the sign take a freed place without a walk from the door", () => {
    // 52 people in the campus: 50 drawn (45 at work, 5 leaving) and 2 on the sign.
    const r = office([47, 0, 0], { office: 4, capacity: 150, leaving: 5 });
    expect(r.studio.cast?.hidden).toBe(2);
    r.apply([52, 0, 0], { office: 4, capacity: 150, year: 1991 });
    expect(r.studio.cast?.arrived).toEqual(["p50", "p51", "p52", "p53", "p54"]);
    run(r.crew, 0.05);
    // The first two were in the building all along: they are simply at their desks.
    for (const id of ["p50", "p51"]) {
      const actor = must(r.crew, id);
      expect(actor.arriving, id).toBe(false);
      expect([actor.visible, actor.x, actor.z], id).toEqual([true, actor.home.x, actor.home.z]);
    }
    // The other three are new, and walk in once the year's sweep is over.
    for (const id of ["p52", "p53", "p54"]) expect(must(r.crew, id).visible, id).toBe(false);
    let arriving = 0;
    run(r.crew, YEAR_DELAY + 3, () => {
      arriving = Math.max(arriving, r.crew.cast.filter((actor) => actor.arriving).length);
    });
    expect(arriving).toBe(3);
    expect(r.host.icons().filter((icon) => icon === "wave")).toHaveLength(3);
    run(r.crew, SETTLED);
    expectAllSeated(r);
    expect(r.crew.cast).toHaveLength(50);
  });
});

describe("Crew: leaving", () => {
  it("walks somebody who left out with a box, unclickable from the start, and frees the body at the door", () => {
    const r = office([3, 0, 0]);
    const leaver = must(r.crew, "p2");
    r.apply([2, 0, 0]);
    expect(r.studio.cast?.left).toEqual(["p2"]);
    expect(r.crew.actor("p2")).toBeNull();
    expect(ids(r.crew.departing)).toEqual(["p2"]);
    expect(r.host.retired.has(leaver)).toBe(true);
    expect(r.host.alive.has(leaver)).toBe(true);
    expect(r.crew.busy()).toBe(true);

    let carried = false;
    let last = { x: leaver.x, z: leaver.z };
    run(r.crew, 30, () => {
      if (leaver.pose === "walk" && leaver.carrying) carried = true;
      if (leaver.visible) last = { x: leaver.x, z: leaver.z };
    });
    expect(carried).toBe(true);
    expect(leaver.gone).toBe(true);
    const outside = doorExterior(r.studio.layout, 0.8);
    expect(Math.hypot(last.x - outside.x, last.z - outside.z)).toBeLessThan(0.2);
    expect(r.crew.departing).toHaveLength(0);
    expect(r.host.alive.has(leaver)).toBe(false);
    expectBodiesMatch(r);
  });

  it("somebody let go packs a box and stands at the door, then walks out when the year has played out", () => {
    const r = office([3, 0, 0]);
    const leaver = must(r.crew, "p2");
    r.apply([2, 0, 0], { leaving: 1 });
    // Still with the company: the same actor, on the way to the door, in the shirt they had.
    expect(r.studio.cast?.left).toEqual([]);
    expect(must(r.crew, "p2")).toBe(leaver);
    expect([leaver.home.kind, leaver.packed, leaver.team]).toEqual(["waiting", true, "product"]);
    run(r.crew, SETTLED);
    expectAllSeated(r);
    expect([leaver.pose, leaver.carrying]).toEqual(["stand", true]);
    expect(r.crew.busy()).toBe(false);

    r.apply([2, 0, 0], { year: 1991 });
    expect(r.studio.cast?.left).toEqual(["p2"]);
    expect(ids(r.crew.departing)).toEqual(["p2"]);
    // They wait for the year's sweep, box in hand, and then go.
    run(r.crew, YEAR_DELAY - 0.1);
    expect([leaver.mode, leaver.carrying]).toEqual(["seated", true]);
    run(r.crew, 30);
    expect(leaver.gone).toBe(true);
    expect(r.crew.departing).toHaveLength(0);
    expect(r.crew.busy()).toBe(false);
  });

  it("a layoff undone within the year sends the same person back to a desk, without the box", () => {
    const r = office([3, 0, 0]);
    const person = must(r.crew, "p2");
    r.apply([2, 0, 0], { leaving: 1 });
    run(r.crew, 2);
    r.apply([3, 0, 0]);
    expect(must(r.crew, "p2")).toBe(person);
    expect([person.home.kind, person.packed]).toEqual(["desk", false]);
    run(r.crew, SETTLED);
    expectAllSeated(r);
    expect([person.pose, person.carrying]).toEqual(["type", false]);
    expect(r.host.spawnCount).toBe(3);
  });

  it("somebody expected who never joined walks off without a box", () => {
    const r = office([1, 0, 0], { arriving: 1 });
    const expected = must(r.crew, "p1");
    r.apply([1, 0, 0]);
    expect(r.studio.cast?.left).toEqual(["p1"]);
    let carried = false;
    run(r.crew, 30, () => {
      if (expected.carrying) carried = true;
    });
    expect(expected.gone).toBe(true);
    expect(carried).toBe(false);
  });

  it("copes with someone leaving before they have even reached their desk", () => {
    const r = office([1, 0, 0]);
    r.apply([2, 0, 0]);
    run(r.crew, 1.2);
    const hire = must(r.crew, "p1");
    expect(hire.mode).toBe("walking");
    r.apply([1, 0, 0]);
    run(r.crew, 30);
    expect(hire.gone).toBe(true);
    expect(r.crew.departing).toHaveLength(0);
    expectBodiesMatch(r);
  });

  it("drops someone who left before their turn to walk in", () => {
    const r = office([0, 0, 0]);
    r.apply([3, 0, 0]);
    const last = must(r.crew, "p2");
    expect(last.visible).toBe(false);
    r.apply([2, 0, 0]);
    r.crew.update(1 / 60);
    expect(last.gone).toBe(true);
    expect(r.host.alive.has(last)).toBe(false);
    expectBodiesMatch(r);
  });

  it("staggers a round of departures", () => {
    const r = office([6, 0, 0]);
    r.apply([2, 0, 0]);
    const started = new Map<string, number>();
    run(r.crew, 4, (time) => {
      for (const actor of r.crew.departing) if (actor.mode !== "seated" && !started.has(actor.id)) started.set(actor.id, time);
    });
    const times = [...started.values()].sort((a, b) => a - b);
    expect(times).toHaveLength(4);
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeCloseTo(ENTRY_STAGGER, 1);
  });

  it("just fades out somebody who lost their seat without leaving the company", () => {
    // The garage: three of Product, one of Growth at the last desk. A hire into Product takes Growth's only desk.
    const r = office([3, 1, 0], { office: 0 });
    const squeezed = must(r.crew, "p3");
    r.apply([4, 1, 0], { office: 0 });
    expect(r.studio.cast?.left).toEqual([]);
    expect(r.studio.seating.seatOf("p3")).toBeNull();
    expect(r.crew.actor("p3")).toBeNull();
    expect(squeezed.mode).toBe("vanishing");
    run(r.crew, 0.5);
    expect(squeezed.gone).toBe(true);
    expect(squeezed.carrying).toBe(false);
    expect(r.studio.seating.hiddenCount()).toBe(1);
  });
});

describe("Crew: someone away", () => {
  it("walks out empty-handed, keeps the desk, and walks back in when the year is over", () => {
    const r = office([2, 1, 0]);
    const going = must(r.crew, "p2");
    const desk = r.studio.seating.seatOf("p2");
    r.apply([2, 0, 0], { away: 1 });
    expect(r.studio.cast?.people[2].standing).toBe("away");
    expect(r.studio.cast?.left).toEqual([]);
    expect(r.crew.actor("p2")).toBeNull();
    expect(ids(r.crew.departing)).toEqual(["p2"]);
    let carried = false;
    run(r.crew, 30, () => {
      if (going.carrying) carried = true;
    });
    expect([going.gone, carried]).toEqual([true, false]);
    // Nobody is drawn for them, and the desk is still theirs.
    expect(r.crew.cast).toHaveLength(2);
    expect(r.studio.seating.seatOf("p2")).toBe(desk);
    expect(r.crew.busy()).toBe(false);

    r.apply([2, 1, 0], { year: 1991 });
    expect(r.studio.cast?.arrived).toEqual([]);
    const back = must(r.crew, "p2");
    expect(back).not.toBe(going);
    expect(back.home).toBe(desk);
    run(r.crew, YEAR_DELAY + 0.3);
    expect(back.arriving).toBe(true);
    run(r.crew, SETTLED);
    expectAllSeated(r);
    expect(back.pose).toBe("type");
  });

  it("back before they are out of the door: the earlier figure walks out, and the two are never seen together", () => {
    const r = office([2, 1, 0]);
    const going = must(r.crew, "p2");
    r.apply([2, 0, 0], { away: 1 });
    run(r.crew, 1);
    expect([going.mode, going.exiting]).toEqual(["walking", true]);
    // The plan is undone within the year: the same person, at work again.
    r.apply([2, 1, 0]);
    expect(r.studio.cast?.arrived).toEqual([]);
    const back = must(r.crew, "p2");
    expect(back).not.toBe(going);
    // Two figures for one person for a while: the one on the way out, and the one waiting outside to come in.
    expect([r.host.alive.has(going), r.host.alive.has(back)]).toEqual([true, true]);
    expect([going.visible, back.visible]).toEqual([true, false]);
    expect(r.host.retired.has(going)).toBe(true);
    expect(r.host.retired.has(back)).toBe(false);
    let together = 0;
    let most = 0;
    let cameIn = false;
    run(r.crew, 30, () => {
      const seen = [...r.host.alive].filter((actor) => actor.id === "p2" && actor.visible);
      if (seen.length > 1) together += 1;
      most = Math.max(most, r.host.alive.size);
      if (back.arriving) cameIn = true;
    });
    expect(together).toBe(0);
    expect(most).toBeLessThanOrEqual(MAX_FIGURES);
    expect(cameIn).toBe(true);
    expect(going.gone).toBe(true);
    expect(r.host.alive.has(going)).toBe(false);
    run(r.crew, SETTLED);
    expectAllSeated(r);
    expect(must(r.crew, "p2")).toBe(back);
    expect(r.crew.departing).toHaveLength(0);
    expect(r.crew.busy()).toBe(false);
    expectBodiesMatch(r);
  });

  it("back before they have even got up: the newcomer still waits outside until the earlier figure is gone", () => {
    const r = office([2, 1, 0]);
    const going = must(r.crew, "p2");
    // Both scenes land between two frames.
    r.apply([2, 0, 0], { away: 1 });
    r.apply([2, 1, 0]);
    const back = must(r.crew, "p2");
    expect(back).not.toBe(going);
    let together = 0;
    run(r.crew, 30, () => {
      if (going.visible && !going.gone && back.visible) together += 1;
    });
    expect(together).toBe(0);
    expect(going.gone).toBe(true);
    run(r.crew, SETTLED);
    expectAllSeated(r);
    expect(r.crew.busy()).toBe(false);
    expectBodiesMatch(r);
  });

  it("is simply not there on a fresh cast, and simply back under reduced motion", () => {
    const r = office([2, 0, 0], { away: 1 }, { reducedMotion: true });
    expect(ids(r.crew.cast)).toEqual(["p0", "p1"]);
    r.apply([3, 0, 0]);
    expect(ids(r.crew.cast)).toEqual(["p0", "p1", "p2"]);
    expectAllSeated(r);
    expect(r.crew.busy()).toBe(false);
    r.apply([2, 0, 0], { away: 1 });
    expect(ids(r.crew.cast)).toEqual(["p0", "p1"]);
    expect(r.crew.departing).toHaveLength(0);
    expect(r.crew.busy()).toBe(false);
  });
});

describe("Crew: never more figures than are drawn", () => {
  /** Step the crew, checking the number of bodies after every frame. Returns the most there were. */
  const watch = (r: Rig, seconds: number, most = 0): number => {
    let peak = Math.max(most, r.host.alive.size);
    run(r.crew, seconds, () => {
      peak = Math.max(peak, r.host.alive.size);
    });
    return peak;
  };

  it("the campus's layoff year: the people let go and the people who take their places are never more than 56", () => {
    const campus = { office: 4 as OfficeIndex, capacity: 150 };
    const r = office([150, 0, 0], campus);
    r.apply([120, 0, 0], { ...campus, leaving: 30 });
    let peak = watch(r, 20);
    // The year plays out: the ten drawn people who were let go leave, and ten counted on the sign take their desks.
    r.apply([120, 0, 0], { ...campus, year: 1991 });
    expect(r.studio.cast?.left).toHaveLength(10);
    expect(r.crew.cast).toHaveLength(MAX_STAFF_DRAWN);
    // Six of the ten still walk out; for the last four to be told to go there is no figure to spare.
    expect(ids(r.crew.departing)).toEqual(["p40", "p41", "p42", "p43", "p44", "p45"]);
    expectBodiesMatch(r);
    let walkedOut = false;
    run(r.crew, SETTLED, () => {
      peak = Math.max(peak, r.host.alive.size);
      if (r.crew.departing.some((actor) => actor.pose === "walk" && actor.carrying)) walkedOut = true;
    });
    expect(peak).toBe(MAX_FIGURES);
    expect(walkedOut).toBe(true);
    expectAllSeated(r);
    expect(r.crew.departing).toHaveLength(0);
    expect(r.crew.busy()).toBe(false);
    expectBodiesMatch(r);
  });

  it("keeps to 56 through layoffs, hires, people away and years one on top of another, and comes to rest", () => {
    const campus = { office: 4 as OfficeIndex, capacity: 150 };
    const r = office([150, 0, 0], { ...campus, arriving: 9 }, { seed: 4 });
    let peak = r.host.alive.size;
    let leaving = 0;
    let year = 1990;
    for (let round = 0; round < 40; round += 1) {
      // A round of layoffs, somebody away or back, people at the door or none — and every third round a year on
      // top, so new leavers are told to go while the last ones are still filing out.
      leaving = (round * 7) % 31;
      if (round % 3 === 2) year += 1;
      r.apply([150 - leaving - (round % 2), 0, 0], { ...campus, year, leaving, away: round % 2, arriving: round % 4 === 0 ? 0 : 9 });
      expect(r.host.alive.size, `round ${round}`).toBeLessThanOrEqual(MAX_FIGURES);
      expectBodiesMatch(r);
      peak = watch(r, 0.2 + (round % 5) * 0.4, peak);
    }
    expect(peak).toBe(MAX_FIGURES);
    r.apply([150, 0, 0], { ...campus, year: year + 1 });
    peak = watch(r, 100, peak);
    expect(peak).toBe(MAX_FIGURES);
    expectAllSeated(r);
    expect(r.crew.departing).toHaveLength(0);
    expect(r.crew.busy()).toBe(false);
    expectBodiesMatch(r);
  });

  it("gives up the walk of whoever was told to go last, and keeps the first of them walking", () => {
    const campus = { office: 4 as OfficeIndex, capacity: 150 };
    // 60 people, 50 of them drawn and ten on the sign, and four at the door. Two are let go, and the year plays out:
    // two from the sign take their desks at once, so the two walking out make it 56.
    const r = office([60, 0, 0], { ...campus, arriving: 4 });
    r.apply([58, 0, 0], { ...campus, arriving: 4, leaving: 2 });
    r.apply([58, 0, 0], { ...campus, arriving: 4, year: 1991 });
    expect(ids(r.crew.departing)).toEqual(["p48", "p49"]);
    const [first, second] = r.crew.departing;
    // They give way to the two newcomers at the door first, and then set off.
    for (let i = 0; i < 30 && second.mode !== "walking"; i += 1) run(r.crew, 0.5);
    expect([first.mode, second.mode]).toEqual(["walking", "walking"]);
    expect(r.host.alive.size).toBe(MAX_FIGURES);
    // Somebody goes away and two more are expected: 55 in the office, so one figure to spare for three leavers.
    r.apply([57, 0, 0], { ...campus, arriving: 6, away: 1, year: 1991 });
    expect(r.crew.cast).toHaveLength(55);
    expect(r.crew.departing).toEqual([first]);
    expect([r.host.alive.has(first), r.host.alive.has(second)]).toEqual([true, false]);
    expect(r.host.alive.size).toBe(MAX_FIGURES);
    expectBodiesMatch(r);
    expect(watch(r, SETTLED)).toBe(MAX_FIGURES);
    expect(first.gone).toBe(true);
    expectAllSeated(r);
    expect(r.crew.busy()).toBe(false);
  });
});

describe("Crew: seats, teams and offices changing", () => {
  it("someone whose desk changed walks to it; nobody else gets up", () => {
    const r = office([3, 2, 0]);
    const others = ["p0", "p1", "p2", "p4"].map((id) => must(r.crew, id));
    const displaced = must(r.crew, "p3");
    r.apply([4, 2, 0]);
    // p3 gives up desk 3 for desk 5; the newcomer p5 takes desk 3.
    expect(displaced.mode).toBe("rising");
    expect(displaced.home.index).toBe(5);
    let walked = false;
    let gotUp: string[] = [];
    run(r.crew, SETTLED, () => {
      if (displaced.pose === "walk") walked = true;
      // Ambient wandering apart, everyone else stays in their chair.
      gotUp = gotUp.concat(others.filter((actor) => actor.mode !== "seated" && actor.errand !== "wander").map((actor) => actor.id));
    });
    expect(walked).toBe(true);
    expect(gotUp).toEqual([]);
    expectAllSeated(r);
    expect(must(r.crew, "p5").home.index).toBe(3);
    // Two people sat down somewhere new.
    expect(r.host.puffs).toHaveLength(2);
    expect(r.host.spawnCount).toBe(6);
  });

  it("someone whose team changed changes shirt, and stays in the chair when the desk is still theirs", () => {
    const r = office([3, 0, 0]);
    const mover = must(r.crew, "p2");
    expect(mover.team).toBe("product");
    r.apply([2, 1, 0]);
    expect(must(r.crew, "p2")).toBe(mover);
    expect(mover.team).toBe("growth");
    expect(mover.mode).toBe("seated");
    expect(r.crew.busy()).toBe(false);
    expect(r.host.spawnCount).toBe(3);
    expect(r.host.despawnCount).toBe(0);
  });

  it("someone who changes team and desk walks over: never out and back in", () => {
    const r = office([4, 3, 1]);
    const mover = must(r.crew, "p6");
    r.apply([5, 2, 1]);
    expect(must(r.crew, "p6")).toBe(mover);
    expect([mover.team, mover.home.index]).toEqual(["product", 4]);
    expect(r.crew.departing).toHaveLength(0);
    let outside = false;
    const { floor } = r.studio.layout;
    run(r.crew, SETTLED, () => {
      if (mover.x < floor.minX || mover.x > floor.maxX || mover.z < floor.minZ || mover.z > floor.maxZ) outside = true;
    });
    expect(outside).toBe(false);
    expectAllSeated(r);
    expect(r.host.spawnCount).toBe(8);
  });

  it("hides everyone when the company changes office and pops them in at their new seats within 1.5 s", () => {
    const r = office([3, 2, 1], { leaving: 1, arriving: 1 });
    const before = [...r.crew.cast];
    r.apply([3, 2, 1], { office: 2, capacity: 22, leaving: 1, arriving: 1 });
    expect(r.crew.cast).toEqual(before);
    for (const actor of r.crew.cast) expect(actor.visible, actor.id).toBe(false);
    expect(r.crew.busy()).toBe(true);
    run(r.crew, 0.5);
    for (const actor of r.crew.cast) expect(actor.visible, actor.id).toBe(false);
    run(r.crew, 1);
    expectAllSeated(r);
    expect(r.crew.busy()).toBe(false);
    for (const actor of r.crew.cast) expect(r.studio.seating.seatOf(actor.id)).toBe(actor.home);
    expect(r.host.spawnCount).toBe(8);
  });

  it("walks the people waiting at the door to their desks when they are hired before the new office has popped them in", () => {
    // A year playing out: the move beat rebuilds the office with two hires waiting at the door, and the arrive beat
    // gives them desks. On a slow machine the world has drawn less of the move beat than the clock gave it, so the
    // arrive beat can come while the two are still hidden, due to pop in at the door: they must still walk in.
    const r = office([2, 1, 0], { arriving: 2 });
    r.apply([2, 1, 0], { office: 2, capacity: 22, arriving: 2 });
    const hires = r.crew.cast.filter((actor) => r.studio.seating.seatOf(actor.id)?.kind === "waiting");
    expect(hires).toHaveLength(2);
    run(r.crew, 0.3);
    for (const actor of hires) expect([actor.id, actor.visible]).toEqual([actor.id, false]);
    r.apply([3, 2, 0], { office: 2, capacity: 22, arriving: 0 });
    const walked = new Set<string>();
    run(r.crew, SETTLED, () => {
      for (const actor of hires) if (actor.mode === "walking" && actor.visible) walked.add(actor.id);
    });
    expect([...walked].sort()).toEqual(ids(hires).sort());
    expectAllSeated(r);
    for (const actor of hires) expect(r.studio.seating.seatOf(actor.id)?.kind).toBe("desk");
  });

  it("seats newcomers at once when they arrive together with a new office, and nobody walks out of the old one", () => {
    const r = office([3, 0, 0]);
    r.apply([4, 0, 0], { office: 2, capacity: 22, year: 1991 });
    expect(r.studio.cast?.arrived).toEqual(["p3"]);
    run(r.crew, 1.5);
    expectAllSeated(r);
    expect(r.host.icons()).toEqual([]);
    r.apply([2, 0, 0], { office: 3, capacity: 40, year: 1992 });
    expect(r.crew.departing).toHaveLength(0);
    expectBodiesMatch(r);
  });

  it("rebuilds from nothing on a reset, mid-animation", () => {
    const r = office([2, 0, 0]);
    r.apply([5, 0, 0]);
    r.apply([4, 0, 0]);
    run(r.crew, 1);
    expect(r.crew.busy()).toBe(true);
    r.apply([1, 1, 0], { runId: "another" });
    expect(ids(r.crew.cast)).toEqual(["p0", "p1"]);
    expect(r.crew.departing).toHaveLength(0);
    expectAllSeated(r);
    expectBodiesMatch(r);
    expect(r.crew.busy()).toBe(false);
  });

  it("replaces the body when an id comes to mean a different person", () => {
    const r = office([2, 0, 0]);
    const first = must(r.crew, "p1");
    // The same run with another seed: every face is another.
    r.apply([2, 0, 0], { seed: 99 });
    const second = must(r.crew, "p1");
    expect(second).not.toBe(first);
    expect(second.look).not.toBe(first.look);
    expect(r.host.alive.has(first)).toBe(false);
    expectBodiesMatch(r);
  });
});

describe("Crew: coming to rest", () => {
  it("a fresh cast, a reset and reduced motion place everyone without a walk", () => {
    const fresh = office([5, 3, 1], { leaving: 2, arriving: 3 });
    expect(fresh.crew.busy()).toBe(false);
    expectAllSeated(fresh);

    fresh.apply([8, 1, 0], { runId: "another", arriving: 1 });
    expect(fresh.crew.busy()).toBe(false);
    expectAllSeated(fresh);
    // An earlier year is a fresh cast too.
    fresh.apply([2, 2, 2], { runId: "another", year: 1980 });
    expect(fresh.crew.busy()).toBe(false);
    expectAllSeated(fresh);

    const still = office([3, 2, 0], {}, { reducedMotion: true });
    still.apply([4, 2, 0], { leaving: 1, arriving: 2, year: 1991 });
    expect(still.crew.busy()).toBe(false);
    expectAllSeated(still);
    expect(still.crew.departing).toHaveLength(0);
    still.apply([4, 1, 0], { office: 3, capacity: 40, year: 1992 });
    expect(still.crew.busy()).toBe(false);
    expectAllSeated(still);
    expectBodiesMatch(still);
    // And nothing starts by itself afterwards.
    run(still.crew, 60, () => expect(still.crew.busy()).toBe(false));
  });

  it("is busy while anyone is walking or settling, and rests when all are still", () => {
    const r = office([3, 2, 0]);
    run(r.crew, 30, () => expect(r.crew.busy()).toBe(false));
    r.apply([4, 2, 0], { arriving: 2, leaving: 1 });
    expect(r.crew.busy()).toBe(true);
    let busyFor = 0;
    let moving = 0;
    run(r.crew, 120, (time) => {
      const anyoneUp = r.crew.departing.length > 0 || r.crew.cast.some((actor) => actor.mode !== "seated");
      if (anyoneUp) {
        moving = time;
        expect(r.crew.busy()).toBe(true);
      }
      if (r.crew.busy()) busyFor = time;
    });
    // Busy for as long as somebody was up, and a moment more for the last chair to roll in.
    expect(moving).toBeGreaterThan(2);
    expect(busyFor).toBeGreaterThanOrEqual(moving);
    expect(busyFor - moving).toBeLessThan(0.5);
    expect(r.crew.busy()).toBe(false);
    expectAllSeated(r);
    // At rest for good: nobody sets off to wander once the office has gone quiet.
    run(r.crew, 600, () => expect(r.crew.busy()).toBe(false));
  });

  it("is at rest within a minute and a half of any frame, whatever was going on", () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const r = office([12, 6, 3], { office: 2, capacity: 22 }, { seed });
      r.apply([14, 4, 2], { office: 2, capacity: 22, arriving: 6, leaving: 3, away: 1 });
      run(r.crew, 3 + seed);
      r.apply([10, 8, 4], { office: 2, capacity: 22, year: 1991 });
      run(r.crew, 90);
      expect(r.crew.busy(), `seed ${seed}`).toBe(false);
      expectAllSeated(r);
      expect(r.crew.departing).toHaveLength(0);
    }
  });
});

describe("Crew: the campus's year", () => {
  /** Seconds of 60 fps frames until nobody is on the move any more (at most `limit`). */
  const secondsToRest = (crew: Crew, limit = 60): number => {
    let time = 0;
    while (crew.busy() && time < limit) {
      crew.update(1 / 60);
      time += 1 / 60;
    }
    return time;
  };

  it.each([0, 7, 20_240_607])(
    "the year with three hires and two let go is at rest within 14 seconds, however far the desks are (seed %i)",
    (seed) => {
      // The browser check's year: the campus full (150, split 5 : 4 : 1), two let go and three expected, then the
      // year ends and the three join the smallest team. 50 are drawn, the rest are on the sign.
      const campus = { office: 4 as OfficeIndex, capacity: 150, seed, runId: `lab:${seed}` };
      const r = office([75, 60, 15], campus);
      r.apply([73, 60, 15], { ...campus, leaving: 2, arriving: 3 });
      secondsToRest(r.crew);
      expect(r.crew.busy()).toBe(false);
      r.apply([73, 60, 18], { ...campus, year: 1991 });
      expect(r.crew.busy()).toBe(true);
      // Movement only: the drawing loop's own quiet second comes on top.
      expect(secondsToRest(r.crew)).toBeLessThanOrEqual(14);
      expect(r.crew.busy()).toBe(false);
      expectAllSeated(r);
      expect(r.crew.departing).toHaveLength(0);
    }
  );
});

describe("Crew: a new year", () => {
  it("has whoever is up trot back, and snaps them into their seat within a second", () => {
    const r = office([1, 0, 0]);
    r.apply([3, 0, 0]);
    run(r.crew, 1.5);
    expect(r.crew.cast.some((actor) => actor.mode === "walking")).toBe(true);
    r.apply([3, 0, 0], { year: 1991 });
    run(r.crew, 0.8);
    expectAllSeated(r);
  });

  it("lets people who join or go with the new year do so after the sweep, at a walk", () => {
    const r = office([3, 0, 0], { arriving: 1 });
    r.apply([3, 1, 0], { year: 1991, arriving: 1 });
    const leaverGone = r.studio.cast?.left ?? [];
    expect(leaverGone).toEqual([]);
    const expected = must(r.crew, "p4");
    run(r.crew, YEAR_DELAY - 0.1);
    expect(expected.visible).toBe(false);
    run(r.crew, 0.3);
    expect(expected.visible).toBe(true);
    expect(expected.arriving).toBe(true);
    run(r.crew, SETTLED);
    expectAllSeated(r);
  });
});

describe("Crew: wandering", () => {
  it("with the switch off, which is how it starts, no trip ever begins, however lively the office is kept", () => {
    const r = office([14, 6, 4], { office: 3, capacity: 40 }, { seed: 5 });
    let trips = 0;
    // A scene every ten seconds for two minutes, then ten minutes of quiet.
    for (let round = 0; round < 12; round += 1) {
      r.apply([14, 6, 4], { office: 3, capacity: 40 });
      run(r.crew, 10, () => {
        trips += r.crew.cast.filter((actor) => actor.errand !== null).length;
      });
    }
    run(r.crew, 600, () => {
      trips += r.crew.cast.filter((actor) => actor.errand !== null).length;
    });
    expect(trips).toBe(0);
    expect(r.host.icons()).toEqual([]);
    expect(r.crew.busy()).toBe(false);
    expectAllSeated(r);
  });

  it("with the switch on, people wander however long ago the last scene was, a first scene included", () => {
    const r = office([14, 6, 4], { office: 3, capacity: 40 }, { seed: 5 });
    r.crew.setRoaming(true);
    // Nothing has happened since the first scene, and nothing will: the trips are the crew's own.
    const tripsIn = (seconds: number): number => {
      let trips = 0;
      const out = new Set<string>();
      run(r.crew, seconds, () => {
        const wandering = r.crew.cast.filter((actor) => actor.errand === "wander");
        for (const actor of wandering) if (!out.has(actor.id)) trips += 1;
        out.clear();
        for (const actor of wandering) out.add(actor.id);
      });
      return trips;
    };
    expect(tripsIn(120)).toBeGreaterThan(3);
    // Ten minutes on they still do.
    run(r.crew, 600);
    expect(tripsIn(120)).toBeGreaterThan(3);
  });

  it("switched off again, whoever is out walks back and nobody else sets off: the office comes to rest", () => {
    const r = office([14, 6, 4], { office: 3, capacity: 40 }, { seed: 5 });
    r.crew.setRoaming(true);
    for (let i = 0; i < 600 && !r.crew.cast.some((actor) => actor.errand === "wander"); i += 1) run(r.crew, 0.5);
    expect(r.crew.cast.some((actor) => actor.errand === "wander")).toBe(true);
    expect(r.crew.busy()).toBe(true);
    r.crew.setRoaming(false);
    const out = new Set(r.crew.cast.filter((actor) => actor.errand === "wander").map((actor) => actor.id));
    let busyFor = 0;
    run(r.crew, 600, (time) => {
      if (r.crew.busy()) busyFor = time;
      for (const actor of r.crew.cast) if (actor.errand !== null) expect(out.has(actor.id), actor.id).toBe(true);
    });
    expect(busyFor).toBeGreaterThan(0);
    expect(busyFor).toBeLessThan(60);
    expectAllSeated(r);
  });

  it("lets a few people wander while the switch is on — never more than the cap, never the same person twice running", () => {
    const r = office([14, 6, 4], { office: 3, capacity: 40 }, { seed: 5 });
    r.crew.setRoaming(true);
    const cap = wanderCap(r.crew.cast.length);
    let most = 0;
    const trips: string[] = [];
    const out = new Set<string>();
    // The office is kept lively by a scene every ten seconds (the same one: nobody arrives or goes).
    for (let round = 0; round < 12; round += 1) {
      r.apply([14, 6, 4], { office: 3, capacity: 40 });
      run(r.crew, 10, () => {
        const wandering = r.crew.cast.filter((actor) => actor.errand === "wander");
        most = Math.max(most, wandering.length);
        for (const actor of wandering) {
          if (!out.has(actor.id)) trips.push(actor.id);
        }
        out.clear();
        for (const actor of wandering) out.add(actor.id);
      });
    }
    expect(trips.length).toBeGreaterThan(5);
    expect(most).toBeGreaterThanOrEqual(1);
    expect(most).toBeLessThanOrEqual(cap);
    for (let i = 1; i < trips.length; i += 1) expect(trips[i], `trip ${i}`).not.toBe(trips[i - 1]);
    expect(new Set(trips).size).toBeGreaterThan(3);
    expect(r.host.icons()).toContain("coffee");
    // Coming back from a wander is not worth a puff of dust.
    expect(r.host.puffs).toEqual([]);
    r.crew.setRoaming(false);
    run(r.crew, SETTLED);
    expectAllSeated(r);
  });

  it("sends two wanderers to different spots", () => {
    const r = office([20, 10, 6], { office: 3, capacity: 40 }, { seed: 11 });
    r.crew.setRoaming(true);
    let checked = 0;
    for (let round = 0; round < 12; round += 1) {
      r.apply([20, 10, 6], { office: 3, capacity: 40 });
      run(r.crew, 10, () => {
        const stops = r.crew.cast.map((actor) => actor.errandStop).filter((stop) => stop !== null);
        for (let a = 0; a < stops.length; a += 1) {
          for (let b = a + 1; b < stops.length; b += 1) {
            checked += 1;
            expect(Math.hypot(stops[a].x - stops[b].x, stops[a].z - stops[b].z)).toBeGreaterThan(0.4);
          }
        }
      });
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("nobody at the door wanders, switch or no switch", () => {
    const r = office([1, 0, 0], { arriving: 4 }, { seed: 2 });
    r.crew.setRoaming(true);
    r.apply([1, 0, 0], { arriving: 4 });
    let wandered = new Set<string>();
    run(r.crew, 300, () => {
      wandered = new Set([...wandered, ...r.crew.cast.filter((actor) => actor.errand === "wander").map((actor) => actor.id)]);
    });
    expect([...wandered]).toEqual(["p0"]);
  });

  it("keeps everyone at their desks under reduced motion, switch or no switch", () => {
    const r = office([14, 6, 4], { office: 3, capacity: 40 }, { reducedMotion: true });
    r.crew.setRoaming(true);
    for (let round = 0; round < 6; round += 1) {
      r.apply([14, 6, 4], { office: 3, capacity: 40 });
      run(r.crew, 10, () => expect(r.crew.cast.every((actor) => actor.mode === "seated")).toBe(true));
    }
  });
});

describe("Crew: the door", () => {
  it("departures file out a step apart: nobody walks up to the leaver ahead, or waits behind one fading out at the door", () => {
    // Rounds of departures a moment apart, so a new round gets up while the last one is
    // still filing out. Every queue decision is checked against the cast as it stands
    // at that moment, not as it stood at the top of the frame: leavers ahead may have
    // set off, re-pathed or reached the door earlier in the same frame.
    const rounds = [
      { office: 3 as OfficeIndex, staff: 16, round: 4, every: 2 },
      { office: 4 as OfficeIndex, staff: 32, round: 8, every: 1 },
    ];
    let decisions = 0;
    const wrong: string[] = [];
    for (const { office: index, staff, round, every } of rounds) {
      for (let seed = 1; seed <= 4; seed += 1) {
        const r = office([staff, 6, 4], { office: index }, { seed });
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
              Math.hypot(other.x - actor.x, other.z - actor.z) < DOOR_QUEUE_GAP
          );
          if (waits !== (ahead !== undefined)) {
            wrong.push(`office ${index} seed ${seed}: ${actor.id} ${waits ? "waited with nobody walking just ahead" : `walked up to ${ahead?.id ?? "?"}`}`);
          }
          return waits;
        };
        run(r.crew, 2 + seed);
        for (let left = staff; left > 0; left -= round) {
          r.apply([left - round, 6, 4], { office: index });
          run(r.crew, every);
        }
        run(r.crew, SETTLED);
        expect(r.crew.departing, `office ${index} seed ${seed}`).toHaveLength(0);
        expect(r.crew.busy(), `office ${index} seed ${seed}`).toBe(false);
      }
    }
    expect(decisions).toBeGreaterThan(5_000);
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it("a newcomer waits outside while somebody is walking out, and a leaver waits for a newcomer to get in", () => {
    const r = office([3, 0, 0], { office: 2, capacity: 22 });
    // One out, one in, in the same scene: the leaver goes first and the newcomer waits for the doorway.
    r.apply([2, 0, 0], { office: 2, capacity: 22, arriving: 1 });
    expect([r.studio.cast?.left, r.studio.cast?.arrived]).toEqual([["p2"], ["p3"]]);
    let together = 0;
    run(r.crew, 40, () => {
      const leaver = r.crew.departing.find((actor) => actor.exiting);
      const newcomer = r.crew.cast.find((actor) => actor.arriving);
      if (leaver && newcomer) together += 1;
    });
    expect(together).toBe(0);
    expect(r.crew.actor("p3")?.mode).toBe("seated");
    expect(r.crew.departing).toHaveLength(0);
    // And the other way round: somebody already walking in holds up a leaver at their desk.
    r.apply([2, 0, 0], { office: 2, capacity: 22, arriving: 2 });
    run(r.crew, 0.5);
    expect(r.crew.actor("p4")?.arriving).toBe(true);
    r.apply([1, 0, 0], { office: 2, capacity: 22, arriving: 2 });
    run(r.crew, 0.5);
    const leaver = r.crew.departing.find((actor) => actor.id === "p1");
    expect(leaver?.mode).toBe("seated");
    run(r.crew, SETTLED);
    expect(r.crew.departing).toHaveLength(0);
    expect(r.crew.busy()).toBe(false);
  });
});

describe("Crew: a frame time that is not one", () => {
  it("ignores a step of no time, of negative time and of no number at all, and still comes to rest", () => {
    const r = office([2, 0, 0]);
    r.apply([3, 0, 0], { arriving: 1 });
    r.apply([2, 0, 0], { arriving: 1 });
    run(r.crew, 1.2);
    expect(r.crew.cast.some((actor) => actor.mode === "walking")).toBe(true);
    const before = r.crew.cast.map((actor) => [actor.mode, actor.x, actor.z]);
    const now = r.crew.now;
    for (const dt of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      r.crew.update(dt);
      expect(r.crew.now, String(dt)).toBe(now);
      expect(r.crew.cast.map((actor) => [actor.mode, actor.x, actor.z]), String(dt)).toEqual(before);
      for (const actor of [...r.crew.cast, ...r.crew.departing]) {
        expect(Number.isFinite(actor.x + actor.z + actor.facing + actor.scale + actor.chairOut), `${actor.id} after ${dt}`).toBe(true);
      }
    }
    expect(r.crew.busy()).toBe(true);
    run(r.crew, SETTLED);
    expectAllSeated(r);
    expect(r.crew.departing).toHaveLength(0);
    expect(r.crew.busy()).toBe(false);
    expectBodiesMatch(r);
  });
});

describe("Crew: lifecycle", () => {
  it("dispose frees every body, including people who were walking out", () => {
    const r = office([4, 0, 0]);
    r.apply([3, 0, 0]);
    run(r.crew, 0.5);
    r.crew.dispose();
    expect(r.host.alive.size).toBe(0);
    expect(r.host.spawnCount).toBe(r.host.despawnCount);
    expect(r.crew.cast).toHaveLength(0);
    expect(r.crew.busy()).toBe(false);
  });

  it("plays out identically for the same inputs", () => {
    const play = (): string => {
      const r = office([8, 4, 0], { office: 2, capacity: 22 }, { seed: 7 });
      const trace: string[] = [];
      for (let round = 0; round < 6; round += 1) {
        r.apply([8 + (round % 2), 4, round % 3], { office: 2, capacity: 22, arriving: round % 4 });
        run(r.crew, 10, (time) => {
          if (Math.round(time * 60) % 30 === 0) trace.push(r.crew.cast.map((actor) => `${actor.mode}:${actor.pose}:${actor.x.toFixed(3)}`).join("|"));
        });
      }
      return trace.join("\n") + r.host.icons().join(",");
    };
    expect(play()).toBe(play());
  });

  it("survives a long, hostile sequence of scenes with nobody stuck or leaked", () => {
    const r = rig({ seed: 3 });
    const teams: [number, number, number] = [1, 0, 0];
    let officeIndex = 0;
    let year = 1990;
    let run_ = 0;
    // A fixed pseudo-random script so a failure is reproducible.
    let state = 12345;
    const roll = (n: number): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return (state >>> 8) % n;
    };
    const build = (): OfficeScene =>
      scene(teams, {
        runId: `run-${run_}`,
        office: officeIndex as OfficeIndex,
        year,
        away: roll(4) === 0 ? 1 : 0,
        leaving: roll(3) === 0 ? roll(4) : 0,
        arriving: roll(3) === 0 ? roll(8) : 0,
        ending: roll(40) === 0 ? "won" : null,
      });

    r.studio.apply(r.crew, build());
    for (let step = 0; step < 400; step += 1) {
      const team = roll(3);
      switch (roll(9)) {
        case 0:
        case 1:
          teams[team] += 1 + roll(4);
          break;
        case 2:
          teams[team] = Math.max(0, teams[team] - 1 - roll(3));
          break;
        case 3: {
          // One person changes team.
          const to = roll(3);
          if (teams[team] > 0 && to !== team) {
            teams[team] -= 1;
            teams[to] += 1;
          }
          break;
        }
        case 4:
          if (roll(3) === 0) officeIndex = Math.min(4, Math.max(0, officeIndex + (roll(3) === 0 ? -1 : 1)));
          break;
        case 5:
          year += 1;
          break;
        case 6:
          if (roll(12) === 0) {
            run_ += 1;
            year = 1990;
          }
          break;
        case 7:
          // A boom: more people than any office draws.
          if (roll(6) === 0) teams[team] += 40;
          break;
        default:
          break;
      }
      r.studio.apply(r.crew, build());
      // Anything from a single frame to a few seconds between scenes, in uneven frames.
      const frames = 1 + roll(120);
      for (let i = 0; i < frames; i += 1) r.crew.update(roll(4) === 0 ? 0.1 : 1 / 60);

      expectBodiesMatch(r);
      expect(r.host.alive.size, `step ${step}`).toBeLessThanOrEqual(MAX_FIGURES);
      const cast = r.studio.cast!;
      const drawn = cast.people.filter((person) => person.standing !== "away" && r.studio.seating.seatOf(person.id) !== null);
      expect(ids(r.crew.cast)).toEqual(drawn.map((person) => person.id));
      expect(r.crew.cast.length).toBeLessThanOrEqual(56);
      for (const actor of r.crew.cast) {
        expect(r.studio.seating.seatOf(actor.id), actor.id).toBe(actor.home);
        expect(Number.isFinite(actor.x + actor.z + actor.facing + actor.scale), actor.id).toBe(true);
        const person = cast.people.find((member) => member.id === actor.id)!;
        if (person.team !== null) expect(actor.team, actor.id).toBe(person.team);
        expect(actor.packed, actor.id).toBe(person.standing === "leaving");
      }
      expect(new Set(ids(r.crew.cast)).size).toBe(r.crew.cast.length);
    }

    // Leave the room alone: everyone ends up at their place and the crew comes to rest.
    r.studio.apply(r.crew, build());
    run(r.crew, 100);
    expectAllSeated(r);
    expect(r.crew.departing).toHaveLength(0);
    expect(r.crew.busy()).toBe(false);
    expectBodiesMatch(r);
  });
});
