/**
 * The career's sounds: one for each year's main milestone, the market's new users streaming in, and the office's
 * footsteps and chairs as the world times them.
 *
 * Which sound a year earns is a pure choice from what the year added to the career's record; playing it goes through
 * the shared audio engine, so the Sound menu's mute and volume apply. The race never reaches any of this.
 */

import { playSound } from "../audio/engine";
import type { PlayOptions, SoundName } from "../audio/sounds";
import { eraIndexOf, upcomingShift } from "../engine/career";
import type { RulesConfig } from "../engine/types";
import type { CareerRecord, Milestone } from "../state/careerRecord";
import type { PlaybackBeat } from "../scene/yearPlayback";
import type { WorldSoundListener } from "../world/types/system";

export interface YearSoundInput {
  readonly config: RulesConfig;
  readonly before: { readonly turn: number; readonly record: CareerRecord };
  readonly after: { readonly turn: number; readonly record: CareerRecord; readonly over: boolean };
}

type YearSoundKind = "listed" | "rescued" | "office" | "launch" | "era" | "shift" | "rivalOut" | "rivalIn";

export const YEAR_SOUNDS: Readonly<Record<YearSoundKind, SoundName>> = {
  listed: "crowd-cheer",
  rescued: "negative-big",
  office: "asset-office-upgrade",
  launch: "launch-ok",
  era: "phase-change",
  shift: "event-beacon",
  rivalOut: "power-down",
  rivalIn: "neutral",
};

const has = (added: readonly Milestone[], kind: Milestone["kind"]): boolean => added.some((milestone) => milestone.kind === kind);

/** The one sound a year earns, by importance; null in a race, for a year that ends the career, or a year of nothing. */
export const yearSoundFor = ({ config, before, after }: YearSoundInput): SoundName | null => {
  const career = config.career;
  if (career === undefined || after.over) return null;
  const added = after.record.slice(before.record.length);
  if (has(added, "listed")) return YEAR_SOUNDS.listed;
  if (has(added, "rescued")) return YEAR_SOUNDS.rescued;
  if (has(added, "office")) return YEAR_SOUNDS.office;
  if (has(added, "launch")) return YEAR_SOUNDS.launch;
  if (eraIndexOf(before.turn, career) !== eraIndexOf(after.turn, career)) return YEAR_SOUNDS.era;
  const shift = upcomingShift(after.turn, config)?.cardId;
  if (shift !== undefined && shift !== upcomingShift(before.turn, config)?.cardId) return YEAR_SOUNDS.shift;
  if (has(added, "rivalOut")) return YEAR_SOUNDS.rivalOut;
  if (has(added, "rivalIn")) return YEAR_SOUNDS.rivalIn;
  return null;
};

/** The market beat streams the year's new users in; no other beat has a sound of its own. */
export const beatSoundFor = (beat: PlaybackBeat): SoundName | null => (beat.kind === "market" ? "users-trickle" : null);

/** How many of the sounds asked for are remembered, for the browser checks. */
const HEARD_KEPT = 20;
const heard: SoundName[] = [];

/** Plays a library sound, and remembers that it was asked for. Never throws. */
export const playCareerSound = (name: SoundName, options?: PlayOptions): void => {
  heard.push(name);
  if (heard.length > HEARD_KEPT) heard.splice(0, heard.length - HEARD_KEPT);
  playSound(name, options);
};

/** The last sounds asked for, oldest first. */
export const soundsHeard = (): readonly SoundName[] => [...heard];

let lastKey: string | null = null;

/**
 * Plays `name` once for `key` (`${runId}:${turn}`, the office scene's runId): a second call with the same key plays
 * nothing. Every call stores its key, a null one included.
 */
export const soundOnce = (key: string, name: SoundName | null): void => {
  if (key === lastKey) return;
  lastKey = key;
  if (name !== null) playCareerSound(name);
};

/** Footsteps and chairs on the world bus, panned where the world says they happen. */
export const careerWorldSound: WorldSoundListener = {
  onFootsteps: ({ pan, panTo, steps, approach }) => playCareerSound("footsteps", { pan, panTo, steps, approach }),
  onChairSit: ({ pan }) => playCareerSound("chair-sit", { pan }),
};
