import { useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { playSound } from "../../audio/engine";
import type { InteractableTarget } from "../types";
import type { InspectorAction, InspectorCard, InspectorLine } from "./inspector";
import { placeCard, type CardSide } from "./placement";
import type { Stage } from "./stage";

interface InspectorPanelProps {
  stage: Stage;
  /** What the card describes; the camera brings it into view and the card keeps off it. */
  target: InteractableTarget;
  card: InspectorCard;
  /** Narrow viewport: dock as a sheet along the bottom instead of floating next to the target. */
  docked: boolean;
  onRun: (command: string) => void;
  onPrefill: (command: string) => void;
  onClose: () => void;
}

/** Cards with this many actions or more (the empty desk's ten roles) use one-line rows and a wider card. */
const DENSE_FROM = 5;
/** In a one-line row, a refusal longer than this gets a line of its own under the label. */
const DENSE_REASON_INLINE = 26;
const NOTCH_SIZE = 10;
/** Key facts a docked (phone) card shows before "More". */
const DOCKED_LINES = 3;
/** Gap kept between a docked card and the object the camera lifts above it. */
const DOCK_CLEARANCE_PX = 6;
/**
 * A floating card re-checks its spot this often even when the anchor is still:
 * an object can change shape in place (a desk being filled, a blueprint popping in).
 */
const REPLACE_EVERY_MS = 300;
/** Height of the world HUD's top row (phase, week, AP, End week), which the camera keeps a focused object below. */
const HUD_ROW_PX = 40;

const LINE_TONES: Record<NonNullable<InspectorLine["tone"]>, string> = {
  good: "text-emerald-400",
  bad: "text-red-400",
  warn: "text-amber-300",
};

const ACTION_TONES: Record<NonNullable<InspectorAction["tone"]>, string> = {
  primary: "bg-neon/15 text-neon ring-1 ring-inset ring-neon/40",
  default: "bg-steel/40 text-slate-100",
  danger: "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-400/40",
};

const ACTION_HOVER: Record<NonNullable<InspectorAction["tone"]>, string> = {
  primary: "hover:bg-neon/25",
  default: "hover:bg-steel/70",
  danger: "hover:bg-red-500/25",
};

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neon";

/**
 * Pressing a button in the world must not take keyboard focus away from the
 * terminal, so the press never starts a focus change. Keyboard users can still
 * Tab to these buttons and activate them.
 */
const keepTerminalFocus = (event: MouseEvent): void => event.preventDefault();

/** What the button will put in the terminal: "hire eng 1", or "ship …" for a command the player finishes. */
const shownCommand = (action: InspectorAction): string =>
  action.mode === "prefill" ? `${action.command.trim()} …` : action.command;

interface ActionButtonProps {
  action: InspectorAction;
  /** One-line layout for long menus (the empty desk's ten roles). */
  dense: boolean;
  /** Chip in the docked card's sideways-scrolling row: label and price only. */
  compact?: boolean;
  onRun: (command: string) => void;
  onPrefill: (command: string) => void;
}

const ActionButton = ({ action, dense, compact = false, onRun, onPrefill }: ActionButtonProps) => {
  const tone = action.tone ?? "default";
  const disabled = action.disabledReason !== undefined;
  // A disabled action explains itself where its price would be.
  const aside = action.disabledReason ?? action.hint;
  const asideClass = disabled ? "text-ember" : "text-mist/70";
  const verb = action.mode === "prefill" ? "Puts in the terminal" : "Runs";

  const command = (
    <span className={`truncate font-mono text-[0.68rem] leading-snug ${disabled ? "text-mist/50" : "text-neon/80"}`}>
      <span aria-hidden className="select-none text-mist/50">
        &gt;{" "}
      </span>
      {shownCommand(action)}
    </span>
  );

  const title = disabled ? `${action.disabledReason} (${action.command.trim()})` : `${verb}: ${action.command.trim()}`;
  const press = (): void => {
    if (disabled) {
      playSound("ui-denied");
      return;
    }
    // A prefill sounds from the terminal as the command lands there ("your turn to type").
    if (action.mode === "prefill") onPrefill(action.command);
    else {
      playSound("ui-press");
      onRun(action.command);
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        aria-disabled={disabled}
        title={title}
        onMouseDown={keepTerminalFocus}
        onClick={press}
        className={`flex max-w-[11.5rem] shrink-0 flex-col items-start rounded-lg px-2.5 py-1 text-left text-xs transition-colors ${ACTION_TONES[tone]} ${FOCUS_RING} ${
          disabled ? "cursor-not-allowed opacity-60" : ACTION_HOVER[tone]
        }`}
      >
        <span className="max-w-full truncate font-medium leading-snug">{action.label}</span>
        {aside ? <span className={`max-w-full truncate text-[0.65rem] leading-snug ${asideClass}`}>{aside}</span> : null}
      </button>
    );
  }

  return (
    <button
      type="button"
      // aria-disabled (not `disabled`) keeps the button focusable, so the reason can be reached and read.
      aria-disabled={disabled}
      title={title}
      onMouseDown={keepTerminalFocus}
      onClick={press}
      className={`w-full rounded-lg text-left text-xs transition-colors ${ACTION_TONES[tone]} ${FOCUS_RING} ${
        disabled ? "cursor-not-allowed opacity-60" : ACTION_HOVER[tone]
      } ${dense ? "flex flex-wrap items-baseline gap-x-2 px-2 py-[3px]" : "flex flex-col gap-0.5 px-2 py-1.5"}`}
    >
      {dense ? (
        <>
          {/* The label wins the room; the command gives way (it is in the tooltip as well). */}
          <span className="min-w-0 max-w-[64%] shrink-0 truncate font-medium leading-snug">{action.label}</span>
          {/* A locked row needs the room for its reason; the command is still in the tooltip. */}
          {disabled ? <span className="flex-1" /> : <span className="flex min-w-0 flex-1 justify-end">{command}</span>}
          {aside ? (
            <span
              className={`text-[0.65rem] leading-snug ${
                disabled && aside.length > DENSE_REASON_INLINE ? "basis-full text-left" : `shrink-0 text-right ${disabled ? "" : "w-[4.75rem]"}`
              } ${asideClass}`}
            >
              {aside}
            </span>
          ) : null}
        </>
      ) : (
        <>
          {/* The label never shrinks: when the price or the reason does not fit beside it,
              that wraps onto its own line instead of squeezing the label into a column. */}
          <span className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="max-w-full shrink-0 font-medium leading-snug">{action.label}</span>
            {aside ? <span className={`text-[0.65rem] leading-snug ${asideClass}`}>{aside}</span> : null}
          </span>
          {command}
        </>
      )}
    </button>
  );
};

interface CardBodyProps extends Omit<InspectorPanelProps, "stage" | "docked" | "target"> {
  className: string;
  /** Extra header control, next to Close. */
  headerAction?: ReactNode;
}

/** Consecutive actions that share a `row` key, as groups (an action without one is a group of its own). */
const groupRows = (actions: readonly InspectorAction[]): InspectorAction[][] => {
  const groups: InspectorAction[][] = [];
  for (const action of actions) {
    const last = groups[groups.length - 1];
    if (action.row !== undefined && last && last[0].row === action.row) last.push(action);
    else groups.push([action]);
  }
  return groups;
};

const CloseButton = ({ onClose }: { onClose: () => void }) => (
  <button
    type="button"
    aria-label="Close"
    title="Close (Esc)"
    onMouseDown={keepTerminalFocus}
    onClick={onClose}
    className={`-mr-1 -mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-mist/70 hover:bg-white/10 hover:text-white ${FOCUS_RING}`}
  >
    <span aria-hidden>✕</span>
  </button>
);

const CardBody = ({ card, onRun, onPrefill, onClose, className, headerAction }: CardBodyProps) => {
  const dense = card.actions.length >= DENSE_FROM;
  return (
    <div className={`world-pop panel-surface flex min-h-0 flex-col rounded-xl text-xs ${className}`}>
      <div className="flex items-start gap-2 px-3 pb-2 pt-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{card.title}</div>
          {card.subtitle ? <div className="truncate text-[0.7rem] text-mist/70">{card.subtitle}</div> : null}
        </div>
        {headerAction}
        <CloseButton onClose={onClose} />
      </div>

      <div className="terminal-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {card.lines.length > 0 ? (
          <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-white/5 pt-2">
            {card.lines.map((line) => (
              <div key={line.label} className="contents">
                <dt className="text-mist/70">{line.label}</dt>
                <dd className={`text-right tabular-nums ${line.tone ? LINE_TONES[line.tone] : "text-slate-100"}`}>
                  {line.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {card.note ? <p className="mb-2 leading-snug text-mist/80">{card.note}</p> : null}

        {card.actions.length > 0 ? (
          <div className={`flex flex-col ${dense ? "gap-0.5" : "gap-1.5"}`}>
            {groupRows(card.actions).map((group) =>
              group.length === 1 ? (
                <ActionButton key={group[0].command} action={group[0]} dense={dense} onRun={onRun} onPrefill={onPrefill} />
              ) : (
                // One row, several buttons: the first in full, the rest as chips beside it.
                <div key={group[0].command} className="flex items-stretch gap-1">
                  <div className="min-w-0 flex-1">
                    <ActionButton action={group[0]} dense={dense} onRun={onRun} onPrefill={onPrefill} />
                  </div>
                  {group.slice(1).map((action) => (
                    <ActionButton key={action.command} action={action} dense={false} compact onRun={onRun} onPrefill={onPrefill} />
                  ))}
                </div>
              )
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const ToggleButton = ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
  <button
    type="button"
    aria-expanded={expanded}
    onMouseDown={keepTerminalFocus}
    onClick={onToggle}
    className={`-mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[0.68rem] text-neon/90 hover:bg-white/10 ${FOCUS_RING}`}
  >
    {expanded ? "Less" : "More"}
  </button>
);

/**
 * The phone version: a compact sheet along the bottom of the viewport — title,
 * a few key facts and the actions in one sideways-scrolling row — so the
 * camera can keep the object itself in view above it. "More" opens the full
 * card (every line, the note, the actions as a list) inside the same sheet.
 */
const DockedCard = ({ card, onRun, onPrefill, onClose }: Omit<CardBodyProps, "className">) => {
  const [expanded, setExpanded] = useState(false);
  const keyLines = card.lines.slice(0, DOCKED_LINES);
  const hasMore = card.lines.length > keyLines.length || card.note !== undefined;

  if (expanded) {
    return (
      <CardBody
        card={card}
        onRun={onRun}
        onPrefill={onPrefill}
        onClose={onClose}
        className="w-full"
        headerAction={<ToggleButton expanded onToggle={() => setExpanded(false)} />}
      />
    );
  }

  return (
    <div className="world-pop panel-surface flex min-h-0 flex-col rounded-xl text-xs">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          {/* The title wins the room: the subtitle truncates first ("Leak Rumor", not "Leak Rum…"). */}
          <span className="max-w-full shrink-0 truncate text-sm font-semibold text-white">{card.title}</span>
          {card.subtitle ? <span className="min-w-0 truncate text-[0.7rem] text-mist/70">{card.subtitle}</span> : null}
        </div>
        {hasMore ? <ToggleButton expanded={false} onToggle={() => setExpanded(true)} /> : null}
        <CloseButton onClose={onClose} />
      </div>

      {keyLines.length > 0 ? (
        <dl className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-1.5 text-[0.7rem]">
          {keyLines.map((line) => (
            <div key={line.label} className="flex min-w-0 items-baseline gap-1">
              <dt className="shrink-0 text-mist/70">{line.label}</dt>
              <dd className={`truncate tabular-nums ${line.tone ? LINE_TONES[line.tone] : "text-slate-100"}`}>{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {card.actions.length > 0 ? (
        <div className="terminal-scrollbar flex gap-1.5 overflow-x-auto overscroll-contain px-3 pb-2.5 pt-0.5">
          {card.actions.map((action) => (
            <ActionButton key={action.command} action={action} dense={false} compact onRun={onRun} onPrefill={onPrefill} />
          ))}
        </div>
      ) : (
        <div className="pb-1.5" />
      )}
    </div>
  );
};

/**
 * The inspector card for the selected target.
 *
 * Floating mode follows the target's projected anchor. The anchor moves every
 * frame while the camera pans or a person walks, so the position is written
 * straight to the element's transform from the anchor channel — React state is
 * not involved and nothing re-renders.
 */
export const InspectorPanel = ({ stage, target, card, docked, onRun, onPrefill, onClose }: InspectorPanelProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const notchRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // Docked: whenever the sheet appears or changes height, lift the object into the space above it.
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!docked || !dock) return;
    let lastCovered = -1;
    const lift = (): void => {
      const { handle, size } = stage.store.getState();
      if (!handle || size.height <= 0) return;
      const covered = Math.max(0, Math.round(size.height - dock.offsetTop + DOCK_CLEARANCE_PX));
      if (covered === lastCovered) return;
      lastCovered = covered;
      handle.focus(target, { avoidBottomPx: covered, avoidTopPx: HUD_ROW_PX });
    };
    lift();
    const observer = new ResizeObserver(lift);
    observer.observe(dock);
    const stopSize = stage.store.subscribe((next, previous) => {
      if (next.size !== previous.size) {
        lastCovered = -1;
        lift();
      }
    });
    return () => {
      observer.disconnect();
      stopSize();
    };
  }, [stage, target, docked]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const notch = notchRef.current;
    if (docked || !root || !notch) return;

    let side: CardSide | null = null;
    const place = (): void => {
      const anchor = stage.anchor.get();
      // No anchor (the target is momentarily gone): stay where we were.
      if (!anchor) return;
      const { handle, size } = stage.store.getState();
      const placement = placeCard(anchor, { width: root.offsetWidth, height: root.offsetHeight }, size, {
        avoid: handle?.screenBounds(target) ?? null,
        prefer: side,
        // Keep the HUD row (phase, week, AP, End week) uncovered whenever the card fits under it.
        minTop: HUD_ROW_PX + 4,
      });
      side = placement.side;
      root.style.transform = `translate3d(${Math.round(placement.left)}px, ${Math.round(placement.top)}px, 0)`;
      // Hidden until the first placement so the card never flashes in the corner.
      root.dataset.placed = "true";
      if (placement.notch) {
        notch.dataset.side = placement.side;
        notch.style.transform = `translate(${Math.round(placement.notch.x - NOTCH_SIZE / 2)}px, ${Math.round(
          placement.notch.y - NOTCH_SIZE / 2
        )}px) rotate(45deg)`;
        notch.style.display = "";
      } else {
        notch.style.display = "none";
      }
    };

    place();
    const stopAnchor = stage.anchor.subscribe(place);
    const stopSize = stage.store.subscribe((next, previous) => {
      if (next.size !== previous.size) place();
    });
    // The card's own size changes as the game state changes what it says.
    const observer = new ResizeObserver(place);
    observer.observe(root);
    const timer = window.setInterval(place, REPLACE_EVERY_MS);
    return () => {
      stopAnchor();
      stopSize();
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [stage, target, docked]);

  if (docked) {
    return (
      <div
        // Distinct keys: without them React reuses the floating card's element when the
        // viewport narrows, and its imperative transform would push the sheet off-screen.
        key="docked"
        ref={dockRef}
        role="dialog"
        aria-label={card.title}
        // Compact, it stays under half the viewport; opened up ("More") it may take a little more.
        className="pointer-events-auto absolute inset-x-2 bottom-2 z-20 flex max-h-[62%] flex-col"
      >
        <DockedCard card={card} onRun={onRun} onPrefill={onPrefill} onClose={onClose} />
      </div>
    );
  }

  return (
    <div
      key="floating"
      ref={rootRef}
      role="dialog"
      aria-label={card.title}
      className={`pointer-events-auto invisible absolute left-0 top-0 z-20 flex max-h-[calc(100%-16px)] flex-col will-change-transform data-[placed=true]:visible ${
        card.wide ? "w-[26rem]" : card.actions.length >= DENSE_FROM ? "w-[22rem]" : "w-[17.5rem]"
      }`}
    >
      <CardBody card={card} onRun={onRun} onPrefill={onPrefill} onClose={onClose} className="w-full" />
      <div ref={notchRef} aria-hidden className="world-card-notch" style={{ width: NOTCH_SIZE, height: NOTCH_SIZE }} />
    </div>
  );
};
