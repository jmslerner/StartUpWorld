import { describe, expect, it } from "vitest";
import type { GameState } from "../../types/game";
import { createInitialState } from "../actions";
import { makeState, makeTycoonState } from "../testHelpers";
import { preflight } from "./preflight";

// Legacy commands only, so these pass against the stub modules. STAFF and PROJECTS add the tycoon cases.

const pending = { id: "x", title: "T", prompt: "P", choices: [{ id: "a", text: "A" }] };

describe("preflight", () => {
  it("reports refusals with the first error line and no cost", () => {
    const cases: Array<[GameState, string, string]> = [
      [makeState({ ap: 0 }), "hire eng 1", "No AP left. End the week to refresh."],
      [makeState({ pendingEvent: pending }), "hire eng 1", "Resolve the pending event first with `choose <n>`."],
      [createInitialState(), "hire eng 1", "Set your name first: `name <your name>`."],
      [makeState({ gameOver: { ending: "bankruptcy", week: 3, headline: "x" } }), "launch x", "Game over. Click 'Play Again' or refresh to start a new run."],
      [makeState({ cash: 100 }), "hire eng 1", "Not enough cash to hire that many."],
    ];
    for (const [state, input, reason] of cases) {
      expect(preflight(state, input)).toEqual({ allowed: false, reason, apCost: 0, cashCost: 0 });
    }
  });

  it("reports the AP and cash a command would spend", () => {
    expect(preflight(makeState(), "hire eng 2")).toEqual({ allowed: true, reason: null, apCost: 1, cashCost: 6000 });
    expect(preflight(makeState({ founder: { name: "F", archetype: "philosopher" } }), "launch x")).toEqual({ allowed: true, reason: null, apCost: 1, cashCost: 900 });
    expect(preflight(makeState({ companyPhase: "office", cash: 200_000 }), "buy lounge")).toEqual({ allowed: true, reason: null, apCost: 1, cashCost: 100_000 });
    expect(preflight(makeState(), "ship x")).toEqual({ allowed: true, reason: null, apCost: 0, cashCost: 0 });
    expect(preflight(makeTycoonState(), "status")).toEqual({ allowed: true, reason: null, apCost: 0, cashCost: 0 });
  });

  it("never mutates its input and returns exactly four fields", () => {
    const s = makeTycoonState({ team: { ...makeState().team, engineering: 3 } });
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    const r = preflight(s, "hire eng 2");
    expect(s).toEqual(copy);
    expect(Object.keys(r).sort()).toEqual(["allowed", "apCost", "cashCost", "reason"]);
  });
});
