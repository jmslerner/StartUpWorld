/**
 * Parses the entries a list or a sorted set holds, in the order they were read.
 *
 * When one is not JSON, the error says which one and nothing more. JSON.parse's own message quotes the text it could
 * not read (`Unexpected token 'A', "Acme Corp,"... is not valid JSON`), and what is stored here is what players
 * submitted, so that message must not be the one that reaches a log.
 */
export function parseStoredEntries(raw: readonly unknown[]): unknown[] {
  return raw.map((entry, index) => {
    try {
      return JSON.parse(String(entry));
    } catch {
      throw new Error(`stored entry at index ${index} is not valid JSON`);
    }
  });
}
