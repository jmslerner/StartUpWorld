import type { VercelRequest } from "@vercel/node";

/**
 * The request's body, as Vercel parsed it.
 *
 * Vercel parses the body when `req.body` is first read, and that read throws when it cannot: the body is not the JSON
 * its Content-Type promises, or the header itself does not parse. The words of that error are Vercel's ("Invalid JSON",
 * "invalid media type"), and nothing here can keep them from one day quoting what they are about, as JSON.parse's do.
 * That would be what a player sent. So the error thrown instead says only that it was the request that could not be
 * read, which is also clearer in a log than Vercel's words are.
 */
export function readBody(req: VercelRequest): unknown {
  try {
    return req.body;
  } catch {
    throw new Error("the request's body could not be read");
  }
}
