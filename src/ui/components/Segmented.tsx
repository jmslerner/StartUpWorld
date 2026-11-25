import type { ReactNode } from "react";
import { BUTTON, BUTTON_ON } from "../styles";

export interface SegmentedOption<K extends string | number> {
  key: K;
  label: ReactNode;
  /** A second, smaller line: a price, an amount, odds. */
  sub?: ReactNode;
  disabled?: boolean;
  /** Why it is disabled, or what it does. */
  title?: string;
}

interface SegmentedProps<K extends string | number> {
  /** What is being chosen, for screen readers. */
  label: string;
  options: readonly SegmentedOption<K>[];
  selected: K;
  onSelect: (key: K) => void;
  /** Options per row on a phone; wider screens lay them out in one row. */
  mobileColumns?: 2 | 3;
}

/** One choice out of a few, as a row of buttons. */
export const Segmented = <K extends string | number>({ label, options, selected, onSelect, mobileColumns = 2 }: SegmentedProps<K>) => (
  <div role="group" aria-label={label} className={`grid gap-1.5 sm:flex sm:flex-wrap ${mobileColumns === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
    {options.map((option) => (
      <button
        key={option.key}
        type="button"
        aria-pressed={option.key === selected}
        disabled={option.disabled}
        title={option.title}
        onClick={() => onSelect(option.key)}
        className={`${option.key === selected ? BUTTON_ON : BUTTON} min-h-9 min-w-0 px-2.5 py-1.5 text-left text-xs sm:min-w-[4.25rem]`}
      >
        <span className="block truncate">{option.label}</span>
        {option.sub !== undefined && <span className="block text-[0.68rem] font-normal tabular-nums opacity-80">{option.sub}</span>}
      </button>
    ))}
  </div>
);
