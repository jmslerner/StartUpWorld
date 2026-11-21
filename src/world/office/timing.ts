/**
 * When things happen during an office rebuild (a phase change), for the systems
 * that have to act in step with it. Pure constants: no three.js.
 *
 * Times are seconds after the snapshot that changed the phase.
 */

/** The old office sinks away over this long, this far. */
export const REBUILD_SINK_SECONDS = 0.4;
export const REBUILD_SINK_DEPTH = 2.4;
/** The new building rises (starting while the old one is still going down). */
export const REBUILD_RISE_DELAY = 0.22;
export const REBUILD_RISE_SECONDS = 0.5;
export const REBUILD_RISE_DEPTH = 2.2;
/**
 * The new office's contents pop in one by one, in the order they were built —
 * desks and chairs first, then stations, décor and assets — starting at
 * REBUILD_POP_START and spread over REBUILD_POP_SPREAD; each pop takes REBUILD_POP_SECONDS.
 */
export const REBUILD_POP_START = 0.55;
export const REBUILD_POP_SPREAD = 0.3;
export const REBUILD_POP_SECONDS = 0.3;
/** Everything in the new office is in place by now. */
export const REBUILD_CONTENTS_VISIBLE_BY = REBUILD_POP_START + REBUILD_POP_SPREAD + REBUILD_POP_SECONDS;
