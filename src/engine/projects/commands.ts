import type { ActionResult, Build, BuildSize, BuildType, Employee, GameState, TeamRole } from "../../types/game";
import { ROLE_TOKENS_HELP, looksLikeRole, roleAliases } from "../tycoon/comp";
import { ATTENTION, BUILD_SIZES, BUILD_TYPES, BURNOUT_ENERGY, ENERGY_CRUNCH_DRAIN, NAME_MAX } from "../tycoon/constants";
import type { Line } from "../tycoon/kit";
import { NO_AP, canSpendAp, ensurePlayable, err, money, spendAp, withLogLines } from "../tycoon/kit";
import {
  assignEmployee, buildsOf, emptyProduct, energyFactor, ensureSlices, findEmployee, leadOf, productRng, roleFit, rosterOf, serialOf, setProduct,
  shortName, staffOf,
} from "../tycoon/roster";
import type { PatchFn } from "../tycoon/contracts";
import { getApCost, markFreeActionUsed } from "../economy";
import { nextIntInclusive } from "../rng";
import { clamp } from "../utils";
import {
  CANCEL_MORALE, CODENAMES, CRUNCH_CRUFT, CRUNCH_QUALITY, CRUNCH_SPEED, HOTFIX_CRUFT, LATE_PENALTY, NEAR_MISS_DIST, NEAR_MISS_DIST_SHORT,
  NEAR_MISS_PREFIX, NEAR_MISS_SHORT_LEN, PACE_OUT, RESERVED_NAMES, SCOPE_INFLATION, SCOPE_INFLATION_MAX_COUNT, SHIP_MIN_COMPLETE, SIZES, TYPES,
} from "./constants";
import { releaseBuild } from "./release";
import {
  cruftWord, etaWeeks, forecastOf, forecastText, isBuilt, isShippable, moatWord, pct, qualityOf, round1, scopeFor, sizeUnlocked, slotsFor,
  typeUnlocked, windowWeeks,
} from "./work";

// The `build` / `project` / `projects` / `staff` commands and the `ship` router (TYCOON-SPEC §4.6–§4.8).

// ── Vocabulary ──

export const TYPE_ALIASES: Record<string, BuildType> = {
  feature: "feature", feat: "feature", growth: "growth", loop: "growth", premium: "premium", tier: "premium", upsell: "premium",
  plumbing: "plumbing", infra: "plumbing", platform: "plumbing", moonshot: "moonshot", moon: "moonshot",
};
export const SIZE_ALIASES: Record<string, BuildSize> = { s: "s", small: "s", m: "m", medium: "m", l: "l", large: "l", xl: "xl", huge: "xl" };

const has = (table: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key);

/** lowercase, every run of non [a-z0-9] → "-", trim "-", cut to 24, trim trailing "-" (§4.6.1). */
export const slugify = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, NAME_MAX).replace(/-+$/g, "");

export const levenshtein = (a: string, b: string): number => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], row[j - 1], prev[j - 1]);
    }
    prev = row;
  }
  return prev[b.length];
};

/** Why a typed name cannot be used for a build, or null when it is fine (§4.6.1). */
export const buildNameProblem = (state: GameState, name: string): string | null => {
  const slug = slugify(name);
  if (!slug) return "A build needs a name with at least one letter or digit in it.";
  if (name.trim().length > NAME_MAX) return `Build names are at most ${NAME_MAX} characters. Marketing will rename it anyway.`;
  if (RESERVED_NAMES.includes(slug) || has(TYPE_ALIASES, slug) || has(SIZE_ALIASES, slug) || has(roleAliases, slug) || /^[a-z]?\d+$/.test(slug)) {
    return `"${name.trim()}" would be confused with a command word, a role or an id. Pick another name.`;
  }
  if (buildsOf(state).some((b) => b.slug === slug)) return `There is already a build called ${slug}.`;
  return null;
};

export type BuildLookup = { ok: true; build: Build } | { ok: false; error: string };

