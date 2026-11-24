// How numbers are written on screen. One place, so the resource bar, the planning panel and the
// quarterly report all agree.

const sign = (value: number): string => (value < 0 ? "-" : "");

/** $950, $420K, $1.23M, $37.5M, $250M; a minus goes before the dollar sign. */
export const money = (value: number): string => {
  const abs = Math.abs(value);
  if (abs < 1_000) return `${sign(value)}$${Math.round(abs)}`;
  if (abs < 999_500) return `${sign(value)}$${Math.round(abs / 1_000)}K`;
  if (abs < 9_995_000) return `${sign(value)}$${(Math.round(abs / 10_000) / 100).toFixed(2)}M`;
  if (abs < 99_950_000) return `${sign(value)}$${(Math.round(abs / 100_000) / 10).toFixed(1)}M`;
  return `${sign(value)}$${Math.round(abs / 1_000_000)}M`;
};

/** Users and people: 9,950 in full, then 12.4K, 250K, 1.16M. */
export const count = (value: number): string => {
  const abs = Math.abs(value);
  if (abs < 10_000) return `${sign(value)}${Math.round(abs).toLocaleString("en-US")}`;
  if (abs < 99_950) return `${sign(value)}${String(Math.round(abs / 100) / 10)}K`;
  if (abs < 999_500) return `${sign(value)}${Math.round(abs / 1_000)}K`;
  return `${sign(value)}${(Math.round(abs / 10_000) / 100).toFixed(2)}M`;
};

/** A change: always with its direction. */
export const signed = (value: number, format: (value: number) => string): string => (value > 0 ? `+${format(value)}` : format(value));

/** A share between 0 and 1 as a percentage. */
export const percent = (share: number, digits = 0): string => `${(share * 100).toFixed(digits)}%`;

export const quarter = (turn: number): string => `Q${turn}`;

/** Runway in turns; null means the last quarter was profitable. */
export const runwayText = (runway: number | null): string => {
  if (runway === null) return "profitable";
  if (runway <= 0) return "0 turns";
  if (runway > 40) return "40+ turns";
  const text = runway.toFixed(1);
  return `${text} ${text === "1.0" ? "turn" : "turns"}`;
};
