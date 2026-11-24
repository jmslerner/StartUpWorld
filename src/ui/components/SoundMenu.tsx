import { useEffect, useId, useRef, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { playSound } from "../../audio/engine";
import { audioSettings } from "../../audio/settings";

interface SoundMenuProps {
  /** Extra classes for the button (e.g. `ml-auto`). */
  className?: string;
  /** Which edge of the button the popover lines up with. */
  align?: "left" | "right";
}

/** Popover width (Tailwind w-60) and the gap it keeps from the button and the viewport edge. */
const PANEL_WIDTH = 240;
const PANEL_ROOM = 120;
const GAP = 8;

interface Anchor {
  left: number;
  /** Exactly one of these is set: below the button, or above it when there is no room below. */
  top?: number;
  bottom?: number;
}

/** Where the popover goes for a button: under it (or over it near the bottom of the window), kept on screen. */
const anchorFor = (button: HTMLElement, align: "left" | "right"): Anchor => {
  const rect = button.getBoundingClientRect();
  const wanted = align === "right" ? rect.right - PANEL_WIDTH : rect.left;
  const left = Math.max(GAP, Math.min(wanted, window.innerWidth - PANEL_WIDTH - GAP));
  const below = rect.bottom + GAP + PANEL_ROOM <= window.innerHeight || rect.top < PANEL_ROOM;
  return below ? { left, top: rect.bottom + GAP } : { left, bottom: window.innerHeight - rect.top + GAP };
};

const percent = (value: number): number => Math.round(value * 100);

interface FaderProps {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  /** Called when the drag / key press ends — a good moment for a reference blip. */
  onCommit?: () => void;
}

const Fader = ({ label, value, disabled, onChange, onCommit }: FaderProps) => {
  const id = useId();
  return (
    <div className={disabled ? "opacity-50" : undefined}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-mist/80">
          {label}
        </label>
        <span className="font-mono tabular-nums text-mist/60">{percent(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent(value)}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="mt-1 h-1.5 w-full cursor-pointer accent-neon disabled:cursor-not-allowed"
      />
    </div>
  );
};

/** Focusable controls inside the panel, in tab order. */
const focusables = (panel: HTMLElement | null): HTMLElement[] =>
  panel ? Array.from(panel.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")) : [];

/**
 * Small sound control for the resource bar: a button that opens a popover with a mute toggle
 * and a volume fader. Self-contained — it reads and writes the shared `audioSettings`, which
 * the audio engine follows.
 *
 * The popover is rendered in a portal with fixed positioning, so it is never trapped under a
 * neighbouring panel (every `.panel-surface` is its own stacking context). Because a portal
 * sits at the end of the page's tab order, the menu manages focus itself, like a disclosure:
 *   • opening it moves focus to its first control; Tab / Shift+Tab move between its controls
 *     and back to the button, never off into the rest of the page while it is open;
 *   • Escape closes it and returns focus to the button; so does Tab past its last control;
 *   • it closes when focus leaves both the button and the panel, or on a click outside.
 */
export const SoundMenu = ({ className, align = "right" }: SoundMenuProps) => {
  const settings = useSyncExternalStore(audioSettings.subscribe, audioSettings.get, audioSettings.get);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** The button is being pressed: Safari does not focus buttons on click, so blur says "nowhere". */
  const pressingRef = useRef(false);
  const panelId = useId();
  const muted = settings.muted;
  const open = anchor !== null;

  const close = (refocus: boolean) => {
    setAnchor(null);
    if (refocus) buttonRef.current?.focus();
  };

  // Opening moves focus into the panel (an effect: the panel only exists after this render).
  useEffect(() => {
    if (open) focusables(panelRef.current)[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      if (buttonRef.current) setAnchor(anchorFor(buttonRef.current, align));
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target)) return;
      pressingRef.current = false;
      if (panelRef.current?.contains(target)) return;
      setAnchor(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // This Escape is spent: anything open under the menu stays open.
      event.preventDefault();
      const active = document.activeElement;
      const inside = active instanceof Node && (buttonRef.current?.contains(active) || panelRef.current?.contains(active));
      setAnchor(null);
      if (inside) buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align]);

  const toggleOpen = () => {
    pressingRef.current = false;
    playSound(open ? "ui-close" : "ui-open");
    if (open) setAnchor(null);
    else if (buttonRef.current) setAnchor(anchorFor(buttonRef.current, align));
  };

  /** Close once focus has left both the button and the panel (not when the window loses focus). */
  const onBlurWithin = (event: FocusEvent) => {
    if (!open || !document.hasFocus() || pressingRef.current) return;
    const next = event.relatedTarget;
    if (next instanceof Node && (buttonRef.current?.contains(next) || panelRef.current?.contains(next))) return;
    setAnchor(null);
  };

  /** Tab from the button goes into the open panel, not to whatever follows the button. */
  const onButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open || event.key !== "Tab" || event.shiftKey) return;
    const first = focusables(panelRef.current)[0];
    if (!first) return;
    event.preventDefault();
    first.focus();
  };

  /** Keep Tab inside the panel and the button while it is open. */
  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const items = focusables(panelRef.current);
    if (items.length === 0) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === items[0] || active === panelRef.current)) {
      event.preventDefault();
      buttonRef.current?.focus();
    } else if (!event.shiftKey && active === items[items.length - 1]) {
      event.preventDefault();
      close(true);
    }
  };

  const toggleMuted = () => {
    audioSettings.setMuted(!muted);
    // Only audible when this un-mutes; a muted engine stays silent.
    playSound("ui-toggle-on");
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onPointerDown={() => {
          pressingRef.current = true;
        }}
        onPointerCancel={() => {
          pressingRef.current = false;
        }}
        onClick={toggleOpen}
        onKeyDown={onButtonKeyDown}
        onBlur={onBlurWithin}
        // While open, Escape here is the menu's.
        data-own-escape={open || undefined}
        title="Sound settings"
        className={`${
          muted
            ? "rounded-lg bg-steel/30 px-2 py-1 text-[0.65rem] text-mist/80 hover:bg-steel/50"
            : "rounded-lg bg-neon/10 px-2 py-1 text-[0.65rem] font-semibold text-neon"
        } ${className ?? ""}`}
      >
        Sound {muted ? "OFF" : "ON"}
      </button>

      {anchor
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label="Sound settings"
              tabIndex={-1}
              data-own-escape
              onKeyDown={onPanelKeyDown}
              onBlur={onBlurWithin}
              style={{ left: anchor.left, top: anchor.top, bottom: anchor.bottom, width: PANEL_WIDTH }}
              className="panel-surface fixed z-50 rounded-xl p-3 text-xs text-mist outline-none"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-white">Sound</span>
                {/* A toggle button keeps one name; its pressed state says whether it is on. */}
                <button
                  type="button"
                  aria-pressed={muted}
                  onClick={toggleMuted}
                  className={
                    muted
                      ? "rounded-lg bg-red-500/20 px-2 py-1 text-[0.65rem] font-semibold text-red-400"
                      : "rounded-lg bg-steel/30 px-2 py-1 text-[0.65rem] text-mist/80 hover:bg-steel/50"
                  }
                >
                  Mute all
                </button>
              </div>

              <div className="flex flex-col gap-3">
                <Fader
                  label="Volume"
                  value={settings.master}
                  disabled={muted}
                  onChange={(value) => audioSettings.setMaster(value)}
                  onCommit={() => playSound("ui-select")}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};
