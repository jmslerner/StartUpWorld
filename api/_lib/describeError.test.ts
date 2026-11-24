// Lives under api/_lib on purpose: Vercel turns every other file in api/ into a function, and skips paths that contain
// "/_".
import { describe, expect, it } from "vitest";
import { describeError } from "./describeError.js";

// What describeError builds from an error (its message or name, its code, the causes inside an AggregateError) is
// pinned through the keep-alive, in keepalive.test.ts, and so is the replacement of two plain connection strings. The
// strings here are the ones that message does not hold. Each is left partly standing by a pattern that is only a little
// weaker than the real one, and every such pattern passed the tests before these were written.
describe("describeError: no part of a connection string is left", () => {
  it.each([
    [
      "a password as long as a hosted database issues",
      "connect to rediss://default:a-made-up-password-that-is-sixty-characters-long-0123456789a@db.example.com:6379 failed",
      "connect to [redis url] failed",
    ],
    [
      "punctuation in the password, a database number and options",
      "rediss://default:p%40ss,w0rd!$*+;=~@db.example.com:6379/0?family=6 refused the command",
      "[redis url] refused the command",
    ],
    [
      "a pasted password with a slash, a hash and a question mark that were never escaped",
      "redis://default:pa/ss#wo?rd@db.example.com:6379 is not a URL",
      "[redis url] is not a URL",
    ],
    ["no user and no password", "redis://db.example.com:6379 timed out", "[redis url] timed out"],
  ])("%s", (_shape, message, expected) => {
    expect(describeError(new Error(message))).toBe(expected);
  });

  it("is replaced in a value that is not an Error as well", () => {
    expect(describeError("rejected by rediss://default:s3cret@db.example.com:6379")).toBe("rejected by [redis url]");
  });

  it("is replaced in a cause inside an AggregateError as well", () => {
    const refused = Object.assign(new Error("connect to rediss://default:s3cret@db.example.com:6379 was refused"), {
      code: "ECONNREFUSED",
    });
    expect(describeError(new AggregateError([refused], ""))).toBe("AggregateError; connect to [redis url] was refused (ECONNREFUSED)");
  });
});
