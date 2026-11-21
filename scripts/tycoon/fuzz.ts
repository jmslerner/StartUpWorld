// E3 — command fuzzer (spec §10.3 / §12.3, lifted from the prototype's fuzz.ts): random legal and illegal commands from a
// vocabulary covering every command form, real names, ids, slugs, near-misses, reserved words, fractional and huge counts,
// pending events and `end`. After EVERY command: roster invariant (I1/I2), JSON round-trip, `state.rng` untouched by every
// tycoon command and every release, bounds (I4), finite numbers, no throw.
import { executeCommand } from "../../src/engine/commands";
import { mulberry } from "../../src/engine/__golden__/legacyBots";
import { rosterInvariantHolds, rosterOf } from "../../src/engine/tycoon/roster";
import { slugify } from "../../src/engine/projects/commands";
import type { GameState } from "../../src/types/game";
import { seededInitial } from "./bots";

const TYCOON = new Set(["team", "recruit", "fire", "retain", "build", "project", "projects", "staff"]);
const roles = ["eng", "ux", "marketing", "sales", "ops", "hr", "legal", "data", "pm", "exec", "nope"];
const types = ["feature", "growth", "premium", "plumbing", "moonshot", "feat", "loop", "infra", "bogus"];
const sizes = ["s", "m", "l", "xl", "huge", ""];
const words = ["on", "off", "all", "auto", "start", "crunch", "cancel", "e1", "#3", "c7", "b2", "p9", "atlas", "Smart Inbox", "x".repeat(40), "", "1.5", "-2", "5000"];

export interface FuzzResult { seeds: number; commands: number; failures: number; messages: string[] }

