// STUB — replaced by the office agent. Draws a placeholder floor + boxes so the
// core/interaction layer has something to render and click on.
import * as THREE from "three";
import type { WorldContext, WorldEvent, WorldSnapshot, WorldSystem } from "../types";
import { DESK_OFFSET } from "./layouts";

export class OfficeSystem implements WorldSystem {
  private ctx: WorldContext;
  private root = new THREE.Group();
  private builtFor: string | null = null;

  constructor(ctx: WorldContext) {
    this.ctx = ctx;
    this.root.name = "office";
    ctx.scene.add(this.root);
  }

  applySnapshot(next: WorldSnapshot, prev: WorldSnapshot | null, events: readonly WorldEvent[]): void {
    void prev;
    void events;
    if (this.builtFor === next.phase) return;
    this.builtFor = next.phase;
    this.clear();
    const layout = this.ctx.getLayout();
    const { minX, maxX, minZ, maxZ } = layout.floor;
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(maxX - minX, 0.2, maxZ - minZ),
      new THREE.MeshLambertMaterial({ color: 0x2e3742 })
    );
    floor.position.set((minX + maxX) / 2, -0.1, (minZ + maxZ) / 2);
    floor.receiveShadow = true;
    this.root.add(floor);

    layout.deskSeats.forEach((seat, i) => {
      const desk = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.75, 0.6), new THREE.MeshLambertMaterial({ color: 0x8b6f4e }));
      desk.position.set(seat.x + Math.sin(seat.facing) * DESK_OFFSET, 0.375, seat.z + Math.cos(seat.facing) * DESK_OFFSET);
      desk.rotation.y = seat.facing;
      desk.castShadow = true;
      this.root.add(desk);
      this.ctx.interactables.register(desk, { kind: "empty-desk", slotIndex: i }, { label: "Empty desk", anchorHeight: 1.2 });
    });

    (Object.keys(layout.stations) as Array<keyof typeof layout.stations>).forEach((kind) => {
      const p = layout.stations[kind];
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.3), new THREE.MeshLambertMaterial({ color: 0x7dd3fc }));
      box.position.set(p.x, 0.7, p.z);
      box.castShadow = true;
      this.root.add(box);
      this.ctx.interactables.register(box, { kind: "station", station: kind }, { label: kind, anchorHeight: 1.6 });
    });
  }

  update(dt: number, elapsed: number): void {
    void dt;
    void elapsed;
  }

  private clear(): void {
    for (const child of [...this.root.children]) {
      this.ctx.interactables.unregister(child);
      this.root.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    }
  }

  dispose(): void {
    this.clear();
    this.ctx.scene.remove(this.root);
  }
}
