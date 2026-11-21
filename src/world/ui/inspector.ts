/**
 * (clicked thing, live game state) → the inspector card shown next to it.
 *
 * Pure and DOM-free. The card is the bridge between the 3D world and the
 * terminal: every button either runs a real command or puts one in the input,
 * and shows that command, so clicking teaches typing.
 *
 * GATING. An action is disabled exactly when the engine would refuse its
 * command, and says why. The rules mirror, in order:
 *   src/engine/commands.ts  executeCommand — pending event, then setup order
 *   src/engine/actions.ts   ensurePlayable — game over, then the per-action
 *                           checks (AP, stage lock, cash)
 * The people and product-build buttons (retain, staff, ship <build>, crunch…)
 * ask the engine itself: `preflight` dry-runs the command on the live state and
 * reports whether it would be refused, why, and what it would cost.
 * inspector.test.ts feeds every enabled command to the real engine, and every
 * disabled one too, to keep the two from drifting apart.
 */
import { ASSET_CATALOG, phaseAtLeast } from "../../engine/assets";
import { PERSONALITY_PROFILES } from "../../engine/board";
import { calcNetBurn, calcRunwayWeeks, getApCost, getEffectiveMaxAp, roleComp } from "../../engine/economy";
import { stageRaiseCaps } from "../../engine/investors";
import { PRICING_MODELS } from "../../engine/pricing";
import { isSetupComplete } from "../../engine/founders";
import { describeEmployee } from "../../engine/people";
import type { PersonFacts } from "../../engine/people";
import { listBuilds, productSummary, startOptions } from "../../engine/projects";
import type { BuildFacts, ProductFacts } from "../../engine/projects";
import { canHireRole, ROLE_MIN_STAGE } from "../../engine/stagePerks";
import { preflight } from "../../engine/tycoon/preflight";
import type { AssetId, CompanyPhase, GameState, PricingModel, TeamRole } from "../../types/game";
import { stripTypewriterTokens } from "../../ui/terminal/tokens";
import { ROLE_HIRE_TOKENS, roleBlurb, roleTitle } from "../names";
import { getOfficeLayout } from "../office/layouts";
import { buildWorldSnapshot, headcount, isNamedEmployeeId, ROLE_ORDER } from "../snapshot";
import type { InteractableTarget, PersonView, StationKind } from "../types";
import { formatCount, formatCountDelta, formatUsd, formatUsdDelta, titleCase } from "./format";

// ─────────────────────────────────────────────────────────────────────────────
// Card model
// ─────────────────────────────────────────────────────────────────────────────

export interface InspectorAction {
  label: string;
  /** The literal terminal command, e.g. "hire eng 1", "ship ", "end". */
  command: string;
  /** run = execute `command` as is; prefill = put it in the terminal input for the player to finish. */
  mode: "run" | "prefill";
  /** What it costs, e.g. "1 AP · $3K". */
  hint?: string;
  /** Present → the button is disabled and this says why. */
  disabledReason?: string;
  tone?: "primary" | "default" | "danger";
  /**
   * Actions that share a row key (and sit next to each other) are drawn side by side: the first
   * one in full, the others as small chips (the empty desk's "job ad | candidates" per role).
   */
  row?: string;
}

export type InspectorLineTone = "good" | "bad" | "warn";

export interface InspectorLine {
  label: string;
  value: string;
  tone?: InspectorLineTone;
}

