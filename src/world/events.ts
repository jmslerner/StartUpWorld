/**
 * (previous snapshot, next snapshot, the command that ran) → the discrete things
 * the world should react to.
 *
 * Two kinds of evidence are combined:
 *   • snapshot diffs   — what actually changed (people, phase, cash, …). These are
 *                        trusted on their own, so loading a save or an event choice
 *                        that hires someone still produces the right cues.
 *   • the ActionSignal — what the player *tried* and how the engine judged it
 *                        (its SoundHint). This is the only way to tell a shipped
 *                        feature from a failed one, or a typo from a no-op.
 *
 * Emission order is fixed, so consumers and tests can rely on it:
 *
 *   1. structural      setup-completed, phase-changed, stage-changed,
 *                      departed (ROLE_ORDER), hired (ROLE_ORDER),
 *                      asset-acquired (purchase order)
 *   2. action outcome  week-advanced, event-resolved, then at most ONE of
 *                      ship | launch | pitch | raise | board-action |
 *                      pricing-changed | easter-egg | command-failed
 *   3. ambient deltas  cash-changed, users-changed, event-opened
 *   4. game-over       always last
 *
 * `run-reset` is exclusive: when it is emitted it is the only event.
 * No event is ever emitted twice in one batch (hired / departed are per role,
 * asset-acquired is per asset).
 */
import type { SoundHint, TeamRole } from "../types/game";
import { employeeId, headcount, MAX_WORLD_PEOPLE, ROLE_ORDER } from "./snapshot";
import type { ActionSignal, PersonView, WorldEvent, WorldEventType, WorldSnapshot } from "./types";

/** Cash moves smaller than this are noise (rounding, tiny fees) and get no cue. */
export const CASH_EVENT_THRESHOLD = 500;

/**
 * Commands the engine answers with a joke and no state change.
 * Mirrors the keys of EASTER_EGGS in src/engine/commands.ts, which is not exported.
 */
export const EASTER_EGG_COMMANDS: ReadonlySet<string> = new Set([
  "sudo", "exit", "quit", "coffee", "panic", "blame", "pivot", "pray", "fire", "sleep", "meditate",
  "disrupt", "synergy", "scale", "network", "hustle", "ai", "blockchain", "vibe", "ramen", "vc", "traction",
]);

type BoardAction = Extract<WorldEvent, { type: "board-action" }>["action"];
type RaiseSource = Extract<WorldEvent, { type: "raise" }>["source"];

const BOARD_ACTIONS: ReadonlySet<string> = new Set<BoardAction>(["dinner", "gift", "blackmail"]);
const isBoardAction = (value: string | undefined): value is BoardAction =>
  value !== undefined && BOARD_ACTIONS.has(value);

/** The engine reports a rolled outcome as "success" or "fail"; anything else is not a roll. */
const isRoll = (sound: SoundHint | null): sound is "success" | "fail" => sound === "success" || sound === "fail";

/**
 * The engine refused the command. A refusal never carries a sound, so requiring
 * both keeps a real outcome (e.g. a backfired blackmail, whose log contains an
 * error line) from being mistaken for a refusal if the store over-reports `rejected`.
 */
const wasRefused = (action: ActionSignal): boolean => action.rejected && action.sound === null;

/** Nothing the world shows moved between the two snapshots. */
const nothingChanged = (prev: WorldSnapshot, next: WorldSnapshot): boolean =>
  prev.week === next.week &&
  prev.ap === next.ap &&
  prev.cash === next.cash &&
  prev.users === next.users &&
  prev.mrr === next.mrr &&
  prev.valuation === next.valuation &&
  prev.reputation === next.reputation &&
  prev.morale === next.morale &&
  prev.cohesion === next.cohesion &&
  prev.stress === next.stress &&
  prev.volatility === next.volatility &&
  prev.phase === next.phase &&
  prev.stage === next.stage &&
  prev.teamSize === next.teamSize &&
  prev.setupComplete === next.setupComplete &&
  prev.pendingEventTitle === next.pendingEventTitle &&
  prev.gameOver === next.gameOver &&
  prev.ownedAssets.length === next.ownedAssets.length;

