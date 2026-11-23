// The pack's "Later callback" scenes: one per story choice, played a fixed number of weeks after the choice. A scene
// with a condition waits while the condition is false; any scene still unplayed CALLBACK_GRACE_WEEKS after it fell due
// is dropped silently. At most one plays per week, from endWeekTick, before the week's event is picked. No RNG.
import type { GameState } from "../../types/game";
import type { EngineContext } from "../context";
import { STAGE_VALUATION_FLOOR } from "../valuation";
import { stageRaiseCaps } from "../investors";
import { storyConfig } from "./config";
import { applyFx, money, weeksOfBurn } from "./effects";
import type { Fx } from "./effects";
import { closeStoryRound, preferenceHaircut } from "./financing";
import { STORY_TITLES } from "./meta";
import type { StoryEventId } from "./meta";
import { CALLBACK_GRACE_WEEKS } from "./state";

export interface StoryCallbackDef {
  text: string;
  delay: number; // weeks after the choice
  when?: (s: GameState, ctx: EngineContext) => boolean;
  apply: (s: GameState, ctx: EngineContext) => { state: GameState; lines: string[] };
}

const fx = (f: (s: GameState) => Fx) => (s: GameState): { state: GameState; lines: string[] } => {
  const r = applyFx(s, f(s));
  return { state: r.state, lines: [r.line] };
};

const growing = (_s: GameState, ctx: EngineContext): boolean => ctx.usersGrowthRate > 0;
const burning = (_s: GameState, ctx: EngineContext): boolean => !ctx.profitable;

/** The size of a story round: the stage's soft cap, or 6% of the company's implied value if smaller. */
export const storyRoundSize = (s: GameState): number =>
  money(Math.min(stageRaiseCaps[s.stage].softCap, Math.max(s.valuation, STAGE_VALUATION_FLOOR[s.stage]) * 0.06));

const cb = (eventId: StoryEventId, choiceId: string): string => `${eventId}:${choiceId}`;

