import type { ActionResult, BoardMember, Candidate, Employee, GameState, TeamRole } from "../../types/game";
import { LEAD_LOSS, ROLE_ORDER, ROSTER_CAP } from "../tycoon/constants";
import { ROLE_TOKENS_HELP, looksLikeRole, roleAliases, roleComp } from "../tycoon/comp";
import type { Line } from "../tycoon/kit";
import { NO_AP, canSpendAp, ensurePlayable, err, money, spendAp, withLogLines } from "../tycoon/kit";
import {
  addEmployee, canAddEmployee, effectiveness, ensureSlices, findEmployee, marketSalary, patchEmployee, removeEmployee, removeEmployees,
  removeHeads, rosterOf, serialOf, setPeople, standardSalary, wantOf,
} from "../tycoon/roster";
import { getApCost } from "../economy";
import { canHireRole, ROLE_MIN_STAGE } from "../stagePerks";
import { clamp } from "../utils";
import { CANDIDATES_PER_ROLE, LAYOFF_BOARD_DELTA, LAYOFF_BOARD_MIN, OFFER_IMMUNITY_WEEKS, RETAIN_ENERGY_FLOOR, TEAM_LIST_MAX } from "./constants";
import { hasVetting, poolFor, storedPool } from "./candidates";
import {
  buildAtRisk, buildById, energyWordOf, fireFallout, firstName, handleOf, hasHr, headsOf, hurtCulture, isLeadNow, retainBonus,
  retainSalary, severanceOf, totalPayroll,
} from "./rules";
import { QUIRK_BLURB, sortedRoster, weeksLeftOf } from "./view";

// `team`, `recruit`, `fire <args>` and `retain` (TYCOON-SPEC §4.2–§4.5). Bare `fire` never reaches this file.
// Refusals are `err` on the state as it came in (nothing spent, nothing changed but logSeq). Every state-changing
// path runs `ensureSlices` before it reads the roster, so a slice-less state migrates at the command boundary.

const GAME_OVER = "Game over. Click 'Play Again' or refresh to start a new run.";
const FULL_ROSTER = `You personally know ${ROSTER_CAP} employees. That is the limit of human friendship and of this org chart.`;

const pad = (text: string, width: number): string => (text.length >= width ? text : text + " ".repeat(width - text.length));
const round1 = (n: number): number => Math.round(n * 10) / 10;
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
/** A failed person lookup whose first word reads like a role ("engineer", "designers") also points at the role tokens. */
const withRoleHint = (error: string, query: string, example: string): string =>
  looksLikeRole(query.trim().split(/\s+/)[0] ?? "") ? `${error} (Roles are ${ROLE_TOKENS_HELP}: ${example}.)` : error;

const lostLeadLine = (names: string[]): Line => ({
  text: names.length === 1
    ? `${names[0]} lost its lead and ${Math.round(LEAD_LOSS * 100)}% of its progress.`
    : `${names.join(" and ")} lost their leads and ${Math.round(LEAD_LOSS * 100)}% of their progress.`,
  kind: "event",
});

// ── team (§4.2) ──

/** "→ phoenix (lead)" or "day job". */
const whereTag = (state: GameState, e: Employee): string => {
  const b = buildById(state, e.buildId);
  if (!b) return "day job";
  return `→ ${b.slug}${isLeadNow(state, e) ? " (lead)" : ""}`;
};

const rowOf = (state: GameState, e: Employee): Line => ({
  text:
    `  ${pad(e.id, 5)}${pad(e.name, 18)} ${pad(e.role, 12)} pace ${e.pace} craft ${e.craft}  energy ${pad(String(e.energy), 3)}  ` +
    `${pad(money(e.salary), 7)} ${pad(e.quirk ?? "-", 12)} ${whereTag(state, e)}` +
    `${e.offerDueWeek > 0 ? `  OFFER: gone in ${weeksLeftOf(state, e)}w` : ""}`,
  kind: e.offerDueWeek > 0 ? "event" : "system",
});

