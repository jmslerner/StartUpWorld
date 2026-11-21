import { describe, expect, it, vi } from "vitest";
import {
  BUS_NAMES,
  DEFAULT_AUDIO_SETTINGS,
  LEGACY_MASTER_KEY,
  SETTINGS_KEY,
  createAudioSettingsStore,
  parseAudioSettings,
  volumeToGain,
  type StorageLike,
} from "./settings";
import { MemoryStorage } from "./testing/fakeAudio";

const throwingStorage: StorageLike = {
  getItem() {
    throw new Error("SecurityError: storage is not available");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

describe("audio settings", () => {
  it("starts from conservative defaults with music off", () => {
    const store = createAudioSettingsStore(new MemoryStorage());
    expect(store.get()).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(store.get().musicEnabled).toBe(false);
    expect(store.get().master).toBeLessThan(1);
    expect(store.isSilenced()).toBe(false);
  });

  it("returns the same snapshot until something changes (useSyncExternalStore contract)", () => {
    const store = createAudioSettingsStore(new MemoryStorage());
    const first = store.get();
    expect(store.get()).toBe(first);
    store.setMaster(first.master); // no change
    expect(store.get()).toBe(first);
    store.setMaster(0.3);
    expect(store.get()).not.toBe(first);
    expect(store.get().master).toBe(0.3);
  });

  it("notifies subscribers once per change and stops after unsubscribe", () => {
    const store = createAudioSettingsStore(new MemoryStorage());
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.setVolume("ambience", 0.2);
    store.setVolume("ambience", 0.2);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.setVolume("ambience", 0.9);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a throwing subscriber does not break the others", () => {
    const store = createAudioSettingsStore(new MemoryStorage());
    const good = vi.fn();
    store.subscribe(() => {
      throw new Error("boom");
    });
    store.subscribe(good);
    expect(() => store.setMuted(true)).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("persists and reloads every field", () => {
    const storage = new MemoryStorage();
    const a = createAudioSettingsStore(storage);
    a.update({ master: 0.42, musicEnabled: true, volumes: { world: 0.1, music: 1 }, busMuted: { ui: true } });
    const b = createAudioSettingsStore(storage);
    expect(b.get()).toEqual({
      muted: false,
      master: 0.42,
      volumes: { ...DEFAULT_AUDIO_SETTINGS.volumes, world: 0.1, music: 1 },
      busMuted: { ...DEFAULT_AUDIO_SETTINGS.busMuted, ui: true },
      musicEnabled: true,
    });
    expect(JSON.parse(storage.getItem(SETTINGS_KEY) ?? "{}")).toMatchObject({ master: 0.42 });
  });

  it("clamps volumes and ignores garbage", () => {
    const store = createAudioSettingsStore(new MemoryStorage());
    store.setMaster(7);
    expect(store.get().master).toBe(1);
    store.setVolume("ui", -3);
    expect(store.get().volumes.ui).toBe(0);
    store.setMaster(Number.NaN);
    expect(store.get().master).toBe(0);
  });

  it("parses stored JSON tolerantly", () => {
    expect(parseAudioSettings(null)).toBe(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings("{not json")).toBe(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings("42")).toBe(DEFAULT_AUDIO_SETTINGS);
    const partial = parseAudioSettings(JSON.stringify({ master: 0.5, volumes: { ui: "loud", world: 2 }, muted: "yes" }));
    expect(partial.master).toBe(0.5);
    expect(partial.volumes.ui).toBe(DEFAULT_AUDIO_SETTINGS.volumes.ui);
    expect(partial.volumes.world).toBe(1);
    expect(partial.muted).toBe(false);
    for (const bus of BUS_NAMES) expect(typeof partial.busMuted[bus]).toBe("boolean");
  });

  it("works in memory when localStorage throws on every access", () => {
    const store = createAudioSettingsStore(throwingStorage);
    expect(() => store.get()).not.toThrow();
    expect(store.get()).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(() => store.setMaster(0.25)).not.toThrow();
    expect(() => store.setMuted(true)).not.toThrow();
    expect(() => store.reset()).not.toThrow();
    expect(store.isSilenced()).toBe(false);
    store.setMaster(0.25);
    expect(store.get().master).toBe(0.25);
  });

  it("works with no storage at all (node, SSR)", () => {
    const store = createAudioSettingsStore(null);
    store.setMusicEnabled(true);
    expect(store.get().musicEnabled).toBe(true);
    // The shared store resolves window.localStorage lazily; in node there is none.
    const lazy = createAudioSettingsStore();
    expect(() => lazy.get()).not.toThrow();
    expect(() => lazy.setMaster(0.5)).not.toThrow();
  });

  it('honours the legacy "startupworld:sfx:master" = "0" flag', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_MASTER_KEY, "0");
    const store = createAudioSettingsStore(storage);
    expect(store.isSilenced()).toBe(true);
    expect(store.get().muted).toBe(true);
    expect(store.masterGain()).toBe(0);
  });

  it("un-muting clears the legacy flag, muting sets it", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_MASTER_KEY, "0");
    const store = createAudioSettingsStore(storage);
    store.setMuted(false);
    expect(store.isSilenced()).toBe(false);
    expect(storage.getItem(LEGACY_MASTER_KEY)).toBe("1");
    store.toggleMuted();
    expect(store.isSilenced()).toBe(true);
    expect(storage.getItem(LEGACY_MASTER_KEY)).toBe("0");
    expect(createAudioSettingsStore(storage).get().muted).toBe(true);
  });

  it("notices the legacy flag changing behind its back, and can still un-mute", () => {
    const storage = new MemoryStorage();
    let now = 0;
    const store = createAudioSettingsStore(storage, () => now);
    expect(store.isSilenced()).toBe(false);
    storage.setItem(LEGACY_MASTER_KEY, "0");
    expect(store.isSilenced()).toBe(false); // cached for a second
    now += 1500;
    expect(store.isSilenced()).toBe(true);
    expect(store.get().muted).toBe(false);
    store.toggleMuted();
    expect(store.isSilenced()).toBe(false);
    expect(storage.getItem(LEGACY_MASTER_KEY)).toBe("1");
  });

  it("maps faders to gains with a squared taper", () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
    expect(volumeToGain(2)).toBe(1);
    expect(volumeToGain(Number.NaN)).toBe(0);
    const store = createAudioSettingsStore(null);
    expect(store.masterGain()).toBeCloseTo(DEFAULT_AUDIO_SETTINGS.master ** 2);
    store.setBusMuted("world", true);
    expect(store.busGain("world")).toBe(0);
    expect(store.busGain("ui")).toBeCloseTo(DEFAULT_AUDIO_SETTINGS.volumes.ui ** 2);
    store.setMuted(true);
    expect(store.masterGain()).toBe(0);
  });

  it("reset restores the defaults and un-mutes", () => {
    const storage = new MemoryStorage();
    const store = createAudioSettingsStore(storage);
    store.update({ muted: true, master: 0.1, musicEnabled: true });
    store.reset();
    expect(store.get()).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(storage.getItem(LEGACY_MASTER_KEY)).toBe("1");
  });
});
