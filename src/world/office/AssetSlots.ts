/**
 * The five purchasable assets: nothing while locked, a blueprint ghost with a
 * price tag while for sale, the real thing once owned.
 *
 * Assets parked outside (helipad, jet, yacht — and the lounge patio in the
 * small phases) stand beyond the building's own ground tile, so this also lays
 * the paving ("aprons") that joins them to it.
 */
import type * as THREE from "three";
import { ASSET_CATALOG } from "../../engine/assets";
import type { AssetId } from "../../types/game";
import { formatCompact } from "../fx/format";
import type { WorldSnapshot } from "../types";
import type { Registrar } from "./DeskSlots";
import { APRON_MARGIN, ASSET_HEIGHTS, ASSET_IDS, assetFootprint, GROUND_SINK, groundRect } from "./layouts";
import type { GroundRect } from "./layouts";
import { createAsset, createGround, makeBlueprint } from "./props";
import type { PropHandle } from "./props";
import type { StageKit } from "./StageKit";

type AssetState = "none" | "ghost" | "owned";

interface AssetSlot {
  state: AssetState;
  handle: PropHandle | null;
}

export const priceLabel = (assetId: AssetId): string => `$${formatCompact(ASSET_CATALOG[assetId].cost)}`;

const stateOf = (assetId: AssetId, snapshot: WorldSnapshot, forSale: boolean): AssetState => {
  if (snapshot.ownedAssets.includes(assetId)) return "owned";
  return forSale && snapshot.availableAssets.includes(assetId) ? "ghost" : "none";
};

export class AssetSlots {
  private readonly kit: StageKit;
  private readonly registrar: Registrar;
  private readonly slots: Record<AssetId, AssetSlot> = {
    "office-upgrade": { state: "none", handle: null },
    lounge: { state: "none", handle: null },
    helicopter: { state: "none", handle: null },
    jet: { state: "none", handle: null },
    yacht: { state: "none", handle: null },
  };
  private readonly aprons: PropHandle[] = [];
  /** Which assets the current aprons were laid for. */
  private apronKey = "";

  constructor(kit: StageKit, registrar: Registrar) {
    this.kit = kit;
    this.registrar = registrar;
  }

  stateOf(assetId: AssetId): AssetState {
    return this.slots[assetId].state;
  }

  /** The object standing at an asset's anchor right now (ghost or real), if any. */
  objectOf(assetId: AssetId): THREE.Object3D | null {
    return this.slots[assetId].handle?.group ?? null;
  }

  /**
   * Show each asset in the state the snapshot says. `forSale` false hides the
   * blueprints of what could still be bought (the run is over). Returns the
   * assets whose prop was (re)built, so the caller can animate their arrival.
   */
  sync(snapshot: WorldSnapshot, forSale = true): AssetId[] {
    const changed: AssetId[] = [];
    for (const assetId of ASSET_IDS) {
      const slot = this.slots[assetId];
      const state = stateOf(assetId, snapshot, forSale);
      if (state === slot.state) continue;
      this.clear(slot);
      slot.state = state;
      if (state === "none") continue;
      const prop = createAsset(assetId);
      const handle = state === "owned" ? prop : makeBlueprint(prop, priceLabel(assetId));
      slot.handle = this.kit.place(handle, this.kit.layout.assetAnchors[assetId]);
      this.registrar.register(
        handle.group,
        { kind: "asset", assetId },
        { label: ASSET_CATALOG[assetId].name, anchorHeight: ASSET_HEIGHTS[assetId] * 0.6 }
      );
      changed.push(assetId);
    }
    this.syncAprons();
    return changed;
  }

  private clear(slot: AssetSlot): void {
    if (!slot.handle) return;
    this.registrar.unregister(slot.handle.group);
    this.kit.remove(slot.handle);
    slot.handle = null;
  }

  /**
   * Paving under everything that stands outside the main ground tile: one strip
   * off the +Z side and one off the +X side, each just big enough for what is
   * on show there. Rebuilt only when the set of outdoor assets changes.
   */
  private syncAprons(): void {
    const { layout, phase } = this.kit;
    const ground = groundRect(layout);
    const shown = ASSET_IDS.filter((id) => this.slots[id].state !== "none");
    const key = shown.join(",");
    if (key === this.apronKey) return;
    this.apronKey = key;
    for (const apron of this.aprons) this.kit.props.remove(apron);
    this.aprons.length = 0;

    let front: GroundRect | null = null;
    let side: GroundRect | null = null;
    const grow = (rect: GroundRect | null, minX: number, maxX: number, minZ: number, maxZ: number): GroundRect =>
      rect
        ? {
            minX: Math.min(rect.minX, minX),
            maxX: Math.max(rect.maxX, maxX),
            minZ: Math.min(rect.minZ, minZ),
            maxZ: Math.max(rect.maxZ, maxZ),
          }
        : { minX, maxX, minZ, maxZ };

    for (const assetId of shown) {
      const footprint = assetFootprint(layout, assetId);
      const minX = footprint.minX - APRON_MARGIN;
      const maxX = footprint.maxX + APRON_MARGIN;
      const minZ = footprint.minZ - APRON_MARGIN;
      const maxZ = footprint.maxZ + APRON_MARGIN;
      if (maxZ > ground.maxZ && footprint.z > layout.floor.maxZ) {
        // Off the +Z side: a strip from the tile's front edge out past the asset.
        front = grow(front, minX, maxX, ground.maxZ, maxZ);
      } else if (maxX > ground.maxX) {
        side = grow(side, ground.maxX, maxX, minZ, maxZ);
      }
    }

    for (const rect of [front, side]) {
      if (!rect) continue;
      const apron = createGround(rect.maxX - rect.minX, rect.maxZ - rect.minZ, phase);
      apron.group.position.set((rect.minX + rect.maxX) / 2, -GROUND_SINK, (rect.minZ + rect.maxZ) / 2);
      // Part of the building's ground, so it rises with the shell rather than popping in.
      this.aprons.push(this.kit.props.add(apron, this.kit.structure));
    }
  }
}
