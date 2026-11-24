import type { ReactNode } from "react";
import { count, money, percent, runwayText, signed } from "../format";
import { TONE } from "../styles";
import type { ResourceView } from "../viewModel";
import { Tooltip } from "./Tooltip";

interface StatProps {
  label: string;
  value: ReactNode;
  /** A second line; hidden on phones, where the bar has to stay short. */
  sub?: ReactNode;
  tone?: string;
  tip: ReactNode;
}

const Stat = ({ label, value, sub, tone = "text-gray-100", tip }: StatProps) => (
  <Tooltip content={tip} className="min-w-0">
    <div className="min-w-0" tabIndex={0}>
      <div className="truncate text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-mist/60 sm:text-[0.62rem]">{label}</div>
      <div className={`truncate text-sm font-semibold tabular-nums sm:text-base ${tone}`}>{value}</div>
      {sub !== undefined && <div className="hidden truncate text-[0.68rem] tabular-nums text-mist/70 sm:block">{sub}</div>}
    </div>
  </Tooltip>
);

const CONTROL_TEXT: Record<ResourceView["board"]["control"], string> = {
  founders: "you control it",
  tied: "tied with investors",
  investors: "investors control it",
};

interface ResourceBarProps {
  view: ResourceView;
  /** Runway under this many turns is what an investor-led board calls a bad quarter. */
  boardRunwayTurns: number;
}

/** The company's three resources and what follows from them, across the top of the game. */
export const ResourceBar = ({ view, boardRunwayTurns }: ResourceBarProps) => {
  const runwayTone = view.runway === null ? TONE.good : view.runway < boardRunwayTurns ? TONE.danger : view.runway < boardRunwayTurns + 1 ? TONE.caution : "text-gray-100";
  const change = view.usersChange;
  return (
    <section aria-label="Your company" className="panel-surface grid grid-cols-4 gap-x-3 gap-y-2 rounded-xl px-3 py-2.5 lg:grid-cols-8">
      <Stat
        label="Cash"
        value={money(view.cash)}
        sub={view.runway === null ? "profitable" : `runway ${runwayText(view.runway)}`}
        tone={runwayTone}
        tip={
          <>
            Cash in the bank. Runway is how many quarters it lasts at last quarter&apos;s burn: {runwayText(view.runway)}. End a quarter below $0 and you are bankrupt.
          </>
        }
      />
      <Stat
        label="Talent"
        value={view.headcount}
        sub={`work of ${view.effectiveWork.toFixed(1)}`}
        tip={
          <>
            {view.headcount === 1 ? "1 person" : `${view.headcount} people`} on the team. Bigger teams lose some output to coordination: this one does the work of {view.effectiveWork.toFixed(1)}.
          </>
        }
      />
      <Stat
        label="Users"
        value={count(view.users)}
        sub={change === null ? `${count(view.ipoUsers)} to go public` : <span className={change > 0 ? TONE.good : change < 0 ? TONE.danger : undefined}>{signed(change, count)} last quarter</span>}
        tip={
          <>
            Paying users. Reach {count(view.ipoUsers)} and finish that quarter in profit to go public and win.
            {change !== null && <> Change since the start of last quarter: {signed(change, count)}.</>}
          </>
        }
      />
      <Stat
        label="Quality"
        value={Math.floor(view.quality)}
        sub={view.launched ? "product is live" : `launches at ${view.launchAt}`}
        tone={view.launched ? "text-gray-100" : TONE.caution}
        tip={
          <>
            Product quality, 0 to 100. {view.launched ? "Your product is live." : `Your product launches at ${view.launchAt}; until then you win no users.`} Better quality wins more users and loses fewer.
          </>
        }
      />
      <Stat label="Hype" value={Math.floor(view.hype)} sub="fades each quarter" tip="Hype, 0 to 100. It multiplies how many users you win and your valuation, puts you ahead in the queue for candidates, and improves your odds when poaching. It fades every quarter." />
      <Stat
        label="Valuation"
        value={money(view.valuation)}
        sub={view.climate === null ? "normal funding" : `funding ×${view.climate.multiplier}, ${view.climate.turnsLeft} more`}
        tone={view.climate === null ? "text-gray-100" : view.climate.multiplier < 1 ? TONE.caution : TONE.good}
        tip={
          <>
            What investors say the company is worth: users and hype
            {view.climate === null ? "." : `, times ${view.climate.multiplier} while this funding climate lasts (${view.climate.turnsLeft} more ${view.climate.turnsLeft === 1 ? "quarter" : "quarters"}).`} It sets how much a raise brings in.
          </>
        }
      />
      <Stat
        label="Equity"
        value={percent(view.equity)}
        sub={`stake ${money(view.stake)}`}
        tip={
          <>
            The share of the company you still own. Your stake, {money(view.stake)}, is equity times valuation: if nobody goes public by the last quarter, the largest stake wins.
          </>
        }
      />
      <Stat
        label="Board"
        value={`${view.board.founderSeats}–${view.board.investorSeats}`}
        sub={CONTROL_TEXT[view.board.control]}
        tone={view.board.control === "investors" ? TONE.danger : view.board.control === "tied" ? TONE.caution : "text-gray-100"}
        tip={
          <>
            Board seats: {view.board.founderSeats} for founders, {view.board.investorSeats} for investors. Every raise adds an investor. Once investors hold more seats, they may fire you after a quarter in which users fell or runway dropped under {boardRunwayTurns} turns.
          </>
        }
      />
    </section>
  );
};
