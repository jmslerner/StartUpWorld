// Run the simulator with a few config numbers changed, without editing the config file:
//   applyOverrides(CONFIG, { "ipo.users": 300000, "cpu.personalities.incumbent.weights.quality": 2 })
// A path names one value; array entries are addressed by index ("raise.options.0").
//
// A config with a career learns two more things. An era may be given a number it does not set yet, as long as the
// base config has it: "career.eras.2.values.quality.decay" gives the third era a decay of its own (a list the era
// does not set is copied from the base whole, then changed). And a base number that every era sets is refused,
// because changing it would change nothing: the eras' values lie over it in every year.

type Leaf = number | string;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The value at a dotted path, or undefined when the path leads nowhere. */
const valueAt = (root: unknown, keys: readonly string[]): unknown => {
  let node: unknown = root;
  for (const key of keys) {
    if (!isRecord(node) || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
};

/** The eras of a config with a career, or null for any other config. */
const erasOf = (config: unknown): readonly unknown[] | null => {
  const eras = valueAt(config, ["career", "eras"]);
  return Array.isArray(eras) ? eras : null;
};

const ERA_VALUES = /^career\.eras\.(\d+)\.values\.(.+)$/;

/**
 * For "career.eras.<n>.values.<rest>" in a config with a career, where the base config has <rest> but the era does
 * not: the era gains the keys it lacks on the way, so that the ordinary step below can set the number.
 */
const makeRoomInEra = (copy: unknown, path: string): void => {
  const match = ERA_VALUES.exec(path);
  const eras = erasOf(copy);
  if (match === null || eras === null) return;
  const era = eras[Number(match[1])];
  if (!isRecord(era) || !isRecord(era.values)) return;
  const rest = match[2].split(".");
  const base = valueAt(copy, rest);
  if (base === undefined) return;
  let node: Record<string, unknown> = era.values;
  let underneath: unknown = copy;
  for (const key of rest.slice(0, -1)) {
    underneath = isRecord(underneath) ? underneath[key] : undefined;
    if (!(key in node)) node[key] = Array.isArray(underneath) ? structuredClone(underneath) : {};
    const next = node[key];
    if (!isRecord(next)) return;
    node = next;
  }
  const last = rest[rest.length - 1];
  // A number the era does not set yet starts from the base's, so the type checks below apply as usual.
  if (!(last in node)) node[last] = valueAt(copy, rest);
};

export const applyOverrides = <T>(config: T, overrides: Readonly<Record<string, Leaf>>): T => {
  const copy = structuredClone(config);
  const eras = erasOf(copy);
  for (const [path, value] of Object.entries(overrides)) {
    const keys = path.split(".");
    if (eras !== null && keys[0] !== "career" && eras.length > 0) {
      const setByEvery = eras.every((era) => isRecord(era) && valueAt(era.values, keys) !== undefined);
      if (setByEvery) throw new Error(`${path} has no effect: every era sets its own (use career.eras.<n>.values.${path})`);
    }
    makeRoomInEra(copy, path);
    let node: unknown = copy;
    for (const key of keys.slice(0, -1)) {
      if (!isRecord(node) || !(key in node)) throw new Error(`No such config number: ${path}`);
      node = node[key];
    }
    const last = keys[keys.length - 1];
    if (!isRecord(node) || !(last in node)) throw new Error(`No such config number: ${path}`);
    const current = node[last];
    if (current === null) {
      // Switched off in the config (a rival that never poaches): a number switches it on.
      if (typeof value !== "number") throw new Error(`${path} takes a number`);
    } else {
      if (typeof current !== "number" && typeof current !== "string") throw new Error(`${path} is not a single value`);
      if (typeof current !== typeof value) throw new Error(`${path} is a ${typeof current}, not a ${typeof value}`);
    }
    node[last] = value;
  }
  return copy;
};
