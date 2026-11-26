import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { disposeSharedResources, PHASES } from "../core/palette";
import type { OfficeIndex } from "../types";
import { facesCamera, REPLACEABLE_DECOR, signatureAt, signaturePlan } from "./dressing";
import { decorSize, getLayoutDecor, getOfficeLayout } from "./layouts";
import { createSignatureProp, SIGNATURE_PROPS, SIGNATURE_SIZES } from "./props/signature";

const kinds = (office: OfficeIndex) => getLayoutDecor(getOfficeLayout(office));
const ERA_LOOKS_ALL = ["dial-up", "gold-rush", "bust", "phones", "cheap-money", "winter-ai", "agents", "ambient"] as const;
/** The eras whose rows are final (the last two still borrow a stand-in row). */
const OWN_ROWS = ["dial-up", "gold-rush", "bust", "phones", "cheap-money", "winter-ai"] as const;

afterEach(() => {
  disposeSharedResources();
});

describe("signature props", () => {
  it("each era has three props, the first its own", () => {
    expect(SIGNATURE_PROPS["dial-up"]).toEqual(["fax-machine", "dot-printer", "tube-tv"]);
    expect(SIGNATURE_PROPS["gold-rush"]).toEqual(["software-shelf", "pinball", "tube-tv"]);
    expect(SIGNATURE_PROPS.bust).toEqual(["box-stack", "fax-machine", "flat-tv"]);
    expect(SIGNATURE_PROPS.phones).toEqual(["charging-kiosk", "flat-tv", "beanbag"]);
    expect(SIGNATURE_PROPS["cheap-money"]).toEqual(["foosball", "drinks-fridge", "scooter"]);
    expect(SIGNATURE_PROPS["winter-ai"]).toEqual(["compute-cabinet", "plant-wall", "ring-light"]);
    const firsts = OWN_ROWS.map((look) => SIGNATURE_PROPS[look][0]);
    expect(new Set(firsts).size).toBe(firsts.length);
  });

  it("the two tightest offices stand the props this table says (index into the office's décor, then kind)", () => {
    // garage: 0 filing cabinet 0.46 × 0.6, 1 boxes 1.0 × 0.6. shared office: 0 large plant 0.8 × 0.8,
    // 1 water cooler 0.45 × 0.4, 3 plant 0.55 × 0.55. Measured with signaturePlan over the real layouts and these sizes.
    const plans: Record<(typeof OWN_ROWS)[number], [unknown, unknown]> = {
      "dial-up": [[[0, "fax-machine"], [1, "dot-printer"]], [[1, "fax-machine"], [3, "dot-printer"], [0, "tube-tv"]]],
      "gold-rush": [[[1, "software-shelf"], [0, "pinball"]], [[0, "software-shelf"], [3, "pinball"]]],
      bust: [[[1, "box-stack"], [0, "fax-machine"]], [[3, "box-stack"], [1, "fax-machine"], [0, "flat-tv"]]],
      phones: [[[0, "charging-kiosk"], [1, "flat-tv"]], [[1, "charging-kiosk"], [0, "flat-tv"], [3, "beanbag"]]],
      "cheap-money": [[[1, "foosball"], [0, "drinks-fridge"]], [[0, "foosball"], [3, "drinks-fridge"]]],
      "winter-ai": [[[1, "compute-cabinet"], [0, "ring-light"]], [[0, "compute-cabinet"], [1, "ring-light"]]],
    };
    for (const look of OWN_ROWS) {
      expect([...signaturePlan(kinds(0), look)], `garage ${look}`).toEqual(plans[look][0]);
      expect([...signaturePlan(kinds(1), look)], `shared ${look}`).toEqual(plans[look][1]);
    }
  });

  it("each prop takes the smallest spot it fits: the own office in the dial-up era", () => {
    // own office: four partitions, vending 4, water-cooler 5, bookshelf 6, plant-large 7, plant 8, plant-large 9, plant 10
    expect([...signaturePlan(kinds(2), "dial-up")]).toEqual([[5, "fax-machine"], [8, "dot-printer"], [7, "tube-tv"]]);
  });

  it("every era's first prop shows in every office", () => {
    for (const office of PHASES) for (const look of OWN_ROWS)
      expect([...signaturePlan(kinds(office), look).values()], `office ${office} ${look}`).toContain(SIGNATURE_PROPS[look][0]);
  });

  it("faces the camera: the front of a spot turned toward +X+Z is seen, one toward the back walls is not", () => {
    expect([0, Math.PI / 2, Math.PI / 4].map(facesCamera)).toEqual([true, true, true]);
    expect([Math.PI, -Math.PI / 2, (-3 * Math.PI) / 4].map(facesCamera)).toEqual([false, false, false]);
  });

  it("every signature prop in every office of every era faces the camera", () => {
    for (const office of PHASES) for (const look of ERA_LOOKS_ALL) for (const index of signaturePlan(kinds(office), look).keys())
      expect(facesCamera(kinds(office)[index].facing), `office ${office} ${look} spot ${index}`).toBe(true);
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