/** Exact slug or id; else a unique slug prefix of 2+ characters (§4.1). */
export const findBuild = (state: GameState, token: string): BuildLookup => {
  const builds = buildsOf(state);
  const raw = token.trim().toLowerCase();
  const q = slugify(token);
  const exact = builds.find((b) => (q !== "" && b.slug === q) || b.id === raw);
  if (exact) return { ok: true, build: exact };
  const prefixed = q.length >= 2 ? builds.filter((b) => b.slug.startsWith(q)) : [];
  if (prefixed.length === 1) return { ok: true, build: prefixed[0] };
  return { ok: false, error: `No build called "${token.trim()}". \`build\` shows the board.` };
};

/** A build name that may be omitted when exactly one build is active. */
const soleOrNamed = (state: GameState, token: string): BuildLookup => {
  if (token.trim()) return findBuild(state, token);
  const builds = buildsOf(state);
  if (builds.length === 1) return { ok: true, build: builds[0] };
  return {
    ok: false,
    error: builds.length === 0 ? "Nothing is being built. `build <type> [size] [name]` starts something." : "Which build? `build` lists them.",
  };
};

const patchBuild = (state: GameState, id: string, patch: Partial<Build>): GameState =>
  setProduct(state, { active: buildsOf(state).map((b) => (b.id === id ? { ...b, ...patch } : b)) });

// ── Who is free ──

/** On no build and not holding notice: the people auto-staff and `staff <build> <role> n` may volunteer (§4.6). */
export const isAvailable = (e: Employee): boolean => e.buildId === null && e.offerDueWeek === 0;

/** Auto-staff ranking: PACE_OUT[pace] x fit x energyFactor(energy) descending, then craft descending, then lower serial. */
const staffRank = (type: BuildType) => (a: Employee, z: Employee): number =>
  (PACE_OUT[z.pace] ?? 0) * roleFit(type, z.role) * energyFactor(z.energy) - (PACE_OUT[a.pace] ?? 0) * roleFit(type, a.role) * energyFactor(a.energy) ||
  z.craft - a.craft ||
  serialOf(a.id) - serialOf(z.id);

/** Available people whose role fits the type (optionally one role, or a minimum fit), best first. */
export const availableFor = (state: GameState, type: BuildType, opts: { role?: TeamRole; minFit?: number } = {}): Employee[] =>
  rosterOf(state)
    .filter((e) => isAvailable(e) && roleFit(type, e.role) > 0 && roleFit(type, e.role) >= (opts.minFit ?? 0) && (!opts.role || e.role === opts.role))
    .sort(staffRank(type));

export const seatsFree = (state: GameState, b: Build): number => SIZES[b.size].seats - staffOf(state, b.id).length;

/** Fills the free seats with the best available people. */
export const autoStaff = (state: GameState, b: Build): { state: GameState; added: Employee[] } => {
  const added = availableFor(state, b.type).slice(0, Math.max(0, seatsFree(state, b)));
  let s = state;
  for (const e of added) s = assignEmployee(s, e.id, b.id);
  return { state: s, added };
};

const names = (list: Employee[]): string => list.map((e) => e.name).join(", ");
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

// ── build / build list: the board ──

const catalogueLines = (state: GameState): Line[] => {
  const types = BUILD_TYPES.filter((t) => typeUnlocked(state, t));
  const lockedTypes = BUILD_TYPES.filter((t) => !typeUnlocked(state, t)).map((t) => `${t}: ${TYPES[t].minPhase} phase`);
  const sizes = BUILD_SIZES.filter((z) => sizeUnlocked(state, z));
  const lockedSizes = BUILD_SIZES.filter((z) => !sizeUnlocked(state, z)).map((z) => `${SIZES[z].label}: ${SIZES[z].minPhase} phase`);
  return [
    { text: `Start one: \`build <type> [size] [name]\` (1 AP + kickoff). People on a build give the day job ${Math.round(ATTENTION * 100)}%.` },
    { text: `  types: ${types.join(", ")}${lockedTypes.length ? `  (later — ${lockedTypes.join(", ")})` : ""}` },
    {
      text: `  sizes: ${sizes.map((z) => `${SIZES[z].label} ${scopeFor(state, "feature", z)} pts ${money(SIZES[z].kickoff)} ${SIZES[z].seats} seats`).join(" · ")}${lockedSizes.length ? `  (later — ${lockedSizes.join(", ")})` : ""}`,
    },
  ];
};

