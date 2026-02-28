import type { EndingType } from "./game";

export interface LeaderboardEntry {
  id: string;
  companyName: string;
  founderName: string;
  ending: EndingType;
  grade: string;
  score: number;
  finalValuation: number;
  week: number;
  seed: number;
  timestamp: number;
}

export interface GraveyardEntry {
  id: string;
  companyName: string;
  ending: EndingType;
  epitaph: string;
  grade: string;
  week: number;
  timestamp: number;
}
