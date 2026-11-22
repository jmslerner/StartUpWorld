/**
 * The company phase as the world layer sees it.
 *
 * `GameState.companyPhase` comes from a save, and neither parseSave nor
 * migrateState checks it, so a corrupted or hand-edited save can carry any
 * string. Every phase-keyed table in the world (floor plans, set dressing,
 * music styles, footprint margins) is indexed by it, so the world never reads
 * the raw value: it goes through `worldPhaseOf` first.
 */
import type { CompanyPhase } from "../types/game";

/** The five phases, smallest office first (the engine's order). */
export const COMPANY_PHASES: readonly CompanyPhase[] = ["garage", "coworking", "office", "unicorn", "public"];

const KNOWN_PHASES: ReadonlySet<string> = new Set(COMPANY_PHASES);

export const isCompanyPhase = (value: unknown): value is CompanyPhase =>
  typeof value === "string" && KNOWN_PHASES.has(value);

/**
 * The phase the world draws for a company phase: the phase itself when it is
 * one of the five, "garage" for anything else.
 *
 * Garage because it is the phase every run starts in, and because it agrees
 * with the engine's own reading of an unknown phase: `phaseAtLeast` places it
 * below every phase, so nothing is for sale, and nothing is for sale in the
 * garage either (no asset unlocks before coworking). The engine re-derives the
 * phase from stage and MRR as the run goes on, so the world moves out of the
 * garage with the normal phase-change animation once it does.
 */
export const worldPhaseOf = (phase: unknown): CompanyPhase => (isCompanyPhase(phase) ? phase : "garage");
