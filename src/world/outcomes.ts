/**
 * Shared readings of "how did that go?" for the systems that react to it.
 * Pure: no three.js, no DOM.
 */
import type { CompanyPhase, EndingType } from "../types/game";

/** The endings a run is glad to reach. Every other ending is a loss. */
export const WIN_ENDINGS: ReadonlySet<EndingType> = new Set<EndingType>(["ipo", "acquisition", "ai-hype-exit"]);

export const isWinEnding = (ending: EndingType): boolean => WIN_ENDINGS.has(ending);

/** The run is over and it did not end well. */
export const isLossEnding = (ending: EndingType | null): boolean => ending !== null && !WIN_ENDINGS.has(ending);

const PHASE_ORDER: readonly CompanyPhase[] = ["garage", "coworking", "office", "unicorn", "public"];

/**
 * Did the company move up? A phase can also fall (the engine recomputes it from
 * the valuation after every action), and nobody throws confetti for that.
 */
export const isPromotion = (from: CompanyPhase, to: CompanyPhase): boolean =>
  PHASE_ORDER.indexOf(to) > PHASE_ORDER.indexOf(from);
