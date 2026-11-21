/**
 * Who the people in the office are: deterministic employee names, plus the
 * player-facing vocabulary for roles (titles and "what does this hire do for me").
 *
 * Pure data + arithmetic. No engine state is read here; the role blurbs restate
 * engine rules in words and are pinned to the real engine by names.test.ts.
 */
import type { TeamRole } from "../types/game";
import { mix32 } from "./hash";

// ─────────────────────────────────────────────────────────────────────────────
// Name pools
//
// Both lists are interleaved by region so that any arithmetic walk through them
// yields a globally mixed team. ASCII only: names are drawn into canvas textures
// as well as HTML, and the monospace UI should never fall back to another font.
//
// The first names deliberately avoid every cofounder name the engine can pick
// (src/engine/actions.ts → setCofounderArchetype) so an employee is never
// mistaken for the cofounder.
//
// The list LENGTHS are load-bearing: they must stay two different primes (see
// `employeeName`). names.test.ts enforces this.
// ─────────────────────────────────────────────────────────────────────────────

const FIRST_NAMES: readonly string[] = [
  "Ingrid", "Yuki", "Amara", "Priya", "Leila", "Mateo", "Marcus", "Lars",
  "Mei", "Aroha", "Kwame", "Arjun", "Tariq", "Sofia", "Chiara", "Jun",
  "Zanele", "Naomi", "Tomas", "Ananya", "Fatima", "Ines", "Haruto", "Chidi",
  "Elena", "Tane", "Aiko", "Rohan", "Omar", "Beatriz", "Luca", "Grace",
  "Thabo", "Minjun", "Henrik", "Kavya", "Yasmin", "Rafael", "Nia", "Jiwoo",
  "Freya", "Owen", "Vikram", "Karim", "Lucia", "Ayo", "Wei", "Anouk",
  "Leilani", "Emil", "Lian", "Folake", "Meera", "Nadia", "Camila", "Hazel",
  "Stefan", "Hana", "Sipho", "Ishaan", "Samir", "Santiago", "Katya", "Ren",
  "Wanjiru", "Miles", "Malia", "Petra", "Sana", "Darius", "Valentina", "Daichi",
  "Jonas", "Kofi", "Linh", "Nikhil", "Soraya", "Caio", "Astrid", "Theo",
  "Imani", "Thanh", "Marek", "Aditi", "Elif", "Ximena", "Tunde", "Koa",
  "Kenji", "Maeve", "Nora", "Kabir", "Emre", "Renata", "Naledi", "Yuna",
  "Viktor",
];

const LAST_NAMES: readonly string[] = [
  "Ekstrom", "Tanaka", "Okafor", "Castillo", "Iyer", "Najjar", "Moreau", "Nakamura",
  "Bennett", "Novak", "Mensah", "Morales", "Mukherjee", "Karimi", "Hayashi", "Petrov",
  "Ngata", "Adeyemi", "Herrera", "Kowalski", "Yamamoto", "Kulkarni", "Nasser", "Jansen",
  "Ishikawa", "Dlamini", "Vargas", "Dahl", "Menon", "Demir", "Chen", "Conti",
  "Hayes", "Mwangi", "Mendoza", "Vogel", "Xu", "Pillai", "Yilmaz", "Dubois",
  "Nkosi", "Navarro", "Zhang", "Horvat", "Desai", "Mansour", "Kang", "Popescu",
  "Diallo", "Carvalho", "Kealoha", "Virtanen", "Yoon", "Rahman", "Khoury", "Kamara",
  "Almeida", "Nielsen", "Ellis", "Nguyen", "Solberg", "Perera", "Rahimi", "Otieno",
  "Fuentes", "Tran", "Byrne",
];

export const FIRST_NAME_COUNT = FIRST_NAMES.length;
export const LAST_NAME_COUNT = LAST_NAMES.length;

/** Number of distinct full names a run can hand out before repeating. */
export const UNIQUE_NAME_COUNT = FIRST_NAME_COUNT * LAST_NAME_COUNT;

/**
 * Fixed position of each role in the name sequence. This is NOT display order
 * (see ROLE_ORDER in snapshot.ts) and must never be reordered: doing so would
 * rename every employee in every existing save.
 */
const ROLE_ORDINAL: Record<TeamRole, number> = {
  engineering: 0,
  design: 1,
  product: 2,
  data: 3,
  marketing: 4,
  sales: 5,
  ops: 6,
  hr: 7,
  legal: 8,
  executive: 9,
};
const ROLE_SLOTS = 10;

export interface EmployeeName {
  first: string;
  last: string;
  /** "Amara Okafor" — what PersonView.name carries. */
  full: string;
  /** "Amara O." — for tight labels. */
  short: string;
}

const ROMAN_NUMERALS: ReadonlyArray<readonly [number, string]> = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

const toRoman = (value: number): string => {
  if (value >= 4000) return String(value);
  let rest = value;
  let out = "";
  for (const [amount, numeral] of ROMAN_NUMERALS) {
    while (rest >= amount) {
      out += numeral;
      rest -= amount;
    }
  }
  return out;
};

