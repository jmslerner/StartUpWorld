/**
 * The lab's scenes: an office made of numbers typed into the page or given in its address. Pure: no page, no
 * three.js, nothing of the game. The lab makes up its numbers; it does not read the game's state or its rules.
 */
import { TEAMS, type OfficeIndex, type OfficeScene, type Team } from "../world/types/scene";

/** How many people each office holds: the lab's own copy of the starting numbers. */
export const CAPACITY: readonly number[] = Object.freeze([4, 9, 22, 40, 150]);

/** The largest number of people the lab takes for any one count. Far past anything the world draws. */
export const MAX_COUNT = 9999;
const MAX_YEAR = 9999;
const MAX_SEED = 0xffffffff;
const MAX_ERA_LENGTH = 40;

const FIRST_YEAR = 1990;
const FIRST_ERA = "flat";
const LAST_OFFICE = (CAPACITY.length - 1) as OfficeIndex;

/** What the page may change of a scene. Every field is optional; what is left out stays. */
export interface SceneEdit {
  readonly product?: number;
  readonly growth?: number;
  readonly recruiting?: number;
  readonly away?: number;
  readonly leaving?: number;
  readonly arriving?: number;
  readonly office?: OfficeIndex;
  readonly year?: number;
  readonly era?: string;
  readonly seed?: number;
}

/** What the address says besides the scene. */
export interface LabOptions {
  /** The office follows the head count (true), or stays the one chosen (false). */
  readonly fitOffice: boolean;
  /** The controls are on the page (true) or put away, leaving the whole window to the office (false). */
  readonly panelOpen: boolean;
}

/** A whole number from 0 to `max`. Anything that is not a number is `fallback`. */
const whole = (value: number, max: number, fallback = 0): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(value)));
};

/** Half of a letter that takes two UTF-16 units (an emoji, say) with its other half missing. */
const HALF_LETTER = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** `text` without any half letter: what is left can always be written into an address. */
const wholeLetters = (text: string): string => text.replace(HALF_LETTER, "");

/** An era of at most 40 letters, counted as letters (an emoji is one), never cut through one. */
const cleanEra = (era: string): string =>
  Array.from(wholeLetters(era).trim()).slice(0, MAX_ERA_LENGTH).join("").trim() || FIRST_ERA;

/** Everyone the office has to hold this year: people at work, away and leaving. People expected are not in yet. */
export const headCount = (scene: OfficeScene): number =>
  TEAMS.reduce((sum, team) => sum + scene.teams[team], 0) + scene.away + scene.leaving;

/** The smallest office that holds `people`, never smaller than `atLeast`; the campus when none is big enough. */
export const officeFor = (people: number, atLeast: OfficeIndex = 0): OfficeIndex => {
  for (let office = atLeast; office < LAST_OFFICE; office++) {
    if (CAPACITY[office] >= people) return office as OfficeIndex;
  }
  return LAST_OFFICE;
};

interface Parts {
  readonly teams: Readonly<Record<Team, number>>;
  readonly away: number;
  readonly leaving: number;
  readonly arriving: number;
  readonly office: OfficeIndex;
  readonly year: number;
  readonly era: string;
  readonly seed: number;
}

/** The one place a lab scene is put together, so that the run id and the capacity always follow the rest. */
const scene = (parts: Parts): OfficeScene => ({
  runId: `lab:${parts.seed}`,
  seed: parts.seed,
  year: parts.year,
  office: parts.office,
  capacity: CAPACITY[parts.office],
  era: parts.era,
  teams: parts.teams,
  away: parts.away,
  leaving: parts.leaving,
  arriving: parts.arriving,
  ending: null,
});

const fitted = (parts: Parts, fit: boolean): OfficeScene => {
  const made = scene(parts);
  return fit ? scene({ ...parts, office: officeFor(headCount(made)) }) : made;
};

const params = (query: string): URLSearchParams => {
  try {
    return new URLSearchParams(query);
  } catch {
    return new URLSearchParams();
  }
};

/**
 * A count in the address: digits only, and at most `max` however many digits there are. Left out, it is `missing`;
 * anything else given is nobody.
 */
const readCount = (given: string | null, missing: number, max = MAX_COUNT): number => {
  if (given === null) return missing;
  if (!/^\d+$/.test(given)) return 0;
  // Hundreds of digits make Infinity, which is no number: past the largest, every count is the largest.
  const value = Number(given);
  return value > max ? max : whole(value, max);
};

const readOffice = (given: string | null): OfficeIndex | null => (given !== null && /^[0-4]$/.test(given) ? (Number(given) as OfficeIndex) : null);

/**
 * The scene an address asks for:
 * `?office=2&product=9&growth=8&recruiting=3&away=1&leaving=0&arriving=2&year=2004&era=bust&seed=7`.
 * Whatever is left out has its usual value (three people in Product, nobody else, 1990, seed 0), and nonsense is
 * read as nothing. An address that names no office, or one that does not exist, gets the smallest office that
 * holds everyone.
 */
