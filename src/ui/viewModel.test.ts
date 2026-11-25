import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { defaultPlan } from "../engine/plan";
import { resolveTurn } from "../engine/resolveTurn";
import { STREAM, firstFloat } from "../engine/rng";
import { BLITZ, BOOT, HUMAN, INCUMBENT, launchedCompany, newGame, onlyActive, plansOf, reportFor, resolve, seedWhere, withCompany, withState } from "../engine/testKit";
import type { Company, GameState, Plan } from "../engine/types";
import { endView, planningView, reportView as maybeReportView, resourceView, rivalsView, type ReportView } from "./viewModel";

/** The player's report for a quarter they took part in. */
const reportView = (...args: Parameters<typeof maybeReportView>): ReportView => {
  const view = maybeReportView(...args);
  if (view === null) throw new Error("the player has no report for that quarter");
  return view;
};

const NEVER = { ...DESIGN, events: { ...DESIGN.events, chance: 0 } };
const draftOf = (game: GameState, patch: Partial<Plan> = {}): Plan => ({ ...defaultPlan(game.companies[HUMAN]), ...patch });
const going = (patch: Partial<Company> = {}): GameState => launchedCompany(newGame(), HUMAN, { users: 20_000, cash: 900_000, headcount: 6, headcountAtLastClose: 6, hype: 30, ...patch });

describe("resource bar", () => {
  it("shows the player's cash, runway, talent, users, hype, quality, valuation and equity", () => {
    const view = resourceView(going({ lastCosts: 300_000, lastRevenue: 60_000 }), DESIGN);
    expect(view).toMatchObject({ companyName: "Acme", turn: 1, maxTurns: 20, cash: 900_000, headcount: 6, users: 20_000, hype: 30, quality: 50, equity: 1, launched: true });
    expect(view.runway).toBeCloseTo(900_000 / 240_000, 9);
    expect(view.effectiveWork).toBeCloseTo(6 ** 0.9, 5);
    expect(view.valuation).toBe(20_000 * 150 * 1.3);
  });

  it("says who controls the board", () => {
    expect(resourceView(going(), DESIGN).board).toEqual({ founderSeats: 2, investorSeats: 0, control: "founders" });
    expect(resourceView(going({ investorSeats: 2 }), DESIGN).board.control).toBe("tied");
    expect(resourceView(going({ investorSeats: 3 }), DESIGN).board.control).toBe("investors");
  });

  it("shows the change in users over the last quarter, once there has been one", () => {
    expect(resourceView(newGame(), DESIGN).usersChange).toBeNull();
    const after = resolve(newGame(), {}, 1, NEVER);
    const view = resourceView(after.state, DESIGN);
    expect(view.usersChange).toBe(reportFor(after, HUMAN).users.end);
    expect(view.turn).toBe(2);
  });

  it("measures the change the way the report and the board do: close to close, an event's losses included", () => {
    // Closed on 10,000; a breach took 1,000, 500 left and 3,500 came: 12,000 at the next close.
    const lastQuarter = { qualityAtOpen: 40, hypeAtOpen: 20, usersAtOpen: 10_000, usersLostToEvent: 1_000, usersChurned: 500, usersWon: 3_500, joined: 0, left: 0 };
    expect(resourceView(going({ users: 12_000, lastQuarter }), DESIGN).usersChange).toBe(2_000);
    // A breach revealed for the coming quarter has already taken 1,200: that belongs to the next report.
    expect(resourceView(going({ users: 10_800, usersAtLastClose: 12_000, lastQuarter }), DESIGN).usersChange).toBe(2_000);
    // A quarter in which users fell shows as a fall, whatever came in.
    expect(resourceView(going({ users: 9_800, lastQuarter: { ...lastQuarter, usersWon: 1_300 } }), DESIGN).usersChange).toBe(-200);
  });

  it("applies the funding climate to the valuation it shows", () => {
    const winter = withState(going(), { climate: { multiplier: 0.6, turnsLeft: 2 } });
    expect(resourceView(winter, DESIGN).valuation).toBe(20_000 * 150 * 1.3 * 0.6);
    expect(resourceView(winter, DESIGN).climate).toEqual({ multiplier: 0.6, turnsLeft: 2 });
    expect(resourceView(going(), DESIGN).climate).toBeNull();
  });
});

