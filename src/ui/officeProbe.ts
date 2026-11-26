/**
 * The career office's hook for the browser checks: `window.__careerOffice`, as the lab sets `window.__officeLab`.
 *
 * It reads the live world of the career screen attached to it, and the last world taken down, whose counts stay
 * readable once it is disposed, so a check can see that leaving the screen left nothing behind. The only thing it
 * changes is `loseContext()`, which takes the graphics context away as a browser may. Nothing in the game reads it.
 */

import type { SceneSource, WorldViewState } from "../world/mountWorld";
import type { ScreenPoint, WorldHandle, WorldStats } from "../world/types/handle";
import type { InteractableTarget } from "../world/types/interaction";
import type { OfficeScene, Team } from "../world/types/scene";
import type { StageStatus } from "../world/ui/stage";
import type { OfficeAvailability } from "./officeView";

/** Where the career screen installs the probe. */
export const PROBE_GLOBAL = "__careerOffice";

export interface CareerOfficeProbe {
  /** "none" while no career screen is attached. */
  status(): StageStatus | "none";
  availability(): OfficeAvailability | "none";
  /** The live world's figures, or null while there is none. */
  stats(): WorldStats | null;
  /** The figures of the last world taken down. */
  retiredStats(): WorldStats | null;
  /** The scene the office shows (or would show), or null. */
  scene(): OfficeScene | null;
  personAt(desk: number): string | null;
  teamOf(target: InteractableTarget): Team | null;
  project(target: InteractableTarget): ScreenPoint | null;
  loseContext(): void;
}

export interface OfficeProbeLink {
  /** A career screen shows its office through this; the function returned detaches it. */
  attach(view: () => WorldViewState, source: SceneSource, availability: () => OfficeAvailability): () => void;
  /** A world was taken down: its figures stay readable through retiredStats(). */
  retire(handle: WorldHandle): void;
}

declare global {
  interface Window {
    /** The career screen's office, for the browser checks. Installed by the first career screen of the page. */
    __careerOffice?: CareerOfficeProbe;
  }
}

interface Link {
  readonly view: () => WorldViewState;
  readonly source: SceneSource;
  readonly availability: () => OfficeAvailability;
}

export const createOfficeProbe = (): CareerOfficeProbe & OfficeProbeLink => {
  let link: Link | null = null;
  let retired: WorldHandle | null = null;

  const handle = (): WorldHandle | null => link?.view().handle ?? null;

  return {
    status: () => link?.view().status ?? "none",
    availability: () => link?.availability() ?? "none",
    stats: () => handle()?.stats() ?? null,
    retiredStats: () => {
      try {
        return retired?.stats() ?? null;
      } catch {
        return null;
      }
    },
    scene: () => {
      if (link === null) return null;
      try {
        return link.source.get();
      } catch {
        return null;
      }
    },
    personAt: (desk) => handle()?.personAt(desk) ?? null,
    teamOf: (target) => handle()?.teamOf(target) ?? null,
    project: (target) => handle()?.project(target) ?? null,
    loseContext: () => handle()?.loseContext(),
    attach: (view, source, availability) => {
      const mine: Link = { view, source, availability };
      link = mine;
      return () => {
        if (link === mine) link = null;
      };
    },
    retire: (gone) => {
      retired = gone;
    },
  };
};