export interface InspectorCard {
  title: string;
  subtitle?: string;
  lines: InspectorLine[];
  note?: string;
  actions: InspectorAction[];
  /** Long read-outs (the product wall's builds): the card is drawn wider. */
  wide?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gating
// ─────────────────────────────────────────────────────────────────────────────

/** The fixed reasons a button can be disabled for; target-specific ones are written inline. */
export const DISABLED_REASONS = {
  runOver: "Run is over",
  setup: "Finish setup first",
  event: "Resolve the event first",
  noAp: "No AP left — end the week",
  noCash: "Not enough cash",
} as const;

/** The only commands a card uses that executeCommand lets through while an event is pending… */
const ALLOWED_DURING_EVENT: ReadonlySet<string> = new Set(["choose", "status", "team"]);
/** …and while the founder is still being set up. */
const ALLOWED_DURING_SETUP: ReadonlySet<string> = new Set(["status"]);

const verbOf = (command: string): string => command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

/** The read-only forms of the tycoon commands, which work while an event is pending: the board, a look at candidates. */
const readOnlyDuringEvent = (command: string): boolean => {
  // A trailing space is a prefill waiting for its arguments ("build " starts a build): it counts as one more token.
  const tokens = command.trimStart().toLowerCase().split(/\s+/);
  const verb = tokens[0] ?? "";
  if (ALLOWED_DURING_EVENT.has(verb)) return true;
  if (verb === "build") return tokens.length === 1 || (tokens.length === 2 && tokens[1] === "list");
  return verb === "recruit" && tokens.length === 2 && tokens[1] !== "";
};

/**
 * Why the engine would refuse `command` before even looking at what it costs,
 * or undefined when the run is in a state that accepts it.
 */
export const commandBlocker = (state: GameState, command: string): string | undefined => {
  const verb = verbOf(command);
  if (state.gameOver) return DISABLED_REASONS.runOver;
  if (state.pendingEvent && !readOnlyDuringEvent(command)) return DISABLED_REASONS.event;
  if (!isSetupComplete(state) && !ALLOWED_DURING_SETUP.has(verb)) return DISABLED_REASONS.setup;
  return undefined;
};

interface Cost {
  /** Action points the engine will ask for. Omit for commands that are free by nature. */
  ap?: number;
  /** Cash the engine requires up front. */
  cash?: number;
}

/**
 * Only a real cost can block: cash can be below zero (and a free weekly action
 * costs 0 AP), and neither may disable something that costs nothing.
 */
const costBlocker = (state: GameState, { ap = 0, cash = 0 }: Cost): string | undefined => {
  if (ap > 0 && ap > state.ap) return state.ap <= 0 ? DISABLED_REASONS.noAp : `Needs ${ap} AP — end the week`;
  if (cash > 0 && cash > state.cash) return DISABLED_REASONS.noCash;
  return undefined;
};

/** "1 AP · $3K", "Free", "2 AP"; undefined for commands that never cost anything. */
const costHint = ({ ap, cash }: Cost): string | undefined => {
  const parts: string[] = [];
  if (ap !== undefined) parts.push(ap === 0 ? "Free" : `${ap} AP`);
  if (cash) parts.push(formatUsd(cash));
  return parts.length > 0 ? parts.join(" · ") : undefined;
};

interface ActionSpec extends Cost {
  label: string;
  command: string;
  mode?: InspectorAction["mode"];
  tone?: InspectorAction["tone"];
  /** Replaces the hint derived from the cost. */
  hint?: string;
  /** A refusal specific to this action (stage-locked role, already owned, …). */
  lock?: string;
}

/**
 * Build one action with the gating applied. Run-level blockers come first (they
 * apply to everything), then what is specific to the action, then what it costs:
 * "Unlocks at Seed" is more useful on a locked role than "No AP left".
 */
const action = (state: GameState, spec: ActionSpec): InspectorAction => {
  const disabledReason = commandBlocker(state, spec.command) ?? spec.lock ?? costBlocker(state, spec);
  const hint = spec.hint ?? costHint(spec);
  return {
    label: spec.label,
    command: spec.command,
    mode: spec.mode ?? "run",
    ...(hint ? { hint } : {}),
    ...(disabledReason ? { disabledReason } : {}),
    ...(spec.tone ? { tone: spec.tone } : {}),
  };
};

/** AP cost of ship / launch / pitch, with the archetype's free weekly action called out. */
const perkAwareHint = (ap: number, cash = 0): string =>
  [ap === 0 ? "Free this week" : `${ap} AP`, ...(cash ? [formatUsd(cash)] : [])].join(" · ");

/** Longest refusal shown where a price would go; longer ones keep their first sentence. */
const REASON_MAX = 72;

/**
 * An engine refusal, fit for a button: the run-level ones in the cards' own words, anything
 * else in the engine's (it is the same voice as the terminal), without the trailing aside and
 * the backticks, cut to its first sentence when it runs long.
 */
export const refusalReason = (text: string): string => {
  if (text.startsWith("Game over")) return DISABLED_REASONS.runOver;
  if (text.startsWith("Resolve the pending event")) return DISABLED_REASONS.event;
  if (text.startsWith("No AP left")) return DISABLED_REASONS.noAp;
  let reason = text.replace(/`([^`]*)`/g, "$1").trim();
  // "… would be a crime. (Needs 60%. Or build cancel x.)" → "… would be a crime."
  const aside = reason.lastIndexOf(" (");
  if (aside > 0 && reason.endsWith(")")) reason = reason.slice(0, aside).trim();
  if (reason.length > REASON_MAX) {
    const end = reason.search(/[.!?](\s|$)/);
    reason = end > 0 && end < REASON_MAX ? reason.slice(0, end + 1) : `${reason.slice(0, REASON_MAX - 1).trimEnd()}…`;
  }
  return reason || "Not now";
};

/** How much a card may ask the engine: `false` for a quick read (a hover chip only needs the title). */
type Gate = boolean;

interface CheckedSpec {
  label: string;
  command: string;
  mode?: InspectorAction["mode"];
  tone?: InspectorAction["tone"];
  /** Replaces the hint derived from the dry run's cost. */
  hint?: string;
  /** A refusal of this card's own (checked before asking the engine). */
  lock?: string;
  row?: string;
  /** Show the archetype's free weekly action ("Free this week") rather than "Free". */
  perk?: boolean;
}

/**
 * An action gated by the engine itself: run-level blockers first (as every card does), then a
 * dry run of the very command (`preflight`), which knows every rule — AP, cash, seats, roles,
 * who is holding notice, how far a build is. Its price comes from the same dry run.
 */
const checked = (state: GameState, gate: Gate, spec: CheckedSpec): InspectorAction => {
  let disabledReason = commandBlocker(state, spec.command) ?? spec.lock;
  let hint = spec.hint;
  if (disabledReason === undefined && gate) {
    const dry = preflight(state, spec.command);
    if (!dry.allowed) disabledReason = refusalReason(dry.reason ?? "");
    else if (hint === undefined) hint = spec.perk ? perkAwareHint(dry.apCost, dry.cashCost) : costHint({ ap: dry.apCost, cash: dry.cashCost });
  }
  return {
    label: spec.label,
    command: spec.command,
    mode: spec.mode ?? "run",
    ...(hint ? { hint } : {}),
    ...(disabledReason ? { disabledReason } : {}),
    ...(spec.tone ? { tone: spec.tone } : {}),
    ...(spec.row ? { row: spec.row } : {}),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared read-outs
// ─────────────────────────────────────────────────────────────────────────────

const PHASE_ORDER: readonly CompanyPhase[] = ["garage", "coworking", "office", "unicorn", "public"];

const outOf100 = (value: number): string => `${Math.round(value)}/100`;

/** Tone for a 0–100 meter where high is good (morale, trust, confidence). */
const highIsGood = (value: number): InspectorLineTone | undefined =>
  value >= 70 ? "good" : value < 40 ? "bad" : undefined;

/**
 * Tone for a meter that starts low by design (public and VC reputation begin
 * around 10): only ever praise it, a new company is not "doing badly".
 */
const earned = (value: number): InspectorLineTone | undefined => (value >= 70 ? "good" : undefined);

/** Tone for a 0–100 meter where high is bad (stress, ego). */
const highIsBad = (value: number): InspectorLineTone | undefined =>
  value >= 70 ? "bad" : value >= 45 ? "warn" : undefined;

const deltaTone = (delta: number): InspectorLineTone | undefined =>
  delta > 0 ? "good" : delta < 0 ? "bad" : undefined;

const apLine = (state: GameState, label = "AP"): InspectorLine => ({
  label,
  value: `${state.ap}/${getEffectiveMaxAp(state)}`,
  ...(state.ap <= 0 ? { tone: "warn" as const } : {}),
});

const cashLine = (state: GameState): InspectorLine => ({
  label: "Cash",
  value: formatUsd(state.cash),
  ...(state.cash < 0 ? { tone: "bad" as const } : {}),
});

const runwayLine = (state: GameState): InspectorLine => {
  if (calcNetBurn(state) <= 0) return { label: "Runway", value: "∞", tone: "good" };
  const weeks = Math.max(0, calcRunwayWeeks(state));
  return { label: "Runway", value: `${weeks}w`, ...(weeks <= 4 ? { tone: "bad" as const } : {}) };
};

const burnLine = (state: GameState): InspectorLine => {
  const netBurn = calcNetBurn(state);
  return netBurn <= 0
    ? { label: "Profit", value: `+${formatUsd(-netBurn)}/wk`, tone: "good" }
    : { label: "Net burn", value: `${formatUsd(netBurn)}/wk` };
};

/** Launch spend by funding stage; mirrors `launchCampaign` in src/engine/actions.ts. */
export const campaignCost = (state: GameState): number =>
  state.stage === "garage" ? 900 : state.stage === "seed" ? 1800 : 3500;

/** Mirrors `boardDinner` / `boardGift` in src/engine/actions.ts. */
const BOARD_DINNER_COST = 2000;
const BOARD_GIFT_COST = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// People
// ─────────────────────────────────────────────────────────────────────────────

const hireAction = (state: GameState, role: TeamRole, label: string): InspectorAction => {
  const minStage = ROLE_MIN_STAGE[role];
  return action(state, {
    label,
    command: `hire ${ROLE_HIRE_TOKENS[role]} 1`,
    ap: getApCost(state, "hire"),
    cash: roleComp[role].hireCost,
    lock: minStage && !canHireRole(role, state.stage) ? `Unlocks at ${titleCase(minStage)}` : undefined,
  });
};

const founderCard = (state: GameState, person: PersonView): InspectorCard => ({
  title: person.name,
  subtitle: state.founder.archetype ? `Founder · ${titleCase(state.founder.archetype)}` : "Founder",
  lines: [
    { label: "Stress", value: outOf100(state.stress), tone: highIsBad(state.stress) },
    apLine(state),
    { label: "Founder equity", value: `${Math.round(state.capTable.founderPct * 100)}%` },
  ],
  actions: [
    action(state, { label: "Company status", command: "status" }),
    action(state, { label: "Stage perks", command: "perks" }),
  ],
});

const cofounderCard = (state: GameState, person: PersonView): InspectorCard => ({
  title: person.name,
  subtitle: state.cofounder.archetype ? `Cofounder · ${titleCase(state.cofounder.archetype)}` : "Cofounder",
  lines: [
    { label: "Trust", value: outOf100(state.cofounder.trust), tone: highIsGood(state.cofounder.trust) },
    { label: "Ego", value: outOf100(state.cofounder.ego), tone: highIsBad(state.cofounder.ego) },
    { label: "Ambition", value: outOf100(state.cofounder.ambition) },
  ],
  actions: [action(state, { label: "Company status", command: "status" })],
});

const employeeCard = (state: GameState, person: PersonView, role: TeamRole): InspectorCard => {
  const count = headcount(state.team, role);
  return {
    title: person.name,
    subtitle: roleTitle(role),
    lines: [
      { label: "Salary", value: `${formatUsd(roleComp[role].salary)}/wk` },
      { label: "Team", value: `${formatCount(count)} ${roleTitle(role, count)}` },
      { label: "Team morale", value: outOf100(state.culture.morale), tone: highIsGood(state.culture.morale) },
    ],
    note: roleBlurb(role),
    actions: [hireAction(state, role, `Hire another ${roleTitle(role)}`)],
  };
};

/** 3 → "●●●○○". */
const dots = (value: number): string => {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return "●".repeat(filled) + "○".repeat(5 - filled);
};

/** Weekly pay to the dollar ("$3,850"): the compact style would round a raise away. */
const usdExact = (value: number): string => (value < 0 ? `-$${formatCount(-value)}` : `$${formatCount(value)}`);

const energyTone = (energy: number): InspectorLineTone | undefined => (energy < 30 ? "bad" : energy < 60 ? "warn" : undefined);

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

const OFFER_NOTES = {
  recruiter: "A recruiter found them. Recruiters always do. Retain them, or start shopping for a farewell card.",
  burnout: "Burnt out and quietly updating their CV. A bonus and a raise will paper over it for a while.",
} as const;

/** A named employee: their stats, their build, any outside offer, and what can be done about them. */
const namedPersonCard = (state: GameState, person: PersonView, facts: PersonFacts, gate: Gate): InspectorCard => {
  const builds = listBuilds(state);
  const buildName = (id: string | null): string | null => builds.find((b) => b.id === id)?.name ?? null;
  const atRisk = facts.offer?.buildAtRisk ? (builds.find((b) => b.slug === facts.offer?.buildAtRisk)?.name ?? facts.offer.buildAtRisk) : null;
  const current = buildName(facts.buildId);

  const lines: InspectorLine[] = [
    { label: "Pace", value: dots(facts.pace) },
    { label: "Craft", value: dots(facts.craft) },
    { label: "Works like", value: `${facts.effectiveness.toFixed(2)} ${plural(Math.round(facts.effectiveness * 100) / 100, "hire", "hires")}` },
    { label: "Energy", value: `${facts.energy} (${facts.energyWord})`, ...(energyTone(facts.energy) ? { tone: energyTone(facts.energy) } : {}) },
    {
      label: "Pay",
      value: `${usdExact(facts.salary)}/wk · going ${usdExact(facts.marketSalary)}`,
    },
    { label: "Working on", value: current ? `${current}${facts.isLead ? " (lead)" : ""}` : "The day job" },
  ];
  if (facts.quirk) lines.push({ label: "Quirk", value: titleCase(facts.quirk) });
  if (facts.shipped > 0) lines.push({ label: "Credited on", value: `${facts.shipped} ${plural(facts.shipped, "release", "releases")}`, tone: "good" });
  if (facts.offer) {
    lines.push({
      label: facts.offer.kind === "burnout" ? "Burnt out" : "Outside offer",
      value: `Leaves in ${facts.offer.weeksLeft}w`,
      tone: "bad",
    });
    if (atRisk) lines.push({ label: "At risk", value: `${atRisk} loses a quarter`, tone: "bad" });
    lines.push({ label: "To keep them", value: `${usdExact(facts.retainQuote.bonus)} now, then ${usdExact(facts.retainQuote.newSalary)}/wk` });
  }

  const actions: InspectorAction[] = [
    checked(state, gate, {
      label: facts.offer ? "Retain" : "Retain (raise)",
      command: `retain ${facts.id}`,
      ...(facts.offer ? { tone: "primary" as const } : {}),
    }),
  ];
  for (const buildId of facts.fitBuildIds) {
    if (buildId === facts.buildId) continue;
    const build = builds.find((b) => b.id === buildId);
    if (!build) continue;
    actions.push(checked(state, gate, { label: `Put on ${build.name}`, command: `staff ${build.slug} ${facts.id}` }));
  }
  if (facts.buildId !== null) actions.push(checked(state, gate, { label: "Back to the day job", command: `staff off ${facts.id}` }));
  actions.push(
    checked(state, gate, { label: "Let go…", command: `fire ${facts.id}`, mode: "prefill", tone: "danger" }),
    checked(state, gate, { label: "Their file", command: `team ${facts.id}` }),
    // A small office has no empty desk to click (the garage seats three), so a colleague's card
    // is where the next hire starts too: the job ad, this week's candidates, and signing one.
    { ...hireAction(state, facts.role, "Hire another"), row: "hire" }
  );
  if (canHireRole(facts.role, state.stage)) {
    const token = ROLE_HIRE_TOKENS[facts.role];
    const pool = buildWorldSnapshot(state).candidates[facts.role];
    if (!pool) actions.push(checked(state, gate, { label: "Candidates", command: `recruit ${token}`, row: "hire" }));
    for (const candidate of pool ?? []) {
      lines.push({
        label: candidate.name,
        value: `${candidateStats(candidate.shownPace, candidate.shownCraft, candidate.vetted)} · ${formatUsd(candidate.ask)}/wk`,
      });
      actions.push(
        checked(state, gate, { label: `Sign ${candidate.name.split(" ")[0]}`, command: `recruit ${token} ${candidate.index}` })
      );
    }
  }

  return {
    title: person.name,
    subtitle: `${roleTitle(facts.role)} · ${facts.id}`,
    lines,
    note: [
      facts.offer ? OFFER_NOTES[facts.offer.kind] : null,
      facts.quirk && facts.quirkBlurb ? `${titleCase(facts.quirk)}: ${facts.quirkBlurb}.` : null,
      facts.offer || facts.quirk ? null : roleBlurb(facts.role),
    ]
      .filter((part): part is string => part !== null)
      .join(" "),
    actions,
  };
};

const personCard = (state: GameState, personId: string, gate: Gate): InspectorCard | null => {
  // The snapshot is the single source of who exists and what they are called,
  // so the card always agrees with the label floating over the character.
  const person = buildWorldSnapshot(state).people.find((entry) => entry.id === personId);
  if (!person) return null;
  if (person.kind === "founder") return founderCard(state, person);
  if (person.kind === "cofounder") return cofounderCard(state, person);
  if (!person.role) return null;
  // A named person (the engine's "e17") has a file; an unlisted head (`${role}-k`) is the classic card.
  const facts = isNamedEmployeeId(person.id) ? describeEmployee(state, person.id) : null;
  return facts ? namedPersonCard(state, person, facts, gate) : employeeCard(state, person, person.role);
};

/** "pace 3 · craft 4 ✓" (vetted by HR) or "pace 3 · craft 4?" (what the résumé claims). */
const candidateStats = (pace: number, craft: number, vetted: boolean): string => `pace ${pace} · craft ${craft}${vetted ? " ✓" : "?"}`;

const emptyDeskCard = (state: GameState, slotIndex: number, gate: Gate): InspectorCard | null => {
  const desks = getOfficeLayout(state.companyPhase).deskSeats.length;
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= desks) return null;
  const snapshot = buildWorldSnapshot(state);
  const lines: InspectorLine[] = [cashLine(state), apLine(state)];
  const signing: InspectorAction[] = [];
  for (const role of ROLE_ORDER) {
    const pool = snapshot.candidates[role];
    if (!pool) continue;
    for (const candidate of pool) {
      lines.push({
        label: candidate.name,
        value: `${candidateStats(candidate.shownPace, candidate.shownCraft, candidate.vetted)} · ${formatUsd(candidate.ask)}/wk`,
      });
      signing.push(
        checked(state, gate, {
          label: `Sign ${candidate.name.split(" ")[0]} (${roleTitle(role)})`,
          command: `recruit ${ROLE_HIRE_TOKENS[role]} ${candidate.index}`,
          tone: "primary",
        })
      );
    }
  }
  const actions: InspectorAction[] = [...signing];
  for (const role of ROLE_ORDER) {
    actions.push({ ...hireAction(state, role, `${roleTitle(role)} · job ad`), row: role });
    // Candidates only for the roles the company may hire (a locked role's job ad already says when it unlocks).
    if (canHireRole(role, state.stage)) {
      actions.push(checked(state, gate, { label: "Candidates", command: `recruit ${ROLE_HIRE_TOKENS[role]}`, row: role }));
    }
  }
  return {
    title: "Empty desk",
    subtitle: signing.length > 0 ? "This week's candidates are in" : "Hire someone to fill it",
    lines,
    note:
      signing.length > 0
        ? "Résumés marked ? are the candidate's own account of themselves. HR would check. You do not have HR."
        : "A job ad brings a standard hire today. Candidates shows three real people with real stats, for a signing fee.",
    actions,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Stations
// ─────────────────────────────────────────────────────────────────────────────

/** Why "Start a build…" is off: every build slot of this office is in use. */
const slotsTaken = (slots: number): string => (slots === 1 ? "The only build slot is taken" : `All ${slots} build slots taken`);

/** The cheapest kickoff the company could start right now (of one type, or any): a prefill cannot be cheaper. */
const cheapestKickoff = (state: GameState, type?: BuildFacts["type"]): number => {
  const fees = startOptions(state)
    .options.filter((option) => option.unlocked && (type === undefined || option.type === type))
    .map((option) => option.kickoff);
  return fees.length > 0 ? Math.min(...fees) : 0;
};

const TIER_LABEL = { flop: "FLOP", shrug: "SHRUG", solid: "SOLID", breakout: "BREAKOUT" } as const;

const TYPE_SHORT: Record<BuildFacts["type"], string> = {
  feature: "Feature",
  growth: "Growth",
  premium: "Premium",
  plumbing: "Plumbing",
  moonshot: "Moonshot",
};

/**
 * One build on the board, two lines: "Atlas — Feature M · 46% · due wk 34 · crunch" and
 * "  ship now ≈ 62 ±6 SOLID · done ≈ 82" (or "done ≈ ? (nobody on it)").
 */
const buildLines = (build: BuildFacts): InspectorLine[] => {
  const late = build.weeksLate > 0;
  const status = build.built ? "built" : `${build.pct}%`;
  const due = late ? `${build.weeksLate}w late` : `due wk ${build.dueWeek}`;
  const tone: InspectorLineTone | undefined = build.built ? "good" : late ? "bad" : build.crunch ? "warn" : undefined;
  const { forecast } = build;
  const done = forecast.eta === null ? "done ≈ ? (nobody on it)" : `done ≈ ${forecast.finished}`;
  return [
    {
      label: build.name,
      value: `${TYPE_SHORT[build.type] ?? build.typeLabel} ${build.sizeLabel} · ${status} · ${due}${build.crunch ? " · crunch" : ""}`,
      ...(tone ? { tone } : {}),
    },
    {
      // Labels are keys: the second line of a build is labelled by its slug, indented.
      label: `  ↳ ${build.slug}`,
      value: `now ≈ ${forecast.now} ±${forecast.spread} ${TIER_LABEL[forecast.tierNow]}${build.built ? "" : ` · ${done}`}`,
      ...(forecast.tierNow === "flop" ? { tone: "bad" as const } : forecast.tierNow === "breakout" ? { tone: "good" as const } : {}),
    },
  ];
};

/** "Atlas · wk 7 · 58 SHRUG": what the wall last sent out, and how it went. */
const lastReleaseLine = (release: ProductFacts["recent"][number] | undefined): InspectorLine[] =>
  release
    ? [
        {
          label: "Last release",
          value: `${release.name} · wk ${release.week} · ${release.reception} ${TIER_LABEL[release.tier]}`,
          ...(release.tier === "flop" ? { tone: "bad" as const } : release.tier === "breakout" ? { tone: "good" as const } : {}),
        },
      ]
    : [];

/** Ship / crunch / fill seats / cancel for one build, each gated by the engine's own dry run. */
const buildActions = (state: GameState, build: BuildFacts, gate: Gate): InspectorAction[] => {
  const early = build.forecast.shippable && !build.built;
  const actions: InspectorAction[] = [
    checked(state, gate, {
      label: early ? `Ship ${build.name} early` : `Ship ${build.name}`,
      command: `ship ${build.slug}`,
      tone: build.built ? "primary" : early ? "danger" : "default",
      perk: true,
      ...(early && build.forecast.rushCruft > 0 ? { hint: `+${build.forecast.rushCruft} cruft` } : {}),
    }),
  ];
  if (!build.built || build.crunch) {
    actions.push(
      checked(state, gate, {
        label: build.crunch ? `Stop crunching ${build.name}` : `Crunch ${build.name}`,
        command: `build crunch ${build.slug} ${build.crunch ? "off" : "on"}`,
      })
    );
  }
  if (build.staffIds.length < build.seats) {
    actions.push(checked(state, gate, { label: `Fill ${build.name}'s seats`, command: `staff ${build.slug} auto` }));
  }
  actions.push(checked(state, gate, { label: `Cancel ${build.name}…`, command: `build cancel ${build.slug}`, mode: "prefill", tone: "danger" }));
  return actions;
};

