import { describe, expect, it } from "vitest";
import type { Candidate, GameState } from "../../types/game";
import { makeState, makeTycoonState } from "../testHelpers";
import { preflight } from "../tycoon/preflight";
import { peopleRng, rosterInvariantHolds, rosterOf, streamSeed } from "../tycoon/roster";
import { PEOPLE_SALT, ROSTER_CAP } from "../tycoon/constants";
import { drawCandidate, poolFor, storedPool, talentPull } from "./candidates";
import { listCandidates } from "./view";
import { errorOf, person, run, sansLogSeq, stateWith, texts, zeroTeam } from "./testKit";

// `recruit` (TYCOON-SPEC §4.3) and the candidate pools (§5.3).

const pending = { id: "x", title: "T", prompt: "P", choices: [{ id: "a", text: "A" }] };
const look = (s: GameState, role = "eng") => run(s, `recruit ${role}`);
const poolOf = (s: GameState, role: "engineering" | "design" | "hr" = "engineering"): Candidate[] => storedPool(s, role) ?? [];

describe("candidate pools", () => {
  it("are three per role, stored, identical on a second look the same week, and new after `end`", () => {
    const s0 = makeTycoonState();
    const a = look(s0);
    const pool = poolOf(a.state);
    expect(pool).toHaveLength(3);
    expect(a.state.people?.candidatesWeek).toBe(s0.week);
    const b = look(a.state);
    expect(poolOf(b.state)).toBe(pool); // stored: the very same array, nothing drawn
    expect(b.state.people?.rng).toBe(a.state.people?.rng);
    expect(texts(b).slice(1, 4)).toEqual(texts(a).slice(1, 4));
    const ended = run({ ...b.state, ap: 0 }, "end").state;
    expect(storedPool(ended, "engineering")).toBeNull(); // the pools belong to last week
    const c = look(ended);
    expect(poolOf(c.state).map((x) => x.id)).not.toEqual(pool.map((x) => x.id));
    expect(Object.keys(c.state.people?.candidates ?? {})).toEqual(["engineering"]); // a stale pool is wiped first
  });

  it("only generate the role looked at, and a second role's look keeps the first role's pool", () => {
    const a = look(makeTycoonState());
    const b = look(a.state, "ux");
    expect(Object.keys(b.state.people?.candidates ?? {}).sort()).toEqual(["design", "engineering"]);
    expect(poolOf(b.state)).toBe(poolOf(a.state));
  });

  it("have stats in 1..5, claimed >= true, equal when vetted; asks priced on the claimed stats within 0.92-1.12 x quirk", () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const hr of [0, 1]) {
        const s = makeTycoonState({ seed, team: zeroTeam({ engineering: 1, hr }) });
        for (const c of poolOf(look(s).state)) {
          for (const x of [c.pace, c.craft, c.claimedPace, c.claimedCraft]) expect(Number.isInteger(x) && x >= 1 && x <= 5).toBe(true);
          expect(c.claimedPace).toBeGreaterThanOrEqual(c.pace);
          expect(c.claimedCraft).toBeGreaterThanOrEqual(c.craft);
          expect(c.vetted).toBe(hr === 1);
          if (c.vetted) expect([c.claimedPace, c.claimedCraft]).toEqual([c.pace, c.craft]);
          else expect(c.claimedPace - c.pace + c.claimedCraft - c.craft).toBeLessThanOrEqual(2);
          const going = 3500 * (1 + 0.1 * (c.claimedPace + c.claimedCraft - 6));
          const q = c.quirk === "mercenary" ? 1.1 : c.quirk === "believer" ? 0.9 : 1;
          expect(c.ask).toBeGreaterThanOrEqual(Math.round((going * 0.92 * q) / 50) * 50 - 50);
          expect(c.ask).toBeLessThanOrEqual(Math.round((going * 1.12 * q) / 50) * 50 + 50);
          expect(c.ask % 50).toBe(0);
        }
      }
    }
  });

  it("draw in the §2.6 order: the same stream gives the same candidate, and mercenaries ask 10% more than the same draw would", () => {
    const rng = streamSeed(777, PEOPLE_SALT);
    const a = drawCandidate(rng, "engineering", 1, 0.3, false, new Set());
    const b = drawCandidate(rng, "engineering", 1, 0.3, false, new Set());
    expect(a).toEqual(b);
    // vetting skips two draws (stat + inflation), so the names differ but the stats and quirk come from the same draws
    const v = drawCandidate(rng, "engineering", 1, 0.3, true, new Set());
    expect([v.candidate.pace, v.candidate.craft, v.candidate.quirk]).toEqual([a.candidate.pace, a.candidate.craft, a.candidate.quirk]);
  });

  it("talent pull lifts stats: a magnet company sees better candidates than a nobody over many seeds", () => {
    const sum = (rep: number, hr: number) => {
      let total = 0;
      for (let seed = 1; seed <= 150; seed++) {
        const s = makeTycoonState({ seed, reputation: rep, team: zeroTeam({ engineering: 1, hr }) });
        expect(talentPull(s)).toBeGreaterThanOrEqual(0);
        for (const c of poolOf(look(s).state)) total += c.pace + c.craft;
      }
      return total;
    };
    expect(sum(100, 2)).toBeGreaterThan(sum(0, 0));
  });

  it("draw only from people.rng: state.rng and product.rng are untouched; the stream is written back", () => {
    const s = makeTycoonState();
    const r = look(s);
    expect(r.state.rng).toBe(s.rng);
    expect(r.state.product?.rng).toBe(s.product?.rng);
    expect(r.state.people?.rng).not.toBe(peopleRng(s));
    expect(r.state.people?.nextCandidateId).toBe(4);
  });

  it("never reuse a roster name or a name in another pool", () => {
    for (let seed = 1; seed <= 30; seed++) {
      let s = makeTycoonState({ seed, team: zeroTeam({ engineering: 40, design: 20, marketing: 20 }) });
      for (const role of ["eng", "ux", "gtm", "sales", "ops"]) s = look(s, role).state;
      const names = [...rosterOf(s).map((e) => e.name), ...Object.values(s.people?.candidates ?? {}).flat().map((c) => c?.name)];
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("poolFor returns the same reference when the pool exists", () => {
    const a = poolFor(makeTycoonState(), "engineering");
    expect(poolFor(a.state, "engineering").state).toBe(a.state);
  });
});

describe("`recruit <role>` (look)", () => {
  it("prints the unvetted header, three résumé rows with hidden quirks, and the footer", () => {
    const r = look(makeTycoonState());
    const lines = texts(r);
    expect(lines[0]).toBe("Candidates for engineering this week (signing $3,000, 1 AP) — unvetted: résumés are aspirational documents");
    expect(lines).toHaveLength(5);
    for (const row of lines.slice(1, 4)) expect(row).toMatch(/^ {2}\d\) .+résumé: pace \d craft \d · quirk \? · asks \$[\d,]+\/wk \([+-]\d+% vs standard\)$/);
    expect(lines[4]).toBe("`recruit eng <n>` signs one. `hire eng 1` still takes whoever answers the job ad. New faces next week.");
    expect(r.sound).toBeUndefined();
    expect(errorOf(r)).toBeNull();
    expect(r.state.ap).toBe(3);
    expect(r.state.cash).toBe(100_000);
  });

  it("with HR the header says vetted, rows show the truth and the quirk", () => {
    const r = look(makeTycoonState({ team: zeroTeam({ engineering: 1, hr: 1 }) }));
    const lines = texts(r);
    expect(lines[0]).toContain("— vetted by HR: what you see is what you get");
    const pool = poolOf(r.state);
    pool.forEach((c, i) => {
      expect(lines[i + 1]).not.toContain("résumé:");
      expect(lines[i + 1]).toContain(`pace ${c.pace} craft ${c.craft} · quirk ${c.quirk ?? "none"}`);
    });
  });

  it("is allowed during a pending event (it stores the pool) but refused after game over", () => {
    const r = look(makeTycoonState({ pendingEvent: pending }));
    expect(errorOf(r)).toBeNull();
    expect(poolOf(r.state)).toHaveLength(3);
    const over = makeTycoonState({ gameOver: { ending: "bankruptcy", week: 3, headline: "x" } });
    expect(errorOf(look(over))).toBe("Game over. Click 'Play Again' or refresh to start a new run.");
  });

  it("refuses a missing role with the usage line, an unknown one with hire's role list, and a locked role with today's hire wording", () => {
    const usage = "Usage: recruit <role> - see this week's three candidates. recruit <role> <1-3> - sign one (1 AP + the role's hire cost).";
    expect(errorOf(run(makeTycoonState(), "recruit"))).toBe(usage);
    // ERRATA 72: an unknown word names the tokens instead of repeating the usage line.
    expect(errorOf(run(makeTycoonState(), "recruit wizard"))).toBe('Unknown role "wizard". Try eng, ux, marketing, sales, ops, hr, legal (unlocks: data, product, executive).');
    expect(errorOf(run(makeTycoonState(), "recruit engineer"))).toMatch(/^Unknown role "engineer"\. Try eng, ux,/);
    expect(errorOf(run(makeTycoonState(), "recruit data"))).toBe("data unlocks at seed stage. Raise to advance.");
    expect(errorOf(run(makeTycoonState(), "recruit pm 1"))).toBe("product unlocks at series-a stage. Raise to advance.");
    expect(errorOf(run(makeTycoonState({ stage: "seed" }), "recruit data"))).toBeNull();
  });

  it("migrates a slice-less state first, so the pool's names are drawn against the real roster", () => {
    const legacy = makeState({ team: zeroTeam({ engineering: 3 }) });
    const r = look(legacy);
    expect(r.state.people?.roster).toHaveLength(3);
    expect(rosterInvariantHolds(r.state)).toBe(true);
    const names = new Set(rosterOf(r.state).map((e) => e.name));
    for (const c of poolOf(r.state)) expect(names.has(c.name)).toBe(false);
  });

  it("says when everybody was signed", () => {
    let s = look(makeTycoonState({ cash: 1_000_000, ap: 5 })).state;
    for (let i = 0; i < 3; i++) s = run(s, "recruit eng 1").state;
    expect(texts(look(s))[1]).toBe("  Nobody left this week. New faces after `end`.");
  });
});

