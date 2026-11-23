export type Stage = "garage" | "seed" | "series-a" | "growth";

export type BoardPersonality = "activist" | "cheerleader" | "operator" | "dealmaker" | "old-guard";

export interface BoardMember {
  id: string;
  name: string;
  role: "founder" | "cofounder" | "investor" | "independent";
  personality: BoardPersonality;
  confidence: number; // 0-100 — confidence in the CEO
}

export interface BoardState {
  members: BoardMember[];
  lastMeetingWeek: number; // week of last board meeting event
}

export type CompanyPhase = "garage" | "coworking" | "office" | "unicorn" | "public";

export type AssetId = "office-upgrade" | "lounge" | "helicopter" | "jet" | "yacht";

export interface Asset {
  id: AssetId;
  name: string;
  purchaseWeek: number;
}

export type FounderArchetype = "visionary" | "hacker" | "sales-animal" | "philosopher";

export type CofounderArchetype = "operator" | "builder" | "rainmaker" | "powderkeg";

export type PricingModel = "consumer" | "prosumer" | "enterprise";

export type TeamRole = "engineering" | "design" | "marketing" | "sales" | "ops" | "hr" | "legal" | "data" | "product" | "executive";

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
  | "ai-hype-exit"
  | "forced-acquisition";

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
  pricingModel: PricingModel;

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

  // Tracking fields for endings & AP
  peakValuation: number;
  totalRaised: number;
  freeActionUsed: Record<string, boolean>; // tracks per-week archetype free actions

  board: BoardState;
  assets: Asset[];

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

  // Tycoon slices (TYCOON-SPEC §2). Optional on purpose: a state without them is a LEGACY state and every
  // engine function treats it exactly as today (G3). createInitialState() and the save migration always
  // create both; legacy commands never add or remove them.
  people?: PeopleState;
  product?: ProductState;

  // The Next Round story pack (src/engine/story). Optional: created by createInitialState() and the save
  // migration, and lazily by the story helpers; a state without it plays as if no story choice was ever made.
  story?: StoryState;
}

// ── The Next Round story pack ──

export interface StoryChoice {
  eventId: string; // a story event id, e.g. "gpu-landlord"
  choiceId: string;
  week: number;
}

export interface StoryCallback {
  key: string; // `${eventId}:${choiceId}`: the later scene this choice earned
  dueWeek: number; // first week it may play; dropped silently if still unplayed 12 weeks later
}

export interface StoryState {
  choices: StoryChoice[]; // most recent first, story events only
  callbacks: StoryCallback[]; // scheduled later scenes, not yet played
  rounds: number; // investor rounds closed at Series A or later (drives the Series A-N interludes)
  spin: number; // "protect the story" choices made
}

// ── Individual employees (TYCOON-SPEC §2.2) ──

export type QuirkId = "cowboy" | "craftsperson" | "firefighter" | "glue" | "mercenary" | "believer";

export type OfferKind = "recruiter" | "burnout";

export interface Employee {
  id: string; // "e1", "e2", ... serial from PeopleState.nextId, never reused within a run (the 3D seat key)
  name: string; // unique among roster + current candidates while the name lists last; <= 40 chars
  role: TeamRole;
  pace: number; // integer 1..5 (3 = standard): how fast they move a build
  craft: number; // integer 1..5 (3 = standard): how good their work on a build is
  quirk: QuirkId | null;
  salary: number; // $/week actually paid (finite, > 0)
  energy: number; // integer 0..100; the one personal meter; only crunch drains it
  hiredWeek: number; // week they joined (migrated heads: the migration week)
  shipped: number; // releases credited to them (experience), integer >= 0
  buildId: string | null; // Build.id they are staffed on; null = day job
  joinedWeek: number; // week they were put on buildId (0 while buildId is null): their ramp-up week
  engaged: boolean; // true once recruited, staffed or retained; never goes back to false
  offerDueWeek: number; // 0 = no notice; else they leave in the tick that makes state.week >= offerDueWeek
  offerKind: OfferKind | null; // why they handed in notice; null when offerDueWeek is 0
  leadOnNotice: string | null; // Build.id they led when the notice landed (the lead rule follows it); null without notice
  retainedWeek: number; // week of their last `retain` (0 = never)
  ledWeek: number; // last week they led a SOLID-or-better release (0 = never)
}

