// Fundraising interludes, Series A through N: one short scene each time an investor round closes at Series A or later.
// Narrative labels only (the engine's stages stay garage, seed, series-a and growth); no stat effects.
import type { GameState } from "../../types/game";
import { storyConfig } from "./config";
import { withStory, storyOf } from "./state";

export interface Interlude {
  heading: string;
  lines: [string, string];
  catch: string | null;
  closing: string | null;
}

export const INTERLUDES: Interlude[] = [
  {
    heading: "SERIES A — ADULT SUPERVISION",
    lines: ["Trent: “We invest in founders.”", "Priya: “Then why does the term sheet invest so much in replacing them?”"],
    catch: "Capital arrives with a board seat and a standing meeting that can never be declined.",
    closing: "“The company has professional investors. Your calendar has professional supervision.”",
  },
  {
    heading: "SERIES B — BURN BEFORE EARN",
    lines: ["Trent: “You’re underinvesting in the opportunity.”", "Lena: “Which opportunity? We currently have four and one deployment pipeline.”"],
    catch: "The round funds a hiring plan built around customers who have not bought anything yet.",
    closing: "“Headcount doubles. The problem becomes eligible for middle management.”",
  },
  {
    heading: "SERIES C — COMPUTE CONVICTION",
    lines: ["Trent: “The infrastructure is the moat.”", "Priya: “Some of this check is credits. The landlord accepts a different kind.”"],
    catch: "Cash comes alongside compute credits; the usage bill changes when the credits expire.",
    closing: "“You have secured the capacity to spend next year’s round.”",
  },
  {
    heading: "SERIES D — DATA DESTINY",
    lines: ["Trent: “Nobody else has your dataset.”", "Jules: “We should establish whether we have permission to have it.”"],
    catch: "Diligence asks where the data came from and why the valuable folder is called misc_final2.",
    closing: "“Your proprietary advantage requires a spreadsheet of its own.”",
  },
  {
    heading: "SERIES E — EVERYTHING IS AN AGENT",
    lines: ["Trent: “The market has moved beyond software.”", "Lena: “The renewal agreement has not.”"],
    catch: "Every product is renamed an agent; customer success still does the difficult work.",
    closing: "“The roadmap changes vocabulary. Engineering requests a change in staffing.”",
  },
  {
    heading: "SERIES F — FOUNDER LIQUIDITY",
    lines: ["Trent: “We want you focused on the long term.”", "Priya: “Does the long term include explaining this to employees?”"],
    catch: "The founder sells some shares; employees learn that solidarity has a minimum transaction size.",
    closing: "“You are still all in. The definition now excludes the proceeds.”",
  },
  {
    heading: "SERIES G — GROWTH AT ANY CALENDAR DATE",
    lines: ["Trent: “We need predictable demand.”", "Sales: “We can predict which discount gets the signature before Friday.”"],
    catch: "Annual deals hit the quarter at prices that make next year’s renewals harder.",
    closing: "“The quarter is saved. The anniversary has been scheduled.”",
  },
  {
    heading: "SERIES H — HEADLINE PRESERVATION",
    lines: ["Trent: “We’re happy to maintain your valuation.”", "Priya: “And change everything underneath it.”"],
    catch: "The price stays flat while investor preferences grow more demanding.",
    closing: "“Sloane announces stability. Finance updates the waterfall.”",
  },
  {
    heading: "SERIES I — INDUSTRY CONSOLIDATION",
    lines: ["Trent: “Category leaders buy their competitors.”", "Jules: “How many definitions of customer should a category leader own?”"],
    catch: "Three acquisitions bring four billing systems, seven data lakes, and a disputed cofounder.",
    closing: "“You own the category. Nobody owns the migration.”",
  },
  {
    heading: "SERIES J — JUST A BRIDGE",
    lines: ["Trent: “This gets you to the next financing.”", "Priya: “And what gets us to the financing after that?”"],
    catch: "A short-term note buys time and introduces a maturity date people cannot postpone with a slide.",
    closing: "“The bridge opens. The other side is another calendar invitation.”",
  },
  {
    heading: "SERIES K — KEEP THE DISCIPLINE",
    lines: ["Trent: “This market rewards efficient businesses.”", "Lena: “You approved the hiring plan.”"],
    catch: "The board that demanded expansion demands cuts; a transformation consultant arrives at a premium rate.",
    closing: "“The efficiency program has its own operating budget.”",
  },
  {
    heading: "SERIES L — LIQUIDITY PREPARATION",
    lines: ["Trent: “You’re twelve months from an IPO.”", "Priya: “We have been twelve months away for eighteen months.”"],
    catch: "Bankers, audits, and reporting systems consume cash; the forecast refreshes every quarter.",
    closing: "“The company is nearly ready to explain itself to strangers.”",
  },
  {
    heading: "SERIES M — MANAGEMENT UPGRADE",
    lines: ["Trent: “We still believe in what you built.”", "You: “Do you believe in who built it?”"],
    catch: "New money depends on a new CEO; your proposed title contains both vision and emeritus.",
    closing: "“Your contribution is permanent. Your signing authority is not.”",
  },
  {
    heading: "SERIES N — NEXT CHAPTER",
    lines: ["Trent: “The cap table needs a fresh start.”", "Priya: “It has requested that the founders participate mostly in spirit.”"],
    catch: "A recapitalization restores runway and rewrites ownership.",
    closing: "“The company survives. Your original percentage becomes an excellent interview anecdote.”",
  },
];

/** After Series N, every further round gets the pack's recurring exchange. */
export const RECURRING_EXCHANGE: Interlude = {
  heading: "ANOTHER ROUND",
  lines: ["Trent: “The terms are standard.”", "Priya: “For whom?”"],
  catch: null,
  closing: "Trent: “Our portfolio.”",
};

/** The interlude for the n-th Series A+ round (1 = Series A). */
export const interludeFor = (round: number): Interlude => INTERLUDES[round - 1] ?? RECURRING_EXCHANGE;

export const interludeLines = (i: Interlude): string[] => [
  "",
  i.heading,
  ...i.lines,
  ...(i.catch ? [`Catch: ${i.catch}`] : []),
  ...(i.closing ? [i.closing] : []),
];

/** True when an investor round closing now counts as Series A or later. */
export const isSeriesRound = (stageAfter: GameState["stage"]): boolean => stageAfter === "series-a" || stageAfter === "growth";

/** Counts a Series A+ round and returns its interlude (nothing at all while the pack is switched off). */
export const countSeriesRound = (s: GameState): { state: GameState; lines: string[] } => {
  if (!storyConfig.enabled) return { state: s, lines: [] };
  const round = storyOf(s).rounds + 1;
  return { state: withStory(s, (story) => ({ ...story, rounds: round })), lines: interludeLines(interludeFor(round)) };
};
