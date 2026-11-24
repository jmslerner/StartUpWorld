// Which numbers the game runs on differ from the design's starting values. `npm run sim` prints
// this under the balance report, so the list of tuned numbers can never drift from the config.

export interface Change {
  /** Dotted path into the config; an event card is named by its id. */
  readonly path: string;
  /** undefined = not in the design's starting numbers. */
  readonly start: unknown;
  /** undefined = no longer in the config. */
  readonly now: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isLeafList = (value: unknown): value is readonly unknown[] => Array.isArray(value) && value.every((item) => typeof item !== "object" || item === null);
const hasIds = (value: unknown): value is readonly { readonly id: string }[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => isRecord(item) && typeof item.id === "string");

/** A list of records as a record, keyed by id when every entry has one and by position otherwise. */
const keyed = (list: readonly unknown[], byId: boolean): Record<string, unknown> =>
  Object.fromEntries(list.map((item, index) => [byId ? (item as { id: string }).id : String(index), item]));

const sameList = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((item, index) => item === b[index]);

export const changedNumbers = (start: unknown, now: unknown, path = ""): Change[] => {
  if (isRecord(start) && isRecord(now)) {
    const keys = [...Object.keys(start), ...Object.keys(now).filter((key) => !(key in start))];
    return keys.flatMap((key) => changedNumbers(start[key], now[key], path === "" ? key : `${path}.${key}`));
  }
  if (Array.isArray(start) && Array.isArray(now)) {
    if (isLeafList(start) && isLeafList(now)) return sameList(start, now) ? [] : [{ path, start, now }];
    const byId = hasIds(start) && hasIds(now);
    return changedNumbers(keyed(start, byId), keyed(now, byId), path);
  }
  return start === now ? [] : [{ path, start, now }];
};

const show = (value: unknown, side: "start" | "now"): string => {
  if (value === undefined) return "(not there)";
  if (typeof value === "number") return Number.isInteger(value) && Math.abs(value) >= 1_000 ? value.toLocaleString("en-US") : String(value);
  if (isLeafList(value)) return value.map((item) => show(item, side)).join(", ");
  if (typeof value === "object") return side === "now" ? "added" : "(was there)";
  return String(value);
};

export const formatChanges = (changes: readonly Change[]): string => {
  const title = "Numbers changed from the design's starting values";
  if (changes.length === 0) return `${title}: none.`;
  const width = Math.max(...changes.map((change) => change.path.length)) + 2;
  return [`${title}: ${changes.length}`, ...changes.map((change) => `  ${change.path.padEnd(width)}${show(change.start, "start")} -> ${show(change.now, "now")}`)].join("\n");
};
