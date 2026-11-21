import type { BuildType, GameState, TeamRole } from "../../types/game";
import { listCandidates, listRoster } from "../../engine/people";
import { listBuilds, startOptions } from "../../engine/projects";
import { TYPE_ALIASES } from "../../engine/projects/commands";
import { SIZES } from "../../engine/projects/constants";
import { roleAliases, roleComp } from "../../engine/tycoon/comp";
import { findEmployee, roleFit } from "../../engine/tycoon/roster";
import { canHireRole } from "../../engine/stagePerks";

// Terminal autocomplete for the people and build commands (team, recruit, retain, fire,
// build, staff, and `ship <build>`). Pure and window-free so it is tested in node.
// `buildTycoonHints` turns a game state into the live names the terminal offers (people,
// candidates, builds, unlocked types and sizes); `tycoonSuggestions` turns what the player
// has typed so far into suggestions. Everything comes from the engine's read-only views.

export type SuggestionKind =
  | "command" | "role" | "founder" | "cofounder" | "raise" | "raise-amount" | "ship" | "launch" | "board" | "asset"
  | "person" | "build" | "candidate" | "build-type";

export type Suggestion = {
  kind: SuggestionKind;
  label: string;
  nextValue: string;
  tooltip?: string;
};

export interface PersonHint {
  id: string;
  /** What the commands take: the lower-cased first name when it is unique, else the id. */
  handle: string;
  name: string;
  role: TeamRole;
  label: string;
  tooltip: string;
  offer: boolean;
  buildId: string | null;
  /** Active builds this person's role can work on. */
  fitBuildIds: string[];
}

export interface BuildHint {
  id: string;
  slug: string;
  name: string;
  type: BuildType;
  /** 60% built or more: `ship <slug>` releases it. */
  shippable: boolean;
  /** Empty seats: `staff <slug> auto` has nothing to fill without one. */
  seatsFree: number;
  label: string;
  tooltip: string;
}

export interface TokenHint {
  token: string;
  tooltip: string;
  /** What the list shows; the token itself when absent. */
  label?: string;
}

export interface CandidateHint {
  index: number;
  label: string;
  tooltip: string;
}

export interface TycoonHints {
  /** In `team` order: people holding an offer first. */
  people: PersonHint[];
  builds: BuildHint[];
  /** Role tokens the player may recruit (unlocked at the current stage), in `hire`'s order. */
  roleTokens: string[];
  /** Build types unlocked in the current phase. */
  buildTypes: TokenHint[];
  /** Unlocked sizes per unlocked type. */
  buildSizes: Partial<Record<BuildType, TokenHint[]>>;
  /** This week's candidates, for roles somebody already looked at with `recruit <role>`. */
  candidates: Partial<Record<TeamRole, CandidateHint[]>>;
}

export const EMPTY_TYCOON_HINTS: TycoonHints = { people: [], builds: [], roleTokens: [], buildTypes: [], buildSizes: {}, candidates: {} };

const ROLE_TOKENS: Array<[string, TeamRole]> = [
  ["eng", "engineering"], ["ux", "design"], ["marketing", "marketing"], ["sales", "sales"], ["ops", "ops"],
  ["hr", "hr"], ["legal", "legal"], ["data", "data"], ["product", "product"], ["exec", "executive"],
];

const ROLE_SHORT: Record<TeamRole, string> = {
  engineering: "eng", design: "design", marketing: "marketing", sales: "sales", ops: "ops",
  hr: "hr", legal: "legal", data: "data", product: "product", executive: "exec",
};

const TYPE_ORDER: BuildType[] = ["feature", "growth", "premium", "plumbing", "moonshot"];

const TYPE_GLOSS: Record<BuildType, string> = {
  feature: "reputation and users",
  growth: "users, if they are consumers",
  premium: "revenue per user",
  plumbing: "pays down cruft",
  moonshot: "a big swing",
};

