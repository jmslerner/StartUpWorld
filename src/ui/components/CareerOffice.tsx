import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Plan } from "../../engine/types";
import type { WorldViewState } from "../../world/mountWorld";
import type { InteractableTarget } from "../../world/types/interaction";
import type { WorldHandle } from "../../world/types/handle";
import type { MarketScene, WorldViewKind } from "../../world/types/market";
import type { Team } from "../../world/types/scene";
import { drawnTeams } from "../../world/cast";
import WorldView from "../../world/WorldView";
import { WorldBoundary, WorldUnavailableNote } from "../../world/ui/WorldShell";
import { careerWorldSound } from "../careerSound";
import { LABEL_WORDS, placeMarketLabels, type LabelRect, type PlacedLabel } from "../marketLabels";
import { marketCard, MARKET_WORDS } from "../marketView";
import { asDrawn, CARRY_WORDS, carryLine, carryStep, highlightFor, TEAM_NAMES, unseenLine, type Carry, type Picked } from "../officeMoves";
import type { OfficeSource } from "../officeSource";
import { OFFICE_WORDS } from "../officeView";
import { BUTTON, BUTTON_ON } from "../styles";
import type { RivalRow } from "../viewModel";

export interface CareerOfficeProps {
  /** The career's office, from the store. The same object for the life of the screen. */
  readonly source: OfficeSource;
  /** The plan being drafted. */
  readonly draft: Plan;
  /** One person set down in another team, as the one change to the plan. */
  readonly onMove: (patch: Pick<Plan, "allocation">) => void;
  /** How the view stands, whenever that changes. */
  readonly onView: (state: WorldViewState) => void;
  /** The view could not be shown: the screen goes back to its 2D panels. */
  readonly onFailed: () => void;
  /** The market as the world draws it; null before any year was played. */
  readonly market: MarketScene | null;
  /** The view on screen. */
  readonly view: WorldViewKind;
  /** The company selected in the market, by seat. */
  readonly selectedSeat: number | null;
  /** A year plays out: the switch is disabled. */
  readonly playing: boolean;
  /** The rivals' public rows, for the card over a selected company. */
  readonly rivals: readonly RivalRow[];
  readonly onSelectCompany: (seat: number | null) => void;
  readonly onChooseView: (view: WorldViewKind) => void;
}

type Select = (target: InteractableTarget | null) => void;

const TEAMS: readonly Team[] = ["product", "growth", "recruiting"];
const VIEWS: readonly WorldViewKind[] = ["office", "market"];
/** How long the note of a move nobody walks for stays, in ms. */
const UNSEEN_MS = 4000;

/**
 * The career's office in 3D. The one place under src/ui that brings in the world by value, so it is only ever
 * loaded lazily (through OfficeSlot), and three.js with it. It fills the cell the screen gives it.
 *
 * A person is moved by pointing: a tap picks them up (highlighted), a tap on someone of another team, or one of the
 * strip's team buttons, sets them down there as one change to the plan. Every tap in the office goes through
 * `carryStep`. In the market a tap on a company selects it and shows its card; a tap on nothing clears both.
 */
