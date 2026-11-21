import { describe, expect, it } from "vitest";
import type { GameState } from "../../types/game";
import { endWeekTick } from "../tick";
import { buildsOf, rosterOf, setProduct } from "../tycoon/roster";
import { build, person, run, shop, staffed, texts } from "./testkit";
import { forecastText, pct, weekOutput } from "./work";

// Tick step N1 inside the real `end` (§6): build lines right after the users line, rendered from the finished tick.

const buildLines = (logs: string[], name: string): string[] => logs.filter((t) => t.startsWith(`${name}:`));

describe("`end` with builds in flight", () => {
  it("prints one line per build right after the users line, whose forecast equals what `build` prints next", () => {
    const b = build({ name: "Phoenix", slug: "phoenix", dueWeek: 9 });
    const s = shop({ roster: staffed([person(1), person(2), person(3)], "b1", 1), builds: [b], stress: 45, volatility: 40 });
    const r = run(s, "end");
    const logs = texts(r);
    const users = logs.findIndex((t) => t.startsWith("Users +"));
    expect(logs[users + 1].startsWith("Phoenix: 0% → ")).toBe(true);
    const after = buildsOf(r.state)[0];
    expect(logs[users + 1]).toBe(`Phoenix: 0% → ${pct(after)}% built (+${Math.round(after.progress * 10) / 10} pts). ${forecastText(r.state, after)}.`);
    const board = texts(run(r.state, "build"));
    expect(board.some((t) => t.endsWith(forecastText(r.state, after)))).toBe(true);
  });

  it("decays the moat and keeps cruft; a legacy-shaped idle week prints no build line", () => {
    const s = setProduct(shop({ roster: [person(1)] }), { moat: 20, cruft: 5 });
    const r = endWeekTick(s);
    expect(r.state.product?.moat).toBe(19.4);
    expect(r.state.product?.cruft).toBe(5);
    expect(r.logs.some((t) => String(t).includes("% built"))).toBe(false);
  });

  it("cruft and moat move churn only through adjustChurn (same users with both at 0)", () => {
    const s = shop({ roster: [person(1)] });
    const plain = endWeekTick(s);
    const legacy = endWeekTick({ ...s, people: undefined, product: undefined });
    expect(plain.state.users).toBe(legacy.state.users);
  });

  it("a lead whose notice runs out in the same tick shows as a smaller gain, and the build loses a quarter", () => {
    const lead = { ...person(2, { craft: 5 }), offerDueWeek: 2, offerKind: "recruiter" as const, leadOnNotice: "b1" };
    const b = build({ name: "Phoenix", slug: "phoenix", progress: 4, qPts: 4, qSum: 220, dueWeek: 9 });
    const s: GameState = shop({ roster: staffed([person(1), lead], "b1", 1), builds: [b] });
    const worked = 4 + weekOutput({ ...s, week: 2 }, b, 1).points; // N1 works the week first (both ramping, founders' hands)
    const r = run(s, "end");
    expect(rosterOf(r.state).some((e) => e.id === "e2")).toBe(false);
    const after = buildsOf(r.state)[0];
    expect(after.progress).toBeCloseTo(worked * 0.75, 10);
    const line = buildLines(texts(r), "Phoenix")[0];
    expect(line.startsWith(`Phoenix: 33% → ${pct(after)}% built (+${Math.round((worked - 4) * 10) / 10} pts)`)).toBe(true);
  });
});
