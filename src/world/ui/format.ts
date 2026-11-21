/**
 * Number formatting for the world's HTML overlay.
 *
 * Money follows the compact style of the HUD bar's valuation read-out
 * (K / M / B / T suffixes), minus trailing zeros: on a button a price reads
 * better as "$3K" than "$3.0K", and "$2M" better than "$2.00M".
 */

const UNITS: ReadonlyArray<{ value: number; suffix: string; decimals: number }> = [
  { value: 1e3, suffix: "K", decimals: 1 },
  { value: 1e6, suffix: "M", decimals: 2 },
  { value: 1e9, suffix: "B", decimals: 2 },
  { value: 1e12, suffix: "T", decimals: 2 },
];

/** 3 → "3", 3.5 → "3.5", 1.25 → "1.25": a fixed number of decimals without the padding. */
const trimmed = (value: number, decimals: number): string => String(Number(value.toFixed(decimals)));

/** Grouped integer, locale-independent so the UI and the tests agree: 12500 → "12,500". */
export const formatCount = (value: number): string =>
  Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "0";

/** 950 → "$950", 3000 → "$3K", 17_800 → "$17.8K", 2_000_000 → "$2M", −4200 → "-$4.2K". */
export const formatUsd = (value: number): string => {
  if (!Number.isFinite(value)) return "$0";
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  if (magnitude < 1000) return `${sign}$${formatCount(magnitude)}`;

  let index = 0;
  while (index < UNITS.length - 1 && magnitude >= UNITS[index + 1].value) index += 1;
  // 999,950 would print as "1000K"; let the next unit say "$1M" instead.
  const rounded = Number((magnitude / UNITS[index].value).toFixed(UNITS[index].decimals));
  if (rounded >= 1000 && index < UNITS.length - 1) index += 1;

  const unit = UNITS[index];
  return `${sign}$${trimmed(magnitude / unit.value, unit.decimals)}${unit.suffix}`;
};

/** "+$1.2K" / "-$300" / "+$0". */
export const formatUsdDelta = (delta: number): string => (delta < 0 ? formatUsd(delta) : `+${formatUsd(delta)}`);

/** "+120" / "-45" / "+0". */
export const formatCountDelta = (delta: number): string =>
  delta < 0 ? formatCount(delta) : `+${formatCount(delta)}`;

/** "sales-animal" → "Sales Animal", "series-a" → "Series A", "garage" → "Garage". */
export const titleCase = (token: string): string =>
  token
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
