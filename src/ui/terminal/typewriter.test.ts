import { describe, expect, it } from "vitest";
import type { LogEntry } from "../../types/game";
import {
  DONE,
  advanceTo,
  completeAll,
  fastForward,
  planFor,
  renderLog,
  stripPacingTokens,
  typingTarget,
  type TypewriterProgress,
} from "./typewriter";

let nextId = 0;
const sys = (text: string, id = `log-${(nextId += 1)}`): LogEntry => ({ id, text, kind: "system" });
const user = (text: string, id = `log-${(nextId += 1)}`): LogEntry => ({ id, text: `> ${text}`, kind: "user" });
const intro = (text: string, id: string): LogEntry => ({ id, text, kind: "system" });

/** Takes one step, the way the hook's timer does. */
const tick = (entries: LogEntry[], progress: TypewriterProgress): TypewriterProgress => {
  const target = typingTarget(entries, progress);
  if (!target) return progress;
  return advanceTo(entries, progress, target.id, target.step + 1);
};

/** Ticks until nothing is typing (or `max` steps), returning the progress and how many steps it took. */
const runOut = (entries: LogEntry[], progress: TypewriterProgress, max = 100_000) => {
  let p = progress;
  let steps = 0;
  while (typingTarget(entries, p) && steps < max) {
    p = tick(entries, p);
    steps += 1;
  }
  return { progress: p, steps };
};

const texts = (entries: LogEntry[], progress: TypewriterProgress) => renderLog(entries, progress).map((e) => e.text);

/** The invariants that make the log "never garbled". */
const expectWellFormed = (entries: LogEntry[], progress: TypewriterProgress) => {
  const rendered = renderLog(entries, progress);
  expect(rendered.map((e) => e.id)).toEqual(entries.map((e) => e.id));
  let partial = 0;
  rendered.forEach((shown, i) => {
    const entry = entries[i]!;
    const full = entry.kind === "user" ? entry.text : stripPacingTokens(entry.text);
    // Every line shows a prefix of its own text: no characters from another line.
    expect(full.startsWith(shown.text)).toBe(true);
    expect(shown.kind).toBe(entry.kind);
    if (shown.text.length > 0 && shown.text.length < full.length) partial += 1;
  });
  // At most one line is ever half-typed.
  expect(partial).toBeLessThanOrEqual(1);
};

