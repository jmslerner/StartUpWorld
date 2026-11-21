import type {
  Build, BuildSize, BuildType, Candidate, Employee, GameState, OfferKind, PeopleState, ProductState, QuirkId, Release, ReceptionTier, TeamRole,
} from "../../types/game";
import {
  ACTIVE_BUILDS_MAX, BUILD_SIZES, BUILD_TYPES, CANDIDATE_POOL_MAX, NAME_MAX, PERSON_NAME_MAX, POLISH_MAX, QUIRKS, RELEASE_LOG_MAX,
  ROLE_ORDER, ROSTER_CAP, SURPRISE_MAX,
} from "./constants";
import { emptyPeople, emptyProduct, reconcileRoster, serialOf, standardSalary } from "./roster";

// Save migration and the tycoon normalizer (TYCOON-SPEC §8). Imports only types, tycoon/constants and tycoon/roster:
// never people/ or projects/. Build defaults are structural (scope falls back to baseScope, else 5; units to 1).

export const SAVE_VERSION = 3;

const DEFAULT_SCOPE = 5;
const DEFAULT_UNITS = 1;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TIERS: ReceptionTier[] = ["breakout", "solid", "shrug", "flop"];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const int = (x: unknown, min: number, max: number, dflt: number): number => (isNum(x) ? Math.min(max, Math.max(min, Math.round(x))) : dflt);
const num = (x: unknown, min: number, max: number, dflt: number): number => (isNum(x) ? Math.min(max, Math.max(min, x)) : dflt);
const u32 = (x: unknown): number => (isNum(x) ? x >>> 0 : 0);
const str = (x: unknown, maxLen: number): string => (typeof x === "string" ? x.trim().slice(0, maxLen).trim() : "");
const isRole = (x: unknown): x is TeamRole => typeof x === "string" && (ROLE_ORDER as string[]).includes(x);
const isQuirk = (x: unknown): x is QuirkId => typeof x === "string" && (QUIRKS as string[]).includes(x);
const isType = (x: unknown): x is BuildType => typeof x === "string" && (BUILD_TYPES as string[]).includes(x);
const isSize = (x: unknown): x is BuildSize => typeof x === "string" && (BUILD_SIZES as string[]).includes(x);
const isTier = (x: unknown): x is ReceptionTier => typeof x === "string" && (TIERS as string[]).includes(x);

const normEmployee = (raw: unknown, week: number): Employee | null => {
  if (!isObj(raw) || !isRole(raw.role) || typeof raw.id !== "string" || !/^e\d+$/.test(raw.id)) return null;
  const buildId = typeof raw.buildId === "string" ? raw.buildId : null;
  const offerDueWeek = int(raw.offerDueWeek, 0, 1_000_000, 0);
  const offerKind: OfferKind | null =
    offerDueWeek === 0 ? null : raw.offerKind === "recruiter" || raw.offerKind === "burnout" ? raw.offerKind : "recruiter";
  return {
    id: raw.id,
    name: str(raw.name, PERSON_NAME_MAX) || `Employee ${raw.id}`,
    role: raw.role,
    pace: int(raw.pace, 1, 5, 3),
    craft: int(raw.craft, 1, 5, 3),
    quirk: isQuirk(raw.quirk) ? raw.quirk : null,
    salary: num(raw.salary, 1, 1_000_000, standardSalary(raw.role)),
    energy: int(raw.energy, 0, 100, 100),
    hiredWeek: int(raw.hiredWeek, 1, week, week),
    shipped: int(raw.shipped, 0, 1_000_000, 0),
    buildId,
    joinedWeek: buildId === null ? 0 : int(raw.joinedWeek, 1, week, week),
    engaged: raw.engaged === true || buildId !== null,
    offerDueWeek,
    offerKind,
    leadOnNotice: offerDueWeek > 0 && typeof raw.leadOnNotice === "string" ? raw.leadOnNotice : null,
    retainedWeek: int(raw.retainedWeek, 0, week, 0),
    ledWeek: int(raw.ledWeek, 0, week, 0),
  };
};

