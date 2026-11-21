import type { Candidate, GameState, QuirkId, TeamRole } from "../../types/game";
import { QUIRKS } from "../tycoon/constants";
import { drawName, emptyPeople, peopleRng, round50, setPeople, skillFactorOf, standardSalary, takenNames, wantOf } from "../tycoon/roster";
import { chance, nextFloat01, nextIntInclusive, pickWeightedIndex } from "../rng";
import { clamp } from "../utils";
import {
  ASK_MIN, ASK_SPAN, CANDIDATE_QUIRK_CHANCE, CANDIDATE_STAT_WEIGHTS, CANDIDATES_PER_ROLE, QUIRK_ASK, RESUME_INFLATION_WEIGHTS,
  TALENT_BONUS_CHANCE, TALENT_PULL_HR, TALENT_PULL_HR_MAX, TALENT_PULL_RAINMAKER, TALENT_PULL_REP, TALENT_PULL_VISIONARY,
} from "./constants";
import { hasHr } from "./rules";

// The weekly candidate pools of `recruit <role>` (TYCOON-SPEC §4.3, §5.3). Every draw comes from people.rng.

/** How good the people who answer your recruiter are: reputation, HR, and founders people want to work for. 0..1. */
export const talentPull = (state: GameState): number =>
  clamp(
    TALENT_PULL_REP * (state.reputation / 100) +
      TALENT_PULL_HR * Math.min(TALENT_PULL_HR_MAX, wantOf(state.team.hr)) +
      (state.founder.archetype === "visionary" ? TALENT_PULL_VISIONARY : 0) +
      (state.cofounder.archetype === "rainmaker" ? TALENT_PULL_RAINMAKER : 0),
    0,
    1,
  );

/** Someone on staff reads the résumés: decided when the pool is generated. */
export const hasVetting = hasHr;

/** The stored pool for a role this week, or null (never looked this week, or the pools belong to another week). */
export const storedPool = (state: GameState, role: TeamRole): Candidate[] | null => {
  const people = state.people;
  if (!people || people.candidatesWeek !== state.week) return null;
  return people.candidates[role] ?? null;
};

const drawStat = (rng: number): { rng: number; value: number } => {
  const pick = pickWeightedIndex(rng, CANDIDATE_STAT_WEIGHTS);
  return { rng: pick.rng, value: 1 + (pick.value ?? 2) };
};

/**
 * Draws one candidate (§2.6 order): pace, craft, lucky, which, quirk chance, [quirk index], [unvetted: stat, inflation],
 * noise, first name, last name.
 */
export const drawCandidate = (
  rng: number, role: TeamRole, serial: number, pull: number, vetted: boolean, taken: Set<string>,
): { rng: number; candidate: Candidate } => {
  const paceDraw = drawStat(rng);
  const craftDraw = drawStat(paceDraw.rng);
  // A company people want to work for: sometimes one stat comes in a point higher.
  const lucky = chance(craftDraw.rng, pull * TALENT_BONUS_CHANCE);
  const which = chance(lucky.rng, 0.5);
  const pace = Math.min(5, paceDraw.value + (lucky.value && which.value ? 1 : 0));
  const craft = Math.min(5, craftDraw.value + (lucky.value && !which.value ? 1 : 0));
  const hasQuirk = chance(which.rng, CANDIDATE_QUIRK_CHANCE);
  let r = hasQuirk.rng;
  let quirk: QuirkId | null = null;
  if (hasQuirk.value) {
    const q = nextIntInclusive(r, 0, QUIRKS.length - 1);
    r = q.rng;
    quirk = QUIRKS[q.value];
  }
  let claimedPace = pace;
  let claimedCraft = craft;
  if (!vetted) {
    const stat = chance(r, 0.5);
    const by = pickWeightedIndex(stat.rng, RESUME_INFLATION_WEIGHTS);
    r = by.rng;
    if (stat.value) claimedPace = Math.min(5, pace + (by.value ?? 0));
    else claimedCraft = Math.min(5, craft + (by.value ?? 0));
  }
  const noise = nextFloat01(r);
  const named = drawName(noise.rng, taken, serial);
  const ask = round50(standardSalary(role) * skillFactorOf(claimedPace, claimedCraft) * (ASK_MIN + ASK_SPAN * noise.value) * (quirk ? QUIRK_ASK[quirk] : 1));
  return {
    rng: named.rng,
    candidate: { id: `c${serial}`, name: named.name, role, pace, craft, claimedPace, claimedCraft, quirk, vetted, ask },
  };
};

/**
 * This week's pool for a role: generated on the first look of the week, then stored, so looking again shows the same three.
 * On the first look of a new week every stale pool is wiped first. Returns the same state reference when the pool exists.
 * Callers pass a state that already went through `ensureSlices`.
 */
export const poolFor = (state: GameState, role: TeamRole): { state: GameState; pool: Candidate[] } => {
  const existing = storedPool(state, role);
  if (existing) return { state, pool: existing };
  let people = state.people ?? emptyPeople();
  if (people.candidatesWeek !== state.week) people = { ...people, candidates: {}, candidatesWeek: state.week };

  const pull = talentPull(state);
  const vetted = hasVetting(state);
  const taken = takenNames(people);
  let rng = peopleRng(state);
  let serial = people.nextCandidateId;
  const pool: Candidate[] = [];
  for (let i = 0; i < CANDIDATES_PER_ROLE; i++) {
    const drawn = drawCandidate(rng, role, serial, pull, vetted, taken);
    rng = drawn.rng;
    taken.add(drawn.candidate.name);
    pool.push(drawn.candidate);
    serial += 1;
  }
  const next = setPeople(state, {
    candidates: { ...people.candidates, [role]: pool },
    candidatesWeek: people.candidatesWeek,
    nextCandidateId: serial,
    rng,
  });
  return { state: next, pool };
};
