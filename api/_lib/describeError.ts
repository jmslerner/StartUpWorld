/**
 * What went wrong, for the log: the message (or the error's name when the message is empty), its code, and the same for
 * each cause inside an AggregateError. Anything shaped like a connection string is removed, so a password can never
 * reach the logs through this line.
 */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  const add = (e: unknown): void => {
    if (!(e instanceof Error)) {
      parts.push(String(e));
      return;
    }
    const code = (e as { code?: unknown }).code;
    const text = e.message || e.name;
    parts.push(typeof code === "string" && !text.includes(code) ? `${text} (${code})` : text);
    if (e instanceof AggregateError) e.errors.forEach(add);
  };
  add(err);
  return parts.join("; ").replace(/rediss?:\/\/\S+/gi, "[redis url]");
}