describe("planning panel", () => {
  it("counts people available and unassigned, and what the split would produce", () => {
    const game = going();
    const view = planningView(game, draftOf(game, { allocation: { product: 2, growth: 2, recruiting: 1 } }), DESIGN);
    expect(view.available).toBe(6);
    expect(view.unassigned).toBe(1);
    expect(view.hiring.capacity).toBeGreaterThanOrEqual(1);
    expect(view.warnings.some((w) => w.level === "note" && /1 person unassigned/.test(w.text))).toBe(true);
  });

  it("says what the people at work get done between them: less when one of them is off raising money", () => {
    const game = going();
    const everyone = planningView(game, draftOf(game), DESIGN);
    expect(everyone.available).toBe(6);
    expect(everyone.workDone).toBeCloseTo(6 ** 0.9, 5);
    const raising = planningView(game, draftOf(game, { raisePercent: 20, allocation: { product: 5, growth: 0, recruiting: 0 } }), DESIGN);
    expect(raising.available).toBe(5);
    expect(raising.workDone).toBeCloseTo((6 ** 0.9 * 5) / 6, 5);
  });

  it("passes on what this quarter's event does to marketing, whatever the multiplier", () => {
    const game = going();
    const spend = { marketing: 100_000 };
    // 0.5 × √(100K ÷ 25K) = +100% pull, before the event.
    expect(planningView(game, draftOf(game, spend), DESIGN).marketing).toMatchObject({ effect: 1, pull: 1 });
    const spike = withState(game, { modifiers: { ...game.modifiers, marketing: 0.5 } });
    expect(planningView(spike, draftOf(spike, spend), DESIGN).marketing).toMatchObject({ effect: 0.5, pull: 0.5 });
    const cheapAds = withState(game, { modifiers: { ...game.modifiers, marketing: 1.5 } });
    expect(planningView(cheapAds, draftOf(cheapAds, spend), DESIGN).marketing).toMatchObject({ effect: 1.5, pull: 1.5 });
    expect(planningView(game, draftOf(game), DESIGN).marketing.pull).toBe(0);
  });

  it("offers the three price tiers with their price per user", () => {
    const game = going();
    const view = planningView(game, draftOf(game, { price: "premium" }), DESIGN);
    expect(view.prices.map((p) => [p.tier, p.price, p.selected])).toEqual([
      ["budget", 2, false],
      ["standard", 3, false],
      ["premium", 5, true],
    ]);
  });

  describe("raise", () => {
    it("lists 10, 20 and 30% with the exact amount, the equity left and whether it hands over the board", () => {
      const game = going({ investorSeats: 2 });
      const view = planningView(game, draftOf(game), DESIGN);
      expect(view.raise.blocked).toBeNull();
      expect(view.raise.valuation).toBe(3_900_000);
      expect(view.raise.options).toEqual([
        { percent: 10, amount: 390_000, equityAfter: 0.9, investorSeatsAfter: 3, handsOverBoard: true, selected: false },
        { percent: 20, amount: 780_000, equityAfter: 0.8, investorSeatsAfter: 3, handsOverBoard: true, selected: false },
        { percent: 30, amount: 1_170_000, equityAfter: 0.7, investorSeatsAfter: 3, handsOverBoard: true, selected: false },
      ]);
      expect(planningView(going(), draftOf(going()), DESIGN).raise.options[0].handsOverBoard).toBe(false);
    });

    it("does not call it handing over the board when investors already have it", () => {
      const game = going({ investorSeats: 3 });
      const view = planningView(game, draftOf(game, { raisePercent: 10, allocation: { product: 5, growth: 0, recruiting: 0 } }), DESIGN);
      expect(view.raise.options.map((option) => option.handsOverBoard)).toEqual([false, false, false]);
      expect(view.warnings.some((w) => /majority/.test(w.text))).toBe(false);
    });

    it("says why a raise is not possible", () => {
      const early = newGame();
      const blocked = planningView(early, draftOf(early), DESIGN).raise;
      expect(blocked.blocked).toBe("users");
      expect(blocked.blockedText).toMatch(/1,000 users/);

      const cooling = withState(going({ lastRaise: { turn: 4, percent: 20, amount: 500_000 } }), { turn: 6 });
      const view = planningView(cooling, draftOf(cooling), DESIGN).raise;
      expect(view.blocked).toBe("cooldown");
      expect(view.blockedText).toMatch(/Q7/);
    });

    it("does not promise a raise in a quarter after the game's last", () => {
      const late = withState(going({ lastRaise: { turn: 19, percent: 20, amount: 500_000 } }), { turn: 20 });
      const text = planningView(late, draftOf(late), DESIGN).raise.blockedText;
      expect(text).toMatch(/Q19/);
      expect(text).not.toMatch(/Q2[1-9]/);
      expect(text).toMatch(/no time/i);
      // Raised in Q17: Q20 is still open for one.
      const justInTime = withState(going({ lastRaise: { turn: 17, percent: 20, amount: 500_000 } }), { turn: 18 });
      expect(planningView(justInTime, draftOf(justInTime), DESIGN).raise.blockedText).toMatch(/Q20/);
    });

    it("warns when the chosen raise gives investors the board", () => {
      const game = going({ investorSeats: 2 });
      const view = planningView(game, draftOf(game, { raisePercent: 10, allocation: { product: 5, growth: 0, recruiting: 0 } }), DESIGN);
      expect(view.warnings.some((w) => w.level === "caution" && /majority/.test(w.text))).toBe(true);
    });
  });

  describe("poach", () => {
    it("lists every rival still in the game with the odds", () => {
      const game = onlyActive(going(), [HUMAN, BLITZ, INCUMBENT]);
      const view = planningView(game, draftOf(game), DESIGN);
      expect(view.poach.cost).toBe(50_000);
      expect(view.poach.options.map((o) => o.id)).toEqual([BLITZ, INCUMBENT]);
      // Hype 30 against 10 and 20.
      expect(view.poach.options[0].chance).toBeCloseTo(0.6, 9);
      expect(view.poach.options[1].chance).toBeCloseTo(0.55, 9);
      expect(view.poach.options.every((o) => o.allowed)).toBe(true);
    });

    it("marks a rival that is too small to poach from", () => {
      const game = withCompany(going(), BOOT, { headcount: 1 });
      const option = planningView(game, draftOf(game), DESIGN).poach.options.find((o) => o.id === BOOT)!;
      expect(option.allowed).toBe(false);
      expect(option.reason).toMatch(/too small/i);
    });
  });

  describe("projected cash", () => {
    it("shows a guaranteed floor and an expected figure", () => {
      const game = going();
      const view = planningView(game, draftOf(game), DESIGN);
      expect(view.projection.cashFloor).toBeLessThanOrEqual(view.projection.cash);
      expect(view.projection.cashFloor).toBe(900_000 - view.projection.costs.total + (20_000 - view.projection.usersChurned) * 3);
    });

    it("warns in red when the plan is expected to end below $0", () => {
      const game = going({ cash: 100_000 });
      const view = planningView(game, draftOf(game, { marketing: 500_000 }), DESIGN);
      expect(view.projection.cash).toBeLessThan(0);
      expect(view.warnings[0]).toMatchObject({ level: "danger" });
      expect(view.warnings[0].text).toMatch(/bankrupt/);
    });

    it("warns in amber when only winning users keeps it above $0", () => {
      const game = going({ cash: 170_000, users: 20_000 });
      // Costs: 6 × $40K = $240K. Cash plus the $55K from users it keeps is short of that; new users close the gap.
      const view = planningView(game, draftOf(game), DESIGN);
      expect(view.projection.cashFloor).toBeLessThan(0);
      expect(view.projection.cash).toBeGreaterThanOrEqual(0);
      expect(view.warnings.some((w) => w.level === "caution" && /new users/.test(w.text))).toBe(true);
      expect(view.warnings.some((w) => w.level === "danger")).toBe(false);
    });

    it("says nothing about cash when the floor is safe", () => {
      const view = planningView(going(), draftOf(going()), DESIGN);
      expect(view.warnings.some((w) => /bankrupt|new users/.test(w.text))).toBe(false);
    });

    it("warns when investors hold the board and the quarter looks bad", () => {
      const game = going({ investorSeats: 3, cash: 300_000 });
      const view = planningView(game, draftOf(game), DESIGN);
      expect(view.projection.boardRisk).toBe(0.3);
      expect(view.warnings.some((w) => w.level === "caution" && /board/i.test(w.text) && /30%/.test(w.text))).toBe(true);
      const safe = going({ investorSeats: 3, cash: 9_000_000 });
      expect(planningView(safe, draftOf(safe), DESIGN).warnings.some((w) => /board/i.test(w.text))).toBe(false);
    });

    it("calls it a close call when fewer new users than expected would leave runway too short for the board", () => {
      const probe = planningView(going({ investorSeats: 3, cash: 9_000_000 }), draftOf(going()), DESIGN).projection;
      const burn = probe.costs.total - probe.revenue;
      expect(burn).toBeGreaterThan(0);
      // Cash to end the quarter a shade over the board's two turns of runway, if all goes as expected.
      const game = going({ investorSeats: 3, cash: burn + 2 * burn + 1_000 });
      const view = planningView(game, draftOf(game), DESIGN);
      expect(view.projection.boardRisk).toBe(0);
      expect(view.projection.runway).toBeGreaterThanOrEqual(2);
      const warning = view.warnings.find((w) => /board/i.test(w.text));
      expect(warning).toMatchObject({ level: "caution" });
      expect(warning!.text).toMatch(/close call/i);
      expect(warning!.text).toMatch(/runway/);
      expect(warning!.text).toMatch(/30%/);
      // With founders in control there is nobody to fire them, close call or not.
      const founderLed = going({ investorSeats: 2, cash: burn + 2 * burn + 1_000 });
      expect(planningView(founderLed, draftOf(founderLed), DESIGN).warnings.some((w) => /board/i.test(w.text))).toBe(false);
    });

    it("calls it a close call when fewer new users than expected would mean users fell", () => {
      const probe = planningView(going({ investorSeats: 3, cash: 9_000_000 }), draftOf(going()), DESIGN).projection;
      // An event took users as the quarter opened: on the expected figure the company just gets back to its last close.
      const game = going({ investorSeats: 3, cash: 9_000_000, usersAtLastClose: probe.users - 10 });
      const view = planningView(game, draftOf(game), DESIGN);
      expect(view.projection.boardRisk).toBe(0);
      const warning = view.warnings.find((w) => /board/i.test(w.text));
      expect(warning).toMatchObject({ level: "caution" });
      expect(warning!.text).toMatch(/close call/i);
      expect(warning!.text).toMatch(/users would fall/);
    });
  });

  it("tells a company with no product what it needs to launch", () => {
    const game = newGame();
    const waiting = planningView(game, draftOf(game, { allocation: { product: 1, growth: 2, recruiting: 0 } }), DESIGN);
    expect(waiting.warnings.some((w) => /launch/i.test(w.text) && /10/.test(w.text))).toBe(true);
    const launching = planningView(game, draftOf(game), DESIGN);
    expect(launching.warnings.some((w) => /launches this quarter/i.test(w.text))).toBe(true);
  });

  it("flags a quarter that could take the company public, or the profit it still lacks", () => {
    const ready = going({ users: 300_000, usersAtLastClose: 300_000, quality: 90, cash: 2_000_000 });
    expect(planningView(ready, draftOf(ready), DESIGN).warnings.some((w) => /public/i.test(w.text) && w.level === "note")).toBe(true);
    const bloated = going({ users: 300_000, usersAtLastClose: 300_000, quality: 90, cash: 9_000_000, headcount: 30, headcountAtLastClose: 30 });
    expect(planningView(bloated, draftOf(bloated), DESIGN).warnings.some((w) => /profit/i.test(w.text) && w.level === "caution")).toBe(true);
  });
});