const teamList = (state: GameState, opts: { role?: TeamRole; all?: boolean }): ActionResult => {
  const { role } = opts;
  const roster = sortedRoster(state, role);
  const heads = role ? headsOf(state, role) : ROLE_ORDER.reduce((acc, r) => acc + headsOf(state, r), 0);
  if (heads === 0 && roster.length === 0) {
    return withLogLines(state, [{ text: role ? `Nobody in ${role}.` : "Team: nobody. It's just the founders. `hire <role> 1` or `recruit <role>`." }]);
  }
  const offers = roster.filter((e) => e.offerDueWeek > 0).length;
  const shownHeads = round1(heads);
  const lines: Line[] = [{
    text:
      `Team${role ? ` (${role})` : ""}: ${shownHeads} ${plural(shownHeads, "person", "people")}` +
      `${role ? "" : ` · payroll ${money(totalPayroll(state))}/wk`}${offers ? ` · ${offers} with an outside offer` : ""}`,
  }];
  const cap = opts.all ? ROSTER_CAP : TEAM_LIST_MAX;
  for (const e of roster.slice(0, cap)) lines.push(rowOf(state, e));
  if (roster.length > cap) lines.push({ text: `  ... ${roster.length - cap} more. \`team <role>\` filters; \`team <name>\` opens a file.` });
  const unlisted = round1(heads - roster.length);
  if (unlisted > 0) lines.push({ text: `  Plus ${unlisted} you never learned the names of (standard issue).` });
  if (roster.length > 0 && roster.length <= cap) lines.push({ text: "`team <name>` opens a file. `recruit <role>` shows who is on the market." });
  return withLogLines(state, lines);
};

const teamCard = (state: GameState, e: Employee): ActionResult => {
  const handle = handleOf(state, e);
  const b = buildById(state, e.buildId);
  const lines: Line[] = [
    { text: `${e.name} — ${e.role} (${e.id}), here since week ${e.hiredWeek}` },
    {
      text: `  Pace ${e.pace}/5 · Craft ${e.craft}/5 · works like ${effectiveness(e).toFixed(2)} standard ${e.role} · credited on ${e.shipped} ${plural(e.shipped, "release", "releases")}`,
    },
    {
      text: `  Energy ${e.energy}/100 (${energyWordOf(e.energy)}) · ${money(e.salary)}/wk (the going rate for these stats: ${money(marketSalary(e.role, e.pace, e.craft))})`,
    },
    { text: `  ${e.quirk ? `Quirk: ${e.quirk} — ${QUIRK_BLURB[e.quirk]}.` : "No quirk. A professional. Suspicious."}` },
    { text: `  ${b ? `On build: ${b.slug}${isLeadNow(state, e) ? " (lead)" : ""}.` : "On the day job."}` },
  ];
  if (e.offerDueWeek > 0) {
    const risk = buildAtRisk(state, e);
    lines.push({
      text:
        `  ${e.offerKind === "burnout" ? "Burnt out and interviewing" : "Holding an outside offer"}: gone in ${weeksLeftOf(state, e)} week(s) unless you \`retain ${handle}\`.` +
        `${risk ? ` ${risk.name} loses a quarter if they go.` : ""}`,
      kind: "event",
    });
  }
  lines.push({
    text:
      `  \`retain ${e.id}\` (1 AP, ${money(retainBonus(e))} bonus, pay → ${money(retainSalary(e))}/wk) · ` +
      `\`fire ${e.id}\` (1 AP, ${money(severanceOf(e.salary))} severance) · \`staff <build> ${e.id}\``,
  });
  return withLogLines(state, lines);
};

/** `team` · `team all` · `team <role>` · `team <name|id>`. Read-only: works during a pending event and after game over. */
export const teamCommand = (state: GameState, rest: string[]): ActionResult => {
  const query = rest.join(" ").trim();
  const lower = query.toLowerCase();
  if (!query) return teamList(state, {});
  if (lower === "all") return teamList(state, { all: true });
  const role = roleAliases[lower];
  if (role) return teamList(state, { role });
  const found = findEmployee(state, query);
  if (!found.ok) return err(state, withRoleHint(found.error, query, "`team eng`"));
  return teamCard(state, found.employee);
};

// ── recruit (§4.3) ──

const RECRUIT_USAGE = "Usage: recruit <role> - see this week's three candidates. recruit <role> <1-3> - sign one (1 AP + the role's hire cost).";

