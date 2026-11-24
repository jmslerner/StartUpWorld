import { describe, expect, it } from "vitest";
import type { CpuKind } from "../engine/types";
import { PITCHES, newGameSetup } from "./names";

describe("newGameSetup", () => {
  it("seats the player first and the three CPU kinds after, each once", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const setup = newGameSetup(seed, "Acme");
      expect(setup.seats).toHaveLength(4);
      expect(setup.seats[0]).toMatchObject({ controller: "human", archetype: "startup", name: "Acme" });
      expect(setup.seats.slice(1).map((seat) => seat.controller).sort()).toEqual(["blitzscaler", "bootstrapper", "incumbent"]);
      for (const seat of setup.seats.slice(1)) {
        expect(seat.archetype).toBe(seat.controller === "incumbent" ? "incumbent" : "startup");
      }
    }
  });

  it("can put the baseline bot in the player's seat", () => {
    expect(newGameSetup(3, "Baseline", "baseline").seats[0].controller).toBe("baseline");
  });

  it("is the same for the same seed and different across seeds", () => {
    expect(newGameSetup(7, "Acme")).toEqual(newGameSetup(7, "Acme"));
    const names = new Set(Array.from({ length: 40 }, (_, i) => newGameSetup(i + 1, "Acme").seats[1].name));
    expect(names.size).toBeGreaterThan(10);
  });

  it("gives every company a different name, none of them the player's", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const names = newGameSetup(seed, "Zorbly").seats.map((seat) => seat.name.toLowerCase());
      expect(new Set(names).size, `seed ${seed}`).toBe(4);
    }
  });

  it("gives each CPU a one-line pitch that fits its kind", () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const seat of newGameSetup(seed, "Acme").seats.slice(1)) {
        expect(PITCHES[seat.controller as CpuKind]).toContain(seat.pitch);
        expect(seat.pitch).not.toMatch(/\n/);
      }
    }
  });

  it("does not always seat the kinds in the same order, so position gives nothing away", () => {
    const seatOf = (kind: string) => new Set(Array.from({ length: 60 }, (_, i) => newGameSetup(i + 1, "Acme").seats.findIndex((seat) => seat.controller === kind)));
    for (const kind of ["blitzscaler", "bootstrapper", "incumbent"]) expect([...seatOf(kind)].sort()).toEqual([1, 2, 3]);
  });

  it("falls back to a default name when the player gives none", () => {
    expect(newGameSetup(1, "   ").seats[0].name.length).toBeGreaterThan(0);
    expect(newGameSetup(1, "  Acme  ").seats[0].name).toBe("Acme");
  });
});
