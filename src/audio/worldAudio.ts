/**
 * Glue between the 3D world and the sound library.
 *
 *   const audio = createWorldAudio();
 *   audio.setSnapshot(snapshot);            // every game-state change
 *   audio.handleEvents(events, snapshot);   // WorldEvent[] → diegetic sounds
 *   audio.ui.hover();                       // …select / open / close / press / prefill / denied / toggle / zoom
 *   audio.setDusk(0.6); audio.setWorldVisible(false); audio.dispose();
 *   audio.play("bubble-pop");               // anything else, at a moment only the world knows
 *
 * ── The "no double hits" matrix ──────────────────────────────────────────────
 * The store (src/state/useGameStore.ts) already plays ONE outcome stinger per command through
 * the `SFX` facade. The world layer must only ever add a complementary, diegetic layer to the
 * same moment — what the room sounds like — never a second stinger.
 *
 *   WorldEvent        store stinger at that moment          world layer (this file)
 *   ───────────────   ───────────────────────────────────   ──────────────────────────────────────────
 *   run-reset         —                                      silence (world voices stop)
 *   setup-completed   —                                      lights + hum, door, cofounder's steps, chair
 *   week-advanced     tick                                   night hush → morning chime (chime at 1.1 s);
 *                                                            none when the office is rebuilt in the same batch
 *   hired             success (via `hire`)                   door, door bell, footsteps, door closes, chair
 *   departed          tick / event stinger (sometimes)       footsteps away, sad little door
 *   ship ok | fail    success | fail                         keyboard flurry → whoosh + glints | fizzle + deflate + puff
 *   launch ok | fail  success | fail                         megaphone + crowd | wind, slow clap, cricket
 *   pitch ok | fail   success | fail                         one ring, picked up → "wah-WAH" | "wah… wah—" click
 *   raise ok | fail   cash-in (the bell) | fail              drawer + coins (+ notes, confetti) | clunk + dial tone
 *   board-action      success | fail                         dinner clink / gift wrap / blackmail pizzicato (+ puff)
 *   pricing-changed   warning                                the pricing board's flaps
 *   cash-changed      tick / cash-in / warning (sometimes)   notes flutter | coins leave   (silent when the batch already
 *                                                            tells the money's story: a week, a raise, a purchase, a hire,
 *                                                            a launch or a board action — those cost what they cost)
 *   users-changed     tick / … (sometimes)                   users trickle in              (silent with a week or a launch)
 *   phase-changed     tick / success (sometimes)             construction → reveal chord (at 1.25 s) + confetti
 *   stage-changed     cash-in / tick (sometimes)             stamp + desk bell (+ confetti)
 *   asset-acquired    success                                pop-in bounce, then the asset's own flourish
 *   event-opened      alert (not for a chained event)        beacon motif, after the pips
 *   event-resolved    cash-in / warning / success (sometimes) dominant → tonic, paperwork filed
 *   easter-egg        —                                      `coffee`: steps, pour, sip, sigh; the rest: silence
 *   command-failed    —                                      the UI "denied" thud (the only sound a refusal gets)
 *   game-over         gameOver(ending) at +200 ms            win: confetti + cheering (no pitch);
 *                                                            loss: power-down + smoke, once the sting has finished
 *
 * Rules that make this hold (tested in worldAudio.test.ts):
 *   1. The world layer never plays a stinger (nothing from the `outcome` bus).
 *   2. Where a store stinger can coincide, nothing pitched in the world layer is heard during
 *      the first STINGER_CLEARANCE seconds — only noise, steps, doors, keys.
 *   3. Under the game-over sting the world layer is entirely unpitched — including whatever
 *      else arrived in the same batch (the final week, departures…). A loss's own power-down
 *      (its hum drains through the sting's low notes) waits until the sting has rung out.
 *   4. Batches the store answers with several stingers at once (week end + event: tick + alert;
 *      raise + stage change: cash-in) obey 2 for every one of them. The audio lab renders these
 *      pairs together through one limiter (src/audio/dev/labPairs.ts).
 *   5. Loudness: where the store answers with a real stinger (a command's result, an event's
 *      alert, the game-over sting), the world layer is a supporting layer and plays
 *      SUPPORT_GAIN down (−6 dB), so the stinger stays the loudest thing in the moment (the lab
 *      checks the K-weighted momentary loudness of every pair).
 *      The sounds themselves stay calibrated for use on their own through `play()`.
 */
