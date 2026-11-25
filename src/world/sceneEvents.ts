/**
 * What changed between two office scenes, as the few moments the world plays out.
 *
 * - The first scene has no events: the office is simply there.
 * - Another run, or an earlier year, is a reset and nothing else: everything is rebuilt.
 * - Otherwise, in this order: the year moved on, the company changed office, the run ended. An ending is reported
 *   once, when it appears. A changed plan within a year is no event: the cast (./cast.ts) says who moved.
 */
import type { OfficeScene, SceneEvent } from "./types";

export const sceneEvents = (prev: OfficeScene | null, next: OfficeScene): SceneEvent[] => {
  if (prev === null) return [];
  if (prev.runId !== next.runId || next.year < prev.year) return [{ kind: "run-reset" }];
  const events: SceneEvent[] = [];
  if (next.year > prev.year) events.push({ kind: "year-advanced", from: prev.year, to: next.year });
  if (next.office !== prev.office) events.push({ kind: "office-changed", from: prev.office, to: next.office });
  if (next.ending !== null && next.ending !== prev.ending) events.push({ kind: "ended", ending: next.ending });
  return events;
};