/** `build` / `build list`: read-only, allowed during a pending event and after game over, renders a slice-less state as empty. */
export const buildBoard = (state: GameState): ActionResult => {
  const product = state.product ?? emptyProduct();
  const slots = slotsFor(state);
  const lines: Line[] = [{ text: `PRODUCT — Cruft ${product.cruft}/100 (${cruftWord(product.cruft)}) · Moat ${product.moat}/100 (${moatWord(product.moat)})` }];
  const slotWord = plural(slots, "slot", "slots");
  if (product.active.length === 0) {
    lines.push({ text: `Nothing is being built (0/${slots} ${slotWord}).` });
  } else {
    lines.push({ text: `Building (${product.active.length}/${slots} ${slotWord}):` });
    for (const b of product.active) {
      const staff = staffOf(state, b.id);
      const lead = leadOf(state, b);
      const team = staff.length === 0 ? "nobody" : staff.slice(0, 3).map((e) => shortName(state, e)).join(", ") + (staff.length > 3 ? ` +${staff.length - 3}` : "");
      // A lead holding notice is the build's biggest risk: say so where the lead is named (the departure costs a quarter).
      const leaving = lead && lead.offerDueWeek > 0 ? ` (leaving in ${Math.max(1, lead.offerDueWeek - state.week)}w)` : "";
      const surprises = b.surprises ? `, ${b.surprises} ${plural(b.surprises, "surprise", "surprises")}` : "";
      lines.push({
        text: `  ${b.name} [${b.slug}] · ${TYPES[b.type].label} ${SIZES[b.size].label} · ${pct(b)}% built (${round1(b.progress)}/${round1(b.scope)} pts${surprises}) · quality ${qualityOf(state, b)}${b.crunch ? " · CRUNCH" : ""}`,
      });
      lines.push({ text: `    team ${staff.length}/${SIZES[b.size].seats} (${team})${lead ? ` · lead ${shortName(state, lead)}${leaving}` : ""} · ${forecastText(state, b)}` });
    }
  }
  if (product.shippedCount > 0) {
    lines.push({ text: `Shipped: ${product.shippedCount} ${plural(product.shippedCount, "release", "releases")}.` });
    for (const r of product.shipped.slice(0, 3)) {
      lines.push({ text: `  wk ${r.week}: ${r.name} (${TYPES[r.type].label} ${SIZES[r.size].label}) — ${r.reception}/100 ${r.tier.toUpperCase()}` });
    }
  }
  if (product.active.length < slots) lines.push(...catalogueLines(state));
  return withLogLines(state, lines);
};

// ── build <type> [size] [name] ──

/** The largest unlocked size whose seats the available fit >= 0.5 people cover and whose kickoff is at most half the cash; else S. */
export const defaultSize = (state: GameState, type: BuildType): BuildSize => {
  const free = availableFor(state, type, { minFit: 0.5 }).length;
  for (const size of [...BUILD_SIZES].reverse()) {
    if (sizeUnlocked(state, size) && free >= SIZES[size].seats && SIZES[size].kickoff <= state.cash / 2) return size;
  }
  return "s";
};