import type { AssetId, EndingType } from "../types/game";
import type { WorldEvent, WorldEventType, WorldSnapshot } from "../world/types";
import { AmbienceDirector, type AmbienceState } from "./ambience";
import { getAudioEngine, type AudioEngine } from "./engine";
import { MusicDirector } from "./music";
import { SOUNDS, type PlayOptions, type SoundName } from "./sounds";
import { clamp } from "./synth";

// ─────────────────────────────────────────────────────────────────────────────
// The matrix, as data
// ─────────────────────────────────────────────────────────────────────────────

/** Methods of the `SFX` facade the store calls. */
export type StoreStinger = "success" | "fail" | "cashIn" | "warning" | "tick" | "alert" | "gameOver";

export interface StingerOverlap {
  /** Does the store play a stinger at the moment of this event? */
  when: "always" | "sometimes" | "never";
  which: readonly StoreStinger[];
}

export const STORE_STINGERS: Record<WorldEventType, StingerOverlap> = {
  "run-reset": { when: "never", which: [] },
  "setup-completed": { when: "never", which: [] },
  "week-advanced": { when: "always", which: ["tick"] },
  hired: { when: "sometimes", which: ["success", "tick"] },
  departed: { when: "sometimes", which: ["tick", "warning"] },
  ship: { when: "always", which: ["success", "fail"] },
  launch: { when: "always", which: ["success", "fail"] },
  pitch: { when: "always", which: ["success", "fail"] },
  raise: { when: "always", which: ["cashIn", "fail"] },
  "board-action": { when: "always", which: ["success", "fail"] },
  "pricing-changed": { when: "always", which: ["warning"] },
  "cash-changed": { when: "sometimes", which: ["tick", "cashIn", "warning", "success"] },
  "users-changed": { when: "sometimes", which: ["tick", "success", "warning"] },
  "phase-changed": { when: "sometimes", which: ["tick", "success", "cashIn"] },
  "stage-changed": { when: "sometimes", which: ["cashIn", "tick"] },
  "asset-acquired": { when: "always", which: ["success"] },
  // The store plays `alert` only when an event opens with none open before it: a chained event
  // (one resolved, the next opened in the same step) gets no alert.
  "event-opened": { when: "sometimes", which: ["alert"] },
  "event-resolved": { when: "sometimes", which: ["cashIn", "warning", "success"] },
  "easter-egg": { when: "never", which: [] },
  "command-failed": { when: "never", which: [] },
  "game-over": { when: "always", which: ["gameOver"] },
};

/** Seconds after an event during which the world layer stays unpitched if a stinger may be playing. */
export const STINGER_CLEARANCE = 0.25;
/** Runway at or below this many weeks starts the heartbeat. */
export const LOW_RUNWAY_WEEKS = 4;
/** At most this many cues are scheduled for one batch of events. */
export const MAX_CUES_PER_BATCH = 16;
/**
 * Level of the world layer for events the store always answers with a real stinger (rule 5):
 * the room supports the stinger, it does not compete with it.
 */
export const SUPPORT_GAIN = 0.5;
/** Events whose world layer plays at SUPPORT_GAIN. (The week's `tick` is a click, not a stinger.) */
export const SUPPORTING_EVENTS: ReadonlySet<WorldEventType> = new Set<WorldEventType>([
  "hired",
  "ship",
  "launch",
  "pitch",
  "raise",
  "board-action",
  "pricing-changed",
  "asset-acquired",
  "event-opened",
  "game-over",
]);
/** When the store's game-over sting starts, after the command. */
export const STING_DELAY = 0.2;
/**
 * Seconds after the sting starts by which its pitched part has finished, per ending (read off
 * the recipes in sounds.ts; the lab's pair renders confirm nothing masks it). A loss's own
 * world layer waits for this.
 */
export const STING_LENGTH: Record<EndingType, number> = {
  ipo: 1.05,
  acquisition: 1.15,
  "ai-hype-exit": 0.9,
  bankruptcy: 1.2,
  "founder-removal": 1.2,
  "zombie-saas": 1.3,
  "forced-acquisition": 1.4,
};