describe("going public", () => {
  const at = (users: number): GameState => going({ users, usersAtLastClose: users, quality: 90, cash: 2_000_000 });
  const publicNote = (game: GameState) => planningView(game, draftOf(game), DESIGN).warnings.find((w) => /public/i.test(w.text));

  it("is on course when the company clears the bar even with fewer new users than expected", () => {
    expect(publicNote(at(300_000))).toMatchObject({ level: "note" });
    expect(publicNote(at(300_000))!.text).toMatch(/on course/i);
  });

  it("could happen, not will, when it rests on the users the company expects to win", () => {
    let users = 200_000;
    while (planningView(at(users), draftOf(at(users)), DESIGN).projection.users < DESIGN.ipo.users) users += 500;
    const { projection } = planningView(at(users), draftOf(at(users)), DESIGN);
    // Just there on the expected figure; a quarter fewer new users and it falls short.
    expect(projection.users - Math.round(projection.usersWon * DESIGN.projection.cautiousShortfall)).toBeLessThan(DESIGN.ipo.users);
    const note = publicNote(at(users))!;
    expect(note.level).toBe("note");
    expect(note.text).toMatch(/could go public/i);
    expect(note.text).not.toMatch(/on course/i);
  });

  it("says nothing while the bar is out of reach", () => {
    expect(publicNote(at(100_000))).toBeUndefined();
  });
});

