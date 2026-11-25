import { describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import { DESIGN } from "../config.design";
import { endView, eventView, planningView, reportView, resourceView, rivalsView } from "../ui/viewModel";
import { PLAYER_ID, createGameStore, type StorageLike } from "./gameStore";
import { SAVE_KEY, parseSave } from "./save";

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** Events every quarter from the third, so saves hold an event and its effects. */
const EVENTFUL = { ...DESIGN, events: { ...DESIGN.events, chance: 1 } };

type Store = ReturnType<typeof createGameStore>;

/** A player who launches, then spreads the team, markets a little and hires within reason. */
const playQuarter = (store: Store): void => {
  const { game } = store.getState();
  if (game === null) return;
  const self = game.companies[PLAYER_ID];
  if (self.launched) {
    const recruiting = self.headcount < 8 ? 1 : 0;
    const growth = Math.floor((self.headcount - recruiting) / 2);
    store.getState().setDraft({ allocation: { product: self.headcount - recruiting - growth, growth, recruiting }, marketing: 25_000, hireLimit: 1 });
  }
  store.getState().endQuarter();
};

/** The raw save after `quarters` quarters of one seeded game, or when the game ends if that comes first. */
const saveAfter = (seed: number, quarters: number, config = EVENTFUL): string => {
  const storage = new MemoryStorage();
  const store = createGameStore(storage, config);
  store.getState().startGame("Acme", seed);
  for (let i = 0; i < quarters && !store.getState().over; i++) playQuarter(store);
  return storage.getItem(SAVE_KEY)!;
};

/** Where a value holds something no screen can show: undefined, or a number that is not finite. */
const unusable = (value: unknown, path = "$"): string | null => {
  if (value === undefined) return `${path} is undefined`;
  if (typeof value === "number" && !Number.isFinite(value)) return `${path} is ${value}`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = unusable(value[i], `${path}[${i}]`);
      if (found !== null) return found;
    }
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const found = unusable(child, `${path}.${key}`);
      if (found !== null) return found;
    }
  }
  return null;
};

/** What goes wrong when the app loads this save, draws every screen and plays one more quarter; null if nothing does. */
const harmOf = (raw: string, config = EVENTFUL): string | null => {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, raw);
  try {
    const store = createGameStore(storage, config);
    const screens = (when: string): string | null => {
      const { game, draft, lastLog } = store.getState();
      if (game === null || draft === null) return null;
      const drawn = {
        resource: resourceView(game, config),
        planning: planningView(game, draft, config),
        rivals: rivalsView(game, config),
        event: eventView(game.event, game, config),
        end: endView(game, config),
        report: lastLog === null ? null : reportView(game, lastLog, config),
      };
      const found = unusable(drawn);
      return found === null ? null : `${when}: ${found}`;
    };
    const before = screens("as loaded");
    if (before !== null) return before;
    store.getState().endQuarter();
    const { failure } = store.getState();
    if (failure !== null) return `ending the quarter: ${failure.message}`;
    return screens("after one more quarter");
  } catch (error) {
    return `threw: ${error instanceof Error ? error.message : String(error)}`;
  }
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Step = string | number;

const at = (root: Json, path: readonly Step[]): Json => path.reduce<Json>((node, step) => (node as Record<Step, Json>)[step], root);

/** Every place in the document, parents before children. */
const pathsOf = (node: Json, path: readonly Step[] = []): Step[][] => {
  const here = path.length === 0 ? [] : [[...path]];
  if (Array.isArray(node)) return [...here, ...node.flatMap((child, index) => pathsOf(child, [...path, index]))];
  if (typeof node === "object" && node !== null) return [...here, ...Object.entries(node).flatMap(([key, child]) => pathsOf(child, [...path, key]))];
  return here;
};

const REMOVED = Symbol("removed");

/** The ways one value can be damaged: gone, emptied, or of the wrong kind or size. */
const damagesFor = (value: Json): (Json | typeof REMOVED)[] => {
  const damages: (Json | typeof REMOVED)[] = [REMOVED];
  if (value !== null) damages.push(null);
  if (typeof value === "number") damages.push("x", -1, 0.5, 1e9);
  else if (typeof value === "string") damages.push(7, "zzz");
  else if (typeof value === "boolean") damages.push("x");
  else if (value === null) damages.push("x", 7);
  else if (Array.isArray(value)) damages.push("x", ...(value.length > 0 ? [[] as Json] : []));
  else damages.push("x", ...(Object.keys(value).length > 0 ? [{} as Json] : []));
  return damages;
};

/** A copy of the document with the value at `path` replaced or removed. */
const damaged = (root: Json, path: readonly Step[], replacement: Json | typeof REMOVED): Json => {
  const copy = JSON.parse(JSON.stringify(root)) as Json;
  const parent = at(copy, path.slice(0, -1));
  const last = path[path.length - 1];
  if (Array.isArray(parent)) {
    if (replacement === REMOVED) parent.splice(last as number, 1);
    else parent[last as number] = replacement;
  } else {
    const record = parent as { [key: string]: Json };
    if (replacement === REMOVED) delete record[last as string];
    else record[last as string] = replacement;
  }
  return copy;
};

