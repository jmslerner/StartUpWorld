import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { CAREER_TEST, newCareer } from "../engine/careerKit";
import { defaultPlan } from "../engine/plan";
import { HUMAN, newGame } from "../engine/testKit";
import { CAREER_SAVE_KEY, CAREER_SAVE_VERSION, parseCareerSave, serializeCareerSave } from "./careerSave";
import { SAVE_KEY, parseSave, serializeSave } from "./save";
import { isGame } from "./shape";

const career = newCareer();
// A career draft is saved, and read back, with goPublic set: the plan check always writes it in a career.
const save = { seed: 7, game: career, draft: { ...defaultPlan(career.companies[HUMAN]), goPublic: false }, lastLog: null, reportOpen: false, record: [{ kind: "launch", turn: 1 }] as const };

describe("the career's save", () => {
  it("has its own key and version", () => {
    expect(CAREER_SAVE_KEY).toBe("startupworld:career:save");
    expect(CAREER_SAVE_KEY).not.toBe(SAVE_KEY);
    expect(CAREER_SAVE_VERSION).toBe(1);
  });

  it("reads back what it wrote, record included", () => {
    expect(parseCareerSave(serializeCareerSave(save), CAREER_TEST)).toEqual(save);
  });

  it.each<[string, (data: Record<string, unknown>) => void]>([
    ["another version", (data) => { data.version = 2; }],
    ["a seed that is not a whole number", (data) => { data.seed = 1.5; }],
    ["a damaged record", (data) => { data.record = [{ kind: "launch" }]; }],
    ["no record", (data) => { delete data.record; }],
    ["a race game", (data) => { data.game = newGame(); }],
  ])("refuses %s", (_name, damage) => {
    const data = JSON.parse(serializeCareerSave(save)) as Record<string, unknown>;
    damage(data);
    expect(parseCareerSave(JSON.stringify(data), CAREER_TEST)).toBeNull();
  });

  it("a race load refuses a game carrying career fields", () => {
    expect(isGame(JSON.parse(JSON.stringify(career)), DESIGN)).toBe(false);
    expect(parseSave(serializeSave({ ...save, game: career }), DESIGN)).toBeNull();
  });
});
