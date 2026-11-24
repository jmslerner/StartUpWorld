/**
 * One stored entry, parsed. `index` is its place in the reply it came in, counting from 0.
 *
 * The functions store only what JSON.stringify produced, so a value that does not parse was written or cut short by
 * something else. JSON.parse's own message quotes the text around the mistake, and in a stored entry that text is what
 * a player typed. The error thrown here says where the entry is, and nothing about what is in it, so it can be logged.
 */
export function parseStoredEntry(stored: unknown, index: number): unknown {
  try {
    return JSON.parse(String(stored));
  } catch {
    throw new Error(`the stored entry at index ${index} is not valid JSON`);
  }
}
