// Dashboard barks: the pack's news-ticker lines, used sparingly between events. One slot every BARK_EVERY weeks (phase
// set by the seed); a slot stays quiet when an event or a later scene played that week. Lines come from a per-seed
// shuffle, so a game works through all of them before repeating, and lines that need context skip when it is missing.
// Pure functions of (seed, week, state): no state.rng draws, no state change.
import type { GameState } from "../../types/game";
import type { EngineContext } from "../context";
import { storyConfig } from "./config";
import { storyOf } from "./state";

export const BARK_EVERY = 5;
export const BARK_FIRST_WEEK = 6;

interface Bark {
  text: string;
  when?: (s: GameState, ctx: EngineContext) => boolean;
}

const directors = (s: GameState): boolean => s.board.members.some((m) => m.role !== "founder");

export const BARKS: Bark[] = [
  { text: "Your AI agent has requested an executive assistant." },
  { text: "Token usage is up 400%. Customer outcomes remain on the roadmap." },
  { text: "The data lake is now large enough to contain several mutually exclusive truths." },
  { text: "A consultant has recommended a second dashboard to reconcile the first three." },
  { text: "Your compute credits expire at midnight. Your customers do not." },
  { text: "The founder has achieved product-podcast fit.", when: (s) => s.reputation >= 40 },
  { text: "The board would like fewer surprises and more ambitious forecasts.", when: directors },
  { text: "A competitor has open-sourced your differentiation." },
  { text: "The apology has passed legal review and failed reading comprehension." },
  { text: "Customer trust has been escalated to a shared spreadsheet." },
  { text: "Your cheapest model has become your most profitable employee." },
  { text: "The pipeline is healthy. Several accounts have not been informed they are in it." },
  { text: "The agent completed the task of creating more tasks." },
  { text: "The company has renamed technical debt “historical velocity.”" },
  { text: "A customer used the product exactly as advertised. Support is investigating." },
  { text: "Your privacy policy now requires a context window." },
  { text: "The GPU cluster is fully utilized. Sales is working on the reason." },
  { text: "Revenue is recurring. Unfortunately, so is the explanation.", when: (s) => s.mrr > 0 },
  { text: "The CFO has asked that “inevitable” be removed from the forecast." },
  { text: "Your cofounder has published a leadership thread from an undisclosed location." },
  { text: "The board has extended its full support through the next board meeting.", when: directors },
  { text: "The data room contains a folder called PLEASE_DONT_OPEN.", when: (s) => s.totalRaised > 0 || s.investors.pipeline.length > 0 },
  { text: "The company has reached Series J. Profitability has reached committee.", when: (s) => storyOf(s).rounds >= 10 },
  { text: "An employee has asked whether the equity offer includes a payout example.", when: (_s, ctx) => ctx.teamSize >= 5 },
  { text: "The founder’s net worth has risen. The company card was declined.", when: (s) => s.valuation >= 10_000_000 },
  { text: "Procurement has asked for a human who is accountable for the agent." },
  { text: "The agent remembers your promise. Investor relations would like it to forget." },
  { text: "“Unlimited” has been referred to the pricing committee." },
];

/** A per-seed shuffle of the bark indexes (its own xorshift32; never the game's RNG). */
const orderFor = (seed: number): number[] => {
  let x = (seed ^ 0x2545f491) >>> 0 || 1;
  const next = (): number => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
  const order = BARKS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
};

/** This week's news line, or null when the week has no slot (or the pack is off). The caller skips busy weeks. */
export const barkFor = (s: GameState, ctx: EngineContext): string | null => {
  if (!storyConfig.enabled || s.gameOver || s.week < BARK_FIRST_WEEK) return null;
  const seed = s.seed >>> 0;
  if ((s.week + (seed % BARK_EVERY)) % BARK_EVERY !== 0) return null;
  const slot = Math.floor(s.week / BARK_EVERY);
  const order = orderFor(seed);
  for (let k = 0; k < order.length; k++) {
    const bark = BARKS[order[(slot + k) % order.length]];
    if (!bark.when || bark.when(s, ctx)) return `NEWS: ${bark.text}`;
  }
  return null;
};
