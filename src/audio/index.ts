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
 *   buses: ui · outcome (the SFX stingers) · world (diegetic office events) · ambience · music
 *   each bus → fader (+ reverb send) → master fader → DC block → warmth shelf → limiter → out
 *   Settings (mute, master, per-bus volume/mute, music on/off) persist in localStorage under
 *   "startupworld:audio:v1"; the old "startupworld:sfx:master" = "0" flag still silences all.
 *
 * ── 1. Outcome stingers (already wired) ──────────────────────────────────────
 *   `SFX` in src/ui/sound.ts keeps its API (`SFX.success()` … `SFX.gameOver(ending)`) and now
 *   plays through this engine. `useGameStore` needs no change.
 *
 * ── 2. The 3D world ──────────────────────────────────────────────────────────
 *   import { createWorldAudio } from "./audio";
 *
 *   const audio = createWorldAudio();              // uses the shared engine; create once per world mount
 *                                                  //   ({ omit: ["footsteps", "chair-sit"] } if the world
 *                                                  //   will play those itself, in sync, via audio.play)
 *   audio.setSnapshot(snapshot);                   // on EVERY game-state change (drives ambience, music mood,
 *                                                  //   the low-runway heartbeat)
 *   audio.handleEvents(events, snapshot);          // the WorldEvent[] from deriveWorldEvents(prev, next, action)
 *                                                  //   → the diegetic layer (never a second stinger; see the
 *                                                  //   matrix at the top of worldAudio.ts). Where the store
 *                                                  //   answers with a stinger, the room plays 6 dB under it.
 *   audio.ui.hover();                              // pointer moves onto an interactable
 *   audio.ui.select();                             // click that selects WITHOUT opening a card
 *   audio.ui.open();   audio.ui.close();           // inspector card opens / closes (a click that opens a card
 *                                                  //   calls open() only; if both arrive within 80 ms only the
 *                                                  //   first sounds)
 *   audio.ui.press();  audio.ui.prefill();         // action button that runs / prefills a command
 *   audio.ui.denied();                             // disabled action
 *   audio.ui.toggle(on); audio.ui.zoom(+1 | -1);   // switches, zoom steps
 *   audio.setDusk(0..1);                           // lighting hint (optional: defaults to 1 − ap / maxAp)
 *   audio.setWorldVisible(false);                  // 3D view hidden → no diegetic sounds, ambience fades out
 *   audio.play("bubble-pop", { pan: 0.2 });        // any library sound, for moments only the world knows
 *                                                  //   (a bubble popping, a real footstep, a chair)
 *   audio.dispose();                               // on unmount: queued world sounds are dropped, playing ones
 *                                                  //   fade in 0.15 s, the bed fades out; the shared engine
 *                                                  //   itself stays alive
 *
 *   The low-runway heartbeat (runway ≤ LOW_RUNWAY_WEEKS) comes in bursts — HEARTBEAT.onset beats
 *   when the runway turns short, a few more at each new week or further drop, then silence; never
 *   while an event card is open.
 *
 *   React: create it in an effect and dispose it in the cleanup (StrictMode-safe):
 *     useEffect(() => { const audio = createWorldAudio(); ref.current = audio; return () => audio.dispose(); }, []);
 *
 * ── 3. The sound menu ────────────────────────────────────────────────────────
 *   import { SoundMenu } from "./ui/components/SoundMenu";   // <SoundMenu /> — props: className?, align?: "left" | "right"
 *   Self-contained popover (mute, master, ambience, music toggle); drop it into the HUD bar's button group.
 *   For custom UI: `audioSettings` + `useSyncExternalStore(audioSettings.subscribe, audioSettings.get)`.
 *
 * ── 4. The terminal's typing clicks (wired) ─────────────────────────────────
 *   src/ui/terminal/TerminalInput.tsx plays `playSound("ui-key")` on this engine (its own
 *   "startupworld:sfx:typing" toggle and shouldSoundForKey filter still apply), so the Sound
 *   menu's mute and Master fader reach the most frequent sound in the game, and the app runs a
 *   single AudioContext: engine.ts is the only place in src/ that constructs one (plus the
 *   lab's offline / sink-less renders under dev/).
 *
 * ── 5. Anything else ─────────────────────────────────────────────────────────
 *   playSound("positive-small");                   // one-off sounds on the shared engine (never throws)
 *   getAudioEngine().unlock();                     // optional: call inside a click handler to start audio at once
 *   SOUND_NAMES / SOUNDS                           // the whole library with its metadata
 *   ambienceTargets(state)                         // the pure game-state → ambience mapping
 *
 * ── 6. The lab (dev only) ────────────────────────────────────────────────────
 *   /audio-lab — every sound with a play button, waveform, spectrogram and measurements; the mixer;
 *   live ambience/music controls; a WorldEvent bench (optionally with the store's stinger); the
 *   store-stinger + world-layer pairs rendered together (?only=pairs); `window.__audioLab` for
 *   headless checks: metrics(), failures(), gains(), renderAmbience(state, s), ambienceStates(),
 *   ambienceMatrix(), pairLabels(), pairs(), renderMusic(), limiter(), live(), liveLevel().
 *   Every sound reports peak AND K-weighted loudness (LUFS-M); every bed its waveform-loop
 *   correlation and 1/3-octave colour; every pair its peak lead and loudness lead.
 *   Route it like any lazy dev page:
 *     const AudioLab = import.meta.env.DEV ? lazy(() => import("./audio/dev/AudioLab.tsx")) : null;
 */

export { AudioEngine, BUS_VOICE_CAP, LIMITER, getAudioEngine, isActivatingInput, playSound, setSharedAudioEngine } from "./engine";
export type { AudioEngineOptions, BusTap, EngineEnv, EngineState, VoiceHandle } from "./engine";

export { BUS_NAMES, DEFAULT_AUDIO_SETTINGS, LEGACY_MASTER_KEY, SETTINGS_KEY, audioSettings, createAudioSettingsStore, volumeToGain } from "./settings";
export type { AudioSettings, AudioSettingsPatch, AudioSettingsStore, BusName } from "./settings";

export { SOUNDS, SOUND_NAMES, isSoundName, soundsOnBus } from "./sounds";
export type { PlayOptions, SoundDef, SoundKind, SoundName } from "./sounds";

export { AmbienceDirector, DEFAULT_AMBIENCE_STATE, ambienceTargets } from "./ambience";
export type { AmbienceState, AmbienceTargets } from "./ambience";

export { MusicDirector, MusicPlanner } from "./music";
export type { MusicEvent, MusicMood } from "./music";
