// Class names shared by the screens, so every button and label looks like the same game.

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neon/70";

/** A quiet control: steppers, options that are not selected, secondary actions. */
export const BUTTON = `rounded-lg bg-steel/30 text-mist transition-colors hover:bg-steel/60 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-steel/30 ${FOCUS}`;

/** The selected option of a group. */
export const BUTTON_ON = `rounded-lg bg-neon/15 font-semibold text-neon ring-1 ring-inset ring-neon/40 disabled:cursor-not-allowed ${FOCUS}`;

/** The one action a screen is about. */
export const PRIMARY = `rounded-lg bg-neon/20 px-4 py-2.5 text-sm font-semibold text-neon ring-1 ring-inset ring-neon/40 transition-colors hover:bg-neon/30 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`;

/** Small heading over a group of controls or a block of numbers. */
export const LABEL = "text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-neon/80";

/** Fine print under a control. */
export const HINT = "text-[0.7rem] leading-snug text-mist/70";

export const TONE = {
  danger: "text-red-400",
  caution: "text-amber-400",
  note: "text-mist/80",
  good: "text-emerald-400",
} as const;
