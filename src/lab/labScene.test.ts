import { describe, expect, it } from "vitest";
import { DESKS } from "../world/office/layouts";
import { TEAMS } from "../world/types/scene";
import {
  CAPACITY,
  editScene,
  endYear,
  headCount,
  labOptionsFromQuery,
  officeFor,
  queryFromLab,
  sameScene,
  queryFromScene,
  sceneFromQuery,
} from "./labScene";

describe("the lab's scene", () => {
  it("reads a scene from the address, and writes the same address back", () => {
    const query = "?office=2&product=9&growth=8&recruiting=3&away=1&leaving=0&arriving=2&year=2004&era=bust&seed=7";
    expect(sceneFromQuery(query)).toEqual({ runId: "lab:7", seed: 7, year: 2004, office: 2, capacity: 22, era: "bust",
      teams: { product: 9, growth: 8, recruiting: 3 }, away: 1, leaving: 0, arriving: 2, ending: null });
    expect(queryFromScene(sceneFromQuery(query))).toBe(query);
  });

  it("an empty address is three people in a garage in 1990", () => {
    expect(sceneFromQuery("")).toMatchObject({ year: 1990, office: 0, capacity: 4, teams: { product: 3, growth: 0, recruiting: 0 } });
  });

  it("nonsense in the address is read as nothing: no negative people, no office 9, no NaN (Review Focus 1)", () => {
    expect(sceneFromQuery("?office=9&product=-4&growth=abc&year=x")).toMatchObject({ office: 0, year: 1990, teams: { product: 0, growth: 0, recruiting: 0 } });
  });

  it("ending a year hires, lets go, and moves when the room is too small", () => {
    const before = sceneFromQuery("?office=0&product=2&growth=1&recruiting=1&leaving=1&arriving=3");
    expect(endYear(before)).toMatchObject({ year: 1991, office: 1, capacity: 9, leaving: 0, arriving: 0, away: 0,
      teams: { product: 3, growth: 2, recruiting: 2 } });
  });

  it("ending a year never shrinks the office", () => {
    const before = sceneFromQuery("?office=3&product=3&growth=1&recruiting=1&leaving=25");
    expect(headCount(before)).toBe(30);
    expect(endYear(before)).toMatchObject({ office: 3, capacity: 40, leaving: 0, teams: { product: 3, growth: 1, recruiting: 1 } });
  });

  it("has one capacity for each office the world can draw, and never fewer places than desks", () => {
    expect(CAPACITY).toEqual([4, 9, 22, 40, 150]);
    expect(CAPACITY.length).toBe(DESKS.length);
    CAPACITY.forEach((capacity, office) => expect(capacity).toBeGreaterThanOrEqual(DESKS[office]));
  });

  it("every number of every scene read from an address is a whole number that is not negative", () => {
    const hostile = [
      "?product=1e9&growth=0x10&recruiting=1.5&away=%20&leaving=Infinity&arriving=NaN&seed=-1&year=99999",
      "?product=&growth=+5&recruiting=5%205&seed=1.5&era=&office=",
      "?product=99999999999999999999&seed=99999999999999999999&office=4.0&year=-1990",
      "product=2&product=7&office=1&office=3",
      "?%E0%A4%A=1&&&===",
    ];
    for (const query of hostile) {
      const scene = sceneFromQuery(query);
      const numbers = [scene.seed, scene.year, scene.office, scene.capacity, scene.away, scene.leaving, scene.arriving, ...TEAMS.map((team) => scene.teams[team])];
      for (const value of numbers) {
        expect(Number.isSafeInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      expect(scene.capacity).toBe(CAPACITY[scene.office]);
      expect(scene.runId).toBe(`lab:${scene.seed}`);
      expect(scene.era.length).toBeGreaterThan(0);
      expect(scene.ending).toBeNull();
      // Whatever was read can be written and read again without changing.
      expect(sceneFromQuery(queryFromScene(scene))).toEqual(scene);
    }
  });

  it("an address that names no office gets the smallest office that holds everyone", () => {
    expect(sceneFromQuery("?product=5")).toMatchObject({ office: 1, capacity: 9 });
    expect(sceneFromQuery("?product=20&growth=1&away=1")).toMatchObject({ office: 2, capacity: 22 });
    expect(sceneFromQuery("?product=20&growth=1&away=1&leaving=1")).toMatchObject({ office: 3, capacity: 40 });
    expect(sceneFromQuery("?product=400")).toMatchObject({ office: 4, capacity: 150 });
    // People expected are not in the building yet.
    expect(sceneFromQuery("?product=4&arriving=30")).toMatchObject({ office: 0 });
  });

  it("an address that names an office keeps it, however many people there are", () => {
    expect(sceneFromQuery("?office=0&product=150")).toMatchObject({ office: 0, capacity: 4 });
    expect(sceneFromQuery("?office=4&product=1")).toMatchObject({ office: 4, capacity: 150 });
  });

  it("a count in the address is digits only: anything else given is nobody", () => {
    expect(sceneFromQuery("?office=4&product=1.5&growth=0x10&recruiting=1e3&away=+1&leaving=%201&arriving=12")).toMatchObject({
      teams: { product: 0, growth: 0, recruiting: 0 }, away: 0, leaving: 0, arriving: 12,
    });
  });

  it("a seed may be any 32-bit number, and no more", () => {
    expect(sceneFromQuery("?seed=4000000000")).toMatchObject({ seed: 4000000000, runId: "lab:4000000000" });
    expect(sceneFromQuery("?seed=99999999999")).toMatchObject({ seed: 0xffffffff });
  });

  it("an era is cut to 40 letters, and an empty one is the first era", () => {
    expect(sceneFromQuery(`?era=${"a".repeat(60)}`).era).toBe("a".repeat(40));
    expect(sceneFromQuery("?era=%20%20").era).toBe("flat");
  });

  it("an era with odd letters in it survives the address", () => {
    const scene = editScene(sceneFromQuery(""), { era: "boom & bust=50%" }, false);
    expect(queryFromScene(scene)).toContain("era=boom%20%26%20bust%3D50%25");
    expect(sceneFromQuery(queryFromScene(scene)).era).toBe("boom & bust=50%");
  });
});

describe("the smallest office that holds a head count", () => {
  it("is the first whose capacity is enough, and the campus beyond that", () => {
    expect([0, 4, 5, 9, 10, 22, 23, 40, 41, 150, 151, 9999].map((people) => officeFor(people))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4]);
  });

  it("is never smaller than the office asked for", () => {
    expect(officeFor(3, 2)).toBe(2);
    expect(officeFor(30, 2)).toBe(3);
  });
});

describe("ending a year", () => {
  it("brings back whoever was away, into the smallest team, before the hires", () => {
    const after = endYear(sceneFromQuery("?office=1&product=3&growth=2&recruiting=0&away=1&arriving=1"));
    expect(after).toMatchObject({ away: 0, arriving: 0, teams: { product: 3, growth: 2, recruiting: 2 } });
    expect(headCount(after)).toBe(7);
  });

  it("keeps the run, the seed and the era, and makes a new scene each time", () => {
    const before = sceneFromQuery("?seed=5&era=boom&year=1999");
    const after = endYear(before);
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ runId: "lab:5", seed: 5, era: "boom", year: 2000, ending: null });
    expect(before.year).toBe(1999);
  });

  it("stops at the largest numbers the lab takes", () => {
    const after = endYear(sceneFromQuery("?office=4&product=9999&growth=9999&recruiting=9999&arriving=5&year=9999"));
    expect(after).toMatchObject({ year: 9999, teams: { product: 9999, growth: 9999, recruiting: 9999 }, arriving: 0 });
  });

  it("moves as many offices up as the hires need", () => {
    expect(endYear(sceneFromQuery("?office=0&product=3&arriving=60"))).toMatchObject({ office: 4, capacity: 150 });
  });
});

