/**
 * The fence around the 3D code.
 *
 * 1. `three` is imported only under src/world.
 * 2. Nothing under src/world imports from the rules, the store, the screens, the scene builder or the lab, nor
 *    reaches them by a chain of imports through a folder open to it (src/audio, say). Type imports count, here as
 *    in a direct import.
 * 3. The scene builder (src/scene) never imports three; from the world it imports types only, from
 *    src/world/types. Its tests may also import the world's pure modules: those that do not load three.
 * 4. No chain of static imports from src/main.tsx reaches src/world or three: the 3D code is not in the game's
 *    first load.
 *
 * The rules are checked on the real source files, read with node:fs and parsed with the TypeScript compiler, and
 * each rule is also checked against a small made-up tree that breaks it, so that a rule which stops looking
 * fails here instead of passing in silence.
 *
 * How an import is read:
 * - `import type … from` and `export type … from` are erased, so they are "type" imports. `import { type A } from`
 *   is not: the compiler keeps the import itself, so it counts as a real one.
 * - `import("…")` is a dynamic import: it breaks rules 1 to 3 like any other, and is where a chain of rule 4 stops.
 * - An `import()` of anything but a plain string, and `import.meta.glob`, cannot be followed and are refused.
 * - A relative import that resolves to no file under src is refused too: an import the fence cannot follow is a hole
 *   in it. One that points outside src (the package's own file, say) is outside like a package, and is not judged.
 * - `require("…")` counts as a real import. A call to something named `require` with anything but a plain string is
 *   some other function and is left alone.
 */
/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type ImportKind = "value" | "type" | "dynamic";

interface Import {
  readonly from: string;
  readonly specifier: string;
  readonly kind: ImportKind;
  /** The file a relative import resolves to, from the repository's root. Null for a package or a file outside src. */
  readonly target: string | null;
}

/** Every file of a tree, by its path from the root, with forward slashes. Files that are not code have "". */
type Tree = ReadonlyMap<string, string>;

const WORLD = "src/world/";
const SCENE = "src/scene/";
const ENTRY = "src/main.tsx";
/** Where the world may not look. A trailing slash is a folder; without one, the start of a file's name. */
const CLOSED_TO_THE_WORLD = [
  "src/engine/",
  "src/ai/",
  "src/sim/",
  "src/state/",
  "src/scene/",
  "src/ui/",
  "src/lab/",
  "src/config.",
  "src/App.",
  "src/main.",
];
/** The world's types: the folder, and the barrel beside it. */
const WORLD_TYPES = ["src/world/types/", "src/world/types.ts"];

const isCode = (path: string): boolean => /\.(ts|tsx|mts|cts)$/.test(path);
const isTest = (path: string): boolean => /\.test\.tsx?$/.test(path);
const isThree = (specifier: string): boolean => specifier === "three" || specifier.startsWith("three/");
const startsWithAny = (path: string, prefixes: readonly string[]): boolean => prefixes.some((prefix) => path.startsWith(prefix));

