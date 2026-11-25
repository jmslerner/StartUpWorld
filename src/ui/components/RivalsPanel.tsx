import type { PriceTier } from "../../engine/types";
import type { RivalCareerRow } from "../careerReport";
import { count, money, percent, signed } from "../format";
import { HINT, LABEL, TONE } from "../styles";
import type { ResourceView, RivalRow } from "../viewModel";
import type { Words } from "../words";

const TIER_NAME: Record<PriceTier, string> = { budget: "Budget", standard: "Standard", premium: "Premium" };

interface RaceRowProps {
  name: string;
  users: number;
  goal: number;
  you: boolean;
  out: boolean;
}

/** One lane of the race to the user count that lets a company go public. */
const RaceRow = ({ name, users, goal, you, out }: RaceRowProps) => (
  <div className="flex items-center gap-2 text-xs">
    <span className={`w-24 shrink-0 truncate ${you ? "font-semibold text-neon" : out ? "text-mist/40 line-through" : "text-mist"}`}>{you ? "You" : name}</span>
    <div className="h-2 flex-1 rounded-full bg-white/5">
      <div className={`h-full rounded-full ${you ? "bg-neon/80" : "bg-mist/50"}`} style={{ width: `${Math.min(100, (users / goal) * 100)}%` }} />
    </div>
    <span className={`w-12 shrink-0 text-right tabular-nums ${out ? "text-mist/40" : "text-gray-100"}`}>{out ? "out" : count(users)}</span>
  </div>
);

interface RivalsPanelProps {
  you: ResourceView;
  rivals: readonly RivalRow[];
  words: Words;
  /** Each rival's career, by seat; [] in a race. */
  careers: readonly RivalCareerRow[];
}

/** A rival's career in one line: founded, office, public or private, rescued. */
const careerLine = (row: RivalCareerRow): string =>
  [
    `Founded ${row.foundedYear}${row.newcomer ? " (new)" : ""}`,
    row.office,
    row.listedYear !== null ? `Public since ${row.listedYear}` : "Private",
    ...(row.rescueYear !== null ? [`Rescued in ${row.rescueYear}`] : []),
  ].join(" · ");

/** Everything the player may know about the three rivals: their public numbers, never their cash or plans. */
export const RivalsPanel = ({ you, rivals, words, careers }: RivalsPanelProps) => (
  <section aria-label="Rivals" className="panel-surface rounded-xl p-3">
    <h2 className={LABEL}>{words.career ? `This year's bar to go public: ${count(you.ipoUsers)} users` : `Race to ${count(you.ipoUsers)} users`}</h2>
    <div className="mt-2 space-y-1.5">
      <RaceRow name={you.companyName} users={you.users} goal={you.ipoUsers} you out={false} />
      {rivals.map((rival) => (
        <RaceRow key={rival.id} name={rival.name} users={rival.users} goal={you.ipoUsers} you={false} out={rival.out !== null} />
      ))}
    </div>
    <p className={`${HINT} mt-2`}>
      {words.career
        ? "A company that closes a year at the bar with a profit may go public. Going public ends nothing."
        : "The first to fill the bar and end that quarter in profit goes public and wins."}
    </p>

    <h2 className={`${LABEL} mt-4`}>Rivals</h2>
    <ul className="mt-2 space-y-3">
      {rivals.map((rival) => {
        const row = careers.find((candidate) => candidate.id === rival.id);
        return (
          <li key={rival.id} className={`rounded-lg bg-black/20 px-3 py-2 ${rival.out !== null ? "opacity-60" : ""}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold text-gray-100">{rival.name}</span>
              <span className="shrink-0 text-[0.7rem] text-mist/80">{rival.out !== null ? (rival.out.reason === "bankrupt" ? `bankrupt in ${words.when(rival.out.turn)}` : `founder fired in ${words.when(rival.out.turn)}`) : `${TIER_NAME[rival.price]} price`}</span>
            </div>
            <p className="text-[0.7rem] italic leading-snug text-mist/70">{rival.pitch}</p>
            {row !== undefined && (
              <p className={`${HINT} mt-0.5`}>
                {rival.out !== null
                  ? `Out in ${words.when(rival.out.turn)}.${row.newcomerYear !== null ? ` A new startup takes this seat in ${row.newcomerYear}.` : ""}`
                  : careerLine(row)}
              </p>
            )}
            {rival.out === null && (
              <>
                <dl className="mt-1.5 grid grid-cols-4 gap-x-2 text-xs">
                  <div>
                    <dt className="text-[0.6rem] uppercase tracking-[0.14em] text-mist/60">Users</dt>
                    <dd className="tabular-nums text-gray-100">{count(rival.users)}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.6rem] uppercase tracking-[0.14em] text-mist/60">Team</dt>
                    <dd className="tabular-nums text-gray-100">{rival.headcount}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.6rem] uppercase tracking-[0.14em] text-mist/60">Quality</dt>
                    <dd className="tabular-nums text-gray-100">{rival.launched ? Math.floor(rival.quality) : `${Math.floor(rival.quality)}, not live`}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.6rem] uppercase tracking-[0.14em] text-mist/60">Hype</dt>
                    <dd className="tabular-nums text-gray-100">{Math.floor(rival.hype)}</dd>
                  </div>
                </dl>
                <p className={`${HINT} mt-1.5`}>
                  {rival.usersChange !== null && (
                    <>
                      <span className={rival.usersChange > 0 ? TONE.good : rival.usersChange < 0 ? TONE.danger : undefined}>{signed(rival.usersChange, count)} users</span> last {words.period}.{" "}
                    </>
                  )}
                  Worth {money(rival.valuation)}; founders own {percent(rival.equity)}, board {rival.board.founderSeats}–{rival.board.investorSeats}
                  {rival.investorControlled ? " (investors in control)" : ""}.{rival.lastRaise !== null && ` Raised ${money(rival.lastRaise.amount)} in ${words.when(rival.lastRaise.turn)}.`}
                </p>
              </>
            )}
          </li>
        );
      })}
    </ul>
  </section>
);
