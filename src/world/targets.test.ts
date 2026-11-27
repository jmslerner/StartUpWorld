import { describe, expect, it } from "vitest";
import { nextCast } from "./cast";
import { targetKey, teamOfTarget } from "./targets";
import type { OfficeScene } from "./types";

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

describe("the team of a target", () => {
  it("a person working has their team; someone waiting, leaving or away has none", () => {
    const cast = nextCast(null, scene([1, 1, 0], { away: 1, leaving: 1, arriving: 1 }));
    const seating = { teamOfDesk: () => null };
    expect(["p0", "p1", "p2", "p3", "p4", "p9"].map((personId) => teamOfTarget({ kind: "person", personId }, cast, seating))).toEqual([
      "product",
      "growth",
      null,
      null,
      null,
      null,
    ]);
  });

  it("a person with no cast has none", () => {
    expect(teamOfTarget({ kind: "person", personId: "p0" }, null, { teamOfDesk: () => "product" })).toBeNull();
  });

  it("a desk has the team whose area it is in; a team is itself; anything else has none", () => {
    const seating = { teamOfDesk: (i: number) => (i === 0 ? ("product" as const) : null) };
    expect(teamOfTarget({ kind: "desk", desk: 0 }, null, seating)).toBe("product");
    expect(teamOfTarget({ kind: "desk", desk: 5 }, null, seating)).toBeNull();
    expect(teamOfTarget({ kind: "team", team: "growth" }, null, seating)).toBe("growth");
    expect(teamOfTarget({ kind: "door" }, null, seating)).toBeNull();
    expect(teamOfTarget({ kind: "sign" }, null, seating)).toBeNull();
    expect(teamOfTarget({ kind: "station", station: "ship" }, null, seating)).toBeNull();
  });

  it("names a company by its seat, and a company has no team", () => {
    expect(targetKey({ kind: "company", seat: 2 })).toBe("company:2");
    expect(teamOfTarget({ kind: "company", seat: 2 }, null, { teamOfDesk: () => "product" })).toBeNull();
  });
});
