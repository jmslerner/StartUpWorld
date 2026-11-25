import { describe, expect, it } from "vitest";
import { nextCast } from "../cast";
import type { Cast } from "../cast";
import { getOfficeLayout } from "../office/layouts";
import type { OfficeIndex, OfficeLayout, OfficeScene, Seat } from "../types";
import { SeatingPlan } from "./seating";
import type { SeatChange } from "./seating";
import { scene } from "./testKit";

const garage = getOfficeLayout(0); // 4 desks, 4 waiting spots
const shared = getOfficeLayout(1); // 9 desks, 6 waiting spots
const fullFloor = getOfficeLayout(3); // 40 desks

const seats = (plan: SeatingPlan, cast: Cast) =>
  cast.people.map((p) => {
    const s = plan.seatOf(p.id);
    return s === null ? `${p.id}:-` : `${p.id}:${s.kind}${s.index}`;
  });

const describeSeat = (seat: Seat | null): string => (seat === null ? "-" : `${seat.kind}${seat.index}`);
const moves = (changes: readonly SeatChange[]): string[] =>
  changes.map((change) => `${change.personId}: ${describeSeat(change.from)} → ${describeSeat(change.to)}`);

/** Plays the scenes through one cast and one plan, each in the office its scene names. Returns the last cast. */
const play = (plan: SeatingPlan, ...scenes: OfficeScene[]): Cast => {
  let cast: Cast | null = null;
  for (const next of scenes) {
    cast = nextCast(cast, next);
    plan.reconcile(cast, getOfficeLayout(next.office));
  }
  return cast!;
};

