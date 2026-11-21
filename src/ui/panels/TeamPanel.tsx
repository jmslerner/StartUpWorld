import type { GameState, ReceptionTier, TeamRole } from "../../types/game";
import { PanelCard } from "../components/PanelCard";
import { Delta } from "../components/Gauge";
import { Tooltip } from "../components/Tooltip";
import { canHireRole } from "../../engine/stagePerks";
import { listRoster, rosterForWorld, type PersonFacts } from "../../engine/people";
import { listBuilds, productSummary, type BuildFacts } from "../../engine/projects";

interface TeamPanelProps {
  state: GameState;
}

const roles: { key: TeamRole; label: string }[] = [
  { key: "engineering", label: "Eng" },
  { key: "design", label: "Design" },
  { key: "marketing", label: "Mkt" },
  { key: "sales", label: "Sales" },
  { key: "ops", label: "Ops" },
  { key: "hr", label: "HR" },
  { key: "legal", label: "Legal" },
  { key: "data", label: "Data" },
  { key: "product", label: "PM" },
  { key: "executive", label: "Exec" },
];

const roleTips: Record<TeamRole, string> = {
  engineering: "Builds product faster. More output, more burn.",
  design: "Improves UX and feature quality. Higher conversion/retention potential, more burn.",
  marketing: "Drives demand and top-of-funnel. Can outpace delivery if over-hired.",
  sales: "Turns demand into revenue. Can increase burn and stress if product/ops can't keep up.",
  ops: "Reduces churn/drag and keeps the org running. Adds cost but prevents chaos.",
  hr: "Helps scale hiring and reduces people issues. Adds process overhead.",
  legal: "Reduces legal risk and contract friction. Adds cost.",
  data: "Reduces churn through analytics. Unlocks at seed stage.",
  product: "Boosts ship success as a product manager. Unlocks at series-a stage.",
  executive: "Reduces overhead and boosts pitch success. Unlocks at growth stage.",
};

/** Rows shown per role before "+N more": people holding an offer always sort to the top. */
const ROWS_PER_ROLE = 6;

const tierClass: Record<ReceptionTier, string> = {
  breakout: "text-amber-300",
  solid: "text-emerald-400",
  shrug: "text-mist/70",
  flop: "text-red-400",
};

const tierBar: Record<ReceptionTier, string> = {
  breakout: "bg-amber-300/80",
  solid: "bg-emerald-400/70",
  shrug: "bg-mist/50",
  flop: "bg-red-400/70",
};

const energyClass = (energy: number): string =>
  energy < 30 ? "text-red-400" : energy < 45 ? "text-orange-400" : energy < 60 ? "text-amber-300" : "text-slate-100/80";

const money = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

const roleToken = (role: TeamRole): string =>
  role === "engineering" ? "eng" : role === "design" ? "ux" : role === "executive" ? "exec" : role;

const personTip = (p: PersonFacts, builds: Map<string, BuildFacts>): string => {
  const build = p.buildId ? builds.get(p.buildId) : undefined;
  const parts = [
    `${p.name} · ${p.role} · ${p.id}`,
    `Pace ${p.pace}, craft ${p.craft} (works like ${p.effectiveness.toFixed(2)})`,
    `Energy ${p.energy} (${p.energyWord})`,
    `${money(p.salary)}/wk · going rate ${money(p.marketSalary)}`,
    p.quirk ? `${p.quirk}: ${p.quirkBlurb}` : null,
    build ? `On ${build.name}${p.isLead ? " (lead)" : ""}` : "Day job",
    p.shipped > 0 ? `Credited on ${p.shipped} release${p.shipped === 1 ? "" : "s"}` : null,
    p.offer
      ? `${p.offer.kind === "burnout" ? "Burnt out and interviewing" : "Holding an outside offer"}: leaves in ${p.offer.weeksLeft}w` +
        `${p.offer.buildAtRisk ? ` (${p.offer.buildAtRisk} loses a quarter)` : ""}. \`retain ${p.id}\``
      : null,
  ];
  return parts.filter(Boolean).join(" · ");
};