const normCandidate = (raw: unknown, role: TeamRole): Candidate | null => {
  if (!isObj(raw) || typeof raw.id !== "string" || !/^c\d+$/.test(raw.id)) return null;
  const pace = int(raw.pace, 1, 5, 3);
  const craft = int(raw.craft, 1, 5, 3);
  const vetted = raw.vetted === true;
  return {
    id: raw.id,
    name: str(raw.name, PERSON_NAME_MAX) || `Candidate ${raw.id}`,
    role,
    pace,
    craft,
    claimedPace: vetted ? pace : int(raw.claimedPace, pace, 5, pace),
    claimedCraft: vetted ? craft : int(raw.claimedCraft, craft, 5, craft),
    quirk: isQuirk(raw.quirk) ? raw.quirk : null,
    vetted,
    ask: num(raw.ask, 1, 1_000_000, standardSalary(role)),
  };
};

/** Accepts anything and returns a valid people slice (§8.2). Does not reconcile. */
export const normalizePeople = (raw: unknown, week: number): PeopleState => {
  if (!isObj(raw)) return emptyPeople();
  const seen = new Set<string>();
  let roster: Employee[] = [];
  for (const entry of Array.isArray(raw.roster) ? raw.roster : []) {
    const e = normEmployee(entry, week);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    roster.push(e);
  }
  if (roster.length > ROSTER_CAP) {
    // Keep everyone the player has worked with, then the lowest serials.
    const keep = new Set(
      [...roster].sort((a, b) => Number(b.engaged) - Number(a.engaged) || serialOf(a.id) - serialOf(b.id)).slice(0, ROSTER_CAP).map((e) => e.id),
    );
    roster = roster.filter((e) => keep.has(e.id));
  }
  const candidates: PeopleState["candidates"] = {};
  if (isObj(raw.candidates)) {
    for (const role of ROLE_ORDER) {
      const pool = raw.candidates[role];
      if (!Array.isArray(pool)) continue;
      const ids = new Set<string>();
      const list: Candidate[] = [];
      for (const entry of pool) {
        const c = normCandidate(entry, role);
        if (!c || ids.has(c.id)) continue;
        ids.add(c.id);
        list.push(c);
      }
      if (list.length) candidates[role] = list.slice(0, CANDIDATE_POOL_MAX);
    }
  }
  const maxSerial = roster.reduce((m, e) => Math.max(m, serialOf(e.id)), 0);
  let maxCandidate = 0;
  for (const pool of Object.values(candidates)) for (const c of pool ?? []) maxCandidate = Math.max(maxCandidate, serialOf(c.id));
  return {
    rng: u32(raw.rng),
    nextId: Math.max(int(raw.nextId, 1, 1e9, 1), maxSerial + 1),
    nextCandidateId: Math.max(int(raw.nextCandidateId, 1, 1e9, 1), maxCandidate + 1),
    roster,
    candidates,
    candidatesWeek: int(raw.candidatesWeek, 0, 1_000_000, 0),
    departures: int(raw.departures, 0, 1e9, 0),
  };
};

const normBuild = (raw: unknown, week: number): Build | null => {
  if (!isObj(raw) || typeof raw.id !== "string" || !/^b\d+$/.test(raw.id)) return null;
  if (!isType(raw.type) || !isSize(raw.size)) return null;
  if (typeof raw.slug !== "string" || raw.slug.length > NAME_MAX || !SLUG_RE.test(raw.slug)) return null;
  const baseScopeRaw = isNum(raw.baseScope) && raw.baseScope > 0 ? raw.baseScope : null;
  const scope = isNum(raw.scope) && raw.scope > 0 ? Math.min(100_000, raw.scope) : (baseScopeRaw ?? DEFAULT_SCOPE);
  const progress = num(raw.progress, 0, scope, 0);
  const built = progress >= scope;
  const qPts = num(raw.qPts, 0, 1e9, 0);
  return {
    id: raw.id,
    name: str(raw.name, NAME_MAX) || raw.slug,
    slug: raw.slug,
    type: raw.type,
    size: raw.size,
    units: num(raw.units, 0, 10_000, DEFAULT_UNITS),
    baseScope: baseScopeRaw === null ? scope : Math.min(100_000, baseScopeRaw),
    scope,
    progress,
    qSum: qPts > 0 ? num(raw.qSum, 0, 1e11, 0) : 0,
    qPts,
    polish: num(raw.polish, 0, POLISH_MAX, 0),
    surprises: int(raw.surprises, 0, SURPRISE_MAX, 0),
    crunch: raw.crunch === true && !built,
    crunchWeeks: int(raw.crunchWeeks, 0, 1_000_000, 0),
    crunchedWeek: int(raw.crunchedWeek, 0, week, 0),
    startedWeek: int(raw.startedWeek, 1, week, week),
    dueWeek: int(raw.dueWeek, 0, 1_000_000, week),
    // Built means it has a week it became ready; a built build that says 0 gets the current week.
    readyWeek: built ? (isNum(raw.readyWeek) && raw.readyWeek >= 1 ? int(raw.readyWeek, 1, week, week) : week) : 0,
  };
};