/** Ids `${role}-${from}` … `${role}-${to - 1}` that are actually in `roster`. */
const rosterIdsInRange = (roster: readonly PersonView[], role: TeamRole, from: number, to: number): string[] => {
  const present = new Set<string>();
  for (const person of roster) present.add(person.id);
  const ids: string[] = [];
  // Indices at or past the cap can never be on screen; the bound also keeps this
  // loop short when a head count is absurdly large.
  const end = Math.min(to, MAX_WORLD_PEOPLE);
  for (let index = from; index < end; index += 1) {
    const id = employeeId(role, index);
    if (present.has(id)) ids.push(id);
  }
  return ids;
};

/**
 * Head-count changes per role. New hires are always the highest indices of
 * their role and departures remove the highest indices, so everyone else keeps
 * their id (and therefore their name, look and desk).
 *
 * `personIds` only lists people in the capped roster; when the office is past
 * MAX_WORLD_PEOPLE it can be shorter than the real change, or empty. `count`
 * then carries the real change (it is left out when it equals `personIds.length`).
 */
const pushRosterEvents = (events: WorldEvent[], prev: WorldSnapshot, next: WorldSnapshot): void => {
  const hired: WorldEvent[] = [];
  for (const role of ROLE_ORDER) {
    const before = headcount(prev.team, role);
    const after = headcount(next.team, role);
    if (after < before) {
      const personIds = rosterIdsInRange(prev.people, role, after, before);
      const count = before - after;
      events.push(count === personIds.length ? { type: "departed", role, personIds } : { type: "departed", role, personIds, count });
    } else if (after > before) {
      const personIds = rosterIdsInRange(next.people, role, before, after);
      const count = after - before;
      hired.push(count === personIds.length ? { type: "hired", role, personIds } : { type: "hired", role, personIds, count });
    }
  }
  // Goodbyes before hellos, so a freed desk is free by the time a newcomer needs one.
  for (const event of hired) events.push(event);
};

const pushAssetEvents = (events: WorldEvent[], prev: WorldSnapshot, next: WorldSnapshot): void => {
  for (const assetId of next.ownedAssets) {
    if (!prev.ownedAssets.includes(assetId)) events.push({ type: "asset-acquired", assetId });
  }
};

/** The single event (if any) that describes how the player's command turned out. */
const actionOutcome = (prev: WorldSnapshot, next: WorldSnapshot, action: ActionSignal | null): WorldEvent | null => {
  if (!action || action.command === "") return null;
  const { command, args, sound } = action;

  if (wasRefused(action)) return { type: "command-failed", command };

  switch (command) {
    case "ship":
      return isRoll(sound)
        ? { type: "ship", ok: sound === "success", reputationDelta: next.reputation - prev.reputation }
        : null;

    case "launch":
      return isRoll(sound) ? { type: "launch", ok: sound === "success", usersDelta: next.users - prev.users } : null;

    case "pitch":
      return isRoll(sound) ? { type: "pitch", ok: sound === "success" } : null;

    case "raise": {
      // Bare `raise` only lists the funding options.
      if (args.length === 0) return null;
      // The engine accepts "vs" as a typo for "vc" (handleRaise in commands.ts).
      const source: RaiseSource = args[0] === "vc" || args[0] === "vs" ? "vc" : "bootstrap";
      if (sound === "cash-in") {
        // Cash delta, not the asked amount: a VC round repays outstanding debt
        // first, so less (possibly nothing) may actually land in the bank.
        return { type: "raise", ok: true, amount: Math.max(0, next.cash - prev.cash), source };
      }
      // Only investors can say no; bootstrap money always arrives.
      return sound === "fail" && source === "vc" ? { type: "raise", ok: false, amount: 0, source } : null;
    }

    case "board": {
      const sub = args[0];
      return isBoardAction(sub) && isRoll(sound) ? { type: "board-action", action: sub, ok: sound === "success" } : null;
    }

    case "pricing":
      // A pivot is the only `pricing` call the engine scores, and it scores it "warning".
      return args.length > 0 && sound === "warning" ? { type: "pricing-changed" } : null;

    default:
      // The "changed nothing" check keeps this honest if one of these words ever
      // becomes a real command.
      return EASTER_EGG_COMMANDS.has(command) && sound === null && nothingChanged(prev, next)
        ? { type: "easter-egg", command }
        : null;
  }
};