/** A codename from product.rng, stepping past codenames an ACTIVE build already uses; fallback `Build <nextId>`. */
export const drawCodename = (state: GameState, rng: number, nextId: number): { rng: number; name: string } => {
  const pick = nextIntInclusive(rng, 0, CODENAMES.length - 1);
  for (let i = 0; i < CODENAMES.length; i++) {
    const name = CODENAMES[(pick.value + i) % CODENAMES.length];
    if (!buildNameProblem(state, name)) return { rng: pick.rng, name };
  }
  return { rng: pick.rng, name: `Build ${nextId}` };
};

export const startBuild = (state: GameState, rest: string[]): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  const type = TYPE_ALIASES[(rest[0] ?? "").toLowerCase()];
  if (!type) return err(state, "Usage: build <feature|growth|premium|plumbing|moonshot> [s|m|l|xl] [name]. `build` shows the board.");
  if (!typeUnlocked(state, type)) return err(state, `${TYPES[type].label} builds need the ${TYPES[type].minPhase} phase. You're in ${state.companyPhase}.`);
  const explicit = SIZE_ALIASES[(rest[1] ?? "").toLowerCase()];
  if (explicit && !sizeUnlocked(state, explicit)) {
    return err(state, `${SIZES[explicit].label} builds need the ${SIZES[explicit].minPhase} phase. You're in ${state.companyPhase}.`);
  }
  const base = ensureSlices(state); // the roster exists before anyone is picked (§4.1)
  const product = base.product ?? emptyProduct();
  const slots = slotsFor(base);
  if (product.active.length >= slots) {
    const which = slots === 1 ? "The only build slot is" : `All ${slots} build slots are`;
    return err(state, `${which} taken (${state.companyPhase} phase). Ship something, \`build cancel <name>\`, or grow into a bigger office.`);
  }
  const cost = getApCost(state, "build");
  if (!canSpendAp(state, cost)) return err(state, NO_AP);
  const typed = rest.slice(explicit ? 2 : 1).join(" ").trim();
  if (typed) {
    const problem = buildNameProblem(base, typed);
    if (problem) return err(state, problem);
  }
  const size = explicit ?? defaultSize(base, type);
  const cfg = SIZES[size];
  if (state.cash < cfg.kickoff) return err(state, `Not enough cash. Kicking off a ${TYPES[type].label} ${cfg.label} costs ${money(cfg.kickoff)}.`);

  const codename = typed ? null : drawCodename(base, productRng(base), product.nextId);
  const name = (codename?.name ?? typed).slice(0, NAME_MAX).trim();
  const scope = scopeFor(base, type, size);
  const build: Build = {
    id: `b${product.nextId}`, name, slug: slugify(name), type, size, units: cfg.units, baseScope: scope, scope,
    progress: 0, qSum: 0, qPts: 0, polish: 0, surprises: 0, crunch: false, crunchWeeks: 0, crunchedWeek: 0,
    startedWeek: base.week, dueWeek: base.week, readyWeek: 0,
  };
  let s: GameState = { ...base, cash: base.cash - cfg.kickoff };
  s = setProduct(s, { nextId: product.nextId + 1, active: [...product.active, build], ...(codename ? { rng: codename.rng } : {}) });
  const staffed = autoStaff(s, build);
  s = staffed.state;
  const eta = etaWeeks(s, build);
  const dueWeek = base.week + windowWeeks(s, build);
  s = patchBuild(s, build.id, { dueWeek });
  s = spendAp(s, cost);
  const fresh = buildsOf(s).find((b) => b.id === build.id) ?? build;
  const f = forecastOf(s, fresh);

  const shippedBefore = product.shippedByType[type];
  const lines: Line[] = [
    { text: `Kickoff: ${name} — ${TYPES[type].label} ${cfg.label} (${scope} pts, ${cfg.blurb}). Cash -${money(cfg.kickoff)}.` },
    staffed.added.length > 0
      ? { text: `Staffed: ${names(staffed.added)}. (People on a build give the day job ${Math.round(ATTENTION * 100)}%.)` }
      : { text: `Staffed: nobody. It is currently a slide. \`staff ${build.slug} auto\` once someone suitable is free.`, kind: "event" },
    {
      text: `Estimate: ${eta === null ? "never, at this rate" : `~${eta} ${plural(eta, "week", "weeks")}`}. Due week ${dueWeek} (your estimate plus slack; after that, reception -${LATE_PENALTY} a week).`,
    },
    {
      text: f.eta === null
        ? "Forecast if it ships finished and on time: ? (nobody on it)."
        : `Forecast if it ships finished and on time: ~${f.finished} (${f.tierFinished.toUpperCase()}) ±${f.spread}.`,
    },
  ];
  if (shippedBefore > 0) {
    const pctUp = Math.round(SCOPE_INFLATION * Math.min(SCOPE_INFLATION_MAX_COUNT, shippedBefore) * 100);
    lines.push({ text: `(Scope +${pctUp}%: you have shipped ${shippedBefore} of these. The easy wins are gone.)` });
  }
  if (!explicit) lines.push({ text: `(Size ${cfg.label} picked for the people you have free. \`build ${type} <s|m|l|xl> <name>\` chooses.)` });
  return withLogLines(s, lines, "click");
};

