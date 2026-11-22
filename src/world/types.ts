/**
 * Shared contracts for the 3D world layer.
 *
 * The world is a *view* of the game: the engine (src/engine) stays the single
 * source of truth and remains turn-based. Everything here is either
 *  - a pure, serializable projection of GameState (WorldSnapshot, WorldEvent), or
 *  - an interface between the three.js systems and the React shell.
 *
 * Keep these files type-only (no runtime code) so they can be imported anywhere.
 *
 * M5: this file used to hold every contract in one 677-line list. The types now
 * live per subsystem under ./types/ and are re-exported here in full, so every
 * existing `from "../types"` / `from "./types"` import keeps working unchanged.
 */
export * from "./types/geometry";
export * from "./types/snapshot";
export * from "./types/events";
export * from "./types/office";
export * from "./types/seating";
export * from "./types/interaction";
export * from "./types/fx";
export * from "./types/system";
export * from "./types/handle";