const TYPE_BLURB: Record<BuildType, string> = {
  feature: "Feature: something users asked for, or will be told they asked for. Reputation and users.",
  growth: "Growth loop: referral codes and guilt-trip emails. Users, if your users are consumers.",
  premium: "Premium tier: the same product with a gold badge. Revenue per user.",
  plumbing: "Plumbing: invisible work that pays down cruft. Nobody claps. Everything gets faster.",
  moonshot: "Moonshot: a big bet with a wide spread. Investors love the slide.",
};

const BUILD_VERBS: TokenHint[] = [
  { token: "crunch", tooltip: "Push a build harder: 1.5x speed, worse quality, tired people (free)" },
  { token: "cancel", tooltip: "Kill a build. The kickoff money stays spent (free)" },
  { token: "list", tooltip: "The product board: builds, forecasts, cruft, moat (free)" },
];

const money = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;
const signedPct = (x: number): string => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;

/** The live names and options the terminal offers for the tycoon commands. Cheap; call it per state. */
export const buildTycoonHints = (state: GameState): TycoonHints => {
  const builds = listBuilds(state);
  const slugById = new Map(builds.map((b) => [b.id, b.slug]));

  const people: PersonHint[] = listRoster(state).map((p) => {
    const first = p.name.split(" ")[0].toLowerCase();
    const found = findEmployee(state, first);
    const handle = found.ok && found.employee.id === p.id ? first : p.id;
    const build = p.buildId ? slugById.get(p.buildId) ?? null : null;
    const offer = p.offer
      ? ` · ${p.offer.kind === "burnout" ? "burnt out and interviewing" : "holding an offer"}, leaves in ${p.offer.weeksLeft}w`
      : "";
    return {
      id: p.id,
      handle,
      name: p.name,
      role: p.role,
      label:
        `${p.name} (${p.id}) — ${ROLE_SHORT[p.role]}, pace ${p.pace} craft ${p.craft}, energy ${p.energy}` +
        `${build ? `, on ${build}${p.isLead ? " (lead)" : ""}` : ""}${p.offer ? ` · LEAVES IN ${p.offer.weeksLeft}W` : ""}`,
      tooltip:
        `${p.role} · pace ${p.pace} craft ${p.craft} · energy ${p.energy} (${p.energyWord}) · ${money(p.salary)}/wk` +
        `${build ? ` · on ${build}${p.isLead ? " (lead)" : ""}` : ""}${p.quirk ? ` · ${p.quirk}` : ""}${offer}`,
      offer: p.offer !== null,
      buildId: p.buildId,
      fitBuildIds: p.fitBuildIds,
    };
  });

  const buildHints: BuildHint[] = builds.map((b) => {
    const f = b.forecast;
    const ship = f.shippable
      ? `ship now ≈ ${f.now} ±${f.spread} (${f.tierNow})`
      : "not shippable yet (needs 60%)";
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      type: b.type,
      shippable: f.shippable,
      seatsFree: Math.max(0, b.seats - b.staffIds.length),
      label: `${b.name} (${b.pct}%)`,
      tooltip:
        `${b.typeLabel} ${b.sizeLabel} · ${b.pct}% built · due week ${b.dueWeek}${b.weeksLate > 0 ? ` (${b.weeksLate}w late)` : ""}` +
        ` · ${ship} · finished ≈ ${f.eta === null ? "? (nobody on it)" : f.finished}${b.crunch ? " · crunching" : ""}`,
    };
  });

  const roleTokens = ROLE_TOKENS.filter(([, role]) => canHireRole(role, state.stage)).map(([token]) => token);

  const { slotsFree, options } = startOptions(state);
  const full = slotsFree === 0 ? " All build slots are taken: ship or cancel something first." : "";
  const buildTypes: TokenHint[] = [];
  const buildSizes: Partial<Record<BuildType, TokenHint[]>> = {};
  for (const type of TYPE_ORDER) {
    const sizes = options.filter((o) => o.type === type && o.unlocked);
    if (sizes.length === 0) continue;
    buildTypes.push({ token: type, label: `${type} — ${TYPE_GLOSS[type]}`, tooltip: `${TYPE_BLURB[type]} (1 AP + kickoff)${full}` });
    buildSizes[type] = sizes.map((o) => ({
      token: o.size,
      label: `${o.size} — ${SIZES[o.size].blurb}: ${o.scope} pts, ${o.seats} seats, ${money(o.kickoff)} kickoff`,
      tooltip: `${SIZES[o.size].label}, ${SIZES[o.size].blurb} · ${o.scope} pts · ${o.seats} seats · kickoff ${money(o.kickoff)}`,
    }));
  }

  const candidates: Partial<Record<TeamRole, CandidateHint[]>> = {};
  const slice = state.people;
  if (slice && slice.candidatesWeek === state.week) {
    for (const role of Object.keys(slice.candidates) as TeamRole[]) {
      const pool = listCandidates(state, role);
      if (!pool || pool.length === 0) continue;
      candidates[role] = pool.map((c) => ({
        index: c.index,
        label: `${c.index}) ${c.name} — ${c.vetted ? "" : "résumé "}pace ${c.shownPace} craft ${c.shownCraft}, asks ${money(c.ask)}/wk`,
        tooltip:
          `${c.vetted ? "Vetted by HR" : "Unvetted: résumés are aspirational documents"} · quirk ${c.quirk === "hidden" ? "?" : c.quirk ?? "none"}` +
          ` · ${signedPct(c.askVsStandard)} vs standard pay · signing ${money(c.signing)} · 1 AP`,
      }));
    }
  }

  return { people, builds: buildHints, roleTokens, buildTypes, buildSizes, candidates };
};

