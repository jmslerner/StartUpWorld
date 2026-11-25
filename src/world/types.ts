/**
 * Shared contracts for the 3D world layer.
 *
 * The world is a *view* of the game and reads nothing of it: its one input is an office scene (./types/scene),
 * plain data built outside this folder. Everything here is either
 *  - that input and what the world derives from it (OfficeScene, SceneEvent, WorldFrame), or
 *  - an interface between the three.js systems and the React shell.
 *
 * These files hold types, and the one list TEAMS; none of them loads three. The types live per subsystem under
 * ./types/ and are re-exported here in full, so `from "../types"` and `from "./types"` reach all of them.
 */
export * from "./types/geometry";
export * from "./types/scene";
export * from "./types/events";
export * from "./types/office";
export * from "./types/seating";
export * from "./types/interaction";
export * from "./types/fx";
export * from "./types/system";
export * from "./types/handle";
