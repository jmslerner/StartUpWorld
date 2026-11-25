// The rules engine's public surface. Everything here is pure: no UI, no clock, no globals.

export { createGame } from "./setup";
export { resolveTurn } from "./resolveTurn";
export type { TurnResult } from "./resolveTurn";
export { defaultPlan, normalizePlan, normalizePlanFor, raiseBlocker } from "./plan";
export { estimateRivals, projectTurn } from "./project";
export type { Projection, RivalEstimate } from "./project";
export type { CheckedPlan, RaiseBlocker } from "./plan";
export { companyRunway, publicCompany, publicReport, viewFor } from "./view";
export { replayGame } from "./replay";
export type { GameRecord, Replay } from "./replay";
export { findCard } from "./events";
export * from "./formulas";
export * from "./types";
