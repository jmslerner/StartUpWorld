import { describe, expect, it } from "vitest";
import { executeCommand } from "../../engine";
import { computeContext } from "../../engine/context";
import { eventPool } from "../../engine/events/pool";
import { toPendingEvent } from "../../engine/events/types";
import { makeState } from "../../engine/testHelpers";
import { useGameStore } from "../../state/useGameStore";
import type { BoardState, GameState } from "../../types/game";
import { deriveWorldEvents } from "../events";
import { mix32 } from "../hash";
import { buildWorldSnapshot } from "../snapshot";
import { isRejected, restartSignal, toActionSignal } from "./actionSignal";

const board = (): BoardState => ({
  lastMeetingWeek: 0,
  members: [
    { id: "b-founder", name: "You", role: "founder", personality: "cheerleader", confidence: 80 },
    { id: "b-investor", name: "Dana Whitfield", role: "investor", personality: "operator", confidence: 50 },
  ],
});

const withPendingEvent = (state: GameState): GameState => ({
  ...state,
  pendingEvent: toPendingEvent(eventPool[0], state, computeContext(state)),
});

/** The same command on different dice until the wanted outcome comes up. */
const rollUntil = (state: GameState, input: string, wanted: (sound: string | undefined) => boolean) => {
  for (let i = 1; i <= 500; i += 1) {
    const result = executeCommand({ ...state, rng: mix32(i) || 1 }, input);
    if (wanted(result.sound)) return result;
  }
  throw new Error(`no seed produced the wanted outcome for "${input}"`);
};

describe("toActionSignal", () => {
  it("splits the command line into a lower-cased command and arguments", () => {
    const result = executeCommand(makeState(), "  Hire   ENG  2 ");
    expect(toActionSignal(7, "  Hire   ENG  2 ", result)).toEqual({
      seq: 7,
      command: "hire",
      args: ["eng", "2"],
      sound: "success",
      rejected: false,
    });
  });

  it("reports an empty command for an empty line", () => {
    const signal = toActionSignal(1, "   ", executeCommand(makeState(), ""));
    expect(signal).toMatchObject({ command: "", args: [], sound: null, rejected: false });
  });

  it("flags a hire with no AP as rejected", () => {
    const result = executeCommand(makeState({ ap: 0 }), "hire eng 1");
    expect(result.sound).toBeUndefined();
    expect(toActionSignal(1, "hire eng 1", result)).toMatchObject({ command: "hire", sound: null, rejected: true });
  });

  it("flags unknown commands and usage errors as rejected", () => {
    for (const input of ["frobnicate", "hire nobody", "raise vc", "pricing free", "board dinner"]) {
      const result = executeCommand(makeState(), input);
      expect(isRejected(result), input).toBe(true);
    }
  });

  it("does not flag a backfired blackmail: it logs an error line but is a real outcome", () => {
    const state = makeState({ board: board() });
    const result = rollUntil(state, "board blackmail dana", (sound) => sound === "fail");
    expect(result.logs.some((entry) => entry.kind === "error")).toBe(true);
    expect(toActionSignal(1, "board blackmail dana", result)).toMatchObject({
      command: "board",
      args: ["blackmail", "dana"],
      sound: "fail",
      rejected: false,
    });
  });

  it("does not flag an out-of-range event choice: the engine answers with an event line", () => {
    const state = withPendingEvent(makeState());
    const result = executeCommand(state, "choose 9");
    expect(result.state.pendingEvent).not.toBeNull();
    expect(toActionSignal(1, "choose 9", result)).toMatchObject({ command: "choose", args: ["9"], rejected: false });
  });

  it("does not flag successes, failed rolls or informational commands", () => {
    const state = makeState();
    for (const input of ["status", "help", "perks", "phases", "raise", "pricing", "coffee", "end", "pitch", "ship v2"]) {
      expect(isRejected(executeCommand(state, input)), input).toBe(false);
    }
  });

  it("flags every gameplay command as rejected while an event is pending", () => {
    const state = withPendingEvent(makeState());
    for (const input of ["hire eng 1", "ship v2", "launch big", "pitch", "end", "coffee", "perks", "buy lounge"]) {
      expect(isRejected(executeCommand(state, input)), input).toBe(true);
    }
    expect(isRejected(executeCommand(state, "status"))).toBe(false);
  });

  it("feeds deriveWorldEvents: a refusal becomes command-failed, an outcome does not", () => {
    const before = executeCommand(makeState({ ap: 0 }), "status").state;
    const refused = executeCommand(before, "hire eng 1");
    const events = deriveWorldEvents(
      buildWorldSnapshot(before),
      buildWorldSnapshot(refused.state),
      toActionSignal(1, "hire eng 1", refused)
    );
    expect(events).toEqual([{ type: "command-failed", command: "hire" }]);

    const ready = executeCommand(makeState({ ap: 3 }), "status").state;
    const hired = executeCommand(ready, "hire eng 1");
    const types = deriveWorldEvents(
      buildWorldSnapshot(ready),
      buildWorldSnapshot(hired.state),
      toActionSignal(2, "hire eng 1", hired)
    ).map((event) => event.type);
    expect(types).toContain("hired");
    expect(types).not.toContain("command-failed");
  });
});

describe("restartSignal", () => {
  it("is a plain, non-rejected restart", () => {
    expect(restartSignal(4)).toEqual({ seq: 4, command: "restart", args: [], sound: null, rejected: false });
  });
});

describe("useGameStore.lastAction", () => {
  const setup = () => {
    useGameStore.getState().resetGame();
    for (const input of ["name Ada", "company Loop", "founder philosopher", "cofounder operator"]) {
      useGameStore.getState().runCommand(input);
    }
  };

  it("bumps seq once per command and records how the engine judged it", () => {
    setup();
    const before = useGameStore.getState().lastAction;
    expect(before).toMatchObject({ command: "cofounder", args: ["operator"], rejected: false });

    useGameStore.getState().runCommand("Hire Eng 1");
    const hired = useGameStore.getState().lastAction;
    expect(hired).toEqual({
      seq: (before?.seq ?? 0) + 1,
      command: "hire",
      args: ["eng", "1"],
      sound: "success",
      rejected: false,
    });

    useGameStore.getState().runCommand("hire data 1");
    expect(useGameStore.getState().lastAction).toMatchObject({
      seq: (hired?.seq ?? 0) + 1,
      command: "hire",
      args: ["data", "1"],
      sound: null,
      rejected: true,
    });
  });

  it("rejects a hire once the week's AP is spent", () => {
    setup();
    const store = useGameStore.getState();
    while (useGameStore.getState().state.ap > 0) store.runCommand("hire ops 1");
    store.runCommand("hire eng 1");
    expect(useGameStore.getState().state.ap).toBe(0);
    expect(useGameStore.getState().lastAction).toMatchObject({ command: "hire", sound: null, rejected: true });
  });

  it("leaves lastAction alone for store-only commands", () => {
    setup();
    const before = useGameStore.getState().lastAction;
    useGameStore.getState().runCommand("clear");
    useGameStore.getState().runCommand("restart");
    expect(useGameStore.getState().lastAction).toBe(before);
  });

  it("signals a restart from `restart confirm` and from resetGame", () => {
    setup();
    const seq = useGameStore.getState().lastAction?.seq ?? 0;

    useGameStore.getState().runCommand("restart confirm");
    expect(useGameStore.getState().lastAction).toEqual(restartSignal(seq + 1));
    expect(useGameStore.getState().state.founder.name).toBe("");

    useGameStore.getState().resetGame();
    expect(useGameStore.getState().lastAction).toEqual(restartSignal(seq + 2));
  });
});
