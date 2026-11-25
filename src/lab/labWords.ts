/**
 * Every word the lab page shows, in one place so that a test can read them. Plain words; nothing here names a
 * company, a product or a person.
 */
import type { OfficeIndex } from "../world/types/scene";
import type { LabStats, LabStatus } from "./lab";
import { CAPACITY } from "./labScene";

export const LAB_WORDS = {
  title: "Office lab",
  intro: "An office made of numbers. Nothing here is saved and nothing reaches the game.",
  showControls: "Controls",
  hideControls: "Hide controls",
  people: "People",
  product: "Product",
  growth: "Growth",
  recruiting: "Recruiting",
  away: "Away",
  leaving: "Leaving",
  arriving: "Expected hires",
  fewer: "One fewer",
  more: "One more",
  office: "Office",
  fitOffice: "Fits all",
  year: "Year",
  era: "Era",
  seed: "Seed",
  endYear: "End year",
  reset: "Reset",
  keepAwake: "Keep the view moving",
  shown: "Show the 3D view",
  figures: "Figures",
  scene: "Scene",
  off: "The 3D view is switched off.",
} as const;

/** The five offices, smallest first. */
export const OFFICE_NAMES: readonly string[] = ["Garage", "Shared office", "Own office", "Full floor", "Campus"];

const STATUS_WORDS: Readonly<Record<LabStatus, string>> = {
  starting: "opening",
  running: "running",
  unsupported: "cannot be shown on this device",
  "context-lost": "stopped drawing",
  off: "switched off",
  failed: "failed",
};

const number = (value: number): string => value.toLocaleString("en-US");

/** An office as the list of offices names it: "Own office (holds 22)". */
export const officeChoice = (office: OfficeIndex): string => `${OFFICE_NAMES[office]} (holds ${number(CAPACITY[office])})`;

/** The office the head count picks, as the list of offices names it: "Fits all: Own office". */
export const fitChoice = (office: OfficeIndex): string => `${LAB_WORDS.fitOffice}: ${OFFICE_NAMES[office]}`;

/** "24 people. This office holds 22." */
export const headCountLine = (people: number, capacity: number): string =>
  `${number(people)} ${people === 1 ? "person" : "people"}. This office holds ${number(capacity)}.`;

/** The line of figures read from the renderer, one entry for each figure. */
export const figureLines = (stats: LabStats): readonly string[] => [
  `View: ${STATUS_WORDS[stats.status]}`,
  `Draw calls: ${number(stats.drawCalls)}`,
  `Triangles: ${number(stats.triangles)}`,
  `People drawn: ${number(stats.figures)}`,
  `People on the sign: ${number(stats.hidden)}`,
  `Frames in the last second: ${number(stats.framesLastSecond)}`,
];
