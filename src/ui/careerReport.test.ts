import { describe, expect, it } from "vitest";
import { CAREER_TEST, atTurn, newCareer, outSince, qualify, withCareerOf } from "../engine/careerKit";
import { BLITZ, BOOT, HUMAN, newGame, reportFor, resolve, withCompany } from "../engine/testKit";
import { DESIGN } from "../config.design";
import { milestonesOf } from "../state/careerRecord";
import type { GameState } from "../engine/types";
import { money, percent } from "./format";
import { careerReportView, rivalCareerRows } from "./careerReport";

const played = (opening: GameState, patches = {}) => {
  const result = resolve(opening, patches, 1, CAREER_TEST);
  const record = milestonesOf(opening, result.log, result.state);
  return { ...result, view: careerReportView(result.state, result.log, record, CAREER_TEST)! };
};

describe("the annual report", () => {
  it("is titled by the year and sums the year up", () => {
    const { view } = played(withCompany(newCareer(), HUMAN, { headcount: 5, headcountAtLastClose: 5 }));
    expect(view.title).toBe("Acme: 1990 annual report");
    expect(view.summary).toContain("Moved to the shared office");
    expect(view.office).toMatchObject({ from: "Garage", to: "Shared office" });
  });

  it("reports a listing with what it brought", () => {
    const { view, ...result } = played(qualify(newCareer(), HUMAN), { [HUMAN]: { goPublic: true } });
    const report = reportFor(result, HUMAN);
    const listing = report.career!.listing!;
    expect(view.listing).toMatchObject({ amount: listing.amount, valuation: listing.valuation, equityAfter: report.equity, hype: 20 });
    expect(view.listing!.text).toBe(`You went public: sold 20% for ${money(listing.amount)} at a ${money(listing.valuation)} valuation. You now own ${percent(report.equity)}.`);
  });

  it("reports a rescue, and does not call it the end", () => {
    const { view, ...result } = played(withCompany(atTurn(newCareer(), 4), HUMAN, { cash: 1_000 }));
    const report = reportFor(result, HUMAN);
    expect(view.rescue).toMatchObject({ reason: "bankrupt", equityBefore: 1, equityAfter: report.equity });
    expect(view.rescue!.text).toMatch(/^You ended the year below \$0\. Investors rescued the company: you went from 100% to 50%, they took the board, and cash was reset to \$[\d.,KM]+\. A second failure ends your career\.$/);
  });

  it("words a board that fires the founder by what follows", () => {
    // Investors control the board, users fall, and the vote is certain in DESIGN's numbers once fireChance is 1.
    const sure = { ...CAREER_TEST, board: { ...CAREER_TEST.board, fireChance: 1 } };
    const shaky = withCompany(newCareer(), HUMAN, { investorSeats: 3, users: 5_000, usersAtLastClose: 50_000, launched: true, quality: 40 });
    const first = resolve(shaky, {}, 1, sure);
    expect(careerReportView(first.state, first.log, [], sure)!.boardText).toBe("Your board voted to fire you, and this time the rescue kept you on.");
    const again = withCareerOf(shaky, HUMAN, { rescue: { turn: 1, reason: "bankrupt" } });
    const second = resolve(atTurn(again, 3), {}, 1, sure);
    expect(careerReportView(second.state, second.log, [], sure)!.boardText).toBe("Your board voted to fire you. You had used your one rescue: your career is over.");
    const paused = resolve(atTurn(withCareerOf(shaky, HUMAN, { rescue: { turn: 4, reason: "fired" } }), 5), {}, 1, sure);
    expect(careerReportView(paused.state, paused.log, [], sure)!.boardText).toBe("After the rescue your board did not vote this year.");
  });

  it("leads the short summary with the year's most important line", () => {
    const { view } = played(withCompany(atTurn(newCareer(), 4), HUMAN, { cash: 1_000 }));
    expect(view.headline).toBe(view.rescue!.text);
    const { view: moved } = played(withCompany(newCareer(), HUMAN, { headcount: 5, headcountAtLastClose: 5 }));
    expect(moved.headline).toBe("Moved to the shared office");
    const { view: listed } = played(qualify(newCareer(), HUMAN), { [HUMAN]: { goPublic: true } });
    expect(listed.headline).toBe(listed.listing!.text);
    expect(listed.publicSince[HUMAN]).toBe(1990);
    expect(listed.publicSince[BLITZ]).toBeNull();
  });

  it("names the newcomers and the rivals' career moves", () => {
    const { view, state } = played(outSince(atTurn(newCareer(), 9), BOOT, 7));
    expect(view.entrants).toEqual([{ name: state.companies[BOOT].name, pitch: state.companies[BOOT].pitch, year: 1999 }]);
    const { view: listed } = played(qualify(newCareer(), BLITZ), { [BLITZ]: { goPublic: true } });
    expect(listed.moves).toContain("Zipp went public.");
  });

  it("is not there in a race", () => {
    const result = resolve(newGame(), {}, 1, DESIGN);
    expect(careerReportView(result.state, result.log, [], DESIGN)).toBeNull();
    expect(rivalCareerRows(newGame(), DESIGN)).toEqual([]);
  });
});

describe("the rivals' careers", () => {
  it("says when each was founded, where it works, and when a seat is refilled", () => {
    const game = withCareerOf(withCareerOf(outSince(atTurn(newCareer(), 12), BOOT, 11), BLITZ, { office: 2, listed: { turn: 8, valuation: 1, amount: 1 } }), BLITZ, { rescue: { turn: 10, reason: "fired" } });
    const rows = rivalCareerRows(game, CAREER_TEST);
    expect(rows.find((row) => row.id === BLITZ)).toEqual({ id: BLITZ, foundedYear: 1990, newcomer: false, office: "Own office", listedYear: 1997, rescueYear: 1999, newcomerYear: null });
    expect(rows.find((row) => row.id === BOOT)?.newcomerYear).toBe(2002);
  });
});
