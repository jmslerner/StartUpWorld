import type { StorageLike } from "../state/gameStore";
import type { PlaybackBeat } from "../scene/yearPlayback";
import type { StageStatus } from "../world/ui/stage";

/** Where the player's 3D switch is remembered, per browser and apart from the save. */
export const OFFICE_PREFERENCE_KEY = "startupworld:office:v1";

/** The 3D switch: on unless it was turned off. Storage that is missing or blocked reads as on. */
export const readOfficePreference = (storage: Pick<StorageLike, "getItem"> | null): boolean => {
  try {
    return storage?.getItem(OFFICE_PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
};

/** Remembers the 3D switch; a full or blocked storage throws nothing. */
export const writeOfficePreference = (storage: Pick<StorageLike, "setItem"> | null, on: boolean): void => {
  try {
    storage?.setItem(OFFICE_PREFERENCE_KEY, on ? "on" : "off");
  } catch {
    // The switch is a convenience: losing it changes nothing in the game.
  }
};

export type OfficeAvailability = "unknown" | "running" | "context-lost" | "unsupported" | "failed";

/** What a view's status says of the office: "starting" is not known yet, the rest by name. */
export const availabilityOf = (status: StageStatus): OfficeAvailability => (status === "starting" ? "unknown" : status);

const isLost = (availability: OfficeAvailability): boolean =>
  availability === "unsupported" || availability === "failed" || availability === "context-lost";

/** Once "unsupported", "failed" or "context-lost", nothing the view says changes it (the "starting" a view says as it
 *  unmounts least of all); only the player's press sets "unknown" again, directly. Otherwise availabilityOf(status). */
export const nextAvailability = (prev: OfficeAvailability, status: StageStatus): OfficeAvailability =>
  isLost(prev) ? prev : availabilityOf(status);

interface ProbeContext {
  getExtension?: (name: string) => { loseContext?: () => void } | null | undefined;
}

const makeDocumentCanvas = (): { getContext(id: "webgl2"): unknown } | null =>
  typeof document === "undefined" ? null : document.createElement("canvas");

/** WebGL 2 can be had here. Never throws; releases the context it made. The seam makes a canvas-like object. */
export const canDrawOffice = (makeCanvas: () => { getContext(id: "webgl2"): unknown } | null = makeDocumentCanvas): boolean => {
  try {
    const canvas = makeCanvas();
    if (!canvas) return false;
    const gl = canvas.getContext("webgl2") as ProbeContext | null | undefined;
    if (!gl) return false;
    try {
      gl.getExtension?.("WEBGL_lose_context")?.loseContext?.();
    } catch {
      // Releasing the probe's context is a courtesy; the answer stands.
    }
    return true;
  } catch {
    return false;
  }
};

/** Where a screen starts, from the probe made before its first paint. */
export const firstAvailability = (canDraw: boolean): OfficeAvailability => (canDraw ? "unknown" : "unsupported");

/** A desktop browser window: wide enough, and a precise pointer. */
export const DESKTOP_QUERY = "(min-width: 1024px) and (pointer: fine)";

export type OfficeLayoutChoice = "3d" | "2d";

/** "3d" only for a career, switched on, in a desktop window, on a device that is or may be drawing it. */
export const officeLayoutFor = (input: {
  readonly career: boolean;
  readonly preference: boolean;
  readonly availability: OfficeAvailability;
  readonly wide: boolean;
}): OfficeLayoutChoice =>
  input.career && input.preference && input.wide && (input.availability === "unknown" || input.availability === "running")
    ? "3d"
    : "2d";

/** A year plays out only in a running 3D office, and never under reduced motion. */
export const canPlayOut = (input: {
  readonly layout: OfficeLayoutChoice;
  readonly availability: OfficeAvailability;
  readonly reducedMotion: boolean;
}): boolean => input.layout === "3d" && input.availability === "running" && !input.reducedMotion;

/** The switch is offered unless the device cannot draw the office or the window is not a desktop one. */
export const canSwitch = (availability: OfficeAvailability, wide: boolean): boolean =>
  wide && availability !== "unsupported" && availability !== "failed";

/** A lost context, and only that, offers a reload. */
export const reloadOffered = (availability: OfficeAvailability): boolean => availability === "context-lost";

const MIN_OFFICE_HEIGHT = 360;
const BAR_GAP = 12;

/** The office cell's height: from its top to 12 px above the bottom bar, at least 360 px. */
export const officeCellHeight = (input: { readonly viewport: number; readonly top: number; readonly bar: number }): number =>
  Math.max(MIN_OFFICE_HEIGHT, Math.floor(input.viewport - input.top - input.bar - BAR_GAP));

export const OFFICE_WORDS = {
  toggle: "3D office",
  unavailable: "The 3D office cannot be shown on this device. The game is complete without it.",
  narrow: "The 3D office needs a desktop browser window at least 1024 pixels wide.",
  lost: "The 3D office stopped drawing. The game carries on in these screens.",
  reload: "Reload 3D view",
  opening: "Opening the office…",
  skip: "Skip",
} as const;

/** The caption while a year plays out. */
export const playingLine = (year: number): string => `${year} plays out`;

/** One beat of a year in plain words. */
export const beatLine = (beat: PlaybackBeat, officeNames: readonly string[]): string => {
  switch (beat.kind) {
    case "leave":
      return beat.count === 1 ? "One person leaves" : `${beat.count} people leave`;
    case "arrive":
      return beat.count === 1 ? "One hire walks in" : `${beat.count} hires walk in`;
    case "move": {
      const name = beat.office === null ? undefined : officeNames[beat.office];
      return name ? `The company moves to a bigger place: ${name}` : "The company moves to a bigger place";
    }
    case "year":
      return "A quiet year";
    case "market":
      return "Where the year's new users went";
  }
};