const vsStandard = (ask: number, role: TeamRole): string => {
  const pct = Math.round((ask / standardSalary(role) - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% vs standard`;
};

const candidateLine = (c: Candidate, i: number): Line => ({
  text:
    `  ${i + 1}) ${pad(c.name, 18)} ${c.vetted ? "" : "résumé: "}pace ${c.vetted ? c.pace : c.claimedPace} craft ${c.vetted ? c.craft : c.claimedCraft} · ` +
    `quirk ${c.vetted ? (c.quirk ?? "none") : "?"} · asks ${money(c.ask)}/wk (${vsStandard(c.ask, c.role)})`,
});

const recruitLook = (state: GameState, role: TeamRole, token: string): ActionResult => {
  if (state.gameOver) return err(state, GAME_OVER);
  const { state: s, pool } = poolFor(ensureSlices(state), role);
  const vetted = pool.length > 0 ? pool[0].vetted : hasVetting(s);
  const lines: Line[] = [{
    text:
      `Candidates for ${role} this week (signing ${money(roleComp[role].hireCost)}, 1 AP) — ` +
      `${vetted ? "vetted by HR: what you see is what you get" : "unvetted: résumés are aspirational documents"}`,
  }];
  if (pool.length === 0) lines.push({ text: "  Nobody left this week. New faces after `end`." });
  pool.forEach((c, i) => lines.push(candidateLine(c, i)));
  lines.push({ text: `\`recruit ${token} <n>\` signs one. \`hire ${token} 1\` still takes whoever answers the job ad. New faces next week.` });
  return withLogLines(s, lines);
};

const recruitSign = (state: GameState, role: TeamRole, token: string, pick: string): ActionResult => {
  const gate = ensurePlayable(state);
  if (gate) return gate;
  const base = ensureSlices(state);
  const pool = storedPool(base, role);
  if (!pool) return err(state, `Look before you sign: \`recruit ${token}\` shows this week's ${CANDIDATES_PER_ROLE}.`);
  if (pool.length === 0) return err(state, "Nobody left this week. New faces after `end`.");
  const n = Number(pick);
  const chosen = /^\d+$/.test(pick) && Number.isInteger(n) && n >= 1 ? pool[n - 1] : undefined;
  if (!chosen) return err(state, `Pick 1-${pool.length}. \`recruit ${token}\` to see them again.`);
  const cost = getApCost(base, "recruit");
  if (!canSpendAp(base, cost)) return err(state, NO_AP);
  const signing = roleComp[role].hireCost;
  if (base.cash < signing) return err(state, `Not enough cash. Signing ${chosen.name} costs ${money(signing)}.`);
  if (!canAddEmployee(base)) return err(state, FULL_ROSTER);

  const added = addEmployee({ ...base, cash: base.cash - signing }, {
    name: chosen.name, role, pace: chosen.pace, craft: chosen.craft, quirk: chosen.quirk, salary: chosen.ask, energy: 100, engaged: true,
  });
  if (!added) return err(state, FULL_ROSTER);
  let s = added.state;
  s = setPeople(s, { candidates: { ...(s.people?.candidates ?? {}), [role]: pool.filter((c) => c.id !== chosen.id) } });
  s = spendAp(s, cost);

  const lines: Line[] = [{ text: `${chosen.name} signs. ${role}, pace ${chosen.pace} craft ${chosen.craft}.` }];
  if (!chosen.vetted) {
    const lied =
      chosen.claimedPace !== chosen.pace ? `pace ${chosen.claimedPace}. Reality: pace ${chosen.pace}`
        : chosen.claimedCraft !== chosen.craft ? `craft ${chosen.claimedCraft}. Reality: craft ${chosen.craft}`
          : null;
    lines.push({ text: lied ? `Résumé said ${lied}. The résumé was a vision document.` : "The résumé was accurate. Frame it.", kind: "event" });
    lines.push({ text: chosen.quirk ? `Quirk, as it turns out: ${chosen.quirk} — ${QUIRK_BLURB[chosen.quirk]}.` : "No quirk, as it turns out. A professional. Suspicious." });
  }
  lines.push({ text: `Cash -${money(signing)}. Payroll +${money(chosen.ask)}/wk.` });
  return withLogLines(s, lines, "success");
};

/** `recruit <role>` (look, free) · `recruit <role> <1-3>` (sign: 1 AP + the role's hire cost). */
export const recruitCommand = (state: GameState, rest: string[]): ActionResult => {
  const token = (rest[0] ?? "").toLowerCase();
  const role = roleAliases[token];
  if (!token) return err(state, RECRUIT_USAGE);
  if (!role) return err(state, `Unknown role "${rest[0]}". Try ${ROLE_TOKENS_HELP}.`);
  if (!canHireRole(role, state.stage)) return err(state, `${role} unlocks at ${ROLE_MIN_STAGE[role]} stage. Raise to advance.`);
  if (rest.length < 2) return recruitLook(state, role, token);
  return recruitSign(state, role, token, rest[1]);
};

