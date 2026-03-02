import type { GameState } from "../types/game";
import type { EngineContext } from "./context";

export const evaluateEndings = (state: GameState, ctx: EngineContext): { state: GameState; logs: string[] } => {
  if (state.gameOver) {
    return { state, logs: [] };
  }

  // Hard bankruptcy if you're deeply underwater.
  if (state.cash < -state.burn * 2) {
    return {
      state: {
        ...state,
        gameOver: { ending: "bankruptcy", week: state.week, headline: "Bankruptcy. The company is a cautionary tale." },
      },
      logs: ["Your account hits negative. Vendors stop answering.", "Ending unlocked: Bankruptcy."],
    };
  }

  // IPO: valuation $10B+, MRR $250K+, growth stage, profitable, strong unit economics.
  if (
    state.valuation >= 10_000_000_000 &&
    state.mrr >= 250_000 &&
    state.stage === "growth" &&
    ctx.profitable &&
    ctx.ltvCacRatio >= 3 &&
    ctx.teamSize >= 25
  ) {
    const founderOwnership = Math.round(state.capTable.founderPct * 100);
    return {
      state: {
        ...state,
        gameOver: {
          ending: "ipo",
          week: state.week,
          headline: `IPO. ${state.companyName} goes public at ~$${Math.round(state.valuation / 1_000_000_000)}B. Founder owns ${founderOwnership}%.`,
        },
      },
      logs: [
        "The bankers call. The S-1 is filed. [[beat]] The bell rings.",
        `${state.companyName} is now a public company.`,
        "Ending unlocked: IPO.",
      ],
    };
  }

  // Acquisition: decent valuation + profitable + stagnating growth. A soft exit.
  if (
    state.week >= 25 &&
    state.valuation >= 500_000_000 &&
    ctx.profitable &&
    ctx.mrrGrowthRate < 0.03 &&
    state.mrr >= 50_000
  ) {
    const premiumM = Math.round((state.valuation * 1.3) / 1_000_000);
    return {
      state: {
        ...state,
        gameOver: {
          ending: "acquisition",
          week: state.week,
          headline: `Acquired for ~$${premiumM}M. A respectable exit.`,
        },
      },
      logs: [
        "A strategic acquirer makes an offer you can't refuse. [[beat]] Or rather, your board can't.",
        `${state.companyName} is acquired at a 30% premium to current valuation.`,
        "Ending unlocked: Acquisition.",
      ],
    };
  }

  // AI Hype Exit: high valuation from hype but weak fundamentals.
  if (
    state.week >= 15 &&
    state.valuation >= 1_000_000_000 &&
    state.volatility >= 70 &&
    ctx.ltvCacRatio < 1.5 &&
    !ctx.profitable &&
    state.totalRaised >= 10_000_000
  ) {
    return {
      state: {
        ...state,
        gameOver: {
          ending: "ai-hype-exit",
          week: state.week,
          headline: "AI Hype Exit. You sold the dream before it became a nightmare.",
        },
      },
      logs: [
        "A BigCo wants to 'acqui-hire the team and the IP.' [[beat]] Translation: the product is worthless but the talent isn't.",
        "You take the deal. The alternative is running out of money.",
        "Ending unlocked: AI Hype Exit.",
      ],
    };
  }

  // Founder removal: cofounder trust collapses + board leverage.
  if (
    state.cofounder.trust <= 15 &&
    state.cofounder.ego >= 80 &&
    state.capTable.founderPct < 0.4 &&
    state.totalRaised >= 2_000_000
  ) {
    return {
      state: {
        ...state,
        gameOver: {
          ending: "founder-removal",
          week: state.week,
          headline: "Founder removed. The board voted. You lost.",
        },
      },
      logs: [
        `${state.cofounder.name} goes to the board. [[beat]] The vote is unanimous.`,
        "You're out. Your own company.",
        "Ending unlocked: Founder Removal.",
      ],
    };
  }

  // Soft "Zombie SaaS" ending if you stagnate forever.
  if (state.week >= 40 && ctx.mrrGrowthRate < 0.01 && state.mrr >= 8_000 && state.mrr <= 40_000) {
    return {
      state: {
        ...state,
        gameOver: { ending: "zombie-saas", week: state.week, headline: "Zombie SaaS. You built a job in a hoodie." },
      },
      logs: ["The product keeps running. The story stops moving.", "Ending unlocked: Zombie SaaS."],
    };
  }

  return { state, logs: [] };
};
