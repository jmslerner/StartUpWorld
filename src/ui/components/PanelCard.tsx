import type { ReactNode } from "react";

interface PanelCardProps {
  title: string;
  children: ReactNode;
}

export const PanelCard = ({ title, children }: PanelCardProps) => (
  <section className="panel-surface rounded-xl p-4 text-sm text-mist">
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-neon/80">{title}</h3>
    <div className="space-y-2 text-sm text-slate-100/90">{children}</div>
  </section>
);