const shipCard = (state: GameState, gate: Gate): InspectorCard => {
  const ap = getApCost(state, "ship");
  const builds = listBuilds(state);
  const product = productSummary(state);
  const { slotsFree } = startOptions(state);
  const patch = action(state, {
    label: builds.length > 0 ? "Ship a patch…" : "Ship a feature…",
    command: "ship ",
    mode: "prefill",
    ...(builds.length > 0 ? {} : { tone: "primary" as const }),
    ap,
    hint: perkAwareHint(ap),
  });
  const start = action(state, {
    label: "Start a build…",
    command: "build ",
    mode: "prefill",
    ap: getApCost(state, "build"),
    cash: cheapestKickoff(state),
    hint: `${getApCost(state, "build")} AP`,
    lock: slotsFree === 0 ? slotsTaken(product.slots) : undefined,
  });

  if (builds.length === 0 && product.shippedCount === 0) {
    const engineers = headcount(state.team, "engineering");
    const designers = headcount(state.team, "design");
    return {
      title: "Product wall",
      subtitle: "Where features ship",
      lines: [
        { label: "Engineers", value: formatCount(engineers) },
        { label: "Designers", value: formatCount(designers) },
        { label: "Reputation", value: outOf100(state.reputation), tone: earned(state.reputation) },
        { label: "ARPU", value: formatUsd(state.arpu) },
      ],
      note: "A patch ships today. A build takes weeks, a crew and a kickoff fee, and lands as a release — FLOP to BREAKOUT.",
      actions: [patch, start],
    };
  }

  return {
    title: "Product wall",
    subtitle:
      builds.length > 0
        ? `${builds.length} ${plural(builds.length, "build", "builds")} · ${slotsFree} ${plural(slotsFree, "slot", "slots")} free`
        : "Nothing in the works",
    lines: [
      { label: "Cruft", value: `${product.cruft} (${product.cruftWord})`, ...(product.cruft >= 40 ? { tone: "bad" as const } : product.cruft >= 15 ? { tone: "warn" as const } : {}) },
      { label: "Moat", value: `${product.moat} (${product.moatWord})` },
      { label: "Shipped", value: `${product.shippedCount} ${plural(product.shippedCount, "release", "releases")}` },
      ...lastReleaseLine(product.recent[0]),
      ...builds.flatMap((build) => buildLines(build)),
    ],
    ...(builds.length === 0 ? { note: "The board is empty. The roadmap says otherwise." } : {}),
    wide: true,
    actions: [...builds.flatMap((build) => buildActions(state, build, gate)), start, action(state, { label: "The board", command: "build" }), patch],
  };
};

