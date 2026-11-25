import type { WorldFrame, WorldSystem } from "../types";

export type ErrorReporter = (message: string, error: unknown) => void;

interface Slot {
  readonly name: string;
  readonly create: () => WorldSystem;
  system: WorldSystem | null;
}

const reportToConsole: ErrorReporter = (message, error) => {
  console.error(message, error);
};

/**
 * Runs the world's systems in a fixed order and contains their failures.
 *
 * The world is assembled from systems written by different people; one of them
 * throwing must cost at most its own contribution to a frame, never the render
 * loop. Each failing step is reported once (not sixty times a second) and is
 * simply tried again next time, so a transient fault heals itself.
 */
export class SystemRunner {
  private readonly slots: Slot[] = [];
  private readonly reported = new Set<string>();
  private readonly report: ErrorReporter;

  constructor(report: ErrorReporter = reportToConsole) {
    this.report = report;
  }

  /** Declare a system. Registration order is the order everything runs in. Nothing is created yet. */
  register(name: string, create: () => WorldSystem): void {
    this.slots.push({ name, create, system: null });
  }

  /** Create the named systems (default: all) that are not running, in registration order. */
  start(names?: readonly string[]): void {
    for (const slot of this.slots) {
      if (slot.system || (names && !names.includes(slot.name))) continue;
      // A system that fails to construct is reported and left out; the rest still run.
      this.run(`${slot.name}.create`, () => {
        slot.system = slot.create();
      });
    }
  }

  /** Dispose the named systems (default: all) that are running, in reverse order. */
  stop(names?: readonly string[]): void {
    for (let i = this.slots.length - 1; i >= 0; i -= 1) {
      const slot = this.slots[i];
      const system = slot.system;
      if (!system || (names && !names.includes(slot.name))) continue;
      slot.system = null;
      this.run(`${slot.name}.dispose`, () => system.dispose());
    }
  }

  applyFrame(next: WorldFrame, prev: WorldFrame | null): void {
    for (const slot of this.slots) {
      const system = slot.system;
      if (system) this.run(`${slot.name}.applyFrame`, () => system.applyFrame(next, prev));
    }
  }

  update(dt: number, elapsed: number): void {
    for (const slot of this.slots) {
      const system = slot.system;
      if (!system) continue;
      // Inlined rather than routed through run(): this is the per-frame path
      // and should not allocate a closure per system.
      try {
        system.update(dt, elapsed);
      } catch (error) {
        this.reportFailure(`${slot.name}.update`, error);
      }
    }
  }

  /**
   * True while any running system still has something moving. The loop rests when this is false. A system that
   * throws here is reported and counts as at rest: a fault must not keep the loop awake for good.
   */
  busy(): boolean {
    for (const slot of this.slots) {
      const system = slot.system;
      if (!system) continue;
      // Inlined like update(): the loop asks this every frame.
      try {
        if (system.busy()) return true;
      } catch (error) {
        this.reportFailure(`${slot.name}.busy`, error);
      }
    }
    return false;
  }

  /** Run any step under the same containment. Returns false if it threw. */
  run(label: string, step: () => void): boolean {
    try {
      step();
      return true;
    } catch (error) {
      this.reportFailure(label, error);
      return false;
    }
  }

  /** Let every step report its next failure again (after systems are rebuilt). */
  forgetFailures(): void {
    this.reported.clear();
  }

  /** Report a failure of the step called `label` — the first time only. */
  reportFailure(label: string, error: unknown): void {
    if (this.reported.has(label)) return;
    this.reported.add(label);
    this.report(`[world] ${label} failed; carrying on without it.`, error);
  }
}
