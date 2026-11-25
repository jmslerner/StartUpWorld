// The rules engine's public surface. Everything here is pure: no UI, no clock, no globals.

export { createGame, seatCompany } from "./setup";
export { CAREER_PITCHES, ENTRANT_PITCHES, NAME_ENDS, NAME_STARTS, PITCHES, drawEntrant, drawName, picker } from "./cast";
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
export {
  boardPaused,
  closingValuation,
  datedCardFor,
  datedHeldCeiling,
  eraIndexOf,
  heldCeiling,
  hiresWithinCap,
  isCpuKind,
  listingBlocker,
  listingEffects,
  listingOf,
  marketTurn,
  movingBill,
  officeFor,
  officeMove,
  peopleCap,
  rescueEffects,
  rulesForTurn,
  turnOf,
  upcomingShift,
  withMoving,
  yearOf,
} from "./career";
export type { ListingBlocker, RescueInput, ShiftNotice } from "./career";
export * from "./formulas";
export * from "./types";
