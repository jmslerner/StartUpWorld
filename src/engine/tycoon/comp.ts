import type { TeamRole } from "../../types/game";

/** Standard weekly salary and one-off hire cost per role. Leaf module: imports nothing from the engine. */
export const roleComp: Record<TeamRole, { salary: number; hireCost: number }> = {
  engineering: { salary: 3500, hireCost: 3000 },
  design: { salary: 2800, hireCost: 2500 },
  marketing: { salary: 2600, hireCost: 2200 },
  sales: { salary: 3000, hireCost: 2500 },
  ops: { salary: 2400, hireCost: 2000 },
  hr: { salary: 2600, hireCost: 2200 },
  legal: { salary: 4200, hireCost: 5000 },
  data: { salary: 3200, hireCost: 2800 },
  product: { salary: 3400, hireCost: 3000 },
  executive: { salary: 5000, hireCost: 6000 },
};

/** Every token a player may type for a role (moved here from commands.ts so every module parses roles the same way). */
export const roleAliases: Record<string, TeamRole> = {
  engineering: "engineering",
  eng: "engineering",
  design: "design",
  ux: "design",
  marketing: "marketing",
  gtm: "marketing",
  sales: "sales",
  ae: "sales",
  ops: "ops",
  operations: "ops",
  hr: "hr",
  legal: "legal",
  lawyer: "legal",
  data: "data",
  analytics: "data",
  product: "product",
  pm: "product",
  executive: "executive",
  exec: "executive",
  vp: "executive",
};

/** The role tokens a player is offered, in `hire`'s own wording (its "Unknown role" line). */
export const ROLE_TOKENS_HELP = "eng, ux, marketing, sales, ops, hr, legal (unlocks: data, product, executive)";

/**
 * True for a word that is not a role token but reads like one: "engineer", "engineers", "designer", "marketer", "lawyers".
 * Used only after a lookup has already failed, to point at the role tokens instead of at a missing colleague.
 */
export const looksLikeRole = (token: string): boolean => {
  const t = token.trim().toLowerCase().replace(/s$/, "");
  if (t.length < 3 || Object.prototype.hasOwnProperty.call(roleAliases, token.trim().toLowerCase())) return false;
  return Object.keys(roleAliases).some((alias) => {
    if (alias.length < 3) return false;
    if (alias.startsWith(t) || t.startsWith(alias)) return true;
    let common = 0;
    while (common < Math.min(alias.length, t.length) && alias[common] === t[common]) common += 1;
    return common >= 5;
  });
};