// ─────────────────────────────────────────────────────────────────────────────
// WorldEvent → cues (pure)
// ─────────────────────────────────────────────────────────────────────────────

export interface Cue {
  sound: SoundName;
  /** Seconds after the event. */
  delay: number;
  options?: PlayOptions;
  /** The event this cue belongs to (set by planCues). */
  event?: WorldEventType;
}

// Rough stage positions. The integrator can pass real ones through `play()`.
const DOOR_PAN = -0.35;
const PHONE_PAN = 0.3;
const COFFEE_PAN = -0.2;
const SERVER_PAN = 0.3;

const ASSET_SOUND: Record<AssetId, SoundName> = {
  "office-upgrade": "asset-office-upgrade",
  lounge: "asset-lounge",
  helicopter: "asset-helicopter",
  jet: "asset-jet",
  yacht: "asset-yacht",
};

const BOARD_SOUND: Record<Extract<WorldEvent, { type: "board-action" }>["action"], SoundName> = {
  dinner: "board-dinner",
  gift: "board-gift",
  blackmail: "board-blackmail",
};

const HAPPY_ENDING: Record<EndingType, boolean> = {
  ipo: true,
  acquisition: true,
  "ai-hype-exit": true,
  bankruptcy: false,
  "founder-removal": false,
  "zombie-saas": false,
  "forced-acquisition": false,
};

const cue = (sound: SoundName, delay: number, options?: PlayOptions): Cue => ({ sound, delay, options });

/** A stable seat position for a person id, so the same hire always sits in the same place. */
const seatPan = (personId: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < personId.length; i += 1) hash = Math.imul(hash ^ personId.charCodeAt(i), 16777619);
  return (((hash >>> 0) % 9) - 4) * 0.1;
};

/**
 * The cues for one event. `batch` is every event that arrived with it (so a week's routine
 * burn is not announced on top of the week itself); `ordinal` is this event's index among the
 * events of its own type in the batch (the second role hired does not open the door again).
 */
