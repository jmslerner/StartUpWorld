import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireContext,
  clearScene,
  CONTEXT_RELEASE_DELAY_MS,
  disposeTree,
  releaseContextWhenOrphaned,
  WorldUnsupportedError,
} from "./GpuLifetime";

/** A WebGL 2 context, as far as getting and releasing one asks of it: whether it is lost, and its lose extension. */
const context = (lost = false) => {
  const state = { lost, losses: 0 };
  const gl = {
    isContextLost: () => state.lost,
    getExtension: (name: string) =>
      name === "WEBGL_lose_context"
        ? {
            loseContext: () => {
              state.losses += 1;
              state.lost = true;
            },
            restoreContext: () => {},
          }
        : null,
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
    const freed: string[] = [];
    const on = (thing: THREE.Texture | THREE.BufferGeometry | THREE.Material, name: string): void => {
      (thing as THREE.EventDispatcher<{ dispose: object }>).addEventListener("dispose", () => freed.push(name));
    };
    const map = new THREE.Texture();
    const box = new THREE.BoxGeometry();
    const basic = new THREE.MeshBasicMaterial({ map });
    const plane = new THREE.PlaneGeometry();
    const lambert = new THREE.MeshLambertMaterial();
    const second = new THREE.MeshBasicMaterial();
    on(map, "map");
    on(box, "box");
    on(basic, "basic");
    on(plane, "plane");
    on(lambert, "lambert");
    on(second, "second");
    const root = new THREE.Group();
    const nested = new THREE.Group();
    root.add(new THREE.Mesh(box, basic), nested);
    nested.add(new THREE.Mesh(plane, [lambert, second]));
    disposeTree(root);
    expect(freed.sort()).toEqual(["basic", "box", "lambert", "map", "plane", "second"]);
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
