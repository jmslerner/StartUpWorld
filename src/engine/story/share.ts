// The story pack's cadence. Some existing events' weights grow with the company into the thousands (data-leak-screenshot,
// pricing-backlash, feature-demand-wave), so any fixed story weight would vanish late in a game. Instead, whenever at
// least one story event is eligible, the story events together get STORY_PICK_SHARE of the week's weighted pick, split
// by their own weights (so chains and thesis bonuses still decide WHICH story event). Never lowers a weight. Only
// rescales weights already computed: the pick draws exactly as many RNG values as before.
import { storyConfig } from "./config";
import { STORY_EVENT_IDS } from "./meta";

export const STORY_PICK_SHARE = 0.2;

const STORY_IDS = new Set<string>(STORY_EVENT_IDS);

export const isStoryEvent = (id: string): boolean => STORY_IDS.has(id);

export const withStoryShare = (ids: readonly string[], weights: readonly number[]): number[] => {
  const out = [...weights];
  if (!storyConfig.enabled) return out;
  let story = 0;
  let rest = 0;
  ids.forEach((id, i) => {
    if (STORY_IDS.has(id)) story += weights[i];
    else rest += weights[i];
  });
  if (story <= 0 || rest <= 0) return out;
  const k = Math.max(1, (rest * STORY_PICK_SHARE) / (1 - STORY_PICK_SHARE) / story);
  return out.map((w, i) => (STORY_IDS.has(ids[i]) ? w * k : w));
};
