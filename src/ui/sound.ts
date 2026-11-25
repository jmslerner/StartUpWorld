/**
 * The game's outcome stingers, voiced by the shared audio engine (src/audio) on its `outcome`
 * bus: one AudioContext for the whole app, a real mix with a limiter, voice caps and retrigger
 * limits, and the mute / volume settings (including the old `startupworld:sfx:master` flag,
 * "0" = off).
 *
 * Every call is fire-and-forget and never throws, even when audio is blocked or unavailable.
 */
import { playSound } from "../audio/engine";
import type { SoundName } from "../audio/sounds";

/** How a game ended, from the player's side. */
export type GameEndSound = "win" | "loss" | "bankrupt" | "fired";

export const GAME_END_SOUNDS: Record<GameEndSound, SoundName> = {
  win: "gameover-ipo",
  loss: "gameover-zombie-saas",
  bankrupt: "gameover-bankruptcy",
  fired: "gameover-founder-removal",
};

/** Rising chirp, D5 → F♯5. */
function success() {
  playSound("success");
}

/** Descending buzz, D4 → B3. */
function fail() {
  playSound("fail");
}

/** Three quick pips on A5. */
function alert() {
  playSound("alert");
}

/** Low rumble + a beating high ping. */
function crisis() {
  playSound("crisis");
}

/** Ascending arpeggio, D5 → F♯5 → A5. */
function opportunity() {
  playSound("opportunity");
}

/** Soft clock tick. */
function tick() {
  playSound("tick");
}

/** Register ka-ching. */
function cashIn() {
  playSound("cash-in");
}

/** Two-tone alarm, A5 / F5. */
function warning() {
  playSound("warning");
}

/** Tiny UI pop. */
function click() {
  playSound("click");
}

/** Ending-specific game-over sting. */
function gameOver(ending: GameEndSound) {
  const sound: SoundName | undefined = GAME_END_SOUNDS[ending];
  if (sound) playSound(sound);
}

export const SFX = {
  success,
  fail,
  alert,
  crisis,
  opportunity,
  tick,
  gameOver,
  cashIn,
  warning,
  click,
};