// ── fire <args> (§4.5) ──

const FIRE_USAGE = "Usage: fire <name|id> | fire <role> <count>  (1 AP, two weeks' severance each)";

const cantAfford = (severance: number, cash: number): string =>
  `Severance is ${money(severance)}. You have ${money(cash)}. [[beat]] You cannot afford to let them go.`;

/** Board reaction to a layoff of 3+: activists and the old guard approve, cheerleaders do not. Only directors with those personalities move. */
const boardReaction = (state: GameState): { state: GameState; line: string | null } => {
  const directors = state.board.members.filter((m) => m.role !== "founder");
  const nodder = directors.find((m) => m.personality === "activist" || m.personality === "old-guard");
  const cheerleader = directors.some((m) => m.personality === "cheerleader");
  if (!nodder && !cheerleader) return { state, line: null };
  const move = (m: BoardMember): BoardMember =>
    m.role === "founder" ? m
      : m.personality === "cheerleader" ? { ...m, confidence: clamp(m.confidence - LAYOFF_BOARD_DELTA, 0, 100) }
        : m.personality === "activist" || m.personality === "old-guard" ? { ...m, confidence: clamp(m.confidence + LAYOFF_BOARD_DELTA, 0, 100) }
          : m;
  const who = nodder ? (nodder.personality === "activist" ? "activist" : "old guard") : null;
  const line = who && cheerleader
    ? `The ${who} on your board nods. The cheerleader does not.`
    : who ? `The ${who} on your board nods. Approvingly, which is worse.`
      : "The cheerleader on your board stops cheering.";
  return { state: { ...state, board: { ...state.board, members: state.board.members.map(move) } }, line };
};

const fireRole = (state: GameState, role: TeamRole, countToken: string | undefined): ActionResult => {
  if (countToken === undefined) return err(state, "How many? `fire <role> <count>`.");
  const n = Number(countToken);
  if (!/^\d+$/.test(countToken) || !Number.isInteger(n) || n < 1) return err(state, FIRE_USAGE);
  const base = ensureSlices(state);
  const bodies = wantOf(base.team[role]);
  if (bodies === 0) return err(state, `You have no ${role} people to let go.`);
  if (bodies < n) return err(state, `You only have ${bodies} ${plural(bodies, "person", "people")} in ${role}.`);
  const cost = getApCost(base, "fire");
  if (!canSpendAp(base, cost)) return err(state, NO_AP);

  // Unlisted whole heads go first, then people you never worked with (newest first), then the rest (weakest first, then newest).
  const named = rosterOf(base)
    .filter((e) => e.role === role)
    .sort((a, b) =>
      Number(a.engaged) - Number(b.engaged) ||
      (a.engaged ? (a.pace + a.craft) - (b.pace + b.craft) : 0) ||
      serialOf(b.id) - serialOf(a.id));
  const unlisted = Math.min(n, Math.max(0, bodies - named.length));
  const victims = named.slice(0, n - unlisted);
  const severance = severanceOf(unlisted * standardSalary(role) + victims.reduce((acc, e) => acc + e.salary, 0));
  if (base.cash < severance) return err(state, cantAfford(severance, base.cash));

  const withHr = hasHr(base);
  // One batch: the lead rule is read before anyone goes, so a build loses its quarter once even when its lead and the
  // person who would inherit the lead are both in the layoff (ERRATA 65).
  const gone = removeEmployees({ ...base, cash: base.cash - severance }, victims.map((e) => e.id));
  let s = gone.state;
  const lost = gone.lost.map((l) => l.build.name);
  if (unlisted > 0) s = removeHeads(s, role, unlisted);
  const hit = fireFallout(n, withHr);
  s = hurtCulture(s, hit);

  const shown = victims.slice(0, 3).map((e) => e.name);
  const names = victims.length === 0 ? ""
    : ` (${shown.join(", ")}${victims.length > 3 ? ` +${victims.length - 3} more` : ""}${unlisted ? ` and ${unlisted} you never met` : ""})`;
  const lines: Line[] = [
    { text: `Layoff: ${n} ${role} ${plural(n, "role", "roles")} 'impacted'${names}. The all-hands is 11 minutes long.`, kind: "event" },
    { text: `Severance -${money(severance)}. Morale -${hit.morale}. Cohesion -${hit.cohesion}.` },
  ];
  if (n >= LAYOFF_BOARD_MIN) {
    const reaction = boardReaction(s);
    s = reaction.state;
    if (reaction.line) lines.push({ text: reaction.line });
  }
  if (lost.length > 0) lines.push(lostLeadLine(lost));
  return withLogLines(spendAp(s, cost), lines, "warning");
};

