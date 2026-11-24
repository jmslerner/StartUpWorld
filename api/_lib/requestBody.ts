import type { VercelRequest } from "@vercel/node";

/**
 * The request's body, as Vercel parsed it.
 *
 * Vercel parses the body the first time `req.body` is read, and that read throws when it cannot: the body is not the
 * JSON its content type says it is, or the content type itself is malformed. The error is Vercel's, and its wording is
 * not this repository's to keep. A parser's message can quote the text it choked on, as JSON.parse's does, and here
 * that text is what a player sent. The error thrown instead names the request as the cause and repeats nothing from
 * it, so it can be logged.
 */
export function readBody(req: VercelRequest): unknown {
  try {
    return req.body;
  } catch {
    throw new Error("the request body could not be read");
  }
}