export const cuesForEvent = (event: WorldEvent, batch: readonly WorldEvent[] = [event], ordinal = 0): Cue[] => {
  const inWeek = batch.some((e) => e.type === "week-advanced");
  const raised = batch.some((e) => e.type === "raise" && e.ok);
  const rebuilt = batch.some((e) => e.type === "phase-changed");
  const bought = batch.some((e) => e.type === "asset-acquired");
  const launched = batch.some((e) => e.type === "launch");
  // Commands whose cost is the cash change: the money is already part of their story.
  const paidFor = batch.some((e) => e.type === "hired" || e.type === "launch" || e.type === "board-action");

  switch (event.type) {
    case "run-reset":
      return []; // intentionally silent — a fresh page

    case "setup-completed":
      return [
        cue("setup-complete", 0),
        cue("door-open", 0.4, { pan: DOOR_PAN }),
        cue("footsteps", 0.65, { steps: 4, approach: 1, pan: DOOR_PAN, panTo: 0.05 }),
        cue("chair-sit", 2, { pan: 0.05 }),
      ];

    case "week-advanced":
      // A new office is the bigger news: its construction + reveal replaces the sunrise chime
      // (two pitched reveals a beat apart only blur each other; the store's tick marks the week).
      if (rebuilt) return [];
      return [cue("week-advance", 0, { variant: event.week })];

    case "hired": {
      const cues: Cue[] = [];
      const walkers = (event.personIds ?? []).slice(0, 3);
      if (ordinal === 0) {
        cues.push(
          cue("door-open", 0.05, { pan: DOOR_PAN }),
          cue("hire-arrival", 0.3, { pan: DOOR_PAN }),
          // …and it swings shut behind the last of them.
          cue("door-close", 1.05 + Math.max(0, walkers.length - 1) * 0.4, { pan: DOOR_PAN, gain: 0.8 }),
        );
      }
      // Up to three pairs of feet are worth hearing; a bigger hiring spree is a crowd anyway.
      walkers.forEach((personId, i) => {
        const at = 0.45 + ordinal * 0.55 + i * 0.4;
        const seat = seatPan(personId);
        cues.push(cue("footsteps", at, { steps: 4, approach: 1, pan: DOOR_PAN, panTo: seat }), cue("chair-sit", at + 1.35, { pan: seat }));
      });
      return cues;
    }

    case "departed": {
      const cues = [cue("footsteps", 0.1 + ordinal * 0.5, { steps: 3, approach: -1, pan: 0, panTo: DOOR_PAN })];
      if (ordinal === 0) cues.push(cue("departure", 1.05, { pan: DOOR_PAN }));
      return cues;
    }

    case "ship":
      return event.ok
        ? [cue("keyboard-flurry", 0, { intensity: 0.6 }), cue("ship-ok", 0.3)]
        : [cue("keyboard-flurry", 0, { intensity: 0.35 }), cue("ship-fail", 0.28), cue("smoke-puff", 0.52)];

    case "launch":
      if (!event.ok) return [cue("launch-fail", 0.3)];
      return event.usersDelta > 0 ? [cue("launch-ok", 0.25), cue("users-trickle", 1.15, { pan: SERVER_PAN })] : [cue("launch-ok", 0.25)];

    case "pitch":
      // One ring, picked up, and the answer — the call is over in about a second and a half.
      return [cue("phone-ring", 0.25, { pan: PHONE_PAN }), cue(event.ok ? "pitch-ok" : "pitch-fail", 0.8, { pan: PHONE_PAN })];

    case "raise": {
      if (!event.ok) return [cue("raise-fail", 0.3, { pan: PHONE_PAN })];
      // $1k → a few coins, $10M → the full cascade.
      const intensity = clamp((Math.log10(Math.max(1000, event.amount)) - 3) / 4, 0, 1);
      // The drawer opens once the store's ka-CHING has rung out (measured in the lab: any
      // earlier and the drawer's thump is as loud as the bell while the bell is speaking).
      const cues = [cue("raise-ok", 0.28, { intensity }), cue("money-flutter", 0.7)];
      if (event.source === "vc") cues.push(cue("confetti-pops", 0.9, { intensity }));
      return cues;
    }

    case "board-action": {
      const sound = BOARD_SOUND[event.action];
      return event.ok ? [cue(sound, 0.2)] : [cue(sound, 0.2), cue("smoke-puff", 0.8)];
    }

    case "pricing-changed":
      return [cue("pricing-flip", 0.12)];

    case "cash-changed":
      // The weekly burn is routine; the week's own cue already marks the moment. A raise's
      // coins, an asset's flourish, a hire, a launch or a board dinner already tell the story of
      // the money too (it is simply their price).
      if (inWeek || raised || bought || paidFor) return [];
      return [cue(event.delta > 0 ? "money-flutter" : "coins-out", 0.35)];

    case "users-changed":
      if (inWeek || launched || event.delta <= 0) return [];
      return [cue("users-trickle", 0.4, { pan: SERVER_PAN })];

    case "phase-changed":
      return [cue("phase-change", 0.1), cue("confetti-pops", 1.35, { intensity: 1 })];

    case "stage-changed": {
      // After the coins have landed, if this came with a raise.
      const at = raised ? 1.5 : 0.3;
      const cues = [cue("stage-change", at)];
      if (!raised && !rebuilt) cues.push(cue("confetti-pops", at + 0.3, { intensity: 0.4 }));
      return cues;
    }

    case "asset-acquired":
      return [cue("asset-acquired", 0.3 + ordinal * 0.9), cue(ASSET_SOUND[event.assetId], 0.75 + ordinal * 0.9)];

    case "event-opened":
      // After the store's three alert pips — and after the sunrise, if the week just turned.
      return [cue("event-beacon", inWeek ? 1.8 : 0.5)];

    case "event-resolved":
      // After whatever the store answers the choice with (a warning's four pips last 0.4 s).
      return [cue("event-resolved", 0.45)];

    case "easter-egg":
      if (event.command !== "coffee") return []; // intentionally silent — the joke is in the terminal
      return [cue("footsteps", 0, { steps: 3, pan: 0.1, panTo: COFFEE_PAN }), cue("coffee", 1, { pan: COFFEE_PAN })];

    case "command-failed":
      return [cue("ui-denied", 0)];

    case "game-over": {
      if (HAPPY_ENDING[event.ending]) return [cue("confetti-pops", 0.5, { intensity: 1 }), cue("crowd-cheer", 0.7)];
      // The breaker trips once the sting has said its piece: the power-down's draining hum sits
      // right where the sting's low notes are and would bury them.
      const after = STING_DELAY + STING_LENGTH[event.ending];
      return [cue("power-down", after), cue("smoke-puff", after + 0.4)];
    }

    default: {
      // Exhaustive at compile time (a new event type fails the build here); at run time an
      // unknown event from a newer world layer is simply silent rather than an exception
      // thrown into the store subscription that delivered it.
      const unhandled: never = event;
      void unhandled;
      return [];
    }
  }
};

