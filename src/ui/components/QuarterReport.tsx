import { useId, useRef, type ReactNode } from "react";
import { count, money, percent, quarter, runwayText, signed } from "../format";
import { LABEL, PRIMARY, TONE } from "../styles";
import { useDialog } from "../useDialog";
import type { ReportView } from "../viewModel";

interface LineProps {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  strong?: boolean;
  tone?: string;
}

/** One line of the ledger: a label, a dotted leader, a figure. */
const Line = ({ label, value, note, strong, tone = "text-gray-100" }: LineProps) => (
  <div>
    <div className={`flex items-baseline gap-2 ${strong ? "font-semibold" : ""}`}>
      <span className="shrink-0 text-mist">{label}</span>
      <span aria-hidden className="min-w-4 flex-1 translate-y-[-0.2em] border-b border-dotted border-white/15" />
      <span className={`shrink-0 text-right tabular-nums ${tone}`}>{value}</span>
    </div>
    {note !== undefined && <div className="text-right text-[0.68rem] leading-snug text-mist/60">{note}</div>}
  </div>
);

const Heading = ({ children }: { children: ReactNode }) => <h3 className={`${LABEL} mb-1.5 mt-4`}>{children}</h3>;

const people = (n: number): string => (n === 1 ? "1 person" : `${n} people`);

interface QuarterReportProps {
  companyName: string;
  view: ReportView;
  /** The player's game ended this quarter. */
  over: boolean;
  onClose: () => void;
}

