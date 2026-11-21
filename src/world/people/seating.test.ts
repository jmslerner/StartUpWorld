import { describe, expect, it } from "vitest";
import type { TeamRoster } from "../../types/game";
import { makeState } from "../../engine/testHelpers";
import { getOfficeLayout } from "../office/layouts";
import { buildWorldSnapshot } from "../snapshot";
import type { OfficeLayout, PersonView, Seat } from "../types";
import { SeatingPlan } from "./seating";
import type { SeatChange } from "./seating";

const team = (counts: Partial<TeamRoster>): TeamRoster => ({
  engineering: 0,
  design: 0,
  marketing: 0,
  sales: 0,
  ops: 0,
  hr: 0,
  legal: 0,
  data: 0,
  product: 0,
  executive: 0,
  ...counts,
});

/** The roster the snapshot would produce for this team (founder and cofounder included). */
const roster = (counts: Partial<TeamRoster>): PersonView[] => buildWorldSnapshot(makeState({ team: team(counts) })).people;

const employee = (id: string): PersonView => ({ id, kind: "employee", role: "engineering", name: id, look: 0 });
const FOUNDER: PersonView = { id: "founder", kind: "founder", role: null, name: "F", look: 0 };
const COFOUNDER: PersonView = { id: "cofounder", kind: "cofounder", role: null, name: "C", look: 0 };

const garage = getOfficeLayout("garage"); // 3 desks, 4 cushions
const coworking = getOfficeLayout("coworking"); // 8 desks, 6 cushions
const office = getOfficeLayout("office"); // 20 desks, 8 cushions

/** "desk 2" / "overflow 0" / "founder" / null — a compact way to compare whole seatings. */
const where = (plan: SeatingPlan, id: string): string | null => {
  const seat = plan.seatOf(id);
  if (seat === null) return null;
  return seat.slotIndex < 0 ? seat.kind : `${seat.kind} ${seat.slotIndex}`;
};

const seating = (plan: SeatingPlan, people: readonly PersonView[]): Record<string, string | null> =>
  Object.fromEntries(people.map((person) => [person.id, where(plan, person.id)]));

const describeSeat = (seat: Seat | null): string | null =>
  seat === null ? null : seat.slotIndex < 0 ? seat.kind : `${seat.kind} ${seat.slotIndex}`;

const moves = (changes: readonly SeatChange[]): string[] =>
  changes.map((change) => `${change.personId}: ${describeSeat(change.from)} → ${describeSeat(change.to)}`);