const launchCard = (state: GameState): InspectorCard => {
  const ap = getApCost(state, "launch");
  const cash = campaignCost(state);
  return {
    title: "Growth corner",
    subtitle: "Where campaigns launch",
    lines: [
      { label: "Users", value: formatCount(state.users) },
      { label: "Marketing", value: formatCount(headcount(state.team, "marketing")) },
      { label: "Sales", value: formatCount(headcount(state.team, "sales")) },
      { label: "Campaign cost", value: formatUsd(cash) },
    ],
    actions: [
      action(state, {
        label: "Launch a campaign…",
        command: "launch ",
        mode: "prefill",
        tone: "primary",
        ap,
        cash,
        hint: perkAwareHint(ap, cash),
      }),
    ],
  };
};

/** The engine keeps at most six leads; show them all, warmest first. */
const pipelineLines = (state: GameState): InspectorLine[] => {
  const leads = [...state.investors.pipeline].sort((a, b) => b.relationship - a.relationship);
  if (leads.length === 0) return [{ label: "Pipeline", value: "No leads yet" }];
  return leads.map((lead) => ({
    label: lead.name,
    value: `${titleCase(lead.trendBias)} · ${outOf100(lead.relationship)}`,
    tone: lead.relationship >= 60 ? ("good" as const) : undefined,
  }));
};