export const CALLBACKS: Record<string, StoryCallbackDef> = {
  // ── 01 The GPU Landlord ──
  [cb("gpu-landlord", "meter")]: {
    text: "An enterprise buyer asks for predictable usage pricing. For the first time, your restraint is somebody’s procurement requirement.",
    delay: 8,
    apply: fx((s) => ({ cash: weeksOfBurn(s, 1.5), rep: 1 })),
  },
  [cb("gpu-landlord", "reserve")]: {
    text: "The new model needs a third as much compute. Your contract continues to need all of its money.",
    delay: 9,
    apply: fx((s) => ({ cash: -weeksOfBurn(s, 3.5), stress: 4 })),
  },
  [cb("gpu-landlord", "optimize")]: {
    text: "Routine requests are finally profitable. A large customer now wants a premium tier for the requests that are not.",
    delay: 7,
    apply: fx(() => ({ arpu: 0.04 })),
  },

  // ── 02 Agent All-Hands ──
  [cb("agent-all-hands", "approval")]: {
    text: "A regulated customer loves the approval trail. Sales describes the deal as boring, then quietly asks for more of them.",
    delay: 8,
    apply: fx((s) => ({ cash: weeksOfBurn(s, 1.5), arpu: 0.02 })),
  },
  [cb("agent-all-hands", "budget")]: {
    text: "A complex job stops at its limit. The customer needs a way to approve more spending without restarting everything.",
    delay: 6,
    apply: fx(() => ({ users: -0.01, rep: -1, stress: 1 })),
  },
  [cb("agent-all-hands", "per-action")]: {
    text: "A customer posts an annotated invoice. Your most viral product demonstration is now an explanation of how to avoid using it.",
    delay: 6,
    apply: fx(() => ({ users: -0.05, arpu: -0.05, rep: -3 })),
  },

  // ── 03 Waterfront Property ──
  [cb("waterfront-property", "inventory")]: {
    text: "A prospect asks where its data goes. You answer with evidence. The competing vendor answers with a diagram.",
    delay: 8,
    apply: fx((s) => ({ cash: weeksOfBurn(s, 2), rep: 2 })),
  },
  [cb("waterfront-property", "license")]: {
    text: "Your data supplier raises its renewal price. The board asks what customers are buying from you that they cannot buy elsewhere.",
    delay: 9,
    apply: fx((s) => ({ cash: -weeksOfBurn(s, 1.5), board: -4 })),
  },
  [cb("waterfront-property", "opt-in")]: {
    text: "Power users supply most of the training data. The model becomes brilliant at their jobs and increasingly confused by everyone else’s.",
    delay: 8,
    apply: fx(() => ({ users: -0.02, arpu: 0.04 })),
  },

  // ── 04 A Single Source of Revenue ──
  [cb("single-source-of-revenue", "correct")]: {
    text: "Diligence finds your correction before it finds the error. It is still an awkward meeting. It is no longer a surprise.",
    delay: 7,
    apply: fx(() => ({ vcRep: 5, leads: 6 })),
  },
  [cb("single-source-of-revenue", "separate")]: {
    text: "The pipeline slips. Because you labeled it, the board debates the forecast instead of debating whether to believe you.",
    delay: 6,
    apply: fx(() => ({ board: 4, stress: -2 })),
  },
  [cb("single-source-of-revenue", "keep")]: {
    text: "The lead investor requests a reconciliation. The data room contains both your numbers and the emails explaining why you chose them.",
    delay: 8,
    apply: fx(() => ({ vcRep: -10, leads: -15, board: -8, stress: 6 })),
  },

  // ── 05 The Moat Has a Download Button ──
  [cb("moat-download-button", "adopt")]: {
    text: "Competitors match your price by lunch. Your next advantage will have to involve something a download cannot provide.",
    delay: 5,
    apply: fx(() => ({ users: -0.03 })),
  },
  [cb("moat-download-button", "proprietary")]: {
    text: "One customer pays for consistency. Another leaves over price. The company must decide which business it is actually running.",
    delay: 8,
    apply: fx(() => ({ arpu: 0.04, users: -0.03 })),
  },
  [cb("moat-download-button", "workflows")]: {
    text: "A large customer wants six custom integrations. Your new moat has begun submitting timesheets.",
    delay: 8,
    apply: fx((s) => ({ cash: weeksOfBurn(s, 1.5), cruft: 3, morale: -1 })),
  },

  // ── 06 The Agent Has Receipts ──
  [cb("agent-has-receipts", "reconcile")]: {
    text: "A director quotes your revised plan. For once, the screenshot helps you.",
    delay: 6,
    apply: fx(() => ({ board: 7 })),
  },
  [cb("agent-has-receipts", "retime")]: {
    text: "The new quarter arrives. The old commitments arrive with it, accompanied by the original email.",
    delay: 7,
    apply: fx(() => ({ board: -7, stress: 5, trust: -3 })),
  },
  [cb("agent-has-receipts", "forget")]: {
    text: "Two executives authorize incompatible plans. Neither remembers the other meeting. The agent has no relevant context.",
    delay: 6,
    apply: fx((s) => ({ cash: -weeksOfBurn(s, 1), cohesion: -3 })),
  },

  // ── 07 Ten Megawatts of PowerPoint ──
  [cb("ten-megawatts-of-powerpoint", "smaller")]: {
    text: "Demand grows beyond the smaller site. Expansion becomes a real operational problem instead of a promised future achievement.",
    delay: 8,
    when: growing,
    apply: fx((s) => ({ users: 0.03, cash: -weeksOfBurn(s, 1) })),
  },
  [cb("ten-megawatts-of-powerpoint", "reserve")]: {
    text: "The connection date moves. The broker forwards another positive update. Payroll continues to prefer numbers.",
    delay: 9,
    apply: fx((s) => ({ cash: -weeksOfBurn(s, 2), stress: 5, board: -3 })),
  },
  [cb("ten-megawatts-of-powerpoint", "rent")]: {
    text: "Your rented capacity renews before the facility opens. The provider has learned exactly how much flexibility you need.",
    delay: 8,
    apply: fx((s) => ({ cash: -weeksOfBurn(s, 1.5) })),
  },

  // ── 08 State of the Slide ──
  [cb("state-of-the-slide", "publish")]: {
    text: "A technical buyer designs a pilot around the published limits. It succeeds for reasons your original headline could not explain.",
    delay: 7,
    apply: fx((s) => ({ cash: weeksOfBurn(s, 1.5), rep: 2 })),
  },
  [cb("state-of-the-slide", "narrow")]: {
    text: "A competitor wins the broad narrative. You win a useful niche. The board asks whether usefulness can be made more exciting.",
    delay: 8,
    apply: fx(() => ({ arpu: 0.03, board: -2 })),
  },
  [cb("state-of-the-slide", "headline")]: {
    text: "A former employee releases the evaluation history. Customers now want independent validation. The board wants the name on the approval.",
    delay: 9,
    apply: fx(() => ({ rep: -8, vcRep: -8, users: -0.04, board: -6 })),
  },

  // ── 09 Your Apology Has Been Indexed ──
  [cb("apology-indexed", "investigators")]: {
    text: "Investigators uncover an older weakness. The problem gets larger in public and smaller in production.",
    delay: 6,
    apply: fx(() => ({ rep: -2, cruft: -5, stress: -2 })),
  },
  [cb("apology-indexed", "lena")]: {
    text: "The technical response succeeds. The engineer who kept it alive now wants staffing changes, a holiday, and a reason to stay.",
    delay: 6,
    apply: fx((s) => ({ cash: -weeksOfBurn(s, 1), rep: 2, morale: -2 })),
  },
  [cb("apology-indexed", "customers")]: {
    text: "Some customers leave. Others become references for your response. Trust returns unevenly, which makes the dashboard difficult to color green.",
    delay: 7,
    apply: fx(() => ({ users: -0.02, rep: 4 })),
  },

  // ── 10 We Updated Your Privacy ──
  [cb("silent-training-opt-in", "rollback")]: {
    text: "The inventory identifies an affected training run. The setting is fixed. The earlier data use still needs a decision.",
    delay: 7,
    apply: fx((s) => ({ cash: -weeksOfBurn(s, 1), rep: 3 })),
  },
  [cb("silent-training-opt-in", "review")]: {
    text: "The review traces approval to your cofounder’s growth experiment. Publishing the finding will make the next one-to-one meeting extremely specific.",
    delay: 7,
    apply: fx(() => ({ trust: -8, ego: 4, rep: 2 })),
  },
  [cb("silent-training-opt-in", "defend")]: {
    text: "Customers publish a migration guide. Its author becomes your competitor’s most effective unpaid marketer.",
    delay: 8,
    apply: fx(() => ({ users: -0.06, rep: -3 })),
  },

  // ── 11 Congratulations on Your Valuation ──
  [cb("unicorn-terms-trap", "headline")]: {
    text: "A credible acquisition offer arrives. The payout model introduces everyone to the difference between owning a percentage and receiving a percentage.",
    delay: 8,
    apply: (s) => {
      const cut = preferenceHaircut(s, 0.08);
      const r = applyFx(cut.state, { morale: -3 });
      return { state: r.state, lines: [`${cut.line} ${r.line}`] };
    },
  },
  [cb("unicorn-terms-trap", "clean")]: {
    text: "A competitor mocks your valuation. Your next round closes before theirs.",
    delay: 7,
    apply: fx(() => ({ vcRep: 4, leads: 8 })),
  },
  [cb("unicorn-terms-trap", "negotiate")]: {
    text: "A delayed renewal weakens your position just before the revised term sheet arrives. The remaining compromise becomes less theoretical.",
    delay: 4,
    when: (s) => s.investors.pipeline.length > 0,
    apply: (s) => {
      const lead = [...s.investors.pipeline].sort((a, b) => b.relationship - a.relationship)[0];
      const implied = Math.max(s.valuation, STAGE_VALUATION_FLOOR[s.stage]);
      const pre = money(Math.min(1_000_000_000, implied * 1.1));
      const left: GameState = { ...s, investors: { pipeline: s.investors.pipeline.filter((l) => l.id !== lead.id) } };
      const round = closeStoryRound(left, storyRoundSize(s), pre, lead.name);
      const r = applyFx(round.state, { stress: -2 });
      return { state: r.state, lines: [...round.lines.slice(0, 2), r.line, ...round.lines.slice(2)] };
    },
  },

  // ── 12 Founder Mode, Observer Seat ──
  [cb("vc-rescue-board-control", "rescue")]: {
    text: "You miss a milestone. The board offers you the title Founder Emeritus. There is no budget attached to it.",
    delay: 8,
    when: burning,
    apply: fx(() => ({ board: -10, stress: 6 })),
  },
  [cb("vc-rescue-board-control", "bridge")]: {
    text: "You have to start raising again sooner than planned. Your team must demonstrate progress using the colleagues it already has.",
    delay: 7,
    when: burning,
    apply: fx(() => ({ stress: 5, vcRep: -2 })),
  },
  [cb("vc-rescue-board-control", "prepay")]: {
    text: "A candidate asks what happened to the previous team. The recruiting pitch now requires an honest second paragraph.",
    delay: 7,
    apply: fx(() => ({ cohesion: -2, rep: -1 })),
  },

  // ── 13 The Founder Is the Product ──
  [cb("founder-personal-brand-spiral", "double-down")]: {
    text: "A customer asks for a live demonstration without the three engineers. Sloane suddenly finds the conference Wi-Fi concerning.",
    delay: 7,
    apply: fx(() => ({ rep: -5, users: -0.02, stress: 4 })),
  },
  [cb("founder-personal-brand-spiral", "builders")]: {
    text: "A journalist asks to profile Lena. The founder discovers that sharing credit is easier to endorse than to schedule.",
    delay: 8,
    apply: fx(() => ({ rep: 3, stress: 2 })),
  },
  [cb("founder-personal-brand-spiral", "keynote")]: {
    text: "A major prospect will speak only to the founder. Your personal brand has become a queue the company cannot scale.",
    delay: 7,
    apply: fx((s) => ({ cash: weeksOfBurn(s, 1), stress: 5 })),
  },

  // ── 14 Revenue, With a Return Address ──
  [cb("circular-compute-revenue", "disclose")]: {
    text: "An investigation finds your disclosure. It limits the surprise, but Trent would like to discuss your definition of loyalty.",
    delay: 8,
    apply: fx(() => ({ board: -3, vcRep: 4, rep: 2 })),
  },
  [cb("circular-compute-revenue", "unwind")]: {
    text: "An unrelated customer rents the spare capacity at a discount. Its modest payment tells you more than the entire previous quarter.",
    delay: 7,
    apply: fx((s) => ({ cash: weeksOfBurn(s, 1.5), rep: 2 })),
  },
  [cb("circular-compute-revenue", "defend")]: {
    text: "A prospective investor requests the side letter. Financing pauses. A reporter receives the spreadsheet before Sloane does.",
    delay: 8,
    apply: fx(() => ({ vcRep: -12, leads: -20, rep: -6, board: -8, stress: 8 })),
  },
};

