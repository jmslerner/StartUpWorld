import { describe, expect, it } from "vitest";
import { MAX_STAFF_DRAWN, MAX_WAITING_DRAWN, drawnTeams, nextCast } from "./cast";
import type { Cast } from "./cast";
import { hashText32 } from "./hash";
import { TEAMS } from "./types";
import type { OfficeScene, Team } from "./types";

const scene = (teams: [number, number, number], patch: Partial<OfficeScene> = {}): OfficeScene => ({
  runId: "r",
  seed: 7,
  year: 1990,
  office: 0,
  capacity: 4,
  era: "dial-up",
  teams: { product: teams[0], growth: teams[1], recruiting: teams[2] },
  away: 0,
  leaving: 0,
  arriving: 0,
  ending: null,
  ...patch,
});
const who = (cast: Cast) => cast.people.map((p) => `${p.id}:${p.standing}:${p.team ?? "-"}`);
const play = (...scenes: OfficeScene[]) => scenes.reduce<Cast | null>((cast, next) => nextCast(cast, next), null)!;

describe("the cast", () => {
  it("a fresh cast numbers people group by group, and nobody has arrived", () => {
    const cast = nextCast(null, scene([2, 1, 1], { away: 1, leaving: 1, arriving: 2 }));
    expect(who(cast)).toEqual([
      "p0:working:product",
      "p1:working:product",
      "p2:working:growth",
      "p3:working:recruiting",
      "p4:away:product",
      "p5:leaving:-",
      "p6:waiting:-",
      "p7:waiting:-",
    ]);
    expect([cast.hidden, cast.arrived, cast.left, cast.nextId]).toEqual([0, [], [], 8]);
  });

  it("a face comes from the seed and the id", () => {
    expect(nextCast(null, scene([3, 0, 0])).people[1].look).toBe(hashText32(7, "p1"));
  });

  it("a move between teams keeps the person: the most recent joiner of the team that shrank goes", () => {
    expect(who(play(scene([3, 0, 0]), scene([2, 1, 0])))).toEqual(["p0:working:product", "p1:working:product", "p2:working:growth"]);
  });

  it("a planned layoff sends the most recent joiner to the door, and undoing it brings the same person back", () => {
    const planned = play(scene([3, 2, 0]), scene([3, 1, 0], { leaving: 1 }));
    expect(who(planned)[4]).toBe("p4:leaving:-");
    expect(who(nextCast(planned, scene([3, 2, 0])))[4]).toBe("p4:working:growth");
  });

  it("when the year has played out, the person leaving has left", () => {
    const after = play(scene([3, 2, 0]), scene([3, 1, 0], { leaving: 1 }), scene([3, 1, 0], { year: 1991 }));
    expect([after.people.map((p) => p.id), after.left]).toEqual([["p0", "p1", "p2", "p3"], ["p4"]]);
  });

  it("someone away keeps their team and comes back to it", () => {
    const away = play(scene([3, 2, 0]), scene([3, 1, 0], { away: 1 }));
    expect(who(away)[4]).toBe("p4:away:growth");
    expect(who(nextCast(away, scene([3, 2, 0], { year: 1991 })))[4]).toBe("p4:working:growth");
  });

  it("people expected wait at the door, and the ones hired walk in from there", () => {
    const waiting = play(scene([2, 1, 0]), scene([2, 1, 0], { arriving: 2 }));
    expect([who(waiting).slice(3), waiting.arrived]).toEqual([
      ["p3:waiting:-", "p4:waiting:-"],
      ["p3", "p4"],
    ]);
    const hired = nextCast(waiting, scene([3, 2, 0], { year: 1991 }));
    expect([who(hired).slice(3), hired.arrived, hired.left]).toEqual([["p3:working:product", "p4:working:growth"], [], []]);
  });

  it("fewer hired than expected: the rest walk away", () => {
    const cast = play(scene([2, 1, 0]), scene([2, 1, 0], { arriving: 2 }), scene([3, 1, 0], { year: 1991 }));
    expect([who(cast)[3], cast.left]).toEqual(["p3:working:product", ["p4"]]);
  });

  it("more hired than waited at the door: new people arrive, and an id is never used twice", () => {
    const cast = play(scene([3, 2, 0]), scene([3, 1, 0], { leaving: 1 }), scene([3, 3, 0], { year: 1991 }));
    expect([cast.people.map((p) => p.id), cast.arrived, cast.left]).toEqual([
      ["p0", "p1", "p2", "p3", "p5", "p6"],
      ["p5", "p6"],
      ["p4"],
    ]);
  });

  it("draws 50 of 150 in the teams' proportions and counts the rest (Review Focus 4)", () => {
    const cast = nextCast(null, scene([75, 60, 15], { office: 4, capacity: 150 }));
    const count = (team: Team) => cast.people.filter((p) => p.team === team).length;
    expect([cast.people.length, count("product"), count("growth"), count("recruiting"), cast.hidden]).toEqual([50, 25, 20, 5, 100]);
  });

  it("at the cap a year in which the hidden ones change leaves the drawn ones alone", () => {
    const next = play(scene([75, 60, 15], { office: 4, capacity: 150 }), scene([72, 58, 14], { office: 4, capacity: 150, year: 1991 }));
    expect([next.arrived, next.left, next.hidden]).toEqual([[], [], 94]);
  });

  it("shares odd numbers out by largest remainder, ties to the earlier team", () => {
    const cast = nextCast(null, scene([34, 33, 33], { office: 4, capacity: 150 }));
    expect(TEAMS.map((team) => cast.people.filter((p) => p.team === team).length)).toEqual([17, 17, 16]);
  });

  it("at most six wait at the door, whatever is expected", () => {
    expect(nextCast(null, scene([3, 0, 0], { arriving: 20 })).people.filter((p) => p.standing === "waiting")).toHaveLength(6);
  });

  it("another run, or an earlier year, starts afresh", () => {
    const first = play(scene([3, 0, 0]), scene([4, 0, 0], { year: 1991 }));
    for (const fresh of [nextCast(first, scene([2, 0, 0], { runId: "other" })), nextCast(first, scene([2, 0, 0], { year: 1990 }))]) {
      expect([fresh.people.map((p) => p.id), fresh.arrived, fresh.left, fresh.nextId]).toEqual([["p0", "p1"], [], [], 2]);
    }
  });

  it("a company with nobody has an empty cast (Review Focus 1)", () => {
    expect(nextCast(null, scene([0, 0, 0])).people).toEqual([]);
    const emptied = play(scene([3, 0, 0]), scene([0, 0, 0], { year: 1991, ending: "lost" }));
    expect([emptied.people, emptied.left]).toEqual([[], ["p0", "p1", "p2"]]);
  });
});