/** cuesForEvent, at the level the matrix asks for (rule 5: supporting layers sit under the stinger). */
const leveledCues = (event: WorldEvent, batch: readonly WorldEvent[], ordinal: number): Cue[] => {
  const own = cuesForEvent(event, batch, ordinal);
  if (!SUPPORTING_EVENTS.has(event.type)) return own;
  return own.map((c) => ({ ...c, options: { ...c.options, gain: (c.options?.gain ?? 1) * SUPPORT_GAIN } }));
};

/**
 * Every cue for a batch of events, in time order. `run-reset` silences the batch. When the
 * run ends in this batch (a final `end` brings the week, the departures and the game-over
 * together) only the unpitched part of the other events survives: the game-over sting owns
 * the next 1.6 s, and a sunrise chime has no business under a bankruptcy.
 */
export const planCues = (events: readonly WorldEvent[]): Cue[] => {
  if (events.some((event) => event.type === "run-reset")) return [];
  const ending = events.some((event) => event.type === "game-over");
  const seen = new Map<WorldEventType, number>();
  const cues: Cue[] = [];
  for (const event of events) {
    const ordinal = seen.get(event.type) ?? 0;
    seen.set(event.type, ordinal + 1);
    const own = leveledCues(event, events, ordinal).map((c) => ({ ...c, event: event.type }));
    cues.push(...(ending && event.type !== "game-over" ? own.filter((c) => SOUNDS[c.sound].tonalAt === undefined) : own));
  }
  cues.sort((a, b) => a.delay - b.delay);
  return cues.slice(0, MAX_CUES_PER_BATCH);
};

