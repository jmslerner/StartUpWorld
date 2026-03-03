import { HudBar } from "./HudBar";
import { createInitialState } from "../../engine";
import { refreshDerivedNoLog } from "../../engine/derived";
import type { GameState } from "../../types/game";

const buildMockState = (): GameState => {
  const base = createInitialState();
  const users = 12450;
  const arpu = 19;
  const mrr = users * arpu;

  const overrides: Partial<GameState> = {
    companyName: "Nebula AI",
    week: 12,
    founder: { name: "Ava", archetype: "hacker" },
    cofounder: { ...base.cofounder, name: "Morgan", archetype: "operator" },
    pricingModel: "prosumer",
    stage: "seed",
    ap: 2,
    cash: 125_000,
    users,
    arpu,
    mrr,
    valuation: 15_000_000,
    team: { engineering: 4, design: 1, marketing: 2, sales: 2, ops: 1, hr: 0, legal: 0, data: 0, product: 0, executive: 0 },
    stress: 42,
    volatility: 35,
    reputation: 38,
    lastWeek: { users: 11000, mrr: 11000 * arpu, cash: 135_000, teamSize: 10 },
  };

  const s = refreshDerivedNoLog({ ...base, ...overrides });
  return s;
};

export const HudBarMock = () => {
  const state = buildMockState();
  return (
    <div className="min-h-[40vh] px-3 py-6 md:px-6">
      <div className="mx-auto w-full max-w-6xl">
        <HudBar state={state} />
      </div>
    </div>
  );
};

export default HudBarMock;
