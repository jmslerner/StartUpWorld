// Lives under api/_lib on purpose: Vercel turns every other file in api/ into a function, and skips paths that contain
// "/_".
import { describe, expect, it } from "vitest";
import { describeError, describeErrorWithoutArguments } from "./describeError.js";

// What describeError says about an error (its message, name, code and causes) is pinned by the keep-alive's tests,
// through the line that function logs. These pin how much of a connection string it takes out, with strings shaped
// like a real one: a pattern that stops early, or expects a particular user, passed every test before these.
describe("describeError: a connection string is replaced whole, whatever it looks like", () => {
  it.each([
    [
      "a password as long as a real one",
      "connect to rediss://default:0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ@db.example.com:6379 failed",
      "connect to [redis url] failed",
    ],
    [
      "escapes and punctuation in the password",
      "could not reach rediss://default:pa%2Fss%2Bw0rd%3D~x-y_z!$&'()*+,;=@db.example.com:6379 and gave up",
      "could not reach [redis url] and gave up",
    ],
    ["another user", "redis://app-user:s3cret@10.0.0.7:6380 refused the connection", "[redis url] refused the connection"],
    ["no user and no password", "nothing listens at redis://db.example.com:6379", "nothing listens at [redis url]"],
    [
      "a database number and options after the port",
      "rediss://default:s3cret@db.example.com:6379/0?family=6&name=board is not reachable",
      "[redis url] is not reachable",
    ],
    ["upper case", "REDISS://DEFAULT:S3CRET@DB.EXAMPLE.COM:6379 timed out", "[redis url] timed out"],
    [
      "more than one",
      "primary redis://a:one@h1:1 and replica rediss://b:two@h2:2 both failed",
      "primary [redis url] and replica [redis url] both failed",
    ],
  ])("%s", (_what, message, expected) => {
    expect(describeError(new Error(message))).toBe(expected);
  });

  it("also in something thrown that is not an Error, and in every cause of an AggregateError", () => {
    expect(describeError("rediss://default:s3cret@db.example.com:6379 went away")).toBe("[redis url] went away");
    const causes = [
      new Error("first rediss://default:s3cret@db.example.com:6379 failed"),
      new Error("then redis://default:s3cret@10.0.0.7:6379 failed"),
    ];
    expect(describeError(new AggregateError(causes, "no address worked"))).toBe(
      "no address worked; first [redis url] failed; then [redis url] failed",
    );
  });

  it.each(["redis unreachable", "Redis did not reply within 3000 ms", "connect ECONNREFUSED 10.0.0.1:6379"])(
    "leaves a reason alone that only mentions Redis or an address: %s",
    (message) => {
      expect(describeError(new Error(message))).toBe(message);
    },
  );
});

describe("describeErrorWithoutArguments: what a server quotes back of a command is left out", () => {
  it("cuts the reply of redis-server 7 to a command it does not know after the words that announce the arguments", () => {
    const reply = `ERR unknown command 'ZADD', with args beginning with: 'leaderboard' '90' '{"id":"4242-1","companyName":"Acme","founderName":"Ada","fi' `;
    expect(describeErrorWithoutArguments(new Error(reply))).toBe("ERR unknown command 'ZADD', with args beginning with: [not logged]");
  });

  it("cuts at the server's own words, not at the same words inside what it quotes", () => {
    // A company name is long enough to hold these words. The first ones in the reply are the server's.
    const reply = `ERR unknown command 'ZADD', with args beginning with: 'leaderboard' '90' '{"id":"5-1","companyName":"Hooli, with args beginning with: x","fo' `;
    expect(describeErrorWithoutArguments(new Error(reply))).toBe("ERR unknown command 'ZADD', with args beginning with: [not logged]");
  });

  it("finds the server's words when a connection string was replaced right in front of them", () => {
    // The replacement takes everything up to the next space, and that includes the comma in front of "with args".
    const reply = "ERR unknown command 'redis://x', with args beginning with: 'graveyard' 'Acme' ";
    expect(describeErrorWithoutArguments(new Error(reply))).toBe("ERR unknown command '[redis url] with args beginning with: [not logged]");
  });

  it("leaves out a login as well: the client sends AUTH with the password on every connect", () => {
    const reply = "ERR unknown command 'AUTH', with args beginning with: 'default' 's3cret' ";
    expect(describeErrorWithoutArguments(new Error(reply))).toBe("ERR unknown command 'AUTH', with args beginning with: [not logged]");
  });

  it("leaves out everything that follows, also on later lines", () => {
    const reply = "ERR unknown command 'LPUSH', with args beginning with: 'graveyard' 'Ran out\nof runway' 'Acme'";
    expect(describeErrorWithoutArguments(new Error(reply))).toBe("ERR unknown command 'LPUSH', with args beginning with: [not logged]");
  });

  it.each([
    "WRONGTYPE Operation against a key holding the wrong kind of value",
    "OOM command not allowed when used memory > 'maxmemory'.",
    "NOPERM this user has no permissions to run the 'zadd' command",
    "Redis did not reply within 3000 ms",
  ])("says the same as describeError when no arguments are quoted: %s", (message) => {
    expect(describeErrorWithoutArguments(new Error(message))).toBe(message);
  });

  it("still replaces a connection string, before the arguments and without them", () => {
    expect(describeErrorWithoutArguments(new Error("ERR upstream rediss://default:s3cret@db.example.com:6379 is not reachable"))).toBe(
      "ERR upstream [redis url] is not reachable",
    );
    const both = `proxy redis://default:s3cret@10.0.0.7:6379 says: ERR unknown command 'LPUSH', with args beginning with: 'graveyard' '{"companyName":"Acme"'`;
    expect(describeErrorWithoutArguments(new Error(both))).toBe(
      "proxy [redis url] says: ERR unknown command 'LPUSH', with args beginning with: [not logged]",
    );
  });
});
