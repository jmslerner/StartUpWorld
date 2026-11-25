/**
 * StartUpWorld audio — public surface.
 *
 * Everything is synthesized with the Web Audio API: no files, no samples, no dependencies.
 * One AudioContext for the whole app, created lazily inside the first input the browser counts
 * as a user activation (a click, a tap, a letter key — not Shift, Esc or Cmd, which would only
 * get a context Chrome refuses to start); every later activation retries resume() until the
 * clock runs. Nothing throws or logs when audio is blocked or missing; importing this in node
 * is safe.
 *
 * ── The mix ──────────────────────────────────────────────────────────────────
 *   each bus → fader (+ reverb send) → master fader → DC block → warmth shelf → limiter → out
 *   The game plays on the `ui` and `outcome` buses. The `world`, `ambience` and `music` buses
 *   and their sounds are still in the library but nothing drives them now.
 *   Settings (mute, master, per-bus volume/mute) persist in localStorage under
 *   "startupworld:audio:v1"; the old "startupworld:sfx:master" = "0" flag still silences all.
 *
 * ── Playing sounds ───────────────────────────────────────────────────────────
 *   `SFX` in src/ui/sound.ts names the game's stingers (`SFX.success()`, `SFX.cashIn()` …).
 *   playSound("positive-small");                   // any library sound, one-off (never throws)
 *   getAudioEngine().unlock();                     // optional: call inside a click handler to start audio at once
 *   SOUND_NAMES / SOUNDS                           // the whole library with its metadata
 *
 * ── The sound menu ───────────────────────────────────────────────────────────
 *   import { SoundMenu } from "./ui/components/SoundMenu";   // <SoundMenu /> — props: className?, align?: "left" | "right"
 *   Self-contained popover (mute, volume). For custom UI: `audioSettings` +
 *   `useSyncExternalStore(audioSettings.subscribe, audioSettings.get)`.
 */

export { AudioEngine, BUS_VOICE_CAP, LIMITER, getAudioEngine, isActivatingInput, playSound, setSharedAudioEngine } from "./engine";
export type { AudioEngineOptions, BusTap, EngineEnv, EngineState, VoiceHandle } from "./engine";

export { BUS_NAMES, DEFAULT_AUDIO_SETTINGS, LEGACY_MASTER_KEY, SETTINGS_KEY, audioSettings, createAudioSettingsStore, volumeToGain } from "./settings";
export type { AudioSettings, AudioSettingsPatch, AudioSettingsStore, BusName } from "./settings";

export { SOUNDS, SOUND_NAMES, isSoundName, soundsOnBus } from "./sounds";
export type { PlayOptions, SoundDef, SoundKind, SoundName } from "./sounds";