// ── build crunch / build cancel ──

export const crunchBuild = (state: GameState, rest: string[]): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  const last = (rest[rest.length - 1] ?? "").toLowerCase();
  const toggled = last === "on" || last === "off";
  const mode = toggled ? last : "on";
  const found = soleOrNamed(state, (toggled ? rest.slice(0, -1) : rest).join(" "));
  if (!found.ok) return err(state, found.error);
  const b = found.build;
  if (mode === "off") {
    if (!b.crunch) return err(state, `${b.name} isn't crunching.`);
    return withLogLines(patchBuild(state, b.id, { crunch: false }), [{ text: `Crunch off: ${b.name}. People remember what evenings are.` }], "click");
  }
  if (isBuilt(b)) return err(state, `${b.name} is already built. Crunching the polish is how 'pixel-perfect' becomes a resignation letter.`);
  if (b.crunch) return err(state, `${b.name} is already crunching. \`build crunch ${b.slug} off\` to stop.`);
  // Crunch is something done to people (ERRATA 68): with nobody on the build there is nobody to do it to.
  if (!staffOf(state, b.id).some((e) => roleFit(b.type, e.role) > 0)) {
    return err(state, `Nobody is on ${b.name}. Crunching an empty crew is just called 'the weekend'. \`staff ${b.slug} auto\` first.`);
  }
  return withLogLines(patchBuild(state, b.id, { crunch: true }), [
    { text: `Crunch on: ${b.name}. [[beat]] You call it 'a push'. The team calls it something else.`, kind: "event" },
    {
      text: `Per week: output x${CRUNCH_SPEED}, that week's quality x${CRUNCH_QUALITY}, energy -${ENERGY_CRUNCH_DRAIN} for everyone on it, cruft +${CRUNCH_CRUFT}. Under ${BURNOUT_ENERGY} energy people start interviewing.`,
    },
  ], "warning");
};

export const cancelBuild = (state: GameState, rest: string[]): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  const found = soleOrNamed(state, rest.join(" "));
  if (!found.ok) return err(state, found.error);
  const b = found.build;
  const morale = Math.max(1, Math.round(CANCEL_MORALE * SIZES[b.size].weight));
  let s: GameState = { ...state, culture: { ...state.culture, morale: clamp(state.culture.morale - morale, 0, 100) } };
  for (const e of staffOf(state, b.id)) s = assignEmployee(s, e.id, null);
  s = setProduct(s, { active: buildsOf(s).filter((x) => x.id !== b.id) });
  return withLogLines(s, [
    { text: `${b.name} is cancelled. [[beat]] The Figma file lives on, like a ghost ship.`, kind: "event" },
    { text: `Morale -${morale}. ${round1(b.progress)} points of work become 'learnings'.` },
  ], "warning");
};

// ── staff ──

