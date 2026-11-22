/** Split from src/world/types.ts (M5): the WorldEvent union derived from snapshot diffs. Re-exported by ../types. */

import type { AssetId, CompanyPhase, EndingType, OfferKind, ReceptionTier, Stage, TeamRole } from "../../types/game";
import type { EnergyBand } from "./snapshot";

export type WorldEvent =
  | { type: "run-reset" }
  | { type: "setup-completed" }
  | { type: "week-advanced"; week: number }
  /**
   * `personIds` are the people who now have a visible place in the office (capped);
   * `count` is the true head-count change for the role (absent = `personIds.length`).
   */
  | { type: "hired"; role: TeamRole; personIds: string[]; count?: number }
  | { type: "departed"; role: TeamRole; personIds: string[]; count?: number }
  | { type: "ship"; ok: boolean; reputationDelta: number }
  | { type: "launch"; ok: boolean; usersDelta: number }
  | { type: "pitch"; ok: boolean }
  | { type: "raise"; ok: boolean; amount: number; source: "vc" | "bootstrap" }
  | { type: "board-action"; action: "dinner" | "gift" | "blackmail"; ok: boolean }
  | { type: "pricing-changed" }
  | { type: "cash-changed"; delta: number }
  | { type: "users-changed"; delta: number }
  | { type: "phase-changed"; from: CompanyPhase; to: CompanyPhase }
  | { type: "stage-changed"; from: Stage; to: Stage }
  | { type: "asset-acquired"; assetId: AssetId }
  | { type: "event-opened"; title: string }
  | { type: "event-resolved" }
  | { type: "easter-egg"; command: string }
  | { type: "command-failed"; command: string }
  | { type: "game-over"; ending: EndingType }
  // ── People and product builds ──
  /** Somebody handed in notice: a recruiter's offer, or burnout. */
  | { type: "offer-landed"; personId: string; kind: OfferKind; buildAtRisk: string | null }
  /** A person holding an offer was kept (`retain`). */
  | { type: "retained"; personId: string }
  /**
   * Somebody who was holding an offer walked out (follows their `departed`). `buildAtRisk` is the
   * slug of the build that lost its lead (and a quarter of its progress) with them.
   */
  | { type: "resigned"; personId: string; role: TeamRole; kind: OfferKind; buildAtRisk: string | null }
  /** Somebody was put on a build (or back on the day job: buildId null). */
  | { type: "staffed"; personId: string; buildId: string | null }
  /** Credited on a release. */
  | { type: "experience"; personIds: string[] }
  | { type: "energy-band"; personId: string; band: EnergyBand }
  | { type: "candidates-shown"; role: TeamRole }
  | { type: "build-started"; buildId: string }
  | { type: "build-cancelled"; buildId: string }
  /** A build shipped as a release (replaces the `ship` event for that command). */
  | { type: "released"; buildId: string; name: string; tier: ReceptionTier; reception: number }
  /** `to < from`: a lead walked out and took a quarter of the work with them. */
  | { type: "build-progress"; buildId: string; from: number; to: number }
  | { type: "surprise"; buildId: string }
  | { type: "crunch-changed"; buildId: string; on: boolean }
  | { type: "cruft-band"; band: CruftBand; rising: boolean }
  | { type: "moat-band"; band: MoatBand; rising: boolean };

/** Cruft at 15 / 35 / 60. */
export type CruftBand = "clean" | "taped" | "spaghetti" | "sparking";
/** Moat at 10 / 25 / 50. */
export type MoatBand = "puddle" | "ditch" | "moat" | "alligator";

export type WorldEventType = WorldEvent["type"];