const firePerson = (state: GameState, query: string): ActionResult => {
  const base = ensureSlices(state);
  const found = findEmployee(base, query);
  if (!found.ok) return err(state, withRoleHint(found.error, query, "`fire eng 2` lays off two"));
  const e = found.employee;
  const cost = getApCost(base, "fire");
  if (!canSpendAp(base, cost)) return err(state, NO_AP);
  const severance = severanceOf(e.salary);
  if (base.cash < severance) return err(state, cantAfford(severance, base.cash));
  const withHr = hasHr(base);
  const gone = removeEmployee({ ...base, cash: base.cash - severance }, e.id);
  const hit = fireFallout(1, withHr);
  const lines: Line[] = [
    { text: `You let ${e.name} go. [[beat]] ${withHr ? "HR ran it. It took nine minutes and a folder." : "You do it yourself, badly, in the only meeting room."}`, kind: "event" },
    { text: `Severance -${money(severance)}. Payroll -${money(e.salary)}/wk. Morale -${hit.morale}. Cohesion -${hit.cohesion}.` },
  ];
  if (gone.ledBuild) lines.push(lostLeadLine([gone.ledBuild.name]));
  return withLogLines(spendAp(hurtCulture(gone.state, hit), cost), lines, "warning");
};

/** `fire <name|id>` · `fire <role> <count>`. A first token that is a role alias always means the role form. */
export const fireCommand = (state: GameState, rest: string[]): ActionResult => {
  if (rest.length === 0) return err(state, FIRE_USAGE); // bare `fire` is answered by commands.ts; this is a safety net
  const gate = ensurePlayable(state);
  if (gate) return gate;
  const role = roleAliases[rest[0].toLowerCase()];
  if (role) return fireRole(state, role, rest[1]);
  return firePerson(state, rest.join(" "));
};

// ── retain (§4.4) ──

/** `retain <name|id>`: 1 AP + two weeks' pay; +10% for good; cancels an outside offer; twelve quiet weeks. */
export const retainCommand = (state: GameState, rest: string[]): ActionResult => {
  if (rest.length === 0 || !rest.join(" ").trim()) {
    return err(state, "Usage: retain <name|id>  (1 AP, a bonus of two weeks' pay and a permanent 10% raise; cancels an outside offer)");
  }
  const gate = ensurePlayable(state);
  if (gate) return gate;
  const base = ensureSlices(state);
  const found = findEmployee(base, rest.join(" "));
  if (!found.ok) return err(state, found.error);
  const e = found.employee;
  const cost = getApCost(base, "retain");
  if (!canSpendAp(base, cost)) return err(state, NO_AP);
  const bonus = retainBonus(e);
  if (base.cash < bonus) return err(state, `A retention bonus for ${firstName(e)} is ${money(bonus)}. You have ${money(base.cash)}.`);
  const salary = retainSalary(e);
  const hadOffer = e.offerDueWeek > 0;
  const s = patchEmployee({ ...base, cash: base.cash - bonus }, e.id, {
    salary,
    offerDueWeek: 0,
    offerKind: null,
    leadOnNotice: null,
    retainedWeek: base.week,
    engaged: true,
    energy: Math.max(e.energy, RETAIN_ENERGY_FLOOR),
  });
  const lines: Line[] = [
    { text: `You find the money. ${e.name} stays.`, kind: "event" },
    {
      text: `Bonus -${money(bonus)}. Pay ${money(e.salary)} → ${money(salary)}/wk.` +
        `${e.energy < RETAIN_ENERGY_FLOOR ? ` Energy → ${RETAIN_ENERGY_FLOOR} (they took the week they were owed).` : ""}`,
    },
    {
      text: hadOffer
        ? `The recruiter is told "bad timing". They will try again in ${OFFER_IMMUNITY_WEEKS} weeks.`
        : `No recruiter gets through for ${OFFER_IMMUNITY_WEEKS} weeks.`,
    },
  ];
  return withLogLines(spendAp(s, cost), lines, "success");
};
