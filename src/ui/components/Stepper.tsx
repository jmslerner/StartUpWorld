import type { ReactNode } from "react";
import { BUTTON } from "../styles";

interface StepperProps {
  /** What is being stepped, for screen readers: "Product", "Marketing". */
  label: string;
  value: ReactNode;
  onStep: (delta: 1 | -1) => void;
  canDecrease: boolean;
  canIncrease: boolean;
  /** Width of the value between the buttons. */
  valueClassName?: string;
}

/** A value with a minus and a plus button. */
export const Stepper = ({ label, value, onStep, canDecrease, canIncrease, valueClassName = "w-10" }: StepperProps) => (
  <div role="group" aria-label={label} className="flex shrink-0 items-center gap-1">
    <button type="button" aria-label={`Less: ${label}`} disabled={!canDecrease} onClick={() => onStep(-1)} className={`${BUTTON} h-9 w-9 text-base leading-none`}>
      −
    </button>
    <output aria-live="polite" className={`${valueClassName} text-center text-sm font-semibold tabular-nums text-gray-100`}>
      {value}
    </output>
    <button type="button" aria-label={`More: ${label}`} disabled={!canIncrease} onClick={() => onStep(1)} className={`${BUTTON} h-9 w-9 text-base leading-none`}>
      +
    </button>
  </div>
);