const CareerOffice = ({ source, draft, onMove, onView, onFailed, market, view, selectedSeat, playing, rivals, onSelectCompany, onChooseView }: CareerOfficeProps) => {
  const [carry, setCarry] = useState<Carry>(null);
  /** A move that changed the plan but not the people drawn, said in the strip's place for a moment. */
  const [unseen, setUnseen] = useState<string | null>(null);
  const [handle, setHandle] = useState<WorldHandle | null>(null);
  /** The world draws: neither starting, nor lost, nor unsupported. */
  const [running, setRunning] = useState(false);
  /** The labels over the market's buildings and its bar, where they stand on the canvas. */
  const [labels, setLabels] = useState<readonly PlacedLabel[]>([]);
  const cellRef = useRef<HTMLDivElement>(null);
  const switchRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  // Without a market there is nothing to show but the office.
  const shown: WorldViewKind = market === null ? "office" : view;
  const shownRef = useRef(shown);
  const carryRef = useRef<Carry>(null);
  const draftRef = useRef(draft);
  const handleRef = useRef<WorldHandle | null>(null);
  const selectRef = useRef<Select | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  const setCarried = useCallback((next: Carry) => {
    carryRef.current = next;
    setCarry(next);
    selectRef.current?.(highlightFor(next));
  }, []);

  /** Put back whatever is carried. */
  const drop = useCallback(() => {
    if (carryRef.current !== null) setCarried(null);
  }, [setCarried]);

  /** One person from the carried team into another, then nothing carried. */
  const moveCarried = useCallback(
    (personId: string, move: Pick<Plan, "allocation">) => {
      const handle = handleRef.current;
      const shown = source.get();
      // Worked out now: the store updates the scene later. The allocation is people per team, the scene's teams.
      const hidden = handle?.hiddenCount() ?? 0;
      const same = drawnTeams(shown);
      const after = drawnTeams({ ...shown, teams: move.allocation });
      const nobodyWalks = hidden > 0 && same.product === after.product && same.growth === after.growth && same.recruiting === after.recruiting;
      handle?.releaseFirst(personId);
      onMove(move);
      // The plan did not change the office: the hint must not wait for a later scene.
      if (source.get() === shown) handle?.releaseFirst(null);
      setCarried(null);
      if (nobodyWalks) {
        const total = shown.teams.product + shown.teams.growth + shown.teams.recruiting + shown.away + shown.leaving;
        setUnseen(unseenLine(total - hidden, total));
      }
    },
    [source, onMove, setCarried],
  );

  /** One step of carrying: a tap, or a team button (a team with nobody named). */
  const step = useCallback(
    (picked: Picked | null) => {
      if (source.playing) {
        drop();
        return;
      }
      const carried = carryRef.current;
      // The office draws the plan refitted to everyone: a move is one of the people drawn.
      const next = carryStep(carried, picked, asDrawn(draftRef.current, source.get().teams));
      if (next.move !== null && carried !== null) moveCarried(carried.personId, next.move);
      else setCarried(next.carry);
    },
    [source, drop, moveCarried, setCarried],
  );

  const onTap = useCallback(
    (target: InteractableTarget | null, select: Select) => {
      selectRef.current = select;
      if (shownRef.current === "market") {
        // Taps in the market select a company; they never carry anyone.
        if (target?.kind === "company") onSelectCompany(target.seat);
        else {
          select(null);
          onSelectCompany(null);
        }
        return;
      }
      if (target?.kind === "company") return;
      const handle = handleRef.current;
      step(
        target === null
          ? null
          : { team: handle?.teamOf(target) ?? null, personId: target.kind === "person" ? target.personId : null },
      );
    },
    [step, onSelectCompany],
  );

  const viewState = useCallback(
    (state: WorldViewState) => {
      // Another world (or none): what was carried there is put back.
      if (state.handle !== handleRef.current) {
        drop();
        handleRef.current = state.handle;
        setHandle(state.handle);
      }
      setRunning(state.status === "running");
      onView(state);
    },
    [onView, drop],
  );

  // The world draws the market it is given, and the view on screen.
  useEffect(() => {
    if (handle !== null && market !== null) handle.setMarket(market);
  }, [handle, market]);
  useEffect(() => {
    handle?.setView(shown);
  }, [handle, shown]);

  // Nobody stays held unseen: the market shown puts back whatever was carried, as "Keep them" or Escape does (the
  // highlight goes with it, as the market sets its own).
  const [shownBefore, setShownBefore] = useState(shown);
  if (shown !== shownBefore) {
    setShownBefore(shown);
    if (shown === "market") setCarry(null);
  }
  useEffect(() => {
    if (shown === "market") carryRef.current = null;
  }, [shown]);

  // The company selected is highlighted while the market shows; leaving the market clears it.
  const companyLit = useRef(false);
  useEffect(() => {
    if (handle === null) {
      companyLit.current = false;
      return;
    }
    if (shown === "market") {
      handle.setSelected(selectedSeat === null ? null : { kind: "company", seat: selectedSeat });
      companyLit.current = selectedSeat !== null;
    } else if (companyLit.current) {
      handle.setSelected(null);
      companyLit.current = false;
    }
  }, [handle, shown, selectedSeat]);

  const company = shown === "market" && selectedSeat !== null ? (market?.companies.find((c) => c.seat === selectedSeat && c.state !== "out") ?? null) : null;
  const card =
    company === null || market === null
      ? null
      : marketCard(company, company.state === "player" ? null : (rivals.find((row) => row.id === company.seat) ?? null), market.barUsers);

  // The labels over the market follow where the world draws it, every frame the market shows (the camera glides in,
  // the player pans or zooms, the window changes), and stand clear of the view switch and the company's card. They
  // are drawn only while the market shows on a running world: gone with the office, a lost context or the 2D layout.
  const labelled = shown === "market" && running && handle !== null && market !== null;
  useLayoutEffect(() => {
    if (!labelled || handle === null || market === null) return;
    let frame = 0;
    let last = "";
    const tick = (): void => {
      frame = window.requestAnimationFrame(tick);
      const canvas = cellRef.current?.querySelector("canvas");
      if (!canvas) return;
      const at = canvas.getBoundingClientRect();
      const relative = (element: Element | null): LabelRect[] => {
        if (element === null) return [];
        const rect = element.getBoundingClientRect();
        return [{ left: rect.left - at.left, top: rect.top - at.top, right: rect.right - at.left, bottom: rect.bottom - at.top }];
      };
      const next = placeMarketLabels({
        companies: market.companies,
        barUsers: market.barUsers,
        marks: handle.marketMarks(),
        cell: { width: at.width, height: at.height },
        avoid: [...relative(switchRef.current), ...relative(cardRef.current)],
      });
      const key = JSON.stringify(next);
      if (key === last) return;
      last = key;
      setLabels(next);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [labelled, handle, market]);

  // A new year in the office, or a year starting to play out, puts back whatever is carried.
  useEffect(() => {
    let year: number | null = null;
    try {
      year = source.get().year;
    } catch {
      // No career scene yet: nothing is carried either.
    }
    return source.subscribe(() => {
      const now = source.get().year;
      if (source.playing || now !== year) drop();
      year = now;
    });
  }, [source, drop]);

  // The note of a move nobody walks for goes after a moment (it is not shown over the market or a new carry).
  useEffect(() => {
    if (unseen === null) return;
    const timer = window.setTimeout(() => setUnseen(null), UNSEEN_MS);
    return () => window.clearTimeout(timer);
  }, [unseen]);

  // Escape puts the person back.
  useEffect(() => {
    if (carry === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") drop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [carry, drop]);

  // Escape closes the company's card.
  const cardShown = card !== null;
  useEffect(() => {
    if (!cardShown) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onSelectCompany(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cardShown, onSelectCompany]);

  return (
    <div ref={cellRef} className="relative h-full w-full">
      <WorldBoundary fallback={<WorldUnavailableNote />} onError={onFailed}>
        <WorldView source={source} onState={viewState} onTap={onTap} sound={careerWorldSound} />
      </WorldBoundary>
      {labelled && labels.length > 0 && (
        // Over the canvas, under the switch and the card; never a target, never focused.
        <div data-market-labels className="pointer-events-none absolute inset-0 z-[5] select-none overflow-hidden">
          {labels.map((label) => (
            <div
              key={label.key}
              data-market-label={label.key}
              style={{ left: label.left, top: label.top, width: label.width, height: label.height }}
              className={`absolute overflow-hidden whitespace-nowrap rounded border px-[6px] py-[3px] text-[11px] leading-[14px] shadow ${
                label.kind === "bar"
                  ? "border-amber-400/70 bg-black/60 text-amber-200"
                  : label.you
                    ? "border-sky-200 bg-sky-200 text-gray-900"
                    : "border-white/15 bg-black/60 text-gray-100"
              }`}
            >
              {label.kind === "bar" ? (
                label.lines[0]
              ) : (
                <>
                  <div className="font-semibold">
                    {label.you && <span className="mr-1 rounded-sm bg-gray-900 px-[3px] text-[10px] font-bold text-sky-200">{LABEL_WORDS.you}</span>}
                    {label.lines[0]}
                  </div>
                  <div className={label.you ? "text-gray-800" : "text-mist/80"}>{label.lines[1]}</div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <div ref={switchRef} role="group" aria-label={OFFICE_WORDS.views} className="panel-surface absolute left-2 top-2 z-10 flex gap-1 rounded-lg p-1 text-xs">
        {VIEWS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={shown === kind}
            disabled={playing || (kind === "market" && market === null)}
            title={kind === "market" && market === null ? OFFICE_WORDS.marketLater : undefined}
            onClick={() => onChooseView(kind)}
            className={`${shown === kind ? BUTTON_ON : BUTTON} px-2 py-1 text-[0.7rem] disabled:opacity-50`}
          >
            {kind === "office" ? OFFICE_WORDS.office : OFFICE_WORDS.market}
          </button>
        ))}
      </div>
      {card !== null && (
        <section
          ref={cardRef}
          aria-label={MARKET_WORDS.card}
          className="panel-surface absolute right-2 top-2 z-10 w-64 max-w-[calc(100%-1rem)] rounded-lg px-3 py-2 text-xs"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate text-sm font-semibold text-gray-100">{card.title}</h3>
            <button type="button" aria-label="Close" onClick={() => onSelectCompany(null)} className={`${BUTTON} shrink-0 px-2 py-0.5 text-[0.7rem]`}>
              ×
            </button>
          </div>
          <ul className="mt-1 space-y-0.5 text-mist/90">
            {card.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      {carry === null && unseen !== null && shown === "office" && (
        <div role="status" className="panel-surface absolute bottom-2 left-2 z-10 max-w-[calc(100%-1rem)] rounded-lg px-2 py-1.5 text-xs text-mist/90">
          {unseen}
        </div>
      )}
      {carry !== null && shown === "office" && (
        <div
          role="group"
          aria-label={CARRY_WORDS.label}
          className="panel-surface absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs"
        >
          <span className="text-mist/80">{carryLine(carry.team)}</span>
          {TEAMS.filter((team) => team !== carry.team).map((team) => (
            <button key={team} type="button" onClick={() => step({ team, personId: null })} className={`${BUTTON} px-2 py-1 text-[0.7rem]`}>
              {TEAM_NAMES[team]}
            </button>
          ))}
          <button type="button" onClick={drop} className={`${BUTTON} px-2 py-1 text-[0.7rem]`}>
            {CARRY_WORDS.keep}
          </button>
        </div>
      )}
    </div>
  );
};

export default CareerOffice;