const STAFF_USAGE = "Usage: staff <build> auto | staff <build> <name|id|role [n]>... | staff off <name|id|build>...";

/** `staff off …`: refusals answer with the ORIGINAL state (`state`); the work happens on `base` (slices ensured). */
const staffOff = (state: GameState, base: GameState, tokens: string[]): ActionResult => {
  let s = base;
  const freed: Employee[] = [];
  for (const token of tokens) {
    const raw = token.toLowerCase();
    const slug = slugify(token);
    const build = buildsOf(s).find((b) => (slug !== "" && b.slug === slug) || b.id === raw);
    let people: Employee[];
    if (build) {
      people = staffOf(s, build.id);
    } else {
      // No role tokens after `off`: anything that is not a build is a person lookup (§4.7).
      const found = findEmployee(s, token);
      if (!found.ok) return err(state, found.error);
      if (found.employee.buildId === null) return err(state, `${found.employee.name} is already on the day job.`);
      people = [found.employee];
    }
    for (const e of people) {
      s = assignEmployee(s, e.id, null);
      freed.push(e);
    }
  }
  if (freed.length === 0) return err(state, "Nobody to pull off.");
  return withLogLines(s, [{ text: `Back on the day job: ${names(freed)}.` }], "click");
};

export const staffCommand = (state: GameState, rest: string[]): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  if (rest.length === 0 || (rest.length === 1 && rest[0].toLowerCase() === "off")) return err(state, STAFF_USAGE);
  const base = ensureSlices(state);
  if (rest[0].toLowerCase() === "off") return staffOff(state, base, rest.slice(1));

  const found = findBuild(base, rest[0]);
  if (!found.ok) return err(state, found.error);
  const b = found.build;
  if (rest.length < 2) return err(state, STAFF_USAGE);
  const seats = SIZES[b.size].seats;
  const label = TYPES[b.type].label;
  let s = base;
  const added: Employee[] = [];
  const tokens = rest.slice(1);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].toLowerCase();
    let wanted: Employee[];
    if (token === "auto") {
      if (seatsFree(s, b) <= 0) return err(state, `${b.name} has no free seat (${seats} for a ${SIZES[b.size].label}).`);
      wanted = availableFor(s, b.type).slice(0, seatsFree(s, b));
      if (wanted.length === 0) return err(state, `Nobody suitable is free for ${b.name}. Hire, recruit, or pull someone off another build.`);
    } else if (has(roleAliases, token)) {
      const role = roleAliases[token];
      const n = /^\d+$/.test(tokens[i + 1] ?? "") ? Number(tokens[++i]) : 1;
      if (roleFit(b.type, role) <= 0) return err(state, `${role} has nothing to do on a ${label} build.`);
      wanted = availableFor(s, b.type, { role }).slice(0, n);
      if (wanted.length === 0) {
        return err(state, `No free ${role} people for ${b.name} (on another build or holding notice). \`staff off <name>\` somewhere, or hire first.`);
      }
      if (wanted.length < n) return err(state, `Only ${wanted.length} free ${role} ${plural(wanted.length, "person", "people")}.`);
    } else {
      const person = findEmployee(s, tokens[i]);
      if (!person.ok) {
        return err(state, looksLikeRole(tokens[i]) ? `${person.error} (Roles are ${ROLE_TOKENS_HELP}: \`staff ${b.slug} eng 2\`.)` : person.error);
      }
      const e = person.employee;
      if (e.buildId === b.id) return err(state, `${e.name} is already on ${b.name}.`);
      if (roleFit(b.type, e.role) <= 0) return err(state, `${e.name} (${e.role}) has nothing to do on a ${label} build.`);
      wanted = [e];
    }
    for (const e of wanted) {
      if (seatsFree(s, b) <= 0) return err(state, `${b.name} has ${seats} seats (it is a ${SIZES[b.size].label}) and they are taken. \`staff off <who>\` first.`);
      s = assignEmployee(s, e.id, b.id);
      added.push(e);
    }
  }
  if (added.length === 0) return err(state, `Nobody suitable is free for ${b.name}. Hire, recruit, or pull someone off another build.`);
  const eta = etaWeeks(s, b);
  return withLogLines(s, [
    { text: `${b.name} +${names(added)}. First week is ramp-up (half speed). Team ${staffOf(s, b.id).length}/${seats}${eta === null ? "" : ` · ETA ~${eta}w`}.` },
  ], "click");
};

