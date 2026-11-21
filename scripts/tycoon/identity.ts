// E2 — lockstep legacy identity (spec §10.3, lifted from the prototype's identity.ts).
// Engine A = a pristine checkout of the pre-tycoon commit (read-only), engine B = this worktree. Both run the same legacy
// commands (state A drives the choice); the WHOLE GameState minus the two slices, the log count and the sound are compared
// after EVERY command, and the roster invariant is checked on B after every command.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { executeCommand as execB } from "../../src/engine/commands";
import { createInitialState as initB } from "../../src/engine/actions";
import { refreshDerivedNoLog as refreshB } from "../../src/engine/derived";
import { rosterInvariantHolds } from "../../src/engine/tycoon/roster";
import { mulberry } from "../../src/engine/__golden__/legacyBots";
import type { ActionResult, GameState } from "../../src/types/game";
import { COFOUNDERS, FOUNDERS } from "./runs";

export interface Engine {
  exec: (s: GameState, input: string) => ActionResult;
  init: () => GameState;
  refresh: (s: GameState) => GameState;
}

export const loadBaseline = async (dir: string): Promise<Engine> => {
  const at = (p: string) => pathToFileURL(resolve(dir, p)).href;
  const commands = (await import(at("src/engine/commands.ts"))) as { executeCommand: Engine["exec"] };
  const actions = (await import(at("src/engine/actions.ts"))) as { createInitialState: Engine["init"] };
  const derived = (await import(at("src/engine/derived.ts"))) as { refreshDerivedNoLog: Engine["refresh"] };
  return { exec: commands.executeCommand, init: actions.createInitialState, refresh: derived.refreshDerivedNoLog };
};

const softCap: Record<string, number> = { garage: 250_000, seed: 2_500_000, "series-a": 12_000_000, growth: 60_000_000 };
const floorOf: Record<string, number> = { garage: 2_000_000, seed: 12_000_000, "series-a": 60_000_000, growth: 250_000_000 };

const strip = (s: GameState): string => {
  const rest: Record<string, unknown> = { ...(s as unknown as Record<string, unknown>) };
  delete rest.people;
  delete rest.product;
  return JSON.stringify(rest);
};

const pickHireRole = (s: GameState): string => {
  const { engineering: eng, design, ops, marketing: mkt, sales } = s.team;
  const exec = eng + design + ops;
  const gtm = mkt + sales;
  if (gtm > exec) return ops < Math.ceil(gtm / 2) ? "ops" : "engineering";
  if (eng < 3) return "engineering";
  if (mkt < 2) return "marketing";
  if (sales < 2) return "sales";
  if (ops < 2) return "ops";
  return s.week % 2 === 0 ? "engineering" : "marketing";
};

/** Next legacy command for state A (§10.3: `wide` types everything the stock bot never does). */
const nextCommand = (s: GameState, kind: string, r: () => number, i: number): string => {
  if (s.pendingEvent) return kind === "wide" ? `choose ${1 + Math.floor(r() * s.pendingEvent.choices.length)}` : "choose 1";
  const runway = s.burn > 0 ? Math.floor(s.cash / Math.max(1, s.burn)) : 999;
  const v = Math.max(s.valuation, floorOf[s.stage]);
  if (kind === "wide") {
    const x = r();
    if (x < 0.04) return `hire ux ${[1.5, 0.5, 2.5][Math.floor(r() * 3)]}`;
    if (x < 0.08) return `hire ${["hr", "legal", "data", "product", "executive", "ops"][Math.floor(r() * 6)]} ${1 + Math.floor(r() * 3)}`;
    if (x < 0.1) return `pricing ${["consumer", "prosumer", "enterprise"][Math.floor(r() * 3)]}`;
    if (x < 0.13) return `board dinner ${["a", "e", "i", "o"][Math.floor(r() * 4)]}`;
    if (x < 0.15) return `buy ${["office", "lounge", "helicopter"][Math.floor(r() * 3)]}`;
    if (x < 0.19) return `raise ${["friends", "cards", "loan", "preseed", "mortgage"][Math.floor(r() * 5)]}`;
    if (x < 0.21) return "status";
    if (x < 0.23) return `hire eng ${5 + Math.floor(r() * 40)}`;
    if (x < 0.25 && s.stage === "garage" && v >= 5_000_000) return "raise vc 500000";
    if (x < 0.27 && s.stage === "seed") return "raise vc 5000000";
    if (x < 0.29 && s.stage === "series-a") return "raise vc 25000000";
    if (x < 0.3) return "fire";
    if (x < 0.31) return "ship";
    if (x < 0.32) return "help";
  }
  if (runway <= 4) {
    if (s.investors.pipeline.length === 0) return "pitch";
    return `raise vc ${Math.min(softCap[s.stage], Math.max(50_000, Math.round((v * 0.15) / 1000) * 1000))}`;
  }
  if (s.investors.pipeline.length < 2 && s.week % 3 === 0) return "pitch";
  if (runway >= 8 && s.cash >= 6000) return `hire ${pickHireRole(s)} 1`;
  return s.week % 2 === 1 ? `ship feature-w${s.week}-a${s.ap}-${i}` : `launch campaign-w${s.week}`;
};

