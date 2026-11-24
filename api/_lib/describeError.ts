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

/** What a Redis server writes before it repeats a command's arguments, in its reply to a command it does not know. */
const ARGUMENTS_FOLLOW = "with args beginning with:";

/**
 * describeError, for the functions whose commands carry what a player typed.
 *
 * A Redis server answers a command it does not know by repeating the command's arguments:
 *
 *     ERR unknown command 'ZADD', with args beginning with: 'leaderboard' '90' '{"id":"4242-1","companyName":"Acme",…
 *
 * and for ZADD and LPUSH those arguments are the player's entry. A database these functions work with knows the
 * commands, so the reply should never come. If it does, what follows those words is left out of the text.
 */
export function describeErrorWithoutArguments(err: unknown): string {
  const text = describeError(err);
  const at = text.indexOf(ARGUMENTS_FOLLOW);
  return at === -1 ? text : `${text.slice(0, at + ARGUMENTS_FOLLOW.length)} [not logged]`;
}
