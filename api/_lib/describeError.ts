/**
 * What went wrong, for a log line: the message (or the error's name when the message is empty), its code, and the same
 * for each cause inside an AggregateError. Anything shaped like a connection string is removed, so the password in one
 * cannot reach the logs through a line that is built from this.
 *
 * What a server quotes back of a command is not removed here: describeErrorWithoutArguments does that.
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

/**
 * The words after which a Redis server quotes a command's arguments back, in its reply to a command it does not know.
 * Without the comma the reply has in front of them: replacing a connection string can take that comma along.
 */
const ARGUMENTS_FOLLOW = "with args beginning with:";

/**
 * describeError, without what a server quotes back of a command.
 *
 * Redis answers a command it does not know by quoting the command's arguments:
 *
 *     ERR unknown command 'LPUSH', with args beginning with: 'graveyard' '{"id":"gv-1","companyName":"Acme",…
 *
 * For LPUSH and ZADD the arguments are a player's entry. For AUTH, which the client sends on every connect, they are
 * the user and the password. It takes a server without these commands to see that reply at all, but if it ever comes,
 * what follows the server's words is left out, so neither can reach the logs that way. The cut is at the first time the
 * words appear: an entry can hold them too, further on.
 */
export function describeErrorWithoutArguments(err: unknown): string {
  const text = describeError(err);
  const at = text.indexOf(ARGUMENTS_FOLLOW);
  return at === -1 ? text : `${text.slice(0, at + ARGUMENTS_FOLLOW.length)} [not logged]`;
}
