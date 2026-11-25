/**
 * The people of an office scene: who is drawn, under which id, from one scene to the next.
 *
 * A scene only counts people. The cast turns the counts into people who keep their id, and so their face, for as
 * long as they are with the company. Pure: no three, no clock, no randomness beyond the scene's seed.
 *
 * The rulings:
 *
 * 1. The scene's people are five groups, in this order: Product, Growth, Recruiting, away, leaving. `total` is their
 *    sum. `staff = min(total, MAX_STAFF_DRAWN)` of them are drawn, shared out between the groups by largest
 *    remainder, ties to the earlier group. `hidden = total − staff`.
 * 2. A fresh cast (no previous cast, another `runId`, or an earlier year) numbers people `p0`, `p1`, … group by
 *    group. People away get the team Product. `arrived` and `left` are empty: everyone is simply there.
 * 3. Otherwise, from the previous cast. When the year has moved on, the people who were leaving have left before
 *    anything else is worked out. Then each group keeps its longest-serving members, up to its share; the rest are
 *    released, most recent joiner first. Groups that are short take released people, group by group in the order
 *    above, people released from work or from being away before people released from leaving, longest-serving
 *    first. Released people nobody takes have left. Groups still short take the people waiting at the door,
 *    longest-waiting first, and then new ids. So within a year a planned layoff can be undone and the same person
 *    returns; once the year has played out, that person is gone and a hire is someone new.
 * 4. A person who goes from working to away keeps their team. A person who returns to work takes the team of the
 *    group that took them.
 * 5. `min(scene.arriving, MAX_WAITING_DRAWN)` people wait at the door: those already waiting stay, longest-waiting
 *    first; any others have left; new ones get new ids.
 * 6. `people` is in id order. `look` is `hashText32(scene.seed, id)`.
 *
 * Where the rulings are silent:
 *
 * - A count that is not a whole number of people is read as one: rounded down, and nothing for a negative or a
 *   number that is not one. Nobody is invented.
 * - Someone who goes away without having had a team (from leaving, from the door, or a new face) gets the team
 *   Product, as in a fresh cast.
 * - New staff are numbered before new people at the door, group by group.
 */
import { hashText32 } from "./hash";
import { TEAMS } from "./types/scene";
import type { OfficeScene, Team } from "./types/scene";

export const MAX_STAFF_DRAWN = 50;
export const MAX_WAITING_DRAWN = 6;

export type Standing = "working" | "away" | "leaving" | "waiting";

export interface CastMember {
  /** "p0", "p1", …: never reused within a run. */
  readonly id: string;
  readonly standing: Standing;
  /** The team whose desks they sit at: set for people working or away, null for people leaving or waiting. */
  readonly team: Team | null;
  /** `hashText32(scene.seed, id)`. */
  readonly look: number;
}

export interface Cast {
  readonly runId: string;
  readonly year: number;
  /** Everyone drawn, in the order they joined. */
  readonly people: readonly CastMember[];
  /** Staff who exist and are not drawn. */
  readonly hidden: number;
  /** Ids in `people` that the previous cast did not have, and ids it had that are gone. Both empty in a fresh cast. */
  readonly arrived: readonly string[];
  readonly left: readonly string[];
  readonly nextId: number;
}

type Group = Team | "away" | "leaving";
const GROUPS: readonly Group[] = [...TEAMS, "away", "leaving"];

/** A person before the face is worked out. */
interface Person {
  readonly id: string;
  readonly standing: Standing;
  readonly team: Team | null;
}

const whole = (count: number): number => (Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0);

const serial = (person: Person): number => Number(person.id.slice(1));
const bySerial = (a: Person, b: Person): number => serial(a) - serial(b);

/** `drawn` places shared between groups of the given sizes by largest remainder, ties to the earlier group. */
const sharesOf = (counts: readonly number[], drawn: number): number[] => {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= drawn) return [...counts];
  const shares = counts.map((count) => Math.floor((count * drawn) / total));
  const spare = drawn - shares.reduce((sum, share) => sum + share, 0);
  counts
    .map((count, index) => ({ index, remainder: (count * drawn) % total }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, spare)
    .forEach(({ index }) => {
      shares[index] += 1;
    });
  return shares;
};

const groupOf = (person: Person): Group | null => {
  if (person.standing === "waiting") return null;
  if (person.standing === "working") return person.team ?? "product";
  return person.standing;
};

/** The same person as a member of `group`. */
const into = (group: Group, person: Person): Person => {
  if (group === "leaving") return { id: person.id, standing: "leaving", team: null };
  if (group === "away") return { id: person.id, standing: "away", team: person.team ?? "product" };
  return { id: person.id, standing: "working", team: group };
};

export const nextCast = (prev: Cast | null, scene: OfficeScene): Cast => {
  const counts = [...TEAMS.map((team) => whole(scene.teams[team])), whole(scene.away), whole(scene.leaving)];
  const total = counts.reduce((sum, count) => sum + count, 0);
  const shares = sharesOf(counts, MAX_STAFF_DRAWN);
  const staff = shares.reduce((sum, share) => sum + share, 0);
  const expected = Math.min(whole(scene.arriving), MAX_WAITING_DRAWN);

  const before = prev !== null && prev.runId === scene.runId && scene.year >= prev.year ? prev : null;
  const yearMovedOn = before !== null && scene.year > before.year;
  const stayed: Person[] = (before?.people ?? []).filter((person) => !(yearMovedOn && person.standing === "leaving")).sort(bySerial);

  let nextId = before?.nextId ?? 0;
  const someoneNew = (): Person => {
    const id = `p${nextId}`;
    nextId += 1;
    return { id, standing: "waiting", team: null };
  };

  // Each group keeps its longest-serving members, up to its share, and releases the rest.
  const members: Person[][] = [];
  const fromWork: Person[] = [];
  const fromLeaving: Person[] = [];
  GROUPS.forEach((group, index) => {
    const had = stayed.filter((person) => groupOf(person) === group);
    members.push(had.slice(0, shares[index]));
    (group === "leaving" ? fromLeaving : fromWork).push(...had.slice(shares[index]));
  });

  // Groups that are short take the released, then the people at the door, then new people.
  const released = [...fromWork.sort(bySerial), ...fromLeaving];
  const door = stayed.filter((person) => person.standing === "waiting");
  const fill = (take: () => Person | undefined): void => {
    GROUPS.forEach((group, index) => {
      while (members[index].length < shares[index]) {
        const taken = take();
        if (taken === undefined) return;
        members[index].push(into(group, taken));
      }
    });
  };
  fill(() => released.shift());
  fill(() => door.shift() ?? someoneNew());

  // The door: those still waiting stay, longest-waiting first, and new people make up the number expected.
  const waiting = door.slice(0, expected);
  while (waiting.length < expected) waiting.push(someoneNew());

  const people: CastMember[] = [...members.flat(), ...waiting]
    .sort(bySerial)
    .map((person) => ({ ...person, look: hashText32(scene.seed, person.id) }));
  const had = new Set((before?.people ?? []).map((person) => person.id));
  const has = new Set(people.map((person) => person.id));

  return {
    runId: scene.runId,
    year: scene.year,
    people,
    hidden: total - staff,
    arrived: before === null ? [] : people.filter((person) => !had.has(person.id)).map((person) => person.id),
    left: before === null ? [] : before.people.filter((person) => !has.has(person.id)).map((person) => person.id),
    nextId,
  };
};
