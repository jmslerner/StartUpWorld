import type { Build, GameState } from "../../types/game";
import { BURNOUT_ENERGY, ENERGY_CRUNCH_DRAIN, POLISH_MAX, SURPRISE_MAX } from "../tycoon/constants";
import { buildsOf, productRng, setProduct, staffOf } from "../tycoon/roster";
import { chance, nextIntInclusive } from "../rng";
import { clamp } from "../utils";
import {
  CRUFT_CHURN, CRUNCH_CRUFT, MOAT_CHURN, MOAT_CHURN_CAP, MOAT_DECAY, POLISH_COST, POLISH_WEEK_MAX, SIZES, SURPRISE_OPERATOR_MULT,
  SURPRISE_PM_MULT, SURPRISE_SCOPE,
} from "./constants";
import { forecastText, isBuilt, pct, round1, weekOutput } from "./work";

// Tick step N1 (TYCOON-SPEC §5.4, §5.6, §6) and the churn hook.

export const SURPRISE_LINES = [
  "the staging environment has been prod since March",
  "the billing system turns out to be load-bearing",
  "the API it depends on was a screenshot",
  "'done' and 'done done' turn out to be different columns",
  "the design assumed users read",
  "legal has discovered the feature",
  "the estimate did not include the estimate being wrong",
  "it works, but only on the laptop of someone who left",
];

/**
 * Weekly churn as the product leaves it (§5.6): cruft adds, moat removes, before today's clamp.
 * Returns `churn` ITSELF with no product slice or when cruft and moat are both 0 (legacy identity).
 */
export const adjustChurn = (state: GameState, churn: number): number => {
  const product = state.product;
  if (!product || (product.cruft === 0 && product.moat === 0)) return churn;
  return (churn + CRUFT_CHURN * product.cruft) * (1 - Math.min(MOAT_CHURN_CAP, MOAT_CHURN * product.moat));
};

/** This week's surprise chance for an unfinished build: the size's chance, halved by a product person on it, x0.8 with an operator. */
export const surpriseChance = (state: GameState, b: Build): number => {
  const pm = staffOf(state, b.id).some((e) => e.role === "product");
  return SIZES[b.size].surprise * (pm ? SURPRISE_PM_MULT : 1) * (state.cofounder.archetype === "operator" ? SURPRISE_OPERATOR_MULT : 1);
};

/** What happened to one build this tick, kept for the lines rendered later from the finished tick. */
interface Worked {
  id: string;
  from: number; // pct before the work
  added: number; // points that went into progress this tick
  crunched: boolean; // worked under crunch
  wasBuilt: boolean; // already at 100% before this tick
  surprise: string | null;
  worked: Build; // the build as N1 left it (fallback if it is gone by render time)
}

/** The weekly line for one build, from the state the tick finished with (§6 step 10). */
const progressLine = (final: GameState, w: Worked): string => {
  const b = buildsOf(final).find((x) => x.id === w.id) ?? w.worked;
  if (isBuilt(b)) {
    return w.wasBuilt
      ? `${b.name}: built, polish ${b.polish}/${POLISH_MAX}. ${forecastText(final, b)}. \`ship ${b.slug}\`.`
      : `${b.name}: 100% built. \`ship ${b.slug}\` — or keep polishing. ${forecastText(final, b)}.`;
  }
  return `${b.name}: ${w.from}% → ${pct(b)}% built (+${round1(w.added)} pts${w.crunched ? crunchNote(final, b) : ""}). ${forecastText(final, b)}.`;
};

/**
 * ", crunching, lowest energy 40 — interviews start under 30": the crew's weakest battery after this week's drain, so the bill for crunch is on the line
 * that reports what it bought (people start interviewing under BURNOUT_ENERGY). ERRATA 67.
 */
const crunchNote = (final: GameState, b: Build): string => {
  const crew = staffOf(final, b.id);
  if (crew.length === 0) return ", crunching";
  const lowest = crew.reduce((min, e) => Math.min(min, e.energy), 100);
  return `, crunching, lowest energy ${lowest}${lowest < BURNOUT_ENERGY + ENERGY_CRUNCH_DRAIN ? ` — interviews start under ${BURNOUT_ENERGY}` : ""}`;
};

