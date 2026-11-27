import { rulesForTurn, yearOf } from "../engine/career";
import type { Allocation, PriceTier, RulesConfig } from "../engine/types";
import type { StorageLike } from "../state/gameStore";
import { money } from "./format";

/** Where the browser remembers that the start tour was finished or skipped, apart from both saves. */
export const TOUR_KEY = "startupworld:tour:v1";

export type TourStepId = "goal" | "team" | "money" | "cash" | "end" | "report" | "done";
/** What a step points at: the value of the career-only data-tutorial attribute; null for the closing card. */
export type TourTarget = "status" | "team" | "money" | "cash" | "end" | "report";

export interface TourStep {
  readonly id: TourStepId;
  readonly target: TourTarget | null;
  readonly title: string;
  readonly text: string;
}

/** The steps in order; [] in a race. `office`: the 3D office is on screen, so the team step also says how to move a person there. */
export const tourSteps = (config: RulesConfig, options: { readonly office: boolean }): readonly TourStep[] => {
  const career = config.career;
  if (career === undefined) return [];
  const rules = rulesForTurn(config, 1);
  const last = yearOf(rules.game.maxTurns, career);
  const fee = money(rules.hiring.fee);
  const office = options.office ? " In the office you can also click a person, then another team." : "";
  return [
    {
      id: "goal",
      target: "status",
      title: "Your goal",
      text: `Grow your users, go public, and last until ${last}. Each year you set a plan, end the year, and read what happened.`,
    },
    {
      id: "team",
      target: "team",
      title: "Your team",
      text:
        "Your people work in Product, Growth or Recruiting. Product builds what users want, Growth wins them, and Recruiting hires. " +
        "To hire, press + on Recruiting: with nobody free, someone moves over from your largest team. " +
        `Each hire costs ${fee} now and a salary every year, and joins next year.${office}`,
    },
    {
      id: "money",
      target: "money",
      title: "Price and marketing",
      text: "Marketing buys pull for new users, and each extra dollar does less. A lower price wins more users; a higher one earns more from each.",
    },
    {
      id: "cash",
      target: "cash",
      title: "Cash and the board",
      text:
        "This is the cash the plan leaves at the end of the year. Below $0 the company needs its one rescue. " +
        "Once investors outnumber founders on your board, a bad year can get you fired: the warnings say when.",
    },
    {
      id: "end",
      target: "end",
      title: "End the year",
      text: "When the plan looks right, press End. The year plays out and its report opens.",
    },
    {
      id: "report",
      target: "report",
      title: "The report",
      text: "The report shows the users you won, your cash and what your rivals did. Open it again any time with Last report, or the Report tab on a phone.",
    },
    {
      id: "done",
      target: null,
      title: "That's the tour",
      text: "You know the basics. How to play has the rest of the rules, and can show this tour again.",
    },
  ];
};

/** What the tour watches on the screen. */
export interface TourWatch {
  readonly turn: number;
  readonly allocation: Allocation;
  readonly marketing: number;
  readonly price: PriceTier;
}

export interface TourState {
  readonly index: number;
  readonly since: TourWatch;
}

export const startTour = (watch: TourWatch): TourState => ({ index: 0, since: watch });

/** Next or Done: the following step, or "finished" after the last. */
export const nextStep = (state: TourState, watch: TourWatch, steps: readonly TourStep[]): TourState | "finished" =>
  state.index + 1 >= steps.length ? "finished" : { index: state.index + 1, since: watch };

const allocationChanged = (a: Allocation, b: Allocation): boolean =>
  a.product !== b.product || a.growth !== b.growth || a.recruiting !== b.recruiting;

/** After the screen changed: on to the next step when the player did what this one asks; to the report step when a
 *  year was played before it; otherwise the same state object. */
export const observeTour = (state: TourState, watch: TourWatch, steps: readonly TourStep[]): TourState | "finished" => {
  const i = state.index;
  const ids = steps.map((step) => step.id);
  const end = ids.indexOf("end");
  const report = ids.indexOf("report");
  if (watch.turn > state.since.turn && i <= end) return { index: report, since: watch };
  const id = steps[i]?.id;
  if (id === "team" && allocationChanged(state.since.allocation, watch.allocation)) return nextStep(state, watch, steps);
  if (id === "money" && (state.since.marketing !== watch.marketing || state.since.price !== watch.price)) return nextStep(state, watch, steps);
  return state;
};

export const shouldStartTour = (now: { readonly career: boolean; readonly turn: number; readonly hasReport: boolean; readonly seen: boolean }): boolean =>
  now.career && now.turn === 1 && !now.hasReport && !now.seen;

/** The phone tab a target lives on; null when it is on every tab. */
export const tabFor = (target: TourTarget | null): "plan" | null => (target === "team" || target === "money" ? "plan" : null);

/** The card's distance from the screen's edge and the bar. */
export const TOUR_GAP = 12;
/** The least space between the card and its target. */
export const TOUR_MARGIN = 8;

export interface DockInput {
  readonly top: number;
  readonly bottom: number;
  readonly viewport: number;
  readonly bar: number;
  readonly card: number;
  readonly fixed: boolean;
}

/** Where the card docks (the side with more room beside the target) and how far to scroll the page (window.scrollBy)
 *  so the card does not cover the target; a fixed target is never scrolled. */
export const dockFor = (input: DockInput): { readonly dock: "top" | "bottom"; readonly scroll: number } => {
  const { top, bottom, viewport, bar, card, fixed } = input;
  const above = top;
  const below = viewport - bar - bottom;
  const dock = below > above ? "bottom" : "top";
  if (fixed) return { dock, scroll: 0 };
  const scroll =
    dock === "top"
      ? Math.min(0, top - (TOUR_GAP + card + TOUR_MARGIN))
      : Math.max(0, bottom - (viewport - bar - TOUR_GAP - card - TOUR_MARGIN));
  return { dock, scroll };
};

/** Seen once finished or skipped; missing or blocked storage reads as seen. */
export const readTourSeen = (storage: Pick<StorageLike, "getItem"> | null): boolean => {
  if (storage === null) return true;
  try {
    return storage.getItem(TOUR_KEY) !== null;
  } catch {
    return true;
  }
};

/** Remembers that the tour was finished or skipped; a full or blocked storage throws nothing. */
export const writeTourSeen = (storage: Pick<StorageLike, "setItem"> | null, how: "done" | "skipped"): void => {
  try {
    storage?.setItem(TOUR_KEY, how);
  } catch {
    // The flag is a convenience: losing it only means the tour may show again.
  }
};
