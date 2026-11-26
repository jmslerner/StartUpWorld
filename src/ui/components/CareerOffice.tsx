import type { Plan } from "../../engine/types";
import type { WorldViewState } from "../../world/mountWorld";
import WorldView from "../../world/WorldView";
import { WorldBoundary, WorldUnavailableNote } from "../../world/ui/WorldShell";
import type { OfficeSource } from "../officeSource";

export interface CareerOfficeProps {
  /** The career's office, from the store. The same object for the life of the screen. */
  readonly source: OfficeSource;
  /** The plan being drafted. */
  readonly draft: Plan;
  /** One person set down in another team, as the one change to the plan. */
  readonly onMove: (patch: Pick<Plan, "allocation">) => void;
  /** How the view stands, whenever that changes. */
  readonly onView: (state: WorldViewState) => void;
  /** The view could not be shown: the screen goes back to its 2D panels. */
  readonly onFailed: () => void;
}

/**
 * The career's office in 3D. The one place under src/ui that brings in the world by value, so it is only ever
 * loaded lazily (through OfficeSlot), and three.js with it. It fills the cell the screen gives it.
 */
const CareerOffice = ({ source, onView, onFailed }: CareerOfficeProps) => (
  <WorldBoundary fallback={<WorldUnavailableNote />} onError={onFailed}>
    <WorldView source={source} onState={onView} />
  </WorldBoundary>
);

export default CareerOffice;