describe("planFor", () => {
  it("strips pacing tokens and has one wait per character plus a settle", () => {
    const plan = planFor(sys("Week closed.[[beat]] Cash $9K."));
    expect(plan.text).toBe("Week closed. Cash $9K.");
    expect(plan.ends.length).toBe(plan.text.length);
    expect(plan.waits.length).toBe(plan.text.length + 1);
    expect(plan.ends.at(-1)).toBe(plan.text.length);
  });

  it("is deterministic for an entry and pure (no shared state between calls)", () => {
    const a = { id: "log-x", text: "Hello, world. [[beat]]Again.", kind: "system" as const };
    const b = { ...a }; // a different object: not served from the cache
    expect(planFor(a)).toEqual(planFor(b));
  });

  it("keeps the old per-character pacing", () => {
    const plan = planFor(sys("abcdefghij"));
    // First character straight away, then 22–35 ms per letter.
    expect(plan.waits[0]).toBe(0);
    for (const w of plan.waits.slice(1)) {
      expect(w).toBeGreaterThanOrEqual(22);
      expect(w).toBeLessThanOrEqual(35);
    }
    const spaced = planFor(sys("a b"));
    expect(spaced.waits[2]).toBeGreaterThanOrEqual(8); // after the space
    expect(spaced.waits[2]).toBeLessThanOrEqual(15);
    const sentence = planFor(sys("Hi. Yo"));
    // After "." comes base + 180–260.
    expect(sentence.waits[3]).toBeGreaterThanOrEqual(22 + 180);
    expect(sentence.waits[3]).toBeLessThanOrEqual(35 + 260);
  });

  it("turns [[beat]] into a 450 ms pause and [[short]] / [[long]] into 200 / 800 ms", () => {
    const beat = planFor(sys("[[beat]]x"));
    expect(beat.waits[0]).toBe(450);
    const short = planFor(sys("[[short]]x"));
    expect(short.waits[0]).toBe(200);
    const long = planFor(sys("x[[long]]y"));
    expect(long.waits[1]).toBeGreaterThanOrEqual(800 + 22);
    expect(long.waits[1]).toBeLessThanOrEqual(800 + 35);
  });

  it("[[typefast]] speeds characters up and [[typereset]] restores the base speed", () => {
    const plan = planFor(sys("[[typefast]]abcdefghijklmnop[[typereset]]qrstuvwxyz"));
    const fast = plan.waits.slice(1, 16); // after a..o, typed fast
    for (const w of fast) {
      expect(w).toBeGreaterThanOrEqual(Math.round(22 * 0.65));
      expect(w).toBeLessThanOrEqual(Math.round(35 * 0.65));
    }
    for (const w of plan.waits.slice(18)) {
      expect(w).toBeGreaterThanOrEqual(22);
      expect(w).toBeLessThanOrEqual(35);
    }
  });

  it("never splits an emoji into half a surrogate pair", () => {
    const entry = sys("ok 🚀 go");
    const plan = planFor(entry);
    expect(plan.ends.length).toBe([...plan.text].length);
    let p: TypewriterProgress = {};
    const entries = [user("go"), entry];
    for (let i = 0; i < plan.ends.length; i += 1) {
      p = tick(entries, p);
      const shown = texts(entries, p)[1]!;
      expect(shown).toBe([...plan.text].slice(0, i + 1).join(""));
    }
  });
});