const IDLE = (): string[] => [];

/**
 * Tick step N1: one week of work on every active build, in board order, then moat decay (§5.4, §5.6).
 * `state.week` is already the NEW week; the week being worked is `state.week − 1` (people with joinedWeek === week − 1 ramp).
 * Draws only from product.rng (one surprise `chance` per unfinished build under the surprise cap, plus the line pick on a hit).
 * Returns no strings: `render(final)` builds the lines from the FINISHED tick, so forecasts match what `build` prints next.
 * Idle (no build, no moat), or a moat that rounds to itself with nothing in flight: the same reference and `render: () => []`.
 */
export const runProjectsWeek = (state: GameState): { state: GameState; render: (final: GameState) => string[] } => {
  const product = state.product;
  if (!product || (product.active.length === 0 && product.moat === 0)) return { state, render: IDLE };
  const moat = round1(product.moat * (1 - MOAT_DECAY));
  if (product.active.length === 0) {
    return moat === product.moat ? { state, render: IDLE } : { state: setProduct(state, { moat }), render: IDLE };
  }

  const workWeek = state.week - 1;
  const startRng = productRng(state);
  let rng = startRng;
  let cruft = product.cruft;
  let active = product.active;
  const worked: Worked[] = [];

  for (const original of product.active) {
    // Output reads the roster, culture, headcount and the oldest build's id, none of which this loop changes.
    const out = weekOutput(state, original, workWeek);
    const wasBuilt = isBuilt(original);
    let b: Build = original;
    const add = wasBuilt ? 0 : Math.min(out.points, b.scope - b.progress);
    const spare = out.points - add;
    // Crunch bites only when someone staffed worked under it (ERRATA 68): then their energy is charged in N2 (crunchedWeek),
    // the week counts and it leaves cruft. A crunch flag over an empty crew does nothing at all.
    if (out.crunched) {
      b = { ...b, crunchedWeek: state.week, crunchWeeks: b.crunchWeeks + 1 };
      cruft = clamp(cruft + CRUNCH_CRUFT, 0, 100);
    }
    if (add > 0) b = { ...b, progress: b.progress + add, qSum: b.qSum + add * out.quality, qPts: b.qPts + add };
    if (isBuilt(b)) {
      if (!wasBuilt) b = { ...b, progress: b.scope, readyWeek: state.week, crunch: false };
      if (spare > 0 && b.polish < POLISH_MAX) {
        b = { ...b, polish: round1(Math.min(POLISH_MAX, b.polish + Math.min(POLISH_WEEK_MAX, spare / (POLISH_COST * b.scope)))) };
      }
    }
    let surprise: string | null = null;
    if (!isBuilt(b) && b.surprises < SURPRISE_MAX) {
      const roll = chance(rng, surpriseChance(state, b));
      rng = roll.rng;
      if (roll.value) {
        const pick = nextIntInclusive(rng, 0, SURPRISE_LINES.length - 1);
        rng = pick.rng;
        const extra = round1(SURPRISE_SCOPE * b.baseScope);
        b = { ...b, scope: round1(b.scope + extra), surprises: b.surprises + 1 };
        surprise = `${b.name}: surprise — ${SURPRISE_LINES[pick.value]}. Scope +${extra} pts.`;
      }
    }
    const patched = b;
    active = active.map((x) => (x.id === patched.id ? patched : x));
    worked.push({ id: b.id, from: pct(original), added: add, crunched: out.crunched, wasBuilt, surprise, worked: patched });
  }

  const s = setProduct(state, {
    active,
    cruft: round1(cruft),
    moat,
    // Write the stream back only if it was drawn from (a function that does not draw leaves the field untouched, §2.6).
    rng: rng === startRng ? product.rng : rng,
  });
  const render = (final: GameState): string[] => {
    const lines: string[] = [];
    for (const w of worked) {
      lines.push(progressLine(final, w));
      if (w.surprise) lines.push(w.surprise);
    }
    return lines;
  };
  return { state: s, render };
};
