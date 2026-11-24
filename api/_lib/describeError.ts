/**
 * What went wrong, for a log line: the message (or the error's name when the message is empty), its code, and the same
 * for each cause inside an AggregateError. Anything shaped like a connection string is removed, so a password can never
 * reach the logs through a line that is built from this.
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

/** Where a Redis server starts quoting a command's arguments back, in its reply to a command it does not know. */
const ARGUMENTS_FOLLOW = ", with args beginning with:";

/**
 * describeError, for the functions whose commands carry what a player submitted.
 *
 * Redis answers a command it does not know by quoting the command's arguments back:
 *
 *     ERR unknown command 'LPUSH', with args beginning with: 'graveyard' '{"id":"gv-1","companyName":"Acme",…
 *
 * and for LPUSH and ZADD those arguments are the player's entry. It takes a database without these commands to see
 * that reply at all, but if it ever comes, the quoted arguments are left out, so an entry cannot reach the logs that
 * way either.
 */
export function describeErrorWithoutArguments(err: unknown): string {
  const text = describeError(err);
  const at = text.indexOf(ARGUMENTS_FOLLOW);
  return at === -1 ? text : `${text.slice(0, at + ARGUMENTS_FOLLOW.length)} [not logged]`;
}