/** One recruit-role tooltip, in the same wording as the `hire` ones. */
const recruitTooltip = (token: string): string => {
  const role = roleAliases[token];
  if (!role) return "";
  return `This week's three ${role} candidates (free to look). Signing one: 1 AP + ${money(roleComp[role].hireCost)}, pay around ${money(roleComp[role].salary)}/wk.`;
};

const TYCOON_COMMANDS = new Set(["team", "recruit", "retain", "fire", "build", "project", "projects", "staff"]);

const personMatches = (p: PersonHint, prefix: string): boolean =>
  prefix === "" || p.handle.startsWith(prefix) || p.id.startsWith(prefix) || p.name.toLowerCase().startsWith(prefix);

const personIs = (p: PersonHint, token: string): boolean => p.handle === token || p.id === token;

const personSuggestion = (p: PersonHint, nextValue: string): Suggestion => ({ kind: "person", label: p.label, nextValue, tooltip: p.tooltip });

/** A build by exact slug or id, else by a unique slug prefix of 2+ characters (the engine's own rule). */
const findBuildHint = (builds: BuildHint[], token: string): BuildHint | null => {
  const q = token.toLowerCase();
  const exact = builds.find((b) => b.slug === q || b.id === q);
  if (exact) return exact;
  if (q.length < 2) return null;
  const prefixed = builds.filter((b) => b.slug.startsWith(q));
  return prefixed.length === 1 ? prefixed[0] : null;
};

const LIMIT = 8;

/**
 * Suggestions for a tycoon command line, or null when the line is not one (the caller's
 * own branches handle it). Only called once the command word is complete (a space after it).
 */
