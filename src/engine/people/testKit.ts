/**
 * Test-only helpers for the people tests. NOT imported by production code.
 */
import type { ActionResult, Build, Employee, GameState, TeamRoster } from "../../types/game";
import { executeCommand } from "../commands";
import { refreshDerivedNoLog } from "../derived";
import { makeEmployee, makeState } from "../testHelpers";
import { emptyPeople, emptyProduct, reconcileRoster, serialOf } from "../tycoon/roster";

export const zeroTeam = (counts: Partial<TeamRoster> = {}): TeamRoster => ({
  engineering: 0, design: 0, marketing: 0, sales: 0, ops: 0, hr: 0, legal: 0, data: 0, product: 0, executive: 0, ...counts,
});

/** A person with the given id and overrides (a 3/3 engineer unless told otherwise). */
export const person = (id: string, overrides: Partial<Employee> = {}): Employee =>
  makeEmployee({ id, name: `Person ${id.toUpperCase()}`, ...overrides });

/**
 * A playable state whose roster is exactly `employees` and whose `team` matches it (plus `extra` heads, which stay
 * unlisted only if they are fractional or past the cap). Reconcile is a no-op on the result unless `extra` adds whole heads.
 */
export const stateWith = (
  employees: Employee[],
  opts: { builds?: Build[]; extra?: Partial<TeamRoster>; overrides?: Partial<GameState> } = {},
): GameState => {
  const team = zeroTeam();
  for (const e of employees) team[e.role] += 1;
  for (const [role, n] of Object.entries(opts.extra ?? {})) team[role as keyof TeamRoster] += n ?? 0;
  const base = makeState({ team, lastWeek: { users: 90, mrr: 900, cash: 104_000, teamSize: employees.length }, ...opts.overrides });
  const builds = opts.builds ?? [];
  const s: GameState = {
    ...base,
    people: { ...emptyPeople(), roster: employees, nextId: 1 + Math.max(0, ...employees.map((e) => serialOf(e.id))) },
    product: { ...emptyProduct(), active: builds, nextId: 1 + Math.max(0, ...builds.map((b) => serialOf(b.id))) },
  };
  return reconcileRoster(s);
};

export const run = (s: GameState, input: string): ActionResult => executeCommand(s, input);
export const texts = (r: ActionResult): string[] => r.logs.map((l) => l.text);
export const errorOf = (r: ActionResult): string | null => {
  const e = r.logs.find((l) => l.kind === "error");
  return e && r.sound === undefined ? e.text : null;
};
export const find = (s: GameState, id: string): Employee | undefined => s.people?.roster.find((e) => e.id === id);

/**
 * Everything except the log counter, with derived numbers refreshed, for "nothing changed" assertions on refusals
 * (`err` refreshes burn and valuation, which the hand-built fixtures leave stale).
 */
export const sansLogSeq = (s: GameState): Omit<GameState, "logSeq"> => {
  const { logSeq, ...rest } = refreshDerivedNoLog(s);
  void logSeq;
  return rest;
};
