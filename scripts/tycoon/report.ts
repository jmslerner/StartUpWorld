// Aggregation of E4 rows (the prototype's agg.py, in TypeScript) and the acceptance thresholds T4-T11 (spec §10.4).
import type { Row } from "./runs";

export interface Summary {
  kind: string; n: number; ipo: number; ipoWeek: number; bank: number; zombie: number; removed: number;
  score: number; p50: number; p90: number; rel: number; rec: number; mix: Record<"breakout" | "solid" | "shrug" | "flop", number>;
  offers: number; retains: number; dep: number; recruits: number; dodges: number; mrr40: number; arpu40: number; cruft40: number;
  inv: number; bytes: number;
}

const q = (vals: number[], p: number): number => {
  if (vals.length === 0) return NaN;
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};
const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

export const summarize = (kind: string, rows: Row[]): Summary => {
  const n = rows.length;
  const ipo = rows.map((r) => r.ipo).filter((x): x is number => x !== null);
  const tiers = { breakout: 0, solid: 0, shrug: 0, flop: 0 };
  for (const r of rows) for (const [k, v] of Object.entries(r.tiers)) tiers[k as keyof typeof tiers] += v;
  const t = Math.max(1, tiers.breakout + tiers.solid + tiers.shrug + tiers.flop);
  const rel = rows.reduce((a, r) => a + r.releases, 0);
  const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
  const nn = (xs: Array<number | null>) => xs.filter((x): x is number => x !== null);
  return {
    kind, n,
    ipo: (100 * ipo.length) / n,
    ipoWeek: q(ipo, 0.5),
    bank: (100 * rows.filter((r) => r.end === "bankruptcy").length) / n,
    zombie: (100 * rows.filter((r) => r.end === "zombie-saas").length) / n,
    removed: (100 * rows.filter((r) => r.end === "founder-removal").length) / n,
    score: mean(rows.map((r) => r.score)),
    p50: q(rows.map((r) => r.score), 0.5),
    p90: q(rows.map((r) => r.score), 0.9),
    rel: rel / n,
    rec: sum((r) => r.reception) / Math.max(1, rel),
    mix: { breakout: (100 * tiers.breakout) / t, solid: (100 * tiers.solid) / t, shrug: (100 * tiers.shrug) / t, flop: (100 * tiers.flop) / t },
    offers: sum((r) => r.offers) / n,
    retains: sum((r) => r.retains) / n,
    dep: sum((r) => r.departures) / n,
    recruits: sum((r) => r.recruits) / n,
    dodges: sum((r) => r.dodges) / n,
    mrr40: q(nn(rows.map((r) => r.mrr40)), 0.5),
    arpu40: q(nn(rows.map((r) => r.arpu40)), 0.5),
    cruft40: q(nn(rows.map((r) => r.cruft40)), 0.5),
    inv: sum((r) => r.inv),
    bytes: Math.max(...rows.map((r) => r.bytes)),
  };
};

