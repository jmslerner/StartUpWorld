import type { ActionResult, GameState, LogEntry, TeamRole } from "../types/game";
import { clamp, toLog } from "./utils";

const BASE_AP = 3;

const roleCosts: Record<TeamRole, { salary: number; hireCost: number }> = {
  engineering: { salary: 3500, hireCost: 3000 },
  design: { salary: 2800, hireCost: 2500 },
  marketing: { salary: 2600, hireCost: 2200 },
  sales: { salary: 3000, hireCost: 2500 },
  ops: { salary: 2400, hireCost: 2000 },
};

const randomEvent = (state: GameState): LogEntry | null => {
  const roll = Math.random();
  if (roll < 0.15) {
    return toLog("A surprise blog post drives a small spike in signups.", "event");
  }
  if (roll < 0.25) {
    return toLog("An unexpected expense bumps burn slightly this week.", "event");
  }
  if (roll < 0.33) {
    return toLog("A mentor intro boosts your reputation.", "event");
  }
  return null;
};

export const createInitialState = (): GameState => ({
  week: 1,
  ap: BASE_AP,
  cash: 20000,
  users: 50,
  mrr: 500,
  burn: 2500,
  team: {
    engineering: 1,
    design: 0,
    marketing: 0,
    sales: 0,
    ops: 0,
  },
  reputation: 10,
  stage: "garage",
});

const withLogs = (state: GameState, logs: LogEntry[]): ActionResult => ({ state, logs });

export const hire = (state: GameState, role: TeamRole, count: number): ActionResult => {
  if (count <= 0) {
    return withLogs(state, [toLog("Hire count must be at least 1.", "error")]);
  }
  const { salary, hireCost } = roleCosts[role];
  const totalHireCost = hireCost * count;
  if (state.cash < totalHireCost) {
    return withLogs(state, [toLog("Not enough cash to hire that many.", "error")]);
  }
  const updated: GameState = {
    ...state,
    cash: state.cash - totalHireCost,
    burn: state.burn + salary * count,
    team: {
      ...state.team,
      [role]: state.team[role] + count,
    },
  };
  return withLogs(updated, [
    toLog(`Hired ${count} ${role} ${count === 1 ? "hire" : "hires"}.`),
    toLog(`Burn increased by $${(salary * count).toLocaleString()}/wk.`),
  ]);
};

export const shipFeature = (state: GameState, name: string): ActionResult => {
  if (!name.trim()) {
    return withLogs(state, [toLog("Ship what? Provide a feature name.", "error")]);
  }
  const repGain = 2 + Math.floor(Math.random() * 3);
  const mrrGain = 150 + Math.floor(Math.random() * 200);
  const updated: GameState = {
    ...state,
    reputation: clamp(state.reputation + repGain, 0, 100),
    mrr: state.mrr + mrrGain,
  };
  return withLogs(updated, [
    toLog(`Shipped feature: ${name}. Users notice.`),
    toLog(`Reputation +${repGain}, MRR +$${mrrGain}.`),
  ]);
};

export const launchCampaign = (state: GameState, name: string): ActionResult => {
  if (!name.trim()) {
    return withLogs(state, [toLog("Launch what? Provide a campaign name.", "error")]);
  }
  const spend = 1200;
  if (state.cash < spend) {
    return withLogs(state, [toLog("Not enough cash to launch a campaign.", "error")]);
  }
  const userGain = 40 + Math.floor(Math.random() * 60);
  const updated: GameState = {
    ...state,
    cash: state.cash - spend,
    users: state.users + userGain,
    burn: state.burn + 200,
  };
  return withLogs(updated, [
    toLog(`Campaign "${name}" launched.`),
    toLog(`Users +${userGain}, spend $${spend}.`),
  ]);
};

export const pitchInvestors = (state: GameState): ActionResult => {
  const chance = Math.min(0.7, 0.25 + state.reputation / 200);
  if (Math.random() < chance) {
    const bump = 5000 + Math.floor(Math.random() * 5000);
    return withLogs(
      { ...state, cash: state.cash + bump, reputation: clamp(state.reputation + 2, 0, 100) },
      [toLog("Pitch went well. Investors are intrigued."), toLog(`Soft interest +$${bump}.`)]
    );
  }
  return withLogs(
    { ...state, reputation: clamp(state.reputation - 1, 0, 100) },
    [toLog("Pitch was a miss. Try again after more traction.", "event")]
  );
};

export const raiseSeed = (state: GameState, amount: number): ActionResult => {
  if (amount <= 0) {
    return withLogs(state, [toLog("Raise amount must be positive.", "error")]);
  }
  const dilutionPenalty = Math.min(6, Math.round(amount / 25000));
  const updated: GameState = {
    ...state,
    cash: state.cash + amount,
    reputation: clamp(state.reputation + 3 - dilutionPenalty, 0, 100),
    stage: "seed",
  };
  return withLogs(updated, [
    toLog(`Seed round closed: $${amount.toLocaleString()}.`),
    toLog(`Stage updated to Seed. Reputation ${updated.reputation >= state.reputation ? "up" : "down"}.`),
  ]);
};

export const endWeek = (state: GameState): ActionResult => {
  const cashAfterBurn = state.cash - state.burn;
  const churn = Math.floor(state.users * 0.03);
  const newUsers = Math.floor(state.users * (state.reputation / 200));
  const newMrr = Math.max(0, state.mrr + newUsers * 4 - churn * 2);
  const updated: GameState = {
    ...state,
    week: state.week + 1,
    ap: BASE_AP,
    cash: cashAfterBurn,
    users: Math.max(0, state.users + newUsers - churn),
    mrr: newMrr,
  };
  const logs: LogEntry[] = [
    toLog("Week closed."),
    toLog(`Cash -$${state.burn.toLocaleString()} burn.`),
    toLog(`Users +${newUsers} / -${churn}.`),
  ];
  const event = randomEvent(state);
  if (event) {
    logs.push(event);
  }
  return withLogs(updated, logs);
};

export const status = (state: GameState): ActionResult => {
  const runway = state.burn > 0 ? Math.floor(state.cash / state.burn) : 0;
  return withLogs(state, [
    toLog(
      `Week ${state.week} | AP ${state.ap} | Cash $${state.cash.toLocaleString()} | Users ${state.users} | MRR $${state.mrr.toLocaleString()} | Burn $${state.burn.toLocaleString()} | Runway ${runway}w`
    ),
  ]);
};

export const spendAp = (state: GameState, cost = 1): GameState => ({
  ...state,
  ap: Math.max(0, state.ap - cost),
});

export const canSpendAp = (state: GameState, cost = 1): boolean => state.ap >= cost;
