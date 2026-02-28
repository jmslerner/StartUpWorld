import type { EndingType, GameState } from "../types/game";

const templates: Record<EndingType, string[]> = {
  bankruptcy: [
    "Here lies {company}. Burned bright. Burned out. Burned cash.",
    "{company}, Week {week}. Cause of death: optimism.",
    "Rest in peace, {company}. Runway: 0 weeks. Legacy: 1 Slack bot.",
    "{company} believed in the mission. The bank did not.",
  ],
  "founder-removal": [
    "The board called it a transition. {founder} called it a Tuesday.",
    "Removed by the people they hired. Classic.",
    "{founder} built {company}. {company} removed {founder}. Circle of startups.",
  ],
  "zombie-saas": [
    "{company}: not dead, not alive. Someone's bookkeeper still logs in.",
    "Zombie mode activated. The product outlived the ambition.",
    "{company} persists. Nobody remembers why.",
  ],
  acquisition: [
    "Acquired for parts. The snacks were better over there.",
    "Someone bigger wrote the check. {company} becomes a quarterly footnote.",
    "{company}: born in a garage, buried in a corporate reorg.",
  ],
  ipo: [
    "Rang the bell. Cashed the check. Left the group chat.",
    "Public. Profitable. Probably miserable.",
  ],
  "ai-hype-exit": [
    "Sold the demo. Kept the house. Lost the plot.",
    "AI-powered exit. Human-powered regret.",
  ],
};

export const generateEpitaph = (state: GameState, ending: EndingType): string => {
  const pool = templates[ending];
  const idx = Math.abs(Math.floor(state.rng * 1000)) % pool.length;
  return pool[idx]
    .replace(/\{company\}/g, state.companyName)
    .replace(/\{founder\}/g, state.founder.name)
    .replace(/\{week\}/g, String(state.week));
};