describe("changing a scene by hand", () => {
  const start = sceneFromQuery("?office=0&product=3");

  it("makes a new scene and leaves the old one alone", () => {
    const next = editScene(start, { growth: 2 }, false);
    expect(next).not.toBe(start);
    expect(next.teams).toEqual({ product: 3, growth: 2, recruiting: 0 });
    expect(start.teams).toEqual({ product: 3, growth: 0, recruiting: 0 });
  });

  it("reads nonsense as nothing", () => {
    const next = editScene(start, { product: Number.NaN, growth: -3, recruiting: 2.9, away: Number.POSITIVE_INFINITY, year: Number.NaN, seed: -4 }, false);
    expect(next).toMatchObject({ teams: { product: 0, growth: 0, recruiting: 2 }, away: 0, year: 1990, seed: 0, runId: "lab:0" });
  });

  it("fits the office to the head count when asked to, up and down", () => {
    const grown = editScene(start, { product: 30 }, true);
    expect(grown).toMatchObject({ office: 3, capacity: 40 });
    expect(editScene(grown, { product: 2 }, true)).toMatchObject({ office: 0, capacity: 4 });
  });

  it("an office that does not exist is not taken", () => {
    expect(editScene(start, { office: 7 as never }, false)).toMatchObject({ office: 0, capacity: 4 });
  });

  it("keeps a forced office whatever the head count", () => {
    expect(editScene(start, { product: 30 }, false)).toMatchObject({ office: 0, capacity: 4 });
    expect(editScene(start, { office: 3 }, false)).toMatchObject({ office: 3, capacity: 40 });
  });

  it("a new seed is a new run", () => {
    expect(editScene(start, { seed: 12 }, false)).toMatchObject({ seed: 12, runId: "lab:12" });
  });

  it("an empty era is the first era", () => {
    expect(editScene(start, { era: "  " }, false).era).toBe(start.era);
  });
});