// ── ship routing (§4.8) ──

const nearMiss = (slug: string, target: string): boolean => {
  if (!slug) return false;
  const limit = target.length <= NEAR_MISS_SHORT_LEN ? NEAR_MISS_DIST_SHORT : NEAR_MISS_DIST;
  return levenshtein(slug, target) <= limit || (slug.length >= NEAR_MISS_PREFIX && target.startsWith(slug));
};

/** "`ship a` (73% built) or `ship b` (100% built)" */
const shipList = (builds: Build[]): string => {
  const items = builds.map((b) => `\`ship ${b.slug}\` (${pct(b)}% built)`);
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
};

const shipBuild = (state: GameState, b: Build): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  if (!isShippable(b)) {
    return err(state, `${b.name} is ${pct(b)}% built. Shipping it now would be a crime. (Needs ${Math.round(SHIP_MIN_COMPLETE * 100)}%. Or \`build cancel ${b.slug}\`.)`);
  }
  const cost = getApCost(state, "ship");
  if (!canSpendAp(state, cost)) return err(state, NO_AP);
  const out = releaseBuild(state, b);
  const s = markFreeActionUsed(spendAp(out.state, cost), "ship");
  const lines: Line[] = cost === 0
    ? [out.lines[0], { text: "Hacker perk: first ship of the week is free.", kind: "event" }, ...out.lines.slice(1)]
    : out.lines;
  return withLogLines(s, lines, out.sound);
};

/**
 * `ship <name>` (§4.8): the exact slug (or id) of an active build releases it; a near-miss is refused; an empty name with a
 * shippable build is refused; anything else is today's patch (`patch` = shipFeature), untouched, plus the weekly hotfix.
 * With no active build the patch is called exactly as today.
 */
export const shipRoute = (state: GameState, name: string, patch: PatchFn): ActionResult => {
  const builds = buildsOf(state);
  if (builds.length > 0) {
    const slug = slugify(name);
    const raw = name.trim().toLowerCase();
    const exact = builds.find((b) => (slug !== "" && b.slug === slug) || b.id === raw);
    if (exact) return shipBuild(state, exact);
    const close = builds.find((b) => nearMiss(slug, b.slug));
    if (close) return err(state, `Did you mean \`ship ${close.slug}\`? (That releases ${close.name}. Any other name ships a patch.)`);
    if (!raw) {
      const ready = builds.filter(isShippable);
      if (ready.length === 1) {
        return err(state, `Ship what? \`ship ${ready[0].slug}\` releases ${ready[0].name} (${pct(ready[0])}% built). Any other name ships a patch.`);
      }
      if (ready.length > 1) return err(state, `Ship what? ${shipList(ready)} releases one. Any other name ships a patch.`);
    }
  }
  const result = patch(state, name);
  // The first patch that lands each week pays a little cruft down.
  const product = result.state.product;
  if (result.sound !== "success" || !product || product.cruft <= 0 || product.lastHotfixWeek === result.state.week) return result;
  const cruft = round1(Math.max(0, product.cruft - HOTFIX_CRUFT));
  const hotfix = withLogLines(setProduct(result.state, { cruft, lastHotfixWeek: result.state.week }), [
    { text: `Hotfix: Cruft -${round1(product.cruft - cruft)} → ${cruft}. (First landed patch each week.)` },
  ]);
  return { ...result, state: hotfix.state, logs: [...result.logs, ...hotfix.logs] };
};
