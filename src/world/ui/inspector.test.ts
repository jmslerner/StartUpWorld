import { describe, expect, it } from "vitest";
import { executeCommand } from "../../engine";
import { ALL_ASSET_IDS, ASSET_CATALOG } from "../../engine/assets";
import { computeContext } from "../../engine/context";
import { getEffectiveMaxAp, roleComp } from "../../engine/economy";
import { eventPool } from "../../engine/events/pool";
import { toPendingEvent } from "../../engine/events/types";
import { makeState, makeTycoonState } from "../../engine/testHelpers";
import type {
  ActionResult,
  BoardState,
  Build,
  Employee,
  EndingType,
  FounderArchetype,
  GameState,
  InvestorLead,
  Stage,
  TeamRole,
  TeamRoster,
} from "../../types/game";
import { mix32 } from "../hash";
import { ROLE_HIRE_TOKENS, roleBlurb, roleTitle } from "../names";
import { getOfficeLayout } from "../office/layouts";
import { stripTypewriterTokens } from "../../ui/terminal/tokens";
import { buildWorldSnapshot, ROLE_ORDER } from "../snapshot";
import type { InteractableTarget, StationKind } from "../types";
import { isRejected } from "./actionSignal";
import { formatCount, formatUsd, formatUsdDelta, titleCase } from "./format";
import {
  campaignCost,
  commandBlocker,
  describeTarget,
  DISABLED_REASONS,
  overflowHeadcount,
  type InspectorAction,
  type InspectorCard,
} from "./inspector";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const STATIONS: StationKind[] = ["ship", "launch", "investors", "boardroom", "calendar", "coffee", "servers", "pricing"];
const FOUNDERS: FounderArchetype[] = ["visionary", "hacker", "sales-animal", "philosopher"];
const ENDINGS: EndingType[] = [
  "ipo",
  "acquisition",
  "bankruptcy",
  "founder-removal",
  "zombie-saas",
  "ai-hype-exit",
  "forced-acquisition",
];

const team = (counts: Partial<TeamRoster>): TeamRoster => ({
  engineering: 0,
  design: 0,
  marketing: 0,
  sales: 0,
  ops: 0,
  hr: 0,
  legal: 0,
  data: 0,
  product: 0,
  executive: 0,
  ...counts,
});

const board = (): BoardState => ({
  lastMeetingWeek: 0,
  members: [
    { id: "b-founder", name: "Thomas Park", role: "founder", personality: "cheerleader", confidence: 95 },
    { id: "b-cofounder", name: "Ana Costa", role: "cofounder", personality: "operator", confidence: 70 },
    { id: "b-investor", name: "Sarah Chen", role: "investor", personality: "activist", confidence: 35 },
    { id: "b-indie", name: "Marcus Webb", role: "independent", personality: "old-guard", confidence: 55 },
  ],
});

const leads = (): InvestorLead[] => [
  { id: "lead-1", name: "Northlight Capital", riskTolerance: 60, trendBias: "ai", relationship: 72 },
  { id: "lead-2", name: "Quiet Harbor", riskTolerance: 30, trendBias: "devtools", relationship: 41 },
];

/**
 * makeState() carries hand-written derived numbers. One no-op command lets the
 * engine recompute burn, valuation and phase, so the fixture is a state a real
 * run could be in.
 */
const settled = (overrides: Partial<GameState> = {}): GameState => executeCommand(makeState(overrides), "status").state;

const garage = (overrides: Partial<GameState> = {}): GameState => settled(overrides);

/** A public company: growth stage, a full org chart, a board, investors, some toys. */
const lateGame = (overrides: Partial<GameState> = {}): GameState =>
  settled({
    week: 140,
    ap: 4,
    cash: 60_000_000,
    stage: "growth",
    users: 1_200_000,
    arpu: 90,
    mrr: 108_000_000,
    reputation: 82,
    vcReputation: 88,
    pricingModel: "enterprise",
    team: team({
      engineering: 14,
      design: 5,
      product: 4,
      data: 4,
      marketing: 6,
      sales: 7,
      ops: 5,
      hr: 2,
      legal: 2,
      executive: 3,
    }),
    board: board(),
    investors: { pipeline: leads() },
    assets: [
      { id: "office-upgrade", name: "Office Upgrade", purchaseWeek: 31 },
      { id: "helicopter", name: "Company Helicopter", purchaseWeek: 77 },
    ],
    lastWeek: { users: 1_150_000, mrr: 103_000_000, cash: 58_000_000, teamSize: 52 },
    ...overrides,
  });

const withEvent = (state: GameState, index = 0): GameState => ({
  ...state,
  pendingEvent: toPendingEvent(eventPool[index], state, computeContext(state)),
});

const gameOver = (state: GameState, ending: EndingType): GameState => ({
  ...state,
  gameOver: { ending, week: state.week, headline: "The end." },
});

/** Every target the world can hand to the inspector for this state. */
const allTargets = (state: GameState): InteractableTarget[] => [
  { kind: "person", personId: "founder" },
  { kind: "person", personId: "cofounder" },
  ...ROLE_ORDER.map((role): InteractableTarget => ({ kind: "person", personId: `${role}-0` })),
  // Named people (a run with the engine's roster): the first of each department.
  ...namedSample(state).map((personId): InteractableTarget => ({ kind: "person", personId })),
  { kind: "empty-desk", slotIndex: 0 },
  { kind: "empty-desk", slotIndex: getOfficeLayout(state.companyPhase).deskSeats.length - 1 },
  ...STATIONS.map((station): InteractableTarget => ({ kind: "station", station })),
  ...ALL_ASSET_IDS.map((assetId): InteractableTarget => ({ kind: "asset", assetId })),
  { kind: "door" },
  { kind: "event-beacon" },
  { kind: "overflow-sign" },
];

/** The first named person of each department, if the state carries a roster. */
function namedSample(state: GameState): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const view of buildWorldSnapshot(state).people) {
    if (view.kind !== "employee" || !/^e\d+$/.test(view.id) || view.role === null || seen.has(view.role)) continue;
    seen.add(view.role);
    ids.push(view.id);
  }
  return ids;
}

const station = (state: GameState, kind: StationKind): InspectorCard => {
  const card = describeTarget({ kind: "station", station: kind }, state);
  if (!card) throw new Error(`no card for station ${kind}`);
  return card;
};

const cardFor = (target: InteractableTarget, state: GameState): InspectorCard => {
  const card = describeTarget(target, state);
  if (!card) throw new Error(`no card for ${JSON.stringify(target)}`);
  return card;
};

const actionFor = (card: InspectorCard, command: string): InspectorAction => {
  const found = card.actions.find((entry) => entry.command === command);
  if (!found) throw new Error(`"${card.title}" has no action "${command}"`);
  return found;
};

const lineValue = (card: InspectorCard, label: string): string | undefined =>
  card.lines.find((line) => line.label === label)?.value;

// ─────────────────────────────────────────────────────────────────────────────
// The engine as the judge
// ─────────────────────────────────────────────────────────────────────────────

/** Everything a command can touch that a player would notice. */
const fingerprint = (state: GameState): string =>
  JSON.stringify([
    state.week,
    state.ap,
    state.cash,
    state.team,
    state.assets.map((asset) => asset.id),
    state.pricingModel,
    state.pendingEvent?.id ?? null,
    state.gameOver?.ending ?? null,
    state.board.members.map((member) => member.confidence),
    state.investors.pipeline.map((lead) => [lead.id, lead.relationship]),
    state.users,
    state.reputation,
    state.vcReputation,
    state.freeActionUsed,
    state.product?.active.map((build) => [build.id, build.crunch]) ?? null,
    state.product?.shippedCount ?? 0,
    state.people?.roster.map((e) => [e.id, e.buildId, e.offerDueWeek, e.salary]) ?? null,
    state.people?.candidatesWeek ?? 0,
  ]);

const unchanged = (before: GameState, result: ActionResult): boolean => fingerprint(before) === fingerprint(result.state);

