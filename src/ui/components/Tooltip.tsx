import type { ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  widthClassName?: string;
}

export const Tooltip = ({ content, children, align = "left", widthClassName = "w-72" }: TooltipProps) => {
  const alignClass = align === "right" ? "right-0" : "left-0";

  return (
    <span className="group relative inline-flex">
      {children}
      <span
        className={
          "pointer-events-none absolute z-50 " +
          alignClass +
          " bottom-full mb-2 " +
          widthClassName +
          " translate-y-1 opacity-0 transition duration-150 ease-out " +
          "group-hover:translate-y-0 group-hover:opacity-100 " +
          "group-focus-within:translate-y-0 group-focus-within:opacity-100"
        }
        role="tooltip"
      >
        <span className="panel-surface block rounded-xl px-3 py-2 text-xs leading-relaxed text-slate-100/90">
          {content}
        </span>
      </span>
    </span>
  );
};
