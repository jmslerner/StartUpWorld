/**
 * Where the market's pieces stand: pure arithmetic over a market scene, no three. Four lots in a row along X, the
 * player's first, on a plaza at z 0; the source the year's new users come from stands in front of them (toward the
 * camera, which looks from +X, +Y, +Z).
 */
import { ISO_AZIMUTH, ISO_ELEVATION, type LayoutFrame } from "../office/framing";
import type { MarketScene } from "../types";

/** World units of a building at height 1 (the market scale's top). */
export const MARKET_BUILDING_HEIGHT = 6;
/** Dots that stand for the year's new users. */
export const FLOW_DOTS = 48;
/** Draw calls the market may cost, the shadow pass included. */
export const MARKET_DRAW_CEILING = 60;

/** Width (and depth) of a lot. */
export const LOT_WIDTH = 3.2;
/** Distance between the centres of two lots. */
export const LOT_SPACING = 4.4;
/** How far in front of the lots the source stands. */
export const SOURCE_Z = 4.5;
/** Ground kept around the lots and the source. */
const BOUNDS_MARGIN = 2;

export interface MarketLot {
  readonly seat: number;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
}

export interface MarketLayout {
  readonly lots: readonly MarketLot[];
  readonly barY: number;
  readonly source: { readonly x: number; readonly z: number };
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
}

export const marketLayout = (scene: MarketScene): MarketLayout => {
  const count = scene.companies.length;
  const first = -((count - 1) * LOT_SPACING) / 2;
  const lots = scene.companies.map(
    (company, index): MarketLot => ({
      seat: company.seat,
      x: first + index * LOT_SPACING,
      z: 0,
      width: LOT_WIDTH,
      height: company.state === "out" ? 0 : company.height * MARKET_BUILDING_HEIGHT,
    })
  );
  const half = LOT_WIDTH / 2;
  const reach = count === 0 ? half : -first + half;
  return {
    lots,
    barY: scene.bar * MARKET_BUILDING_HEIGHT,
    source: { x: 0, z: SOURCE_Z },
    bounds: {
      minX: -reach - BOUNDS_MARGIN,
      maxX: reach + BOUNDS_MARGIN,
      minZ: -half - BOUNDS_MARGIN,
      maxZ: SOURCE_Z + BOUNDS_MARGIN,
    },
  };
};

/**
 * How many of `total` dots go to each company: `round(total × Σwon)` dots shared by the largest remainder, ties to
 * the lower seat, so the counts always add up and follow what each won.
 */
export const flowDots = (won: readonly number[], total: number): number[] => {
  const shares = won.map((share) => (Number.isFinite(share) && share > 0 ? share : 0));
  const sum = shares.reduce((acc, share) => acc + share, 0);
  const handed = Math.max(0, Math.min(total, Math.round(total * sum)));
  if (handed === 0 || sum === 0) return shares.map(() => 0);
  const quotas = shares.map((share) => (handed * share) / sum);
  const counts = quotas.map((quota) => Math.floor(quota + 1e-9));
  let left = handed - counts.reduce((acc, count) => acc + count, 0);
  const order = quotas.map((quota, index) => ({ index, rest: quota - counts[index] })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    counts[index] += 1;
    left -= 1;
  }
  return counts;
};

const FRAME_PADDING = 0.6;

/**
 * The market's default shot, as on-screen extents for the fixed isometric camera: every lot with its tallest
 * possible building (the scale's top), the bar and the source in view, whatever this year's heights.
 */
export const marketFrame = (layout: MarketLayout): LayoutFrame => {
  const sinA = Math.sin(ISO_AZIMUTH);
  const cosA = Math.cos(ISO_AZIMUTH);
  const sinE = Math.sin(ISO_ELEVATION);
  const cosE = Math.cos(ISO_ELEVATION);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  const include = (x: number, y: number, z: number): void => {
    const u = x * cosA - z * sinA;
    const v = -(x * sinA + z * cosA) * sinE + y * cosE;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  };
  const top = Math.max(MARKET_BUILDING_HEIGHT, layout.barY);
  for (const lot of layout.lots) {
    const h = lot.width / 2;
    for (const [dx, dz] of [
      [-h, -h],
      [h, -h],
      [-h, h],
      [h, h],
    ]) {
      include(lot.x + dx, 0, lot.z + dz);
      include(lot.x + dx, top, lot.z + dz);
    }
  }
  include(layout.source.x, 0, layout.source.z + 1);
  // The centre of the content on screen, taken back to the ground plane (y = 0) along the view direction.
  const u = (minU + maxU) / 2;
  const v = (minV + maxV) / 2;
  // On the ground, screen-up v = -(x sinA + z cosA) sinE and screen-right u = x cosA - z sinA.
  const depth = -v / sinE;
  const x = u * cosA + depth * sinA;
  const z = -u * sinA + depth * cosA;
  return { target: { x, z }, width: maxU - minU + FRAME_PADDING * 2, height: maxV - minV + FRAME_PADDING * 2 };
};