describe("rivals panel", () => {
  it("lists the three rivals with their public stats and nothing private", () => {
    const after = resolve(newGame(), { [INCUMBENT]: { raisePercent: 20 } }, 1, NEVER);
    const rows = rivalsView(after.state, DESIGN);
    expect(rows.map((r) => r.id)).toEqual([BLITZ, BOOT, INCUMBENT]);
    const incumbent = rows[2];
    const company = after.state.companies[INCUMBENT];
    expect(incumbent).toMatchObject({ name: "Nimbus", users: company.users, headcount: company.headcount, quality: company.quality, hype: company.hype, price: "standard", launched: true, out: null });
    expect(incumbent.usersChange).toBe(company.users - 10_000);
    expect(incumbent.lastRaise).toEqual({ turn: 1, percent: 20, amount: 360_000 });
    expect(incumbent.investorControlled).toBe(false);
    for (const row of rows) {
      expect("cash" in row).toBe(false);
      expect("controller" in row).toBe(false);
    }
  });

  it("keeps a rival that is out on the list, marked with how and when it went", () => {
    const state = withCompany(newGame(), BLITZ, { cash: 0 });
    const after = resolve(state, { [BLITZ]: { allocation: { product: 0, growth: 3, recruiting: 0 } } }, 1, NEVER);
    const row = rivalsView(after.state, DESIGN).find((r) => r.id === BLITZ)!;
    expect(row.out).toMatchObject({ reason: "bankrupt", turn: 1 });
  });
});

