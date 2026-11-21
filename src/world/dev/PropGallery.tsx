/**
 * Dev-only review page for every procedural prop and character: /world-gallery
 *
 * Query params
 *   ?set=workstations|stations|building|decor|assets|markers|people|all   (default all)
 *   ?style=garage|coworking|office|unicorn|public   phase for style-keyed props (default: one of each)
 *   ?zoom=<number>      multiply the auto-fit zoom
 *   ?dusk=1             ember dusk lighting with every emissive part glowing (same as ?light=dusk)
 *   ?light=morning|afternoon|dusk|night   time of day (default morning)
 *   ?only=<a,b,…>       keep only props whose id contains one of the texts (close-ups)
 *   ?labels=0           hide labels
 *
 * Drag to pan, wheel to zoom. Same lighting recipe as the game (it mirrors the
 * keys in core/Lighting.ts): hemisphere + one shadow-casting sun + a soft fill,
 * neutral tone mapping, isometric orthographic camera.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { CompanyPhase, TeamRole } from "../../types/game";
import type { PersonView } from "../types";
import { bakeModel, disposeSharedResources, modelMesh, PHASES } from "../core/palette";
import { createChair, createDesk, createOverflowSpot, DESK_STYLES, PROP_CATALOG, PROP_SETS } from "../office/props";
import type { PropHandle, PropSet } from "../office/props";
import { CHARACTER_POSES, createCharacter } from "../people/Character";
import type { CharacterPose } from "../people/Character";

type GallerySet = PropSet | "people" | "all";
type TimeOfDay = "morning" | "afternoon" | "dusk" | "night";

interface GalleryParams {
  set: GallerySet;
  phase: CompanyPhase | null;
  zoom: number;
  light: TimeOfDay;
  /** Lower-case id fragments; empty = everything. */
  only: readonly string[];
  labels: boolean;
}

/** One thing standing on the gallery floor. */
interface GalleryItem {
  label: string;
  object: THREE.Object3D;
  w: number;
  d: number;
  /** Items sharing a row id are laid out on the same row. */
  rowId: string;
  /** Hangs on a wall: the gallery stands a piece of wall behind it. */
  wallHung?: boolean;
  /** Lowest point of the item (slabs go below y = 0): its tile is dropped to match. */
  minY?: number;
  update?: (dt: number, elapsed: number) => void;
  setGlow?: (amount: number) => void;
  dispose: () => void;
}

interface PlacedItem {
  item: GalleryItem;
  x: number;
  z: number;
  height: number;
}

const AZIMUTH = Math.PI / 4;
/** True-isometric elevation, as in office/framing.ts. */
const ELEVATION = Math.atan(Math.SQRT1_2);
const SIN_ELEVATION = Math.sin(ELEVATION);
const COS_ELEVATION = Math.cos(ELEVATION);
const CAMERA_DISTANCE = 150;
const BACKGROUND = "#0d0f12";
const TILE_COLOR = 0x8d939b;
const BACKDROP_COLOR = 0xe9e1d0;
const TILE_MARGIN = 0.28;
/** Screen-space gaps (world units as seen by the camera) between tiles and between rows. */
const GAP_ACROSS = 0.35;
const GAP_ROWS = 0.75;
/** Matches footprints.WALL_GAP / WALL_HEIGHT: how wall-hung props meet their wall. */
const WALL_GAP = 0.05;
const WALL_HEIGHT = 2.6;
const TIMES: readonly TimeOfDay[] = ["morning", "afternoon", "dusk", "night"];
const ROLES: readonly TeamRole[] = ["engineering", "design", "product", "data", "marketing", "sales", "ops", "hr", "legal", "executive"];