export const runFuzz = (seeds: number, perSeed: number): FuzzResult => {
  const res: FuzzResult = { seeds, commands: 0, failures: 0, messages: [] };
  const fail = (msg: string) => {
    res.failures += 1;
    if (res.messages.length < 12) res.messages.push(msg);
  };
  for (let k = 0; k < seeds; k++) {
    const seed = (k + 1) * 7919;
    const r = mulberry(seed);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    let s: GameState = seededInitial(seed);
    for (const setup of ["name Fuzz", "company FuzzCo", `founder ${pick(["visionary", "hacker", "sales-animal", "philosopher"])}`, `cofounder ${pick(["operator", "builder", "rainmaker", "powderkeg"])}`]) {
      s = executeCommand(s, setup).state;
    }
    s = { ...s, cash: 5_000_000 };
    for (let i = 0; i < perSeed && !s.gameOver; i++) {
      const roster = rosterOf(s);
      const person = roster.length ? pick(roster) : null;
      const who = person ? pick([person.id, person.name.split(" ")[0], person.name, `#${person.id.slice(1)}`]) : pick(words);
      const builds = s.product?.active ?? [];
      const slug = builds.length ? pick(builds).slug : pick(words);
      const options = [
        () => "end", () => "end", () => `choose ${1 + Math.floor(r() * 3)}`,
        () => `hire ${pick(roles)} ${pick(["1", "2", "1.5", "0.5", "40", "-1", "abc", "5000"])}`,
        () => `ship ${pick([slug, slug.slice(0, 3), slug + "x", "patch-" + i, ""])}`,
        () => `launch camp-${i}`, () => "pitch", () => `raise ${pick(["friends", "preseed", "vc 500k"])}`,
        () => `team ${pick(["", who, pick(roles), "all"])}`,
        () => `recruit ${pick(roles)}`, () => `recruit ${pick(roles)} ${pick(["1", "2", "3", "4", "0", "x"])}`,
        () => `retain ${who}`, () => `fire ${pick([who, `${pick(roles)} ${pick(["1", "2", "3", "200", ""])}`, ""])}`,
        () => "build", () => `build ${pick(types)} ${pick(sizes)} ${pick(words)}`, () => `build ${pick(types)}`,
        () => `build crunch ${pick([slug, ""])} ${pick(["on", "off", ""])}`, () => `build cancel ${pick([slug, ""])}`,
        () => `project ${pick(["", "start feature m alpha", "crunch", "cancel " + slug, "ship " + slug])}`,
        () => `staff ${pick([slug, "nope", "off"])} ${pick(["auto", who, `${pick(roles)} 2`, slug])}`,
        () => `staff off ${pick([who, slug, "eng 2"])}`,
        () => `pricing ${pick(["consumer", "prosumer", "enterprise"])}`, () => "status", () => "help", () => "fire",
        () => `buy ${pick(["office", "lounge"])}`,
      ];
      const input = pick(options)();
      const before = s;
      let out;
      try {
        out = executeCommand(s, input);
      } catch (e) {
        fail(`throw seed=${seed} week=${s.week} cmd="${input}": ${(e as Error).message}`);
        break;
      }
      res.commands += 1;
      s = out.state;
      const tokens = input.trim().split(/\s+/);
      const head = tokens[0];
      const isRelease = head === "ship" && (before.product?.active ?? []).some((b) => b.slug === slugify(tokens.slice(1).join(" ")) || b.id === tokens.slice(1).join(" "));
      if ((TYCOON.has(head) || isRelease) && s.rng !== before.rng) fail(`state.rng moved seed=${seed} cmd="${input}"`);
      if (!rosterInvariantHolds(s)) fail(`invariant seed=${seed} week=${s.week} cmd="${input}"`);
      const json = JSON.stringify(s);
      if (JSON.stringify(JSON.parse(json)) !== json) fail(`json seed=${seed} cmd="${input}"`);
      const p = s.people;
      const q = s.product;
      if (p) {
        if (p.roster.length > 120) fail("roster cap");
        for (const e of p.roster) {
          const intOk = [e.pace, e.craft, e.energy].every(Number.isInteger);
          if (!intOk || e.pace < 1 || e.pace > 5 || e.craft < 1 || e.craft > 5 || e.energy < 0 || e.energy > 100 || !Number.isFinite(e.salary) || e.salary <= 0) {
            fail(`person bounds ${JSON.stringify(e)}`);
          }
          if ((e.offerKind === null) !== (e.offerDueWeek === 0) || (e.offerDueWeek === 0 && e.leadOnNotice !== null)) fail(`offer fields ${JSON.stringify(e)}`);
        }
        for (const pool of Object.values(p.candidates)) if ((pool?.length ?? 0) > 3) fail("pool size");
        if (new Set(p.roster.map((e) => e.id)).size !== p.roster.length) fail("duplicate ids");
        const maxSerial = Math.max(0, ...p.roster.map((e) => Number(e.id.slice(1))));
        if (p.nextId <= maxSerial) fail("people.nextId");
      }
      if (q) {
        if (q.active.length > 3 || q.shipped.length > 12) fail("product bounds");
        if (q.cruft < 0 || q.cruft > 100 || q.moat < 0 || q.moat > 100 || q.arpuCarry < 0 || q.arpuCarry >= 1) fail(`product meters ${q.cruft} ${q.moat} ${q.arpuCarry}`);
        for (const b of q.active) if (b.progress > b.scope + 1e-6 || b.progress < 0 || b.polish > 9 || b.polish < 0 || b.surprises > 3) fail(`build bounds ${JSON.stringify(b)}`);
        const serials = [...q.active, ...q.shipped].map((b) => Number(b.id.slice(1)));
        if (q.nextId <= Math.max(0, ...serials)) fail("product.nextId (I3)");
        if (q.shippedCount < q.shipped.length) fail("shippedCount");
      }
      if (!Number.isFinite(s.cash) || !Number.isFinite(s.arpu) || !Number.isFinite(s.users)) fail(`nan seed=${seed} cmd="${input}"`);
    }
  }
  return res;
};
