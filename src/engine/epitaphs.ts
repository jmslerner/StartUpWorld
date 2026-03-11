import type { EndingType, GameState } from "../types/game";

const templates: Record<EndingType, string[]> = {
  bankruptcy: [
    "Here lies {company}. Burned bright. Burned out. Burned cash.",
    "{company}, Week {week}. Cause of death: optimism.",
    "Rest in peace, {company}. Runway: 0 weeks. Legacy: 1 Slack bot.",
    "{company} believed in the mission. The bank did not.",
    "{company} disrupted nothing. Except {founder}'s savings account.",
    "The servers are off. The Slack channels remain, haunted.",
    "{company}, Week {week}. The money is gone but the domain is available.",
  ],
  "founder-removal": [
    "The board called it a transition. {founder} called it a Tuesday.",
    "Removed by the people they hired. Classic.",
    "{founder} built {company}. {company} removed {founder}. Circle of startups.",
    "{founder}'s access badge stopped working before the press release went out.",
    "The board thanks {founder} for their 'foundational contributions.' The door is that way.",
  ],
  "zombie-saas": [
    "{company}: not dead, not alive. Someone's bookkeeper still logs in.",
    "Zombie mode activated. The product outlived the ambition.",
    "{company} persists. Nobody remembers why.",
    "$1,200/mo in MRR. $1,100 in server costs. The dream lives on.",
    "{company} technically still exists. Like a Geocities page with a Stripe integration.",
  ],
  acquisition: [
    "Acquired for parts. The snacks were better over there.",
    "Someone bigger wrote the check. {company} becomes a quarterly footnote.",
    "{company}: born in a garage, buried in a corporate reorg.",
    "Acquired. The team gets hoodies. {founder} gets a 2-year retention package and an existential crisis.",
    "{company} is now a feature inside a product nobody uses at a company everyone knows.",
  ],
  ipo: [
    "Rang the bell. Cashed the check. Left the group chat.",
    "Public. Profitable. Probably miserable.",
    "{founder} is now worth nine figures on paper. The paper is volatile.",
    "IPO day. {founder} cries in a bathroom at the NYSE. Happy tears. Probably.",
  ],
  "ai-hype-exit": [
    "Sold the demo. Kept the house. Lost the plot.",
    "AI-powered exit. Human-powered regret.",
    "They bought the sizzle. The steak was a fine-tuned GPT wrapper.",
    "Acquirer's due diligence lasted 72 hours. That's how you know it's a hype cycle.",
  ],
  "forced-acquisition": [
    "The board sold {company}. {founder} found out via email.",
    "Forced exit. The board called it strategy. {founder} called it betrayal.",
    "{company} sold at a discount. The board got their money. {founder} got a lesson.",
    "The board voted 4-1. Guess who the 1 was.",
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