const resolve = (tree: Tree, from: string, specifier: string): string | null => {
  const rooted = specifier.startsWith("/");
  if (!rooted && !specifier.startsWith(".")) return null;
  const bare = specifier.replace(/[?#].*$/, "");
  const base = rooted ? posix.normalize(bare.slice(1)) : posix.normalize(posix.join(posix.dirname(from), bare));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    base.replace(/\.jsx?$/, ".ts"),
    base.replace(/\.jsx?$/, ".tsx"),
  ];
  if (!base.startsWith("src/")) return null;
  const found = candidates.find((candidate) => tree.has(candidate));
  if (found === undefined) throw new Error(`${from} imports ${specifier}, which is no file the fence can find`);
  return found;
};

const importsOfFile = (tree: Tree, from: string, source: string): Import[] => {
  const file = ts.createSourceFile(from, source, ts.ScriptTarget.Latest, false, from.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Import[] = [];
  const add = (specifier: ts.Node | undefined, kind: ImportKind): void => {
    if (specifier === undefined || !ts.isStringLiteralLike(specifier)) {
      throw new Error(`${from} has an import of something that is not a plain string, which the fence cannot follow`);
    }
    found.push({ from, specifier: specifier.text, kind, target: resolve(tree, from, specifier.text) });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      add(node.moduleSpecifier, node.importClause?.isTypeOnly === true ? "type" : "value");
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      add(node.moduleSpecifier, node.isTypeOnly ? "type" : "value");
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, node.isTypeOnly ? "type" : "value");
    } else if (ts.isImportTypeNode(node)) {
      add(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined, "type");
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0], "dynamic");
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      const [first] = node.arguments;
      if (first !== undefined && ts.isStringLiteralLike(first)) add(first, "value");
    } else if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text.startsWith("glob")) {
      throw new Error(`${from} uses import.meta.glob, which the fence cannot follow`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
};

/** A tree is parsed once, whatever the outcome: an import that cannot be followed is refused the same way each time. */
const parsed = new WeakMap<Tree, { readonly found: Import[] } | { readonly refused: unknown }>();
const importsOf = (tree: Tree): Import[] => {
  let known = parsed.get(tree);
  if (known === undefined) {
    try {
      known = { found: [...tree].filter(([path]) => isCode(path)).flatMap(([path, source]) => importsOfFile(tree, path, source)) };
    } catch (refused) {
      known = { refused };
    }
    parsed.set(tree, known);
  }
  if ("refused" in known) throw known.refused;
  return known.found;
};

const say = (found: Import): string =>
  `${found.from} imports ${found.specifier}${found.target === null ? "" : ` (${found.target})`}${found.kind === "value" ? "" : `, as ${found.kind}`}`;

/** Rule 1. */
const threeOutsideTheWorld = (tree: Tree): string[] =>
  importsOf(tree)
    .filter((found) => isThree(found.specifier) && !found.from.startsWith(WORLD))
    .map(say);


/** Each file's imports, worked out once per tree. */
const bySourceOf = new WeakMap<Tree, ReadonlyMap<string, readonly Import[]>>();
const importsBySource = (tree: Tree): ReadonlyMap<string, readonly Import[]> => {
  let known = bySourceOf.get(tree);
  if (known === undefined) {
    const bySource = new Map<string, Import[]>();
    for (const found of importsOf(tree)) bySource.set(found.from, [...(bySource.get(found.from) ?? []), found]);
    known = bySource;
    bySourceOf.set(tree, known);
  }
  return known;
};

/** The first chain of the imports `follow` accepts, from `start` to anything `reached` accepts. */
const chainTo = (
  tree: Tree,
  start: string,
  follow: (found: Import) => boolean,
  reached: (found: Import) => boolean,
): string[] | null => {
  const bySource = importsBySource(tree);
  const cameFrom = new Map<string, string | null>([[start, null]]);
  const chainOf = (path: string): string[] => {
    const before = cameFrom.get(path) ?? null;
    return before === null ? [path] : [...chainOf(before), path];
  };
  const queue = [start];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    for (const found of (bySource.get(at) ?? []).filter(follow)) {
      if (reached(found)) return [...chainOf(at), found.target ?? found.specifier];
      if (found.target !== null && !cameFrom.has(found.target)) {
        cameFrom.set(found.target, at);
        queue.push(found.target);
      }
    }
  }
  return null;
};

const closedToTheWorld = (path: string | null): boolean => path !== null && startsWithAny(path, CLOSED_TO_THE_WORLD);

/**
 * Rule 2: an import from the world straight into a closed place, and a chain of imports of any kind that leaves the
 * world for an open place (src/audio, say) and goes on from there into a closed one. A chain is not followed back into
 * the world: a world file it reaches is judged on its own.
 */
const worldLookingOut = (tree: Tree): string[] => {
  const outOfTheWorld = importsOf(tree).filter((found) => found.from.startsWith(WORLD) && found.target !== null);
  const direct = outOfTheWorld.filter((found) => closedToTheWorld(found.target)).map(say);
  const throughOpenPlaces = outOfTheWorld
    .filter((found) => found.target !== null && !found.target.startsWith(WORLD) && !closedToTheWorld(found.target))
    .map((found) => {
      const chain = chainTo(
        tree,
        found.target ?? "",
        (next) => next.target !== null && !next.target.startsWith(WORLD),
        (next) => closedToTheWorld(next.target),
      );
      return chain === null ? null : `${found.from} reaches ${chain[chain.length - 1]} through ${[found.from, ...chain].join(" -> ")}`;
    })
    .filter((line) => line !== null);
  return [...direct, ...new Set(throughOpenPlaces)];
};

