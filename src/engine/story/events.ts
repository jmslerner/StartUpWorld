// "StartupWorld: The Next Round" (editorial date 2026-11-22): the pack's 14 branching events. Prompts and outcome lines
// are the pack's text; numbers the pack marks as fictional setup use the player's own (runway, ARR, offer sizes). Every
// choice records itself in the story slice and schedules its later scene (callbacks.ts). Each event runs at most once
// per game. Appended to eventPool after the tycoon events, so every existing event keeps its order.
//
// Never import events/pool.ts from here (pool.ts imports this file). No `when`, `weight`, `prompt` or `apply` draws
// from any RNG.
import type { BoardMember, GameState } from "../../types/game";
import type { EngineContext } from "../context";
import { calcNetBurn } from "../economy";
import type { EventDef } from "../events/types";
import { STAGE_VALUATION_FLOOR } from "../valuation";
import { stageRaiseCaps } from "../investors";
import { callbackDelay, storyRoundSize } from "./callbacks";
import { storyConfig } from "./config";
import { applyFx, money, moneyWords, numberWord, usd, weeksOfBurn } from "./effects";
import type { Fx } from "./effects";
import { closeStoryRound } from "./financing";
import { CAST, CHAIN_WEIGHT_MULT, STORY_CHAINS, STORY_TITLES } from "./meta";
import type { StoryEventId } from "./meta";
import { recordStoryChoice, storySeen } from "./state";

interface ChoiceSpec {
  id: string;
  text: string;
  outcome: string;
  /** A "protect the story" choice (counts toward the Archive epilogue). */
  spin?: boolean;
  fx?: (s: GameState, ctx: EngineContext) => Fx;
  /** Replaces `fx` for choices that move money in rounds; returns the lines printed after the outcome. */
  apply?: (s: GameState, ctx: EngineContext) => { state: GameState; lines: string[] };
}

interface StorySpec {
  id: StoryEventId;
  minWeek: number;
  when: (s: GameState, ctx: EngineContext) => boolean;
  weight: (s: GameState, ctx: EngineContext) => number;
  prompt: (s: GameState, ctx: EngineContext) => string[];
  choices: [ChoiceSpec, ChoiceSpec, ChoiceSpec];
}

const chained = (s: GameState, id: StoryEventId): boolean => {
  const before = STORY_CHAINS[id];
  return before !== undefined && s.eventHistory.some((h) => h.id === before);
};

const story = (spec: StorySpec): EventDef => ({
  id: spec.id,
  title: STORY_TITLES[spec.id],
  prompt: (s, ctx) => spec.prompt(s, ctx).join("\n"),
  when: (s, ctx) => storyConfig.enabled && !s.gameOver && s.week >= spec.minWeek && !storySeen(s, spec.id) && spec.when(s, ctx),
  weight: (s, ctx) => spec.weight(s, ctx) * (chained(s, spec.id) ? CHAIN_WEIGHT_MULT : 1),
  choices: spec.choices.map((c) => ({
    id: c.id,
    text: c.text,
    apply: (s: GameState, ctx: EngineContext) => {
      let r: { state: GameState; lines: string[] };
      if (c.apply) {
        r = c.apply(s, ctx);
      } else {
        const x = applyFx(s, c.fx ? c.fx(s, ctx) : {});
        r = { state: x.state, lines: [x.line] };
      }
      const state = recordStoryChoice(r.state, spec.id, c.id, callbackDelay(spec.id, c.id), c.spin === true);
      return { state, logs: [c.outcome, ...r.lines] };
    },
  })),
});

// ── Shared reads ──

const hasDirectors = (s: GameState): boolean => s.board.members.some((m) => m.role !== "founder");
const hasInvestorDirector = (s: GameState): boolean => s.board.members.some((m) => m.role === "investor");
const lateStage = (s: GameState): boolean => s.stage === "series-a" || s.stage === "growth";
const ai = (s: GameState, bonus: number): number => (s.thesis === "ai" ? bonus : 0);
const implied = (s: GameState): number => Math.max(s.valuation, STAGE_VALUATION_FLOOR[s.stage]);
const topLeads = (s: GameState) => [...s.investors.pipeline].sort((a, b) => b.relationship - a.relationship);
/** Net weekly burn, floored at a third of a burn unit so a rescue is never sized at zero. */
const netBurnOf = (s: GameState): number => Math.max(calcNetBurn(s), Math.round(Math.max(10_000, s.burn) / 3));