describe("quarterly report", () => {
  it("gives the player's books, users and people for the quarter", () => {
    const game = going();
    const result = resolveTurn(game, plansOf(game, { [HUMAN]: { allocation: { product: 3, growth: 2, recruiting: 1 }, marketing: 50_000 } }), 1, NEVER);
    const report = reportFor(result, HUMAN);
    const view = reportView(result.state, result.log, DESIGN);
    expect(view.turn).toBe(1);
    expect(view.books).toMatchObject({ revenue: report.revenue, costs: report.costs, cashStart: 900_000, cashEnd: report.cash.end, profitable: report.profitable });
    expect(view.users).toMatchObject({ open: 20_000, churned: report.users.churned, won: report.users.won, end: report.users.end });
    expect(view.people).toMatchObject({ start: 6, hired: report.hiring.hired, end: report.headcount.end });
    expect(view.out).toBeNull();
  });

  it("starts the team line at last quarter's close, so a loss to an event shows and the line adds up", () => {
    // Six at the close; burnout took one as the quarter opened, so five were at work.
    const state = going({ headcount: 5, headcountAtLastClose: 6 });
    const result = resolve(state, { [HUMAN]: { allocation: { product: 3, growth: 1, recruiting: 1 } } }, 1, NEVER);
    const team = reportView(result.state, result.log, DESIGN).people;
    expect(team).toMatchObject({ start: 6, lostToEvent: 1 });
    expect(team.hired).toBeGreaterThan(0);
    expect(team.start - team.lostToEvent - team.laidOff - team.poachedOut + team.hired + team.poachedIn).toBe(team.end);
  });

  it("reports rival moves in plain words: launches, raises, hires, layoffs and poaching", () => {
    const state = withCompany(newGame(), BOOT, { headcount: 5, headcountAtLastClose: 5 });
    const chance = 0.55;
    const seed = seedWhere((s) => firstFloat(s, 1, STREAM.poach, INCUMBENT) < chance);
    const result = resolveTurn(state, plansOf(state, { [INCUMBENT]: { raisePercent: 20, poachTarget: HUMAN }, [BOOT]: { layoffs: 2 } }), seed, NEVER);
    const moves = reportView(result.state, result.log, DESIGN).moves.join("\n");
    expect(moves).toMatch(/Zipp launched its product/);
    expect(moves).toMatch(/Nimbus raised \$360K for 20%/);
    expect(moves).toMatch(/Nimbus poached one of your people/);
    expect(moves).toMatch(/Oakline laid off 2/);
    expect(moves).toMatch(/Nimbus hired 1/);
    expect(moves).not.toMatch(/Acme/);
  });

  it("says when a poach on someone else fails, and when a rival goes out", () => {
    const state = withCompany(newGame(), BOOT, { cash: 0 });
    const seed = seedWhere((s) => firstFloat(s, 1, STREAM.poach, INCUMBENT) >= 0.55);
    const result = resolveTurn(state, plansOf(state, { [INCUMBENT]: { poachTarget: BLITZ }, [BOOT]: { allocation: { product: 0, growth: 3, recruiting: 0 } } }), seed, NEVER);
    const view = reportView(result.state, result.log, DESIGN);
    expect(view.moves.join("\n")).toMatch(/Nimbus tried to poach from Zipp and failed/);
    expect(view.moves.join("\n")).toMatch(/Oakline went bankrupt/);
    expect(view.released).toEqual({ users: 0, people: 3 });
  });

  it("counts only what was released this quarter, not by companies that went out earlier", () => {
    let state = withState(newGame(), { turn: 5 });
    state = withCompany(state, BOOT, { users: 0, headcount: 0, out: { turn: 3, reason: "bankrupt", users: 5_000, headcount: 4 } });
    state = withCompany(state, BLITZ, { cash: 0 });
    const result = resolveTurn(state, plansOf(state, { [BLITZ]: { allocation: { product: 0, growth: 3, recruiting: 0 } } }), 1, NEVER);
    expect(result.state.companies[BLITZ].out?.turn).toBe(5);
    expect(reportView(result.state, result.log, DESIGN).released).toEqual({ users: 0, people: 3 });
  });

  it("names the event in force and the one coming next", () => {
    const always = { ...DESIGN, events: { ...DESIGN.events, chance: 1, deck: DESIGN.events.deck.filter((card) => card.id === "viral-moment") } };
    const first = resolveTurn(withState(newGame(), { turn: 2 }), plansOf(newGame()), 1, always);
    const view = reportView(first.state, first.log, always);
    expect(view.event).toBeNull();
    expect(view.nextEvent?.name).toBe("Viral moment");
    expect(view.nextEvent?.target).toBe(first.state.companies[first.state.event!.targetId!].name);
    const second = resolveTurn(first.state, plansOf(first.state), 1, NEVER);
    expect(reportView(second.state, second.log, NEVER).event?.name).toBe("Viral moment");
  });

  it("carries the engine's notes about a plan it had to fix", () => {
    const game = newGame();
    const result = resolveTurn(game, plansOf(game, { [HUMAN]: { raisePercent: 30 } }), 1, NEVER);
    expect(reportView(result.state, result.log, DESIGN).notes.join(" ")).toMatch(/Raise dropped/);
  });
});

