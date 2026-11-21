import type { Employee, GameState, OfferKind } from "../../types/game";
import { BURNOUT_ENERGY, LEAD_LOSS } from "../tycoon/constants";
import type { WeekStep } from "../tycoon/contracts";
import { money } from "../tycoon/kit";
import { leadOf, peopleRng, removeEmployees, rosterOf, serialOf, setPeople } from "../tycoon/roster";
import { chance } from "../rng";
import { clamp } from "../utils";
import { MAX_PEOPLE_LINES, OFFERS_PER_TICK_DIVISOR } from "./constants";
import {
  buildAtRisk, buildById, crunchDrain, departFallout, energyRecovery, handleOf, hurtCulture, noticeWeeks, offerChance, retainBonus,
  retainSalary,
} from "./rules";

// Tick step N2 (TYCOON-SPEC §5.3, §6): the bill for the week. `state.week` is ALREADY the new week.
// (a) notices that ran out → departures; (b) energy; (c) "walks next week"; (d) new notices.
// Draws only from people.rng, and only when somebody engaged could get an offer.

/**
 * One people line. `keep` = never folded into the overflow line: departures (the person is gone, `team` cannot show them)
 * and anything that says a build would lose a quarter. `who` names the person in the overflow line.
 */
type News = { priority: number; text: string; keep: boolean; who: string };
const DEPARTED = 3;
const LAST_CALL = 2;
const NOTICE = 1;

const price = (e: Employee): string => `(1 AP, ${money(retainBonus(e))} bonus, pay → ${money(retainSalary(e))}/wk)`;

/**
 * (a) Everyone whose notice ran out leaves, as ONE batch: the lead rule is read before anyone goes, so a build whose lead
 * and next-in-line walk out in the same week loses its quarter once (ERRATA 65). Morale and cohesion per person, one line each.
 */
const departures = (state: GameState, news: News[]): GameState => {
  const leaving = rosterOf(state).filter((e) => e.offerDueWeek > 0 && state.week >= e.offerDueWeek);
  if (leaving.length === 0) return state;
  const gone = removeEmployees(state, leaving.map((e) => e.id));
  let s = gone.state;
  for (const e of leaving) {
    const hit = departFallout(e);
    s = hurtCulture(s, hit);
    const why = e.offerKind === "burnout" ? "They left a laptop and a very calm note." : "They signed with the company that has a cafeteria.";
    let text = `${e.name} cleared out their desk. ${why} ${e.role} -1. Payroll -${money(e.salary)}/wk. Morale -${hit.morale}. Cohesion -${hit.cohesion}.`;
    for (const l of gone.lost) if (l.byId === e.id) text += ` ${l.build.name} lost its lead and ${Math.round(LEAD_LOSS * 100)}% of its progress.`;
    news.push({ priority: DEPARTED, text, keep: true, who: e.name });
  }
  return s;
};

/** (b) People on a build that crunched this tick drain; everyone else recovers. Same reference when nobody moves. */
const energy = (state: GameState): GameState => {
  const crunched = new Set(buildsCrunchedNow(state));
  const recovery = energyRecovery(state);
  let changed = false;
  const roster = rosterOf(state).map((e) => {
    const drained = e.buildId !== null && crunched.has(e.buildId);
    const next = clamp(e.energy + (drained ? -crunchDrain(e) : recovery), 0, 100);
    if (next === e.energy) return e;
    changed = true;
    return { ...e, energy: next };
  });
  return changed ? setPeople(state, { roster }) : state;
};

const buildsCrunchedNow = (state: GameState): string[] =>
  (state.product?.active ?? []).filter((b) => b.crunchedWeek === state.week).map((b) => b.id);

/** (c) Last call for everyone who leaves in the next tick, with the build that would lose a quarter (ERRATA 66). */
const lastCalls = (state: GameState, news: News[]): void => {
  for (const e of rosterOf(state)) {
    if (e.offerDueWeek > 0 && e.offerDueWeek - state.week === 1) {
      const risk = buildAtRisk(state, e);
      news.push({
        priority: LAST_CALL,
        text: `${e.name} walks next week. \`retain ${handleOf(state, e)}\` ${price(e)} or start drafting the farewell Slack.${risk ? ` ${risk.name} loses a quarter if they go.` : ""}`,
        keep: risk !== null,
        who: e.name,
      });
    }
  }
};