describe("renderLog / typingTarget", () => {
  it("shows the log present at mount whole (a reloaded save is not re-typed)", () => {
    const entries = [user("end"), sys("Week closed."), sys("Runway: 4 weeks.")];
    const p = completeAll(entries);
    expect(typingTarget(entries, p)).toBeNull();
    expect(texts(entries, p)).toEqual(["> end", "Week closed.", "Runway: 4 weeks."]);
  });

  it("renders user and intro lines at once and strips tokens from intro lines", () => {
    const entries = [intro("[[typefast]]=== STARTUP WORLD ===", "intro-1"), intro("[[typefast]]Seed: 7", "intro-seed")];
    expect(typingTarget(entries, {})).toBeNull();
    expect(texts(entries, {})).toEqual(["=== STARTUP WORLD ===", "Seed: 7"]);
  });

  it("types new output newest line first, one character per step, with the earlier lines blank until their turn", () => {
    const entries = [user("end"), sys("Week closed."), sys("Tip: raise.")];
    let p: TypewriterProgress = {};
    expect(typingTarget(entries, p)).toMatchObject({ index: 2, step: 0 });
    p = tick(entries, p);
    expect(texts(entries, p)).toEqual(["> end", "", "T"]);
    p = tick(entries, p);
    expect(texts(entries, p)).toEqual(["> end", "", "Ti"]);
    // Finish the newest line (characters + settle), then the older one starts.
    for (let i = 0; i < "Tip: raise.".length - 2; i += 1) p = tick(entries, p);
    expect(texts(entries, p)).toEqual(["> end", "", "Tip: raise."]);
    expect(typingTarget(entries, p)).toMatchObject({ index: 2 }); // settling
    p = tick(entries, p);
    expect(typingTarget(entries, p)).toMatchObject({ index: 1, step: 0 });
    const done = runOut(entries, p);
    expect(texts(entries, done.progress)).toEqual(["> end", "Week closed.", "Tip: raise."]);
    expect(done.steps).toBe("Week closed.".length + 1);
  });

  it("finishes older output at once when a command is appended mid-line (a click while typing)", () => {
    const first = [user("hire eng 1"), sys("Hired an engineer."), sys("Burn is now $4K/wk.")];
    let p: TypewriterProgress = {};
    for (let i = 0; i < 5; i += 1) p = tick(first, p);
    expect(texts(first, p)).toEqual(["> hire eng 1", "", "Burn "]);

    const appended = [...first, user("choose 1"), sys("You ship faster."), sys("Morale +2.")];
    expectWellFormed(appended, p);
    expect(texts(appended, p)).toEqual([
      "> hire eng 1",
      "Hired an engineer.",
      "Burn is now $4K/wk.",
      "> choose 1",
      "",
      "",
    ]);
    expect(typingTarget(appended, p)).toMatchObject({ index: 5, step: 0 });
    p = tick(appended, p);
    expect(texts(appended, p).slice(3)).toEqual(["> choose 1", "", "M"]);
  });

  it("starts a wholly replaced log (week's end) from scratch, with no characters carried over", () => {
    const week1 = [user("ship x"), sys("Shipped x."), sys("Users +3.")];
    let p: TypewriterProgress = {};
    for (let i = 0; i < 4; i += 1) p = tick(week1, p);
    expect(texts(week1, p)[2]).toBe("User");

    const week2 = [user("end"), sys("Founder quote: ship it."), sys("Week closed."), sys("Users +1 / -2 → 45.")];
    expectWellFormed(week2, p);
    expect(texts(week2, p)).toEqual(["> end", "", "", ""]);
    expect(typingTarget(week2, p)).toMatchObject({ index: 3, step: 0 });
    p = tick(week2, p);
    expect(texts(week2, p)).toEqual(["> end", "", "", "U"]);
    // Old ids are dropped from progress as soon as it moves.
    expect(Object.keys(p)).toEqual([week2[3]!.id]);
  });

  it("handles a new log arriving while the old one was mid-line twice in a row", () => {
    const a = [user("end"), sys("Week closed."), sys("Tip: Runway is low.")];
    let p: TypewriterProgress = {};
    for (let i = 0; i < 3; i += 1) p = tick(a, p);
    const b = [user("end"), sys("Week closed again."), sys("URGENT: Cash is almost gone.")];
    for (let i = 0; i < 2; i += 1) p = tick(b, p);
    expect(texts(b, p)).toEqual(["> end", "", "UR"]);
    const c = [user("end"), sys("Week closed, third time."), sys("Ending unlocked.")];
    expect(texts(c, p)).toEqual(["> end", "", ""]);
    p = tick(c, p);
    expect(texts(c, p)).toEqual(["> end", "", "E"]);
  });

  it("`clear` (the log replaced by intro lines) shows at once and stops typing", () => {
    const busy = [user("help"), sys("Commands: hire, ship, launch, end.")];
    let p: TypewriterProgress = {};
    for (let i = 0; i < 6; i += 1) p = tick(busy, p);
    expect(typingTarget(busy, p)).not.toBeNull();
    const cleared = [intro("=== STARTUP WORLD ===", "intro-1"), intro("Seed: 7", "intro-seed"), intro("Type 'help' for commands.", "intro-6")];
    expect(typingTarget(cleared, p)).toBeNull();
    expect(texts(cleared, p)).toEqual(["=== STARTUP WORLD ===", "Seed: 7", "Type 'help' for commands."]);
  });

  it("survives entries being removed from under the line being typed", () => {
    const entries = [user("status"), sys("Cash $9K."), sys("Runway 3 weeks.")];
    let p: TypewriterProgress = {};
    for (let i = 0; i < 4; i += 1) p = tick(entries, p);
    const fewer = [entries[0]!, entries[1]!];
    expectWellFormed(fewer, p);
    expect(typingTarget(fewer, p)).toMatchObject({ index: 1, step: 0 });
    expect(runOut(fewer, p).progress).toEqual({ [entries[1]!.id]: "Cash $9K.".length + 1 });
  });

  it("fastForward finishes only the line being typed; the next one then starts", () => {
    const entries = [user("end"), sys("Week closed."), sys("Tip: raise.")];
    let p = tick(entries, {});
    p = fastForward(entries, p);
    expect(texts(entries, p)).toEqual(["> end", "", "Tip: raise."]);
    expect(typingTarget(entries, p)).toMatchObject({ index: 1, step: 0 });
    p = fastForward(entries, p);
    expect(typingTarget(entries, p)).toBeNull();
    expect(texts(entries, p)).toEqual(["> end", "Week closed.", "Tip: raise."]);
    // Nothing typing: fast-forward is a no-op.
    expect(fastForward(entries, p)).toBe(p);
  });

  it("completeAll (flushAll) finishes every line", () => {
    const entries = [user("end"), sys("Week closed."), sys("Tip: raise.")];
    const p = completeAll(entries);
    expect(typingTarget(entries, p)).toBeNull();
    expect(texts(entries, p)).toEqual(["> end", "Week closed.", "Tip: raise."]);
    expect(Object.values(p)).toEqual([DONE, DONE, DONE]);
  });

  it("advanceTo is idempotent and never goes backwards (StrictMode double-invoked updaters, re-run effects)", () => {
    const entries = [user("end"), sys("Week closed.")];
    const once = advanceTo(entries, {}, entries[1]!.id, 3);
    const twice = advanceTo(entries, once, entries[1]!.id, 3);
    expect(twice).toEqual(once);
    expect(advanceTo(entries, once, entries[1]!.id, 1)).toEqual(once);
    expect(texts(entries, twice)[1]).toBe("Wee");
    // A step for an entry no longer in the log is dropped, not recorded.
    expect(advanceTo(entries, once, "gone", 5)).toEqual(once);
  });

  it("takes exactly characters + 1 steps per typed line, so pacing totals match the plan", () => {
    const entries = [user("end"), sys("Burn $4,043 - Revenue $115 = Net burn $3,928."), sys("[[beat]]Runway: 2 weeks.")];
    let total = 0;
    let p: TypewriterProgress = {};
    for (;;) {
      const target = typingTarget(entries, p);
      if (!target) break;
      total += target.wait;
      p = advanceTo(entries, p, target.id, target.step + 1);
    }
    const planned = [entries[1]!, entries[2]!].reduce((sum, e) => sum + planFor(e).waits.reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(planned);
    expect(planFor(entries[2]!).waits[0]).toBe(450);
  });

  it("stays well-formed under any interleaving of typing, appends, replacements, clears and flushes", () => {
    // Seeded so a failure reproduces.
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const words = ["Week closed.", "Cash $9,000.", "Tip: `raise friends`.", "EVENT: Competitor Copies You", "1) Ship faster.", "[[beat]]Runway: 2 weeks.", "[[typefast]]Users +1 / -2 → 45.", "🚀 Launched!"];
    const batch = (command: string) => [user(command), ...Array.from({ length: 1 + Math.floor(rand() * 5) }, () => sys(words[Math.floor(rand() * words.length)]!))];

    let entries: LogEntry[] = [intro("=== STARTUP WORLD ===", "intro-1")];
    let p = completeAll(entries);
    for (let i = 0; i < 3000; i += 1) {
      const r = rand();
      if (r < 0.7) p = tick(entries, p);
      else if (r < 0.82) entries = [...entries, ...batch("choose 1")];
      else if (r < 0.9) entries = batch("end"); // week advance: the log is replaced
      else if (r < 0.93) entries = [intro("=== STARTUP WORLD ===", "intro-1"), intro("Type 'help' for commands.", "intro-6")]; // clear
      else if (r < 0.96) p = fastForward(entries, p);
      else if (r < 0.98) p = completeAll(entries);
      else if (entries.length > 1) entries = entries.slice(0, -1);
      expectWellFormed(entries, p);
    }
    // And it always runs out.
    const end = runOut(entries, p);
    expect(typingTarget(entries, end.progress)).toBeNull();
  });
});