/** Files a chain of static imports from `start` loads, `start` included. */
const loadedWith = (tree: Tree, start: string): string[] => {
  const seen: string[] = [];
  chainTo(
    tree,
    start,
    (found) => found.kind === "value",
    (found) => {
      if (found.target !== null && !seen.includes(found.target)) seen.push(found.target);
      return false;
    },
  );
  return [start, ...seen];
};

const loadsThree = (tree: Tree, start: string): string[] | null =>
  chainTo(tree, start, (found) => found.kind === "value", (found) => isThree(found.specifier));

/** Rule 3. */
const sceneBuilderOverTheFence = (tree: Tree): string[] => {
  const fromScene = importsOf(tree).filter((found) => found.from.startsWith(SCENE));
  const direct = fromScene
    .filter((found) => {
      if (isThree(found.specifier)) return true;
      if (found.target === null || !found.target.startsWith(WORLD)) return false;
      if (isTest(found.from)) return false;
      return found.kind !== "type" || !startsWithAny(found.target, WORLD_TYPES);
    })
    .map(say);
  const throughTheWorld = [...new Set(fromScene.map((found) => found.from))]
    .map((path) => loadsThree(tree, path))
    .filter((chain) => chain !== null)
    .map((chain) => `three is loaded by ${chain.join(" -> ")}`);
  return [...direct, ...throughTheWorld];
};

/** Rule 4. */
const firstLoadReachingTheWorld = (tree: Tree): string[] => {
  if (!tree.has(ENTRY)) throw new Error(`${ENTRY} is not there: the first load cannot be checked`);
  const chain = chainTo(
    tree,
    ENTRY,
    (found) => found.kind === "value",
    (found) => isThree(found.specifier) || (found.target !== null && found.target.startsWith(WORLD)),
  );
  return chain === null ? [] : [chain.join(" -> ")];
};

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const readTree = (): Tree => {
  const tree = new Map<string, string>();
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const path = relative(ROOT, full).split(sep).join("/");
      tree.set(path, isCode(path) ? readFileSync(full, "utf8") : "");
    }
  };
  walk(join(ROOT, "src"));
  return tree;
};

/** A made-up tree: the game's entry and one screen, then whatever the case adds. */
const made = (files: Record<string, string>): Tree =>
  new Map(Object.entries({ "src/main.tsx": `import App from "./App.tsx";`, "src/App.tsx": `export default null;`, ...files }));

describe("the boundary, on this repository's source", () => {
  const tree = readTree();

  it("reads the source it is meant to read", () => {
    const code = [...tree.keys()].filter(isCode);
    expect(code).toContain(ENTRY);
    expect(code).toContain("src/world/boundary.test.ts");
    expect(code.some((path) => path.startsWith("src/engine/"))).toBe(true);
    expect(code.some((path) => path.startsWith("src/ui/") && path.endsWith(".tsx"))).toBe(true);
    // The walk from the entry goes through the screens to the rules: it does not stop at the first file.
    const loaded = loadedWith(tree, ENTRY);
    expect(loaded).toContain("src/App.tsx");
    expect(loaded.some((path) => path.startsWith("src/engine/"))).toBe(true);
    expect(loaded.some((path) => path.startsWith("src/ui/"))).toBe(true);
  });

  it("three is imported only under src/world", () => {
    expect(threeOutsideTheWorld(tree)).toEqual([]);
  });

  it("the world imports nothing from the rules, the store, the screens, the scene builder or the lab", () => {
    expect(worldLookingOut(tree)).toEqual([]);
  });

  it("the scene builder never imports three, and from the world only types under src/world/types", () => {
    expect(sceneBuilderOverTheFence(tree)).toEqual([]);
  });

  it("no chain of static imports from src/main.tsx reaches src/world or three", () => {
    expect(firstLoadReachingTheWorld(tree)).toEqual([]);
  });
});