/** (d) New notices: burnout is certain, recruiters roll (one `chance` each, roster order); at most 1 + floor(roster / 12). */
const notices = (state: GameState, news: News[]): GameState => {
  const roster = rosterOf(state);
  const wanting: Array<{ e: Employee; kind: OfferKind }> = [];
  let rng = peopleRng(state);
  let drew = false;
  for (const e of roster) {
    if (!e.engaged || e.offerDueWeek > 0) continue;
    if (e.energy < BURNOUT_ENERGY) {
      wanting.push({ e, kind: "burnout" });
      continue;
    }
    const p = offerChance(state, e);
    if (p <= 0) continue;
    const roll = chance(rng, p);
    rng = roll.rng;
    drew = true;
    if (roll.value) wanting.push({ e, kind: "recruiter" });
  }
  if (wanting.length === 0 && !drew) return state;

  wanting.sort((a, b) =>
    Number(b.kind === "burnout") - Number(a.kind === "burnout") ||
    (b.e.pace + b.e.craft) - (a.e.pace + a.e.craft) ||
    serialOf(a.e.id) - serialOf(b.e.id));
  const landed = wanting.slice(0, 1 + Math.floor(roster.length / OFFERS_PER_TICK_DIVISOR));
  const weeks = noticeWeeks(state);
  const due = state.week + weeks;
  // The lead rule follows the build they lead at this moment, whatever happens to the staffing afterwards (§5.3).
  const stamped = new Map(landed.map(({ e, kind }) => {
    const b = buildById(state, e.buildId);
    const leads = b !== null && leadOf(state, b)?.id === e.id ? b : null;
    return [e.id, { kind, leadOnNotice: leads ? leads.id : null, buildName: leads ? leads.name : null }] as const;
  }));
  const s = setPeople(state, {
    rng: drew ? rng : state.people?.rng ?? 0,
    roster: roster.map((e) => {
      const hit = stamped.get(e.id);
      return hit ? { ...e, offerDueWeek: due, offerKind: hit.kind, leadOnNotice: hit.leadOnNotice } : e;
    }),
  });
  for (const { e, kind } of landed) {
    const risk = stamped.get(e.id)?.buildName;
    const answer = `Gone in ${weeks} weeks unless you \`retain ${handleOf(s, e)}\` ${price(e)}.${risk ? ` ${risk} loses a quarter if they go.` : ""}`;
    news.push({
      priority: NOTICE,
      text: kind === "burnout"
        ? `${e.name} is running on fumes (energy ${e.energy}) and has started interviewing. ${answer}`
        : `${e.name} (${e.role}, pace ${e.pace} craft ${e.craft}) has an outside offer. ${answer}`,
      keep: Boolean(risk),
      who: e.name,
    });
  }
  return s;
};

const OVERFLOW_NAMES = 4;

/**
 * Departures first, then last calls, then new notices (ERRATA 66). Lines marked `keep` always print: a departure (that person
 * is no longer on `team`) and every line that says a build would lose a quarter. The rest fill whatever is left of
 * MAX_PEOPLE_LINES; anything beyond that is ONE line naming who else is on notice, all of whom `team` does list.
 */
const render = (news: News[]): string[] => {
  const sorted = [...news].sort((a, b) => b.priority - a.priority);
  let room = Math.max(0, MAX_PEOPLE_LINES - sorted.filter((n) => n.keep).length);
  const shown: News[] = [];
  const folded: News[] = [];
  for (const n of sorted) {
    if (n.keep) shown.push(n);
    else if (room > 0) { shown.push(n); room -= 1; }
    else folded.push(n);
  }
  const logs = shown.map((n) => n.text);
  if (folded.length > 0) {
    const names = folded.slice(0, OVERFLOW_NAMES).map((n) => n.who).join(", ");
    const more = folded.length > OVERFLOW_NAMES ? ` +${folded.length - OVERFLOW_NAMES} more` : "";
    logs.push(`(Also on notice: ${names}${more}. \`team\` has the details.)`);
  }
  return logs;
};

/** Tick step N2. Returns the same reference and [] when nobody is engaged (every legacy run). */
export const runPeopleWeek: WeekStep = (state) => {
  if (!state.people || state.people.roster.length === 0) return { state, logs: [] };
  const news: News[] = [];
  let s = departures(state, news);
  s = energy(s);
  lastCalls(s, news);
  s = notices(s, news);
  if (s === state) return { state, logs: [] };
  return { state: s, logs: render(news) };
};
