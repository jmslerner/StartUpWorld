export type Stage = "garage" | "seed" | "series-a" | "growth";

export type CompanyPhase = "garage" | "coworking" | "office" | "unicorn" | "public";

export type FounderArchetype = "visionary" | "hacker" | "sales-animal" | "philosopher";

export type CofounderArchetype = "operator" | "builder" | "rainmaker" | "powderkeg";

export type TeamRole = "engineering" | "design" | "marketing" | "sales" | "ops" | "hr" | "legal";

export type TeamRoster = Record<TeamRole, number>;

export type BootstrapFundingSource = "friends" | "mortgage" | "preseed" | "personal-loan" | "credit-cards";

export type BootstrapFundingUses = Record<BootstrapFundingSource, number>;

export interface CofounderDynamics {
  name: string;
  archetype: CofounderArchetype | null;
  trust: number; // 0-100
  ego: number; // 0-100
  ambition: number; // 0-100
}

export interface CultureState {
  cohesion: number; // 0-100
  morale: number; // 0-100
}

export type InvestorTrend = "ai" | "crypto" | "devtools" | "consumer" | "enterprise" | "fintech" | "biotech";

export interface InvestorLead {
  id: string;
  name: string;
  riskTolerance: number; // 0-100
  trendBias: InvestorTrend;
  relationship: number; // 0-100
}

export interface EventChoiceView {
  id: string;
  text: string;
}

export interface PendingEvent {
  id: string;
  title: string;
  prompt: string;
  choices: EventChoiceView[];
}

export interface EventHistoryEntry {
  id: string;
  week: number;
}

export type EndingType =
  | "ipo"
  | "acquisition"
  | "bankruptcy"
  | "founder-removal"
  | "zombie-saas"
  | "ai-hype-exit";

export interface GameOverState {
  ending: EndingType;
  week: number;
  headline: string;
}

export interface GameState {
  companyName: string;
  week: number;
  ap: number;
  cash: number;
  debtOutstanding: number; // principal; repaid automatically on successful investor raises
  debtService: number; // weekly burn add-on from debt
  valuation: number;

  capTable: {
    founderPct: number; // 0..1
    investorPct: number; // 0..1
  };
  lastRound: {
    week: number;
    stage: Stage;
    investorName: string;
    amount: number;
    preMoney: number;
    postMoney: number;
    dilutionPct: number; // 0..1 (new investor ownership in this round)
  } | null;

  users: number;
  arpu: number;
  mrr: number;
  burn: number;
  team: TeamRoster;
  reputation: number;
  vcReputation: number;
  stage: Stage;

  thesis: InvestorTrend;

  companyPhase: CompanyPhase;
  founder: {
    name: string;
    archetype: FounderArchetype | null;
  };
  cofounder: CofounderDynamics;
  culture: CultureState;
  stress: number; // 0-100
  volatility: number; // 0-100

  investors: {
    pipeline: InvestorLead[];
  };

  bootstrapFunding: BootstrapFundingUses;

  pendingEvent: PendingEvent | null;
  // Recent event history (most recent first). Used to reduce repeats.
  eventHistory: EventHistoryEntry[];
  gameOver: GameOverState | null;

  // Deterministic run support
  seed: number;
  rng: number; // uint32 internal RNG state
  logSeq: number;

  // Optional player-provided seed (for display/replay). Seed cannot be changed once locked.
  seedText: string | null;
  seedLocked: boolean;

  lastWeek: {
    users: number;
    mrr: number;
    cash: number;
    teamSize: number;
  };
}

export interface LogEntry {
  id: string;
  text: string;
  kind?: "system" | "user" | "event" | "error";
}

export interface ActionResult {
  state: GameState;
  logs: LogEntry[];

  // Optional structured output for future UI; terminal can ignore.
  events?: PendingEvent[];
}