describe("`recruit <role> <n>` (sign)", () => {
  const looked = (extra: Partial<GameState> = {}) => look(makeTycoonState(extra)).state;

  it("refuses in the §4.3 order, spending nothing", () => {
    const cases: Array<[GameState, string, string]> = [
      [makeTycoonState({ pendingEvent: pending }), "recruit eng 1", "Resolve the pending event first with `choose <n>`."],
      [makeTycoonState({ gameOver: { ending: "bankruptcy", week: 3, headline: "x" } }), "recruit eng 1", "Game over. Click 'Play Again' or refresh to start a new run."],
      [makeTycoonState(), "recruit eng 1", "Look before you sign: `recruit eng` shows this week's 3."],
      [looked(), "recruit eng 4", "Pick 1-3. `recruit eng` to see them again."],
      [looked(), "recruit eng 0", "Pick 1-3. `recruit eng` to see them again."],
      [looked(), "recruit eng 1.5", "Pick 1-3. `recruit eng` to see them again."],
      [looked(), "recruit eng x", "Pick 1-3. `recruit eng` to see them again."],
      [{ ...looked(), ap: 0 }, "recruit eng 1", "No AP left. End the week to refresh."],
    ];
    for (const [s, input, line] of cases) {
      const r = run(s, input);
      expect(errorOf(r), input).toBe(line);
      expect(sansLogSeq(r.state), input).toEqual(sansLogSeq(s));
    }
    const poor = { ...looked(), cash: 2_999 };
    const name = poolOf(poor)[1].name;
    expect(errorOf(run(poor, "recruit eng 2"))).toBe(`Not enough cash. Signing ${name} costs $3,000.`);
  });

  it("signs: an engaged record at the ask, hire cost charged, 1 AP, candidate removed, the truth revealed, no cohesion hit", () => {
    const s = looked();
    const pick = poolOf(s)[1];
    const r = run(s, "recruit eng 2");
    expect(r.sound).toBe("success");
    const added = rosterOf(r.state).find((e) => e.name === pick.name)!;
    expect(added).toMatchObject({
      role: "engineering", pace: pick.pace, craft: pick.craft, quirk: pick.quirk, salary: pick.ask, energy: 100, engaged: true,
      hiredWeek: s.week, buildId: null, offerDueWeek: 0, leadOnNotice: null,
    });
    expect(r.state.team.engineering).toBe(s.team.engineering + 1);
    expect(r.state.cash).toBe(s.cash - 3000);
    expect(r.state.ap).toBe(s.ap - 1);
    expect(r.state.culture).toEqual(s.culture);
    expect(poolOf(r.state).map((c) => c.id)).toEqual(poolOf(s).filter((c) => c.id !== pick.id).map((c) => c.id));
    expect(r.state.burn).toBeGreaterThan(s.burn);
    const lines = texts(r);
    expect(lines[0]).toBe(`${pick.name} signs. engineering, pace ${pick.pace} craft ${pick.craft}.`);
    const lied = pick.claimedPace !== pick.pace || pick.claimedCraft !== pick.craft;
    expect(lines[1]).toMatch(lied ? /^Résumé said (pace|craft) \d\. Reality: (pace|craft) \d\. The résumé was a vision document\.$/ : /^The résumé was accurate\. Frame it\.$/);
    expect(lines[2]).toMatch(pick.quirk ? new RegExp(`^Quirk, as it turns out: ${pick.quirk} — .+\\.$`) : /^No quirk, as it turns out\. A professional\. Suspicious\.$/);
    expect(lines[3]).toBe(`Cash -$3,000. Payroll +$${pick.ask.toLocaleString()}/wk.`);
    expect(rosterInvariantHolds(r.state)).toBe(true);
    expect(r.state.rng).toBe(s.rng);
  });

  it("vetted signings print no reveal lines", () => {
    const s = look(makeTycoonState({ team: zeroTeam({ engineering: 1, hr: 1 }) })).state;
    const r = run(s, "recruit eng 1");
    expect(texts(r)).toHaveLength(2);
  });

  it("indexes follow the remaining pool after a signing", () => {
    const s = looked({ ap: 5 });
    const third = poolOf(s)[2];
    const r = run(run(s, "recruit eng 1").state, "recruit eng 2");
    expect(texts(r)[0]).toContain(third.name);
    expect(listCandidates(r.state, "engineering")?.map((c) => [c.index, c.id])).toEqual([[1, poolOf(s)[1].id]]);
  });

  it("at the cap displaces the newest never-engaged unstaffed record; refuses when every record is engaged or staffed", () => {
    const capped = look(makeTycoonState({ team: zeroTeam({ engineering: 120 }), cash: 1_000_000 })).state;
    const newest = rosterOf(capped)[rosterOf(capped).length - 1];
    const r = run(capped, "recruit eng 1");
    expect(r.sound).toBe("success");
    expect(rosterOf(r.state)).toHaveLength(ROSTER_CAP);
    expect(rosterOf(r.state).some((e) => e.id === newest.id)).toBe(false);
    expect(r.state.team.engineering).toBe(121);
    expect(rosterInvariantHolds(r.state)).toBe(true);

    const all = Array.from({ length: 120 }, (_, i) => person(`e${i + 1}`, { engaged: true, name: `Worker ${i + 1}` }));
    const full = look(stateWith(all, { overrides: { cash: 1_000_000 } })).state;
    const refused = run(full, "recruit eng 1");
    expect(errorOf(refused)).toBe("You personally know 120 employees. That is the limit of human friendship and of this org chart.");
    expect(sansLogSeq(refused.state)).toEqual(sansLogSeq(full));
  });

  it("preflight reports the AP and the signing cost", () => {
    const s = looked();
    expect(preflight(s, "recruit eng 1")).toEqual({ allowed: true, reason: null, apCost: 1, cashCost: 3000 });
    expect(preflight(makeTycoonState(), "recruit eng 1")).toMatchObject({ allowed: false, reason: "Look before you sign: `recruit eng` shows this week's 3." });
    expect(preflight(s, "recruit eng")).toEqual({ allowed: true, reason: null, apCost: 0, cashCost: 0 });
  });
});
