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
 * inspector.test.ts feeds every enabled command to the real engine, and every
 * disabled one too, to keep the two from drifting apart.
 */
import { ASSET_CATALOG, phaseAtLeast } from "../../engine/assets";
import { PERSONALITY_PROFILES } from "../../engine/board";
import { calcNetBurn, calcRunwayWeeks, getApCost, getEffectiveMaxAp, roleComp } from "../../engine/economy";
import { stageRaiseCaps } from "../../engine/investors";
import { PRICING_MODELS } from "../../engine/pricing";
import { canHireRole, ROLE_MIN_STAGE } from "../../engine/stagePerks";
import type { AssetId, CompanyPhase, GameState, PricingModel, TeamRole } from "../../types/game";
import { stripTypewriterTokens } from "../../ui/terminal/tokens";
import { ROLE_HIRE_TOKENS, roleBlurb, roleTitle } from "../names";
import { getOfficeLayout } from "../office/layouts";
import { buildWorldSnapshot, headcount, ROLE_ORDER } from "../snapshot";
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

/** The only commands a card uses that executeCommand lets through while an event is pending. */
const ALLOWED_DURING_EVENT: ReadonlySet<string> = new Set(["choose", "status"]);
/** …and while the founder is still being set up. */
const ALLOWED_DURING_SETUP: ReadonlySet<string> = new Set(["status"]);

/** Mirrors `isSetupComplete` in src/engine/commands.ts (not exported there). */
const isSetupComplete = (state: GameState): boolean =>
  Boolean(
    state.founder.name.trim() &&
      state.companyName.trim() &&
      state.founder.archetype &&
      state.cofounder.archetype
  );

const verbOf = (command: string): string => command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

/**
 * Why the engine would refuse `command` before even looking at what it costs,
 * or undefined when the run is in a state that accepts it.
 */
export const commandBlocker = (state: GameState, command: string): string | undefined => {
  const verb = verbOf(command);
  if (state.gameOver) return DISABLED_REASONS.runOver;
  if (state.pendingEvent && !ALLOWED_DURING_EVENT.has(verb)) return DISABLED_REASONS.event;
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

const personCard = (state: GameState, personId: string): InspectorCard | null => {
  // The snapshot is the single source of who exists and what they are called,
  // so the card always agrees with the label floating over the character.
  const person = buildWorldSnapshot(state).people.find((entry) => entry.id === personId);
  if (!person) return null;
  if (person.kind === "founder") return founderCard(state, person);
  if (person.kind === "cofounder") return cofounderCard(state, person);
  return person.role ? employeeCard(state, person, person.role) : null;
};

const emptyDeskCard = (state: GameState, slotIndex: number): InspectorCard | null => {
  const desks = getOfficeLayout(state.companyPhase).deskSeats.length;
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= desks) return null;
  return {
    title: "Empty desk",
    subtitle: "Hire someone to fill it",
    lines: [cashLine(state), apLine(state)],
    actions: ROLE_ORDER.map((role) => hireAction(state, role, roleTitle(role))),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Stations
// ─────────────────────────────────────────────────────────────────────────────

const shipCard = (state: GameState): InspectorCard => {
  const engineers = headcount(state.team, "engineering");
  const designers = headcount(state.team, "design");
  const ap = getApCost(state, "ship");
  return {
    title: "Product wall",
    subtitle: "Where features ship",
    lines: [
      { label: "Engineers", value: formatCount(engineers) },
      { label: "Designers", value: formatCount(designers) },
      { label: "Reputation", value: outOf100(state.reputation), tone: earned(state.reputation) },
      { label: "ARPU", value: formatUsd(state.arpu) },
    ],
    actions: [
      action(state, {
        label: "Ship a feature…",
        command: "ship ",
        mode: "prefill",
        tone: "primary",
        ap,
        hint: perkAwareHint(ap),
      }),
    ],
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
    ],
    note: "Changes are since the start of last week.",
    actions: [action(state, { label: "Company status", command: "status" })],
  };
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

const STATION_CARDS: Record<StationKind, (state: GameState) => InspectorCard> = {
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
  switch (target.kind) {
    case "person":
      return personCard(state, target.personId);
    case "empty-desk":
      return emptyDeskCard(state, target.slotIndex);
    case "station":
      return STATION_CARDS[target.station]?.(state) ?? null;
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
