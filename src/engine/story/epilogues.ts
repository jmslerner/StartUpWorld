// The pack's three written endings, shown as an epilogue on the game-over card. They never change how or when a game
// ends, or its score: the existing endings decide that; an epilogue only adds a closing scene when its conditions hold.
import type { GameState } from "../../types/game";
import { computeContext } from "../context";
import { storyConfig } from "./config";
import { choseInStory, storyOf } from "./state";

export interface Epilogue {
  id: "archive" | "next-chapter" | "boring-miracle";
  title: string;
  lines: string[];
  tagline: string; // two short lines, separated by "\n"
}

export const EPILOGUES: Record<Epilogue["id"], Epilogue> = {
  "next-chapter": {
    id: "next-chapter",
    title: "The Next Chapter",
    lines: [
      "The new money arrives at 9:03 a.m.",
      "Payroll clears. The servers stay on.",
      "Your original shares remain visible in the employee portal. [[beat]]",
      "Priya has changed the column heading from Ownership to Historical Interest.",
    ],
    tagline: "YOU SAVED THE COMPANY.\nTHE COMPANY IS GRATEFUL TO ITS NEW OWNERS.",
  },
  "boring-miracle": {
    id: "boring-miracle",
    title: "The Boring Miracle",
    lines: [
      "The company finishes the quarter with money left over.",
      "No new round. No emergency bridge. No founder manifesto.",
      "A customer renews without requesting a discount or an explanation. [[beat]]",
      "Trent says the business could be more ambitious.",
      "Priya asks whether ambition accepts bank transfers.",
    ],
    tagline: "YOU BUILT A BUSINESS.\nTHE PRESS RELEASE IS OPTIONAL.",
  },
  archive: {
    id: "archive",
    title: "The Archive",
    lines: [
      "The website is gone.",
      "The fundraising deck still circulates.",
      "Three podcasts describe you as early.",
      "Former customers use another word. [[beat]]",
      "Your final cloud invoice arrives after the farewell post.",
      "It is the only stakeholder that has achieved closure.",
    ],
    tagline: "THE VISION WAS LARGE.\nTHE REMAINING BALANCE IS EXACT.",
  },
};

/**
 * The epilogue a finished game earned, first match wins:
 * - The Archive: bankrupt after protecting the story at least twice.
 * - The Next Chapter: the company survives but the founder kept 15% or less, after four Series A+ rounds or the rescue.
 * - The Boring Miracle: an IPO, acquisition or zombie-SaaS ending, profitable, never spun, at most one Series A+ round,
 *   reputation 55+.
 */
export const pickEpilogue = (s: GameState): Epilogue | null => {
  if (!storyConfig.enabled || !s.gameOver) return null;
  const story = storyOf(s);
  const ending = s.gameOver.ending;
  if (ending === "bankruptcy" && story.spin >= 2) return EPILOGUES.archive;
  if (ending !== "bankruptcy" && s.capTable.founderPct <= 0.15 && (story.rounds >= 4 || choseInStory(s, "vc-rescue-board-control", "rescue"))) {
    return EPILOGUES["next-chapter"];
  }
  if (
    (ending === "ipo" || ending === "acquisition" || ending === "zombie-saas") &&
    computeContext(s).profitable &&
    story.spin === 0 &&
    story.rounds <= 1 &&
    s.reputation >= 55
  ) {
    return EPILOGUES["boring-miracle"];
  }
  return null;
};
