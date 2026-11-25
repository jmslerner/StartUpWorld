import { describe, expect, it } from "vitest";
import { SHELL_FAILURE_LOG, SHELL_WORDS } from "./shellWords";

describe("the shell's words", () => {
  it("say that the office is opening, and that the game is complete without the 3D view", () => {
    expect(SHELL_WORDS.opening).toBe("Opening the office…");
    expect(SHELL_WORDS.unavailable).toBe("The 3D office cannot be shown on this device. The game is complete without it.");
  });

  it("say what the view is, that it stopped, and how to get it back", () => {
    expect(SHELL_WORDS.view).toBe("A 3D view of the company's office and the people who work in it. The game is complete without it.");
    expect(SHELL_WORDS.lost).toBe("The 3D office stopped drawing. The game carries on without it.");
    expect(SHELL_WORDS.reload).toBe("Reload 3D view");
    expect(Object.keys(SHELL_WORDS).sort()).toEqual(["lost", "opening", "reload", "unavailable", "view"]);
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