describe("what the address says besides the scene", () => {
  it("an address with an office forces it; one without lets the head count decide", () => {
    expect(labOptionsFromQuery("?office=2&product=1")).toEqual({ fitOffice: false, panelOpen: true });
    expect(labOptionsFromQuery("?product=1")).toEqual({ fitOffice: true, panelOpen: true });
    expect(labOptionsFromQuery("")).toEqual({ fitOffice: true, panelOpen: true });
    expect(labOptionsFromQuery("?office=9")).toEqual({ fitOffice: true, panelOpen: true });
    expect(labOptionsFromQuery("?office=2&fit=1")).toEqual({ fitOffice: true, panelOpen: true });
  });

  it("panel=0 starts with the controls put away", () => {
    expect(labOptionsFromQuery("?office=2&panel=0")).toEqual({ fitOffice: false, panelOpen: false });
    expect(labOptionsFromQuery("?panel=1")).toEqual({ fitOffice: true, panelOpen: true });
  });

  it("writes the scene first, exactly as the scene alone would be written, then what else differs from the usual", () => {
    const scene = sceneFromQuery("?office=2&product=9");
    expect(queryFromLab(scene, { fitOffice: false, panelOpen: true })).toBe(queryFromScene(scene));
    expect(queryFromLab(scene, { fitOffice: true, panelOpen: false })).toBe(`${queryFromScene(scene)}&fit=1&panel=0`);
  });

  it("reads back what it wrote", () => {
    const scene = sceneFromQuery("?office=2&product=9");
    for (const fitOffice of [true, false]) {
      for (const panelOpen of [true, false]) {
        const query = queryFromLab(scene, { fitOffice, panelOpen });
        expect(labOptionsFromQuery(query)).toEqual({ fitOffice, panelOpen });
      }
    }
  });
});

describe("two scenes that say the same thing", () => {
  it("are the same field by field, whatever the objects", () => {
    const scene = sceneFromQuery("?office=2&product=9&growth=8&recruiting=3&away=1&arriving=2&year=2004&era=bust&seed=7");
    expect(sameScene(scene, { ...scene, teams: { ...scene.teams } })).toBe(true);
    const changes: Partial<Record<keyof typeof scene, unknown>>[] = [
      { runId: "lab:8" }, { seed: 8 }, { year: 2005 }, { office: 3 }, { capacity: 40 }, { era: "boom" },
      { teams: { ...scene.teams, product: 10 } }, { teams: { ...scene.teams, growth: 9 } }, { teams: { ...scene.teams, recruiting: 4 } },
      { away: 0 }, { leaving: 1 }, { arriving: 3 }, { ending: "won" },
    ];
    for (const change of changes) expect(sameScene(scene, { ...scene, ...change } as typeof scene)).toBe(false);
  });
});
