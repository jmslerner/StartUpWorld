// The projects module's public face (TYCOON-SPEC §11.2): builds, releases, cruft and moat.
// Called by the shared engine through fixed hooks (commands.ts, tick.ts, actions.ts, hints.ts). Never imports people/.
import type { Hint } from "../hints";
import type { ChurnAdjuster, CommandHandler, HintSource, ProjectsWeekStep, ShipRouter, StatusLine } from "../tycoon/contracts";
import { err } from "../tycoon/kit";
import { buildsOf, staffOf } from "../tycoon/roster";
import { LATE_PENALTY, SIZES } from "./constants";
import { availableFor, buildBoard, cancelBuild, crunchBuild, seatsFree, shipRoute as route, staffCommand, startBuild } from "./commands";
import { adjustChurn as churnAdjust, runProjectsWeek as weekStep } from "./weekly";
import { isBuilt, pct } from "./work";

export { forecastOf, listBuilds, describeBuild, productSummary, startOptions } from "./view";
export type { BuildFacts, Forecast, ProductFacts, StartOption } from "./view";

/** Top-level command names this module answers (`project` / `projects` are aliases of `build`). */
export const PROJECT_COMMANDS = ["build", "project", "projects", "staff"] as const;

/**
 * Dispatches build | project | projects | staff (§4.6, §4.7). The board (bare, `list`) is read-only and works during a pending
 * event and after game over; every other form calls `ensurePlayable` itself.
 */
export const projectsCommand: CommandHandler = (state, command, rest) => {
  if (command === "staff") return staffCommand(state, rest);
  const sub = (rest[0] ?? "").toLowerCase();
  if (!sub || sub === "list") return buildBoard(state);
  if (sub === "crunch") return crunchBuild(state, rest.slice(1));
  if (sub === "cancel") return cancelBuild(state, rest.slice(1));
  if (sub === "start" || sub === "new") return startBuild(state, rest.slice(1));
  if (sub === "ship") return err(state, "Releases go through `ship <build>`.");
  return startBuild(state, rest);
};

/** `ship <name>` (§4.8): release a build, refuse a near-miss, or fall through to today's patch. */
export const shipRoute: ShipRouter = route;

/** Tick step N1: the work week, then moat decay. Lines are rendered from the finished tick. */
export const runProjectsWeek: ProjectsWeekStep = weekStep;

/** Cruft and moat on weekly churn; returns `churn` itself when both are 0 or there is no product slice. */
export const adjustChurn: ChurnAdjuster = churnAdjust;

/** `Product: building Phoenix 46% | Shipped 4 | Cruft 8.7/100 | Moat 9.8/100`, or null until anything was ever built. */
export const projectsStatusLine: StatusLine = (state) => {
  const product = state.product;
  if (!product || (product.active.length === 0 && product.shippedCount === 0 && product.cruft === 0 && product.moat === 0)) return null;
  const building = product.active.length > 0 ? `building ${product.active.map((b) => `${b.name} ${pct(b)}%`).join(", ")}` : "nothing in the works";
  return `Product: ${building} | Shipped ${product.shippedCount} | Cruft ${product.cruft}/100 | Moat ${product.moat}/100`;
};

/** Build hints (§7.1, ERRATA 70): priorities 4 (built) / 7 (late) / 6 / 5 / 5. Empty without an active build and with cruft under 40. */
export const projectHints: HintSource = (state) => {
  const product = state.product;
  if (!product) return [];
  const hints: Hint[] = [];
  for (const b of buildsOf(state)) {
    if (isBuilt(b)) {
      // Priority 4 (ERRATA 70): the weekly build line already says it, so this tip only shows when nothing more urgent does.
      hints.push({ text: `Tip: ${b.name} is built. \`ship ${b.slug}\` — or keep polishing until week ${b.dueWeek}.`, priority: 4 });
    } else if (state.week > b.dueWeek) {
      hints.push({ text: `Tip: ${b.name} is past its date (-${LATE_PENALTY} reception a week). Crunch it, ship it early, or cancel it.`, priority: 7 });
    } else if (seatsFree(state, b) > 0 && availableFor(state, b.type).length > 0) {
      hints.push({
        text: `Tip: ${b.name} has ${seatsFree(state, b)} empty seat(s) of ${SIZES[b.size].seats} and people who could fill them. \`staff ${b.slug} auto\`.`,
        priority: 5,
      });
    } else if (staffOf(state, b.id).length === 0) {
      hints.push({ text: `Tip: nobody is on ${b.name}. It is currently a slide. \`staff ${b.slug} <name>\`.`, priority: 5 });
    }
  }
  if (product.cruft >= 40) {
    hints.push({ text: `Warning: Cruft is ${product.cruft}/100. Users leak and releases land softer. \`build plumbing\` pays it down properly.`, priority: 6 });
  }
  return hints;
};
