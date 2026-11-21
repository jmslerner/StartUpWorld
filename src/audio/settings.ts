/**
 * Audio settings: typed, persisted, observable. Framework-free.
 *
 *   const s = audioSettings.get();            // immutable snapshot, identity changes only on change
 *   audioSettings.setMaster(0.5);
 *   const off = audioSettings.subscribe(fn);  // React: useSyncExternalStore(audioSettings.subscribe, audioSettings.get)
 *
 * Nothing here touches `localStorage` at import time, and every access is guarded
 * (private mode, sandboxed iframes and quota errors all throw).
 */

export const BUS_NAMES = ["ui", "outcome", "world", "ambience", "music"] as const;
export type BusName = (typeof BUS_NAMES)[number];

export interface AudioSettings {
  /** Global mute. */
  readonly muted: boolean;
  /** Master fader position, 0..1. */
  readonly master: number;
  /** Per-bus fader positions, 0..1. */
  readonly volumes: Readonly<Record<BusName, number>>;
  /** Per-bus mutes. */
  readonly busMuted: Readonly<Record<BusName, boolean>>;
  /** Generative background music. Ships OFF. */
  readonly musicEnabled: boolean;
}

export interface AudioSettingsPatch {
  muted?: boolean;
  master?: number;
  volumes?: Partial<Record<BusName, number>>;
  busMuted?: Partial<Record<BusName, boolean>>;
  musicEnabled?: boolean;
}

/**
 * Conservative on purpose: with these the loudest stinger peaks around −12 dBFS and the
 * ambience bed sits near −40 dBFS RMS, i.e. comfortably under a podcast or a call.
 */
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  muted: false,
  master: 0.8,
  volumes: { ui: 0.8, outcome: 0.8, world: 0.8, ambience: 0.7, music: 0.6 },
  busMuted: { ui: false, outcome: false, world: false, ambience: false, music: false },
  musicEnabled: false,
};

export const SETTINGS_KEY = "startupworld:audio:v1";
/** Pre-existing flag: "0" switches every sound off. Still honoured (and kept in sync with `muted`). */
export const LEGACY_MASTER_KEY = "startupworld:sfx:master";

/** How long a read of the legacy flag is trusted before `localStorage` is consulted again. */
const LEGACY_CACHE_MS = 1000;

