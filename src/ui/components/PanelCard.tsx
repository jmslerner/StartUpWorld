import type { ReactNode } from "react";

interface PanelCardProps {
  title: string;
  children: ReactNode;
}

export const PanelCard = ({ title, children }: PanelCardProps) => (
  <section className="panel-surface rounded-xl p-3 text-xs text-mist">
    <h3 className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-neon/80">{title}</h3>
    <div className="space-y-1.5 text-xs text-slate-100/90">{children}</div>
  </section>
);
