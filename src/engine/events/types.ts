import type { GameState, PendingEvent } from "../../types/game";
import type { EngineContext } from "../context";

export interface EventChoice {
  id: string;
  text: string;
  apply: (state: GameState, ctx: EngineContext) => { state: GameState; logs: string[] };
}

export interface EventDef {
  id: string;
  title: string;
  prompt: (state: GameState, ctx: EngineContext) => string;
  when: (state: GameState, ctx: EngineContext) => boolean;
  weight: (state: GameState, ctx: EngineContext) => number;
  choices: EventChoice[];
}

export const toPendingEvent = (def: EventDef, state: GameState, ctx: EngineContext): PendingEvent => ({
  id: def.id,
  title: def.title,
  prompt: def.prompt(state, ctx),
  choices: def.choices.map((c) => ({ id: c.id, text: c.text })),
});