export const tycoonSuggestions = (raw: string, h: TycoonHints): Suggestion[] | null => {
  const trimmedLeft = raw.replace(/^\s+/, "");
  const endsWithSpace = /\s$/.test(raw);
  const tokens = trimmedLeft.split(/\s+/).filter(Boolean);
  const cmd = (tokens[0] ?? "").toLowerCase();
  if (!TYCOON_COMMANDS.has(cmd)) return null;
  if (tokens.length === 1 && !endsWithSpace) return null;

  /** Index of the token being typed, its text so far, and everything before it. */
  const at = endsWithSpace ? tokens.length : tokens.length - 1;
  const current = endsWithSpace ? "" : (tokens[tokens.length - 1] ?? "").toLowerCase();
  const head = [cmd, ...tokens.slice(1, at)].join(" ");
  const sub = (tokens[1] ?? "").toLowerCase();
  const typed = new Set(tokens.slice(1, at).map((t) => t.toLowerCase()));
  const fresh = (token: string): boolean => token.startsWith(current) && token !== current && !typed.has(token);
  /** Role tokens somebody on the roster answers to (a layoff or a listing of nobody is no suggestion). */
  const staffedRoles = new Set(h.people.map((p) => p.role));
  const presentRoleTokens = h.roleTokens.filter((t) => staffedRoles.has(roleAliases[t]));

  if (cmd === "team") {
    if (at !== 1) return [];
    const people = h.people.filter((p) => personMatches(p, current) && !personIs(p, current)).map((p) => personSuggestion(p, `team ${p.handle}`));
    const words: Suggestion[] = [
      ...(fresh("all") ? [{ kind: "command" as const, label: "all", nextValue: "team all", tooltip: "Everyone, not just the first screenful (free)" }] : []),
      ...presentRoleTokens.filter(fresh).map((t) => ({ kind: "role" as const, label: t, nextValue: `team ${t}`, tooltip: `Everyone in ${roleAliases[t]} (free)` })),
    ];
    return [...people, ...words].slice(0, LIMIT);
  }

  if (cmd === "retain") {
    if (at !== 1) return [];
    const pool = [...h.people.filter((p) => p.offer), ...h.people.filter((p) => !p.offer)];
    return pool
      .filter((p) => personMatches(p, current) && !personIs(p, current))
      .slice(0, LIMIT)
      .map((p) => personSuggestion(p, `retain ${p.handle}`));
  }

  if (cmd === "fire") {
    if (at !== 1) return [];
    const people = h.people.filter((p) => personMatches(p, current) && !personIs(p, current)).map((p) => personSuggestion(p, `fire ${p.handle}`));
    const layoffs: Suggestion[] = presentRoleTokens.filter(fresh).map((t) => ({
      kind: "role",
      label: `${t} <count>`,
      nextValue: `fire ${t} `,
      tooltip: `Layoff: \`fire ${t} <count>\` lets that many ${roleAliases[t]} people go (1 AP, two weeks' severance each)`,
    }));
    return [...people, ...layoffs].slice(0, LIMIT);
  }

  if (cmd === "recruit") {
    if (at === 1) {
      return h.roleTokens.filter(fresh).map((t) => ({ kind: "role", label: t, nextValue: `recruit ${t}`, tooltip: recruitTooltip(t) }));
    }
    const role = roleAliases[sub];
    if (at !== 2 || !role) return [];
    return (h.candidates[role] ?? [])
      .filter((c) => fresh(String(c.index)))
      .map((c) => ({ kind: "candidate", label: c.label, nextValue: `recruit ${sub} ${c.index}`, tooltip: c.tooltip }));
  }

  if (cmd === "build" || cmd === "project" || cmd === "projects") {
    if (at === 1) {
      return [...h.buildTypes, ...BUILD_VERBS]
        .filter((t) => fresh(t.token))
        .map((t) => ({ kind: "build-type", label: t.label ?? t.token, nextValue: `${cmd} ${t.token}${t.token === "list" ? "" : " "}`, tooltip: t.tooltip }));
    }
    if (at === 2 && (sub === "crunch" || sub === "cancel")) {
      return h.builds
        .filter((b) => fresh(b.slug))
        .map((b) => ({ kind: "build", label: b.label, nextValue: `${cmd} ${sub} ${b.slug}${sub === "crunch" ? " " : ""}`, tooltip: b.tooltip }));
    }
    if (at === 3 && sub === "crunch") {
      return [
        { token: "on", tooltip: "Crunch: 1.5x speed, 0.9x quality, energy drains every week" },
        { token: "off", tooltip: "Back to sane hours. Energy comes back slowly" },
      ]
        .filter((t) => fresh(t.token))
        .map((t) => ({ kind: "command", label: t.token, nextValue: `${head} ${t.token}`, tooltip: t.tooltip }));
    }
    const type = Object.prototype.hasOwnProperty.call(TYPE_ALIASES, sub) ? TYPE_ALIASES[sub] : undefined;
    if (at === 2 && type) {
      return (h.buildSizes[type] ?? [])
        .filter((z) => fresh(z.token))
        .map((z) => ({ kind: "build-type", label: z.label ?? z.token, nextValue: `${cmd} ${sub} ${z.token} `, tooltip: `${z.tooltip}. Then a name, or leave it to the codename generator.` }));
    }
    return [];
  }

  // staff
  if (at === 1) {
    return [
      ...h.builds.filter((b) => fresh(b.slug)).map((b): Suggestion => ({ kind: "build", label: b.label, nextValue: `staff ${b.slug} `, tooltip: b.tooltip })),
      ...(fresh("off") ? [{ kind: "command" as const, label: "off", nextValue: "staff off ", tooltip: "Back to the day job: `staff off <name|build>` (free)" }] : []),
    ];
  }
  if (sub === "off") {
    const people = h.people
      .filter((p) => p.buildId !== null && personMatches(p, current) && !personIs(p, current) && !typed.has(p.handle) && !typed.has(p.id))
      .map((p) => personSuggestion(p, `${head} ${p.handle}`));
    const builds = h.builds
      .filter((b) => fresh(b.slug))
      .map((b): Suggestion => ({ kind: "build", label: `${b.label}: everyone`, nextValue: `${head} ${b.slug}`, tooltip: `Pull the whole crew off ${b.name}` }));
    return [...people, ...builds].slice(0, LIMIT);
  }
  const build = findBuildHint(h.builds, sub);
  if (!build) return [];
  const auto: Suggestion[] = at === 2 && build.seatsFree > 0 && fresh("auto")
    ? [{ kind: "command", label: "auto", nextValue: `${head} auto`, tooltip: `Fill ${build.name}'s empty seats with the best free people (free; first week is ramp-up)` }]
    : [];
  const candidates = h.people.filter(
    (p) => p.buildId !== build.id && p.fitBuildIds.includes(build.id) && personMatches(p, current) && !personIs(p, current) && !typed.has(p.handle) && !typed.has(p.id),
  );
  // Free people first, then people on another build (staffing them moves them), people holding an offer last.
  const rank = (p: PersonHint): number => (p.offer ? 2 : p.buildId === null ? 0 : 1);
  const people = [...candidates].sort((a, b) => rank(a) - rank(b)).map((p) => personSuggestion(p, `${head} ${p.handle}`));
  const roles: Suggestion[] = h.roleTokens
    .filter((t) => fresh(t) && roleFit(build.type, roleAliases[t]) > 0)
    .filter((t) => h.people.some((p) => p.role === roleAliases[t] && p.buildId === null && !p.offer))
    .map((t) => ({ kind: "role", label: `${t} [n]`, nextValue: `${head} ${t}`, tooltip: `The best free ${roleAliases[t]} people for ${build.name}: \`${t} 2\` for two` }));
  return [...auto, ...people, ...roles].slice(0, LIMIT);
};

/** `ship <build>` suggestions: active builds first (a patch name stays free text). */
export const shipBuildSuggestions = (remainderLower: string, builds: BuildHint[]): Suggestion[] =>
  builds
    .filter((b) => (b.slug.startsWith(remainderLower) || b.name.toLowerCase().startsWith(remainderLower)) && b.slug !== remainderLower)
    .map((b) => ({
      kind: "build",
      label: `${b.label}: ${b.shippable ? "release" : "not shippable before 60%"}`,
      nextValue: `ship ${b.slug}`,
      tooltip: b.tooltip,
    }));