/**
 * Pure diff: what visibly happened between two snapshots, given the command that
 * caused the change (if any). Returns [] when `prev` is null (initial mount, or a
 * saved game being loaded: the world is built as-is, with no fanfare).
 *
 * Pass each ActionSignal at most once (track `seq`); passing a stale signal with
 * an unrelated snapshot change would replay that command's outcome.
 */
export const deriveWorldEvents = (
  prev: WorldSnapshot | null,
  next: WorldSnapshot,
  action: ActionSignal | null
): WorldEvent[] => {
  if (prev === null) return [];

  // A different run, or time running backwards, means `prev` describes another
  // world. Diffing against it would produce nonsense (mass "departures", …).
  if (next.runId !== prev.runId || next.week < prev.week) return [{ type: "run-reset" }];

  const events: WorldEvent[] = [];

  // 1. Structural
  if (!prev.setupComplete && next.setupComplete) events.push({ type: "setup-completed" });
  if (next.phase !== prev.phase) events.push({ type: "phase-changed", from: prev.phase, to: next.phase });
  if (next.stage !== prev.stage) events.push({ type: "stage-changed", from: prev.stage, to: next.stage });
  pushRosterEvents(events, prev, next);
  pushAssetEvents(events, prev, next);

  // 2. Action outcomes
  if (next.week > prev.week) events.push({ type: "week-advanced", week: next.week });

  // Titles are unique per event definition, so a changed title is a different
  // event: the old one was resolved and a new one opened in the same step (an
  // acquisition offer that follows a choice).
  const eventChanged = next.pendingEventTitle !== prev.pendingEventTitle;
  if (eventChanged && prev.pendingEventTitle !== null) events.push({ type: "event-resolved" });

  const outcome = actionOutcome(prev, next, action);
  if (outcome) events.push(outcome);

  // 3. Ambient deltas — skipped when an event above already tells the story.
  const cashDelta = next.cash - prev.cash;
  if (Math.abs(cashDelta) >= CASH_EVENT_THRESHOLD && outcome?.type !== "raise") {
    events.push({ type: "cash-changed", delta: cashDelta });
  }
  const usersDelta = next.users - prev.users;
  if (usersDelta !== 0 && outcome?.type !== "launch") {
    events.push({ type: "users-changed", delta: usersDelta });
  }
  if (eventChanged && next.pendingEventTitle !== null) {
    events.push({ type: "event-opened", title: next.pendingEventTitle });
  }

  // 4. The end
  if (prev.gameOver === null && next.gameOver !== null) events.push({ type: "game-over", ending: next.gameOver });

  return events;
};

/** First event of a given type, narrowed to that member of the union. */
export const findWorldEvent = <T extends WorldEventType>(
  events: readonly WorldEvent[],
  type: T
): Extract<WorldEvent, { type: T }> | undefined =>
  events.find((event): event is Extract<WorldEvent, { type: T }> => event.type === type);

/** Every event of a given type (hired / departed / asset-acquired can occur more than once). */
export const filterWorldEvents = <T extends WorldEventType>(
  events: readonly WorldEvent[],
  type: T
): Array<Extract<WorldEvent, { type: T }>> =>
  events.filter((event): event is Extract<WorldEvent, { type: T }> => event.type === type);