export interface Candidate {
  id: string; // "c1", "c2", ... serial from PeopleState.nextCandidateId
  name: string;
  role: TeamRole;
  pace: number; // the truth, 1..5
  craft: number; // the truth, 1..5
  claimedPace: number; // what the résumé says: >= pace; equals pace when vetted
  claimedCraft: number; // what the résumé says: >= craft; equals craft when vetted
  quirk: QuirkId | null; // stored, but every view hides it unless vetted
  vetted: boolean; // true when the company had HR (>= 1 whole head) when the pool was generated
  ask: number; // $/week, priced on the CLAIMED stats
}

export interface PeopleState {
  rng: number; // OWN xorshift32 stream. 0 = not seeded yet (seeded lazily from state.seed)
  nextId: number; // next employee serial (>= 1)
  nextCandidateId: number;
  roster: Employee[]; // <= ROSTER_CAP (120)
  candidates: Partial<Record<TeamRole, Candidate[]>>; // this week's pools: <= 3 per role, only roles someone looked at
  candidatesWeek: number; // week the pools belong to; any other state.week means "no pools"
  departures: number; // lifetime count of named people who left or were let go
}

// ── Product projects: builds (TYCOON-SPEC §2.3) ──

export type BuildType = "feature" | "growth" | "premium" | "plumbing" | "moonshot";
export type BuildSize = "s" | "m" | "l" | "xl";
export type ReceptionTier = "flop" | "shrug" | "solid" | "breakout";

export interface Build {
  id: string; // "b1", "b2", ... serial from ProductState.nextId
  name: string; // display name, <= 24 chars
  slug: string; // command handle: [a-z0-9]+(-[a-z0-9]+)*, <= 24 chars, unique among active builds
  type: BuildType;
  size: BuildSize;
  units: number; // impact units, from the size at kickoff (one event scales it by 1.15)
  baseScope: number; // points at kickoff, after scope inflation (one decimal)
  scope: number; // points required now: surprises and events add (one decimal)
  progress: number; // points done, 0..scope
  qSum: number; // sum of (points added that week x that week's quality)
  qPts: number; // sum of points counted in qSum
  polish: number; // 0..POLISH_MAX (9), one decimal
  surprises: number; // 0..SURPRISE_MAX (3)
  crunch: boolean;
  crunchWeeks: number; // weeks worked under crunch
  crunchedWeek: number; // state.week of the last tick that worked it under crunch (0 = never)
  startedWeek: number;
  dueWeek: number; // last on-time week; each week after it costs reception
  readyWeek: number; // week it first reached 100% (0 = not yet)
}

export interface Release {
  id: string; // the Build.id it came from
  name: string;
  type: BuildType;
  size: BuildSize;
  week: number;
  reception: number; // 0..100
  tier: ReceptionTier;
  quality: number; // 0..100
  leadName: string | null;
}

export interface ProductState {
  rng: number; // OWN xorshift32 stream. 0 = not seeded yet
  nextId: number; // next build serial (>= 1), greater than every active AND shipped serial
  active: Build[]; // <= 3 (slots by phase, checked at kickoff only)
  shipped: Release[]; // most recent first, <= RELEASE_LOG_MAX (12)
  shippedCount: number; // lifetime releases (>= shipped.length)
  shippedByType: Record<BuildType, number>; // lifetime releases per type (drives scope inflation)
  cruft: number; // 0..100, one decimal: the mess you shipped
  moat: number; // 0..100, one decimal: the lead you built
  arpuCarry: number; // fractional ARPU not yet applied, 0 <= carry < 1
  lastHotfixWeek: number; // week of the last patch that paid cruft down (0 = never)
}

export interface LogEntry {
  id: string;
  text: string;
  kind?: "system" | "user" | "event" | "error";
}

export type SoundHint = "success" | "fail" | "cash-in" | "warning" | "opportunity" | "crisis" | "click";

export interface ActionResult {
  state: GameState;
  logs: LogEntry[];
  sound?: SoundHint;

  // Optional structured output for future UI; terminal can ignore.
  events?: PendingEvent[];
}
