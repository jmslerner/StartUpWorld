import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { disposeSharedResources, PHASES } from "../core/palette";
import type { OfficeIndex } from "../types";
import { REPLACEABLE_DECOR, signatureAt, signaturePlan } from "./dressing";
import { decorSize, getLayoutDecor, getOfficeLayout } from "./layouts";
import { createSignatureProp, SIGNATURE_PROPS, SIGNATURE_SIZES } from "./props/signature";

const kinds = (office: OfficeIndex) => getLayoutDecor(getOfficeLayout(office));
const ERA_LOOKS_ALL = ["dial-up", "gold-rush", "bust", "phones", "cheap-money", "winter-ai", "agents", "ambient"] as const;

afterEach(() => {
  disposeSharedResources();
});

describe("signature props", () => {
  it("the garage's filing cabinet and boxes hold two signature props in each era", () => {
    expect([...signaturePlan(kinds(0), "dial-up")]).toEqual([[0, "fax-machine"], [1, "software-shelf"]]);
    expect([...signaturePlan(kinds(0), "bust")]).toEqual([[1, "flat-tv"], [0, "beanbag"]]);
    expect([...signaturePlan(kinds(0), "winter-ai")]).toEqual([[1, "plant-wall"], [0, "ring-light"]]);
  });

  it("each prop takes the smallest spot it fits: the own office in the nineties", () => {
    // own office: four partitions, vending 4, water-cooler 5, bookshelf 6, plant-large 7, plant 8, plant-large 9, plant 10
    expect([...signaturePlan(kinds(2), "dial-up")]).toEqual([[5, "fax-machine"], [6, "software-shelf"], [7, "tube-tv"]]);
  });

  it("never stands in for a reception desk, a meeting pod, a partition, a couch, a table or a game", () => {
    for (const office of PHASES) for (const look of ERA_LOOKS_ALL) for (const i of signaturePlan(kinds(office), look).keys())
      expect(REPLACEABLE_DECOR).toContain(kinds(office)[i].kind);
  });

  it("every office of every era shows at least two of its signature props, each once, and classic none", () => {
    for (const office of PHASES) for (const look of ERA_LOOKS_ALL) {
      const shown = [...signaturePlan(kinds(office), look).values()];
      expect(shown.length).toBeGreaterThanOrEqual(2);
      expect(new Set(shown).size).toBe(shown.length);
      expect(shown.every((k) => SIGNATURE_PROPS[look].includes(k))).toBe(true);
      for (const [i, k] of signaturePlan(kinds(office), look)) expect(signatureAt(kinds(office), i, look)).toBe(k);
    }
    for (const office of PHASES) expect(signaturePlan(kinds(office), "classic").size).toBe(0);
  });

  it("a signature prop stands only where it has room, and fits the spot it stands on", () => {
    for (const office of PHASES) for (const look of ERA_LOOKS_ALL) for (const [i, kind] of signaturePlan(kinds(office), look)) {
      const spot = kinds(office)[i];
      expect(decorSize(spot).width).toBeGreaterThanOrEqual(SIGNATURE_SIZES[kind].width);
      expect(decorSize(spot).depth).toBeGreaterThanOrEqual(SIGNATURE_SIZES[kind].depth);
      const prop = createSignatureProp(kind, decorSize(spot), spot.variant);
      const box = new THREE.Box3().setFromObject(prop.group);
      expect(box.max.x - box.min.x).toBeLessThanOrEqual(decorSize(spot).width + 1e-6);
      expect(box.max.z - box.min.z).toBeLessThanOrEqual(decorSize(spot).depth + 1e-6);
      prop.dispose();
    }
  });
});
