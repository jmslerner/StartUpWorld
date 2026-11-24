// The story slice: what the player chose in the pack's events, which later scenes those choices earned, how many
// Series A+ rounds have closed, and how often the player protected the story instead of the business.
import type { GameState, StoryCallback, StoryChoice, StoryState } from "../../types/game";

export const STORY_CHOICES_MAX = 40;
export const STORY_CALLBACKS_MAX = 40;
/** A later scene still unplayed this many weeks after it fell due is dropped silently. */
export const CALLBACK_GRACE_WEEKS = 12;

export const emptyStory = (): StoryState => ({ choices: [], callbacks: [], rounds: 0, spin: 0 });

/** The slice, or an empty one for a state that has none yet (never stored by this call). */
export const storyOf = (s: GameState): StoryState => s.story ?? emptyStory();

export const withStory = (s: GameState, f: (story: StoryState) => StoryState): GameState => ({ ...s, story: f(storyOf(s)) });

/** True when this story event already ran in this game (chosen, or picked and still on screen). */
export const storySeen = (s: GameState, eventId: string): boolean =>
  storyOf(s).choices.some((c) => c.eventId === eventId) || s.eventHistory.some((h) => h.id === eventId);

export const choseInStory = (s: GameState, eventId: string, choiceId: string): boolean =>
  storyOf(s).choices.some((c) => c.eventId === eventId && c.choiceId === choiceId);

/** Records a story choice; schedules its later scene `delay` weeks out (null: none); bumps `spin` when asked. */
export const recordStoryChoice = (s: GameState, eventId: string, choiceId: string, delay: number | null, spin: boolean): GameState =>
  withStory(s, (story) => ({
    ...story,
    choices: [{ eventId, choiceId, week: s.week }, ...story.choices].slice(0, STORY_CHOICES_MAX),
    callbacks: delay === null ? story.callbacks : [...story.callbacks, { key: `${eventId}:${choiceId}`, dueWeek: s.week + delay }].slice(-STORY_CALLBACKS_MAX),
    spin: story.spin + (spin ? 1 : 0),
  }));

// ── Save normalizer ──

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const int = (x: unknown, min: number, max: number, dflt: number): number => (isNum(x) ? Math.min(max, Math.max(min, Math.round(x))) : dflt);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY = /^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$/;
const slug = (x: unknown): string | null => (typeof x === "string" && x.length <= 60 && SLUG.test(x) ? x : null);

const normChoice = (raw: unknown, week: number): StoryChoice | null => {
  if (!isObj(raw)) return null;
  const eventId = slug(raw.eventId);
  const choiceId = slug(raw.choiceId);
  return eventId && choiceId ? { eventId, choiceId, week: int(raw.week, 1, week, week) } : null;
};

const normCallback = (raw: unknown): StoryCallback | null => {
  if (!isObj(raw) || typeof raw.key !== "string" || raw.key.length > 121 || !KEY.test(raw.key) || !isNum(raw.dueWeek)) return null;
  return { key: raw.key, dueWeek: int(raw.dueWeek, 1, 1_000_000, 1) };
};

/** Accepts anything and returns a valid story slice (missing or corrupt parts become empty). Pure. */
export const normalizeStory = (raw: unknown, week: number): StoryState => {
  if (!isObj(raw)) return emptyStory();
  const w = Math.max(1, Math.round(isNum(week) ? week : 1));
  const choices = (Array.isArray(raw.choices) ? raw.choices : []).map((c) => normChoice(c, w)).filter((c): c is StoryChoice => c !== null);
  const callbacks = (Array.isArray(raw.callbacks) ? raw.callbacks : []).map(normCallback).filter((c): c is StoryCallback => c !== null);
  return {
    choices: choices.slice(0, STORY_CHOICES_MAX),
    callbacks: callbacks.slice(-STORY_CALLBACKS_MAX),
    rounds: int(raw.rounds, 0, 1000, 0),
    spin: int(raw.spin, 0, 1000, 0),
  };
};
