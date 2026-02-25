export type Stage = "garage" | "seed" | "series-a" | "growth";

export type CompanyPhase = "garage" | "coworking" | "office" | "unicorn" | "public";

export type FounderArchetype = "visionary" | "hacker" | "sales-animal" | "philosopher";

export type TeamRole = "engineering" | "design" | "marketing" | "sales" | "ops";

export type TeamRoster = Record<TeamRole, number>;

export interface CofounderDynamics {
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
  week: number;
  ap: number;
  cash: number;
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
    archetype: FounderArchetype | null;
  };
  cofounder: CofounderDynamics;
  culture: CultureState;
  stress: number; // 0-100
  volatility: number; // 0-100

  investors: {
    pipeline: InvestorLead[];
  };

  pendingEvent: PendingEvent | null;
  gameOver: GameOverState | null;

  // Deterministic run support
  seed: number;
  rng: number; // uint32 internal RNG state
  logSeq: number;

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