/** The quarter's results as a ledger printout, shown over the game after every turn. */
export const QuarterReport = ({ companyName, view, over, onClose }: QuarterReportProps) => {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const close = useDialog(onClose, closeRef);

  const { books, users, people: team, product, hype } = view;
  const net = books.revenue - books.costs.total;
  const hypeParts = [
    hype.launch !== 0 && `launch ${signed(hype.launch, String)}`,
    hype.raise !== 0 && `raise ${signed(hype.raise, String)}`,
    hype.growth !== 0 && `growth ${signed(hype.growth, String)}`,
    hype.layoffs !== 0 && `layoffs ${signed(hype.layoffs, String)}`,
  ].filter((part): part is string => part !== false);
  const teamParts = [
    team.lostToEvent > 0 && `${team.lostToEvent} lost to the event`,
    team.laidOff > 0 && `${team.laidOff} laid off`,
    team.poachedOut > 0 && `${team.poachedOut} poached away`,
    team.poachedIn > 0 && `${team.poachedIn} poached in`,
    team.hiresWanted > 0 && `hired ${team.hired} of ${team.hiresWanted} wanted`,
  ].filter((part): part is string => part !== false);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-ink/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="mx-auto flex min-h-full w-full max-w-xl items-start px-3 py-4 sm:items-center sm:py-8">
        <article className="panel-surface terminal-scanlines w-full rounded-xl px-4 py-4 text-xs sm:px-6 sm:py-5">
          <header className="flex items-baseline justify-between gap-3 border-b border-white/10 pb-2">
            <h2 id={titleId} className="text-sm font-semibold text-gray-100">
              {companyName}: {quarter(view.turn)} report
            </h2>
            <span className={`${LABEL} shrink-0`}>Quarterly</span>
          </header>

          {view.event !== null && (
            <p className="mt-3 text-amber-300/90">
              <span className="font-semibold">{view.event.name}.</span> {view.event.text}
              {view.event.target !== null && (view.event.targetIsYou ? " It hit you." : ` It hit ${view.event.target}.`)}
            </p>
          )}

          <Heading>Money</Heading>
          <div className="space-y-1">
            <Line label="Revenue" value={money(books.revenue)} tone={TONE.good} />
            <Line label="Salaries" value={money(-books.costs.salaries)} />
            {books.costs.marketing > 0 && <Line label="Marketing" value={money(-books.costs.marketing)} />}
            {books.costs.hiring > 0 && <Line label="Hiring fees" value={money(-books.costs.hiring)} />}
            {books.costs.poaching > 0 && <Line label="Poaching" value={money(-books.costs.poaching)} />}
            {books.costs.severance > 0 && <Line label="Severance" value={money(-books.costs.severance)} />}
            <Line label={net >= 0 ? "Profit" : "Loss"} value={money(net)} strong tone={net >= 0 ? TONE.good : TONE.caution} />
            {books.raise !== null && <Line label={`Raise: sold ${books.raise.percent}%`} value={signed(books.raise.amount, money)} tone={TONE.good} note={`at a ${money(books.raise.valuation)} valuation`} />}
            <Line
              label="Cash"
              value={
                <>
                  {money(books.cashStart)} → {money(books.cashEnd)}
                </>
              }
              strong
              tone={books.cashEnd < 0 ? TONE.danger : "text-gray-100"}
              note={books.runway === null ? "a profitable quarter" : `runway ${runwayText(books.runway)} at this burn`}
            />
          </div>

          <Heading>Users</Heading>
          <div className="space-y-1">
            <Line label="At the start" value={count(users.open)} />
            {users.lostToEvent > 0 && <Line label="Lost to the event" value={signed(-users.lostToEvent, count)} tone={TONE.danger} />}
            <Line label="Left" value={signed(-users.churned, count)} />
            <Line label="Won" value={signed(users.won, count)} tone={users.won > 0 ? TONE.good : "text-gray-100"} note={view.market.pool > 0 ? `${percent(users.share)} of the ${count(view.market.pool)} looking for a product` : undefined} />
            <Line label="At the end" value={count(users.end)} strong />
          </div>

          <Heading>Team and product</Heading>
          <div className="space-y-1">
            <Line
              label="Team"
              value={
                <>
                  {team.start} → {team.end}
                </>
              }
              note={teamParts.length > 0 ? teamParts.join(", ") : undefined}
            />
            <Line
              label="Quality"
              value={
                <>
                  {Math.floor(product.start)} → {Math.floor(product.end)}
                </>
              }
              note={product.launchedNow ? "your product launched" : product.catchUp ? "catch-up bonus applied" : undefined}
            />
            <Line
              label="Hype"
              value={
                <>
                  {Math.floor(hype.start)} → {Math.floor(hype.end)}
                </>
              }
              note={hypeParts.length > 0 ? hypeParts.join(", ") : undefined}
            />
            <Line label="Valuation" value={money(view.valuation)} note={`you own ${percent(view.equity)}`} />
          </div>

          {(view.poach !== null || view.board !== null || view.notes.length > 0) && (
            <ul className="mt-3 space-y-1 text-mist">
              {view.poach !== null && (
                <li className={view.poach.success ? TONE.good : undefined}>
                  You tried to poach from {view.poach.target} ({percent(view.poach.chance)} odds): {view.poach.success ? "one of their people joins you next quarter." : "it did not work."}
                </li>
              )}
              {view.board !== null && (view.board.usersFell || view.board.lowRunway) && !view.board.fired && (
                <li className={TONE.caution}>Your investors called this a bad quarter ({view.board.usersFell ? "users fell" : "runway is short"}). They voted, and kept you on.</li>
              )}
              {view.board?.fired && <li className={TONE.danger}>Your investors called this a bad quarter ({view.board.usersFell ? "users fell" : "runway is short"}), voted, and fired you.</li>}
              {view.notes.map((note) => (
                <li key={note}>Plan adjusted. {note}</li>
              ))}
            </ul>
          )}

          <Heading>Rivals</Heading>
          {view.moves.length === 0 ? (
            <p className="text-mist/70">A quiet quarter: no launches, raises, hires or layoffs.</p>
          ) : (
            <ul className="space-y-0.5 text-mist">
              {view.moves.map((move) => (
                <li key={move}>{move}</li>
              ))}
            </ul>
          )}
          {view.released !== null && (view.released.users > 0 || view.released.people > 0) && (
            <p className="mt-1 text-mist/70">
              {view.released.users > 0 && `${count(view.released.users)} users are looking for a new product next quarter. `}
              {view.released.people > 0 && `${people(view.released.people)} from there join next quarter's candidates.`}
            </p>
          )}

          {view.nextEvent !== null && !over && (
            <p className="mt-4 border-t border-white/10 pt-3 text-amber-300/90">
              <span className="font-semibold">Coming in {quarter(view.turn + 1)}: {view.nextEvent.name}.</span> {view.nextEvent.text}
              {view.nextEvent.target !== null && (view.nextEvent.targetIsYou ? " It hits you." : ` It hits ${view.nextEvent.target}.`)}
            </p>
          )}

          <button ref={closeRef} type="button" onClick={close} className={`${PRIMARY} mt-4 w-full`}>
            {over ? "See how it ended" : `Plan ${quarter(view.turn + 1)}`}
          </button>
        </article>
      </div>
    </div>
  );
};
