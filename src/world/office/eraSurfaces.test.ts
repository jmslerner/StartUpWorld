import { describe, expect, it } from "vitest";
import { colorDistance, ERA_LOOKS, PHASES } from "../core/palette";
import type { LookId } from "../types";
import { floorColorFor, wallColorFor } from "./props/building";
import { deskColorFor } from "./props/workstations";

/**
 * Design §10.2: every era can be told apart at a glance. What the eye takes in first is what fills the picture:
 * the floor, the walls and the desk tops. Accents and props are too small to carry it on their own.
 */
const ERAS = Object.values(ERA_LOOKS) as LookId[];
/** A colour distance (CIE 1976 ΔE in L*a*b*) two surfaces must be apart to read as different at a glance. */
const AT_A_GLANCE = 12;
/** Of the three big surfaces, how many must read as different. */
const SURFACES_THAT_DIFFER = 2;

const surfaces = (office: (typeof PHASES)[number], look: LookId) => ({
  floor: floorColorFor(office, look),
  wall: wallColorFor(office, look),
  desk: deskColorFor(office, look),
});

describe("every era can be told apart at a glance by its big surfaces", () => {
  it(`in every office, any two eras differ by ΔE ${AT_A_GLANCE} or more in at least ${SURFACES_THAT_DIFFER} of floor, walls and desk tops`, () => {
    const close: string[] = [];
    for (const office of PHASES) {
      for (let i = 0; i < ERAS.length; i += 1) {
        for (let j = i + 1; j < ERAS.length; j += 1) {
          const a = surfaces(office, ERAS[i]);
          const b = surfaces(office, ERAS[j]);
          const gaps = (["floor", "wall", "desk"] as const).map((part) => [part, colorDistance(a[part], b[part])] as const);
          if (gaps.filter(([, gap]) => gap >= AT_A_GLANCE).length < SURFACES_THAT_DIFFER) {
            close.push(`office ${office}: ${ERAS[i]} vs ${ERAS[j]} (${gaps.map(([part, gap]) => `${part} ${gap.toFixed(1)}`).join(", ")})`);
          }
        }
      }
    }
    expect(close).toEqual([]);
  });

  it("the bust and the phones, which share their furniture, differ in floor, walls and desk tops in every office", () => {
    for (const office of PHASES) {
      const bust = surfaces(office, "bust");
      const phones = surfaces(office, "phones");
      for (const part of ["floor", "wall", "desk"] as const) {
        expect(colorDistance(bust[part], phones[part]), `office ${office} ${part}`).toBeGreaterThanOrEqual(AT_A_GLANCE);
      }
    }
  });

  it("the classic look keeps its surfaces as they were", () => {
    expect(PHASES.map((office) => wallColorFor(office, "classic"))).toEqual([0xddd5c2, 0xb9664b, 0xf0e6d2, 0xf6f2e9, 0x80523a]);
    expect(PHASES.map((office) => deskColorFor(office, "classic"))).toEqual([0xdcb785, 0xecd5ae, 0xf6f2e9, 0xcf9e66, 0x80523a]);
    expect(floorColorFor(0, "classic")).toBe(0xacadac);
  });
});
