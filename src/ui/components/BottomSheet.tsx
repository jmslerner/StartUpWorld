import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export type SheetSnap = "collapsed" | "mid" | "expanded";

interface BottomSheetProps {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  collapsedVh?: number;
  midVh?: number;
  expandedVh?: number;
  children: ReactNode;
  header?: ReactNode;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const closestSnap = (heightPx: number, points: Record<SheetSnap, number>): SheetSnap => {
  const entries: Array<[SheetSnap, number]> = Object.entries(points) as Array<[SheetSnap, number]>;
  entries.sort((a, b) => Math.abs(a[1] - heightPx) - Math.abs(b[1] - heightPx));
  return entries[0][0];
};

export const BottomSheet = ({
  snap,
  onSnapChange,
  collapsedVh = 12,
  midVh = 55,
  expandedVh = 90,
  header,
  children,
}: BottomSheetProps) => {
  const [dragHeightPx, setDragHeightPx] = useState<number | null>(null);
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  const dragRef = useRef<{
    startY: number;
    startHeight: number;
    moved: boolean;
  } | null>(null);
  const originalBodyOverflow = useRef<string | null>(null);
  const suppressNextClickRef = useRef(false);

  const snapPointsPx: Record<SheetSnap, number> = {
    collapsed: (viewportHeight * collapsedVh) / 100,
    mid: (viewportHeight * midVh) / 100,
    expanded: (viewportHeight * expandedVh) / 100,
  };

  const effectiveHeightPx = dragHeightPx ?? snapPointsPx[snap];

  useEffect(() => {
    if (originalBodyOverflow.current === null) {
      originalBodyOverflow.current = document.body.style.overflow;
    }

    document.body.style.overflow = snap === "collapsed" ? "" : "hidden";

    return () => {
      document.body.style.overflow = originalBodyOverflow.current ?? "";
    };
  }, [snap]);

  useEffect(() => {
    const onResize = () => {
      // If the viewport changes (mobile chrome), keep the snap state but stop any in-progress drag.
      setDragHeightPx(null);
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startY: event.clientY,
      startHeight: effectiveHeightPx,
      moved: false,
    };
    suppressNextClickRef.current = false;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    const { startY, startHeight } = dragRef.current;
    const dy = startY - event.clientY;
    if (Math.abs(dy) >= 4) dragRef.current.moved = true;
    const next = clamp(startHeight + dy, snapPointsPx.collapsed, snapPointsPx.expanded);
    setDragHeightPx(next);
  };

  const onPointerUp = () => {
    if (!dragRef.current) return;
    const moved = dragRef.current.moved;
    const finalHeight = dragHeightPx ?? effectiveHeightPx;
    dragRef.current = null;
    setDragHeightPx(null);
    suppressNextClickRef.current = moved;
    onSnapChange(closestSnap(finalHeight, snapPointsPx));
  };

  const cycleSnap = () => {
    onSnapChange(snap === "collapsed" ? "mid" : snap === "mid" ? "expanded" : "collapsed");
  };

  const onToggle = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    cycleSnap();
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30"
      style={{ height: effectiveHeightPx, paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="panel-surface flex h-full flex-col rounded-t-2xl border-b-0">
        <div className="px-3 pt-2">
          <button
            type="button"
            className="mx-auto flex w-full max-w-[12rem] items-center justify-center py-2"
            aria-label="Toggle panels"
            onClick={onToggle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{ touchAction: "none" }}
          >
            <span className="h-1 w-12 rounded-full bg-white/15" />
          </button>
        </div>

        {header && <div className="px-3 pb-2">{header}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">{children}</div>
      </div>
    </div>
  );
};