describe("the cast, where the plan's cases stop", () => {
  it("everyone leaving: the same people stand at the door, and are gone a year later (Review Focus 1)", () => {
    const going = play(scene([2, 1, 0]), scene([0, 0, 0], { leaving: 3 }));
    expect([who(going), going.arrived, going.left, going.hidden]).toEqual([["p0:leaving:-", "p1:leaving:-", "p2:leaving:-"], [], [], 0]);
    const gone = nextCast(going, scene([0, 0, 0], { year: 1991 }));
    expect([gone.people, gone.left, gone.nextId]).toEqual([[], ["p0", "p1", "p2"], 3]);
  });

  it("counts that are not whole numbers of people invent nobody (Review Focus 1)", () => {
    const odd = nextCast(null, scene([2.9, -3, Number.NaN], { away: Number.POSITIVE_INFINITY, leaving: -0.5, arriving: 1.5 }));
    expect([who(odd), odd.hidden]).toEqual([["p0:working:product", "p1:working:product", "p2:waiting:-"], 0]);
  });

  it("the same scene again changes nothing", () => {
    const busy = scene([3, 2, 1], { away: 1, leaving: 2, arriving: 3 });
    const once = play(scene([4, 4, 1]), busy);
    const twice = nextCast(once, busy);
    expect([twice.people, twice.arrived, twice.left, twice.nextId]).toEqual([once.people, [], [], once.nextId]);
  });

  it("the same seed and the same history give the same cast, and another seed other faces under the same ids", () => {
    const history = (seed: number) =>
      play(scene([3, 2, 0], { seed }), scene([2, 2, 1], { seed, leaving: 1, arriving: 2 }), scene([4, 2, 1], { seed, year: 1991, away: 1 }));
    expect(history(7)).toEqual(history(7));
    expect(history(8).people.map((p) => p.id)).toEqual(history(7).people.map((p) => p.id));
    expect(history(8).people.map((p) => p.look)).not.toEqual(history(7).people.map((p) => p.look));
  });

  it("everything at once: people leave, arrive and change team, and those who stayed keep id and face (Review Focus 2)", () => {
    const before = play(scene([3, 2, 1]), scene([3, 1, 1], { leaving: 1, arriving: 2 }));
    expect(who(before)).toEqual([
      "p0:working:product",
      "p1:working:product",
      "p2:working:product",
      "p3:working:growth",
      "p4:leaving:-",
      "p5:working:recruiting",
      "p6:waiting:-",
      "p7:waiting:-",
    ]);
    const after = nextCast(before, scene([2, 3, 2], { year: 1991, office: 1, capacity: 9 }));
    expect(who(after)).toEqual([
      "p0:working:product",
      "p1:working:product",
      "p2:working:growth",
      "p3:working:growth",
      "p5:working:recruiting",
      "p6:working:growth",
      "p7:working:recruiting",
    ]);
    expect([after.arrived, after.left]).toEqual([[], ["p4"]]);
    const faces = new Map(before.people.map((p) => [p.id, p.look]));
    expect(after.people.every((p) => p.look === faces.get(p.id))).toBe(true);
  });

  it("released people are taken before anyone at the door, those from work before those from leaving", () => {
    // Product gives up p2, the layoff of p4 is undone, and one person waits; Growth needs two and Recruiting one.
    const before = play(scene([3, 2, 0]), scene([3, 1, 0], { leaving: 1, arriving: 1 }));
    expect(who(nextCast(before, scene([2, 3, 1])))).toEqual([
      "p0:working:product",
      "p1:working:product",
      "p2:working:growth",
      "p3:working:growth",
      "p4:working:growth",
      "p5:working:recruiting",
    ]);
  });

  it("someone who goes away with no team of their own gets Product, and someone away stays away with their team", () => {
    const first = play(scene([1, 2, 0]), scene([1, 1, 0], { away: 1 }), scene([1, 1, 0], { away: 1, year: 1991 }));
    expect(who(first)).toEqual(["p0:working:product", "p1:working:growth", "p2:away:growth"]);
    const fromTheDoor = play(scene([1, 0, 0]), scene([1, 0, 0], { arriving: 1 }), scene([1, 0, 0], { away: 1, year: 1991 }));
    expect(who(fromTheDoor)).toEqual(["p0:working:product", "p1:away:product"]);
  });

  it("at the cap a team that shrinks hands its drawn people to the team that grows", () => {
    const first = nextCast(null, scene([75, 60, 15], { office: 4, capacity: 150 }));
    const next = nextCast(first, scene([60, 75, 15], { office: 4, capacity: 150 }));
    const count = (team: Team) => next.people.filter((p) => p.team === team).length;
    expect([count("product"), count("growth"), count("recruiting"), next.arrived, next.left, next.hidden]).toEqual([20, 25, 5, [], [], 100]);
    expect(next.people.map((p) => p.id)).toEqual(first.people.map((p) => p.id));
  });

  it("never draws more than the caps, and never uses an id twice over many years", () => {
    const sizes: [number, number, number][] = [[2, 1, 1], [9, 6, 2], [30, 20, 9], [80, 50, 20], [20, 10, 4], [0, 0, 0], [5, 5, 5]];
    const seen = new Set<string>();
    let cast: Cast | null = null;
    sizes.forEach((teams, index) => {
      for (const patch of [{ arriving: 9, leaving: index }, { arriving: 3, away: 1 }]) {
        const next: Cast = nextCast(cast, scene(teams, { year: 1990 + index, ...patch }));
        for (const id of next.arrived) {
          expect(seen.has(id), id).toBe(false);
          seen.add(id);
        }
        if (cast === null) next.people.forEach((p) => seen.add(p.id));
        const staff = next.people.filter((p) => p.standing !== "waiting");
        expect(staff.length).toBeLessThanOrEqual(MAX_STAFF_DRAWN);
        expect(next.people.length - staff.length).toBeLessThanOrEqual(MAX_WAITING_DRAWN);
        expect(staff.length + next.hidden).toBe(teams[0] + teams[1] + teams[2] + (patch.away ?? 0) + (patch.leaving ?? 0));
        expect(next.people.map((p) => Number(p.id.slice(1)))).toEqual(next.people.map((p) => Number(p.id.slice(1))).sort((a, b) => a - b));
        expect(next.people.every((p) => (p.team === null) === (p.standing === "leaving" || p.standing === "waiting"))).toBe(true);
        cast = next;
      }
    });
  });
});

