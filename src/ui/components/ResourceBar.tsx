import type { ReactNode } from "react";
import { count, money, percent, signed } from "../format";
import { TONE } from "../styles";
import type { ResourceView } from "../viewModel";
import type { Words } from "../words";
import { Tooltip } from "./Tooltip";

interface StatProps {
  label: string;
  value: ReactNode;
  /** A second line under the figure. */
  sub: ReactNode;
  /** The same in a dozen characters, for a phone's narrow columns. */
  subShort: ReactNode;
  tone?: string;
  tip: ReactNode;
}

const Stat = ({ label, value, sub, subShort, tone = "text-gray-100", tip }: StatProps) => (
  <Tooltip content={tip} className="min-w-0">
    <div className="min-w-0" tabIndex={0}>
      <div className="truncate text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-mist/60 sm:text-[0.62rem]">{label}</div>
      <div className={`truncate text-sm font-semibold tabular-nums sm:text-base ${tone}`}>{value}</div>
      <div className="truncate text-[0.62rem] tabular-nums text-mist/70 sm:hidden">{subShort}</div>
      <div className="hidden truncate text-[0.68rem] tabular-nums text-mist/70 sm:block">{sub}</div>
    </div>
  </Tooltip>
);

const CONTROL_TEXT: Record<ResourceView["board"]["control"], string> = {
  founders: "you control it",
  tied: "tied",
  investors: "investor-led",
};

const CONTROL_SHORT: Record<ResourceView["board"]["control"], string> = {
  founders: "yours",
  tied: "tied",
  investors: "investor-led",
};

interface ResourceBarProps {
  view: ResourceView;
  /** Runway under this many turns is what an investor-led board calls a bad quarter or year. */
  boardRunwayTurns: number;
  words: Words;
  /** A career's one rescue is spent: the next year below $0 ends it. Always false in a race. */
  rescueUsed: boolean;
}

/** The company's three resources and what follows from them, across the top of the game. */
export const ResourceBar = ({ view, boardRunwayTurns, words, rescueUsed }: ResourceBarProps) => {
  const runwayTone = view.runway === null ? TONE.good : view.runway < boardRunwayTurns ? TONE.danger : view.runway < boardRunwayTurns + 1 ? TONE.caution : "text-gray-100";
  const change = view.usersChange;
  const changeTone = change === null ? undefined : change > 0 ? TONE.good : change < 0 ? TONE.danger : undefined;
  const { climate } = view;
  const { career, period } = words;
  /** The last year, by name: only a career reads it. */
  const lastYear = words.when(view.maxTurns);
  const belowZero = !career
    ? "End a quarter below $0 and you are bankrupt."
    : rescueUsed
      ? "End a year below $0 and your career ends."
      : "End a year below $0 and the company is rescued once; a second time ends your career.";
  return (
    <section aria-label="Your company" className="panel-surface grid grid-cols-4 gap-x-3 gap-y-2 rounded-xl px-3 py-2.5 lg:grid-cols-8">
      <Stat
        label="Cash"
        value={money(view.cash)}
        sub={view.runway === null ? "profitable" : `runway ${words.runway(view.runway)}`}
        subShort={words.runway(view.runway)}
        tone={runwayTone}
        tip={
          <>
            Cash in the bank. Runway is how many {words.periods} it lasts at last {period}&apos;s burn: {words.runway(view.runway)}. {belowZero}
          </>
        }
      />
      <Stat
        label="Talent"
        value={view.headcount}
        sub={`work of ${view.effectiveWork.toFixed(1)}`}
        subShort={`work ${view.effectiveWork.toFixed(1)}`}
        tip={
          <>
            {view.headcount === 1 ? "1 person" : `${view.headcount} people`} on the team. Bigger teams lose some output to coordination: this one does the work of {view.effectiveWork.toFixed(1)}.
          </>
        }
      />
      <Stat
        label="Users"
        value={count(view.users)}
        sub={change === null ? `${count(view.ipoUsers)} to go public` : <span className={changeTone}>
              {signed(change, count)} last {period}
            </span>}
        subShort={change === null ? `of ${count(view.ipoUsers)}` : <span className={changeTone}>{signed(change, count)}</span>}
        tip={
          <>
            {career ? (
              <>Paying users. Close a year with {count(view.ipoUsers)} users and a profit, and you may go public.</>
            ) : (
              <>Paying users. Reach {count(view.ipoUsers)} and finish that quarter in profit to go public and win.</>
            )}
            {change !== null && (
              <>
                {" "}
                Over last {period}, as its report showed: {signed(change, count)}.
              </>
            )}
          </>
        }
      />
      <Stat
        label="Quality"
        value={Math.floor(view.quality)}
        sub={view.launched ? "product is live" : `launches at ${view.launchAt}`}
        subShort={view.launched ? "live" : `launch at ${view.launchAt}`}
        tone={view.launched ? "text-gray-100" : TONE.caution}
        tip={
          <>
            Product quality, 0 to 100. {view.launched ? "Your product is live." : `Your product launches at ${view.launchAt}; until then you win no users.`} Better quality wins more users and loses fewer.
          </>
        }
      />
      <Stat
        label="Hype"
        value={Math.floor(view.hype)}
        sub={`fades each ${period}`}
        subShort="fades"
        tip={`Hype, 0 to 100. It multiplies how many users you win and your valuation, puts you ahead in the queue for candidates, and improves your odds when poaching. It fades every ${period}.`}
      />
      <Stat
        label="Valuation"
        value={money(view.valuation)}
        sub={climate === null ? "normal funding" : `×${climate.multiplier}, ${words.left(climate.turnsLeft)}`}
        subShort={climate === null ? "normal" : `×${climate.multiplier}, ${words.short(climate.turnsLeft)}`}
        tone={climate === null ? "text-gray-100" : climate.multiplier < 1 ? TONE.caution : TONE.good}
        tip={
          <>
            What investors say the company is worth: users and hype
            {climate === null ? "." : `, times ${climate.multiplier} while this funding climate lasts: ${words.left(climate.turnsLeft)}.`} It sets how much a raise brings in.
          </>
        }
      />
      <Stat
        label="Equity"
        value={percent(view.equity)}
        sub={`stake ${money(view.stake)}`}
        subShort={money(view.stake)}
        tip={
          <>
            {career ? (
              <>
                The share of the company you still own. Your stake, {money(view.stake)}, is equity times valuation. After {lastYear}, the largest founder&apos;s stake wins.
              </>
            ) : (
              <>
                The share of the company you still own. Your stake, {money(view.stake)}, is equity times valuation: if nobody goes public by the last quarter, the largest stake wins.
              </>
            )}
          </>
        }
      />
      <Stat
        label="Board"
        value={`${view.board.founderSeats}–${view.board.investorSeats}`}
        sub={CONTROL_TEXT[view.board.control]}
        subShort={CONTROL_SHORT[view.board.control]}
        tone={view.board.control === "investors" ? TONE.danger : view.board.control === "tied" ? TONE.caution : "text-gray-100"}
        tip={
          <>
            Board seats: {view.board.founderSeats} for founders, {view.board.investorSeats} for investors. Every raise adds an investor. Once investors hold more seats, they may fire you after a {period} in which users fell or runway dropped under {words.units(boardRunwayTurns)}.
          </>
        }
      />
    </section>
  );
};
