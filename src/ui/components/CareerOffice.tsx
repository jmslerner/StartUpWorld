import { useCallback, useEffect, useRef, useState } from "react";
import type { Plan } from "../../engine/types";
import type { WorldViewState } from "../../world/mountWorld";
import type { InteractableTarget } from "../../world/types/interaction";
import type { WorldHandle } from "../../world/types/handle";
import type { Team } from "../../world/types/scene";
import WorldView from "../../world/WorldView";
import { WorldBoundary, WorldUnavailableNote } from "../../world/ui/WorldShell";
import { CARRY_WORDS, carryLine, carryStep, highlightFor, TEAM_NAMES, type Carry, type Picked } from "../officeMoves";
import type { OfficeSource } from "../officeSource";
import { BUTTON } from "../styles";

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
}

type Select = (target: InteractableTarget | null) => void;

const TEAMS: readonly Team[] = ["product", "growth", "recruiting"];

/**
 * The career's office in 3D. The one place under src/ui that brings in the world by value, so it is only ever
 * loaded lazily (through OfficeSlot), and three.js with it. It fills the cell the screen gives it.
 *
 * A person is moved by pointing: a tap picks them up (highlighted), a tap on someone of another team, or one of the
 * strip's team buttons, sets them down there as one change to the plan. Every tap goes through `carryStep`.
 */
const CareerOffice = ({ source, draft, onMove, onView, onFailed }: CareerOfficeProps) => {
  const [carry, setCarry] = useState<Carry>(null);
  const carryRef = useRef<Carry>(null);
  const draftRef = useRef(draft);
  const handleRef = useRef<WorldHandle | null>(null);
  const selectRef = useRef<Select | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

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
      handle?.releaseFirst(personId);
      onMove(move);
      // The plan did not change the office: the hint must not wait for a later scene.
      if (source.get() === shown) handle?.releaseFirst(null);
      setCarried(null);
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
      const next = carryStep(carried, picked, draftRef.current);
      if (next.move !== null && carried !== null) moveCarried(carried.personId, next.move);
      else setCarried(next.carry);
    },
    [source, drop, moveCarried, setCarried],
  );

  const onTap = useCallback(
    (target: InteractableTarget | null, select: Select) => {
      selectRef.current = select;
      const handle = handleRef.current;
      step(
        target === null
          ? null
          : { team: handle?.teamOf(target) ?? null, personId: target.kind === "person" ? target.personId : null },
      );
    },
    [step],
  );

  const view = useCallback(
    (state: WorldViewState) => {
      // Another world (or none): what was carried there is put back.
      if (state.handle !== handleRef.current) {
        drop();
        handleRef.current = state.handle;
      }
      onView(state);
    },
    [onView, drop],
  );

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

  // Escape puts the person back.
  useEffect(() => {
    if (carry === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") drop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [carry, drop]);

  return (
    <div className="relative h-full w-full">
      <WorldBoundary fallback={<WorldUnavailableNote />} onError={onFailed}>
        <WorldView source={source} onState={view} onTap={onTap} />
      </WorldBoundary>
      {carry !== null && (
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
