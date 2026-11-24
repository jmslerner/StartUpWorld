// Run the simulator with a few config numbers changed, without editing the config file:
//   applyOverrides(CONFIG, { "ipo.users": 300000, "cpu.personalities.incumbent.weights.quality": 2 })
// A path names one value; array entries are addressed by index ("raise.options.0").

type Leaf = number | string;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const applyOverrides = <T>(config: T, overrides: Readonly<Record<string, Leaf>>): T => {
  const copy = structuredClone(config);
  for (const [path, value] of Object.entries(overrides)) {
    const keys = path.split(".");
    let node: unknown = copy;
    for (const key of keys.slice(0, -1)) {
      if (!isRecord(node) || !(key in node)) throw new Error(`No such config number: ${path}`);
      node = node[key];
    }
    const last = keys[keys.length - 1];
    if (!isRecord(node) || !(last in node)) throw new Error(`No such config number: ${path}`);
    const current = node[last];
    if (typeof current !== "number" && typeof current !== "string") throw new Error(`${path} is not a single value`);
    if (typeof current !== typeof value) throw new Error(`${path} is a ${typeof current}, not a ${typeof value}`);
    node[last] = value;
  }
  return copy;
};