describe("a saved game", () => {
  // On the design's numbers with an event every quarter, and on the numbers the game ships with.
  it.each([
    ["the design's numbers", EVENTFUL],
    ["the shipped numbers", CONFIG],
  ])("loads back exactly, quarter after quarter, in every state a game goes through (%s)", (_name, config) => {
    for (const seed of [3, 11, 21, 40, 72, 4242]) {
      const storage = new MemoryStorage();
      const store = createGameStore(storage, config);
      store.getState().startGame("Acme", seed);
      for (let quarter = 0; quarter < 25; quarter++) {
        const now = store.getState();
        const loaded = parseSave(storage.getItem(SAVE_KEY), config);
        expect(loaded, `seed ${seed}, quarter ${quarter}`).not.toBeNull();
        expect(loaded).toEqual({ seed: now.seed, game: now.game, draft: now.draft, lastLog: now.lastLog, reportOpen: now.reportOpen });
        if (now.over) break;
        playQuarter(store);
      }
      expect(store.getState().over, `seed ${seed} reaches an ending`).toBe(true);
    }
  });

  it("keeps people the player had left unassigned when the page is reloaded", () => {
    const storage = new MemoryStorage();
    const store = createGameStore(storage, EVENTFUL);
    store.getState().startGame("Acme", 3);
    store.getState().setDraft({ allocation: { product: 1, growth: 1, recruiting: 1 } });
    store.getState().endQuarter();
    store.getState().closeReport();
    // One person taken out of Product and not yet placed anywhere.
    store.getState().setDraft({ allocation: { product: 0, growth: 1, recruiting: 1 } });
    const reloaded = createGameStore(storage, EVENTFUL).getState();
    expect(reloaded.draft?.allocation).toEqual({ product: 0, growth: 1, recruiting: 1 });
  });

  it("still shrinks a saved split that holds more people than the company has", () => {
    const storage = new MemoryStorage();
    createGameStore(storage, EVENTFUL).getState().startGame("Acme", 3);
    const save = JSON.parse(storage.getItem(SAVE_KEY)!);
    storage.setItem(SAVE_KEY, JSON.stringify({ ...save, draft: { ...save.draft, allocation: { product: 9, growth: 9, recruiting: 0 } } }));
    const split = createGameStore(storage, EVENTFUL).getState().draft!.allocation;
    expect(split.product + split.growth + split.recruiting).toBe(3);
  });
});

describe("a damaged save", () => {
  // A fresh game, a game in full swing (an event in force, raises and poaches behind it) and a finished one.
  const saves: Record<string, string> = {
    "a new game": saveAfter(11, 0),
    "mid-game": saveAfter(11, 9),
    "a finished game": saveAfter(40, 25),
  };

  it("starts from saves that are themselves fine", () => {
    for (const [name, raw] of Object.entries(saves)) {
      expect(parseSave(raw, EVENTFUL), name).not.toBeNull();
      expect(harmOf(raw), name).toBeNull();
    }
    const mid = parseSave(saves["mid-game"], EVENTFUL)!;
    expect(mid.game.event).not.toBeNull();
    expect(mid.lastLog).not.toBeNull();
    expect(mid.game.companies.some((company) => company.lastRaise !== null)).toBe(true);
    const done = parseSave(saves["a finished game"], EVENTFUL)!;
    expect(done.game.outcome !== null || done.game.companies[PLAYER_ID].out !== null).toBe(true);
  });

  it("is either ignored or harmless, whichever single value is missing, emptied or of the wrong kind", () => {
    const harms: string[] = [];
    let tried = 0;
    let ignored = 0;
    for (const [name, raw] of Object.entries(saves)) {
      const document = JSON.parse(raw) as Json;
      for (const path of pathsOf(document)) {
        for (const replacement of damagesFor(at(document, path))) {
          tried++;
          const broken = JSON.stringify(damaged(document, path, replacement));
          if (parseSave(broken, EVENTFUL) === null) {
            ignored++;
            continue;
          }
          const harm = harmOf(broken);
          if (harm !== null) harms.push(`${name}: ${path.join(".")} = ${replacement === REMOVED ? "(removed)" : JSON.stringify(replacement)} -> ${harm}`);
        }
      }
    }
    expect(tried).toBeGreaterThan(3_000);
    expect(ignored).toBeGreaterThan(1_000);
    expect(harms.slice(0, 25), `${harms.length} of ${tried} damaged saves were accepted and then went wrong`).toEqual([]);
  });

  it("is ignored when it holds fewer companies than its own report", () => {
    const save = JSON.parse(saves["mid-game"]);
    const three = { ...save, game: { ...save.game, companies: save.game.companies.slice(0, 3) } };
    expect(harmOf(JSON.stringify(three))).toBeNull();
  });
});