describe("the boundary can fail", () => {
  it("passes a tree that keeps the rules", () => {
    const tree = made({
      "src/App.tsx": `import type { OfficeScene } from "./world/types/scene"; export const view = () => import("./world/WorldView"); export type S = OfficeScene;`,
      "src/engine/index.ts": `export const DEPARTMENTS = [];`,
      "src/world/types/scene.ts": `export type OfficeScene = { year: number };`,
      "src/world/types.ts": `export type * from "./types/scene";`,
      "src/world/cast.ts": `import type { OfficeScene } from "./types"; export const MAX = 50; export type S = OfficeScene;`,
      "src/world/core/World.ts": `import * as THREE from "three"; import { OrbitControls } from "three/addons/controls/OrbitControls.js"; export const w = [THREE, OrbitControls];`,
      "src/world/WorldView.tsx": `import { w } from "./core/World"; import "./world.css"; export default w;`,
      "src/world/world.css": "",
      "src/scene/officeScene.ts": `import { DEPARTMENTS } from "../engine"; import type { OfficeScene } from "../world/types/scene"; import type { OfficeScene as B } from "../world/types"; export type S = [OfficeScene, B, typeof DEPARTMENTS];`,
      "src/scene/officeScene.test.ts": `import { MAX } from "../world/cast"; import { DEPARTMENTS } from "../engine/index.ts"; export const t = [MAX, DEPARTMENTS];`,
    });
    expect([threeOutsideTheWorld(tree), worldLookingOut(tree), sceneBuilderOverTheFence(tree), firstLoadReachingTheWorld(tree)]).toEqual([[], [], [], []]);
  });

  it("rule 1: three outside the world, however it is imported", () => {
    const tree = made({
      "src/ui/a.tsx": `import * as THREE from "three"; export const a = THREE;`,
      "src/ui/b.ts": `import type { Vector3 } from "three"; export type V = Vector3;`,
      "src/ui/c.ts": `export const c = () => import("three/addons/x.js");`,
      "src/ui/d.test.ts": `export { Scene } from "three";`,
      "src/ui/e.ts": `export type V = import("three").Vector3;`,
      "src/ui/threescore.ts": `import "threescore"; // three in a comment: import "three"`,
      "src/world/ok.ts": `import * as THREE from "three"; export const ok = THREE;`,
    });
    expect(threeOutsideTheWorld(tree)).toEqual([
      "src/ui/a.tsx imports three",
      "src/ui/b.ts imports three, as type",
      "src/ui/c.ts imports three/addons/x.js, as dynamic",
      "src/ui/d.test.ts imports three",
      "src/ui/e.ts imports three, as type",
    ]);
  });

  it("rule 2: the world looking at each of the places closed to it, types and tests included", () => {
    const closed = {
      "src/engine/types.ts": "",
      "src/ai/cpu.ts": "",
      "src/sim/run.ts": "",
      "src/state/store.ts": "",
      "src/scene/officeScene.ts": "",
      "src/ui/Screen.tsx": "",
      "src/lab/labScene.ts": "",
      "src/config.ts": "",
      "src/config.design.ts": "",
    };
    const specifiers = ["../engine/types", "../ai/cpu.ts", "../sim/run", "../state/store", "../scene/officeScene", "../ui/Screen", "../lab/labScene", "../config", "../config.design", "../App", "../main.tsx"];
    for (const specifier of specifiers) {
      const tree = made({ ...closed, "src/world/scratch.ts": `import type { X } from "${specifier}"; export type Y = X;` });
      expect(worldLookingOut(tree), specifier).toHaveLength(1);
    }
    const deep = made({
      ...closed,
      "src/world/office/deep/a.test.ts": `import { x } from "../../../engine/types"; export const y = x;`,
      "src/world/b.ts": `export * from "../state/store";`,
      "src/world/c.ts": `export const c = () => import("../ui/Screen");`,
      "src/world/d.ts": `import { e } from "./e"; import { clamp } from "../audio/x"; export const d = [e, clamp];`,
      "src/world/e.ts": `export const e = 1;`,
      "src/audio/x.ts": `export const clamp = 1;`,
    });
    expect(worldLookingOut(deep)).toEqual([
      "src/world/office/deep/a.test.ts imports ../../../engine/types (src/engine/types.ts)",
      "src/world/b.ts imports ../state/store (src/state/store.ts)",
      "src/world/c.ts imports ../ui/Screen (src/ui/Screen.tsx), as dynamic",
    ]);
  });

  it("rule 2: the world reaching a closed place through an open one, by value or by type, is caught with its chain", () => {
    const tree = made({
      "src/engine/index.ts": `export const DEPARTMENTS = [];`,
      "src/engine/types.ts": `export type Office = {};`,
      "src/state/store.ts": `export const store = 1;`,
      "src/audio/index.ts": `export * from "./engine";`,
      "src/audio/engine.ts": `import { DEPARTMENTS } from "../engine"; export const play = DEPARTMENTS;`,
      "src/audio/kinds.ts": `import type { Office } from "../engine/types"; export type Kind = Office;`,
      "src/audio/back.ts": `import { a } from "../world/a"; export const back = a;`,
      "src/audio/clean.ts": `export const clean = 1;`,
      "src/world/a.ts": `import { play } from "../audio"; export const a = play;`,
      "src/world/b.ts": `import type { Kind } from "../audio/kinds"; export type B = Kind;`,
      "src/world/c.ts": `import { back } from "../audio/back"; import { clean } from "../audio/clean"; export const c = [back, clean];`,
      "src/world/d.ts": `export const later = () => import("../audio/engine");`,
    });
    expect(worldLookingOut(tree)).toEqual([
      "src/world/a.ts reaches src/engine/index.ts through src/world/a.ts -> src/audio/index.ts -> src/audio/engine.ts -> src/engine/index.ts",
      "src/world/b.ts reaches src/engine/types.ts through src/world/b.ts -> src/audio/kinds.ts -> src/engine/types.ts",
      "src/world/d.ts reaches src/engine/index.ts through src/world/d.ts -> src/audio/engine.ts -> src/engine/index.ts",
    ]);
  });

  it("rule 3: the scene builder importing three, a value from the world, or a type from outside its types", () => {
    const world = {
      "src/world/types/scene.ts": `export const TEAMS = []; export type OfficeScene = {};`,
      "src/world/cast.ts": `export const MAX = 50; export type Cast = {};`,
      "src/world/core/World.ts": `import * as THREE from "three"; export const w = THREE;`,
      "src/world/office/layouts.ts": `import { w } from "../core/World"; export const DESKS = [w];`,
    };
    const one = (source: string, path = "src/scene/officeScene.ts"): string[] => sceneBuilderOverTheFence(made({ ...world, [path]: source }));
    expect(one(`import type { Vector3 } from "three"; export type V = Vector3;`)).toEqual(["src/scene/officeScene.ts imports three, as type"]);
    expect(one(`import { TEAMS } from "../world/types/scene"; export const t = TEAMS;`)).toEqual([
      "src/scene/officeScene.ts imports ../world/types/scene (src/world/types/scene.ts)",
    ]);
    expect(one(`import { type OfficeScene } from "../world/types/scene"; export type S = OfficeScene;`)).toHaveLength(1);
    expect(one(`import type { Cast } from "../world/cast"; export type C = Cast;`)).toEqual([
      "src/scene/officeScene.ts imports ../world/cast (src/world/cast.ts), as type",
    ]);
    expect(one(`export const later = () => import("../world/types/scene");`)).toHaveLength(1);
    // A test of the scene builder may use the world's pure modules, and no module that loads three.
    expect(one(`import { MAX } from "../world/cast"; export const m = MAX;`, "src/scene/officeScene.test.ts")).toEqual([]);
    expect(one(`import { DESKS } from "../world/office/layouts"; export const d = DESKS;`, "src/scene/officeScene.test.ts")).toEqual([
      "three is loaded by src/scene/officeScene.test.ts -> src/world/office/layouts.ts -> src/world/core/World.ts -> three",
    ]);
  });

  it("rule 4: a static chain from the entry to the world or to three, through re-exports and bare imports", () => {
    const chain = (files: Record<string, string>): string[] => firstLoadReachingTheWorld(made(files));
    expect(chain({ "src/App.tsx": `import View from "./world/WorldView"; export default View;`, "src/world/WorldView.tsx": `export default null;` })).toEqual([
      "src/main.tsx -> src/App.tsx -> src/world/WorldView.tsx",
    ]);
    expect(
      chain({
        "src/App.tsx": `export * from "./ui/a"; export default null;`,
        "src/ui/a.ts": `import "./b";`,
        "src/ui/b.ts": `export { cast } from "../world/cast";`,
        "src/world/cast.ts": `export const cast = 1;`,
      }),
    ).toEqual(["src/main.tsx -> src/App.tsx -> src/ui/a.ts -> src/ui/b.ts -> src/world/cast.ts"]);
    expect(chain({ "src/App.tsx": `import { a } from "./ui/a"; export default a;`, "src/ui/a.ts": `import * as THREE from "three"; export const a = THREE;` })).toEqual([
      "src/main.tsx -> src/App.tsx -> src/ui/a.ts -> three",
    ]);
    // An inline `type` keeps the import in the code that runs.
    expect(chain({ "src/App.tsx": `import { type S } from "./world/types/scene"; export default null as S | null;`, "src/world/types/scene.ts": `export type S = {};` })).toHaveLength(1);
    // A dynamic import is where a chain may stop, and an erased import is no link in it.
    expect(
      chain({
        "src/App.tsx": `import type { S } from "./world/types/scene"; export const view = () => import("./world/WorldView"); export default null as S | null;`,
        "src/world/types/scene.ts": `export type S = {};`,
        "src/world/WorldView.tsx": `import * as THREE from "three"; export default THREE;`,
      }),
    ).toEqual([]);
  });

  it("refuses what it cannot follow", () => {
    expect(() => worldLookingOut(made({ "src/world/a.ts": `import { x } from "../engine/gone"; export const y = x;` }))).toThrow("no file the fence can find");
    expect(() => worldLookingOut(made({ "src/world/a.ts": `const where = "../engine/types"; export const y = () => import(where);` }))).toThrow("not a plain string");
    expect(() => worldLookingOut(made({ "src/world/a.ts": `export const all = import.meta.glob("../engine/*.ts");` }))).toThrow("import.meta.glob");
    expect(() => firstLoadReachingTheWorld(new Map([["src/App.tsx", ""]]))).toThrow("is not there");
  });

  it("leaves alone a call to require that is not an import, and counts one that is", () => {
    const tree = made({
      "src/ui/a.ts": `declare const require: (name: string) => unknown; const name = "three"; export const a = [require(name), require(), require(\`\${name}/x\`)];`,
      "src/ui/b.ts": `declare const require: (name: string) => unknown; export const b = require("three");`,
    });
    expect(threeOutsideTheWorld(tree)).toEqual(["src/ui/b.ts imports three"]);
  });

  it("treats a relative import that leaves src as outside, and still refuses one inside src that is no file", () => {
    const tree = made({
      "src/world/a.ts": `import pkg from "../../package.json"; import "/vite.config.ts"; import "../../scripts/gone"; export const a = pkg;`,
      "src/world/b.ts": `import "../engine/../../src-old/x";`,
    });
    expect(worldLookingOut(tree)).toEqual([]);
    expect(firstLoadReachingTheWorld(tree)).toEqual([]);
    expect(() => worldLookingOut(made({ "src/world/a.ts": `import "../../src/engine/gone";` }))).toThrow("no file the fence can find");
    expect(() => worldLookingOut(made({ "src/world/a.ts": `import "./gone.css";` }))).toThrow("no file the fence can find");
  });

  it("parses a tree once, and refuses a bad one the same way every time without reading it again", () => {
    let reads = 0;
    const counted = (files: Record<string, string>): Tree => {
      const tree = new Map(made(files));
      const entries = tree.entries.bind(tree);
      tree[Symbol.iterator] = () => {
        reads += 1;
        return entries();
      };
      return tree;
    };
    const good = counted({ "src/world/a.ts": `export const a = 1;` });
    for (const rule of [threeOutsideTheWorld, worldLookingOut, sceneBuilderOverTheFence, firstLoadReachingTheWorld]) expect(rule(good)).toEqual([]);
    expect(reads).toBe(1);
    const bad = counted({ "src/world/a.ts": `import "../engine/gone";` });
    const refusals = [threeOutsideTheWorld, worldLookingOut, sceneBuilderOverTheFence, firstLoadReachingTheWorld].map((rule) => {
      try {
        rule(bad);
        return null;
      } catch (refused) {
        return refused;
      }
    });
    expect(refusals[0]).toBeInstanceOf(Error);
    expect(refusals.every((refused) => refused === refusals[0])).toBe(true);
    expect(reads).toBe(2);
  });

  it("follows an address from the root, a query on a file, and a folder's index", () => {
    const tree = made({
      "src/engine/index.ts": "",
      "src/engine/data.ts": "",
      "src/world/a.ts": `import "/src/engine/data.ts?raw"; import "../engine"; import "../engine/data.js";`,
    });
    expect(worldLookingOut(tree)).toEqual([
      "src/world/a.ts imports /src/engine/data.ts?raw (src/engine/data.ts)",
      "src/world/a.ts imports ../engine (src/engine/index.ts)",
      "src/world/a.ts imports ../engine/data.js (src/engine/data.ts)",
    ]);
  });
});