const f1 = (x: number): string => (Number.isNaN(x) ? "-" : x.toFixed(1));
const sg = (x: number): string => (Number.isNaN(x) ? "-" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}`);

export const table = (sums: Summary[], baseKind = "climber"): string => {
  const b = sums.find((s) => s.kind === baseKind);
  const head =
    "bot           n     IPO%   dIPO  wk50 ratio bank%  score dScore p50 p90  rel/run recep  B/S/Sh/F %       offers retain  dep  recr  mrr40    arpu40 cruft40 inv bytes";
  const lines = sums.map((s) => {
    const ratio = b && !Number.isNaN(b.ipoWeek) && !Number.isNaN(s.ipoWeek) ? s.ipoWeek / b.ipoWeek : NaN;
    const mix = `${Math.round(s.mix.breakout)}/${Math.round(s.mix.solid)}/${Math.round(s.mix.shrug)}/${Math.round(s.mix.flop)}`;
    return [
      s.kind.padEnd(13), String(s.n).padStart(4), f1(s.ipo).padStart(7), sg(b ? s.ipo - b.ipo : 0).padStart(6), String(s.ipoWeek).padStart(5),
      (Number.isNaN(ratio) ? "-" : ratio.toFixed(2)).padStart(5), f1(s.bank).padStart(5), f1(s.score).padStart(6), sg(b ? s.score - b.score : 0).padStart(6),
      String(s.p50).padStart(4), String(s.p90).padStart(3), f1(s.rel).padStart(8), f1(s.rec).padStart(6), mix.padStart(14),
      s.offers.toFixed(2).padStart(9), s.retains.toFixed(2).padStart(6), s.dep.toFixed(2).padStart(5), f1(s.recruits).padStart(5),
      String(s.mrr40).padStart(8), String(s.arpu40).padStart(8), f1(s.cruft40).padStart(7), String(s.inv).padStart(4), String(s.bytes).padStart(6),
    ].join(" ");
  });
  return [head, ...lines].join("\n");
};

/** `info` = a diagnostic printed for the record (no band; never fails the run). */
export interface Check { id: string; label: string; pass: boolean; detail: string; info?: boolean }

/** T4-T11 (and the invariant). A check whose bots were not run is skipped, not failed. */
export const thresholds = (sums: Summary[]): Check[] => {
  const by = (k: string) => sums.find((s) => s.kind === k);
  const out: Check[] = [];
  const add = (id: string, label: string, pass: boolean, detail: string) => out.push({ id, label, pass, detail });
  const climber = by("climber");
  const skilled = by("skilled");
  if (climber && skilled) {
    const dIpo = skilled.ipo - climber.ipo;
    const ratio = skilled.ipoWeek / climber.ipoWeek;
    const dScore = skilled.score - climber.score;
    add("T4", "skilled vs climber: IPO +3..+8", dIpo >= 3 && dIpo <= 8, sg(dIpo));
    add("T4", "skilled vs climber: median IPO week 0.80-0.95x", ratio >= 0.8 && ratio <= 0.95, ratio.toFixed(3));
    add("T4", "skilled vs climber: mean score +2..+7", dScore >= 2 && dScore <= 7, sg(dScore));
    add("T4", "skilled vs climber: p50 and p90 score at most +3", skilled.p50 - climber.p50 <= 3 && skilled.p90 - climber.p90 <= 3, `${sg(skilled.p50 - climber.p50)} / ${sg(skilled.p90 - climber.p90)}`);
  }
  const naive = by("naive");
  if (climber && naive) {
    add("T5", "naive vs climber: IPO within +-2.5", Math.abs(naive.ipo - climber.ipo) <= 2.5, sg(naive.ipo - climber.ipo));
    add("T5", "naive vs climber: mean score within +-2.5", Math.abs(naive.score - climber.score) <= 2.5, sg(naive.score - climber.score));
  }
  if (skilled) {
    for (const k of ["crunch", "rush"]) {
      const b = by(k);
      if (!b) continue;
      add("T6", `${k} vs skilled: IPO at most 10 lower`, skilled.ipo - b.ipo <= 10, sg(b.ipo - skilled.ipo));
      add("T6", `${k} vs skilled: bankruptcy at most 3 higher`, b.bank - skilled.bank <= 3, sg(b.bank - skilled.bank));
    }
    for (const k of ["small", "polish0", "no-retain", "retain-lead", "retain-all", "crunch", "rush", "late-staff", "late-staff-cap", "lead-dodge"]) {
      const b = by(k);
      if (!b) continue;
      add("T7", `${k} vs skilled: mean score at most +1.0`, b.score - skilled.score <= 1.0, sg(b.score - skilled.score));
      add("T7", `${k} vs skilled: median IPO week at most 2 sooner`, skilled.ipoWeek - b.ipoWeek <= 2, `${b.ipoWeek} vs ${skilled.ipoWeek}`);
    }
  }
  const recruitOnly = by("recruit-only");
  if (climber && recruitOnly) add("T7", "recruit-only vs climber: IPO within +-2", Math.abs(recruitOnly.ipo - climber.ipo) <= 2, sg(recruitOnly.ipo - climber.ipo));
  const noRetain = by("no-retain");
  const dodge = by("lead-dodge");
  if (noRetain && dodge) add("T7", "lead-dodge vs no-retain: mean score at most +0.3", dodge.score - noRetain.score <= 0.3, sg(dodge.score - noRetain.score));
  const cEnt = by("climber-ent");
  const sEnt = by("skilled-ent");
  if (climber && skilled && cEnt && sEnt) {
    const gEnt = sEnt.ipo - cEnt.ipo;
    const g = skilled.ipo - climber.ipo;
    add("T8", "(skilled-ent - climber-ent) IPO gain <= (skilled - climber) + 2", gEnt <= g + 2, `${sg(gEnt)} <= ${sg(g + 2)}`);
  }
  if (skilled) add("T9", "skilled: flop <= 5%, breakout 10-30%", skilled.mix.flop <= 5 && skilled.mix.breakout >= 10 && skilled.mix.breakout <= 30, `flop ${f1(skilled.mix.flop)}% breakout ${f1(skilled.mix.breakout)}%`);
  if (naive) add("T9", "naive: flop 5-20%, breakout <= 5%", naive.mix.flop >= 5 && naive.mix.flop <= 20 && naive.mix.breakout <= 5, `flop ${f1(naive.mix.flop)}% breakout ${f1(naive.mix.breakout)}%`);
  if (skilled) add("T10", "skilled: departures per run <= 1.5", skilled.dep <= 1.5, skilled.dep.toFixed(2));
  if (noRetain) add("T10", "no-retain: departures per run >= 3", noRetain.dep >= 3, noRetain.dep.toFixed(2));
  const crunch = by("crunch");
  if (crunch) add("T10", "crunch: departures per run >= 8", crunch.dep >= 8, crunch.dep.toFixed(2));
  // Diagnostics without a spec band (lead-engineer review follow-up, TUNING.md): the exploits review's rush trap.
  const ship60 = by("naive-ship60");
  if (climber && ship60) {
    out.push({ id: "D1", label: "naive-ship60 vs climber (diagnostic: rush trap)", pass: true, info: true, detail: `IPO ${sg(ship60.ipo - climber.ipo)}, score ${sg(ship60.score - climber.score)}, bankrupt ${sg(ship60.bank - climber.bank)}, cruft40 ${f1(ship60.cruft40)}` });
  }
  const maxBytes = Math.max(...sums.map((s) => s.bytes));
  add("T11", "both slices <= 48 KB at every checkpoint", maxBytes <= 48 * 1024, `${maxBytes} B`);
  const inv = sums.reduce((a, s) => a + s.inv, 0);
  add("G2", "roster invariant after every bot week", inv === 0, `${inv} breaks`);
  return out;
};

/**
 * Pricing and founder balance (B1-B3): no pricing model or founder archetype dominates competent play, and each pricing
 * model keeps the risk its description promises (enterprise "hard to kill", consumer "churn is brutal").
 */
export const balanceChecks = (rows: Map<string, Row[]>): Check[] => {
  const out: Check[] = [];
  const add = (id: string, label: string, pass: boolean, detail: string) => out.push({ id, label, pass, detail });
  const climber = rows.get("climber");
  if (!climber) return out;
  const base = summarize("climber", climber);
  for (const [k, model] of [["climber-ent", "enterprise"], ["climber-con", "consumer"]] as const) {
    const rs = rows.get(k);
    if (!rs) continue;
    const s = summarize(k, rs);
    add("B1", `${model} vs prosumer (climber): IPO within +-5, score within +-3`, Math.abs(s.ipo - base.ipo) <= 5 && Math.abs(s.score - base.score) <= 3, `IPO ${sg(s.ipo - base.ipo)}, score ${sg(s.score - base.score)}`);
    const safer = model === "enterprise" ? s.bank < base.bank : s.bank > base.bank;
    add("B2", `${model} vs prosumer (climber): bankruptcy ${model === "enterprise" ? "lower" : "higher"}`, safer, `${f1(s.bank)}% vs ${f1(base.bank)}%`);
  }
  const ipoOf = (rs: Row[]) => (100 * rs.filter((r) => r.ipo !== null).length) / Math.max(1, rs.length);
  const perFounder = FOUNDERS.map((f) => ipoOf(climber.filter((r) => r.founder === f)));
  const spread = Math.max(...perFounder) - Math.min(...perFounder);
  add("B3", "climber: founder archetypes' IPO within 10 points of each other", spread <= 10, FOUNDERS.map((f, i) => `${f} ${f1(perFounder[i])}`).join(", "));
  return out;
};

export const checkLines = (checks: Check[]): string =>
  checks.map((c) => `${c.info ? "INFO" : c.pass ? "PASS" : "FAIL"}  ${c.id.padEnd(4)} ${c.label.padEnd(66)} ${c.detail}`).join("\n");

const FOUNDERS = ["hacker", "visionary", "sales-animal", "philosopher"];

/** IPO-point difference against `base` per founder archetype (paired seeds), for the bots given: a diagnostic, no band. */
export const byFounder = (rows: Map<string, Row[]>, kinds: string[], base = "climber"): string => {
  const ipoOf = (rs: Row[]) => (rs.length ? (100 * rs.filter((r) => r.ipo !== null).length) / rs.length : NaN);
  const baseRows = rows.get(base) ?? [];
  const out = [`IPO points vs ${base}, by founder (diagnostic):`.padEnd(46) + FOUNDERS.map((f) => f.padStart(13)).join("")];
  for (const k of kinds) {
    const rs = rows.get(k);
    if (!rs || baseRows.length === 0) continue;
    out.push(`  ${k}`.padEnd(46) + FOUNDERS.map((f) => sg(ipoOf(rs.filter((r) => r.founder === f)) - ipoOf(baseRows.filter((r) => r.founder === f))).padStart(13)).join(""));
  }
  return out.join("\n");
};
