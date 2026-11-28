import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireContext,
  clearScene,
  CONTEXT_RELEASE_DELAY_MS,
  disposeTree,
  GpuLifetime,
  releaseContextWhenOrphaned,
  WorldUnsupportedError,
} from "./GpuLifetime";
import { configureRenderer } from "./rendererLook";

/**
 * What the class does, in order: the renderer made (or refusing to start), configured, reset and disposed, the shared
 * caches emptied, the systems stopped, and every geometry, material and texture disposed, each by name.
 */
const fakes = vi.hoisted(() => {
  const log: string[] = [];
  const renderers = { fail: null as Error | null };
  class FakeRenderer {
    readonly options: unknown;
    constructor(options: unknown) {
      if (renderers.fail !== null) throw renderers.fail;
      this.options = options;
      log.push("renderer");
    }
    resetState(): void {
      log.push("resetState");
    }
    dispose(): void {
      log.push("dispose");
    }
  }
  return { log, renderers, FakeRenderer };
});

// The real three.js but for its renderer, which needs a real GPU.
vi.mock("three", async (importOriginal) => ({ ...(await importOriginal<typeof import("three")>()), WebGLRenderer: fakes.FakeRenderer }));
vi.mock("./rendererLook", () => ({
  configureRenderer: vi.fn(() => {
    fakes.log.push("configure");
  }),
}));
vi.mock("./palette", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./palette")>()),
  disposeSharedResources: () => {
    fakes.log.push("shared");
  },
}));

/** A WebGL 2 context, as far as getting and releasing one asks of it: whether it is lost, and its lose extension. */
const context = (lost = false) => {
  const state = { lost, losses: 0, restores: 0 };
  const gl = {
    isContextLost: () => state.lost,
    getExtension: (name: string) => {
      fakes.log.push(`extension ${name}`);
      return name === "WEBGL_lose_context"
        ? {
            loseContext: () => {
              state.losses += 1;
              state.lost = true;
            },
            restoreContext: () => {
              state.restores += 1;
              state.lost = false;
            },
          }
        : null;
    },
  };
  return { gl: gl as unknown as WebGL2RenderingContext, state };
};

const canvasWith = (getContext: (kind: string, attributes: unknown) => unknown, isConnected = true): HTMLCanvasElement =>
  ({ getContext, isConnected }) as unknown as HTMLCanvasElement;

/** The page's timers, faked: the release waits on window.setTimeout. */
const fakePageTimers = (): void => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  });
};