const investorsCard = (state: GameState): InspectorCard => {
  const pitchAp = getApCost(state, "pitch");
  const raiseAp = getApCost(state, "raise-vc");
  const noLeads = state.investors.pipeline.length === 0;
  return {
    title: "Investor line",
    subtitle: "Pitch, then raise",
    lines: [
      { label: "Stage", value: titleCase(state.stage) },
      { label: "VC reputation", value: outOf100(state.vcReputation), tone: earned(state.vcReputation) },
      ...pipelineLines(state),
    ],
    ...(noLeads ? { note: "Pitch to find investors before you ask them for money." } : {}),
    actions: [
      action(state, {
        label: "Pitch investors",
        command: "pitch",
        tone: "primary",
        ap: pitchAp,
        hint: perkAwareHint(pitchAp),
      }),
      action(state, {
        label: "Raise from VCs…",
        command: "raise vc ",
        mode: "prefill",
        ap: raiseAp,
        hint: `${raiseAp} AP · up to ${formatUsd(stageRaiseCaps[state.stage].hardCap)}`,
        // The engine would take the AP and answer "no active investor leads".
        lock: noLeads ? "No investor leads — pitch first" : undefined,
      }),
      action(state, { label: "Funding options", command: "raise" }),
    ],
  };
};

const boardroomCard = (state: GameState): InspectorCard => {
  const members = state.board.members;
  // Dinners and gifts are for the directors who are not you.
  const noDirectors = members.every((member) => member.role === "founder");
  const lock = noDirectors ? "No board yet" : undefined;
  return {
    title: "Board table",
    subtitle: members.length > 0 ? `${members.length} directors` : "No board yet",
    lines: members.map((member) => ({
      label: member.name,
      value: `${PERSONALITY_PROFILES[member.personality].label} · ${Math.round(member.confidence)}`,
      tone: highIsGood(member.confidence),
    })),
    ...(members.length === 0 ? { note: "A board forms when you raise your first VC round." } : {}),
    actions: [
      action(state, { label: "Review the board", command: "board" }),
      action(state, {
        label: "Take a director to dinner…",
        command: "board dinner ",
        mode: "prefill",
        ap: 1,
        cash: BOARD_DINNER_COST,
        lock,
      }),
      action(state, {
        label: "Send a director a gift…",
        command: "board gift ",
        mode: "prefill",
        ap: 1,
        cash: BOARD_GIFT_COST,
        lock,
      }),
    ],
  };
};

