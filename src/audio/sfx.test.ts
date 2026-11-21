import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EndingType } from "../types/game";
import { SFX } from "../ui/sound";
import { setSharedAudioEngine } from "./engine";
import { SOUNDS } from "./sounds";
import { makeHarness, reaches, type FakeNode, type Harness } from "./testing/fakeAudio";

const ENDINGS: EndingType[] = ["ipo", "acquisition", "bankruptcy", "founder-removal", "zombie-saas", "ai-hype-exit", "forced-acquisition"];

/** Every way the store (src/state/useGameStore.ts) and the terminal call the facade. */
const CALLS: Array<[string, () => void]> = [
  ["success", () => SFX.success()],
  ["fail", () => SFX.fail()],
  ["alert", () => SFX.alert()],
  ["crisis", () => SFX.crisis()],
  ["opportunity", () => SFX.opportunity()],
  ["tick", () => SFX.tick()],
  ["cashIn", () => SFX.cashIn()],
  ["warning", () => SFX.warning()],
  ["click", () => SFX.click()],
  ...ENDINGS.map((ending): [string, () => void] => [`gameOver(${ending})`, () => SFX.gameOver(ending)]),
];

describe("SFX facade", () => {
  let h: Harness;

  beforeEach(async () => {
    vi.useFakeTimers();
    h = makeHarness();
    setSharedAudioEngine(h.engine);
    await h.unlock();
  });

  afterEach(() => {
    h.engine.dispose();
    setSharedAudioEngine(null);
    vi.useRealTimers();
  });

  it("keeps the API the store relies on", () => {
    expect(Object.keys(SFX).sort()).toEqual(["alert", "cashIn", "click", "crisis", "fail", "gameOver", "opportunity", "success", "tick", "warning"]);
    for (const key of Object.keys(SFX) as Array<keyof typeof SFX>) expect(typeof SFX[key]).toBe("function");
    expect(SFX.gameOver.length).toBe(1);
  });

  it.each(CALLS)("SFX.%s schedules a sound on the outcome bus", (_label, call) => {
    const outcome = h.engine.tap("outcome")?.dry as unknown as FakeNode;
    const others = (["ui", "world", "ambience", "music"] as const).map((bus) => h.engine.tap(bus)?.dry as unknown as FakeNode);
    const before = new Set(h.ctx.started);
    call();
    const sources = h.ctx.started.filter((source) => !before.has(source));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((source) => reaches(source, outcome))).toBe(true);
    for (const other of others) expect(sources.some((source) => reaches(source, other))).toBe(false);
    expect(h.engine.voiceCount("outcome")).toBe(1);
    expect(h.engine.error).toBeNull();
  });

  it("gives each ending its own sting, all of them stingers", () => {
    const names = new Set<string>();
    for (const ending of ENDINGS) {
      const name = `gameover-${ending}`;
      expect(name in SOUNDS).toBe(true);
      names.add(name);
    }
    expect(names.size).toBe(7);
    for (const name of names) expect(SOUNDS[name as keyof typeof SOUNDS].kind).toBe("stinger");
  });

  it("ignores an ending it does not know", () => {
    expect(() => SFX.gameOver("heat-death" as EndingType)).not.toThrow();
    expect(h.engine.voiceCount()).toBe(0);
  });

  it("is silent when muted or when the old master flag says so", () => {
    h.settings.setMuted(true);
    for (const [, call] of CALLS) call();
    expect(h.ctx.started).toHaveLength(0);
  });
});

describe("SFX facade without audio", () => {
  it("never throws when there is no AudioContext (node, blocked browsers)", () => {
    setSharedAudioEngine(null);
    for (const [, call] of CALLS) expect(call).not.toThrow();
    setSharedAudioEngine(null);
  });
});