const parseParams = (search: string): GalleryParams => {
  const query = new URLSearchParams(search);
  const set = query.get("set");
  const style = query.get("style");
  const zoom = Number(query.get("zoom"));
  const light = query.get("light");
  const isSet = (value: string | null): value is GallerySet =>
    value === "people" || value === "all" || (PROP_SETS as readonly string[]).includes(value ?? "");
  const isTime = (value: string | null): value is TimeOfDay => (TIMES as readonly string[]).includes(value ?? "");
  return {
    set: isSet(set) ? set : "all",
    phase: (PHASES as readonly string[]).includes(style ?? "") ? (style as CompanyPhase) : null,
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
    light: query.get("dusk") === "1" ? "dusk" : isTime(light) ? light : "morning",
    only: (query.get("only") ?? "")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0),
    labels: query.get("labels") !== "0",
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Content
// ─────────────────────────────────────────────────────────────────────────────

/** Does `id` pass the ?only= filter? */
const wanted = (params: GalleryParams, id: string): boolean => params.only.length === 0 || params.only.some((part) => id.includes(part));

const fromHandle = (label: string, rowId: string, handle: PropHandle, demo?: (elapsed: number) => void): GalleryItem => ({
  label,
  rowId,
  object: handle.group,
  w: handle.footprint.w,
  d: handle.footprint.d,
  update:
    handle.update || demo
      ? (dt, elapsed) => {
          demo?.(elapsed);
          handle.update?.(dt, elapsed);
        }
      : undefined,
  setGlow: handle.setGlow ? (amount) => handle.setGlow?.(amount) : undefined,
  dispose: () => handle.dispose(),
});

const catalogItems = (params: GalleryParams): GalleryItem[] => {
  const items: GalleryItem[] = [];
  for (const entry of PROP_CATALOG) {
    if (params.set !== "all" && params.set !== entry.set) continue;
    if (!wanted(params, entry.id)) continue;
    const phases: readonly CompanyPhase[] = entry.styled ? (params.phase ? [params.phase] : PHASES) : [params.phase ?? "office"];
    for (const phase of phases) {
      const { handle, demo } = entry.create(phase);
      // Unstyled props flow together; each styled prop gets a row of its five phases.
      const rowId = entry.styled && !params.phase ? entry.id : entry.set;
      // In a row of five phases only the first needs the full name.
      const label = !entry.styled ? entry.label : phase === phases[0] ? `${entry.label} · ${phase}` : phase;
      const item = fromHandle(label, rowId, handle, demo);
      item.wallHung = entry.mount === "wall";
      item.minY = entry.minY;
      items.push(item);
    }
  }
  return items;
};

const personView = (id: string, role: TeamRole | null, look: number): PersonView => ({
  id,
  kind: role ? "employee" : id === "founder" ? "founder" : "cofounder",
  role,
  name: id,
  look,
});

/** A character with whatever furniture its pose needs, as one gallery item. */
const personItem = (label: string, rowId: string, view: PersonView, pose: CharacterPose): GalleryItem => {
  const root = new THREE.Group();
  const character = createCharacter(view);
  const extras: PropHandle[] = [];
  root.add(character.group);
  if (pose === "floor-sit") {
    const beanbag = createOverflowSpot({ variant: view.look % 6 });
    beanbag.setOccupied(true);
    extras.push(beanbag);
  } else if (pose === "sit" || pose === "type" || pose === "slump" || pose === "sleep") {
    extras.push(createChair({ style: "standard" }));
  }
  for (const extra of extras) root.add(extra.group);
  character.setPose(pose, { immediate: true });
  character.setWalkSpeed(1.1);
  return {
    label,
    rowId,
    object: root,
    w: 0.7,
    d: 0.7,
    update: (dt, elapsed) => {
      character.update(dt, elapsed);
      for (const extra of extras) extra.update?.(dt, elapsed);
    },
    dispose: () => {
      character.dispose();
      for (const extra of extras) extra.dispose();
    },
  };
};

const peopleItems = (params: GalleryParams): GalleryItem[] => {
  const cast: Array<{ id: string; role: TeamRole | null }> = [
    { id: "founder", role: null },
    { id: "cofounder", role: null },
    ...ROLES.map((role) => ({ id: role, role })),
  ];
  const items: GalleryItem[] = [];
  cast.forEach((person, row) => {
    if (!wanted(params, person.id)) return;
    CHARACTER_POSES.forEach((pose, column) => {
      // A different look in every cell shows off the variety; the row keeps its outfit.
      const view = personView(person.id, person.role, (row * 7919 + column * 104729 + 12345) >>> 0);
      items.push(personItem(column === 0 ? `${person.id} · ${pose}` : pose, `people-${person.id}`, view, pose));
    });
  });
  return items;
};

/** Desks with a chair and someone working at them — the composition players actually stare at. */
const workstationScenes = (params: GalleryParams): GalleryItem[] => {
  if (!wanted(params, "in-use")) return [];
  const scenes: GalleryItem[] = [];
  DESK_STYLES.forEach((style, i) => {
    // Each style twice: seen from behind the sitter, and facing the camera.
    for (const facing of [Math.PI, 0]) {
      const root = new THREE.Group();
      const desk = createDesk({ style, upgraded: facing === 0, variant: i });
      const chair = createChair({ style });
      const role = ROLES[(i * 2 + (facing === 0 ? 1 : 0)) % ROLES.length];
      const character = createCharacter(personView(role, role, 4242 + i * 977 + (facing === 0 ? 31 : 0)));
      // Desk-local frame: the seat is 0.55 behind the desk centre. Shift the lot so the pair is centred on its tile.
      desk.group.position.z = 0.3;
      chair.group.position.z = -0.25;
      character.group.position.z = -0.25;
      character.setPose("type", { immediate: true });
      root.add(desk.group, chair.group, character.group);
      root.rotation.y = facing;
      scenes.push({
        label: `in use · ${style}${facing === 0 ? " · upgraded" : ""}`,
        rowId: "in-use",
        object: root,
        w: 1.3,
        d: 1.5,
        update: (dt, elapsed) => character.update(dt, elapsed),
        setGlow: (amount) => desk.setGlow?.(amount),
        dispose: () => {
          desk.dispose();
          chair.dispose();
          character.dispose();
        },
      });
    }
  });
  return scenes;
};

// ─────────────────────────────────────────────────────────────────────────────
// Layout: rows run across the SCREEN (not along a world axis), so nothing
// stands in front of its neighbour and labels read like a contact sheet.
// ─────────────────────────────────────────────────────────────────────────────

/** Half the on-screen width of an item's tile (a square tile is a diamond on screen). */
const halfAcross = (item: GalleryItem): number => (item.w / 2 + item.d / 2 + TILE_MARGIN * 2) * Math.SQRT1_2;

const measureHeight = (item: GalleryItem): number => {
  const box = new THREE.Box3().setFromObject(item.object);
  const top = Number.isFinite(box.max.y) ? box.max.y : 1;
  return Math.max(0.4, item.wallHung ? Math.max(top, WALL_HEIGHT) : top);
};

interface Row {
  items: Array<{ item: GalleryItem; height: number }>;
  across: number;
}

interface Sheet {
  placed: PlacedItem[];
  /** On-screen extent of the whole sheet, in world units. */
  width: number;
  height: number;
}

/**
 * Break the items into rows no wider than `maxAcross`. Items that share a rowId
 * stay together when they can, and a new group only joins a row it fits in.
 */
const splitRows = (items: readonly GalleryItem[], heights: ReadonlyMap<GalleryItem, number>, maxAcross: number): Row[] => {
  const widthOf = (item: GalleryItem): number => halfAcross(item) * 2 + GAP_ACROSS;
  const rows: Row[] = [];
  let current: Row = { items: [], across: 0 };
  const flush = (): void => {
    if (current.items.length > 0) rows.push(current);
    current = { items: [], across: 0 };
  };
  let index = 0;
  while (index < items.length) {
    let end = index;
    let groupWidth = 0;
    while (end < items.length && items[end].rowId === items[index].rowId) {
      groupWidth += widthOf(items[end]);
      end += 1;
    }
    if (current.items.length > 0 && current.across + groupWidth > maxAcross) flush();
    for (; index < end; index += 1) {
      const item = items[index];
      if (current.items.length > 0 && current.across + widthOf(item) > maxAcross) flush();
      current.items.push({ item, height: heights.get(item) ?? 1 });
      current.across += widthOf(item);
    }
  }
  flush();
  return rows;
};

/** Place rows back to front. */
const placeRows = (rows: readonly Row[]): Sheet => {
  const placed: PlacedItem[] = [];
  // `down` is distance down the screen in world units; ground distance is down / sin(elevation).
  let down = 0;
  let width = 0;
  let previousFront = 0;
  rows.forEach((row, index) => {
    const tallest = Math.max(...row.items.map(({ item, height }) => halfAcross(item) * SIN_ELEVATION + height * COS_ELEVATION));
    const front = Math.max(...row.items.map(({ item }) => halfAcross(item) * SIN_ELEVATION));
    down += index === 0 ? tallest : previousFront + GAP_ROWS + tallest;
    previousFront = front;
    let across = -row.across / 2;
    for (const { item, height } of row.items) {
      const half = halfAcross(item);
      const u = across + half + GAP_ACROSS / 2;
      const ground = down / SIN_ELEVATION;
      // Screen-right is world (1, 0, −1) / √2; screen-down on the ground is world (1, 0, 1) / √2.
      placed.push({ item, x: (u + ground) * Math.SQRT1_2, z: (ground - u) * Math.SQRT1_2, height });
      across += half * 2 + GAP_ACROSS;
    }
    width = Math.max(width, row.across);
  });
  return { placed, width, height: down + previousFront + GAP_ROWS };
};

/** Try a range of row widths and keep the sheet that fills this viewport best. */
const layOut = (items: readonly GalleryItem[], aspect: number): Sheet => {
  const heights = new Map(items.map((item) => [item, measureHeight(item)] as const));
  const widths = items.map((item) => halfAcross(item) * 2 + GAP_ACROSS);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const widest = Math.max(1, ...widths);
  let best: Sheet = { placed: [], width: 0, height: 0 };
  let bestSpan = Infinity;
  const steps = 60;
  for (let step = 0; step <= steps; step += 1) {
    const candidate = placeRows(splitRows(items, heights, widest + ((total - widest) * step) / steps + 1e-6));
    const span = Math.max(candidate.height, candidate.width / aspect);
    if (span < bestSpan) {
      best = candidate;
      bestSpan = span;
    }
  }
  return best;
};

// ─────────────────────────────────────────────────────────────────────────────
// Lighting — mirrors the keys in core/Lighting.ts so props are judged under
// the game's own light.
// ─────────────────────────────────────────────────────────────────────────────

interface LightKey {
  sun: number;
  sunIntensity: number;
  sunDirection: [number, number, number];
  sky: number;
  ground: number;
  hemisphere: number;
  fill: number;
  /** How strongly emissive parts should glow (LightingState.duskAmount). */
  dusk: number;
}

const LIGHT_KEYS: Record<TimeOfDay, LightKey> = {
  morning: { sun: 0xfff3e2, sunIntensity: 2.7, sunDirection: [-0.28, 1, 0.52], sky: 0xd4e6ff, ground: 0x9c9188, hemisphere: 1.15, fill: 0.55, dusk: 0 },
  afternoon: { sun: 0xffd7a3, sunIntensity: 2.5, sunDirection: [0.1, 0.8, 0.9], sky: 0xffe4c0, ground: 0x97836f, hemisphere: 0.95, fill: 0.5, dusk: 0.15 },
  dusk: { sun: 0xff8a3d, sunIntensity: 2.0, sunDirection: [0.3, 0.38, 1], sky: 0x80699e, ground: 0x3a2f3d, hemisphere: 0.55, fill: 0.22, dusk: 1 },
  night: { sun: 0x7f9bd9, sunIntensity: 0.5, sunDirection: [0.2, 0.9, 0.6], sky: 0x2b3861, ground: 0x10131c, hemisphere: 0.6, fill: 0.15, dusk: 1 },
};
const FILL_COLOR = 0xdfe9ff;
const FILL_DIRECTION: [number, number, number] = [0.55, 0.45, 0.7];
const SHADOW_RADIUS = 3;
const SHADOW_STRENGTH = 0.78;
const SHADOW_BIAS_UNITS = 0.012;
const SHADOW_NORMAL_BIAS = 0.035;
const SUN_STANDOFF = 10;

// ─────────────────────────────────────────────────────────────────────────────
// The page
// ─────────────────────────────────────────────────────────────────────────────

interface Gallery {
  dispose(): void;
}

const mountGallery = (host: HTMLDivElement, params: GalleryParams): Gallery => {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab";
  host.appendChild(canvas);
  const labelLayer = document.createElement("div");
  labelLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
  host.appendChild(labelLayer);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const light = LIGHT_KEYS[params.light];
  const hemisphere = new THREE.HemisphereLight(light.sky, light.ground, light.hemisphere);
  const sun = new THREE.DirectionalLight(light.sun, light.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.radius = SHADOW_RADIUS;
  sun.shadow.intensity = SHADOW_STRENGTH;
  sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
  const fill = new THREE.DirectionalLight(FILL_COLOR, light.fill);
  scene.add(hemisphere, sun, sun.target, fill, fill.target);

  // ── Content ────────────────────────────────────────────────────────────────
  const items: GalleryItem[] = [];
  if (params.set !== "people") items.push(...catalogItems(params));
  if (params.set === "workstations" || params.set === "all") items.push(...workstationScenes(params));
  if (params.set === "people" || params.set === "all") items.push(...peopleItems(params));
  const aspect = Math.max(0.4, host.clientWidth / Math.max(1, host.clientHeight));
  const sheet = layOut(items, aspect);
  const { placed } = sheet;

  const tiles = bakeModel(null, (b) => {
    for (const { item, x, z } of placed) {
      // Floor and ground slabs reach below y = 0; sink their tile so the two never share a plane.
      const top = Math.min(0, item.minY ?? 0) - (item.minY ? 0.004 : 0);
      b.box(item.w + TILE_MARGIN * 2, 0.06, item.d + TILE_MARGIN * 2, TILE_COLOR, x, top - 0.06, z, { r: 0.02 });
      if (item.wallHung) {
        b.box(item.w + TILE_MARGIN * 2, WALL_HEIGHT, 0.12, BACKDROP_COLOR, x, 0, z - item.d / 2 - WALL_GAP - 0.06, { r: 0.012 });
      }
    }
  });
  scene.add(modelMesh(tiles));

  const labels: Array<{ element: HTMLDivElement; anchor: THREE.Vector3 }> = [];
  for (const { item, x, z } of placed) {
    item.object.position.x += x;
    item.object.position.z += z;
    scene.add(item.object);
    item.setGlow?.(light.dusk);
    if (!params.labels) continue;
    const element = document.createElement("div");
    element.textContent = item.label;
    element.style.cssText =
      "position:absolute;left:0;top:0;white-space:nowrap;font:500 11px 'IBM Plex Mono',ui-monospace,monospace;color:#a9b3bf;" +
      "background:rgba(13,15,18,0.72);padding:1px 5px;border-radius:3px;will-change:transform";
    labelLayer.appendChild(element);
    // The tile's nearest corner is the bottom tip of its diamond on screen.
    labels.push({ element, anchor: new THREE.Vector3(x + item.w / 2 + TILE_MARGIN, -0.06, z + item.d / 2 + TILE_MARGIN) });
  }

  // ── Camera ─────────────────────────────────────────────────────────────────
  const viewDirection = new THREE.Vector3(Math.sin(AZIMUTH) * COS_ELEVATION, SIN_ELEVATION, Math.cos(AZIMUTH) * COS_ELEVATION);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 3);
  // The sheet is centred across the screen; its middle sits half its height down.
  const middle = sheet.height / 2 / SIN_ELEVATION;
  const target = new THREE.Vector3(middle * Math.SQRT1_2, 0, middle * Math.SQRT1_2);
  camera.position.copy(target).addScaledVector(viewDirection, CAMERA_DISTANCE);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);

  // The sun follows the content so the shadow map covers all of it.
  {
    const radius = Math.hypot(sheet.width, sheet.height / SIN_ELEVATION) / 2 + 3;
    sun.target.position.copy(target);
    sun.position.copy(target).add(new THREE.Vector3(...light.sunDirection).normalize().multiplyScalar(radius + SUN_STANDOFF));
    fill.target.position.copy(target);
    fill.position.copy(target).add(new THREE.Vector3(...FILL_DIRECTION).normalize().multiplyScalar(30));
    const shadowCamera = sun.shadow.camera;
    shadowCamera.left = -radius;
    shadowCamera.right = radius;
    shadowCamera.top = radius;
    shadowCamera.bottom = -radius;
    shadowCamera.near = SUN_STANDOFF / 2;
    shadowCamera.far = SUN_STANDOFF * 1.5 + radius * 2;
    shadowCamera.updateProjectionMatrix();
    // three.js expects the bias as a fraction of the frustum's depth range.
    sun.shadow.bias = -SHADOW_BIAS_UNITS / (shadowCamera.far - shadowCamera.near);
  }

  let zoom = params.zoom;
  let width = 1;
  let height = 1;
  let labelsDirty = true;
  const projected = new THREE.Vector3();

  const applyCamera = (): void => {
    const viewAspect = width / height;
    // Fit both axes: whichever is tighter decides the scale.
    const halfHeight = Math.max(sheet.height, sheet.width / viewAspect, 2) / 2 / zoom;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.left = -halfHeight * viewAspect;
    camera.right = halfHeight * viewAspect;
    camera.updateProjectionMatrix();
    labelsDirty = true;
  };

  const resize = (): void => {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    applyCamera();
  };
  resize();
  window.addEventListener("resize", resize);

  // ── Pan / zoom ─────────────────────────────────────────────────────────────
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onPointerDown = (event: PointerEvent): void => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const unitsPerPixel = (camera.top - camera.bottom) / height;
    camera.position.addScaledVector(right, -(event.clientX - lastX) * unitsPerPixel);
    camera.position.addScaledVector(up, (event.clientY - lastY) * unitsPerPixel);
    lastX = event.clientX;
    lastY = event.clientY;
    labelsDirty = true;
  };
  const onPointerUp = (event: PointerEvent): void => {
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = "grab";
  };
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    zoom = THREE.MathUtils.clamp(zoom * Math.exp(-event.deltaY * 0.0015), 0.2, 60);
    applyCamera();
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // ── Loop ───────────────────────────────────────────────────────────────────
  let elapsed = 0;
  let frame = 0;
  let last = performance.now();
  const tick = (now: number): void => {
    frame = requestAnimationFrame(tick);
    // Clamped like the game loop, so a background tab does not fast-forward every animation on return.
    const dt = Math.min(Math.max(0, (now - last) / 1000), 0.1);
    last = now;
    elapsed += dt;
    for (const { item } of placed) item.update?.(dt, elapsed);
    renderer.render(scene, camera);
    if (labelsDirty) {
      labelsDirty = false;
      camera.updateMatrixWorld();
      for (const { element, anchor } of labels) {
        projected.copy(anchor).project(camera);
        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;
        element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y + 3)}px) translateX(-50%)`;
      }
    }
  };
  frame = requestAnimationFrame(tick);

  return {
    dispose(): void {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      for (const { item } of placed) item.dispose();
      tiles.dispose();
      sun.dispose();
      fill.dispose();
      hemisphere.dispose();
      disposeSharedResources();
      renderer.dispose();
      canvas.remove();
      labelLayer.remove();
    },
  };
};

const PropGallery = () => {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const gallery = mountGallery(host, parseParams(window.location.search));
    return () => gallery.dispose();
  }, []);

  return <div ref={hostRef} style={{ position: "fixed", inset: 0, background: BACKGROUND, overflow: "hidden" }} />;
};

export default PropGallery;