export const sceneFromQuery = (query: string): OfficeScene => {
  const given = params(query);
  const year = given.get("year");
  const office = readOffice(given.get("office"));
  return fitted(
    {
      teams: {
        product: readCount(given.get("product"), 3),
        growth: readCount(given.get("growth"), 0),
        recruiting: readCount(given.get("recruiting"), 0),
      },
      away: readCount(given.get("away"), 0),
      leaving: readCount(given.get("leaving"), 0),
      arriving: readCount(given.get("arriving"), 0),
      office: office ?? 0,
      year: year !== null && /^\d{1,4}$/.test(year) ? Number(year) : FIRST_YEAR,
      era: cleanEra(given.get("era") ?? ""),
      seed: readCount(given.get("seed"), 0, MAX_SEED),
    },
    office === null
  );
};

/**
 * The address of a scene, always with every part and always in the same order. An era handed in whole (by the
 * checks' `setScene`) may hold half a letter, which no address can carry: it is left out.
 */
export const queryFromScene = (of: OfficeScene): string =>
  `?office=${of.office}&product=${of.teams.product}&growth=${of.teams.growth}&recruiting=${of.teams.recruiting}` +
  `&away=${of.away}&leaving=${of.leaving}&arriving=${of.arriving}&year=${of.year}&era=${encodeURIComponent(wholeLetters(of.era))}&seed=${of.seed}`;

/** What an address says besides the scene: `fit=1` (or no office at all) and `panel=0`. */
export const labOptionsFromQuery = (query: string): LabOptions => {
  const given = params(query);
  return {
    fitOffice: given.get("fit") === "1" || readOffice(given.get("office")) === null,
    panelOpen: given.get("panel") !== "0",
  };
};

/** The page's whole address: the scene exactly as `queryFromScene` writes it, then `&fit=1` and `&panel=0` where they apply. */
export const queryFromLab = (of: OfficeScene, options: LabOptions): string =>
  `${queryFromScene(of)}${options.fitOffice ? "&fit=1" : ""}${options.panelOpen ? "" : "&panel=0"}`;

/**
 * A scene changed by hand: a new scene, with every number made whole and not negative. With `fit` the office is
 * the smallest that holds everyone, bigger or smaller than before; without, it stays (or is the one in `edit`).
 */
export const editScene = (of: OfficeScene, edit: SceneEdit, fit: boolean): OfficeScene => {
  const count = (given: number | undefined, kept: number): number => (given === undefined ? kept : whole(given, MAX_COUNT));
  return fitted(
    {
      teams: {
        product: count(edit.product, of.teams.product),
        growth: count(edit.growth, of.teams.growth),
        recruiting: count(edit.recruiting, of.teams.recruiting),
      },
      away: count(edit.away, of.away),
      leaving: count(edit.leaving, of.leaving),
      arriving: count(edit.arriving, of.arriving),
      office: edit.office === undefined ? of.office : (readOffice(String(edit.office)) ?? of.office),
      year: edit.year === undefined ? of.year : whole(edit.year, MAX_YEAR, FIRST_YEAR),
      era: edit.era === undefined ? of.era : cleanEra(edit.era),
      seed: edit.seed === undefined ? of.seed : whole(edit.seed, MAX_SEED),
    },
    fit
  );
};

/** Two scenes say the same thing, field by field. */
export const sameScene = (a: OfficeScene, b: OfficeScene): boolean =>
  a.runId === b.runId &&
  a.seed === b.seed &&
  a.year === b.year &&
  a.office === b.office &&
  a.capacity === b.capacity &&
  a.era === b.era &&
  TEAMS.every((team) => a.teams[team] === b.teams[team]) &&
  a.away === b.away &&
  a.leaving === b.leaving &&
  a.arriving === b.arriving &&
  a.ending === b.ending;

/** The team with the fewest people; the first of them in the teams' order when several have as few. */
const smallestTeam = (teams: Readonly<Record<Team, number>>): Team =>
  TEAMS.reduce((smallest, team) => (teams[team] < teams[smallest] ? team : smallest), TEAMS[0]);

/**
 * The year plays out: people leaving leave, whoever was away comes back and people expected are hired, each into
 * the team that is smallest at that moment, nobody is away, the year goes up by one, and the office is the
 * smallest that holds everyone, though never a smaller one than before.
 */
export const endYear = (of: OfficeScene): OfficeScene => {
  const teams: Record<Team, number> = { ...of.teams };
  for (let joining = Math.min(of.away + of.arriving, MAX_COUNT * 2); joining > 0; joining--) {
    const team = smallestTeam(teams);
    teams[team] = Math.min(MAX_COUNT, teams[team] + 1);
  }
  const people = TEAMS.reduce((sum, team) => sum + teams[team], 0);
  return scene({
    teams,
    away: 0,
    leaving: 0,
    arriving: 0,
    office: officeFor(people, of.office),
    year: Math.min(MAX_YEAR, of.year + 1),
    era: of.era,
    seed: of.seed,
  });
};
