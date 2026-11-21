// Save migration check (spec §8, lifted from the prototype's migcheck.ts): v2 states produced by TODAY's engine (the
// pristine baseline checkout, read-only) are migrated with migrateState; burn must be unchanged to the dollar, every legacy
// field untouched, the migration idempotent, and the next choose/end identical to today's engine on every legacy field.
// Plus a normalizer fuzz: corrupted slices must never throw and must come out valid, before and after an `end`.
import { executeCommand as execB } from "../../src/engine/commands";
import { calcBurn as burnB } from "../../src/engine/economy";
import { migrateState, normalizeTycoon } from "../../src/engine/tycoon/migrate";
import { rosterInvariantHolds, wantOf } from "../../src/engine/tycoon/roster";
import { mulberry } from "../../src/engine/__golden__/legacyBots";
import type { GameState } from "../../src/types/game";
import { loadBaseline } from "./identity";
import { seededInitial } from "./bots";

const strip = (s: GameState): string => {
  const rest: Record<string, unknown> = { ...(s as unknown as Record<string, unknown>) };
  delete rest.people;
  delete rest.product;
  return JSON.stringify(rest);
};

export interface MigResult { saves: number; normalized: number; failures: number; messages: string[] }

export const runMigcheck = async (baselineDir: string, saves: number, corrupt: number): Promise<MigResult> => {
  const A = await loadBaseline(baselineDir);
  const res: MigResult = { saves: 0, normalized: 0, failures: 0, messages: [] };
  const fail = (m: string) => {
    res.failures += 1;
    if (res.messages.length < 10) res.messages.push(m);
  };
  for (let k = 0; k < saves; k++) {
    const seed = (k + 1) * 104729;
    let a = A.refresh({ ...A.init(), seed, rng: (seed ^ 0x9e3779b9) >>> 0, logSeq: 0 });
    const r = mulberry(seed);
    for (const c of ["name Old", "company OldCo", "founder hacker", "cofounder builder"]) a = A.exec(a, c).state;
    const stopAt = 3 + Math.floor(r() * 60);
    for (let w = 0; w < stopAt && !a.gameOver; w++) {
      for (let i = 0; i < 3 && !a.gameOver; i++) {
        if (a.pendingEvent) { a = A.exec(a, "choose 1").state; continue; }
        const runway = a.burn > 0 ? a.cash / a.burn : 99;
        const c = runway < 5 ? (a.investors.pipeline.length ? "raise vc 200000" : "pitch") : r() < 0.4 ? `hire ${["eng", "marketing", "ops", "ux 1.5", "sales 2"][Math.floor(r() * 5)]}` : r() < 0.5 ? `ship f${w}` : `launch c${w}`;
        a = A.exec(a, c).state;
      }
      // Leave a pending event in some saves: the migration must not resolve or reshape it.
      if (a.pendingEvent && r() < 0.7) a = A.exec(a, "choose 1").state;
      if (!a.gameOver && !a.pendingEvent) a = A.exec(a, "end").state;
    }
    if (a.gameOver) continue;
    const v2 = JSON.parse(JSON.stringify(a)) as GameState; // what localStorage holds
    const m = migrateState(v2, 2);
    res.saves += 1;
    if (!rosterInvariantHolds(m)) fail(`invariant seed ${seed}`);
    const heads = Object.values(m.team).reduce((x, n) => x + wantOf(n), 0);
    if (Math.min(120, heads) !== (m.people?.roster.length ?? -1)) fail(`roster ${m.people?.roster.length} vs heads ${heads}`);
    if (burnB(m) !== a.burn) fail(`burn ${burnB(m)} vs ${a.burn} seed ${seed}`);
    if (strip(m) !== strip(a)) fail(`migration changed a legacy field seed ${seed}`);
    if (JSON.stringify(migrateState(m, 3)) !== JSON.stringify(m)) fail(`not idempotent seed ${seed}`);
    const pa = a.pendingEvent ? A.exec(a, "choose 1").state : a;
    const pb = m.pendingEvent ? execB(m, "choose 1").state : m;
    if (strip(pa) !== strip(pb)) fail(`choose differs seed ${seed}`);
    const na = A.exec(pa, "end").state;
    const nb = execB(pb, "end").state;
    if (strip(na) !== strip(nb)) fail(`next week differs seed ${seed}`);
  }

  const r = mulberry(99);
  const junk = (): unknown => [null, undefined, 7, -1, 1.5, NaN, "x", [], {}, { id: "e1" }, true][Math.floor(r() * 11)];
  let base = seededInitial(5);
  for (const c of ["name A", "company C", "founder visionary", "cofounder operator", "hire eng 3", "build feature m Alpha", "recruit eng"]) base = execB(base, c).state;
  for (let i = 0; i < corrupt; i++) {
    const p = JSON.parse(JSON.stringify(base.people)) as Record<string, unknown>;
    const q = JSON.parse(JSON.stringify(base.product)) as Record<string, unknown>;
    const keysP = Object.keys(p);
    const keysQ = Object.keys(q);
    for (let j = 0; j < 3; j++) p[keysP[Math.floor(r() * keysP.length)]] = junk();
    for (let j = 0; j < 3; j++) q[keysQ[Math.floor(r() * keysQ.length)]] = junk();
    if (r() < 0.2 && Array.isArray(p.roster)) (p.roster as unknown[]).push(junk());
    if (r() < 0.2 && Array.isArray(q.active)) (q.active as unknown[]).push(junk());
    const s = { ...base, people: (r() < 0.1 ? junk() : p) as GameState["people"], product: (r() < 0.1 ? junk() : q) as GameState["product"] };
    try {
      const n = normalizeTycoon(s);
      if (!rosterInvariantHolds(n)) fail(`normalized invariant ${i}`);
      if (JSON.stringify(JSON.parse(JSON.stringify(n))) !== JSON.stringify(n)) fail(`normalized json ${i}`);
      const after = execB(n, "end").state;
      if (!rosterInvariantHolds(after)) fail(`after end invariant ${i}`);
      res.normalized += 1;
    } catch (e) {
      fail(`normalizer threw ${i}: ${(e as Error).message}`);
    }
  }
  return res;
};