export interface IdentityResult { variant: string; runs: number; weeks: number; commands: number; mismatches: number; invariantBreaks: number; maxHeads: number; maxRoster: number }

export const runIdentity = async (baselineDir: string, runsPerPair: number, maxWeek: number, variant: string): Promise<IdentityResult> => {
  const A = await loadBaseline(baselineDir);
  const res: IdentityResult = { variant, runs: 0, weeks: 0, commands: 0, mismatches: 0, invariantBreaks: 0, maxHeads: 0, maxRoster: 0 };
  for (const f of FOUNDERS) {
    for (const c of COFOUNDERS) {
      for (let i = 0; i < runsPerPair; i++) {
        const seed = (((i + 1) * 2654435761) ^ (f.length * 97) ^ (c.length * 193)) >>> 0;
        res.runs += 1;
        let a = A.refresh({ ...A.init(), seed, rng: (seed ^ 0x9e3779b9) >>> 0, logSeq: 0 });
        let b = refreshB({ ...initB(), seed, rng: (seed ^ 0x9e3779b9) >>> 0, logSeq: 0 });
        const r = mulberry(seed ^ 0x1234567);
        const both = (input: string): boolean => {
          const ra = A.exec(a, input);
          const rb = execB(b, input);
          a = ra.state;
          b = rb.state;
          res.commands += 1;
          // `help` and bare `fire` gained text (new help lines, the fire usage line) but change no state.
          const sameLogs = ra.logs.length === rb.logs.length || input === "help" || input === "fire";
          if (!sameLogs || strip(a) !== strip(b) || ra.sound !== rb.sound) {
            res.mismatches += 1;
            if (res.mismatches <= 3) {
              const ja = JSON.parse(strip(a)) as Record<string, unknown>;
              const jb = JSON.parse(strip(b)) as Record<string, unknown>;
              const keys = Object.keys(ja).filter((k) => JSON.stringify(ja[k]) !== JSON.stringify(jb[k]));
              console.log(`MISMATCH seed=${seed} ${f}+${c} week=${a.week} cmd="${input}" keys=${keys.join(",")} logs ${ra.logs.length}/${rb.logs.length}`);
            }
            return false;
          }
          if (!rosterInvariantHolds(b)) {
            res.invariantBreaks += 1;
            if (res.invariantBreaks <= 3) console.log(`INVARIANT seed=${seed} week=${b.week} cmd="${input}"`);
          }
          return true;
        };
        let ok = true;
        for (const setup of ["name Sim", "company SimCo", `founder ${f}`, `cofounder ${c}`]) if (ok) ok = both(setup);
        for (let w = 0; ok && w < maxWeek && !a.gameOver; w++) {
          for (let k = 0; ok && k < 8 && a.ap > 0 && !a.gameOver; k++) ok = both(nextCommand(a, variant, r, k));
          if (!ok || a.gameOver) break;
          if (a.pendingEvent) {
            ok = both(nextCommand(a, variant, r, 0));
            if (!ok || a.gameOver) break;
          }
          ok = both("end");
          res.weeks += 1;
          res.maxHeads = Math.max(res.maxHeads, Object.values(b.team).reduce((x, n) => x + n, 0));
          res.maxRoster = Math.max(res.maxRoster, b.people?.roster.length ?? 0);
        }
      }
    }
  }
  return res;
};