export const callbackDelay = (eventId: StoryEventId, choiceId: string): number | null => CALLBACKS[cb(eventId, choiceId)]?.delay ?? null;

const titleOf = (key: string): string => STORY_TITLES[key.split(":")[0] as StoryEventId] ?? "Earlier";

/**
 * Plays the oldest due later scene whose condition holds, and drops scenes that are unknown or past their grace period.
 * Returns the state untouched (same object) when there is nothing to do or the pack is off.
 */
export const playDueCallback = (s: GameState, ctx: EngineContext): { state: GameState; logs: string[]; fired: boolean } => {
  const story = s.story;
  if (!storyConfig.enabled || !story || story.callbacks.length === 0 || s.gameOver) return { state: s, logs: [], fired: false };
  const live = story.callbacks.filter((c) => CALLBACKS[c.key] && s.week <= c.dueWeek + CALLBACK_GRACE_WEEKS);
  const due = live
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.dueWeek <= s.week)
    .sort((a, b) => a.c.dueWeek - b.c.dueWeek || a.i - b.i);
  for (const { c, i } of due) {
    const def = CALLBACKS[c.key];
    if (def.when && !def.when(s, ctx)) continue;
    const rest = live.filter((_, j) => j !== i);
    const r = def.apply({ ...s, story: { ...story, callbacks: rest } }, ctx);
    return { state: r.state, logs: ["", `LATER: ${titleOf(c.key)}`, def.text, ...r.lines], fired: true };
  }
  if (live.length === story.callbacks.length) return { state: s, logs: [], fired: false };
  return { state: { ...s, story: { ...story, callbacks: live } }, logs: [], fired: false };
};