/** The engine took the command: no refusal, no "unknown command", no usage text. */
const complaint = (result: ActionResult): string | null => {
  if (isRejected(result)) return `rejected: ${result.logs.map((entry) => entry.text).join(" | ")}`;
  // `pricing` legitimately ends its comparison with a "Usage:" line; only an
  // error-kind usage line (caught above) means the command was malformed.
  const unknown = result.logs.find((entry) => /^(Unknown command|Unknown role)/.test(entry.text));
  return unknown ? `unknown: ${unknown.text}` : null;
};

/** The engine declined to do anything. */
const refused = (before: GameState, result: ActionResult): boolean => result.sound === undefined && unchanged(before, result);

/** Commands that only print something. The engine answers these even after the run has ended. */
const READ_ONLY = new Set(["status", "perks", "phases", "board", "raise", "pricing", "assets", "coffee", "build", "team"]);
/** Commands that must visibly change the game when they are accepted. */
const MUTATING = /^(hire |end$|buy |pricing \w|pitch$|choose |retain |staff |recruit \w+ \d|build (crunch|cancel) |ship [a-z0-9-]+$)/;

const NO_LEADS = "No investor leads — pitch first";
/** Complete commands the cards only ever put in the terminal, for the player to confirm with Enter. */
const CONFIRM_PREFILL = /^(fire \S+|build cancel \S+)$/;

/** What a player would plausibly type after a prefill. */
const completePrefill = (command: string, state: GameState): string => {
  // A complete command left for the player to confirm (`fire e3`, `build cancel atlas`).
  if (!command.endsWith(" ")) return command;
  if (command === "ship ") return "ship Dark mode";
  if (command === "build ") return "build feature s Moonlight";
  if (command === "build plumbing ") return "build plumbing s Pipes";
  if (command === "launch ") return "launch Spring push";
  if (command === "raise vc ") return "raise vc 100k";
  if (command === "board dinner " || command === "board gift ") {
    const director = state.board.members.find((member) => member.role !== "founder");
    return `${command}${director?.name ?? "nobody"}`;
  }
  throw new Error(`unexpected prefill "${command}"`);
};

/**
 * The contract of every card: an enabled button is a command the engine takes
 * as written, and a disabled one is a command the engine would turn down.
 */
const expectCardHonest = (card: InspectorCard, state: GameState, where: string): void => {
  expect(card.title.trim(), where).not.toBe("");
  const commands = card.actions.map((entry) => entry.command);
  expect(new Set(commands).size, `${where}: duplicate commands`).toBe(commands.length);

  for (const entry of card.actions) {
    const at = `${where} → "${entry.command}"${entry.disabledReason ? ` (disabled: ${entry.disabledReason})` : ""}`;
    expect(entry.label.trim(), at).not.toBe("");
    if (entry.disabledReason !== undefined) expect(entry.disabledReason.trim(), at).not.toBe("");

    if (entry.mode === "run") {
      expect(entry.command, at).toBe(entry.command.trim());
      expect(entry.command, at).not.toBe("");
    } else if (!CONFIRM_PREFILL.test(entry.command)) {
      expect(entry.command.endsWith(" "), `${at}: a prefill leaves room for the argument`).toBe(true);
    }

    const typed = entry.mode === "run" ? entry.command : completePrefill(entry.command, state);
    const verb = typed.split(" ")[0];
    const result = executeCommand(state, typed);

    if (entry.disabledReason === undefined) {
      expect(complaint(result), at).toBeNull();
      if (entry.mode === "prefill" || MUTATING.test(typed)) {
        expect(unchanged(state, result), `${at}: accepted but nothing happened`).toBe(false);
      }
      continue;
    }

    if (entry.disabledReason === DISABLED_REASONS.runOver && READ_ONLY.has(verb) && typed === verb) {
      // Deliberate policy: once the run is over the world is read-only, even
      // for commands the terminal would still answer.
      expect(unchanged(state, result), at).toBe(true);
    } else if (entry.disabledReason === NO_LEADS && state.ap >= 2) {
      // The engine does not refuse this one: it takes the AP and fails. Disabling it is a kindness.
      expect(result.sound, at).toBe("fail");
      expect(result.state.cash, at).toBe(state.cash);
      expect(result.state.ap, at).toBeLessThan(state.ap);
    } else {
      expect(refused(state, result), `${at}: the engine would have done it — ${result.logs.map((l) => l.text).join(" | ")}`).toBe(true);
    }
  }
};

