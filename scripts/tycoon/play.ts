// Scripted play-through: prints the terminal output of a seeded session, checking the roster invariant after every command.
//   npx tsx scripts/tycoon/play.ts <seed> <founder> <cofounder> "<cmd>" ...
//   "~cmd"     runs silently
//   "auto"     resolves a pending event with its last choice (silently), as the prototype transcripts did
//   "?team"    prints every roster record · "?build" prints the active builds and the product meters
//   "ff:N:bot" fast-forwards N weeks with a bot from scripts/tycoon/bots.ts
import { executeCommand } from "../../src/engine/commands";
import { mulberry } from "../../src/engine/__golden__/legacyBots";
import { rosterInvariantHolds } from "../../src/engine/tycoon/roster";
import type { GameState } from "../../src/types/game";
import { newTally, playWeek, seededInitial } from "./bots";
import type { BotKind } from "./bots";

const [seedArg, founder, cofounder, ...cmds] = process.argv.slice(2);
if (!seedArg || !founder || !cofounder) {
  console.error('Usage: tsx scripts/tycoon/play.ts <seed> <founder> <cofounder> "<cmd>" ...');
  process.exit(2);
}
const seed = Number(seedArg) >>> 0;
let s: GameState = seededInitial(seed);
for (const setup of ["name Ada", "company Loopwell", `founder ${founder}`, `cofounder ${cofounder}`]) s = executeCommand(s, setup).state;
const tally = newTally();
const r = mulberry(seed);
let breaks = 0;

for (const raw of cmds) {
  if (raw.startsWith("ff:")) {
    const [, n, kind] = raw.split(":");
    for (let i = 0; i < Number(n) && !s.gameOver; i++) s = playWeek(s, (kind ?? "skilled") as BotKind, tally, r);
    const heads = Object.values(s.team).reduce((a, b) => a + b, 0);
    console.log(
      `[fast-forward ${n} weeks with the ${kind} bot -> week ${s.week}, ${s.companyPhase}/${s.stage}, cash $${Math.round(s.cash).toLocaleString()}, ` +
        `users ${s.users}, team ${heads}${s.gameOver ? `, OVER ${s.gameOver.ending}` : ""}${s.pendingEvent ? `, pending ${s.pendingEvent.id}` : ""}]`,
    );
    continue;
  }
  if (raw === "auto") {
    if (s.pendingEvent) s = executeCommand(s, `choose ${s.pendingEvent.choices.length}`).state;
    continue;
  }
  if (raw === "?team") {
    for (const e of s.people?.roster ?? []) {
      console.log(
        `    [${e.id} ${e.name} ${e.role} p${e.pace} c${e.craft} q=${e.quirk} E${e.energy} $${e.salary} build=${e.buildId} engaged=${e.engaged} ` +
          `offer=${e.offerDueWeek}/${e.offerKind}/${e.leadOnNotice} shipped=${e.shipped}]`,
      );
    }
    continue;
  }
  if (raw === "?build") {
    for (const b of s.product?.active ?? []) console.log(`    [${JSON.stringify(b)}]`);
    console.log(
      `    [cruft ${s.product?.cruft} moat ${s.product?.moat} shipped ${s.product?.shippedCount} | week ${s.week} ap ${s.ap} cash ${Math.round(s.cash)} ` +
        `cohesion ${s.culture.cohesion} morale ${s.culture.morale} team ${JSON.stringify(s.team)}]`,
    );
    continue;
  }
  const quiet = raw.startsWith("~");
  const input = quiet ? raw.slice(1) : raw;
  const res = executeCommand(s, input);
  s = res.state;
  if (!rosterInvariantHolds(s)) {
    breaks += 1;
    console.log(`!! INVARIANT BROKEN after "${input}"`);
  }
  if (quiet) continue;
  console.log(`> ${input}${res.sound ? `   [${res.sound}]` : ""}`);
  for (const l of res.logs) for (const line of l.text.split("\n")) console.log(`${l.kind === "error" ? "! " : "  "}${line}`);
}
if (breaks > 0) process.exit(1);
