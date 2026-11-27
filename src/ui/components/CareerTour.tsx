import { useLayoutEffect, useRef, type RefObject } from "react";
import { dockFor, TOUR_GAP, type TourStep } from "../careerTour";
import { BUTTON, LABEL, PRIMARY } from "../styles";

interface CareerTourProps {
  step: TourStep;
  index: number;
  count: number;
  /** The fixed End bar, measured so a bottom card sits above it. */
  barRef: RefObject<HTMLDivElement | null>;
  onNext: () => void;
  onSkip: () => void;
}

/** How far the ring stands off its target. */
const RING_PAD = 4;

interface Box {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

/** The step's targets that are on screen now: the career-only data-tutorial attribute, hidden ones left out. */
const visibleTargets = (step: TourStep): HTMLElement[] =>
  step.target === null
    ? []
    : [...document.querySelectorAll<HTMLElement>(`[data-tutorial="${step.target}"]`)].filter((element) => element.getClientRects().length > 0);

/** The smallest box around every target, in the window's coordinates; null with none. */
const unionOf = (targets: readonly HTMLElement[]): Box | null => {
  if (targets.length === 0) return null;
  const rects = targets.map((target) => target.getBoundingClientRect());
  return {
    top: Math.min(...rects.map((rect) => rect.top)),
    left: Math.min(...rects.map((rect) => rect.left)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
    right: Math.max(...rects.map((rect) => rect.right)),
  };
};

/** The element or one of its ancestors is fixed: scrolling the page never moves it. */
const isFixed = (element: HTMLElement): boolean => {
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).position === "fixed") return true;
  }
  return false;
};

/** The start tour's card, docked at the top or the bottom of the screen, and a ring around what the step points at.
 *  Not a dialog: it never takes focus, and the ring lets every click through. */
export const CareerTour = ({ step, index, count, barRef, onNext, onSkip }: CareerTourProps) => {
  const cardRef = useRef<HTMLElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<"top" | "bottom">("bottom");

  // A new step: its targets brought into view, the card docked on the side with more room, and the page scrolled
  // so the card does not cover them. The card and the ring are placed on the page directly, before it is drawn.
  useLayoutEffect(() => {
    const card = cardRef.current;
    const ringEl = ringRef.current;
    if (card === null || ringEl === null) return;
    // The bar's measured height already holds the safe area under it.
    const bar = (): number => barRef.current?.offsetHeight ?? 0;
    const placeCard = (): void => {
      card.style.top = dockRef.current === "top" ? `${TOUR_GAP}px` : "";
      card.style.bottom = dockRef.current === "top" ? "" : `${bar() + TOUR_GAP}px`;
    };
    const placeRing = (box: Box | null): void => {
      ringEl.style.display = box === null ? "none" : "";
      if (box === null) return;
      ringEl.style.top = `${box.top - RING_PAD}px`;
      ringEl.style.left = `${box.left - RING_PAD}px`;
      ringEl.style.width = `${box.right - box.left + 2 * RING_PAD}px`;
      ringEl.style.height = `${box.bottom - box.top + 2 * RING_PAD}px`;
    };

    const targets = visibleTargets(step);
    const first = targets[0];
    dockRef.current = "bottom";
    if (first !== undefined) {
      first.scrollIntoView({ block: "center" });
      const box = unionOf(targets);
      if (box !== null) {
        const placed = dockFor({
          top: box.top,
          bottom: box.bottom,
          viewport: window.innerHeight,
          bar: bar(),
          card: card.offsetHeight,
          fixed: targets.some(isFixed),
        });
        if (placed.scroll !== 0) window.scrollBy(0, placed.scroll);
        dockRef.current = placed.dock;
      }
    }
    placeCard();
    placeRing(unionOf(targets));

    // The ring follows its targets while the page scrolls or the window changes size.
    let frame: number | null = null;
    const follow = (): void => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        placeCard();
        placeRing(unionOf(visibleTargets(step)));
      });
    };
    window.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow);
      window.removeEventListener("resize", follow);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [step, barRef]);

  const last = index + 1 >= count;

  return (
    <>
      <div ref={ringRef} aria-hidden className="pointer-events-none fixed z-[34] rounded-xl ring-2 ring-neon/80" style={{ display: "none" }} />
      <section
        ref={cardRef}
        aria-label="Tour"
        className="panel-surface fixed inset-x-3 z-[35] mx-auto max-h-[45vh] max-w-md overflow-y-auto rounded-xl p-3"
      >
        <p className={LABEL}>
          Step {index + 1} of {count}
        </p>
        <h2 className="mt-1 text-sm font-semibold text-gray-100">{step.title}</h2>
        <p aria-live="polite" className="mt-1 text-xs leading-snug text-mist">
          {step.text}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick={onSkip} className={`${BUTTON} px-3 py-2 text-xs`}>
            Skip the tour
          </button>
          <button type="button" onClick={onNext} className={`${PRIMARY} py-2`}>
            {last ? "Done" : "Next"}
          </button>
        </div>
      </section>
    </>
  );
};
