/**
 * Shared test fixtures for engine unit tests.
 * NOT imported by production code.
 */
import type { GameState } from "../types/game";
import type { EngineContext } from "./context";

const defaultTeam = (): GameState["team"] => ({
  engineering: 1,
  design: 0,
  marketing: 0,
  sales: 0,
  ops: 0,
  hr: 0,
  legal: 0,
  data: 0,
  product: 0,
  executive: 0,
});

export const makeState = (overrides?: Partial<GameState>): GameState => ({
  companyName: "TestCo",
  week: 1,
  ap: 3,
  cash: 100_000,
  debtOutstanding: 0,
  debtService: 0,
  valuation: 2_000_000,
  capTable: { founderPct: 1.0, investorPct: 0.0 },
  lastRound: null,
  users: 100,
  arpu: 10,
  mrr: 1_000,
  burn: 4_000,
  team: defaultTeam(),
  reputation: 50,
  vcReputation: 50,
  stage: "garage",
  thesis: "ai",
  pricingModel: "consumer",
  companyPhase: "garage",
  founder: { name: "Test Founder", archetype: "hacker" },
  cofounder: { name: "Test Cofounder", archetype: "operator", trust: 70, ego: 30, ambition: 50 },
  culture: { cohesion: 60, morale: 60 },
  stress: 20,
  volatility: 30,
  investors: { pipeline: [] },
  bootstrapFunding: { friends: 0, mortgage: 0, preseed: 0, "personal-loan": 0, "credit-cards": 0 },
  peakValuation: 2_000_000,
  totalRaised: 0,
  freeActionUsed: {},
  board: { members: [], lastMeetingWeek: 0 },
  assets: [],
  pendingEvent: null,
  eventHistory: [],
  gameOver: null,
  seed: 12345,
  rng: 12345,
  logSeq: 0,
  seedText: null,
  seedLocked: false,
  lastWeek: { users: 90, mrr: 900, cash: 104_000, teamSize: 1 },
  ...overrides,
});

export const makeCtx = (overrides?: Partial<EngineContext>): EngineContext => ({
  runwayWeeks: 25,
  usersGrowthRate: 0.1,
  mrrGrowthRate: 0.1,
  burnIntensity: 0.04,
  teamSize: 1,
  hiresThisWeek: 0,
  nearBankruptcy: false,
  ltv: 120,
  cac: 30,
  ltvCacRatio: 4.0,
  profitable: false,
  ...overrides,
});
