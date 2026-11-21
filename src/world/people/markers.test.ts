import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { executeCommand } from "../../engine";
import { makeTycoonState } from "../../engine/testHelpers";
import type { GameState, TeamRoster } from "../../types/game";
import { buildWorldSnapshot } from "../snapshot";
import type { Seat, StaffView } from "../types";
import { personalEnergyCap } from "./crew";
import { markerFor, markerKey, PersonMarkers, pizzaBoxesFor, pizzaPlan } from "./markers";

const team = (counts: Partial<TeamRoster>): TeamRoster => ({
  engineering: 0, design: 0, marketing: 0, sales: 0, ops: 0, hr: 0, legal: 0, data: 0, product: 0, executive: 0, ...counts,
});

const staff = (changes: Partial<StaffView> = {}): StaffView => ({
  id: "e1", pace: 3, craft: 3, quirk: null, energy: 100, energyBand: "fresh", buildId: null, isLead: false, engaged: true, shipped: 0, offer: null,
  ...changes,
});

const desk = (slotIndex: number): Seat => ({ kind: "desk", slotIndex, x: slotIndex * 2, z: 1, facing: 0 });

describe("overhead markers", () => {
  it("an envelope with the weeks left for an offer, a box for burnout, a star for a lead, nothing otherwise", () => {
    expect(markerFor(undefined)).toBeNull();
    expect(markerFor(staff())).toBeNull();
    expect(markerFor(staff({ isLead: true }))).toEqual({ offer: null, lead: true });
    const offer = markerFor(staff({ offer: { kind: "recruiter", weeksLeft: 2, buildAtRisk: null } }));
    expect(offer).toEqual({ offer: { kind: "recruiter", weeksLeft: 2 }, lead: false });
    expect(markerKey(offer!)).toBe("offer:recruiter:2:");
    expect(markerKey(markerFor(staff({ isLead: true, offer: { kind: "burnout", weeksLeft: 1, buildAtRisk: "atlas" } }))!)).toBe("offer:burnout:1:lead");
  });

  it("without a DOM there is no picture, so no marker (and nothing throws)", () => {
    const scene = new THREE.Scene();
    const markers = new PersonMarkers(scene, false);
    const anchor = new THREE.Object3D();
    markers.sync("e1", anchor, { offer: { kind: "recruiter", weeksLeft: 2 }, lead: false }, true);
    expect(markers.count).toBe(0);
    markers.dispose();
    expect(scene.children).toHaveLength(0);
  });
});

describe("pizza boxes", () => {
  it("one per crunched week, at least one as soon as crunch starts, at most three", () => {
    expect([0, 1, 2, 3, 7].map(pizzaBoxesFor)).toEqual([1, 1, 2, 3, 3]);
  });

  it("go on the desks of a crunching crew, nowhere else", () => {
    let state: GameState = executeCommand(makeTycoonState({ team: team({ engineering: 3, design: 1 }) }), "status").state;
    state = executeCommand(state, "build feature s Atlas").state;
    expect(pizzaPlan(buildWorldSnapshot(state), (id) => desk(Number(id.slice(1))))).toEqual([]);
    state = executeCommand(state, "build crunch atlas on").state;
    const snapshot = buildWorldSnapshot(state);
    const crew = snapshot.builds[0].staffIds;
    const plan = pizzaPlan(snapshot, (id) => desk(Number(id.slice(1))));
    expect(plan.map((entry) => entry.seat.slotIndex).sort()).toEqual(crew.map((id) => Number(id.slice(1))).sort());
    expect(plan.every((entry) => entry.boxes === 1)).toBe(true);
    // Somebody on the floor (an overflow spot) has no desk for one.
    expect(pizzaPlan(snapshot, () => ({ ...desk(0), kind: "overflow" }))).toEqual([]);

    const scene = new THREE.Scene();
    const markers = new PersonMarkers(scene, false);
    markers.setPizza(plan);
    expect(markers.pizzaMesh.count).toBe(plan.length);
    expect(markers.pizzaMesh.visible).toBe(true);
    markers.setPizza([]);
    expect(markers.pizzaMesh.visible).toBe(false);
    markers.dispose();
  });
});

describe("personal energy", () => {
  it("caps how lively a named person looks; unlisted heads are not capped", () => {
    expect(personalEnergyCap(undefined)).toBe(1);
    expect(personalEnergyCap(100)).toBe(1);
    expect(personalEnergyCap(25)).toBeCloseTo(0.4, 6);
    expect(personalEnergyCap(0)).toBeCloseTo(0.2, 6);
  });
});
