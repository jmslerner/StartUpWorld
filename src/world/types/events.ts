/** What changed between two office scenes (see ../sceneEvents.ts). Re-exported by ../types. */

import type { OfficeIndex } from "./scene";

export type SceneEvent =
  | { readonly kind: "run-reset" }
  | { readonly kind: "year-advanced"; readonly from: number; readonly to: number }
  | { readonly kind: "office-changed"; readonly from: OfficeIndex; readonly to: OfficeIndex }
  | { readonly kind: "ended"; readonly ending: "won" | "lost" };
