/** The market view's input: plain data built outside the world, like the office scene. Re-exported by ../types. */

/** Which of the two views the world shows on its one canvas. */
export type WorldViewKind = "office" | "market";

/** A seat's standing in the market: the player's company, a rival, or an empty lot where a company went out. */
export type MarketSeatState = "player" | "rival" | "out";

export interface MarketCompany {
  /** 0 is the player. */
  readonly seat: number;
  readonly name: string;
  readonly state: MarketSeatState;
  readonly users: number;
  /** Building height on the market's scale, 0 to 1; 0 for a company that is out. */
  readonly height: number;
  /** Share of last year's new users this company won, 0 to 1. */
  readonly won: number;
  readonly listed: boolean;
  /** Founded this year in a seat another company left. */
  readonly newcomer: boolean;
}

export interface MarketScene {
  readonly runId: string;
  readonly year: number;
  readonly era: string;
  readonly barUsers: number;
  /** The bar for going public on the same scale as `height`. */
  readonly bar: number;
  /** Last year's new users shared out (the log's pool); 0 before any year was played. */
  readonly pool: number;
  /** In seat order. */
  readonly companies: readonly MarketCompany[];
}
