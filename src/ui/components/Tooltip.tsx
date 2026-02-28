import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  widthClassName?: string;
  className?: string;
}

const GAP_PX = 8;
const MARGIN_PX = 8;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export const Tooltip = ({ content, children, align = "left", widthClassName = "w-72", className }: TooltipProps) => {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;

    const a = anchor.getBoundingClientRect();
    const t = tooltip.getBoundingClientRect();

    const placeAbove = a.top - GAP_PX - t.height >= MARGIN_PX;
    const top = placeAbove ? a.top - GAP_PX - t.height : a.bottom + GAP_PX;

    const desiredLeft = align === "right" ? a.right - t.width : a.left;
    const left = clamp(desiredLeft, MARGIN_PX, Math.max(MARGIN_PX, window.innerWidth - t.width - MARGIN_PX));

    const clampedTop = clamp(top, MARGIN_PX, Math.max(MARGIN_PX, window.innerHeight - t.height - MARGIN_PX));
    setPos({ top: clampedTop, left });
  }, [align]);

  useIsoLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    // Second pass after paint to handle late font/layout changes.
    const id = window.requestAnimationFrame(updatePosition);
    return () => window.cancelAnimationFrame(id);
  }, [open, updatePosition, widthClassName]);

  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open, updatePosition]);

  const canPortal = typeof document !== "undefined";

  return (
    <span
      ref={anchorRef}
      className={"relative inline-flex " + (className ?? "")}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && canPortal
        ? createPortal(
            <span
              ref={tooltipRef}
              className={
                "pointer-events-none fixed z-[9999] " +
                widthClassName +
                " transition duration-150 ease-out " +
                (pos ? " opacity-100" : " opacity-0")
              }
              style={pos ? { top: `${pos.top}px`, left: `${pos.left}px` } : { top: 0, left: 0 }}
              role="tooltip"
            >
              <span className="panel-surface block max-w-[calc(100vw-16px)] rounded-xl px-3 py-2 text-xs leading-relaxed text-slate-100/90">
                {content}
              </span>
            </span>,
            document.body
          )
        : null}
    </span>
  );
};