const BuildRow = ({ b }: { b: BuildFacts }) => {
  const f = b.forecast;
  const tier = f.shippable ? f.tierNow : f.tierFinished;
  const tip =
    `${b.name} · ${b.typeLabel} ${b.sizeLabel} · ${b.pct}% built (${b.progress.toFixed(1)} of ${b.scope} pts)` +
    `${b.surprises > 0 ? ` · ${b.surprises} surprise${b.surprises === 1 ? "" : "s"}` : ""} · quality ${b.quality}` +
    ` · ${f.shippable ? `ship now ≈ ${f.now} ±${f.spread} (${f.tierNow.toUpperCase()})` : "not shippable until 60%"}` +
    ` · finished ≈ ${f.eta === null ? "? (nobody on it)" : `${f.finished} (${f.tierFinished.toUpperCase()}) in ~${f.eta}w`}` +
    `${f.shippable && !b.built && f.rushCruft > 0 ? ` · shipping early adds ${f.rushCruft} cruft` : ""}`;
  return (
    <Tooltip content={tip} align="right" className="w-full">
      <div className="w-full">
        <div className="flex items-baseline gap-1.5">
          <span className="min-w-0 flex-1 truncate font-medium text-slate-100">{b.name}</span>
          {b.crunch ? <span className="shrink-0 rounded bg-red-400/15 px-1 text-[0.6rem] font-semibold text-red-300">CRUNCH</span> : null}
          <span className="shrink-0 text-mist/60">{b.typeLabel} {b.sizeLabel}</span>
          <span className="w-9 shrink-0 text-right tabular-nums">{b.pct}%</span>
        </div>
        <div className="mt-0.5 h-1.5 rounded bg-white/10">
          <div className={`h-full rounded ${tierBar[tier]}`} style={{ width: `${Math.min(100, b.pct)}%` }} />
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[0.65rem] text-mist/60">
          <span className={b.weeksLate > 0 ? "text-red-400" : undefined}>
            {b.built ? "built" : b.weeksLate > 0 ? `${b.weeksLate}w late` : `due wk ${b.dueWeek}`}
          </span>
          <span>{b.staffIds.length}/{b.seats} seats</span>
          <span>
            {f.shippable ? (
              <>now ≈ <span className={tierClass[f.tierNow]}>{f.now}</span></>
            ) : (
              <>done ≈ <span className={tierClass[f.tierFinished]}>{f.eta === null ? "?" : f.finished}</span></>
            )}
          </span>
        </div>
      </div>
    </Tooltip>
  );
};

const PersonRow = ({ p, tip }: { p: PersonFacts; tip: string }) => (
  <Tooltip content={tip} align="right" className="w-full">
    <div className="flex w-full items-center gap-1.5">
      <span className={`min-w-0 flex-1 truncate ${p.offer ? "text-red-300" : "text-slate-100/90"}`}>
        {p.name}
        {p.isLead ? <span className="ml-1 text-amber-300" aria-label="build lead">★</span> : null}
      </span>
      {p.offer ? (
        <span className="shrink-0 rounded bg-red-400/15 px-1 text-[0.6rem] font-semibold text-red-300">
          {p.offer.kind === "burnout" ? "BURNT" : "OFFER"} {p.offer.weeksLeft}w
        </span>
      ) : p.buildId ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neon/70" aria-label="on a build" />
      ) : null}
      <span className="w-7 shrink-0 text-right tabular-nums text-mist/80">{p.pace}·{p.craft}</span>
      <span className={`w-6 shrink-0 text-right tabular-nums ${energyClass(p.energy)}`}>{p.energy}</span>
    </div>
  </Tooltip>
);

