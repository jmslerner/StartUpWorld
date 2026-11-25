import { describe, expect, it } from "vitest";
import { CAREER_TEST, atTurn, careerOf, newCareer, outSince, qualify, withCareerOf } from "../engine/careerKit";
import { listingOf, rulesForTurn } from "../engine/career";
import { BLITZ, BOOT, HUMAN, resolve, withCompany } from "../engine/testKit";
import { isCareerRecord, milestonesOf, type CareerRecord } from "./careerRecord";

const year = (state: Parameters<typeof resolve>[0], patches: Parameters<typeof resolve>[1] = {}) => {
  const result = resolve(state, patches, 1, CAREER_TEST);
  return { ...result, milestones: milestonesOf(state, result.log, result.state) };
};

describe("the career's record", () => {
  it("records the player's listing with the amount the year raised", () => {
    const opening = qualify(newCareer(), HUMAN);
    const expected = listingOf(opening.companies[HUMAN], opening.climate.multiplier, rulesForTurn(CAREER_TEST, 1)).amount;
    expect(year(opening, { [HUMAN]: { goPublic: true } }).milestones).toContainEqual({ kind: "listed", turn: 1, amount: expected });
  });

  it("records a move from the garage to the shared office", () => {
    const opening = withCompany(newCareer(), HUMAN, { headcount: 5, headcountAtLastClose: 5 });
    expect(year(opening).milestones).toContainEqual({ kind: "office", turn: 1, from: 0, to: 1 });
  });

  it("records a rescue, then a second failure as the player's end", () => {
    const broke = withCompany(atTurn(newCareer(), 4), HUMAN, { cash: 1_000 });
    expect(year(broke).milestones).toContainEqual({ kind: "rescued", turn: 4, reason: "bankrupt" });
    const again = withCareerOf(broke, HUMAN, { rescue: { turn: 2, reason: "bankrupt" } });
    expect(year(again).milestones).toContainEqual({ kind: "out", turn: 4, reason: "bankrupt" });
  });

  it("records the launch in the year the product launched, first", () => {
    const almost = withCompany(newCareer(), HUMAN, { quality: 9.9 });
    expect(year(almost).milestones[0]).toEqual({ kind: "launch", turn: 1 });
  });

  it("names a rival that goes out, and the newcomer that takes its seat, each by its own name", () => {
    const opening = withCareerOf(withCompany(atTurn(newCareer(), 6), BLITZ, { cash: -1 }), BLITZ, { rescue: { turn: 3, reason: "fired" } });
    const gone = year(opening);
    expect(gone.milestones).toContainEqual({ kind: "rivalOut", turn: 6, seat: BLITZ, name: "Zipp", founded: 1, reason: "bankrupt" });
    const due = outSince(atTurn(newCareer(), 9), BOOT, 7);
    const { milestones, state } = year(due);
    const newcomer = state.companies[BOOT];
    expect(newcomer.name).not.toBe("Oakline");
    expect(milestones).toContainEqual({ kind: "rivalIn", turn: 10, seat: BOOT, name: newcomer.name, pitch: newcomer.pitch });
    expect(careerOf(state, BOOT).founded).toBe(10);
  });

  it("checks a saved record field by field", () => {
    const record: CareerRecord = [
      { kind: "launch", turn: 2 },
      { kind: "office", turn: 5, from: 0, to: 1 },
      { kind: "rivalIn", turn: 9, seat: 2, name: "Newco", pitch: "Something new." },
    ];
    expect(isCareerRecord(JSON.parse(JSON.stringify(record)), 4)).toBe(true);
    expect(isCareerRecord([], 4)).toBe(true);
    expect(isCareerRecord([{ kind: "merged", turn: 2 }], 4)).toBe(false);
    expect(isCareerRecord([{ kind: "office", turn: 5, from: 0 }], 4)).toBe(false);
    expect(isCareerRecord([{ kind: "rivalIn", turn: 9, seat: 4, name: "Newco", pitch: "x" }], 4)).toBe(false);
    expect(isCareerRecord([{ kind: "rescued", turn: 3, reason: "merged" }], 4)).toBe(false);
    expect(isCareerRecord({ 0: { kind: "launch", turn: 2 } }, 4)).toBe(false);
  });
});