describe("end screen", () => {
  const giant = (id: number, state = newGame()): GameState => launchedCompany(state, id, { users: 300_000, usersAtLastClose: 300_000, quality: 90, cash: 2_000_000 });

  it("is not shown while the game goes on", () => {
    expect(endView(newGame(), DESIGN)).toBeNull();
  });

  it("IPO: a win when it is the player's, a loss when it is a rival's", () => {
    const won = endView(resolve(giant(HUMAN), {}, 1, NEVER).state, DESIGN)!;
    expect(won).toMatchObject({ kind: "ipo-win", won: true, sound: "win", turn: 1 });
    const lost = endView(resolve(giant(BLITZ), {}, 1, NEVER).state, DESIGN)!;
    expect(lost).toMatchObject({ kind: "ipo-loss", won: false, sound: "loss" });
    expect(lost.title).toMatch(/Zipp/);
  });

  it("IPO: the company that went public heads the standings, however small its founder's stake", () => {
    // Zipp lists having sold almost everything: by stake it would come last of the four.
    let state = withCompany(giant(BLITZ), BLITZ, { founderEquity: 0.001 });
    state = launchedCompany(state, HUMAN, { users: 60_000, cash: 3_000_000 });
    state = launchedCompany(state, BOOT, { users: 40_000, cash: 3_000_000 });
    state = launchedCompany(state, INCUMBENT, { users: 80_000, cash: 3_000_000 });
    const view = endView(resolve(state, {}, 1, NEVER).state, DESIGN)!;
    expect(view.kind).toBe("ipo-loss");
    // The rest by stake: Acme owns all of 60K users, Nimbus 60% of 80K, Oakline all of 40K.
    expect(view.standings.map((s) => s.name)).toEqual(["Zipp", "Acme", "Nimbus", "Oakline"]);
    expect(view.standings[0]).toMatchObject({ winner: true });
    const others = view.standings.slice(1).map((s) => s.stake);
    expect(others).toEqual([...others].sort((a, b) => b - a));
    expect(view.standings[0].stake).toBeLessThan(Math.min(...others));
  });

  it("IPO: the player's own listing puts them first, even below a rival on stake", () => {
    let state = withCompany(giant(HUMAN), HUMAN, { founderEquity: 0.001 });
    state = launchedCompany(state, INCUMBENT, { users: 80_000, cash: 3_000_000 });
    const view = endView(resolve(state, {}, 1, NEVER).state, DESIGN)!;
    expect(view.kind).toBe("ipo-win");
    expect(view.standings[0]).toMatchObject({ you: true, winner: true });
    expect(view.standings[0].stake).toBeLessThan(view.standings[1].stake);
  });

  it("bankrupt and fired are the player's own endings, whatever the rivals are doing", () => {
    const broke = endView(resolve(withCompany(newGame(), HUMAN, { cash: 0 }), { [HUMAN]: { allocation: { product: 0, growth: 3, recruiting: 0 } } }, 1, NEVER).state, DESIGN)!;
    expect(broke).toMatchObject({ kind: "bankrupt", won: false, sound: "bankrupt" });
    const shrinking = launchedCompany(newGame(), HUMAN, { quality: 0, users: 50_000, cash: 5_000_000, investorSeats: 3 });
    const seed = seedWhere((s) => firstFloat(s, 1, STREAM.board, HUMAN) < 0.3);
    const fired = endView(resolve(shrinking, { [HUMAN]: { allocation: { product: 0, growth: 3, recruiting: 0 } } }, seed, NEVER).state, DESIGN)!;
    expect(fired).toMatchObject({ kind: "fired", won: false, sound: "fired" });
  });

  it("going out is the player's ending even when that leaves a rival as the last one standing", () => {
    const state = withCompany(onlyActive(newGame(), [HUMAN, BLITZ]), HUMAN, { cash: 0 });
    const after = resolve(state, { [HUMAN]: { allocation: { product: 0, growth: 3, recruiting: 0 } } }, 1, NEVER).state;
    expect(after.outcome).toMatchObject({ kind: "lastStanding", winnerId: BLITZ });
    expect(endView(after, DESIGN)).toMatchObject({ kind: "bankrupt", won: false, sound: "bankrupt" });
  });

  it("turn 20: ranks everyone by founder stake and reveals what each rival was", () => {
    let state = withState(newGame(), { turn: 20 });
    state = launchedCompany(state, HUMAN, { users: 90_000, cash: 3_000_000 });
    state = launchedCompany(state, BLITZ, { users: 200_000, founderEquity: 0.343, cash: 3_000_000 });
    state = launchedCompany(state, BOOT, { users: 60_000, cash: 3_000_000 });
    state = launchedCompany(state, INCUMBENT, { users: 120_000, founderEquity: 0.42, cash: 3_000_000, investorSeats: 2 });
    const view = endView(resolve(state, {}, 1, NEVER).state, DESIGN)!;
    expect(view).toMatchObject({ kind: "stake-win", won: true, sound: "win", turn: 20 });
    expect(view.standings.map((s) => s.type)).toContain("Blitzscaler");
    expect(view.standings[0]).toMatchObject({ you: true, winner: true, type: "You" });
    const stakes = view.standings.map((s) => s.stake);
    expect(stakes).toEqual([...stakes].sort((a, b) => b - a));

    const behind = endView(resolve(withCompany(state, HUMAN, { founderEquity: 0.1 }), {}, 1, NEVER).state, DESIGN)!;
    expect(behind).toMatchObject({ kind: "stake-loss", won: false, sound: "loss" });
  });

  it("last one standing is a win", () => {
    const state = withCompany(onlyActive(newGame(), [HUMAN, BLITZ]), BLITZ, { cash: 0 });
    const view = endView(resolve(state, { [BLITZ]: { allocation: { product: 0, growth: 3, recruiting: 0 } } }, 1, NEVER).state, DESIGN)!;
    expect(view).toMatchObject({ kind: "last-standing", won: true, sound: "win" });
  });

  it("lists companies that went out below the survivors", () => {
    const state = withCompany(giant(HUMAN), BOOT, { cash: -9_000_000 });
    const first = resolve(withCompany(state, HUMAN, { users: 1_000, usersAtLastClose: 1_000 }), {}, 1, NEVER);
    expect(first.state.companies[BOOT].out).not.toBeNull();
    const second = resolve(withCompany(first.state, HUMAN, { users: 400_000, usersAtLastClose: 400_000 }), {}, 1, NEVER);
    const view = endView(second.state, DESIGN)!;
    expect(view.kind).toBe("ipo-win");
    expect(view.standings[view.standings.length - 1]).toMatchObject({ name: "Oakline", out: { reason: "bankrupt" } });
  });
});