const calendarCard = (state: GameState): InspectorCard => ({
  title: `Week ${state.week}`,
  subtitle: "Calendar",
  lines: [apLine(state, "AP left"), runwayLine(state), burnLine(state)],
  note:
    state.ap > 0
      ? `You still have ${state.ap} AP to spend this week.`
      : "Out of AP. Ending the week refills it.",
  actions: [action(state, { label: "End the week", command: "end", tone: "primary" })],
});

const COFFEE_LINES: readonly string[] = [
  "Technically the company's first hire.",
  "Brews in forty seconds. The roadmap takes longer.",
  "Fuel for the next questionable decision.",
  "The warmest thing in the office, most weeks.",
];

const coffeeFlavour = (state: GameState): string => {
  if (state.stress >= 70) return "The only colleague who never asks how the runway looks.";
  if (state.culture.morale < 35) return "Someone taped a note to it: \"same.\"";
  if (state.ap <= 0) return "It's late. The machine hums like it knows something.";
  return COFFEE_LINES[Math.abs(Math.trunc(state.week)) % COFFEE_LINES.length];
};

const coffeeCard = (state: GameState): InspectorCard => ({
  title: "Coffee machine",
  lines: [],
  note: coffeeFlavour(state),
  actions: [action(state, { label: "Drink coffee", command: "coffee" })],
});