beforeEach(() => {
  fakes.log.length = 0;
  fakes.renderers.fail = null;
  vi.mocked(configureRenderer).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Log each dispose of `thing` as `name`. */
const logDispose = (thing: THREE.Texture | THREE.BufferGeometry | THREE.Material, name: string): void => {
  (thing as THREE.EventDispatcher<{ dispose: object }>).addEventListener("dispose", () => fakes.log.push(name));
};

describe("GpuLifetime: getting a context", () => {
  it("asks the canvas for WebGL 2 with exactly the attributes the renderer would ask for itself", () => {
    const { gl } = context();
    const asked: unknown[] = [];
    const canvas = canvasWith((kind, attributes) => {
      asked.push([kind, attributes]);
      return gl;
    });
    expect(acquireContext(canvas)).toBe(gl);
    expect(asked).toEqual([
      [
        "webgl2",
        {
          alpha: true,
          antialias: true,
          depth: true,
          stencil: false,
          premultipliedAlpha: true,
          preserveDrawingBuffer: false,
          powerPreference: "high-performance",
          failIfMajorPerformanceCaveat: false,
        },
      ],
    ]);
  });

  it.each([
    ["gives none", () => null, "This browser or device cannot create a WebGL 2 context."],
    [
      "throws",
      () => {
        throw new Error("refused");
      },
      "This browser or device cannot create a WebGL 2 context.",
    ],
    ["gives one already lost", () => context(true).gl, "The WebGL context for this canvas has been lost."],
  ])("says why there is no world when the canvas %s", (_, getContext, message) => {
    let thrown: unknown = null;
    try {
      acquireContext(canvasWith(getContext));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WorldUnsupportedError);
    expect((thrown as Error).name).toBe("WorldUnsupportedError");
    expect((thrown as Error).message).toBe(message);
  });
});

describe("GpuLifetime: releasing a context", () => {
  it("hands a disposed world's context back once its canvas has left the page, and never while it is on the page", () => {
    fakePageTimers();
    const offPage = context();
    const onPage = context();
    releaseContextWhenOrphaned(canvasWith(() => offPage.gl, false), offPage.gl);
    releaseContextWhenOrphaned(canvasWith(() => onPage.gl, true), onPage.gl);
    vi.advanceTimersByTime(CONTEXT_RELEASE_DELAY_MS - 1);
    expect(offPage.state.losses).toBe(0);
    vi.advanceTimersByTime(1);
    expect(offPage.state.losses).toBe(1);
    expect(onPage.state.losses).toBe(0);
  });

  it("keeps the context when a world is made on the same canvas again before the release is due (React StrictMode)", () => {
    fakePageTimers();
    const { gl, state } = context();
    const canvas = canvasWith(() => gl, false);
    releaseContextWhenOrphaned(canvas, gl);
    expect(acquireContext(canvas)).toBe(gl);
    vi.runAllTimers();
    expect(state.losses).toBe(0);
  });
});

describe("GpuLifetime: freeing what is on stage", () => {
  it("frees every geometry, material and material texture of a tree, however deep", () => {
    const map = new THREE.Texture();
    const box = new THREE.BoxGeometry();
    const basic = new THREE.MeshBasicMaterial({ map });
    const plane = new THREE.PlaneGeometry();
    const lambert = new THREE.MeshLambertMaterial();
    const second = new THREE.MeshBasicMaterial();
    logDispose(map, "map");
    logDispose(box, "box");
    logDispose(basic, "basic");
    logDispose(plane, "plane");
    logDispose(lambert, "lambert");
    logDispose(second, "second");
    const root = new THREE.Group();
    const nested = new THREE.Group();
    root.add(new THREE.Mesh(box, basic), nested);
    nested.add(new THREE.Mesh(plane, [lambert, second]));
    disposeTree(root);
    expect([...fakes.log].sort()).toEqual(["basic", "box", "lambert", "map", "plane", "second"]);
  });

  it("takes everything but what it keeps off the scene, and frees what it took", () => {
    const scene = new THREE.Scene();
    const kept = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const leftover = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const left = new THREE.Group();
    left.add(leftover);
    const empty = new THREE.Group();
    scene.add(kept, left, empty);
    const freed: string[] = [];
    kept.geometry.addEventListener("dispose", () => freed.push("kept"));
    leftover.geometry.addEventListener("dispose", () => freed.push("leftover"));
    clearScene(scene, new Set<THREE.Object3D>([kept]));
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBe(kept);
    expect(left.parent).toBeNull();
    expect(empty.parent).toBeNull();
    expect(freed).toEqual(["leftover"]);
  });
});

describe("GpuLifetime: the class, from the context to its release", () => {
  it("makes the renderer on the context it got, configures it, and only then fetches the extension that loses it", () => {
    const { gl } = context();
    const canvas = canvasWith(() => gl);
    const gpu = new GpuLifetime(canvas, "low");
    expect(fakes.log).toEqual(["renderer", "configure", "extension WEBGL_lose_context"]);
    expect((gpu.renderer as unknown as { options: unknown }).options).toEqual({
      canvas,
      context: gl,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    expect(vi.mocked(configureRenderer)).toHaveBeenCalledWith(gpu.renderer, "low");
  });

  it("says why when the renderer cannot start, with its error as the cause, and builds nothing without a context", () => {
    const failure = new Error("the renderer cannot start");
    fakes.renderers.fail = failure;
    let thrown: unknown = null;
    try {
      new GpuLifetime(canvasWith(() => context().gl), "high");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WorldUnsupportedError);
    expect((thrown as Error).message).toBe("WebGL 2 is available, but the renderer could not start.");
    expect((thrown as Error).cause).toBe(failure);

    fakes.renderers.fail = null;
    expect(() => new GpuLifetime(canvasWith(() => null), "high")).toThrow(WorldUnsupportedError);
    // Neither got as far as a renderer, its look or the extension.
    expect(fakes.log).toEqual([]);
  });

  it("takes the context away only while there is one, and gives it back only once it has gone", () => {
    const { gl, state } = context();
    const gpu = new GpuLifetime(canvasWith(() => gl), "high");
    gpu.restoreContext();
    expect(state.restores).toBe(0);
    gpu.loseContext();
    gpu.loseContext();
    expect(state.losses).toBe(1);
    gpu.restoreContext();
    gpu.restoreContext();
    expect(state.restores).toBe(1);
  });

  it("hands the stage back in its one order: systems stopped, the rest freed, every noted material again, the caches, the renderer", () => {
    const gpu = new GpuLifetime(canvasWith(() => context().gl), "high");
    const scene = new THREE.Scene();
    const map = new THREE.Texture();
    const kept = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map }));
    const takenOff = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(kept, takenOff);
    logDispose(kept.geometry, "kept geometry");
    logDispose(map, "kept map");
    logDispose(kept.material, "kept material");
    logDispose(takenOff.geometry, "taken-off geometry");
    logDispose(takenOff.material, "taken-off material");
    fakes.log.length = 0;
    gpu.disposeStage(scene, () => {
      fakes.log.push("stop");
      // A system takes its mesh off the stage as it goes, and leaves its material behind.
      scene.remove(takenOff);
    });
    expect(fakes.log).toEqual([
      "stop",
      "kept geometry",
      "kept map",
      "kept material",
      // The materials noted before the systems stopped, the one freed with its tree a second time (the L5 note).
      "kept material",
      "taken-off material",
      "shared",
      "resetState",
      "dispose",
    ]);
    expect(scene.children).toHaveLength(0);
  });

  it("released, hands the context back 300 ms later once the canvas has left the page, unless a world is made on it again", () => {
    fakePageTimers();
    const first = context();
    new GpuLifetime(canvasWith(() => first.gl, false), "high").release();
    vi.advanceTimersByTime(299);
    expect(first.state.losses).toBe(0);
    vi.advanceTimersByTime(1);
    expect(first.state.losses).toBe(1);

    // React StrictMode: a second world on the same canvas before the release is due keeps the context.
    const again = context();
    const canvas = canvasWith(() => again.gl, false);
    new GpuLifetime(canvas, "high").release();
    new GpuLifetime(canvas, "high");
    vi.runAllTimers();
    expect(again.state.losses).toBe(0);
  });
});