describe("SeatingPlan", () => {
  it("is empty before the first reconcile", () => {
    const plan = new SeatingPlan();
    expect(plan.seatOf("founder")).toBeNull();
    expect(plan.freeDeskSlots()).toEqual([]);
    expect(plan.hiddenCount()).toBe(0);
    expect(plan.lastChanges()).toEqual([]);
    expect(plan.currentLayout()).toBeNull();
  });

  describe("founders", () => {
    it("seats the founder and cofounder at their reserved seats", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 1 }), 0, office);

      expect(plan.seatOf("founder")).toEqual({ ...office.founderSeat, kind: "founder", slotIndex: -1 });
      expect(plan.seatOf("cofounder")).toEqual({ ...office.cofounderSeat, kind: "cofounder", slotIndex: -1 });
      // Their seats are never desks: every desk is still free for employees.
      expect(plan.freeDeskSlots()).toHaveLength(office.deskSeats.length - 1);
    });

    it("seats the cofounder when they join, without disturbing anyone", () => {
      const plan = new SeatingPlan();
      const alone = [FOUNDER, employee("engineering-0")];
      plan.reconcile(alone, 0, garage);
      expect(plan.seatOf("cofounder")).toBeNull();
      const founderSeat = plan.seatOf("founder");
      const engineerSeat = plan.seatOf("engineering-0");

      plan.reconcile([FOUNDER, COFOUNDER, employee("engineering-0")], 0, garage);
      expect(where(plan, "cofounder")).toBe("cofounder");
      expect(plan.seatOf("founder")).toBe(founderSeat);
      expect(plan.seatOf("engineering-0")).toBe(engineerSeat);
      expect(moves(plan.lastChanges())).toEqual(["cofounder: null → cofounder"]);
    });

    it("never counts founders against desk capacity", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 3 }), 0, garage);
      expect(seating(plan, roster({ engineering: 3 }))).toEqual({
        founder: "founder",
        cofounder: "cofounder",
        "engineering-0": "desk 0",
        "engineering-1": "desk 1",
        "engineering-2": "desk 2",
      });
      expect(plan.hiddenCount()).toBe(0);
    });
  });

  describe("first seating", () => {
    it("fills desks in roster order, then cushions, then hides the rest", () => {
      const plan = new SeatingPlan();
      const people = roster({ engineering: 4, design: 3, sales: 3 }); // 10 employees, 3 desks + 4 cushions
      plan.reconcile(people, 0, garage);

      expect(seating(plan, people)).toEqual({
        founder: "founder",
        cofounder: "cofounder",
        "engineering-0": "desk 0",
        "engineering-1": "desk 1",
        "engineering-2": "desk 2",
        "engineering-3": "overflow 0",
        "design-0": "overflow 1",
        "design-1": "overflow 2",
        "design-2": "overflow 3",
        "sales-0": null,
        "sales-1": null,
        "sales-2": null,
      });
      expect(plan.hiddenCount()).toBe(3);
      expect(plan.freeDeskSlots()).toEqual([]);
    });

    it("hands out seats that match the layout's placements", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 5 }), 0, garage);
      expect(plan.seatOf("engineering-1")).toEqual({ ...garage.deskSeats[1], kind: "desk", slotIndex: 1 });
      expect(plan.seatOf("engineering-4")).toEqual({ ...garage.overflowSpots[1], kind: "overflow", slotIndex: 1 });
    });

    it("reports everyone as newly seated", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 2 }), 0, garage);
      expect(moves(plan.lastChanges())).toEqual([
        "founder: null → founder",
        "cofounder: null → cofounder",
        "engineering-0: null → desk 0",
        "engineering-1: null → desk 1",
      ]);
    });
  });

  describe("stability", () => {
    it("does not move anyone when somebody is hired into an earlier role", () => {
      const plan = new SeatingPlan();
      const before = roster({ engineering: 2, design: 1, sales: 2 });
      plan.reconcile(before, 0, office);
      const seatsBefore = new Map(before.map((person) => [person.id, plan.seatOf(person.id)]));
      expect(where(plan, "design-0")).toBe("desk 2");
      expect(where(plan, "sales-1")).toBe("desk 4");

      // A new engineer lands *before* the designer and the sales team in roster order…
      const after = roster({ engineering: 3, design: 1, sales: 2 });
      expect(after.map((person) => person.id).indexOf("engineering-2")).toBeLessThan(after.map((person) => person.id).indexOf("design-0"));
      plan.reconcile(after, 0, office);

      // …yet nobody else changes desk: same Seat objects, by identity.
      for (const person of before) expect(plan.seatOf(person.id), person.id).toBe(seatsBefore.get(person.id));
      expect(where(plan, "engineering-2")).toBe("desk 5");
      expect(moves(plan.lastChanges())).toEqual(["engineering-2: null → desk 5"]);
    });

    it("stays put across many hires in mixed roles", () => {
      const plan = new SeatingPlan();
      const steps: Array<Partial<TeamRoster>> = [
        { engineering: 1 },
        { engineering: 1, sales: 1 },
        { engineering: 2, sales: 1 },
        { engineering: 2, design: 1, sales: 1 },
        { engineering: 2, design: 1, sales: 1, hr: 1 },
        { engineering: 3, design: 1, data: 1, sales: 1, hr: 1 },
        { engineering: 3, design: 2, data: 1, marketing: 2, sales: 1, hr: 1 },
      ];
      const assigned = new Map<string, string | null>();
      for (const counts of steps) {
        const people = roster(counts);
        plan.reconcile(people, 0, office);
        for (const person of people) {
          const now = where(plan, person.id);
          if (assigned.has(person.id)) expect(now, person.id).toBe(assigned.get(person.id));
          assigned.set(person.id, now);
        }
      }
      // Desks were handed out in hiring order, not roster order.
      expect(assigned.get("engineering-0")).toBe("desk 0");
      expect(assigned.get("sales-0")).toBe("desk 1");
      expect(assigned.get("engineering-1")).toBe("desk 2");
      expect(assigned.get("design-0")).toBe("desk 3");
      expect(assigned.get("hr-0")).toBe("desk 4");
      expect(new Set(assigned.values()).size).toBe(assigned.size);
    });

    it("reports no changes when the same roster is reconciled again", () => {
      const plan = new SeatingPlan();
      const people = roster({ engineering: 4, ops: 2 });
      plan.reconcile(people, 0, coworking);
      const before = seating(plan, people);
      plan.reconcile(people, 0, coworking);
      expect(plan.lastChanges()).toEqual([]);
      expect(seating(plan, people)).toEqual(before);
      // A structurally identical roster (new objects, as every snapshot produces) is the same roster.
      plan.reconcile(roster({ engineering: 4, ops: 2 }), 0, coworking);
      expect(plan.lastChanges()).toEqual([]);
    });

    it("seats several hires made at once in roster order", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 1 }), 0, office);
      plan.reconcile(roster({ engineering: 3, legal: 1, design: 1 }), 0, office);
      expect(moves(plan.lastChanges())).toEqual([
        "engineering-1: null → desk 1",
        "engineering-2: null → desk 2",
        "design-0: null → desk 3",
        "legal-0: null → desk 4",
      ]);
    });
  });

  describe("departures", () => {
    it("frees the seat of somebody who left, and gives it to the next hire", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 2, design: 2, sales: 1 }), 0, office);
      expect(where(plan, "design-1")).toBe("desk 3");

      plan.reconcile(roster({ engineering: 2, design: 1, sales: 1 }), 0, office);
      expect(plan.seatOf("design-1")).toBeNull();
      expect(plan.freeDeskSlots()[0]).toBe(3);
      expect(where(plan, "sales-0")).toBe("desk 4");
      expect(moves(plan.lastChanges())).toEqual(["design-1: desk 3 → null"]);

      plan.reconcile(roster({ engineering: 2, design: 1, sales: 1, legal: 1 }), 0, office);
      expect(where(plan, "legal-0")).toBe("desk 3");
      expect(where(plan, "sales-0")).toBe("desk 4");
    });

    it("lists the people who left before anybody who moved because of it", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 3, design: 2 }), 0, garage);
      // 3 desks: engineers. design-0 and design-1 on cushions 0 and 1.
      plan.reconcile(roster({ engineering: 1, design: 2, ops: 1 }), 0, garage);
      expect(moves(plan.lastChanges())).toEqual([
        "engineering-1: desk 1 → null",
        "engineering-2: desk 2 → null",
        "design-0: overflow 0 → desk 1",
        "design-1: overflow 1 → desk 2",
        "ops-0: null → overflow 0",
      ]);
    });
  });

  describe("promotion off the floor", () => {
    it("promotes the lowest cushion to a freed desk", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 3, design: 3 }), 0, garage);
      expect(where(plan, "design-0")).toBe("overflow 0");
      expect(where(plan, "design-1")).toBe("overflow 1");

      plan.reconcile(roster({ engineering: 2, design: 3 }), 0, garage);
      expect(where(plan, "design-0")).toBe("desk 2");
      // Nobody else shuffles along: the other floor sitters keep their cushions.
      expect(where(plan, "design-1")).toBe("overflow 1");
      expect(where(plan, "design-2")).toBe("overflow 2");
      expect(plan.freeDeskSlots()).toEqual([]);
    });

    it("prefers cushion sitters over hidden people for a desk, and hidden people over nobody for a cushion", () => {
      const plan = new SeatingPlan();
      const packed = roster({ engineering: 3, design: 4, sales: 2 }); // 9 employees: 3 desks, 4 cushions, 2 hidden
      plan.reconcile(packed, 0, garage);
      expect(where(plan, "sales-0")).toBeNull();
      expect(where(plan, "sales-1")).toBeNull();
      expect(plan.hiddenCount()).toBe(2);

      // One engineer leaves: a cushion sitter is promoted, and a hidden person takes the vacated cushion.
      plan.reconcile(roster({ engineering: 2, design: 4, sales: 2 }), 0, garage);
      expect(moves(plan.lastChanges())).toEqual([
        "engineering-2: desk 2 → null",
        "design-0: overflow 0 → desk 2",
        "sales-0: null → overflow 0",
      ]);
      expect(where(plan, "sales-1")).toBeNull();
      expect(plan.hiddenCount()).toBe(1);
    });

    it("promotes in cushion order when several desks free up, then seats the hidden in roster order", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 3, design: 4, sales: 3 }), 0, garage);
      // Free two desks and one cushion at once.
      plan.reconcile(roster({ engineering: 1, design: 3, sales: 3 }), 0, garage);
      expect(seating(plan, roster({ engineering: 1, design: 3, sales: 3 }))).toEqual({
        founder: "founder",
        cofounder: "cofounder",
        "engineering-0": "desk 0",
        "design-0": "desk 1",
        "design-1": "desk 2",
        "design-2": "overflow 2",
        "sales-0": "overflow 0",
        "sales-1": "overflow 1",
        "sales-2": "overflow 3",
      });
      expect(plan.hiddenCount()).toBe(0);
    });

    it("gives a new hire a cushion, not a desk somebody on the floor was waiting for", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 3, design: 1 }), 0, garage);
      expect(where(plan, "design-0")).toBe("overflow 0");
      // An engineer leaves and a lawyer joins in the same step.
      plan.reconcile(roster({ engineering: 2, design: 1, legal: 1 }), 0, garage);
      expect(where(plan, "design-0")).toBe("desk 2");
      expect(where(plan, "legal-0")).toBe("overflow 0");
    });
  });

  describe("capacity", () => {
    it("counts roster people without a spot plus people beyond the roster as hidden", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 9 }), 5, garage); // 3 desks + 4 cushions for 9 employees
      expect(plan.hiddenCount()).toBe(2 + 5);

      plan.reconcile(roster({ engineering: 9 }), 0, garage);
      expect(plan.hiddenCount()).toBe(2);

      plan.reconcile(roster({ engineering: 7 }), 0, garage);
      expect(plan.hiddenCount()).toBe(0);
    });

    it("tracks the snapshot's own cap", () => {
      const snapshot = buildWorldSnapshot(makeState({ team: team({ engineering: 100 }) }));
      const plan = new SeatingPlan();
      const layout = getOfficeLayout("public");
      plan.reconcile(snapshot.people, snapshot.hiddenPeople, layout);
      // 62 employees on stage for 48 desks + 12 cushions, and 38 more beyond the roster.
      expect(plan.freeDeskSlots()).toEqual([]);
      expect(plan.hiddenCount()).toBe(2 + 38);
      expect(where(plan, "engineering-47")).toBe("desk 47");
      expect(where(plan, "engineering-48")).toBe("overflow 0");
      expect(where(plan, "engineering-59")).toBe("overflow 11");
      expect(where(plan, "engineering-60")).toBeNull();
    });

    it("ignores a nonsensical hidden count", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 1 }), -4, garage);
      expect(plan.hiddenCount()).toBe(0);
      plan.reconcile(roster({ engineering: 1 }), Number.NaN, garage);
      expect(plan.hiddenCount()).toBe(0);
      plan.reconcile(roster({ engineering: 1 }), 2.9, garage);
      expect(plan.hiddenCount()).toBe(2);
    });

    it("lists free desks in ascending order, as a fresh array each time", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 5 }), 0, coworking);
      plan.reconcile(roster({ engineering: 2 }), 0, coworking);
      const free = plan.freeDeskSlots();
      expect(free).toEqual([2, 3, 4, 5, 6, 7]);
      free.push(99);
      expect(plan.freeDeskSlots()).toEqual([2, 3, 4, 5, 6, 7]);
      expect(plan.deskOccupant(1)).toBe("engineering-1");
      expect(plan.deskOccupant(2)).toBeNull();
      expect(plan.deskOccupant(99)).toBeNull();
      expect(plan.overflowOccupant(0)).toBeNull();
    });
  });

  describe("moving office", () => {
    it("reseats everyone canonically, in roster order, when the phase changes", () => {
      const plan = new SeatingPlan();
      // Grow the garage in an order that scatters roles across desks and cushions.
      plan.reconcile(roster({ sales: 2 }), 0, garage);
      plan.reconcile(roster({ engineering: 2, sales: 2 }), 0, garage);
      plan.reconcile(roster({ engineering: 2, design: 2, sales: 2 }), 0, garage);
      expect(where(plan, "sales-0")).toBe("desk 0");
      expect(where(plan, "engineering-0")).toBe("desk 2");
      expect(where(plan, "design-1")).toBe("overflow 2");

      const people = roster({ engineering: 2, design: 2, sales: 2 });
      plan.reconcile(people, 0, coworking);
      expect(plan.currentLayout()).toBe(coworking);
      expect(seating(plan, people)).toEqual({
        founder: "founder",
        cofounder: "cofounder",
        "engineering-0": "desk 0",
        "engineering-1": "desk 1",
        "design-0": "desk 2",
        "design-1": "desk 3",
        "sales-0": "desk 4",
        "sales-1": "desk 5",
      });
      expect(plan.seatOf("founder")).toEqual({ ...coworking.founderSeat, kind: "founder", slotIndex: -1 });
      expect(plan.seatOf("design-0")).toEqual({ ...coworking.deskSeats[2], kind: "desk", slotIndex: 2 });
    });

    it("reports every move of the relocation, founders included", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 4 }), 0, garage);
      plan.reconcile(roster({ engineering: 4 }), 0, coworking);
      expect(moves(plan.lastChanges())).toEqual([
        "founder: founder → founder",
        "cofounder: cofounder → cofounder",
        "engineering-0: desk 0 → desk 0",
        "engineering-1: desk 1 → desk 1",
        "engineering-2: desk 2 → desk 2",
        "engineering-3: overflow 0 → desk 3",
      ]);
      // Same slot index, different room: the positions really changed.
      const founderMove = plan.lastChanges()[0];
      expect(founderMove.from).toEqual({ ...garage.founderSeat, kind: "founder", slotIndex: -1 });
      expect(founderMove.to).toEqual({ ...coworking.founderSeat, kind: "founder", slotIndex: -1 });
    });

    it("hides whoever a smaller office cannot hold, and says who", () => {
      const plan = new SeatingPlan();
      const people = roster({ engineering: 10 });
      plan.reconcile(people, 0, office);
      expect(plan.hiddenCount()).toBe(0);

      plan.reconcile(people, 0, garage);
      expect(plan.hiddenCount()).toBe(3);
      expect(where(plan, "engineering-6")).toBe("overflow 3");
      expect(where(plan, "engineering-7")).toBeNull();
      expect(moves(plan.lastChanges()).filter((move) => move.endsWith("→ null"))).toEqual([
        "engineering-7: desk 7 → null",
        "engineering-8: desk 8 → null",
        "engineering-9: desk 9 → null",
      ]);
    });

    it("handles people leaving during the move", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 2, hr: 1 }), 0, garage);
      plan.reconcile(roster({ engineering: 2 }), 0, coworking);
      expect(plan.seatOf("hr-0")).toBeNull();
      expect(moves(plan.lastChanges())[0]).toBe("hr-0: desk 2 → null");
    });

    it("keeps every seat when only the layout object changes (an asset was bought)", () => {
      const plan = new SeatingPlan();
      const withJet = getOfficeLayout("garage", ["jet"]);
      expect(withJet).not.toBe(garage);

      plan.reconcile(roster({ sales: 1 }), 0, garage);
      const people = roster({ engineering: 2, sales: 1, design: 3 });
      plan.reconcile(people, 0, garage);
      const before = new Map(people.map((person) => [person.id, plan.seatOf(person.id)]));
      expect(where(plan, "sales-0")).toBe("desk 0"); // not where a canonical reseat would put them

      plan.reconcile(people, 0, withJet);
      expect(plan.lastChanges()).toEqual([]);
      expect(plan.currentLayout()).toBe(withJet);
      for (const person of people) expect(plan.seatOf(person.id), person.id).toBe(before.get(person.id));
    });

    it("keeps seats for an equal copy of the layout, but not when a desk has moved", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ sales: 1 }), 0, garage);
      const people = roster({ engineering: 1, sales: 1 });
      plan.reconcile(people, 0, garage);
      expect(where(plan, "sales-0")).toBe("desk 0");

      const copy: OfficeLayout = structuredClone(garage);
      plan.reconcile(people, 0, copy);
      expect(plan.lastChanges()).toEqual([]);
      expect(where(plan, "sales-0")).toBe("desk 0");

      const rearranged: OfficeLayout = {
        ...copy,
        deskSeats: copy.deskSeats.map((seat, index) => (index === 1 ? { ...seat, x: seat.x + 0.5 } : seat)),
      };
      plan.reconcile(people, 0, rearranged);
      // A different office after all: canonical order, engineers first.
      expect(where(plan, "engineering-0")).toBe("desk 0");
      expect(where(plan, "sales-0")).toBe("desk 1");
      expect(plan.seatOf("sales-0")).toEqual({ ...rearranged.deskSeats[1], kind: "desk", slotIndex: 1 });
    });
  });

  describe("determinism", () => {
    it("gives two plans fed the same history the same seating", () => {
      const history: Array<[Partial<TeamRoster>, OfficeLayout]> = [
        [{ engineering: 1 }, garage],
        [{ engineering: 2, sales: 1 }, garage],
        [{ engineering: 2, design: 2, sales: 2 }, garage],
        [{ engineering: 1, design: 2, sales: 2, hr: 1 }, garage],
        [{ engineering: 3, design: 2, sales: 2, hr: 1 }, coworking],
        [{ engineering: 3, design: 1, sales: 4, hr: 1, legal: 2 }, coworking],
        [{ engineering: 3, design: 1, sales: 4, hr: 1, legal: 2 }, getOfficeLayout("coworking", ["office-upgrade"])],
        [{ engineering: 6, design: 1, sales: 1, legal: 2, ops: 3 }, coworking],
      ];
      const a = new SeatingPlan();
      const b = new SeatingPlan();
      for (const [counts, layout] of history) {
        a.reconcile(roster(counts), 0, layout);
        b.reconcile(roster(counts), 0, layout);
        expect(seating(a, roster(counts))).toEqual(seating(b, roster(counts)));
        expect(moves(a.lastChanges())).toEqual(moves(b.lastChanges()));
        expect(a.freeDeskSlots()).toEqual(b.freeDeskSlots());
        expect(a.hiddenCount()).toBe(b.hiddenCount());
      }
    });

    it("never seats two people in the same spot, whatever the history", () => {
      const plan = new SeatingPlan();
      const layouts = [garage, coworking, office, coworking, garage];
      let step = 0;
      for (const layout of layouts) {
        for (let size = 0; size <= 30; size += 7) {
          step += 1;
          const counts: Partial<TeamRoster> = {
            engineering: (size * 3 + step) % 9,
            design: (size + step * 2) % 5,
            sales: (size * 2 + step) % 7,
            legal: step % 3,
          };
          const people = roster(counts);
          plan.reconcile(people, 0, layout);
          const taken = people.map((person) => where(plan, person.id)).filter((spot): spot is string => spot !== null);
          expect(new Set(taken).size).toBe(taken.length);
          // Everyone without a spot is accounted for.
          expect(plan.hiddenCount()).toBe(people.length - taken.length);
          // The plan's two views of the desks agree.
          const occupiedDesks = taken.filter((spot) => spot.startsWith("desk")).length;
          expect(plan.freeDeskSlots()).toHaveLength(layout.deskSeats.length - occupiedDesks);
          // No one waits on the floor (or out of sight) while a desk is free.
          if (plan.freeDeskSlots().length > 0) {
            expect(taken.some((spot) => spot.startsWith("overflow"))).toBe(false);
            expect(plan.hiddenCount()).toBe(0);
          }
        }
      }
    });
  });

  describe("housekeeping", () => {
    it("hands out frozen seats", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 1 }), 0, garage);
      const seat = plan.seatOf("engineering-0");
      expect(seat).not.toBeNull();
      expect(Object.isFrozen(seat)).toBe(true);
    });

    it("ignores a repeated id instead of seating a person twice", () => {
      const plan = new SeatingPlan();
      plan.reconcile([FOUNDER, employee("engineering-0"), employee("engineering-0"), employee("engineering-1")], 0, garage);
      expect(where(plan, "engineering-0")).toBe("desk 0");
      expect(where(plan, "engineering-1")).toBe("desk 1");
      expect(plan.freeDeskSlots()).toEqual([2]);
      plan.reconcile([FOUNDER, employee("engineering-0"), employee("engineering-0"), employee("engineering-2")], 0, garage);
      expect(where(plan, "engineering-2")).toBe("desk 1");
      expect(plan.hiddenCount()).toBe(0);
    });

    it("forgets everything on reset", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ sales: 1 }), 0, garage);
      plan.reconcile(roster({ engineering: 1, sales: 1 }), 3, garage);
      expect(where(plan, "sales-0")).toBe("desk 0");

      plan.reset();
      expect(plan.seatOf("founder")).toBeNull();
      expect(plan.hiddenCount()).toBe(0);
      expect(plan.lastChanges()).toEqual([]);
      expect(plan.currentLayout()).toBeNull();

      // A new run starts from a clean, canonical seating.
      plan.reconcile(roster({ engineering: 1, sales: 1 }), 0, garage);
      expect(where(plan, "engineering-0")).toBe("desk 0");
      expect(where(plan, "sales-0")).toBe("desk 1");
      expect(plan.lastChanges()).toHaveLength(4);
    });

    it("keeps the previous change list intact after the next reconcile", () => {
      const plan = new SeatingPlan();
      plan.reconcile(roster({ engineering: 1 }), 0, garage);
      const first = plan.lastChanges();
      plan.reconcile(roster({ engineering: 2 }), 0, garage);
      expect(first).toHaveLength(3);
      expect(plan.lastChanges()).not.toBe(first);
      expect(plan.lastChanges()).toHaveLength(1);
    });
  });
});