/**
 * The name of employee `${role}-${index}` in the run identified by `seed`.
 *
 * A name depends ONLY on (seed, role, index) — never on who else is employed —
 * so hiring or losing someone can never rename a colleague.
 *
 * Collisions are designed out rather than detected: every (role, index) maps to
 * a unique ordinal n, and n picks a first name by walking the first-name list
 * with a seed-chosen stride and a last name by walking the last-name list with
 * another. Because the two list lengths are different primes, every stride is a
 * full cycle and (by the Chinese remainder theorem) the pair (first, last) does
 * not repeat until all FIRST × LAST combinations have been used. On top of that,
 * first names alone do not repeat within the first FIRST_NAME_COUNT ordinals,
 * i.e. while every role has at most 9 people.
 *
 * Beyond UNIQUE_NAME_COUNT ordinals (650+ people in one role — far past anything
 * the world can show) the sequence laps and a generational suffix keeps names
 * unique: "Amara Okafor II".
 */
export const employeeName = (seed: number, role: TeamRole, index: number): EmployeeName => {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const ordinal = safeIndex * ROLE_SLOTS + ROLE_ORDINAL[role];
  const slot = ordinal % UNIQUE_NAME_COUNT;
  const lap = Math.floor(ordinal / UNIQUE_NAME_COUNT);

  const a = mix32((seed ^ 0x5bd1e995) >>> 0);
  const b = mix32((a + 0x9e3779b9) >>> 0);
  const firstStride = 1 + (a % (FIRST_NAME_COUNT - 1));
  const firstStart = (a >>> 16) % FIRST_NAME_COUNT;
  const lastStride = 1 + (b % (LAST_NAME_COUNT - 1));
  const lastStart = (b >>> 16) % LAST_NAME_COUNT;

  const first = FIRST_NAMES[(firstStart + slot * firstStride) % FIRST_NAME_COUNT];
  const baseLast = LAST_NAMES[(lastStart + slot * lastStride) % LAST_NAME_COUNT];
  const last = lap === 0 ? baseLast : `${baseLast} ${toRoman(lap + 1)}`;

  return { first, last, full: `${first} ${last}`, short: `${first} ${baseLast.charAt(0)}.` };
};

// ─────────────────────────────────────────────────────────────────────────────
// Role vocabulary
// ─────────────────────────────────────────────────────────────────────────────

interface RoleTitle {
  singular: string;
  plural: string;
}

/** Job title of one person in the role. */
export const ROLE_TITLES: Record<TeamRole, RoleTitle> = {
  engineering: { singular: "Engineer", plural: "Engineers" },
  design: { singular: "Designer", plural: "Designers" },
  product: { singular: "Product Manager", plural: "Product Managers" },
  data: { singular: "Data Analyst", plural: "Data Analysts" },
  marketing: { singular: "Marketer", plural: "Marketers" },
  sales: { singular: "Account Exec", plural: "Account Execs" },
  ops: { singular: "Ops Manager", plural: "Ops Managers" },
  hr: { singular: "People Ops", plural: "People Ops" },
  legal: { singular: "Counsel", plural: "Counsel" },
  executive: { singular: "VP", plural: "VPs" },
};

/** "Engineer" / "Engineers" — pass a head count to get the right number. */
export const roleTitle = (role: TeamRole, count = 1): string =>
  count === 1 ? ROLE_TITLES[role].singular : ROLE_TITLES[role].plural;

/** Department name, for headings: "Engineering", "People", … */
export const ROLE_TEAM_NAMES: Record<TeamRole, string> = {
  engineering: "Engineering",
  design: "Design",
  product: "Product",
  data: "Data",
  marketing: "Marketing",
  sales: "Sales",
  ops: "Operations",
  hr: "People",
  legal: "Legal",
  executive: "Leadership",
};

/**
 * The token to use in `hire <token> <count>` for each role. These are the
 * spellings the in-game `help` teaches (the engine's roleMap accepts a few more
 * aliases), so a button that runs the command also teaches the command.
 */
export const ROLE_HIRE_TOKENS: Record<TeamRole, string> = {
  engineering: "eng",
  design: "ux",
  product: "product",
  data: "data",
  marketing: "marketing",
  sales: "sales",
  ops: "ops",
  hr: "hr",
  legal: "legal",
  executive: "executive",
};

/**
 * One line on what a hire in this role does for the company.
 *
 * Every claim mirrors an engine rule and is checked against the real engine in
 * names.test.ts:
 *   ship odds / reputation ........ src/engine/actions.ts  shipFeature
 *   launch odds / users ........... src/engine/actions.ts  launchCampaign
 *   weekly growth and churn ....... src/engine/tick.ts     growthRates
 *   burn and overhead ............. src/engine/economy.ts  calcBurn
 *   crisis outcomes ............... src/engine/events/pool.ts
 * If the engine is rebalanced, update these with it.
 */
export const ROLE_BLURBS: Record<TeamRole, string> = {
  engineering: "Raises ship success (+3% each) and the reputation every ship earns, and nudges weekly user growth.",
  design: "Adds build capacity, so sales and marketing can't outrun delivery and drag down ships, growth and retention.",
  product: "Sharpens what gets built: each one adds +2.5% to ship success.",
  data: "The strongest retention hire: cuts weekly churn the most of any role and adds a little growth.",
  marketing: "The biggest campaign lever: +5% launch success and more users per launch, plus steady weekly growth.",
  sales: "Closes the loop on campaigns: +3% launch success and more users per launch, plus steady weekly growth.",
  ops: "Lowers churn, adds growth and build capacity, and keeps sales and marketing from inflating burn.",
  hr: "Turns people crises into clean outcomes, at the cost of slightly slower ships, launches and growth.",
  legal: "Small boosts to ship odds, launch odds, growth and retention, and legal scares cost far less.",
  executive: "Trims stage overhead by 5% each, up to 15%.",
};

export const roleBlurb = (role: TeamRole): string => ROLE_BLURBS[role];