const expectAllCardsHonest = (state: GameState, where: string): number => {
  let cards = 0;
  for (const target of allTargets(state)) {
    const card = describeTarget(target, state);
    if (!card) continue;
    cards += 1;
    expectCardHonest(card, state, `${where} / ${JSON.stringify(target)}`);
  }
  return cards;
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────────

describe("format", () => {
  it("writes money in the HUD's compact style, without padding zeros", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(950)).toBe("$950");
    expect(formatUsd(3000)).toBe("$3K");
    expect(formatUsd(17_800)).toBe("$17.8K");
    expect(formatUsd(250_000)).toBe("$250K");
    expect(formatUsd(2_000_000)).toBe("$2M");
    expect(formatUsd(1_250_000)).toBe("$1.25M");
    expect(formatUsd(15_000_000_000)).toBe("$15B");
    expect(formatUsd(2_500_000_000_000)).toBe("$2.5T");
    expect(formatUsd(-4200)).toBe("-$4.2K");
  });

  it("never prints a four-digit mantissa", () => {
    expect(formatUsd(999_950)).toBe("$1M");
    expect(formatUsd(999_996_000)).toBe("$1B");
    expect(formatUsd(999_949)).toBe("$999.9K");
  });

  it("signs deltas and survives nonsense", () => {
    expect(formatUsdDelta(1200)).toBe("+$1.2K");
    expect(formatUsdDelta(-300)).toBe("-$300");
    expect(formatUsd(Number.NaN)).toBe("$0");
    expect(formatCount(12_500.4)).toBe("12,500");
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("0");
  });

  it("title-cases engine tokens", () => {
    expect(titleCase("sales-animal")).toBe("Sales Animal");
    expect(titleCase("series-a")).toBe("Series A");
    expect(titleCase("garage")).toBe("Garage");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gating
// ─────────────────────────────────────────────────────────────────────────────

describe("commandBlocker", () => {
  it("lets everything through in a playable state", () => {
    const state = garage();
    for (const command of ["hire eng 1", "end", "status", "perks", "coffee", "choose 1"]) {
      expect(commandBlocker(state, command), command).toBeUndefined();
    }
  });

  it("blocks everything once the run is over", () => {
    const state = gameOver(garage(), "bankruptcy");
    for (const command of ["hire eng 1", "end", "status", "choose 1"]) {
      expect(commandBlocker(state, command), command).toBe(DISABLED_REASONS.runOver);
    }
  });

  it("lets only `choose` and `status` through while an event is pending", () => {
    const state = withEvent(garage());
    expect(commandBlocker(state, "choose 2")).toBeUndefined();
    expect(commandBlocker(state, "status")).toBeUndefined();
    for (const command of ["hire eng 1", "end", "perks", "phases", "coffee", "board", "raise", "pricing"]) {
      expect(commandBlocker(state, command), command).toBe(DISABLED_REASONS.event);
      expect(isRejected(executeCommand(state, command)), command).toBe(true);
    }
  });

  it("lets only `status` through until setup is complete, at every step of it", () => {
    const steps: GameState[] = [
      makeState({ founder: { name: "", archetype: null }, companyName: "", cofounder: { ...makeState().cofounder, archetype: null } }),
      makeState({ founder: { name: "Ada", archetype: null }, companyName: "", cofounder: { ...makeState().cofounder, archetype: null } }),
      makeState({ founder: { name: "Ada", archetype: null }, cofounder: { ...makeState().cofounder, archetype: null } }),
      makeState({ cofounder: { ...makeState().cofounder, archetype: null } }),
    ];
    for (const [index, state] of steps.entries()) {
      expect(commandBlocker(state, "status"), `step ${index}`).toBeUndefined();
      expect(isRejected(executeCommand(state, "status")), `step ${index}`).toBe(false);
      for (const command of ["hire eng 1", "end", "perks", "phases", "coffee", "pitch", "buy lounge"]) {
        expect(commandBlocker(state, command), `step ${index}: ${command}`).toBe(DISABLED_REASONS.setup);
        expect(refused(state, executeCommand(state, command)), `step ${index}: ${command}`).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Every card, against the real engine
// ─────────────────────────────────────────────────────────────────────────────

describe("every card is honest about what the engine will do", () => {
  it("in the garage, for every founder archetype", () => {
    for (const archetype of FOUNDERS) {
      const state = garage({ founder: { name: "Ada", archetype }, team: team({ engineering: 2, design: 1, ops: 1 }) });
      expect(expectAllCardsHonest(state, `garage/${archetype}`)).toBeGreaterThanOrEqual(20);
    }
  });

  it("in the garage with no AP left (free weekly actions still work)", () => {
    for (const archetype of FOUNDERS) {
      const state = garage({ ap: 0, founder: { name: "Ada", archetype } });
      expectAllCardsHonest(state, `garage/0ap/${archetype}`);
      // …and once the free action has been used, too.
      const used = { [`${archetype}-free-ship`]: true, [`${archetype}-free-launch`]: true, [`${archetype}-free-pitch`]: true };
      expectAllCardsHonest({ ...state, freeActionUsed: used }, `garage/0ap/used/${archetype}`);
    }
  });

  it("in the garage with one AP (a VC raise needs two)", () => {
    const state = garage({ ap: 1, investors: { pipeline: leads() }, board: board() });
    expectAllCardsHonest(state, "garage/1ap");
  });

  it("in the garage with little or no cash", () => {
    for (const cash of [0, 100, 899, 900, 1999, 2000, 2199, 2200, 4999, 5000, 5999, 6000]) {
      const state = garage({ cash, board: board(), investors: { pipeline: leads() } });
      expectAllCardsHonest(state, `garage/cash ${cash}`);
    }
  });

  it("at every funding stage", () => {
    const stages: Stage[] = ["garage", "seed", "series-a", "growth"];
    for (const stage of stages) {
      for (const cash of [1000, 3_000_000]) {
        const state = settled({ stage, cash, team: team({ engineering: 3, marketing: 2, data: 1 }) });
        expectAllCardsHonest(state, `stage ${stage}/cash ${cash}`);
      }
    }
  });

  it("in a late-game public company", () => {
    const state = lateGame();
    expect(state.companyPhase).toBe("public");
    expect(expectAllCardsHonest(state, "late")).toBe(allTargets(state).length - 2); // no event, nobody hidden
    expectAllCardsHonest(lateGame({ ap: 0 }), "late/0ap");
    expectAllCardsHonest(lateGame({ ap: 1 }), "late/1ap");
    expectAllCardsHonest(lateGame({ cash: 0 }), "late/broke");
    expectAllCardsHonest(lateGame({ cash: 1_999_999 }), "late/almost a jet");
    expectAllCardsHonest(lateGame({ investors: { pipeline: [] } }), "late/no leads");
    expectAllCardsHonest(lateGame({ board: { members: [], lastMeetingWeek: 0 } }), "late/no board");
  });

  it("in every company phase", () => {
    const mrrFor = { garage: 1_000, coworking: 100_000, office: 4_000_000, unicorn: 100_000_000, public: 108_000_000 };
    const stageFor: Record<string, Stage> = { garage: "garage", coworking: "seed", office: "series-a", unicorn: "series-a", public: "growth" };
    for (const phase of ["garage", "coworking", "office", "unicorn", "public"] as const) {
      const state = lateGame({ stage: stageFor[phase], mrr: mrrFor[phase], assets: [] });
      expect(state.companyPhase, phase).toBe(phase);
      expectAllCardsHonest(state, `phase ${phase}`);
    }
  });

  it("while any event from the pool is pending", () => {
    eventPool.forEach((_, index) => {
      expectAllCardsHonest(withEvent(garage(), index), `garage/event ${eventPool[index].id}`);
      expectAllCardsHonest(withEvent(lateGame(), index), `late/event ${eventPool[index].id}`);
    });
  });

  it("after every ending", () => {
    for (const ending of ENDINGS) {
      for (const state of [gameOver(garage(), ending), gameOver(lateGame(), ending), gameOver(withEvent(lateGame()), ending)]) {
        expectAllCardsHonest(state, `over/${ending}`);
        for (const target of allTargets(state)) {
          for (const entry of describeTarget(target, state)?.actions ?? []) {
            expect(entry.disabledReason, `${ending}: ${entry.command}`).toBe(DISABLED_REASONS.runOver);
          }
        }
      }
    }
  });

  it("during setup, whatever target it is handed", () => {
    const blank = makeState({
      founder: { name: "", archetype: null },
      companyName: "",
      cofounder: { ...makeState().cofounder, archetype: null },
    });
    const named = executeCommand(blank, "name Ada").state;
    const incorporated = executeCommand(named, "company Loop").state;
    const founded = executeCommand(incorporated, "founder hacker").state;
    for (const [index, state] of [blank, named, incorporated, founded].entries()) {
      expectAllCardsHonest(state, `setup step ${index}`);
      for (const target of allTargets(state)) {
        for (const entry of describeTarget(target, state)?.actions ?? []) {
          if (entry.command === "status") expect(entry.disabledReason).toBeUndefined();
          else expect(entry.disabledReason, `${index}: ${entry.command}`).toBe(DISABLED_REASONS.setup);
        }
      }
    }
    // The engine's starting engineer is described even though the world hides them until setup ends.
    expect(describeTarget({ kind: "person", personId: "engineering-0" }, blank)?.subtitle).toBe("Engineer");
    expect(describeTarget({ kind: "person", personId: "founder" }, blank)?.title).toBe("Founder");
    expect(describeTarget({ kind: "person", personId: "cofounder" }, founded)).toBeNull();
  });

  it("throughout whole games played by clicking card buttons", () => {
    let checked = 0;
    for (const [run, archetype] of FOUNDERS.entries()) {
      let state = makeState({
        founder: { name: "", archetype: null },
        companyName: "",
        cofounder: { ...makeState().cofounder, archetype: null },
        seed: 9000 + run,
        rng: mix32(9000 + run) || 1,
      });
      for (const input of ["name Ada", "company Loop", `founder ${archetype}`, "cofounder builder"]) {
        state = executeCommand(state, input).state;
      }

      let dice = mix32(77 + run);
      const roll = (sides: number): number => {
        dice = mix32(dice + 0x9e3779b9);
        return dice % sides;
      };

      for (let step = 0; step < 140 && !state.gameOver; step += 1) {
        checked += expectAllCardsHonest(state, `play ${archetype} step ${step} (week ${state.week})`);

        // Click a random enabled button on a random card, like a player exploring the office.
        const cards = allTargets(state)
          .map((target) => describeTarget(target, state))
          .filter((card): card is InspectorCard => card !== null);
        const enabled = cards.flatMap((card) => card.actions).filter((entry) => entry.disabledReason === undefined);
        const spending = enabled.filter((entry) => entry.mode === "prefill" || MUTATING.test(entry.command));
        // Bias toward ending the week so runs get somewhere; keep cash coming in so they last.
        const endWeek = enabled.find((entry) => entry.command === "end");
        const pick =
          endWeek && (state.ap === 0 || roll(4) === 0)
            ? endWeek
            : spending.length > 0
              ? spending[roll(spending.length)]
              : enabled[roll(enabled.length)];
        if (!pick) break;
        const typed = pick.mode === "run" ? pick.command : completePrefill(pick.command, state);
        const result = executeCommand(state, typed);
        expect(complaint(result), `play ${archetype} step ${step}: ${typed}`).toBeNull();
        state = result.state;
        if (state.cash < 20_000 && !state.pendingEvent && !state.gameOver && state.ap > 0) {
          state = executeCommand(state, "raise mortgage").state;
        }
      }
    }
    expect(checked).toBeGreaterThan(4000);
    // Plays several whole games: about 2.5 s on an 8-core Mac, over the 5 s default on a GitHub runner.
  }, 20_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// What each card says
// ─────────────────────────────────────────────────────────────────────────────

describe("people", () => {
  it("founder: name, archetype, stress, AP, equity, status + perks", () => {
    const state = garage({ stress: 74, capTable: { founderPct: 0.62, investorPct: 0.38 } });
    const card = cardFor({ kind: "person", personId: "founder" }, state);
    expect(card.title).toBe("Test Founder");
    expect(card.subtitle).toBe("Founder · Hacker");
    expect(card.lines).toEqual([
      { label: "Stress", value: "74/100", tone: "bad" },
      { label: "AP", value: `3/${getEffectiveMaxAp(state)}` },
      { label: "Founder equity", value: "62%" },
    ]);
    expect(card.actions.map((entry) => [entry.command, entry.mode])).toEqual([
      ["status", "run"],
      ["perks", "run"],
    ]);
    expect(cardFor({ kind: "person", personId: "founder" }, garage({ founder: { name: "Ada", archetype: "sales-animal" } })).subtitle).toBe(
      "Founder · Sales Animal"
    );
  });

  it("cofounder: archetype, trust / ego / ambition", () => {
    const state = garage();
    const card = cardFor({ kind: "person", personId: "cofounder" }, state);
    expect(card.title).toBe("Test Cofounder");
    expect(card.subtitle).toBe("Cofounder · Operator");
    expect(card.lines.map((line) => [line.label, line.value])).toEqual([
      ["Trust", "70/100"],
      ["Ego", "30/100"],
      ["Ambition", "50/100"],
    ]);
  });

  it("employee: the same name the world shows, role, salary, blurb and a one-click hire", () => {
    const state = lateGame();
    const people = buildWorldSnapshot(state).people;
    for (const role of ROLE_ORDER) {
      const person = people.find((entry) => entry.id === `${role}-1`);
      if (!person) throw new Error(`fixture has no second ${role}`);
      const card = cardFor({ kind: "person", personId: person.id }, state);
      expect(card.title).toBe(person.name);
      expect(card.subtitle).toBe(roleTitle(role));
      expect(lineValue(card, "Salary")).toBe(`${formatUsd(roleComp[role].salary)}/wk`);
      expect(lineValue(card, "Team morale")).toBe(`${state.culture.morale}/100`);
      expect(card.note).toBe(roleBlurb(role));
      expect(card.actions).toEqual([
        {
          label: `Hire another ${roleTitle(role)}`,
          command: `hire ${ROLE_HIRE_TOKENS[role]} 1`,
          mode: "run",
          hint: `1 AP · ${formatUsd(roleComp[role].hireCost)}`,
        },
      ]);
    }
  });

  it("returns null for people who are not there", () => {
    const state = garage({ team: team({ engineering: 2 }) });
    expect(describeTarget({ kind: "person", personId: "engineering-1" }, state)).not.toBeNull();
    expect(describeTarget({ kind: "person", personId: "engineering-2" }, state)).toBeNull();
    expect(describeTarget({ kind: "person", personId: "design-0" }, state)).toBeNull();
    expect(describeTarget({ kind: "person", personId: "nobody" }, state)).toBeNull();
    expect(describeTarget({ kind: "person", personId: "" }, state)).toBeNull();
  });
});

describe("empty desk", () => {
  it("offers every role in roster order with its real cost", () => {
    const state = garage();
    const card = cardFor({ kind: "empty-desk", slotIndex: 0 }, state);
    expect(card.title).toBe("Empty desk");
    expect(lineValue(card, "Cash")).toBe(formatUsd(state.cash));
    expect(lineValue(card, "AP")).toBe("3/3");
    // Per role: the classic job ad, and — for the roles the stage allows — a look at real candidates.
    expect(card.actions.map((entry) => entry.command)).toEqual(
      ROLE_ORDER.flatMap((role) => [`hire ${ROLE_HIRE_TOKENS[role]} 1`, ...(ROLE_HIRE_TOKENS[role] && ["data", "product", "executive"].includes(role) ? [] : [`recruit ${ROLE_HIRE_TOKENS[role]}`])])
    );
    expect(actionFor(card, "hire eng 1")).toEqual({ label: "Engineer · job ad", command: "hire eng 1", mode: "run", hint: "1 AP · $3K", row: "engineering" });
    expect(actionFor(card, "recruit eng")).toEqual({ label: "Candidates", command: "recruit eng", mode: "run", hint: "Free", row: "engineering" });
    expect(actionFor(card, "hire legal 1").hint).toBe("1 AP · $5K");
  });

  it("locks roles until their stage, naming the stage", () => {
    const locked = (stage: Stage): Record<string, string | undefined> => {
      const card = cardFor({ kind: "empty-desk", slotIndex: 0 }, settled({ stage, cash: 1_000_000 }));
      return Object.fromEntries(
        (["data", "product", "executive"] as TeamRole[]).map((role) => [
          role,
          actionFor(card, `hire ${ROLE_HIRE_TOKENS[role]} 1`).disabledReason,
        ])
      );
    };
    expect(locked("garage")).toEqual({ data: "Unlocks at Seed", product: "Unlocks at Series A", executive: "Unlocks at Growth" });
    expect(locked("seed")).toEqual({ data: undefined, product: "Unlocks at Series A", executive: "Unlocks at Growth" });
    expect(locked("series-a")).toEqual({ data: undefined, product: undefined, executive: "Unlocks at Growth" });
    expect(locked("growth")).toEqual({ data: undefined, product: undefined, executive: undefined });
  });

  it("never blames cash or AP for an action that costs neither", () => {
    // Found by the play-through test: with cash below zero, "0 > cash" used to
    // disable free actions such as resolving an event.
    const underwater = withEvent(garage({ cash: -4000, ap: 0 }));
    for (const entry of cardFor({ kind: "event-beacon" }, underwater).actions) {
      expect(entry.disabledReason, entry.command).toBeUndefined();
    }
    const broke = garage({ cash: -4000, ap: 0 });
    expect(station(broke, "calendar").actions[0].disabledReason).toBeUndefined();
    expect(station(broke, "coffee").actions[0].disabledReason).toBeUndefined();
    expect(actionFor(station(broke, "ship"), "ship ").disabledReason).toBeUndefined(); // Hacker's free ship
  });

  it("explains missing AP and missing cash", () => {
    const noAp = cardFor({ kind: "empty-desk", slotIndex: 0 }, garage({ ap: 0 }));
    expect(actionFor(noAp, "hire eng 1").disabledReason).toBe(DISABLED_REASONS.noAp);
    // A stage lock is the more useful thing to say about a locked role.
    expect(actionFor(noAp, "hire data 1").disabledReason).toBe("Unlocks at Seed");

    const poor = cardFor({ kind: "empty-desk", slotIndex: 0 }, garage({ cash: 2100 }));
    expect(actionFor(poor, "hire ops 1").disabledReason).toBeUndefined(); // $2,000
    expect(actionFor(poor, "hire eng 1").disabledReason).toBe(DISABLED_REASONS.noCash); // $3,000
  });

  it("only describes desks the current office has", () => {
    const state = garage();
    const desks = getOfficeLayout(state.companyPhase).deskSeats.length;
    expect(describeTarget({ kind: "empty-desk", slotIndex: desks - 1 }, state)).not.toBeNull();
    expect(describeTarget({ kind: "empty-desk", slotIndex: desks }, state)).toBeNull();
    expect(describeTarget({ kind: "empty-desk", slotIndex: -1 }, state)).toBeNull();
    expect(describeTarget({ kind: "empty-desk", slotIndex: 0.5 }, state)).toBeNull();
  });
});

describe("stations", () => {
  it("product wall: prefill `ship `, priced with getApCost", () => {
    const hacker = garage({ ap: 0, team: team({ engineering: 3, design: 2 }) });
    const card = station(hacker, "ship");
    expect(card.title).toBe("Product wall");
    expect(lineValue(card, "Engineers")).toBe("3");
    expect(lineValue(card, "Designers")).toBe("2");
    expect(lineValue(card, "Reputation")).toBe("50/100");
    expect(card.actions).toEqual([
      { label: "Ship a feature…", command: "ship ", mode: "prefill", hint: "Free this week", tone: "primary" },
      { label: "Start a build…", command: "build ", mode: "prefill", hint: "1 AP", disabledReason: DISABLED_REASONS.noAp },
    ]);

    // The Hacker's free ship is once a week; a Visionary never had one.
    const used = station({ ...hacker, freeActionUsed: { "hacker-free-ship": true } }, "ship").actions[0];
    expect(used).toMatchObject({ hint: "1 AP", disabledReason: DISABLED_REASONS.noAp });
    const visionary = station(garage({ ap: 0, founder: { name: "Ada", archetype: "visionary" } }), "ship").actions[0];
    expect(visionary.disabledReason).toBe(DISABLED_REASONS.noAp);
  });

  it("growth corner: prefill `launch `, with the campaign cost of the stage", () => {
    const expected: Array<[Stage, number]> = [
      ["garage", 900],
      ["seed", 1800],
      ["series-a", 3500],
      ["growth", 3500],
    ];
    for (const [stage, cost] of expected) {
      const state = settled({ stage, team: team({ marketing: 2, sales: 1 }) });
      expect(campaignCost(state)).toBe(cost);
      const card = station(state, "launch");
      expect(card.title).toBe("Growth corner");
      expect(lineValue(card, "Campaign cost")).toBe(formatUsd(cost));
      expect(lineValue(card, "Marketing")).toBe("2");
      expect(lineValue(card, "Sales")).toBe("1");
      expect(card.actions[0]).toMatchObject({ command: "launch ", mode: "prefill", hint: `1 AP · ${formatUsd(cost)}` });
    }
    expect(station(garage({ cash: 899 }), "launch").actions[0].disabledReason).toBe(DISABLED_REASONS.noCash);
    const visionary = garage({ ap: 0, founder: { name: "Ada", archetype: "visionary" } });
    expect(station(visionary, "launch").actions[0]).toMatchObject({ hint: "Free this week · $900" });
    expect(station(visionary, "launch").actions[0].disabledReason).toBeUndefined();
  });

  it("investor line: pitch, raise, funding options, and the pipeline", () => {
    const empty = station(garage(), "investors");
    expect(empty.title).toBe("Investor line");
    expect(lineValue(empty, "Stage")).toBe("Garage");
    expect(lineValue(empty, "Pipeline")).toBe("No leads yet");
    expect(empty.actions.map((entry) => [entry.command, entry.mode])).toEqual([
      ["pitch", "run"],
      ["raise vc ", "prefill"],
      ["raise", "run"],
    ]);
    expect(actionFor(empty, "raise vc ")).toMatchObject({ hint: "2 AP · up to $1M", disabledReason: NO_LEADS });

    const warm = station(garage({ investors: { pipeline: leads() } }), "investors");
    expect(lineValue(warm, "Northlight Capital")).toBe("Ai · 72/100");
    expect(lineValue(warm, "Quiet Harbor")).toBe("Devtools · 41/100");
    expect(actionFor(warm, "raise vc ").disabledReason).toBeUndefined();

    const oneAp = station(garage({ ap: 1, investors: { pipeline: leads() } }), "investors");
    expect(actionFor(oneAp, "raise vc ").disabledReason).toBe("Needs 2 AP — end the week");
    expect(actionFor(oneAp, "pitch").disabledReason).toBeUndefined();

    const salesAnimal = garage({ ap: 0, founder: { name: "Ada", archetype: "sales-animal" } });
    expect(actionFor(station(salesAnimal, "investors"), "pitch")).toMatchObject({ hint: "Free this week" });
    expect(actionFor(station(salesAnimal, "investors"), "pitch").disabledReason).toBeUndefined();
  });

  it("board table: every member, and nothing to court before there is a board", () => {
    const none = station(garage(), "boardroom");
    expect(none.title).toBe("Board table");
    expect(none.lines).toEqual([]);
    expect(none.note).toMatch(/first VC round/);
    expect(actionFor(none, "board").disabledReason).toBeUndefined();
    expect(actionFor(none, "board dinner ").disabledReason).toBe("No board yet");
    expect(actionFor(none, "board gift ").disabledReason).toBe("No board yet");

    const seated = station(garage({ board: board() }), "boardroom");
    expect(seated.lines).toEqual([
      { label: "Thomas Park", value: "Cheerleader · 95", tone: "good" },
      { label: "Ana Costa", value: "Operator · 70", tone: "good" },
      { label: "Sarah Chen", value: "Activist · 35", tone: "bad" },
      { label: "Marcus Webb", value: "Old Guard · 55", tone: undefined },
    ]);
    expect(actionFor(seated, "board dinner ")).toMatchObject({ mode: "prefill", hint: "1 AP · $2K" });
    expect(actionFor(seated, "board gift ")).toMatchObject({ mode: "prefill", hint: "1 AP · $5K" });
    expect(actionFor(station(garage({ board: board(), cash: 3000 }), "boardroom"), "board gift ").disabledReason).toBe(
      DISABLED_REASONS.noCash
    );
  });

  it("calendar: the week, AP, runway, burn and the End week button", () => {
    const burning = garage({ week: 12, ap: 2 });
    const card = station(burning, "calendar");
    expect(card.title).toBe("Week 12");
    expect(lineValue(card, "AP left")).toBe("2/3");
    expect(lineValue(card, "Runway")).toMatch(/^\d+w$/);
    expect(lineValue(card, "Net burn")).toMatch(/^\$.+\/wk$/);
    expect(card.actions).toEqual([{ label: "End the week", command: "end", mode: "run", tone: "primary" }]);
    expect(card.note).toMatch(/2 AP/);

    const profitable = station(garage({ mrr: 400_000 }), "calendar");
    expect(lineValue(profitable, "Runway")).toBe("∞");
    expect(lineValue(profitable, "Profit")).toMatch(/^\+\$.+\/wk$/);

    expect(station(withEvent(burning), "calendar").actions[0].disabledReason).toBe(DISABLED_REASONS.event);
    // Ending the week never needs AP.
    expect(station(garage({ ap: 0 }), "calendar").actions[0].disabledReason).toBeUndefined();
  });

  it("coffee machine: a flavour line and the easter egg", () => {
    const card = station(garage(), "coffee");
    expect(card.title).toBe("Coffee machine");
    expect(card.note).toBeTruthy();
    expect(card.actions).toEqual([{ label: "Drink coffee", command: "coffee", mode: "run" }]);
    expect(station(garage({ stress: 90 }), "coffee").note).not.toBe(card.note);
  });

  it("servers: users, MRR and ARPU with the change since last week", () => {
    const state = garage({ users: 1250, mrr: 12_500, arpu: 10, lastWeek: { users: 1130, mrr: 11_300, cash: 0, teamSize: 1 } });
    const card = station(state, "servers");
    expect(card.title).toBe("Servers");
    expect(card.lines).toEqual([
      { label: "Users", value: "1,250 (+120)", tone: "good" },
      { label: "MRR", value: "$12.5K (+$1.2K)", tone: "good" },
      { label: "ARPU", value: "$10" },
    ]);
    expect(card.actions.map((entry) => entry.command)).toEqual(["status"]);

    const shrinking = station({ ...state, users: 1000, mrr: 10_000 }, "servers");
    expect(shrinking.lines[0]).toEqual({ label: "Users", value: "1,000 (-130)", tone: "bad" });
  });

  it("pricing board: the three models with the current one marked, plus the comparison", () => {
    const card = station(garage({ pricingModel: "prosumer" }), "pricing");
    expect(card.title).toBe("Pricing board");
    expect(card.subtitle).toBe("Prosumer pricing");
    expect(card.actions.map((entry) => [entry.command, entry.disabledReason])).toEqual([
      ["pricing consumer", undefined],
      ["pricing prosumer", "Current"],
      ["pricing enterprise", undefined],
      ["pricing", undefined],
    ]);
    expect(actionFor(card, "pricing consumer").hint).toBe("1 AP");
    expect(actionFor(station(garage({ ap: 0 }), "pricing"), "pricing enterprise").disabledReason).toBe(DISABLED_REASONS.noAp);
    expect(actionFor(station(garage({ ap: 0 }), "pricing"), "pricing").disabledReason).toBeUndefined();
  });
});

describe("assets", () => {
  it("for sale: cost, upkeep, perks and a Buy button the engine accepts", () => {
    const state = lateGame();
    for (const assetId of ["lounge", "jet", "yacht"] as const) {
      const def = ASSET_CATALOG[assetId];
      const card = cardFor({ kind: "asset", assetId }, state);
      expect(card.title).toBe(def.name);
      expect(card.subtitle).toBe("For sale");
      expect(card.note).toBe(def.description);
      expect(lineValue(card, "Cost")).toBe(formatUsd(def.cost));
      expect(lineValue(card, "Upkeep")).toBe(`${formatUsd(def.maintenanceCost)}/wk`);
      expect(card.actions).toEqual([
        { label: "Buy", command: `buy ${assetId}`, mode: "run", hint: `1 AP · ${formatUsd(def.cost)}`, tone: "primary" },
      ]);
      const bought = executeCommand(state, `buy ${assetId}`).state;
      expect(bought.assets.map((asset) => asset.id)).toContain(assetId);
      expect(cardFor({ kind: "asset", assetId }, bought).subtitle).toBe("Owned");
    }
  });

  it("owned: since when and what it costs to keep", () => {
    const card = cardFor({ kind: "asset", assetId: "helicopter" }, lateGame());
    expect(card.subtitle).toBe("Owned");
    expect(lineValue(card, "Owned since")).toBe("Week 77");
    expect(lineValue(card, "Upkeep")).toBe("$8K/wk");
    expect(lineValue(card, "Perks")).toBe("Pitch +4%, VC rep +5");
    expect(card.actions.map((entry) => entry.command)).toEqual(["assets"]);
  });

  it("not yet available: says which phase unlocks it and why Buy is off", () => {
    const state = garage({ cash: 10_000_000 });
    for (const assetId of ALL_ASSET_IDS) {
      const card = cardFor({ kind: "asset", assetId }, state);
      const phase = titleCase(ASSET_CATALOG[assetId].minPhase);
      expect(card.subtitle).toBe(`Unlocks in the ${phase} phase`);
      expect(card.actions[0].disabledReason).toBe(`Requires ${phase} phase`);
    }
    expect(cardFor({ kind: "asset", assetId: "yacht" }, lateGame({ cash: 4_999_999 })).actions[0].disabledReason).toBe(
      DISABLED_REASONS.noCash
    );
  });
});

describe("door, event beacon, overflow sign", () => {
  it("door: where the company is and the roadmap command", () => {
    const card = cardFor({ kind: "door" }, garage());
    expect(card.title).toBe("Company roadmap");
    expect(lineValue(card, "Phase")).toBe("Garage");
    expect(lineValue(card, "Stage")).toBe("Garage");
    expect(lineValue(card, "Next phase")).toBe("Coworking");
    expect(card.actions.map((entry) => entry.command)).toEqual(["phases"]);
    expect(lineValue(cardFor({ kind: "door" }, lateGame()), "Next phase")).toBe("You made it");
    expect(lineValue(cardFor({ kind: "door" }, lateGame()), "Stage")).toBe("Growth");
  });

  it("event beacon: the event, its prompt and one `choose` per option", () => {
    expect(describeTarget({ kind: "event-beacon" }, garage())).toBeNull();
    eventPool.forEach((def, index) => {
      const state = withEvent(garage(), index);
      const card = cardFor({ kind: "event-beacon" }, state);
      expect(card.title).toBe(def.title);
      // The prompt as prose: the terminal's typewriter pacing tokens ("[[beat]]") are not for reading.
      expect(card.note).toBe(stripTypewriterTokens(state.pendingEvent?.prompt ?? ""));
      expect(card.note).not.toMatch(/\[\[|\]\]| {2}/);
      expect(card.actions.map((entry) => entry.command)).toEqual(def.choices.map((_, i) => `choose ${i + 1}`));
      expect(card.actions.map((entry) => entry.label)).toEqual(
        def.choices.map((choice) => stripTypewriterTokens(choice.text))
      );
      for (const entry of card.actions) expect(entry.label).not.toMatch(/\[\[|\]\]/);
      for (const entry of card.actions) {
        expect(entry.disabledReason).toBeUndefined();
        // Choosing resolves this event (another may open right behind it).
        const after = executeCommand(state, entry.command).state;
        expect(after.pendingEvent === null || after.pendingEvent.id !== def.id || after.gameOver !== null, `${def.id}: ${entry.command}`).toBe(
          true
        );
      }
    });
  });

  it("overflow sign: takes the live world's own head-count when it has one", () => {
    const layout = getOfficeLayout("garage");
    const crowded = garage({ team: team({ engineering: layout.deskSeats.length + layout.overflowSpots.length + 3 }) });
    expect(describeTarget({ kind: "overflow-sign" }, crowded, { hiddenCount: 5 })?.title).toBe("+5 more people");
    // The world says everyone fits: no sign, whatever the state-derived estimate says.
    expect(describeTarget({ kind: "overflow-sign" }, crowded, { hiddenCount: 0 })).toBeNull();
    // No world: derived from the state.
    expect(describeTarget({ kind: "overflow-sign" }, crowded, {})?.title).toBe("+3 more people");
  });

  it("overflow sign: only when people do not fit, counting exactly who is hidden", () => {
    expect(overflowHeadcount(garage())).toBe(0);
    expect(describeTarget({ kind: "overflow-sign" }, garage())).toBeNull();

    const layout = getOfficeLayout("garage");
    const capacity = layout.deskSeats.length + layout.overflowSpots.length;
    const crowded = garage({ team: team({ engineering: capacity + 3 }) });
    expect(crowded.companyPhase).toBe("garage");
    expect(overflowHeadcount(crowded)).toBe(3);
    const card = cardFor({ kind: "overflow-sign" }, crowded);
    expect(card.title).toBe("+3 more people");
    expect(card.note).toMatch(/Coworking phase/);
    expect(card.actions.map((entry) => entry.command)).toEqual(["phases"]);

    expect(cardFor({ kind: "overflow-sign" }, garage({ team: team({ engineering: capacity + 1 }) })).title).toBe("+1 more person");

    // Past the render cap as well as past the furniture.
    const huge = lateGame({ team: team({ engineering: 400, sales: 30 }) });
    const snapshot = buildWorldSnapshot(huge);
    const publicLayout = getOfficeLayout(huge.companyPhase);
    const seats = publicLayout.deskSeats.length + publicLayout.overflowSpots.length;
    const shown = Math.min(snapshot.people.filter((person) => person.kind === "employee").length, seats);
    expect(overflowHeadcount(huge)).toBe(430 - shown);
  });

  it("a save with a phase the world does not know: every card still opens, read as the garage it is drawn as", () => {
    const layout = getOfficeLayout("garage");
    const capacity = layout.deskSeats.length + layout.overflowSpots.length;
    // parseSave does not validate companyPhase, so a corrupted save can carry anything.
    const corrupted = { ...garage({ team: team({ engineering: capacity + 3 }) }), companyPhase: "megacorp" as never };
    for (const target of allTargets(corrupted)) {
      expect(() => describeTarget(target, corrupted), JSON.stringify(target)).not.toThrow();
      expect(() => describeTarget(target, corrupted, { gate: false }), JSON.stringify(target)).not.toThrow();
    }
    expect(lineValue(cardFor({ kind: "door" }, corrupted), "Next phase")).toBe("Coworking");
    expect(overflowHeadcount(corrupted)).toBe(3);
    expect(cardFor({ kind: "overflow-sign" }, corrupted).note).toMatch(/Coworking phase/);
    expect(describeTarget({ kind: "empty-desk", slotIndex: layout.deskSeats.length }, corrupted)).toBeNull();
  });
});

describe("describeTarget is a pure function of its inputs", () => {
  it("does not mutate the state and returns equal cards for equal states", () => {
    const state = lateGame();
    const frozen = JSON.stringify(state);
    for (const target of allTargets(state)) {
      expect(describeTarget(target, state)).toEqual(describeTarget(target, JSON.parse(frozen) as GameState));
    }
    expect(JSON.stringify(state)).toBe(frozen);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Named people and product builds (the tycoon layer)
// ─────────────────────────────────────────────────────────────────────────────

/** A garage run with the engine's roster: e1, e3, e4 engineers, e2 a designer, e5 marketing. */
const tycoonGarage = (overrides: Partial<GameState> = {}): GameState =>
  executeCommand(makeTycoonState({ team: team({ engineering: 3, design: 1, marketing: 1 }), ...overrides }), "status").state;

const editRoster = (state: GameState, id: string, changes: Partial<Employee>): GameState => ({
  ...state,
  people: { ...state.people!, roster: state.people!.roster.map((e) => (e.id === id ? { ...e, ...changes } : e)) },
});

const editBuild = (state: GameState, id: string, changes: Partial<Build>): GameState => ({
  ...state,
  product: { ...state.product!, active: state.product!.active.map((b) => (b.id === id ? { ...b, ...changes } : b)) },
});

const run = (state: GameState, ...commands: string[]): GameState =>
  commands.reduce((current, command) => {
    const result = executeCommand(current, command);
    if (isRejected(result)) throw new Error(`fixture command refused: ${command}: ${result.logs.map((l) => l.text).join(" | ")}`);
    return result.state;
  }, state);

/** Atlas (a Feature S) kicked off and worked on for a week, e1 leading it with e2. */
const withAtlas = (overrides: Partial<GameState> = {}): GameState => run(tycoonGarage(overrides), "build feature s Atlas", "end");

/** The office phase (two build slots): Atlas built and ready to ship, Borealis at 40% and crunching. */
const twoBuilds = (): GameState => {
  const office = tycoonGarage({ companyPhase: "office", stage: "series-a", users: 12_000, mrr: 70_000, arpu: 6, valuation: 60_000_000, cash: 400_000, ap: 4 });
  if (office.companyPhase !== "office") throw new Error(`fixture is in the ${office.companyPhase} phase`);
  let state = run(office, "build feature s Atlas", "build growth s Borealis", "end");
  state = editBuild(state, "b1", { progress: 5, scope: 5, readyWeek: state.week });
  state = editBuild(state, "b2", { progress: 2, scope: 5 });
  return { ...run(state, "build crunch borealis on"), ap: 3 };
};

const tycoonStates = (): Array<[string, GameState]> => {
  const atlas = withAtlas();
  const offered = editRoster(atlas, "e1", { offerDueWeek: atlas.week + 2, offerKind: "recruiter", leadOnNotice: "b1" });
  const burnt = editRoster(atlas, "e2", { energy: 22, offerDueWeek: atlas.week + 1, offerKind: "burnout" });
  return [
    ["fresh roster", tycoonGarage()],
    ["one build", atlas],
    ["two builds, one ready, one crunching", twoBuilds()],
    ["an outside offer", offered],
    ["burnout notice", burnt],
    ["no AP", { ...atlas, ap: 0 }],
    ["no cash", { ...atlas, cash: 0 }],
    ["candidates shown", run(atlas, "recruit eng")],
    ["candidates shown, no cash", { ...run(atlas, "recruit eng"), cash: 100 }],
    ["event pending", withEvent(atlas)],
    ["run over", gameOver(atlas, "bankruptcy")],
    ["a build at 70% (ship early)", editBuild(atlas, "b1", { progress: 3.5, scope: 5 })],
  ];
};

describe("tycoon cards are honest about what the engine will do", () => {
  it.each(tycoonStates())("%s", (label, state) => {
    expect(expectAllCardsHonest(state, label)).toBeGreaterThan(10);
  });

  it("throughout whole tycoon games played by clicking card buttons", () => {
    let checked = 0;
    for (let run = 0; run < 3; run += 1) {
      let state = tycoonGarage({ seed: 4200 + run, rng: mix32(4200 + run) || 1, cash: 250_000 });
      let dice = mix32(31 + run);
      const roll = (sides: number): number => {
        dice = mix32(dice + 0x9e3779b9);
        return dice % sides;
      };
      for (let step = 0; step < 70 && !state.gameOver; step += 1) {
        checked += expectAllCardsHonest(state, `tycoon run ${run} step ${step} (week ${state.week})`);
        const cards = allTargets(state)
          .map((target) => describeTarget(target, state))
          .filter((card): card is InspectorCard => card !== null);
        const enabled = cards.flatMap((card) => card.actions).filter((entry) => entry.disabledReason === undefined);
        // Prefer the new verbs, so the run actually builds, staffs, crunches, ships and retains.
        const tycoonish = enabled.filter((entry) => /^(build |staff |ship [a-z0-9-]+$|retain |recruit |fire )/.test(entry.command));
        const endWeek = enabled.find((entry) => entry.command === "end");
        const pick =
          endWeek && (state.ap === 0 || roll(3) === 0) ? endWeek : tycoonish.length > 0 ? tycoonish[roll(tycoonish.length)] : enabled[roll(enabled.length)];
        if (!pick) break;
        const typed = pick.mode === "run" ? pick.command : completePrefill(pick.command, state);
        const result = executeCommand(state, typed);
        expect(complaint(result), `tycoon run ${run} step ${step}: ${typed}`).toBeNull();
        state = result.state;
        if (state.pendingEvent) state = executeCommand(state, "choose 1").state;
        if (state.cash < 30_000 && !state.gameOver && state.ap > 0) state = executeCommand(state, "raise mortgage").state;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe("named person card", () => {
  it("name, role and id, stats, energy, pay, build and the buttons that matter", () => {
    const state = withAtlas();
    const e1 = state.people!.roster.find((e) => e.id === "e1")!;
    const card = cardFor({ kind: "person", personId: "e1" }, state);
    expect(card.title).toBe(e1.name);
    expect(card.subtitle).toBe("Engineer · e1");
    expect(lineValue(card, "Pace")).toBe("●".repeat(e1.pace) + "○".repeat(5 - e1.pace));
    expect(lineValue(card, "Craft")).toBe("●".repeat(e1.craft) + "○".repeat(5 - e1.craft));
    expect(lineValue(card, "Energy")).toMatch(/^\d+ \((fresh|fine|tired|running on fumes|burnt out)\)$/);
    expect(lineValue(card, "Pay")).toContain("/wk · going ");
    expect(lineValue(card, "Working on")).toBe("Atlas (lead)");
    expect(card.actions.map((entry) => [entry.command, entry.mode])).toEqual([
      ["retain e1", "run"],
      ["staff off e1", "run"],
      ["fire e1", "prefill"],
      ["team e1", "run"],
      ["hire eng 1", "run"],
      ["recruit eng", "run"],
    ]);
    // Letting go is never one click: it goes to the terminal for the player to confirm.
    expect(actionFor(card, "fire e1")).toMatchObject({ label: "Let go…", mode: "prefill", tone: "danger", hint: "1 AP · $7K" });
    expect(actionFor(card, "staff off e1").hint).toBe("Free");
    // The job ad and this week's candidates share a row (a full garage has no empty desk to click).
    expect(actionFor(card, "hire eng 1").row).toBe("hire");
    expect(actionFor(card, "recruit eng")).toMatchObject({ label: "Candidates", row: "hire" });
  });

  it("once this week's candidates are in, a colleague's card lists them and signs them", () => {
    const looked = executeCommand(withAtlas(), "recruit eng").state;
    const card = cardFor({ kind: "person", personId: "e1" }, looked);
    const pool = buildWorldSnapshot(looked).candidates.engineering ?? [];
    expect(pool.length).toBe(3);
    // No second look: the list is the one on the desk already.
    expect(card.actions.some((entry) => entry.command === "recruit eng")).toBe(false);
    for (const candidate of pool) {
      expect(lineValue(card, candidate.name)).toMatch(/^pace \d · craft \d[?✓] · \$[\d.,]+K?\/wk$/);
      const sign = actionFor(card, `recruit eng ${candidate.index}`);
      expect(sign).toMatchObject({ label: `Sign ${candidate.name.split(" ")[0]}`, mode: "run" });
      expect(sign.disabledReason).toBeUndefined();
      expect(executeCommand(looked, sign.command).logs.some((log) => log.kind === "error")).toBe(false);
    }
  });

  it("an outside offer: the deadline, the build at risk, the price of keeping them, Retain first", () => {
    const atlas = withAtlas();
    const state = editRoster(atlas, "e1", { offerDueWeek: atlas.week + 2, offerKind: "recruiter", leadOnNotice: "b1" });
    const card = cardFor({ kind: "person", personId: "e1" }, state);
    expect(card.lines).toEqual(
      expect.arrayContaining([
        { label: "Outside offer", value: "Leaves in 2w", tone: "bad" },
        { label: "At risk", value: "Atlas loses a quarter", tone: "bad" },
        { label: "To keep them", value: "$7,000 now, then $3,850/wk" },
      ])
    );
    expect(card.actions[0]).toEqual({ label: "Retain", command: "retain e1", mode: "run", hint: "1 AP · $7K", tone: "primary" });
    expect(card.note).toMatch(/recruiter/i);
  });

  it("put on a build: one button per build the role can work on, gated by the engine", () => {
    const state = twoBuilds();
    // e4 is an engineer on the day job (or on Borealis): it can go on whichever build it is not on.
    const card = cardFor({ kind: "person", personId: "e4" }, state);
    const puts = card.actions.filter((entry) => entry.command.startsWith("staff ") && !entry.command.startsWith("staff off"));
    expect(puts.length).toBeGreaterThan(0);
    for (const entry of puts) expect(entry.label).toMatch(/^Put on (Atlas|Borealis)$/);
    // A full build refuses, and says why in the engine's words.
    const marketing = cardFor({ kind: "person", personId: "e5" }, state);
    for (const entry of marketing.actions.filter((a) => a.command.startsWith("staff atlas"))) expect(entry.disabledReason).toBeDefined();
  });

  it("an unlisted head keeps the classic card", () => {
    const legacy = garage({ team: team({ engineering: 2 }) });
    expect(cardFor({ kind: "person", personId: "engineering-1" }, legacy).subtitle).toBe("Engineer");
  });
});

describe("product wall with builds", () => {
  it("lists every build with progress, forecast and due week, and ships the ready one", () => {
    const state = twoBuilds();
    const card = station(state, "ship");
    expect(card.subtitle).toBe("2 builds · 0 slots free");
    expect(lineValue(card, "Cruft")).toMatch(/^\d+(\.\d)? \(/);
    expect(lineValue(card, "Atlas")).toMatch(/^Feature S · built · due wk \d+$/);
    expect(lineValue(card, "Borealis")).toMatch(/^Growth S · 40% · due wk \d+ · crunch$/);
    expect(lineValue(card, "  ↳ atlas")).toMatch(/^now ≈ \d+ ±\d+ (FLOP|SHRUG|SOLID|BREAKOUT)$/);
    expect(lineValue(card, "  ↳ borealis")).toMatch(/^now ≈ \d+ ±\d+ (FLOP|SHRUG|SOLID|BREAKOUT) · done ≈ (\d+|\? \(nobody on it\))$/);

    const ship = actionFor(card, "ship atlas");
    expect(ship).toMatchObject({ label: "Ship Atlas", tone: "primary" });
    expect(ship.disabledReason).toBeUndefined();
    // Under 60%: refused, in the engine's words.
    expect(actionFor(card, "ship borealis").disabledReason).toBe("Borealis is 40% built. Shipping it now would be a crime.");
    expect(actionFor(card, "build crunch borealis off").label).toBe("Stop crunching Borealis");
    expect(actionFor(card, "build cancel borealis")).toMatchObject({ mode: "prefill", tone: "danger" });
    // Both slots are taken.
    expect(actionFor(card, "build ").disabledReason).toBe("All 2 build slots taken");
    expect(actionFor(card, "build").disabledReason).toBeUndefined();
  });

  it("ship early: danger tone and the cruft it costs", () => {
    const state = editBuild(withAtlas(), "b1", { progress: 3.5, scope: 5 });
    const ship = actionFor(station(state, "ship"), "ship atlas");
    expect(ship.label).toBe("Ship Atlas early");
    expect(ship.tone).toBe("danger");
    expect(ship.hint).toMatch(/^\+\d+(\.\d)? cruft$/);
    expect(ship.disabledReason).toBeUndefined();
  });

  it("says what it last shipped, and how that went", () => {
    const before = station(withAtlas(), "ship");
    expect(lineValue(before, "Last release")).toBeUndefined();
    const shipped = run(editBuild(withAtlas(), "b1", { progress: 5, scope: 5 }), "ship atlas");
    const release = shipped.product!.shipped[0]!;
    expect(lineValue(station(shipped, "ship"), "Last release")).toBe(
      `Atlas · wk ${release.week} · ${release.reception} ${release.tier.toUpperCase()}`
    );
  });

  it("during an event only the board is open", () => {
    const card = station(withEvent(withAtlas()), "ship");
    expect(actionFor(card, "build").disabledReason).toBeUndefined();
    for (const entry of card.actions.filter((a) => a.command !== "build")) expect(entry.disabledReason).toBe(DISABLED_REASONS.event);
  });
});

describe("empty desk with candidates", () => {
  it("lists this week's candidates and signs them by number", () => {
    const state = run(withAtlas(), "recruit eng");
    const card = cardFor({ kind: "empty-desk", slotIndex: getOfficeLayout(state.companyPhase).deskSeats.length - 1 }, state);
    const pool = buildWorldSnapshot(state).candidates.engineering!;
    expect(card.subtitle).toBe("This week's candidates are in");
    for (const candidate of pool) {
      expect(lineValue(card, candidate.name)).toMatch(/^pace \d · craft \d[?✓] · \$[\d.]+K\/wk$/);
      const sign = actionFor(card, `recruit eng ${candidate.index}`);
      expect(sign.label).toBe(`Sign ${candidate.name.split(" ")[0]} (Engineer)`);
      expect(sign.hint).toBe("1 AP · $3K");
    }
  });
});

describe("refusal reasons", () => {
  it("keep the engine's voice, lose the asides, and stay short", async () => {
    const { refusalReason } = await import("./inspector");
    expect(refusalReason("Tuesday is 46% built. Shipping it now would be a crime. (Needs 60%. Or `build cancel tuesday`.)")).toBe(
      "Tuesday is 46% built. Shipping it now would be a crime."
    );
    expect(refusalReason("No AP left. End the week to refresh.")).toBe(DISABLED_REASONS.noAp);
    expect(refusalReason("Resolve the pending event first with `choose <n>`.")).toBe(DISABLED_REASONS.event);
    expect(refusalReason("Game over. Click 'Play Again' or refresh to start a new run.")).toBe(DISABLED_REASONS.runOver);
    expect(refusalReason("x".repeat(200)).length).toBeLessThanOrEqual(72);
  });
});