const serversCard = (state: GameState): InspectorCard => {
  const usersDelta = state.users - state.lastWeek.users;
  const mrrDelta = state.mrr - state.lastWeek.mrr;
  return {
    title: "Servers",
    subtitle: "Users and revenue",
    lines: [
      {
        label: "Users",
        value: `${formatCount(state.users)} (${formatCountDelta(usersDelta)})`,
        tone: deltaTone(usersDelta),
      },
      { label: "MRR", value: `${formatUsd(state.mrr)} (${formatUsdDelta(mrrDelta)})`, tone: deltaTone(mrrDelta) },
      { label: "ARPU", value: formatUsd(state.arpu) },
      ...cruftLine(state),
    ],
    note: "Changes are since the start of last week.",
    actions: [
      action(state, { label: "Company status", command: "status" }),
      ...(state.product && state.product.cruft >= 15
        ? [
            action(state, {
              label: "Start plumbing…",
              command: "build plumbing ",
              mode: "prefill",
              ap: getApCost(state, "build"),
              cash: cheapestKickoff(state, "plumbing"),
              hint: `${getApCost(state, "build")} AP`,
              lock: startOptions(state).slotsFree === 0 ? slotsTaken(productSummary(state).slots) : undefined,
            }),
          ]
        : []),
    ],
  };
};

const CRUFT_RACK: ReadonlyArray<readonly [number, string]> = [
  [60, "sparking, gently"],
  [35, "cable spaghetti"],
  [15, "held together with tape"],
];

/** The rack shows the product's cruft once there is any worth mentioning. */
const cruftLine = (state: GameState): InspectorLine[] => {
  const cruft = state.product?.cruft ?? 0;
  const band = CRUFT_RACK.find(([at]) => cruft >= at);
  if (!band) return [];
  return [{ label: "Cruft", value: `${cruft} — ${band[1]}`, tone: cruft >= 40 ? "bad" : "warn" }];
};

const PRICING_ORDER: readonly PricingModel[] = ["consumer", "prosumer", "enterprise"];

const pricingCard = (state: GameState): InspectorCard => {
  const current = PRICING_MODELS[state.pricingModel];
  return {
    title: "Pricing board",
    subtitle: `${titleCase(state.pricingModel)} pricing`,
    lines: [
      { label: "ARPU", value: formatUsd(state.arpu) },
      { label: "Range", value: `${formatUsd(current.arpuMin)}–${formatUsd(current.arpuMax)}` },
    ],
    note: "Switching resets ARPU and churns about a fifth of your users.",
    actions: [
      ...PRICING_ORDER.map((model) =>
        action(state, {
          label: titleCase(model),
          command: `pricing ${model}`,
          ap: 1,
          lock: model === state.pricingModel ? "Current" : undefined,
        })
      ),
      action(state, { label: "Compare models", command: "pricing" }),
    ],
  };
};

const STATION_CARDS: Record<StationKind, (state: GameState, gate: Gate) => InspectorCard> = {
  ship: shipCard,
  launch: launchCard,
  investors: investorsCard,
  boardroom: boardroomCard,
  calendar: calendarCard,
  coffee: coffeeCard,
  servers: serversCard,
  pricing: pricingCard,
};

// ─────────────────────────────────────────────────────────────────────────────
// Assets, door, event beacon, overflow sign
// ─────────────────────────────────────────────────────────────────────────────

const assetEffects = (assetId: AssetId): string | null => {
  const { effects } = ASSET_CATALOG[assetId];
  const parts: string[] = [];
  if (effects.overheadReduction) parts.push(`Overhead -${Math.round(effects.overheadReduction * 100)}%`);
  if (effects.moraleBoost) parts.push(`Morale +${effects.moraleBoost}/wk`);
  if (effects.pitchSuccessBonus) parts.push(`Pitch +${Math.round(effects.pitchSuccessBonus * 100)}%`);
  if (effects.vcReputationBonus) parts.push(`VC rep +${effects.vcReputationBonus}`);
  if (effects.boardConfidenceBonus) parts.push(`Board +${effects.boardConfidenceBonus}`);
  return parts.length > 0 ? parts.join(", ") : null;
};

