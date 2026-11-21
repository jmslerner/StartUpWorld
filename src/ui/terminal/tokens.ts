/**
 * Typewriter pacing tokens the engine embeds in its prose, e.g. "[[beat]]".
 * The terminal's typewriter turns them into pauses and speed changes; anywhere
 * else the same text is shown (the event card, the 3D world's inspector) they
 * have to be removed, or the player sees the raw markup.
 */
export const TYPEWRITER_TOKEN_RE = /\[\[(short|beat|long|typefast|typeslow|typereset)\]\]/g;

/** `text` as it should read outside the typewriter: tokens gone, and the gap each one left closed up. */
export const stripTypewriterTokens = (text: string): string =>
  text
    .replaceAll(TYPEWRITER_TOKEN_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
