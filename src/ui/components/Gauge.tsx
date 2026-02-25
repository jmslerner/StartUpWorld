interface GaugeProps {
  label: string;
  value: number;
  max?: number;
  color?: "neon" | "ember" | "red" | "green";
  showValue?: boolean;
  description?: string;
}

const colorMap = {
  neon: { bar: "bg-neon/70", track: "bg-neon/10" },
  ember: { bar: "bg-amber-400/70", track: "bg-amber-400/10" },
  red: { bar: "bg-red-400/70", track: "bg-red-400/10" },
  green: { bar: "bg-emerald-400/70", track: "bg-emerald-400/10" },
};

export const Gauge = ({ label, value, max = 100, color = "neon", showValue = true, description }: GaugeProps) => {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const c = colorMap[color];

  return (
    <div className="flex items-center gap-2">
      <span className="w-[4.5rem] shrink-0 text-mist/80" title={description}>
        {label}
      </span>
      <div className={`h-1.5 flex-1 rounded-full ${c.track}`}>
        <div
          className={`h-full rounded-full transition-all duration-300 ${c.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showValue && <span className="w-7 text-right tabular-nums">{value}</span>}
    </div>
  );
};

interface DeltaProps {
  current: number;
  previous: number;
  format?: (v: number) => string;
}

export const Delta = ({ current, previous, format }: DeltaProps) => {
  const diff = current - previous;
  if (diff === 0) return null;

  const arrow = diff > 0 ? "\u25B2" : "\u25BC";
  const color = diff > 0 ? "text-emerald-400" : "text-red-400";
  const display = format ? format(Math.abs(diff)) : Math.abs(diff).toLocaleString();

  return (
    <span className={`ml-1 text-[0.6rem] ${color}`}>
      {arrow}{display}
    </span>
  );
};
