/**
 * The Next Round story pack switch. Mutable on purpose, like the tuning tables: a proof script or a simulator sweep sets
 * `storyConfig.enabled = false` in memory to play the game exactly as it was before the pack (no story events, no
 * later scenes, no interludes, no news lines, no epilogues).
 */
export const storyConfig = { enabled: true };
