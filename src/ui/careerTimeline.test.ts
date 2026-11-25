import { describe, expect, it } from "vitest";
import { newGameSetup } from "../ai/names";
import { CAREER } from "../config";
import { CAREER_TEST, atTurn, newCareer, withCareerOf } from "../engine/careerKit";
import { upcomingShift } from "../engine";
import { createGame } from "../engine/setup";
import { DESIGN } from "../config.design";
import { HUMAN, newGame, withCompany } from "../engine/testKit";
import type { CareerRecord } from "../state/careerRecord";
import { careerStatusView, datedYear, marksOf, officePhrase, timelineView } from "./careerTimeline";

const real = (turn: number) => atTurn(createGame(newGameSetup(1, "Acme"), CAREER), turn);
const datedUpTo = (year: number) => CAREER.career.dated.filter((card) => card.year <= year).map((card) => card.year);

describe("the timeline", () => {
  it("shows the year, its era, the whole career's eras and where history ends", () => {
    const view = timelineView(real(32), [], CAREER)!;
    expect(view).toMatchObject({ year: 2021, firstYear: 1990, lastYear: 2038, historyEnds: 2026 });
    expect(view.era).toMatchObject({ name: "Cheap money years", firstYear: 2014, lastYear: 2021, current: true });
    expect(view.eras.map((era) => [era.name, era.firstYear, era.lastYear, era.invented])).toEqual([
      ["Dial-up dawn", 1990, 1994, false],
      ["Browser gold rush", 1995, 1999, false],
      ["Bust and broadband", 2000, 2006, false],
      ["Phones and cloud", 2007, 2013, false],
      ["Cheap money years", 2014, 2021, false],
      ["Winter and AI", 2022, 2026, false],
      ["Agent economy", 2027, 2032, true],
      ["Ambient age", 2033, 2038, true],
    ]);
  });

  it("shows dated cards up to this year, and announces a platform shift two years ahead, never earlier", () => {
    const view = timelineView(real(32), [], CAREER)!;
    expect(view.cards.map((card) => card.year)).toEqual(datedUpTo(2021));
    expect(view.cards.find((card) => card.year === 2007)).toEqual({ year: 2007, name: "The touchscreen phone", shift: true });
    const notice = upcomingShift(32, CAREER)!;
    expect(view.shift).toEqual({ name: "The chatbot", year: 2023, yearsAway: 2, ceiling: notice.ceiling, text: `A platform shift comes in 2023 (The chatbot), in 2 years: that year no product keeps more than quality ${notice.ceiling}.` });
    expect(timelineView(real(33), [], CAREER)!.shift?.text).toMatch(/^A platform shift comes in 2023 \(The chatbot\), next year:/);
    expect(timelineView(real(31), [], CAREER)!.shift).toBeNull();
    expect(timelineView(real(34), [], CAREER)!.shift).toBeNull();
  });

  it("marks the career's milestones by year", () => {
    const record: CareerRecord = [
      { kind: "launch", turn: 2 },
      { kind: "office", turn: 5, from: 0, to: 1 },
      { kind: "rivalOut", turn: 8, seat: 2, name: "Zed", founded: 1, reason: "fired" },
      { kind: "rivalIn", turn: 10, seat: 2, name: "Newco", pitch: "Something new." },
      { kind: "rescued", turn: 12, reason: "bankrupt" },
      { kind: "listed", turn: 23, amount: 4_000_000 },
      { kind: "office", turn: 30, from: 1, to: 2 },
    ];
    expect(marksOf(record, CAREER)).toEqual([
      { year: 1991, kind: "launch", yours: true, text: "Product launched" },
      { year: 1994, kind: "office", yours: true, text: "Moved to the shared office" },
      { year: 1997, kind: "rivalOut", yours: false, text: "Zed's founder was fired" },
      { year: 1999, kind: "rivalIn", yours: false, text: "Newco entered" },
      { year: 2001, kind: "rescued", yours: true, text: "Rescued from bankruptcy" },
      { year: 2012, kind: "listed", yours: true, text: "Went public, raising $4.00M" },
      { year: 2019, kind: "office", yours: true, text: "Moved to your own office" },
    ]);
    expect(officePhrase("Own office", "its")).toBe("its own office");
    expect(officePhrase("Full floor", "your")).toBe("the full floor");
  });

  it("says a second failure was the same only when it was", () => {
    const outText = (rescued: "bankrupt" | "fired", out: "bankrupt" | "fired"): string =>
      marksOf([{ kind: "rescued", turn: 4, reason: rescued }, { kind: "out", turn: 12, reason: out }], CAREER)[1].text;
    expect(outText("bankrupt", "bankrupt")).toBe("Out: bankrupt a second time");
    expect(outText("fired", "fired")).toBe("Out: fired a second time");
    expect(outText("bankrupt", "fired")).toBe("Out: fired, after the rescue from bankruptcy");
    expect(outText("fired", "bankrupt")).toBe("Out: bankrupt, after the rescue when the board fired you");
  });

  it("is not there in a race", () => {
    expect(timelineView(newGame(), [], DESIGN)).toBeNull();
    expect(careerStatusView(newGame(), DESIGN)).toBeNull();
    expect(marksOf([{ kind: "launch", turn: 2 }], DESIGN)).toEqual([]);
  });

  it("tells a dated card from a random draw", () => {
    expect(datedYear({ cardId: "the-browser", targetId: null }, 6, CAREER)).toBe(1995);
    expect(datedYear({ cardId: "some-random-card", targetId: null }, 7, CAREER)).toBeNull();
    expect(datedYear(null, 6, CAREER)).toBeNull();
  });
});

describe("the year's status", () => {
  it("says the year, the office and what comes next", () => {
    const view = careerStatusView(newCareer(), CAREER_TEST)!;
    expect(view).toMatchObject({ heading: "1990 · year 1 of 49", eraName: "Flat", invented: false, listedYear: null, rescueYear: null, boardPaused: false });
    expect(view.office).toEqual({ name: "Garage", capacity: 4, headcount: 3 });
    expect(view.nextOffice).toEqual({ name: "Shared office", capacity: 9 });
    const campus = withCareerOf(withCompany(newCareer(), HUMAN, { headcount: 60 }), HUMAN, { office: 4 });
    expect(careerStatusView(campus, CAREER_TEST)!.nextOffice).toBeNull();
  });

  it("says when the rescue was used and that the board sits out the year after", () => {
    const rescued = atTurn(withCareerOf(newCareer(), HUMAN, { rescue: { turn: 4, reason: "fired" }, listed: { turn: 2, valuation: 1, amount: 1 } }), 5);
    expect(careerStatusView(rescued, CAREER_TEST)).toMatchObject({ heading: "1994 · year 5 of 49", rescueYear: 1993, listedYear: 1991, boardPaused: true });
    expect(careerStatusView(atTurn(rescued, 6), CAREER_TEST)!.boardPaused).toBe(false);
  });
});
