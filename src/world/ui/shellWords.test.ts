import { describe, expect, it } from "vitest";
import { SHELL_FAILURE_LOG, SHELL_WORDS } from "./shellWords";

describe("the shell's words", () => {
  it("say that the office is opening, and that the game is complete without the 3D view", () => {
    expect(SHELL_WORDS.opening).toBe("Opening the office…");
    expect(SHELL_WORDS.unavailable).toBe("The 3D office cannot be shown on this device. The game is complete without it.");
  });

  it("mention no terminal, no commands and nothing of the old game", () => {
    const old = /terminal|command|console|type |typed|prompt|week|action point|\bAP\b|founder|WebGL|browser|error|crash/i;
    for (const words of Object.values(SHELL_WORDS)) expect(words).not.toMatch(old);
    // The line for the console may name the failure; it still names no terminal and no command.
    expect(SHELL_FAILURE_LOG).not.toMatch(/terminal|command/i);
  });

  it("are whole sentences a player can read: no markup, no code, no empty line", () => {
    for (const words of Object.values(SHELL_WORDS)) {
      expect(words.trim()).toBe(words);
      expect(words.length).toBeGreaterThan(10);
      expect(words).not.toMatch(/[<>{}_`]/);
    }
  });
});
