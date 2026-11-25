import type { Team } from "../types";

/**
 * Number formatting for float text. These labels are on screen for about a
 * second, so they favour being glanceable over being exact: "+$1.2M", "+340 users", "+3".
 */

/** A real minus sign: wider and better centred than a hyphen at float-text sizes. */
const MINUS = "\u2212";

const UNITS: ReadonlyArray<{ value: number; suffix: string }> = [
  { value: 1e12, suffix: "T" },
  { value: 1e9, suffix: "B" },
  { value: 1e6, suffix: "M" },
  { value: 1e3, suffix: "K" },
];

/** Below this, show every digit ("3,000"); from here up, abbreviate ("12K"). */
const ABBREVIATE_FROM = 10_000;

const withThousands = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * Magnitude only (the sign is dropped): 340 → "340", 3000 → "3,000",
 * 12_400 → "12.4K", 250_000 → "250K", 1_234_567 → "1.2M".
 */
export const formatCompact = (value: number): string => {
  const magnitude = Math.round(Math.abs(value));
  if (!Number.isFinite(magnitude)) return "0";
  if (magnitude < ABBREVIATE_FROM) return withThousands(magnitude);

  for (let i = UNITS.length - 1; i >= 0; i -= 1) {
    const unit = UNITS[i];
    const scaled = magnitude / unit.value;
    // One decimal while the mantissa is short ("1.2M"), none once it is long ("250M").
    const rounded = scaled < 100 ? Math.round(scaled * 10) / 10 : Math.round(scaled);
    // 999,950 rounds up to "1000K"; let the next unit express it as "1M" instead.
    if (rounded >= 1000 && i > 0) continue;
    return `${rounded}${unit.suffix}`;
  }
  return withThousands(magnitude);
};

const sign = (value: number): string => (value < 0 ? MINUS : "+");

/** "+$1.2M" / "−$3,000". */
export const formatMoneyDelta = (delta: number): string => `${sign(delta)}$${formatCompact(delta)}`;

/** "+340 users" / "−2 rep". */
export const formatCountDelta = (delta: number, noun: string): string => `${sign(delta)}${formatCompact(delta)} ${noun}`;

/** "+3" / "−1": a bare number of people, as it floats at the door. */
export const formatSignedCount = (delta: number): string => `${sign(delta)}${formatCompact(delta)}`;

/** The teams' names as a float text writes them. */
export const TEAM_LABEL: Record<Team, string> = {
  product: "Product",
  growth: "Growth",
  recruiting: "Recruiting",
};

/** "+1 Product" / "−2 Growth". */
export const formatHeadcountDelta = (delta: number, team: Team): string => formatCountDelta(delta, TEAM_LABEL[team]);
