export type Stage = "garage" | "seed" | "series-a" | "growth";

export type TeamRole = "engineering" | "design" | "marketing" | "sales" | "ops";

export type TeamRoster = Record<TeamRole, number>;

export interface GameState {
  week: number;
  ap: number;
  cash: number;
  users: number;
  mrr: number;
  burn: number;
  team: TeamRoster;
  reputation: number;
  stage: Stage;
}

export interface LogEntry {
  id: string;
  text: string;
  kind?: "system" | "user" | "event" | "error";
}

export interface ActionResult {
  state: GameState;
  logs: LogEntry[];
}