/** Seconds after the event at which a cue's first pitched element sounds; null if it has none. */
export const tonalOnset = (c: Cue): number | null => {
  const at = SOUNDS[c.sound].tonalAt;
  return at === undefined ? null : c.delay + at;
};

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot → ambience state (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** `dusk` null = derive it from action points (full AP = morning, none left = dusk). */
export const ambienceStateFor = (snapshot: WorldSnapshot, dusk: number | null, worldVisible: boolean): AmbienceState => ({
  phase: snapshot.phase,
  teamSize: snapshot.teamSize,
  morale: snapshot.morale,
  stress: snapshot.stress,
  dusk: clamp(dusk ?? 1 - snapshot.ap / Math.max(1, snapshot.maxAp), 0, 1),
  runwayLow: snapshot.runwayWeeks <= LOW_RUNWAY_WEEKS,
  pendingEvent: snapshot.pendingEventTitle !== null,
  gameOver: snapshot.gameOver !== null,
  setupComplete: snapshot.setupComplete,
  worldVisible,
});

// ─────────────────────────────────────────────────────────────────────────────
// The object the integrator holds
// ─────────────────────────────────────────────────────────────────────────────

export interface WorldUiSounds {
  /** Pointer moved onto something clickable. */
  hover(): void;
  /**
   * Something was selected (clicked) and NO card opened for it. When a click opens an inspector
   * card call `open()` instead — never both (if both arrive within 80 ms only the first sounds).
   */
  select(): void;
  /** An inspector card opened / closed. */
  open(): void;
  close(): void;
  /** A button that runs a command was pressed. */
  press(): void;
  /** A command was prefilled into the terminal: "your turn to type". */
  prefill(): void;
  /** A disabled action was clicked. */
  denied(): void;
  /** A switch flipped (3D view, settings…). */
  toggle(on: boolean): void;
  /** One zoom step; +1 in, −1 out. */
  zoom(direction: number): void;
}

export interface WorldAudio {
  /** Call on every game-state change: drives the ambience, the music mood and the low-runway heartbeat. */
  setSnapshot(snapshot: WorldSnapshot): void;
  /** Call with the WorldEvent[] derived for a state change: plays the diegetic layer for them. */
  handleEvents(events: readonly WorldEvent[], snapshot: WorldSnapshot): void;
  readonly ui: WorldUiSounds;
  /** Lighting hint, 0 (morning) … 1 (dusk). Until first called, dusk follows action points. */
  setDusk(dusk: number): void;
  /** 3D view shown / hidden. Hidden: no diegetic sounds, the ambience fades out. */
  setWorldVisible(visible: boolean): void;
  /** Play any library sound directly (exact footsteps, bubble pops, a chair creak…). */
  play(name: SoundName, options?: PlayOptions): void;
  dispose(): void;
}

export interface WorldAudioOptions {
  /** Defaults to the shared engine. */
  engine?: AudioEngine;
  /** Random source for the generative layers (tests). */
  rand?: () => number;
  /**
   * Sounds `handleEvents` should leave out because the world plays them itself, at the exact
   * moment, through `play()` — e.g. `["footsteps", "chair-sit"]` once the characters report
   * their own steps. (By default handleEvents times these by rule of thumb.)
   */
  omit?: readonly SoundName[];
}

/**
 * The low-runway heartbeat comes in bursts, not as a loop: a few beats when the runway first
 * drops to LOW_RUNWAY_WEEKS or below, a short reminder at each new week (or further drop) while
 * it stays there, then silence. It never beats while an event card is open.
 */
export const HEARTBEAT = {
  /** Beats when the runway first turns low. */
  onset: 6,
  /** Beats at each new week while it stays low. */
  weekly: 3,
  /** Beats when it gets worse (fewer weeks left than before). */
  worse: 4,
  /** Mean seconds between beats, and the random spread around it. */
  periodMs: 2600,
  jitterMs: 160,
  /** First beat after the trigger. */
  leadMs: 800,
} as const;

/** Two clicks on one object within this long are one gesture: select + open play only one blip. */
const UI_PAIR_MS = 80;

export const createWorldAudio = (options: WorldAudioOptions = {}): WorldAudio => {
  const engine = options.engine ?? getAudioEngine();
  const rand = options.rand ?? Math.random;
  const omitted = new Set<SoundName>(options.omit ?? []);
  const ambience = new AmbienceDirector(engine, { rand: options.rand });
  const music = new MusicDirector(engine, { rand: options.rand });

  let snapshot: WorldSnapshot | null = null;
  let dusk: number | null = null;
  let visible = true;
  let disposed = false;
  let alarmTimer: ReturnType<typeof setTimeout> | null = null;
  /** Beats still to play in the current burst, and how many the burst has played. */
  let beatsLeft = 0;
  let burstBeat = 0;
  let wasLow = false;
  let lastUiPair = Number.NEGATIVE_INFINITY;

  /** Never let an audio problem reach the caller (the store's subscription, a click handler). */
  const guard = (fn: () => void): void => {
    try {
      fn();
    } catch {
      // Audio is a garnish: a failure here must never break the game.
    }
  };

  const play = (name: SoundName, playOptions?: PlayOptions): void => {
    if (disposed) return;
    if (!visible && SOUNDS[name]?.kind === "diegetic") return;
    engine.play(name, playOptions);
  };

  const isLow = (): boolean => snapshot !== null && snapshot.setupComplete && snapshot.gameOver === null && snapshot.runwayWeeks <= LOW_RUNWAY_WEEKS;

  const stopAlarm = (): void => {
    if (alarmTimer !== null) clearTimeout(alarmTimer);
    alarmTimer = null;
  };

  const alarmWanted = (): boolean =>
    !disposed && visible && beatsLeft > 0 && isLow() && snapshot?.pendingEventTitle === null && engine.isAudible("world");

  // Each burst starts at full level and eases off; a weekly reminder is quieter than the onset.
  const beat = (): void => {
    alarmTimer = null;
    if (!alarmWanted()) {
      stopAlarm();
      return;
    }
    engine.play("alarm-pulse", { gain: Math.max(0.5, 0.88 ** burstBeat) });
    burstBeat += 1;
    beatsLeft -= 1;
    if (beatsLeft > 0) alarmTimer = setTimeout(beat, HEARTBEAT.periodMs + (rand() * 2 - 1) * HEARTBEAT.jitterMs);
  };

  const syncAlarm = (): void => {
    if (!alarmWanted()) {
      stopAlarm();
      return;
    }
    if (alarmTimer === null) alarmTimer = setTimeout(beat, HEARTBEAT.leadMs);
  };

  /** Queue (at least) `beats` more beats, starting a burst if none is running. */
  const burst = (beats: number): void => {
    if (beatsLeft <= 0) burstBeat = 0;
    beatsLeft = Math.max(beatsLeft, beats);
  };

  const push = (): void => {
    if (disposed || !snapshot) return;
    ambience.setState(ambienceStateFor(snapshot, dusk, visible));
    music.setMood({ phase: snapshot.phase, stress: snapshot.stress, active: snapshot.setupComplete && snapshot.gameOver === null });
    syncAlarm();
  };

  const unsubscribe = engine.subscribe(() => guard(syncAlarm));

  const applySnapshot = (next: WorldSnapshot): void => {
    const previous = snapshot;
    snapshot = next;
    const low = isLow();
    if (!low) beatsLeft = 0;
    else if (!wasLow) burst(HEARTBEAT.onset);
    else if (previous && next.runwayWeeks < previous.runwayWeeks) burst(HEARTBEAT.worse);
    wasLow = low;
    push();
  };

  const setSnapshot = (next: WorldSnapshot): void => {
    if (disposed) return;
    guard(() => applySnapshot(next));
  };

  const handleEvents = (events: readonly WorldEvent[], next: WorldSnapshot): void => {
    if (disposed) return;
    guard(() => {
      if (next !== snapshot) applySnapshot(next);
      if (!Array.isArray(events) || events.length === 0) return;
      if (events.some((event) => event?.type === "run-reset")) {
        engine.stopAll("world", 0.1);
        beatsLeft = 0;
        stopAlarm();
        return;
      }
      if (events.some((event) => event?.type === "week-advanced") && isLow()) {
        burst(HEARTBEAT.weekly);
        syncAlarm();
      }
      if (!visible) return;
      for (const c of planCues(events)) {
        if (!omitted.has(c.sound)) engine.play(c.sound, { ...c.options, delay: c.delay });
      }
    });
  };

  /** select() and open() for the same click: whichever comes second stays quiet. */
  const pairedUi = (name: SoundName): void => {
    const now = Date.now();
    if (now - lastUiPair < UI_PAIR_MS) return;
    lastUiPair = now;
    play(name);
  };

  return {
    setSnapshot,
    handleEvents,

    ui: {
      hover: () => guard(() => play("ui-hover")),
      select: () => guard(() => pairedUi("ui-select")),
      open: () => guard(() => pairedUi("ui-open")),
      close: () => guard(() => play("ui-close")),
      press: () => guard(() => play("ui-press")),
      prefill: () => guard(() => play("ui-prefill")),
      denied: () => guard(() => play("ui-denied")),
      toggle: (on) => guard(() => play(on ? "ui-toggle-on" : "ui-toggle-off")),
      zoom: (direction) => guard(() => play(direction >= 0 ? "ui-zoom-in" : "ui-zoom-out")),
    },

    setDusk(value) {
      if (disposed) return;
      guard(() => {
        dusk = clamp(Number.isFinite(value) ? value : 0, 0, 1);
        push();
      });
    },

    setWorldVisible(next) {
      if (disposed || next === visible) return;
      guard(() => {
        visible = next;
        if (!visible) engine.stopAll("world", 0.15);
        if (snapshot) push();
        else syncAlarm();
      });
    },

    play: (name, playOptions) => guard(() => play(name, playOptions)),

    dispose() {
      if (disposed) return;
      disposed = true;
      guard(() => {
        unsubscribe();
        stopAlarm();
        // The world is going away (the 3D view unmounts): what it had queued — footsteps, a
        // chime, the next heartbeat — goes with it, and the bed fades rather than cuts.
        engine.stopAll("world", 0.15);
        ambience.dispose();
        music.dispose();
      });
    },
  };
};