describe("the cast, with a hint of who moves", () => {
  it("a hint moves the person picked, not the most recent joiner", () => {
    const before = play(scene([3, 0, 0]));
    expect(who(nextCast(before, scene([2, 1, 0]), { releaseFirst: "p0" }))).toEqual([
      "p0:working:growth",
      "p1:working:product",
      "p2:working:product",
    ]);
  });

  it("a hint for someone whose team keeps its size, or for nobody here, changes nothing", () => {
    const before = play(scene([2, 1, 0]));
    for (const hint of [{ releaseFirst: "p2" }, { releaseFirst: "p9" }, {}]) {
      expect(who(nextCast(before, scene([1, 2, 0]), hint))).toEqual(who(nextCast(before, scene([1, 2, 0]))));
    }
  });

  it("draws every person of a small company, and a large one by its shares", () => {
    expect(drawnTeams(scene([3, 2, 1]))).toEqual({ product: 3, growth: 2, recruiting: 1 });
    expect(drawnTeams(scene([120, 40, 40]))).toEqual({ product: 30, growth: 10, recruiting: 10 });
  });

  it("one move in a company of 200 can leave the drawn shares as they were", () => {
    expect(drawnTeams(scene([119, 41, 40]))).toEqual(drawnTeams(scene([120, 40, 40])));
  });
});