export const TeamPanel = ({ state }: TeamPanelProps) => {
  const total = Object.values(state.team).reduce((a, b) => a + b, 0);
  const strain = total <= 4 ? "Low" : total <= 10 ? "Med" : "High";
  const strainClass = strain === "High" ? "text-red-400" : strain === "Med" ? "text-amber-300" : "text-emerald-400";

  // Read-only engine views; a slice-less (legacy) state gives empty lists and the classic head-count view.
  const roster = listRoster(state);
  const builds = listBuilds(state);
  const product = productSummary(state);
  const unlisted = roster.length > 0 ? rosterForWorld(state, 0).unlisted : {};
  const buildById = new Map(builds.map((b) => [b.id, b]));
  const offers = roster.filter((p) => p.offer).length;
  const showProduct = builds.length > 0 || product.shippedCount > 0 || product.cruft > 0;

  return (
    <PanelCard title="Team">
      {showProduct ? (
        <div className="space-y-2 border-b border-white/5 pb-2">
          <div className="flex items-baseline justify-between text-[0.65rem] text-mist/60">
            <span>
              Builds {product.slotsUsed}/{product.slots}
            </span>
            <span title="Cruft slows releases and leaks users; moat keeps them. `build` for the board.">
              Cruft {product.cruft} · Moat {product.moat}
            </span>
          </div>
          {builds.length > 0 ? (
            builds.map((b) => <BuildRow key={b.id} b={b} />)
          ) : (
            <p className="text-mist/50">Nothing in the works. The roadmap is a vibe. `build` to start one.</p>
          )}
          {product.shippedCount > 0 && product.recent[0] ? (
            <p className="text-[0.65rem] text-mist/60">
              Shipped {product.shippedCount} · last: {product.recent[0].name}{" "}
              <span className={tierClass[product.recent[0].tier]}>{product.recent[0].tier.toUpperCase()}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {roster.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between text-[0.65rem] text-mist/60">
            <span>
              People {roster.length}
              {offers > 0 ? <span className="text-red-300"> · {offers} {offers === 1 ? "offer" : "offers"}</span> : null}
            </span>
            <span className="shrink-0" title="Pace·craft (1-5 each), then energy (0-100). Hover a name for the file.">p·c nrg</span>
          </div>
          {roles.map(({ key, label }) => {
            const people = roster.filter((p) => p.role === key);
            const extra = unlisted[key] ?? 0;
            if (people.length === 0 && extra === 0) return null;
            const shown = people.slice(0, ROWS_PER_ROLE);
            const more = people.length - shown.length;
            return (
              <div key={key}>
                <Tooltip content={roleTips[key]} align="right">
                  <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-mist/50">
                    {label} {people.length + extra}
                  </span>
                </Tooltip>
                <div className="space-y-0.5">
                  {shown.map((p) => (
                    <PersonRow key={p.id} p={p} tip={personTip(p, buildById)} />
                  ))}
                </div>
                {more > 0 || extra > 0 ? (
                  <p className="text-[0.65rem] text-mist/50">
                    {more > 0 ? `+${more} more · \`team ${roleToken(key)}\`` : ""}
                    {more > 0 && extra > 0 ? " · " : ""}
                    {extra > 0 ? `+${extra} without a file` : ""}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-center">
          {roles
            .filter(({ key }) => canHireRole(key, state.stage) || state.team[key] > 0)
            .map(({ key, label }) => (
            <Tooltip key={key} content={roleTips[key]} align="right">
              <span className={state.team[key] > 0 ? "text-slate-100/90" : "text-mist/40"}>
                {label} {state.team[key]}
              </span>
            </Tooltip>
          ))}
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 border-t border-white/5 pt-2">
        <div className="text-center">
          <span className="text-mist/60" title="Total team size. Hiring increases burn and can strain cohesion.">Headcount</span>
          <div className="tabular-nums">
            {total}
            <Delta current={total} previous={state.lastWeek.teamSize} />
          </div>
        </div>
        <div className="text-center">
          <span className="text-mist/60" title="How hard it is for the founders to coordinate and manage the team.">Mgmt strain</span>
          <div className={`font-medium ${strainClass}`}>{strain}</div>
        </div>
      </div>
    </PanelCard>
  );
};
