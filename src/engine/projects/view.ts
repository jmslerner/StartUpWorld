// Read-only selectors for the terminal and the 3D office (TYCOON-SPEC §9.1). The 3D team codes against these shapes.
// All selectors are side-effect free, draw no RNG and accept legacy (slice-less) states (they return empty lists).
import type { Build, BuildSize, BuildType, GameState, ReceptionTier, Release } from "../../types/game";
import { BUILD_SIZES, BUILD_TYPES } from "../tycoon/constants";
import { buildsOf, leadOf, staffOf } from "../tycoon/roster";
import { phaseAtLeast } from "../assets";
import { SIZES, TYPES } from "./constants";
import { findBuild } from "./commands";
import {
  cruftWord, forecastOf, isBuilt, moatWord, pct, qualityOf, scopeFor, sizeUnlocked, slotsFor, typeUnlocked, weeksLate,
} from "./work";

export { forecastOf };

export interface Forecast {
  shippable: boolean;
  now: number;
  finished: number;
  spread: number;
  /** null = nobody is producing points; every text form prints "finished ≈ ? (nobody on it)" */
  eta: number | null;
  tierNow: ReceptionTier;
  tierFinished: ReceptionTier;
  /** Cruft a release shipped NOW would add for being unfinished (0 when built, and for plumbing). */
  rushCruft: number;
}

export interface BuildFacts {
  id: string;
  name: string;
  slug: string;
  type: BuildType;
  typeLabel: string;
  size: BuildSize;
  sizeLabel: string;
  pct: number;
  progress: number;
  scope: number;
  surprises: number;
  polish: number;
  quality: number;
  crunch: boolean;
  /** drives the 3D pizza boxes */
  crunchWeeks: number;
  startedWeek: number;
  dueWeek: number;
  weeksLate: number;
  built: boolean;
  seats: number;
  staffIds: string[];
  leadId: string | null;
  forecast: Forecast;
}

export interface ProductFacts {
  cruft: number;
  cruftWord: string;
  moat: number;
  moatWord: string;
  slots: number;
  slotsUsed: number;
  shippedCount: number;
  /** = product.shipped (<= 12), most recent first */
  recent: Release[];
}

export interface StartOption {
  type: BuildType;
  size: BuildSize;
  unlocked: boolean;
  /** e.g. "needs the office phase" */
  lockedReason: string | null;
  /** scope includes inflation */
  scope: number;
  kickoff: number;
  seats: number;
}

const toFacts = (s: GameState, b: Build): BuildFacts => {
  const staff = staffOf(s, b.id);
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    type: b.type,
    typeLabel: TYPES[b.type].label,
    size: b.size,
    sizeLabel: SIZES[b.size].label,
    pct: pct(b),
    progress: b.progress,
    scope: b.scope,
    surprises: b.surprises,
    polish: b.polish,
    quality: qualityOf(s, b),
    crunch: b.crunch,
    crunchWeeks: b.crunchWeeks,
    startedWeek: b.startedWeek,
    dueWeek: b.dueWeek,
    weeksLate: weeksLate(b, s.week),
    built: isBuilt(b),
    seats: SIZES[b.size].seats,
    staffIds: staff.map((e) => e.id),
    leadId: leadOf(s, b)?.id ?? null,
    forecast: forecastOf(s, b),
  };
};

/** Every active build, board order. */
export const listBuilds = (s: GameState): BuildFacts[] => buildsOf(s).map((b) => toFacts(s, b));

/** One active build by id, slug or a unique slug prefix (2+ characters); null when there is no such build. */
export const describeBuild = (s: GameState, idOrSlug: string): BuildFacts | null => {
  const found = findBuild(s, idOrSlug);
  return found.ok ? toFacts(s, found.build) : null;
};

const NO_RELEASES: Release[] = [];

export const productSummary = (s: GameState): ProductFacts => {
  const product = s.product;
  const cruft = product?.cruft ?? 0;
  const moat = product?.moat ?? 0;
  return {
    cruft,
    cruftWord: cruftWord(cruft),
    moat,
    moatWord: moatWord(moat),
    slots: slotsFor(s),
    slotsUsed: product?.active.length ?? 0,
    shippedCount: product?.shippedCount ?? 0,
    recent: product?.shipped ?? NO_RELEASES,
  };
};

/** The catalogue, every type x size: what is unlocked, why not, the inflated scope, kickoff and seats; and how many slots are free. */
export const startOptions = (s: GameState): { slotsFree: number; options: StartOption[] } => {
  const options: StartOption[] = [];
  for (const type of BUILD_TYPES) {
    for (const size of BUILD_SIZES) {
      const typeOk = typeUnlocked(s, type);
      const sizeOk = sizeUnlocked(s, size);
      const needs = !typeOk && !sizeOk
        ? (phaseAtLeast(TYPES[type].minPhase, SIZES[size].minPhase) ? TYPES[type].minPhase : SIZES[size].minPhase)
        : !typeOk ? TYPES[type].minPhase : SIZES[size].minPhase;
      options.push({
        type,
        size,
        unlocked: typeOk && sizeOk,
        lockedReason: typeOk && sizeOk ? null : `needs the ${needs} phase`,
        scope: scopeFor(s, type, size),
        kickoff: SIZES[size].kickoff,
        seats: SIZES[size].seats,
      });
    }
  }
  return { slotsFree: Math.max(0, slotsFor(s) - buildsOf(s).length), options };
};