describe("SeatingPlan", () => {
  it("is empty before the first reconcile", () => {
    const plan = new SeatingPlan();
    expect(plan.seatOf("p0")).toBeNull();
    expect(plan.teamOfDesk(0)).toBeNull();
    expect(plan.freeDeskSlots()).toEqual([]);
    expect(plan.hiddenCount()).toBe(0);
    expect(plan.lastChanges()).toEqual([]);
    expect(plan.deskOccupant(0)).toBeNull();
    expect(plan.waitingOccupant(0)).toBeNull();
    expect(plan.currentLayout()).toBeNull();
  });

  describe("the rulings", () => {
    it("teams sit along the benches in order: Product, then Growth, then Recruiting", () => {
      const plan = new SeatingPlan();
      const cast = play(plan, scene([3, 2, 1]));
      expect(seats(plan, cast)).toEqual(["p0:desk0", "p1:desk1", "p2:desk2", "p3:desk3", "p4:desk4", "p5:desk5"]);
      expect([0, 3, 5, 6].map((desk) => plan.teamOfDesk(desk))).toEqual(["product", "growth", "recruiting", null]);
      expect([-1, 9, 0.5, Number.NaN].map((desk) => plan.teamOfDesk(desk))).toEqual([null, null, null, null]);
    });

    it("a person who changes team keeps the desk when it falls in the new team's area", () => {
      const plan = new SeatingPlan();
      const moved = play(plan, scene([3, 0, 0]), scene([2, 1, 0]));
      expect(moved.people[2].team).toBe("growth");
      expect(seats(plan, moved)[2]).toBe("p2:desk2");
      expect(plan.teamOfDesk(2)).toBe("growth");
      expect(plan.lastChanges()).toEqual([]);
    });

    it("when a team grows, only the people its area displaces walk (Review Focus 2)", () => {
      const plan = new SeatingPlan();
      const grown = play(plan, scene([3, 2, 0]), scene([4, 2, 0]));
      expect(seats(plan, grown)).toEqual(["p0:desk0", "p1:desk1", "p2:desk2", "p3:desk5", "p4:desk4", "p5:desk3"]);
      expect(moves(plan.lastChanges())).toEqual(["p3: desk3 → desk5", "p5: - → desk3"]);
    });

    it("when one person changes team, at most two people walk", () => {
      const plan = new SeatingPlan();
      // p0 … p3 Product, p4 … p6 Growth, p7 Recruiting; then one of Growth's goes to Product.
      const cast = play(plan, scene([4, 3, 1]), scene([5, 2, 1]));
      expect(cast.people.find((p) => p.id === "p6")?.team).toBe("product");
      expect(plan.lastChanges().length).toBeLessThanOrEqual(2);
      expect(moves(plan.lastChanges())).toEqual(["p4: desk4 → desk6", "p6: desk6 → desk4"]);
    });

    it("someone away keeps the desk", () => {
      const plan = new SeatingPlan();
      const before = play(plan, scene([2, 2, 1]));
      const desk = plan.seatOf("p3");
      expect(describeSeat(desk)).toBe("desk3");
      let cast = nextCast(before, scene([2, 1, 1], { away: 1 }));
      plan.reconcile(cast, shared);
      expect(cast.people.find((p) => p.id === "p3")?.standing).toBe("away");
      expect(plan.seatOf("p3")).toBe(desk);
      expect(plan.deskOccupant(3)).toBe("p3");
      expect(plan.teamOfDesk(3)).toBe("growth");
      expect(plan.freeDeskSlots()).toEqual([5, 6, 7, 8]);
      expect(plan.lastChanges()).toEqual([]);
      cast = nextCast(cast, scene([2, 2, 1]));
      plan.reconcile(cast, shared);
      expect(plan.seatOf("p3")).toBe(desk);
      expect(plan.lastChanges()).toEqual([]);
    });

    it("people leaving stand nearest the door, then people expected", () => {
      const plan = new SeatingPlan();
      const cast = play(plan, scene([2, 1, 0]), scene([2, 0, 0], { leaving: 1, arriving: 2 }));
      expect(cast.people.map((p) => p.standing)).toEqual(["working", "working", "leaving", "waiting", "waiting"]);
      expect(seats(plan, cast)).toEqual(["p0:desk0", "p1:desk1", "p2:waiting0", "p3:waiting1", "p4:waiting2"]);
      expect([0, 1, 2, 3].map((spot) => plan.waitingOccupant(spot))).toEqual(["p2", "p3", "p4", null]);
      expect(plan.seatOf("p2")).toMatchObject(shared.waitingSpots[0]);
      // The desk the leaver had is free again, and no team has it.
      expect(plan.deskOccupant(2)).toBeNull();
      expect(plan.teamOfDesk(2)).toBeNull();
    });

    it("someone who joins the people leaving goes ahead of the people expected", () => {
      const plan = new SeatingPlan();
      let cast = play(plan, scene([2, 0, 0], { arriving: 2 }));
      expect(seats(plan, cast)).toEqual(["p0:desk0", "p1:desk1", "p2:waiting0", "p3:waiting1"]);
      const spot = plan.seatOf("p2");
      cast = nextCast(cast, scene([2, 0, 0], { arriving: 2 }));
      plan.reconcile(cast, shared);
      expect(plan.seatOf("p2")).toBe(spot);
      cast = nextCast(cast, scene([1, 0, 0], { leaving: 1, arriving: 2 }));
      plan.reconcile(cast, shared);
      expect(seats(plan, cast)).toEqual(["p0:desk0", "p1:waiting0", "p2:waiting1", "p3:waiting2"]);
    });

    it("more people at the door than spots: the rest are not drawn", () => {
      const plan = new SeatingPlan();
      const cast = play(plan, scene([1, 0, 0], { office: 0, arriving: 6 }));
      expect(garage.waitingSpots).toHaveLength(4);
      expect(seats(plan, cast)).toEqual(["p0:desk0", "p1:waiting0", "p2:waiting1", "p3:waiting2", "p4:waiting3", "p5:-", "p6:-"]);
      // People at the door are not people who work here: the sign does not count them.
      expect(plan.hiddenCount()).toBe(0);
    });

    it("more people working than desks: the last have no seat and are counted (Review Focus 1)", () => {
      const plan = new SeatingPlan();
      const crowded = play(plan, scene([6, 0, 0], { office: 0 }));
      expect([seats(plan, crowded).slice(4), plan.hiddenCount()]).toEqual([["p4:-", "p5:-"], 2]);
      expect(plan.freeDeskSlots()).toEqual([]);
    });

    it("a team past the last desk has no area", () => {
      const plan = new SeatingPlan();
      const crowded = play(plan, scene([2, 3, 2], { office: 0 }));
      expect(seats(plan, crowded)).toEqual(["p0:desk0", "p1:desk1", "p2:desk2", "p3:desk3", "p4:-", "p5:-", "p6:-"]);
      expect([0, 1, 2, 3].map((desk) => plan.teamOfDesk(desk))).toEqual(["product", "product", "growth", "growth"]);
      expect(plan.hiddenCount()).toBe(3);
    });

    it("someone without a desk takes one as soon as their team's area has one free", () => {
      const plan = new SeatingPlan();
      const cast = play(plan, scene([6, 0, 0], { office: 0 }), scene([5, 0, 0], { office: 0 }));
      // p5, the most recent joiner, has left; p4 still has no desk, since nobody with one went.
      expect(seats(plan, cast)).toEqual(["p0:desk0", "p1:desk1", "p2:desk2", "p3:desk3", "p4:-"]);
      expect(plan.hiddenCount()).toBe(1);
    });

    it("another office seats everyone afresh, teams together (Review Focus 2)", () => {
      const plan = new SeatingPlan();
      // Scattered: a hire into Product displaces one of Growth's, then one of Product's goes to Recruiting.
      let cast = play(plan, scene([3, 2, 0]), scene([4, 2, 0]), scene([3, 2, 1]));
      expect(seats(plan, cast)).toEqual(["p0:desk0", "p1:desk1", "p2:desk2", "p3:desk3", "p4:desk4", "p5:desk5"]);
      cast = nextCast(cast, scene([3, 2, 2]));
      plan.reconcile(cast, shared);
      cast = nextCast(cast, scene([4, 2, 2]));
      plan.reconcile(cast, shared);
      const scattered = seats(plan, cast);
      expect(scattered).not.toEqual(cast.people.map((p, i) => `${p.id}:desk${i}`));

      const moved = nextCast(cast, scene([4, 2, 2], { office: 3, capacity: 40 }));
      plan.reconcile(moved, fullFloor);
      // Product in id order on the first desks, then Growth, then Recruiting.
      const inTeamOrder = ["product", "growth", "recruiting"].flatMap((team) => moved.people.filter((p) => p.team === team).map((p) => p.id));
      expect(inTeamOrder.map((id) => plan.seatOf(id)?.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(plan.currentLayout()).toBe(fullFloor);
      for (const person of moved.people) expect(plan.seatOf(person.id)).toMatchObject(fullFloor.deskSeats[plan.seatOf(person.id)!.index]);
    });

    it("the count on the sign is the people not drawn plus the people without a seat", () => {
      const plan = new SeatingPlan();
      const campus = play(plan, scene([90, 45, 15], { office: 4, capacity: 150 }));
      expect([campus.hidden, campus.people.length, plan.hiddenCount()]).toEqual([100, 50, 100]);
      expect(plan.freeDeskSlots()).toEqual([]);
      // 50 drawn in a smaller office: 100 on the sign already, and ten more for whom the full floor has no desk.
      plan.reconcile(campus, fullFloor);
      expect(plan.hiddenCount()).toBe(110);
    });

    it("a fresh cast seats everyone afresh, like another office", () => {
      const plan = new SeatingPlan();
      play(plan, scene([3, 2, 0]), scene([4, 2, 0]));
      const again = nextCast(null, scene([4, 2, 0], { runId: "another" }));
      plan.reconcile(again, shared);
      expect(seats(plan, again)).toEqual(["p0:desk0", "p1:desk1", "p2:desk2", "p3:desk3", "p4:desk4", "p5:desk5"]);
    });
  });

  describe("stability", () => {
    it("reports no changes when the same cast is reconciled again, and hands out the same seats", () => {
      const plan = new SeatingPlan();
      const cast = play(plan, scene([3, 2, 1], { leaving: 1, arriving: 2 }));
      const before = cast.people.map((p) => plan.seatOf(p.id));
      plan.reconcile(cast, shared);
      expect(plan.lastChanges()).toEqual([]);
      expect(cast.people.map((p) => plan.seatOf(p.id))).toEqual(before);
      cast.people.forEach((p, i) => expect(plan.seatOf(p.id)).toBe(before[i]));
    });

    it("a hire into the last team moves nobody", () => {
      const plan = new SeatingPlan();
      const cast = play(plan, scene([3, 2, 1]), scene([3, 2, 2]));
      expect(moves(plan.lastChanges())).toEqual(["p6: - → desk6"]);
      expect(seats(plan, cast).slice(0, 6)).toEqual(["p0:desk0", "p1:desk1", "p2:desk2", "p3:desk3", "p4:desk4", "p5:desk5"]);
    });

    it("lists the people who are gone before anybody who moved because of it", () => {
      const plan = new SeatingPlan();
      play(plan, scene([2, 2, 0], { leaving: 1 }), scene([2, 2, 0], { year: 1991 }));
      expect(moves(plan.lastChanges())).toEqual(["p4: waiting0 → -"]);
      play(plan, scene([2, 2, 0], { runId: "b" }), scene([1, 2, 0], { runId: "b", year: 1991 }));
      // p1 has gone; Growth's area starts one desk earlier, so its second member takes the desk p1 had.
      expect(moves(plan.lastChanges())).toEqual(["p1: desk1 → -", "p3: desk3 → desk1"]);
    });

    it("keeps every seat for an equal copy of the layout, but not when a desk has moved", () => {
      const plan = new SeatingPlan();
      const cast = play(plan, scene([3, 2, 0]), scene([4, 2, 0]));
      const before = seats(plan, cast);
      const copy: OfficeLayout = { ...shared, deskSeats: shared.deskSeats.map((seat) => ({ ...seat })) };
      plan.reconcile(cast, copy);
      expect(seats(plan, cast)).toEqual(before);
      expect(plan.lastChanges()).toEqual([]);
      const nudged: OfficeLayout = { ...shared, deskSeats: shared.deskSeats.map((seat, i) => (i === 0 ? { ...seat, x: seat.x + 0.5 } : seat)) };
      plan.reconcile(cast, nudged);
      expect(seats(plan, cast)).toEqual(["p0:desk0", "p1:desk1", "p2:desk2", "p3:desk4", "p4:desk5", "p5:desk3"]);
    });
  });

  describe("determinism", () => {
    const history = (): OfficeScene[] => {
      const scenes: OfficeScene[] = [];
      let state = 12345;
      const roll = (n: number): number => {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        return (state >>> 8) % n;
      };
      for (let step = 0; step < 60; step += 1) {
        const office = Math.min(4, Math.floor(step / 12)) as OfficeIndex;
        scenes.push(
          scene([roll(30), roll(20), roll(12)], {
            office,
            year: 1990 + Math.floor(step / 3),
            away: roll(2),
            leaving: roll(4),
            arriving: roll(8),
          })
        );
      }
      return scenes;
    };

    it("gives two plans fed the same history the same seating", () => {
      const a = new SeatingPlan();
      const b = new SeatingPlan();
      const castA = play(a, ...history());
      const castB = play(b, ...history());
      expect(seats(a, castA)).toEqual(seats(b, castB));
      expect(a.hiddenCount()).toBe(b.hiddenCount());
    });

    it("never seats two people in the same spot, nobody outside their team's area, whatever the history", () => {
      const plan = new SeatingPlan();
      let cast: Cast | null = null;
      for (const next of history()) {
        cast = nextCast(cast, next);
        const layout = getOfficeLayout(next.office);
        plan.reconcile(cast, layout);
        const taken = new Set<string>();
        let working = 0;
        let seatedWorking = 0;
        for (const person of cast.people) {
          const seat = plan.seatOf(person.id);
          if (person.standing === "working") working += 1;
          if (seat === null) continue;
          const key = `${seat.kind}${seat.index}`;
          expect(taken.has(key)).toBe(false);
          taken.add(key);
          if (seat.kind === "desk") {
            expect(["working", "away"]).toContain(person.standing);
            expect(plan.teamOfDesk(seat.index)).toBe(person.team);
            expect(plan.deskOccupant(seat.index)).toBe(person.id);
            if (person.standing === "working") seatedWorking += 1;
          } else {
            expect(["leaving", "waiting"]).toContain(person.standing);
            expect(plan.waitingOccupant(seat.index)).toBe(person.id);
          }
        }
        expect(plan.hiddenCount()).toBe(cast.hidden + working - seatedWorking);
        const desks = layout.deskSeats.length;
        expect(plan.freeDeskSlots().length + [...taken].filter((key) => key.startsWith("desk")).length).toBe(desks);
      }
    });
  });

  describe("housekeeping", () => {
    it("hands out frozen seats that match the layout's placements", () => {
      const plan = new SeatingPlan();
      play(plan, scene([1, 0, 0], { arriving: 1 }));
      const desk = plan.seatOf("p0")!;
      expect(Object.isFrozen(desk)).toBe(true);
      expect(desk).toEqual({ ...shared.deskSeats[0], kind: "desk", index: 0 });
      expect(plan.seatOf("p1")).toEqual({ ...shared.waitingSpots[0], kind: "waiting", index: 0 });
    });

    it("lists free desks in ascending order, as a fresh array each time", () => {
      const plan = new SeatingPlan();
      play(plan, scene([2, 0, 0], { office: 0 }));
      const free = plan.freeDeskSlots();
      expect(free).toEqual([2, 3]);
      free.push(99);
      expect(plan.freeDeskSlots()).toEqual([2, 3]);
    });

    it("ignores a repeated id instead of seating a person twice", () => {
      const plan = new SeatingPlan();
      const cast = nextCast(null, scene([2, 0, 0]));
      plan.reconcile({ ...cast, people: [cast.people[0], cast.people[0], cast.people[1]] }, shared);
      expect([plan.deskOccupant(0), plan.deskOccupant(1), plan.deskOccupant(2)]).toEqual(["p0", "p1", null]);
    });

    it("ignores a hidden count that is not a count", () => {
      const plan = new SeatingPlan();
      const cast = nextCast(null, scene([2, 0, 0]));
      for (const hidden of [Number.NaN, -3, Number.POSITIVE_INFINITY]) {
        plan.reconcile({ ...cast, hidden }, shared);
        expect(plan.hiddenCount()).toBe(0);
      }
      plan.reconcile({ ...cast, hidden: 2.9 }, shared);
      expect(plan.hiddenCount()).toBe(2);
    });

    it("forgets everything on reset", () => {
      const plan = new SeatingPlan();
      const cast = play(plan, scene([3, 2, 0]), scene([4, 2, 0]));
      plan.reset();
      expect(plan.seatOf("p0")).toBeNull();
      expect(plan.freeDeskSlots()).toEqual([]);
      expect(plan.hiddenCount()).toBe(0);
      expect(plan.lastChanges()).toEqual([]);
      expect(plan.currentLayout()).toBeNull();
      plan.reconcile(cast, shared);
      expect(seats(plan, cast)).toEqual(["p0:desk0", "p1:desk1", "p2:desk2", "p3:desk4", "p4:desk5", "p5:desk3"]);
    });

    it("keeps the previous change list intact after the next reconcile", () => {
      const plan = new SeatingPlan();
      const cast = play(plan, scene([2, 0, 0]));
      const first = plan.lastChanges();
      expect(first).toHaveLength(2);
      plan.reconcile(nextCast(cast, scene([3, 0, 0])), shared);
      expect(first).toHaveLength(2);
      expect(plan.lastChanges()).not.toBe(first);
    });
  });
});
