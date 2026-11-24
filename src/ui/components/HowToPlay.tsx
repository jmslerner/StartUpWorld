import { useId, useRef } from "react";
import type { RulesConfig } from "../../engine/types";
import { count, money, percent } from "../format";
import { PRIMARY } from "../styles";
import { useDialog } from "../useDialog";

interface HowToPlayProps {
  /** Every number in the text comes from the config, so it stays true after tuning. */
  config: RulesConfig;
}

/** The rules in a dozen lines. */
export const HowToPlay = ({ config }: HowToPlayProps) => {
  const prices = config.priceTiers;
  const sizes = config.raise.options;
  const raiseSizes = sizes.length > 1 ? `${sizes.slice(0, -1).join(", ")} or ${sizes[sizes.length - 1]}` : String(sizes[0]);
  return (
    <dl className="space-y-2.5 text-xs leading-relaxed text-mist">
      <div>
        <dt className="font-semibold text-gray-100">The goal</dt>
        <dd>
          Be the first to go public: reach {count(config.ipo.users)} users and end that quarter in profit. If nobody has by the end of quarter {config.game.maxTurns}, the founder whose stake (equity × valuation) is worth the most wins.
        </dd>
      </div>
      <div>
        <dt className="font-semibold text-gray-100">A turn is a quarter</dt>
        <dd>You and three rival startups plan at the same time. Split your people between three jobs, set a marketing budget and a price, then end the quarter and read the report.</dd>
      </div>
      <div>
        <dt className="font-semibold text-gray-100">Product, Growth, Recruiting</dt>
        <dd>
          Product raises quality; at {config.quality.launchAt} you launch and start winning users, and higher quality keeps them. Growth adds pull: each quarter&apos;s new users are shared out by pull, which is quality lifted by growth work, marketing, a lower price and hype. Recruiting hires people, who start next quarter. Bigger teams lose a little to
          coordination.
        </dd>
      </div>
      <div>
        <dt className="font-semibold text-gray-100">Cash</dt>
        <dd>
          Each person costs {money(config.salary)} a quarter. Users pay ${prices.budget.price}, ${prices.standard.price} or ${prices.premium.price} each, depending on your price: cheaper wins more users, dearer loses more. End a quarter below $0 and you are bankrupt.
        </dd>
      </div>
      <div>
        <dt className="font-semibold text-gray-100">Raising money</dt>
        <dd>
          With {count(config.raise.minUsers)} users you can sell {raiseSizes}% of the company for cash. Each raise puts an investor on your board. Once investors outnumber founders, a quarter in which users fall or runway drops under{" "}
          {config.board.runwayTurns} turns carries a {percent(config.board.fireChance)} chance they fire you.
        </dd>
      </div>
      <div>
        <dt className="font-semibold text-gray-100">Hype, poaching, layoffs</dt>
        <dd>
          Hype lifts the users you win and your valuation, and fades {percent(config.hype.decay)} a quarter; launching, raising and fast growth add to it. For {money(config.poach.cost)} you can try to poach a person from a rival. Layoffs cost {money(config.layoff.severance)} each and{" "}
          {Math.abs(config.layoff.hype)} hype.
        </dd>
      </div>
      <div>
        <dt className="font-semibold text-gray-100">Events</dt>
        <dd>From quarter {config.events.firstTurn} on, a quarter may open with an event: a funding winter, a viral moment, a security breach. You see it before you plan.</dd>
      </div>
    </dl>
  );
};

interface HowToPlayDialogProps extends HowToPlayProps {
  onClose: () => void;
}

/** The same rules, over the game. */
export const HowToPlayDialog = ({ config, onClose }: HowToPlayDialogProps) => {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useDialog(onClose, closeRef);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-ink/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="mx-auto flex min-h-full w-full max-w-xl items-start px-3 py-4 sm:items-center sm:py-8">
        <div className="panel-surface w-full rounded-xl px-4 py-4 sm:px-6 sm:py-5">
          <h2 id={titleId} className="mb-3 text-sm font-semibold text-gray-100">
            How to play
          </h2>
          <HowToPlay config={config} />
          <button ref={closeRef} type="button" onClick={onClose} className={`${PRIMARY} mt-4 w-full`}>
            Back to the game
          </button>
        </div>
      </div>
    </div>
  );
};