const assetCard = (state: GameState, assetId: AssetId): InspectorCard | null => {
  const def = ASSET_CATALOG[assetId];
  if (!def) return null;
  const owned = state.assets.find((asset) => asset.id === assetId);
  const effects = assetEffects(assetId);
  const effectLines: InspectorLine[] = effects ? [{ label: "Perks", value: effects, tone: "good" }] : [];
  const upkeep: InspectorLine = { label: "Upkeep", value: `${formatUsd(def.maintenanceCost)}/wk` };

  if (owned) {
    return {
      title: def.name,
      subtitle: "Owned",
      lines: [{ label: "Owned since", value: `Week ${owned.purchaseWeek}` }, upkeep, ...effectLines],
      note: def.description,
      actions: [action(state, { label: "Owned assets", command: "assets" })],
    };
  }

  const unlocked = phaseAtLeast(state.companyPhase, def.minPhase);
  return {
    title: def.name,
    subtitle: unlocked ? "For sale" : `Unlocks in the ${titleCase(def.minPhase)} phase`,
    lines: [{ label: "Cost", value: formatUsd(def.cost) }, upkeep, ...effectLines],
    note: def.description,
    actions: [
      action(state, {
        label: "Buy",
        command: `buy ${assetId}`,
        tone: "primary",
        ap: getApCost(state, "buy"),
        cash: def.cost,
        lock: unlocked ? undefined : `Requires ${titleCase(def.minPhase)} phase`,
      }),
    ],
  };
};

const doorCard = (state: GameState): InspectorCard => {
  const next = PHASE_ORDER[PHASE_ORDER.indexOf(state.companyPhase) + 1];
  return {
    title: "Company roadmap",
    subtitle: "Where this is all going",
    lines: [
      { label: "Phase", value: titleCase(state.companyPhase) },
      { label: "Stage", value: titleCase(state.stage) },
      { label: "Valuation", value: formatUsd(state.valuation) },
      { label: "Next phase", value: next ? titleCase(next) : "You made it" },
    ],
    actions: [action(state, { label: "View the roadmap", command: "phases" })],
  };
};

const eventBeaconCard = (state: GameState): InspectorCard | null => {
  const event = state.pendingEvent;
  if (!event) return null;
  return {
    title: event.title,
    subtitle: "Event · needs a decision",
    lines: [],
    // The engine's prose carries typewriter pacing tokens ("[[beat]]") meant for the terminal.
    note: stripTypewriterTokens(event.prompt),
    actions: event.choices.map((choice, index) =>
      action(state, { label: stripTypewriterTokens(choice.text), command: `choose ${index + 1}` })
    ),
  };
};

/** What the live world itself reports, when there is one; each field falls back to a derivation from the state. */
export interface WorldReadout {
  /** WorldHandle.hiddenCount(): people the office has no visible spot for. */
  hiddenCount?: number;
  /**
   * False for a quick read — a hover chip or "would a click open a card?" — where only the title
   * matters: the engine-gated buttons then skip their dry runs (and carry no gating). Default true.
   */
  gate?: boolean;
}

/**
 * People the office has no room to show. Matches what the world's seating plan
 * reports once setup is complete: everyone beyond the render cap, plus everyone
 * in the roster beyond the desks and floor spots of the current office.
 */
export const overflowHeadcount = (state: GameState): number => {
  const snapshot = buildWorldSnapshot(state);
  const layout = getOfficeLayout(state.companyPhase);
  const capacity = layout.deskSeats.length + layout.overflowSpots.length;
  const visibleEmployees = snapshot.people.filter((person) => person.kind === "employee").length;
  return snapshot.hiddenPeople + Math.max(0, visibleEmployees - capacity);
};

/** Whole people on the team (the engine can hold fractional head counts; the world never shows them). */
const wholeTeamSize = (state: GameState): number =>
  ROLE_ORDER.reduce((total, role) => total + headcount(state.team, role), 0);

const overflowCard = (state: GameState, readout: WorldReadout): InspectorCard | null => {
  const hidden = readout.hiddenCount ?? overflowHeadcount(state);
  if (hidden <= 0) return null;
  const next = PHASE_ORDER[PHASE_ORDER.indexOf(state.companyPhase) + 1];
  return {
    title: `+${formatCount(hidden)} more ${hidden === 1 ? "person" : "people"}`,
    subtitle: "Office over capacity",
    lines: [{ label: "Team", value: formatCount(wholeTeamSize(state)) }],
    note: next
      ? `There are more people than places to sit. They are on the payroll and doing their jobs; you will see them once the company reaches the ${titleCase(next)} phase and moves somewhere bigger.`
      : "There are more people than places to sit. They are on the payroll and doing their jobs, just out of frame.",
    actions: [action(state, { label: "View the roadmap", command: "phases" })],
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The card for a clicked target, derived from the live game state.
 *
 * Returns null when the target does not exist in this state (a person who has
 * left, a desk the current office does not have, the event beacon once the
 * event is resolved, the overflow sign once everyone fits) — the overlay takes
 * that as "close the card".
 */
export const describeTarget = (
  target: InteractableTarget,
  state: GameState,
  readout: WorldReadout = {}
): InspectorCard | null => {
  const gate = readout.gate ?? true;
  switch (target.kind) {
    case "person":
      return personCard(state, target.personId, gate);
    case "empty-desk":
      return emptyDeskCard(state, target.slotIndex, gate);
    case "station":
      return STATION_CARDS[target.station]?.(state, gate) ?? null;
    case "asset":
      return assetCard(state, target.assetId);
    case "door":
      return doorCard(state);
    case "event-beacon":
      return eventBeaconCard(state);
    case "overflow-sign":
      return overflowCard(state, readout);
  }
};