/** Fader position (0..1) → linear gain. Squared taper: the top half of the slider is the useful half. */
export const volumeToGain = (volume: number): number => {
  const v = clamp01(volume);
  return v * v;
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AudioSettingsStore {
  /** Current settings. Same object until something changes. */
  get(): AudioSettings;
  subscribe(listener: () => void): () => void;
  update(patch: AudioSettingsPatch): void;
  setMuted(muted: boolean): void;
  toggleMuted(): void;
  setMaster(volume: number): void;
  setVolume(bus: BusName, volume: number): void;
  setBusMuted(bus: BusName, muted: boolean): void;
  setMusicEnabled(enabled: boolean): void;
  reset(): void;
  /** True when nothing may sound: muted here, or the legacy flag is "0". */
  isSilenced(): boolean;
  /** Linear gain for the master fader (0 when silenced). */
  masterGain(): number;
  /** Linear gain for a bus fader (0 when that bus is muted). */
  busGain(bus: BusName): number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const readNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? clamp01(value) : fallback;

const readBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

/** Tolerant parse: anything missing or malformed falls back to the default for that field. */
export const parseAudioSettings = (raw: string | null): AudioSettings => {
  if (!raw) return DEFAULT_AUDIO_SETTINGS;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
  if (!isRecord(data)) return DEFAULT_AUDIO_SETTINGS;
  const d = DEFAULT_AUDIO_SETTINGS;
  const rawVolumes = isRecord(data.volumes) ? data.volumes : {};
  const rawMutes = isRecord(data.busMuted) ? data.busMuted : {};
  const volumes = { ...d.volumes };
  const busMuted = { ...d.busMuted };
  for (const bus of BUS_NAMES) {
    volumes[bus] = readNumber(rawVolumes[bus], d.volumes[bus]);
    busMuted[bus] = readBoolean(rawMutes[bus], d.busMuted[bus]);
  }
  return {
    muted: readBoolean(data.muted, d.muted),
    master: readNumber(data.master, d.master),
    volumes,
    busMuted,
    musicEnabled: readBoolean(data.musicEnabled, d.musicEnabled),
  };
};

const resolveDefaultStorage = (): StorageLike | null => {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    // Reading the property itself throws in some sandboxes.
    return null;
  }
};

const defaultClock = (): number => {
  try {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  } catch {
    return 0;
  }
};

/**
 * @param storage  `undefined` → `window.localStorage` (resolved lazily); `null` → in-memory only.
 * @param clock    Milliseconds; only used to rate-limit reads of the legacy flag.
 */
export const createAudioSettingsStore = (
  storage?: StorageLike | null,
  clock: () => number = defaultClock,
): AudioSettingsStore => {
  let current: AudioSettings | null = null;
  let resolved: StorageLike | null | undefined = storage;
  let legacyOff = false;
  let legacyReadAt = Number.NEGATIVE_INFINITY;
  const listeners = new Set<() => void>();

  const store = (): StorageLike | null => {
    if (resolved === undefined) resolved = resolveDefaultStorage();
    return resolved;
  };

  const readItem = (key: string): string | null => {
    try {
      return store()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };

  const writeItem = (key: string, value: string): void => {
    try {
      store()?.setItem(key, value);
    } catch {
      // Quota exceeded / private browsing: settings simply do not persist.
    }
  };

  const refreshLegacy = (force: boolean): boolean => {
    const now = clock();
    if (force || now - legacyReadAt >= LEGACY_CACHE_MS) {
      legacyReadAt = now;
      legacyOff = readItem(LEGACY_MASTER_KEY) === "0";
    }
    return legacyOff;
  };

  const load = (): AudioSettings => {
    if (current === null) {
      const parsed = parseAudioSettings(readItem(SETTINGS_KEY));
      current = refreshLegacy(true) && !parsed.muted ? { ...parsed, muted: true } : parsed;
    }
    return current;
  };

  const commit = (next: AudioSettings): void => {
    const prev = load();
    current = next;
    writeItem(SETTINGS_KEY, JSON.stringify(next));
    if (next.muted !== prev.muted || (legacyOff && !next.muted)) {
      // Keep the old flag truthful so un-muting here really un-mutes.
      writeItem(LEGACY_MASTER_KEY, next.muted ? "0" : "1");
      legacyOff = next.muted;
      legacyReadAt = clock();
    }
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A broken subscriber must not break audio or other subscribers.
      }
    }
  };

  const update = (patch: AudioSettingsPatch): void => {
    const prev = load();
    const volumes = { ...prev.volumes };
    const busMuted = { ...prev.busMuted };
    for (const bus of BUS_NAMES) {
      const v = patch.volumes?.[bus];
      if (v !== undefined) volumes[bus] = clamp01(v);
      const m = patch.busMuted?.[bus];
      if (m !== undefined) busMuted[bus] = m;
    }
    const next: AudioSettings = {
      muted: patch.muted ?? prev.muted,
      master: patch.master !== undefined ? clamp01(patch.master) : prev.master,
      volumes,
      busMuted,
      musicEnabled: patch.musicEnabled ?? prev.musicEnabled,
    };
    const same =
      next.muted === prev.muted &&
      next.master === prev.master &&
      next.musicEnabled === prev.musicEnabled &&
      BUS_NAMES.every((bus) => volumes[bus] === prev.volumes[bus] && busMuted[bus] === prev.busMuted[bus]);
    // Un-muting must also clear a legacy "0", even if `muted` was already false here.
    if (same && !(patch.muted === false && refreshLegacy(true))) return;
    commit(next);
  };

  const isSilenced = (): boolean => load().muted || refreshLegacy(false);

  return {
    get: load,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    setMuted: (muted) => update({ muted }),
    toggleMuted: () => update({ muted: !isSilenced() }),
    setMaster: (volume) => update({ master: volume }),
    setVolume: (bus, volume) => update({ volumes: { [bus]: volume } }),
    setBusMuted: (bus, muted) => update({ busMuted: { [bus]: muted } }),
    setMusicEnabled: (enabled) => update({ musicEnabled: enabled }),
    reset: () => commit(DEFAULT_AUDIO_SETTINGS),
    isSilenced,
    masterGain: () => (isSilenced() ? 0 : volumeToGain(load().master)),
    busGain: (bus) => (load().busMuted[bus] ? 0 : volumeToGain(load().volumes[bus])),
  };
};

/** The app-wide settings (backed by `localStorage`, read on first use). */
export const audioSettings: AudioSettingsStore = createAudioSettingsStore();
