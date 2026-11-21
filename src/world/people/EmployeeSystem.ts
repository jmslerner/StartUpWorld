// STUB — replaced by the people agent.
import type { WorldContext, WorldEvent, WorldSnapshot, WorldSystem } from "../types";

export class EmployeeSystem implements WorldSystem {
  private ctx: WorldContext;

  constructor(ctx: WorldContext) {
    this.ctx = ctx;
  }

  applySnapshot(next: WorldSnapshot, prev: WorldSnapshot | null, events: readonly WorldEvent[]): void {
    void this.ctx;
    void next;
    void prev;
    void events;
  }

  update(dt: number, elapsed: number): void {
    void dt;
    void elapsed;
  }

  dispose(): void {}
}
