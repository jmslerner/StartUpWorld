// Test support for src/engine/projects/*.test.ts. Never imported by production code.
import type { ActionResult, Build, Employee, GameState } from "../../types/game";
import { executeCommand } from "../commands";
import { makeBuild, makeEmployee, makeState } from "../testHelpers";
import { countByRole, serialOf, setPeople, setProduct, withSlices } from "../tycoon/roster";

const FIRST = ["", "Lotte", "Mei", "Hiro", "Leila", "Nadia", "Petra", "Anouk", "Amara", "Dmitri", "Sofia", "Ivo", "Oskar", "Freya", "Kofi", "Wren"];
const LAST = ["", "Zhao", "Kowalski", "Fontaine", "Demir", "Nkosi", "Sato", "Ito", "Nwosu", "Castillo", "Vogel", "Tanaka", "Pike", "Berg", "Mensah", "Roth"];

/** A person with serial `n`, a distinct name, standard 3/3 engineering unless overridden. */
export const person = (n: number, overrides: Partial<Employee> = {}): Employee =>
  makeEmployee({ id: `e${n}`, name: `${FIRST[n] ?? `P${n}`} ${LAST[n] ?? "Test"}`, ...overrides });

/** A build, staffed by nobody, kicked off in week 1. */
export const build = (overrides: Partial<Build> = {}): Build => makeBuild(overrides);

export interface ShopOptions extends Partial<GameState> {
  roster?: Employee[];
  builds?: Build[];
}

/**
 * makeState() with both slices, the given roster (team = exactly its role counts, so reconcile is a no-op) and the given
 * active builds. Setup is complete (makeState's founder is a hacker, the cofounder an operator).
 */
export const shop = (opts: ShopOptions = {}): GameState => {
  const { roster = [], builds = [], ...overrides } = opts;
  const counts = countByRole(roster);
  let s = withSlices(makeState({ ...overrides, team: { ...counts, ...(overrides.team ?? {}) } }));
  const maxSerial = roster.reduce((m, e) => Math.max(m, serialOf(e.id)), 0);
  s = setPeople(s, { roster, nextId: maxSerial + 1 });
  const maxBuild = builds.reduce((m, b) => Math.max(m, serialOf(b.id)), 0);
  s = setProduct(s, { active: builds, nextId: maxBuild + 1 });
  return { ...s, lastWeek: { ...s.lastWeek, teamSize: roster.length } };
};

/** Puts people on a build (sets buildId, joinedWeek and engaged directly; tests only). */
export const staffed = (people: Employee[], buildId: string, joinedWeek = 1): Employee[] =>
  people.map((e) => ({ ...e, buildId, joinedWeek, engaged: true }));

export const run = (state: GameState, input: string): ActionResult => executeCommand(state, input);
export const texts = (r: ActionResult): string[] => r.logs.map((l) => l.text);
export const lines = (state: GameState, input: string): string[] => texts(run(state, input));

/** A refusal: exactly one error line, no sound (the 3D layer's `rejected`). */
export const isRefusal = (r: ActionResult): boolean => r.sound === undefined && r.logs.length === 1 && r.logs[0].kind === "error";

/** The refusal text, or a marker that makes the assertion fail readably. */
export const refusal = (state: GameState, input: string): string => {
  const r = run(state, input);
  return isRefusal(r) ? r.logs[0].text : `NOT REFUSED: ${texts(r).join(" | ")}`;
};

/** Everything but logSeq: what a refusal must leave untouched. */
export const sansLogSeq = (s: GameState): Omit<GameState, "logSeq"> => {
  const { logSeq: _ignored, ...rest } = s;
  void _ignored;
  return rest;
};
