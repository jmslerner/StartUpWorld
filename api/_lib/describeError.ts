/**
 * What went wrong, for the log: the message (or the error's name when the message is empty), its code, and the same for
 * each cause inside an AggregateError. Anything shaped like a connection string is removed, so the password in one
 * cannot reach the logs through a line built from this.
 *
 * A password that a server repeats from a login is not removed here. describeErrorWithoutArguments does that.
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
 * describeError, without what a server repeats of a command it does not know.
 *
 * A Redis server answers such a command by repeating its arguments:
 *
 *     ERR unknown command 'ZADD', with args beginning with: 'leaderboard' '90' '{"id":"4242-1","companyName":"Acme",…
 *
 * For ZADD and LPUSH the arguments are a player's entry. For AUTH, which the client sends every time it connects, they
 * are the user and the password, and that reply can reach a command that was waiting behind the login. A database these
 * functions work with knows the commands, so the reply should never come. If it does, what follows those words is left
 * out of the text. The cut is at the first time the words appear: an entry can hold them too, further on.
 */
export function describeErrorWithoutArguments(err: unknown): string {
  const text = describeError(err);
  const at = text.indexOf(ARGUMENTS_FOLLOW);
  return at === -1 ? text : `${text.slice(0, at + ARGUMENTS_FOLLOW.length)} [not logged]`;
}