const normRelease = (raw: unknown): Release | null => {
  if (!isObj(raw) || !isType(raw.type) || !isSize(raw.size) || !isTier(raw.tier)) return null;
  return {
    id: str(raw.id, 12) || "b0",
    name: str(raw.name, NAME_MAX) || "Untitled",
    type: raw.type,
    size: raw.size,
    week: int(raw.week, 1, 1_000_000, 1),
    reception: int(raw.reception, 0, 100, 50),
    tier: raw.tier,
    quality: int(raw.quality, 0, 100, 50),
    leadName: typeof raw.leadName === "string" ? raw.leadName.slice(0, PERSON_NAME_MAX) : null,
  };
};

/** Accepts anything and returns a valid product slice (§8.2). */
export const normalizeProduct = (raw: unknown, week: number): ProductState => {
  if (!isObj(raw)) return emptyProduct();
  const slugs = new Set<string>();
  const ids = new Set<string>();
  const active: Build[] = [];
  for (const entry of Array.isArray(raw.active) ? raw.active : []) {
    const b = normBuild(entry, week);
    if (!b || slugs.has(b.slug) || ids.has(b.id)) continue;
    slugs.add(b.slug);
    ids.add(b.id);
    active.push(b);
  }
  const shipped: Release[] = [];
  for (const entry of Array.isArray(raw.shipped) ? raw.shipped : []) {
    const r = normRelease(entry);
    if (r) shipped.push(r);
  }
  const keptActive = active.slice(0, ACTIVE_BUILDS_MAX);
  const keptShipped = shipped.slice(0, RELEASE_LOG_MAX);
  const byType = emptyProduct().shippedByType;
  if (isObj(raw.shippedByType)) for (const t of BUILD_TYPES) byType[t] = int(raw.shippedByType[t], 0, 1e9, 0);
  // I3: a new build must never reuse the id of an active build or of a filed release.
  const maxSerial = Math.max(0, ...keptActive.map((b) => serialOf(b.id)), ...keptShipped.map((r) => serialOf(r.id)));
  return {
    rng: u32(raw.rng),
    nextId: Math.max(int(raw.nextId, 1, 1e9, 1), maxSerial + 1),
    active: keptActive,
    shipped: keptShipped,
    shippedCount: Math.max(int(raw.shippedCount, 0, 1e9, 0), keptShipped.length),
    shippedByType: byType,
    cruft: num(raw.cruft, 0, 100, 0),
    moat: num(raw.moat, 0, 100, 0),
    arpuCarry: num(raw.arpuCarry, 0, 0.999999, 0),
    lastHotfixWeek: int(raw.lastHotfixWeek, 0, 1_000_000, 0),
  };
};

/** Makes any partially-shaped tycoon data safe, then reconciles. Pure. Touches nothing outside the two slices. */
export const normalizeTycoon = (state: GameState): GameState => {
  const week = Math.max(1, Math.round(Number.isFinite(state.week) ? state.week : 1));
  return reconcileRoster({ ...state, people: normalizePeople(state.people, week), product: normalizeProduct(state.product, week) });
};

/** v1 → v2 is today's step (assets); v2 → v3 adds and fills the tycoon slices. Idempotent. */
export const migrateState = (state: GameState, fromVersion: number): GameState => {
  let s = state;
  if (fromVersion < 2 && !Array.isArray(s.assets)) s = { ...s, assets: [] };
  return normalizeTycoon(s);
};
