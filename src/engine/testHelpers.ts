/**
 * Shared test fixtures for engine unit tests.
 * NOT imported by production code.
 */
import type { Build, Employee, GameState } from "../types/game";
import type { EngineContext } from "./context";
import { reconcileRoster, withSlices } from "./tycoon/roster";

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

// ── Tycoon fixtures (new exports only: makeState() itself stays slice-less, the legacy mode) ──

/** makeState() plus both tycoon slices and a job-ad roster matching `team` (TYCOON-SPEC §12). */
export const makeTycoonState = (overrides?: Partial<GameState>): GameState => reconcileRoster(withSlices(makeState(overrides)));

/** A 3/3 standard engineer, id e1, energy 100, standard salary, not engaged, on the day job. */
export const makeEmployee = (overrides?: Partial<Employee>): Employee => ({
  id: "e1",
  name: "Mei Kowalski",
  role: "engineering",
  pace: 3,
  craft: 3,
  quirk: null,
  salary: 3500,
  energy: 100,
  hiredWeek: 1,
  shipped: 0,
  buildId: null,
  joinedWeek: 0,
  engaged: false,
  offerDueWeek: 0,
  offerKind: null,
  leadOnNotice: null,
  retainedWeek: 0,
  ledWeek: 0,
  ...overrides,
});

/** A Feature M called Atlas (b1, slug `atlas`), kicked off in week 1, nothing built yet. */
export const makeBuild = (overrides?: Partial<Build>): Build => ({
  id: "b1",
  name: "Atlas",
  slug: "atlas",
  type: "feature",
  size: "m",
  units: 2.5,
  baseScope: 12,
  scope: 12,
  progress: 0,
  qSum: 0,
  qPts: 0,
  polish: 0,
  surprises: 0,
  crunch: false,
  crunchWeeks: 0,
  crunchedWeek: 0,
  startedWeek: 1,
  dueWeek: 6,
  readyWeek: 0,
  ...overrides,
});
