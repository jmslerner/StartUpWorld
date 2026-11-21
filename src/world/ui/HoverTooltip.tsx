import { useLayoutEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";
import { useGameStore } from "../../state/useGameStore";
import { sameTarget } from "../targets";
import { describeTarget } from "./inspector";
import { placeChip } from "./placement";
import type { Stage } from "./stage";

interface HoverTooltipProps {
  stage: Stage;
}

/**
 * Name chip over whatever the pointer is on.
 *
 * It says exactly what the card would be titled if you clicked (a person's
 * chip adds their role, as the card's subtitle does), so the two never
 * disagree; the label the scene registered is only a fallback.
 *
 * The world reports a hover once, when it starts; the thing under the pointer
 * may then keep moving (a person walking, the camera easing). While a hover is
 * active the chip therefore re-projects its target each frame and moves itself
 * with a transform — cheap, and no React renders.
 */
export const HoverTooltip = ({ stage }: HoverTooltipProps) => {
  const hover = useStore(stage.store, (state) => state.hover);
  const selected = useStore(stage.store, (state) => state.selected);
  const world = useStore(stage.store, (state) => state.handle);
  const game = useGameStore((store) => store.state);
  const chipRef = useRef<HTMLDivElement>(null);

  // The selected target already has its card; a chip on top of it is noise.
  const shown = hover !== null && !sameTarget(hover.target, selected) ? hover : null;
  const text = useMemo(() => {
    if (!shown) return null;
    const card = describeTarget(shown.target, game, { hiddenCount: world?.hiddenCount() });
    if (!card) return { title: shown.label, detail: null };
    return { title: card.title, detail: shown.target.kind === "person" ? (card.subtitle ?? null) : null };
  }, [shown, game, world]);

  useLayoutEffect(() => {
    const chip = chipRef.current;
    if (!shown || !chip) return;

    let frame = 0;
    let last = "";
    const follow = (): void => {
      const { handle, size } = stage.store.getState();
      const anchor = handle?.project(shown.target) ?? shown.screen;
      const at = placeChip(anchor, { width: chip.offsetWidth, height: chip.offsetHeight }, size);
      const transform = `translate3d(${Math.round(at.x)}px, ${Math.round(at.y)}px, 0)`;
      if (transform !== last) {
        chip.style.transform = transform;
        last = transform;
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [stage, shown]);

  if (!shown || !text) return null;
  return (
    <div
      ref={chipRef}
      role="tooltip"
      className="absolute left-0 top-0 z-10 max-w-[16rem] truncate rounded-md border border-white/10 bg-ink/85 px-2 py-0.5 text-[0.7rem] font-medium text-slate-100 shadow-lg will-change-transform"
    >
      {text.title}
      {text.detail ? <span className="text-mist/70"> · {text.detail}</span> : null}
    </div>
  );
};
