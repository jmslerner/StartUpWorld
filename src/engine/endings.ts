import type { GameState } from "../types/game";
import type { EngineContext } from "./context";
import { isBoardHostile, boardVote } from "./board";

export interface EndingsResult {
  state: GameState;
  logs: string[];
  /** If set, an acquisition offer event should be presented instead of instant game-over. */
  offer?: string;
}

const OFFER_COOLDOWN_WEEKS = 8;

const isOfferOnCooldown = (state: GameState, eventId: string): boolean => {
  const last = state.eventHistory.find(h => h.id === eventId);
  return last ? state.week - last.week <= OFFER_COOLDOWN_WEEKS : false;
};

export const evaluateEndings = (state: GameState, ctx: EngineContext): EndingsResult => {
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

  // Acquisition: decent valuation + profitable + stagnating growth → offer (player chooses).
  if (
    state.week >= 25 &&
    state.valuation >= 500_000_000 &&
    ctx.profitable &&
    ctx.mrrGrowthRate < 0.03 &&
    state.mrr >= 50_000 &&
    !isOfferOnCooldown(state, "acquisition-offer")
  ) {
    return { state, logs: [], offer: "acquisition-offer" };
  }

  // AI Hype Exit: high valuation from hype but weak fundamentals → offer (player chooses).
  if (
    state.week >= 15 &&
    state.valuation >= 1_000_000_000 &&
    state.volatility >= 70 &&
    ctx.ltvCacRatio < 1.5 &&
    !ctx.profitable &&
    state.totalRaised >= 10_000_000 &&
    !isOfferOnCooldown(state, "hype-exit-offer")
  ) {
    return { state, logs: [], offer: "hype-exit-offer" };
  }

  // Board-driven founder removal: majority of board has lost confidence.
  if (state.board.members.length >= 3 && isBoardHostile(state)) {
    const vote = boardVote(state);
    const voteLog = vote.members.map(m => `${m.name}: ${m.vote}`).join(", ");
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
        "An emergency board meeting is called. [[beat]] You weren't the one who called it.",
        `The vote: ${voteLog}.`,
        `${vote.against} to ${vote.total - vote.against}. You're out.`,
        "Ending unlocked: Founder Removal.",
      ],
    };
  }

  // Forced acquisition: deeply hostile board forces a fire sale.
  // If founder holds majority equity (>50%), they can veto → present as offer.
  // If founder is minority, the board forces the sale (no choice).
  if (
    state.board.members.length >= 3 &&
    state.valuation >= 50_000_000 &&
    state.board.members.filter(m => m.confidence < 35).length >= Math.ceil(state.board.members.length * 0.6)
  ) {
    if (state.capTable.founderPct > 0.5 && !isOfferOnCooldown(state, "forced-sale-offer")) {
      return { state, logs: [], offer: "forced-sale-offer" };
    }

    // Founder is minority — board forces the sale.
    const salePrice = Math.round(state.valuation * 0.7);
    const salePriceM = Math.round(salePrice / 1_000_000);
    return {
      state: {
        ...state,
        gameOver: {
          ending: "forced-acquisition",
          week: state.week,
          headline: `Forced sale at $${salePriceM}M. The board decided for you.`,
        },
      },
      logs: [
        "The board convenes. The mood is grim. [[beat]] 'We've found a buyer.'",
        `They force a sale at $${salePrice.toLocaleString()}. A 30% discount to current valuation.`,
        "You don't get a vote. That's the point.",
        "Ending unlocked: Forced Acquisition.",
      ],
    };
  }

  // Fallback founder removal: cofounder trust collapses before board exists.
  if (
    state.board.members.length < 3 &&
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