/** Story rounds respect the stage's hard cap, as `raise` does (closeStoryRound enforces it too; this keeps the prompt honest). */
const capped = (s: GameState, amount: number): number => Math.min(amount, stageRaiseCaps[s.stage].hardCap);

const rescueTerms = (s: GameState) => ({
  rescue: capped(s, money(netBurnOf(s) * 16)),
  rescuePre: money(implied(s) * 0.6),
  bridge: capped(s, money(netBurnOf(s) * 8)),
  bridgePre: money(implied(s) * 0.85),
  prepay: money(netBurnOf(s) * 10),
});

const UNICORN_PRICE = 1_000_000_000;

/** Trent takes a seat on the board (no RNG: a fixed name and personality). */
const seatTrent = (s: GameState): GameState => {
  if (s.board.members.some((m) => m.name === CAST.vc)) return s;
  const member: BoardMember = { id: `board-investor-${s.board.members.length}`, name: CAST.vc, role: "investor", personality: "activist", confidence: 55 };
  return { ...s, board: { ...s.board, members: [...s.board.members, member] } };
};

export const storyEvents: EventDef[] = [
  // 01 The GPU Landlord (gpu_landlord)
  story({
    id: "gpu-landlord",
    minWeek: 10,
    when: (s, ctx) => s.users >= 800 && !ctx.profitable && ctx.runwayWeeks >= 3 && ctx.runwayWeeks <= 52 && ctx.usersGrowthRate > 0,
    weight: (s) => 3 + ai(s, 1.5),
    prompt: (_s, ctx) => [
      "Priya puts a spreadsheet on your desk.",
      "“Every new customer makes us more popular and slightly closer to bankruptcy.”",
      `The compute provider offers a discount if you reserve capacity for three years. You have ${numberWord(ctx.runwayWeeks)} weeks of runway.`,
      "Trent calls this “securing strategic infrastructure.”",
      "Lena asks whether the infrastructure comes with customers. [[beat]]",
      "Sales has already promised unlimited AI usage to your largest prospect. “Unlimited” tested better than “economically possible.”",
      "The provider wants an answer today.",
    ],
    choices: [
      {
        id: "meter",
        text: "Meter the expensive features.",
        outcome: "Customers discover the difference between a magical assistant and a utility bill. Priya experiences something she cautiously identifies as relief.",
        fx: () => ({ arpu: 0.06, users: -0.03, rep: -2 }),
      },
      {
        id: "reserve",
        text: "Reserve the capacity.",
        outcome: "The discount is real. So is the clause requiring you to keep paying after the company’s ambitions become more modest.",
        fx: (s) => ({ cash: weeksOfBurn(s, 2), volatility: 4 }),
      },
      {
        id: "optimize",
        text: "Make the model cheaper.",
        outcome: "The assistant becomes less philosophical about resetting passwords. Customers accept this. The research team requests that you stop calling it a breakthrough.",
        fx: (s) => ({ cash: weeksOfBurn(s, 1), users: -0.01, rep: -1, morale: -2 }),
      },
    ],
  }),

  // 02 Agent All-Hands (agent_all_hands)
  story({
    id: "agent-all-hands",
    minWeek: 12,
    when: (s, ctx) => ctx.teamSize >= 10 && s.users >= 500 && s.cash >= weeksOfBurn(s, 4),
    weight: (s) => 2.5 + ai(s, 1),
    prompt: () => [
      "At 2:14 a.m., your procurement agent hired a research agent to find a cheaper procurement agent.",
      "The research agent hired three specialists. One recommended your procurement agent.",
      "By morning, they had exchanged 19,000 messages, produced a forty-page vendor assessment, and bought a subscription you already own.",
      "Nobody bought the laptop. [[beat]]",
      "The dashboard calls this “successful autonomous task completion.”",
      "Lena wants limits. Sales wants a case study. Trent wants to know whether payments between agents count as ecosystem revenue.",
      "The laptop request is now marked “strategic.”",
    ],
    choices: [
      {
        id: "approval",
        text: "Require human approval.",
        outcome: "The system asks before spending. Adoption falls among people whose main reason for buying an assistant was to answer fewer questions.",
        fx: () => ({ users: -0.02, rep: -1, stress: -2 }),
      },
      {
        id: "budget",
        text: "Cap each workflow’s budget.",
        outcome: "The agents share one spending limit. They complete fewer activities, but an uncomfortable number of those activities turn out to be unnecessary.",
        fx: (s) => ({ cash: weeksOfBurn(s, 1), rep: -1 }),
      },
      {
        id: "per-action",
        text: "Charge for every action.",
        outcome: "Revenue rises with activity. A customer asks why the invoice includes a billable discussion about whether to have another billable discussion.",
        fx: () => ({ arpu: 0.08, rep: -2 }),
      },
    ],
  }),

  // 03 Waterfront Property (waterfront_property)
  story({
    id: "waterfront-property",
    minWeek: 14,
    when: (s, ctx) => ctx.teamSize >= 14 && s.users >= 2000 && hasDirectors(s) && (s.team.data >= 1 || s.stage !== "garage"),
    weight: () => 2.5,
    prompt: () => [
      "The Databricks migration is finished. The board deck contains an animated diagram labeled UNIFIED INTELLIGENCE.",
      "Jules opens the inventory.",
      "Twelve definitions of “active customer.” A support export containing private complaints. A folder called FINAL_USE_THIS_ONE, owned by someone who left two years ago.",
      "“We have a lakehouse,” you say.",
      "“We have waterfront storage,” Jules replies. [[beat]]",
      "Marketing wants a personalization model. Sales has promised a data moat.",
      "Nobody can explain which customers agreed to which uses.",
      "The board presentation is tomorrow. The animation is excellent.",
    ],
    choices: [
      {
        id: "inventory",
        text: "Rebuild the data inventory.",
        outcome: "The animation becomes a work plan. Jules gets fewer compliments at meetings and fewer unpleasant surprises during customer diligence.",
        fx: (s) => ({ cash: -weeksOfBurn(s, 1.5), cruft: -4, morale: -1 }),
      },
      {
        id: "license",
        text: "Launch with licensed data.",
        outcome: "The model ships with clear usage rights. Marketing asks whether it remains a proprietary moat if procurement receives a monthly invoice.",
        fx: (s) => ({ cash: -weeksOfBurn(s, 1), users: 0.04 }),
      },
      {
        id: "opt-in",
        text: "Ask customers to opt in.",
        outcome: "The consent screen uses ordinary language. Participation falls below the forecast, which had treated permission as a problem for the design team.",
        fx: () => ({ rep: 3, users: -0.02 }),
      },
    ],
  }),

  // 04 A Single Source of Revenue (single_source_of_revenue)
  story({
    id: "single-source-of-revenue",
    minWeek: 14,
    when: (s) => s.mrr >= 10_000 && (s.investors.pipeline.length > 0 || hasInvestorDirector(s)),
    weight: () => 2.5,
    prompt: (s) => {
      const arr = s.mrr * 12;
      const deck = moneyWords(arr * (8 / 2.1));
      return [
        "The new data pipeline finally reconciles billing, CRM, and product usage.",
        `Finance reports ${moneyWords(arr)} in annual recurring revenue.`,
        `Sales reports ${moneyWords(arr * (4.8 / 2.1))} in ARR.`,
        `The fundraising deck reports ${deck} in ARR.`,
        "Jules has found the difference: unpaid pilots, duplicate accounts, and a customer who canceled in March but remains spiritually committed to your mission. [[beat]]",
        `Trent points at the ${deck} figure.`,
        "“This is the number the next round knows.”",
        "Priya points at the bank account.",
        "“This is the number payroll knows.”",
        "The data project has succeeded beyond anyone’s comfort level.",
      ];
    },
    choices: [
      {
        id: "correct",
        text: "Correct the board numbers.",
        outcome: "The company becomes smaller in the presentation and exactly the same size everywhere else. The next investor call gets longer.",
        fx: () => ({ vcRep: -4, leads: -6, board: 4, stress: 2 }),
      },
      {
        id: "separate",
        text: "Separate revenue from pipeline.",
        outcome: "You present three labeled columns: collected, contracted, and hoped for. Sales requests a more aspirational name for the third.",
        fx: () => ({ vcRep: -1, board: 1, stress: 2 }),
      },
      {
        id: "keep",
        text: "Keep the fundraising number.",
        outcome: "The deck survives another week. Priya begins confirming every verbal instruction by email. Her punctuation becomes noticeably more formal.",
        spin: true,
        fx: () => ({ vcRep: 4, leads: 6, cohesion: -3 }),
      },
    ],
  }),

  // 05 The Moat Has a Download Button (moat_download_button)
  story({
    id: "moat-download-button",
    minWeek: 16,
    when: (s, ctx) => s.team.engineering >= 5 && s.users >= 3000 && (s.stage !== "garage" || ctx.teamSize >= 20),
    weight: (s) => 2 + ai(s, 1.5),
    prompt: () => [
      "A new open model appears overnight. Your own tests show it handles most of your core tasks about as well as the model you spent eighteen months building.",
      "Someone posts a working demo before breakfast.",
      "Lena sends you the link without a message. Somehow, this is worse.",
      "Trent says the market has validated your thesis.",
      "Priya asks why validation has made the thesis available to everybody. [[beat]]",
      "Your pitch deck says TECHNICALLY UNREPEATABLE.",
      "The next slide says SUSTAINABLE PRICING POWER.",
      "The next slide is a photograph of you looking thoughtfully through a window.",
    ],
    choices: [
      {
        id: "adopt",
        text: "Adopt it and cut prices.",
        outcome: "Customers appreciate the savings. Several pages of the fundraising deck can no longer survive direct eye contact.",
        fx: (s) => ({ cash: weeksOfBurn(s, 1), users: 0.05, arpu: -0.08, vcRep: -3 }),
      },
      {
        id: "proprietary",
        text: "Keep the proprietary model.",
        outcome: "You promise continuity. Enterprise buyers nod. Lena submits a budget that treats continuity as the expensive commitment it has become.",
        fx: (s) => ({ cash: -weeksOfBurn(s, 2), rep: 1, vcRep: 2 }),
      },
      {
        id: "workflows",
        text: "Build around customer workflows.",
        outcome: "The roadmap fills with integrations and approvals. Nobody calls it revolutionary. Several customers finally ask where to send a purchase order.",
        fx: () => ({ vcRep: -2, cruft: 3, moat: 4 }),
      },
    ],
  }),

  // 06 The Agent Has Receipts (agent_has_receipts)
  story({
    id: "agent-has-receipts",
    minWeek: 18,
    when: (s, ctx) => hasDirectors(s) && ctx.teamSize >= 12,
    weight: () => 2.5,
    prompt: () => [
      "You ask the executive agent for a confident board update.",
      "It finds three approved commitments:",
      "Profitability by June.",
      "Unlimited AI usage forever.",
      "No layoffs under any circumstances.",
      "“Please identify which commitment takes priority,” it says.",
      "You type: “Use judgment.”",
      "It returns a spreadsheet. [[beat]]",
      "Lena calls this institutional memory.",
      "Sloane calls it a messaging problem.",
      "Trent asks whether the agent can be instructed to remember your ambition more clearly than your dates.",
      "The update is due in twenty minutes.",
    ],
    choices: [
      {
        id: "reconcile",
        text: "Reconcile the promises.",
        outcome: "You send a plan with explicit tradeoffs. The board discovers that clarity can be more alarming than ambiguity.",
        fx: () => ({ board: -4, cohesion: 3, stress: 4 }),
      },
      {
        id: "retime",
        text: "Change the timelines.",
        outcome: "June becomes ‘the next phase.’ Forever becomes ‘our long-term intent.’ The agent asks whether these phrases have calendar equivalents.",
        spin: true,
        fx: () => ({ board: 2, stress: -3 }),
      },
      {
        id: "forget",
        text: "Disable executive memory.",
        outcome: "The agent becomes more agreeable. Lena notes that you have successfully automated the least useful part of a leadership team.",
        fx: () => ({ cohesion: -3, stress: -2 }),
      },
    ],
  }),

  // 07 Ten Megawatts of PowerPoint (ten_megawatts_of_powerpoint)
  story({
    id: "ten-megawatts-of-powerpoint",
    minWeek: 20,
    when: (s) => lateStage(s) && s.users >= 15_000,
    weight: (s) => 2.5 + ai(s, 1),
    prompt: () => [
      "The infrastructure broker has found your AI factory.",
      "The building exists. The racks can be ordered. The dark fiber is nearby.",
      "The ten megawatts of power are described as “in process.”",
      "Lena asks when the connection will be ready.",
      "The broker says the utility has been extremely positive.",
      "Priya asks for a date.",
      "The broker sends a photograph of a handshake. [[beat]]",
      "Trent wants the announcement out before your competitor’s funding news.",
      "Sloane has already written: THE FUTURE IS POWERED HERE.",
      "For now, the building has enough electricity to illuminate the sign.",
    ],
    choices: [
      {
        id: "smaller",
        text: "Take the smaller powered site.",
        outcome: "You acquire fewer megawatts and more electricity. The launch photograph looks less impressive; the equipment has a better experience.",
        fx: (s) => ({ cash: -weeksOfBurn(s, 1.5), vcRep: -2 }),
      },
      {
        id: "reserve",
        text: "Reserve the big site.",
        outcome: "The deposit clears. Your projected capacity increases. The utility schedule remains outside the persuasive reach of your investor deck.",
        fx: (s) => ({ cash: -weeksOfBurn(s, 2.5), rep: 2, vcRep: 4 }),
      },
      {
        id: "rent",
        text: "Rent capacity while you wait.",
        outcome: "Customers get service. Priya gets two cost lines: the capacity you use and the building where you hope to use it.",
        fx: (s) => ({ cash: -weeksOfBurn(s, 2), users: 0.02 }),
      },
    ],
  }),

  // 08 State of the Slide (state_of_the_slide)
  story({
    id: "state-of-the-slide",
    minWeek: 14,
    when: (s) => s.team.engineering >= 4 && s.users >= 1500 && (s.investors.pipeline.length > 0 || hasInvestorDirector(s)),
    weight: (s) => 2.5 + ai(s, 1),
    prompt: () => [
      "Your model scored 98.7%.",
      "Lena would like to discuss the test.",
      "The questions came from development examples. Failed runs were removed as “setup issues.” A competitor was tested using settings nobody can reproduce.",
      "On a fresh customer dataset, you scored 61%. [[beat]]",
      "The launch video is ready. An analyst is attending. Trent has forwarded the headline to three funds with the subject THIS IS THE ONE.",
      "Priya asks whether there is a version of “best in class” that survives a follow-up question.",
    ],
    choices: [
      {
        id: "publish",
        text: "Publish both results.",
        outcome: "The launch acquires footnotes. Investors ask harder questions. Engineers stop treating the marketing calendar as an approaching weather emergency.",
        fx: () => ({ rep: 2, vcRep: -3, morale: 2 }),
      },
      {
        id: "narrow",
        text: "Narrow the product claim.",
        outcome: "You become excellent at a smaller problem. Sales mourns several adjectives and discovers a customer willing to pay for the remaining noun.",
        fx: () => ({ users: -0.01, arpu: 0.04, vcRep: -2 }),
      },
      {
        id: "headline",
        text: "Ship the headline.",
        outcome: "The launch performs beautifully. Priya declines to celebrate until somebody can explain why the evaluation folder has been renamed.",
        spin: true,
        fx: () => ({ users: 0.03, rep: 3, vcRep: 6, morale: -3 }),
      },
    ],
  }),

  // 09 Your Apology Has Been Indexed (apology_indexed)
  story({
    id: "apology-indexed",
    minWeek: 12,
    when: (s, ctx) => s.users >= 2000 && ctx.teamSize >= 8,
    weight: () => 2,
    prompt: () => [
      "A software supplier reports a compromised release. Lena confirms unauthorized access to customer workspace data through the affected integration.",
      "She has disabled it, preserved evidence, and started contacting affected customers. The full scope remains unclear.",
      "A customer asks whether its acquisition plans were exposed.",
      "Another asks why the status page is green. [[beat]]",
      "Trent sends a consultant whose draft begins, “We recently became aware of an isolated event.”",
      "The draft is dated yesterday.",
      "Priya says a serious response is affordable if you cancel the founder retreat.",
      "The retreat is called Trust Summit.",
    ],
    choices: [
      {
        id: "investigators",
        text: "Bring in outside investigators.",
        outcome: "The retreat becomes a forensic investigation. Both involve expensive specialists asking uncomfortable questions. One has a better chance of improving the company.",
        fx: (s) => ({ cash: -weeksOfBurn(s, 2), rep: -2, stress: 3 }),
      },
      {
        id: "lena",
        text: "Put Lena in charge.",
        outcome: "Lena assembles a response team and cancels the roadmap. Sales asks for a launch date. The silence is unusually informative.",
        fx: (s) => ({ cash: -weeksOfBurn(s, 0.5), rep: -3, morale: -3, stress: 4 }),
      },
      {
        id: "customers",
        text: "Fund customer recovery first.",
        outcome: "You fund hands-on customer support and credits while the investigation continues. The calls are brutal. At least they contain usable information.",
        fx: (s) => ({ cash: -weeksOfBurn(s, 2), users: -0.02, arpu: -0.03, rep: 1 }),
      },
    ],
  }),

  // 10 We Updated Your Privacy (silent_training_opt_in)
  story({
    id: "silent-training-opt-in",
    minWeek: 12,
    when: (s) => s.users >= 3000 && s.pricingModel !== "enterprise",
    weight: (s) => 2 + (s.pricingModel === "consumer" ? 1.5 : 0) + ai(s, 0.5),
    prompt: () => [
      "Last night’s update switched on “Help improve our AI” for every account.",
      "Training-data volume rose before breakfast.",
      "Unfortunately, the homepage still says your company would never do that.",
      "A customer posts both screenshots. Jules confirms they are real.",
      "Sloane asks whether “opt-in” has to involve opting. [[beat]]",
      "Support is filling with deletion requests. Enterprise sales calls this a consumer issue.",
      "Its largest prospect has just forwarded the thread.",
    ],
    choices: [
      {
        id: "rollback",
        text: "Roll back and rebuild consent.",
        outcome: "The switch goes off. Jules explains that stopping collection is easy. Accounting for what already entered training is the expensive part.",
        fx: (s) => ({ cash: -weeksOfBurn(s, 1.5), users: -0.02, rep: -2 }),
      },
      {
        id: "review",
        text: "Pause training; get an outside review.",
        outcome: "Sloane announces an independent review. Customers ask who selected the reviewer. The reviewer asks for a week nobody included in the launch plan.",
        fx: (s) => ({ cash: -weeksOfBurn(s, 1), rep: -3, vcRep: -1 }),
      },
      {
        id: "defend",
        text: "Keep it; defend the terms.",
        outcome: "The setting survives. So does the screenshot. Your next sales demo opens with a procurement officer reading the old homepage aloud.",
        spin: true,
        fx: () => ({ users: -0.02, arpu: 0.03, rep: -3 }),
      },
    ],
  }),

  // 11 Congratulations on Your Valuation (unicorn_terms_trap)
  story({
    id: "unicorn-terms-trap",
    minWeek: 16,
    when: (s) =>
      lateStage(s) &&
      s.valuation >= 250_000_000 &&
      s.valuation <= 950_000_000 &&
      s.investors.pipeline.length >= 2 &&
      (s.lastRound === null || s.week - s.lastRound.week >= 6),
    weight: () => 3,
    prompt: (s) => [
      "Two funds offer the same amount of money.",
      "One prices the round at a billion dollars. Its preferred shares receive twice their investment before common shareholders get anything in a sale, then participate in the remainder.",
      "The other offers a lower valuation with simpler terms.",
      "Sloane has reserved a press slot for “unicorn.” [[beat]]",
      "Trent studies the first offer.",
      "“A billion-dollar company recruits differently.”",
      "Priya studies the payout model.",
      "“So does a company where the employees might eventually get paid.”",
      "Both funds want an answer tomorrow.",
      `(The offers: ${usd(storyRoundSize(s))} at ${usd(UNICORN_PRICE)} pre-money, or the same at ${usd(money(implied(s)))}.)`,
    ],
    choices: [
      {
        id: "headline",
        text: "Take the billion-dollar headline.",
        outcome: "The announcement lands. Your ownership percentage looks excellent. Priya saves the exit model under a name nobody will confuse with the press release.",
        apply: (s) => {
          const [fund] = topLeads(s);
          const left: GameState = { ...s, investors: { pipeline: s.investors.pipeline.filter((l) => !topLeads(s).slice(0, 2).includes(l)) } };
          const round = closeStoryRound(left, storyRoundSize(s), UNICORN_PRICE, fund?.name ?? "The billion-dollar fund");
          const r = applyFx(round.state, { rep: 3, vcRep: 2 });
          return { state: r.state, lines: [...round.lines.slice(0, 2), r.line, ...round.lines.slice(2)] };
        },
      },
      {
        id: "clean",
        text: "Take the cleaner deal.",
        outcome: "The announcement says ‘strong conviction’ instead of ‘unicorn.’ Employees ask about their options. Priya’s explanation fits inside one meeting.",
        apply: (s) => {
          const fund = topLeads(s)[1] ?? topLeads(s)[0];
          const left: GameState = { ...s, investors: { pipeline: s.investors.pipeline.filter((l) => !topLeads(s).slice(0, 2).includes(l)) } };
          const round = closeStoryRound(left, storyRoundSize(s), money(implied(s)), fund?.name ?? "The cleaner fund");
          const r = applyFx(round.state, { morale: 2 });
          return { state: r.state, lines: [...round.lines.slice(0, 2), r.line, ...round.lines.slice(2)] };
        },
      },
      {
        id: "negotiate",
        text: "Negotiate both price and terms.",
        outcome: "You trade headline value for better terms. Both funds reopen diligence. Payroll continues observing the calendar you already agreed to.",
        fx: () => ({ stress: 5 }),
      },
    ],
  }),

  // 12 Founder Mode, Observer Seat (vc_rescue_board_control)
  story({
    id: "vc-rescue-board-control",
    minWeek: 12,
    when: (s, ctx) => s.stage !== "garage" && !ctx.profitable && ctx.runwayWeeks >= 1 && ctx.runwayWeeks <= 8 && s.cash > 0 && hasInvestorDirector(s),
    weight: () => 4,
    prompt: (s) => {
      const t = rescueTerms(s);
      return [
        "Priya puts payroll on the boardroom screen.",
        "Trent puts a term sheet over it.",
        "“Four months of runway. No layoffs.”",
        "The new board would have five seats. His fund would control three. Your employment agreement is attached to the financing documents for the first time. [[beat]]",
        "“You can’t build anything if you’re dead,” Trent says.",
        "Priya turns the page.",
        "“You also can’t build much if you need permission to remain employed.”",
        "The wire cutoff is 4 p.m.",
        "Payroll is next Friday. Priya has one alternative: a customer’s discounted annual prepayment, followed by cuts.",
        `(Rescue: ${usd(t.rescue)} at ${usd(t.rescuePre)} pre-money. Bridge: ${usd(t.bridge)} at ${usd(t.bridgePre)}. Prepayment: ${usd(t.prepay)}, no shares.)`,
      ];
    },
    choices: [
      {
        id: "rescue",
        text: "Take the rescue.",
        outcome: "Payroll clears. Trent congratulates you on saving the company, then asks you to step outside while its board discusses leadership.",
        apply: (s) => {
          const t = rescueTerms(s);
          const round = closeStoryRound(s, t.rescue, t.rescuePre, CAST.fund);
          const seated = seatTrent(round.state);
          const r = applyFx(seated, { morale: 2, stress: 8 });
          const seat = seated === round.state ? [] : [`${CAST.vc} joins the board.`];
          return { state: r.state, lines: [...round.lines.slice(0, 2), ...seat, r.line, ...round.lines.slice(2)] };
        },
      },
      {
        id: "bridge",
        text: "Counter with a smaller bridge.",
        outcome: "Trent offers less money and fewer rights. Priya deletes the hiring plan and starts counting Fridays.",
        apply: (s) => {
          const t = rescueTerms(s);
          const round = closeStoryRound(s, t.bridge, t.bridgePre, CAST.fund);
          const r = applyFx(round.state, { morale: -3, stress: 4 });
          return { state: r.state, lines: [...round.lines.slice(0, 2), r.line, ...round.lines.slice(2)] };
        },
      },
      {
        id: "prepay",
        text: "Take the prepayment; cut costs.",
        outcome: "A customer prepays at a painful discount. Payroll clears. The board stays yours. So does the meeting explaining the cuts.",
        fx: (s) => ({ cash: rescueTerms(s).prepay, arpu: -0.06, morale: -8, cohesion: -6, stress: 3 }),
      },
    ],
  }),

  // 13 The Founder Is the Product (founder_personal_brand_spiral)
  story({
    id: "founder-personal-brand-spiral",
    minWeek: 14,
    when: (s, ctx) => s.reputation >= 50 && ctx.teamSize >= 12 && (s.culture.morale <= 70 || s.stress >= 45),
    weight: () => 2.5,
    prompt: () => [
      "Your clip about running a company without managers has twelve million views.",
      "You have six managers.",
      "Sloane says the comments do not require organizational accuracy.",
      "A conference offers a keynote. A sponsor offers cash. A large prospect asks whether your people are actually replaceable. [[beat]]",
      "Lena wants one correction.",
      "“Those agents are three engineers and a queue.”",
      "The board wants a sequel.",
      "Sloane has a title: WHY MOST EMPLOYEES ARE JUST EXPENSIVE PROMPTS.",
    ],
    choices: [
      {
        id: "double-down",
        text: "Double down on founder content.",
        outcome: "The sequel wins more views. Recruiting gets more applications and fewer qualified ones. Your managers stop volunteering for the company photograph.",
        spin: true,
        fx: () => ({ users: 0.04, rep: 3, morale: -4, cohesion: -3 }),
      },
      {
        id: "builders",
        text: "Put the builders on camera.",
        outcome: "Lena demonstrates the actual product. Views fall sharply. The people who finish watching ask unusually specific questions about buying it.",
        fx: () => ({ users: -0.01, morale: 4, cohesion: 2 }),
      },
      {
        id: "keynote",
        text: "Book the keynote; cancel the sequel.",
        outcome: "The sponsor covers the event. Your calendar fills anyway. Lena learns that ‘strategic visibility’ takes exactly as long as product management.",
        fx: (s) => ({ cash: weeksOfBurn(s, 1), rep: 1, morale: -1, stress: 4 }),
      },
    ],
  }),

  // 14 Revenue, With a Return Address (circular_compute_revenue)
  story({
    id: "circular-compute-revenue",
    minWeek: 16,
    when: (s, ctx) => s.stage !== "garage" && ctx.mrrGrowthRate >= 0.04 && hasInvestorDirector(s) && s.burn >= 30_000,
    weight: () => 2.5,
    prompt: () => [
      "Apex invested in a startup that bought your product.",
      "You spent most of that contract on compute from another Apex company.",
      "That company bought your “enterprise AI strategy” package.",
      "The quarter looks excellent.",
      "Priya draws the transactions on the whiteboard. It resembles a dog chasing its tail. [[beat]]",
      "“Our ecosystem is working,” Trent says.",
      "The auditor asks whether anyone needs the products—and whether the side letter promising refunds changes the revenue.",
      "Trent suggests a shorter meeting.",
    ],
    choices: [
      {
        id: "disclose",
        text: "Correct the numbers and disclose.",
        outcome: "Your growth chart loses a floor. The auditor requests records. Trent asks whether the corrected version really needs the company logo.",
        fx: () => ({ users: -0.04, vcRep: -4, board: -4 }),
      },
      {
        id: "unwind",
        text: "Unwind the deals.",
        outcome: "Three customers leave in forty minutes. It feels coordinated because it is. Sales must find somebody outside the family.",
        fx: (s) => ({ cash: -weeksOfBurn(s, 1.5), users: -0.05, vcRep: -2 }),
      },
      {
        id: "defend",
        text: "Defend the ecosystem story.",
        outcome: "The board approves the slide. The auditor does not approve the numbers. The same company now has two revenue narratives.",
        spin: true,
        fx: () => ({ vcRep: 3, board: 3, morale: -2 }),
      },
    ],
  }),
];
