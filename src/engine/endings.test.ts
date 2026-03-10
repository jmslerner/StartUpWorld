import { describe, it, expect } from "vitest";
import { evaluateEndings } from "./endings";
import { makeState, makeCtx } from "./testHelpers";

describe("evaluateEndings", () => {
  it("returns no-op when already game over", () => {
    const state = makeState({ gameOver: { ending: "bankruptcy", week: 5, headline: "Done" } });
    const result = evaluateEndings(state, makeCtx());
    expect(result.logs).toHaveLength(0);
    expect(result.offer).toBeUndefined();
  });

  it("triggers bankruptcy when deeply negative cash", () => {
    const state = makeState({ cash: -20_000, burn: 5_000 });
    const result = evaluateEndings(state, makeCtx());
    expect(result.state.gameOver?.ending).toBe("bankruptcy");
  });

  it("does not trigger bankruptcy with positive cash", () => {
    const state = makeState({ cash: 100_000, burn: 5_000 });
    const result = evaluateEndings(state, makeCtx());
    expect(result.state.gameOver).toBeNull();
  });

  it("acquisition conditions return offer instead of game-over", () => {
    const state = makeState({
      week: 30,
      valuation: 600_000_000,
      mrr: 60_000,
    });
    const ctx = makeCtx({ profitable: true, mrrGrowthRate: 0.01 });
    const result = evaluateEndings(state, ctx);
    expect(result.state.gameOver).toBeNull();
    expect(result.offer).toBe("acquisition-offer");
  });

  it("acquisition offer respects cooldown", () => {
    const state = makeState({
      week: 30,
      valuation: 600_000_000,
      mrr: 60_000,
      eventHistory: [{ id: "acquisition-offer", week: 25 }], // 5 weeks ago, within 8-week cooldown
    });
    const ctx = makeCtx({ profitable: true, mrrGrowthRate: 0.01 });
    const result = evaluateEndings(state, ctx);
    expect(result.offer).toBeUndefined();
  });

  it("AI hype exit conditions return offer", () => {
    const state = makeState({
      week: 20,
      valuation: 1_500_000_000,
      volatility: 80,
      totalRaised: 15_000_000,
    });
    const ctx = makeCtx({ profitable: false, ltvCacRatio: 1.0 });
    const result = evaluateEndings(state, ctx);
    expect(result.offer).toBe("hype-exit-offer");
  });

  it("hostile board triggers founder-removal (which preempts forced-acquisition)", () => {
    // Note: isBoardHostile check fires before forced-acquisition in evaluation order.
    // A board with 60%+ members at confidence < 35 also has majority < 40 (hostile),
    // so founder-removal always fires first.
    const state = makeState({
      valuation: 100_000_000,
      capTable: { founderPct: 0.9, investorPct: 0.1 },
      board: {
        members: [
          { id: "1", name: "Founder", role: "founder", personality: "operator", confidence: 90 },
          { id: "2", name: "Inv A", role: "investor", personality: "activist", confidence: 20 },
          { id: "3", name: "Inv B", role: "investor", personality: "old-guard", confidence: 15 },
          { id: "4", name: "Inv C", role: "investor", personality: "dealmaker", confidence: 10 },
        ],
        lastMeetingWeek: 0,
      },
    });
    const result = evaluateEndings(state, makeCtx());
    expect(result.state.gameOver?.ending).toBe("founder-removal");
  });

  it("zombie SaaS triggers at week 40+ with stagnant low MRR", () => {
    const state = makeState({ week: 45, mrr: 15_000 });
    const ctx = makeCtx({ mrrGrowthRate: 0.005 });
    const result = evaluateEndings(state, ctx);
    expect(result.state.gameOver?.ending).toBe("zombie-saas");
  });
});
