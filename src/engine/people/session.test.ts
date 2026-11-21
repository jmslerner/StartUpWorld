import { describe, expect, it } from "vitest";
import type { GameState } from "../../types/game";
import { createInitialState } from "../actions";
import { executeCommand } from "../commands";
import { rosterInvariantHolds, rosterOf } from "../tycoon/roster";

// Determinism and hygiene over a scripted session that uses every people command (TYCOON-SPEC §12.3, §12.4).

const PEOPLE = new Set(["team", "recruit", "retain", "fire"]);

const setup = (seed: string): GameState => {
  let s = createInitialState();
  for (const cmd of [`seed ${seed}`, "name Ada", "company Testco", "founder hacker", "cofounder operator"]) s = executeCommand(s, cmd).state;
  return s;
};

/** A fixed policy: look and sign engineers, keep anyone holding an offer, trim marketing, read the team, end the week. */
const weekScript = (s: GameState, week: number): string[] => {
  const holding = rosterOf(s).find((e) => e.offerDueWeek > 0);
  const cmds = ["team", "recruit eng"];
  if (week % 3 === 1) cmds.push("raise friends", "recruit eng 1");
  if (week % 4 === 2) cmds.push("hire gtm 2");
  if (week % 6 === 5) cmds.push("fire gtm 1");
  if (holding) cmds.push(`retain ${holding.id}`);
  if (week % 5 === 0 && rosterOf(s).length > 0) cmds.push(`team ${rosterOf(s)[0].id}`, "team all", "status");
  cmds.push("end");
  return cmds;
};

const play = (seed: string, weeks: number): { state: GameState; logs: string[] } => {
  let s = setup(seed);
  const logs: string[] = [];
  for (let week = 1; week <= weeks && !s.gameOver; week++) {
    for (const cmd of weekScript(s, week)) {
      if (s.pendingEvent && cmd !== "team") s = executeCommand(s, "choose 1").state;
      const before = s;
      const r = executeCommand(s, cmd);
      s = r.state;
      logs.push(...r.logs.map((l) => l.text));
      expect(rosterInvariantHolds(s), `${cmd} @${week}`).toBe(true);
      if (PEOPLE.has(cmd.split(" ")[0])) expect(s.rng, cmd).toBe(before.rng);
    }
  }
  return { state: s, logs };
};

describe("a scripted session", () => {
  it("is deterministic: same seed, same commands → deep-equal state and identical logs", () => {
    const a = play("people-1", 30);
    const b = play("people-1", 30);
    expect(a.state).toEqual(b.state);
    expect(a.logs).toEqual(b.logs);
    expect(JSON.parse(JSON.stringify(a.state))).toEqual(a.state);
    expect(a.logs.some((t) => / signs\. engineering, /.test(t))).toBe(true);
  });

  it("depends on the seed, through the people stream only for the people", () => {
    const a = play("people-1", 6);
    const c = play("people-2", 6);
    expect(rosterOf(a.state).map((e) => e.name)).not.toEqual(rosterOf(c.state).map((e) => e.name));
  });
});
