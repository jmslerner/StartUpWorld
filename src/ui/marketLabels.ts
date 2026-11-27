/**
 * The labels over the market's buildings, as plain values: what each says and where it stands on the canvas. Pure;
 * CareerOffice draws them in HTML over the world, from the screen points the world reports (WorldHandle.marketMarks).
 *
 * Each company still in the market has a label over its building (its name and its users, in short; the player's
 * marked "You"), and the bar for going public has one at its left end. A label has the exact size this module gives
 * it (the font is monospaced, so its width follows its characters), so the rules hold for what is drawn: labels never
 * overlap each other, never leave the cell, and never sit under what covers the canvas (a company's card, the view
 * switch). A label that cannot stand clear of all of them is not shown.
 */

import type { MarketScreenMarks, ScreenRect } from "../world/types/handle";
import type { MarketCompany } from "../world/types/market";
import { count } from "./format";

export type LabelRect = ScreenRect;

export const LABEL_WORDS: { readonly you: "You" } = { you: "You" };

export interface CompanyLabelText {
  /** The player's own company. */
  readonly you: boolean;
  readonly name: string;
  readonly users: string;
}

export interface PlacedLabel {
  readonly key: string;
  readonly kind: "company" | "bar";
  /** The company's seat; null for the bar. */
  readonly seat: number | null;
  readonly you: boolean;
  /** One or two lines: a company's name and users, or the bar's one line. */
  readonly lines: readonly string[];
  /** CSS pixels from the canvas's top-left corner, and the label's exact size. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface MarketLabelInput {
  readonly companies: readonly MarketCompany[];
  readonly barUsers: number;
  /** Where the world draws each building's top and the bar's ends; null while the market is not drawn. */
  readonly marks: MarketScreenMarks | null;
  /** The canvas's CSS size. */
  readonly cell: { readonly width: number; readonly height: number };
  /** What covers the canvas, in the same pixels: a label is never under any of these. */
  readonly avoid: readonly LabelRect[];
}

/** The labels' type: 11 px monospaced, so a character is 0.6 em wide. */
export const LABEL_FONT_PX = 11;
export const LABEL_CHAR_PX = LABEL_FONT_PX * 0.6;
export const LABEL_LINE_PX = 14;
export const LABEL_PAD_X = 6;
export const LABEL_PAD_Y = 3;
/** The width of the "You" badge before the player's name, its gap included. */
export const LABEL_YOU_PX = 30;
/** A company's label is never wider than this; a longer name is cut. */
export const LABEL_MAX_WIDTH = 120;
/** Space kept between a label and its building, another label or the edge of the cell. */
const GAP = 4;
const EDGE = 2;
/** The 1 px border on each side. */
const BORDER = 1;

const widthOf = (chars: number, extra = 0): number => Math.ceil(chars * LABEL_CHAR_PX + extra + 2 * (LABEL_PAD_X + BORDER));
const heightOf = (lines: number): number => lines * LABEL_LINE_PX + 2 * (LABEL_PAD_Y + BORDER);

/** Characters of a name that fit a company's label, the "You" badge taken off the player's. */
const nameRoom = (you: boolean): number => Math.floor((LABEL_MAX_WIDTH - 2 * (LABEL_PAD_X + BORDER) - (you ? LABEL_YOU_PX : 0)) / LABEL_CHAR_PX);

/** What a company's label says. */
export const companyLabelText = (company: MarketCompany): CompanyLabelText => {
  const you = company.state === "player";
  const room = nameRoom(you);
  const name = company.name.length > room ? `${company.name.slice(0, room - 1).trimEnd()}…` : company.name;
  return { you, name, users: `${count(company.users)} ${company.users === 1 ? "user" : "users"}` };
};

/** What the bar's label says, in the words of the rivals' panel. */
export const barLabelText = (barUsers: number): string => `Bar to go public: ${count(barUsers)} users`;

const overlaps = (a: LabelRect, b: LabelRect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const grown = (r: LabelRect, by: number): LabelRect => ({ left: r.left - by, top: r.top - by, right: r.right + by, bottom: r.bottom + by });

interface Try {
  readonly left: number;
  readonly top: number;
  readonly slide: "none" | "across" | "both";
}

interface Wanted {
  readonly key: string;
  readonly kind: "company" | "bar";
  readonly seat: number | null;
  readonly you: boolean;
  readonly lines: readonly string[];
  readonly width: number;
  readonly height: number;
  /** Top-left corners to try, best first, and whether each may slide to stay inside the cell: across, or either way. */
  readonly tries: readonly Try[];
}

const onCanvas = (x: number, y: number, cell: MarketLabelInput["cell"]): boolean => x >= 0 && x <= cell.width && y >= 0 && y <= cell.height;

/**
 * Where each label stands: the player's first, then the rivals' by seat, then the bar's, each at the first of its
 * tries that is inside the cell and clear of what covers the canvas and of the labels already placed. A company's
 * label tries above its building, centred, then one and two labels higher, then pushed left or right; the bar's
 * tries outside its rings (left of its left end, right of its right end, above its highest corner), then pressed
 * into the cell beside or below its ends.
 */
export const placeMarketLabels = (input: MarketLabelInput): PlacedLabel[] => {
  const { marks, cell } = input;
  if (marks === null) return [];
  const wanted: Wanted[] = [];
  const companies = [...input.companies].sort((a, b) => Number(b.state === "player") - Number(a.state === "player") || a.seat - b.seat);
  for (const company of companies) {
    if (company.state === "out") continue;
    const top = marks.lots.find((lot) => lot.seat === company.seat)?.top;
    if (top === undefined || !onCanvas(top.x, top.y, cell)) continue;
    const text = companyLabelText(company);
    const width = Math.min(LABEL_MAX_WIDTH, Math.max(widthOf(text.name.length, text.you ? LABEL_YOU_PX : 0), widthOf(text.users.length)));
    const height = heightOf(2);
    const left = top.x - width / 2;
    const above = top.y - GAP - height;
    const tries = [0, 1, 2].flatMap((up) => {
      const y = above - up * (height + GAP);
      return [
        { left, top: y, slide: "both" as const },
        { left: left - width / 2 - GAP, top: y, slide: "both" as const },
        { left: left + width / 2 + GAP, top: y, slide: "both" as const },
      ];
    });
    wanted.push({ key: `company:${company.seat}`, kind: "company", seat: company.seat, you: text.you, lines: [text.name, text.users], width, height, tries });
  }
  if (marks.bar !== null) {
    const line = barLabelText(input.barUsers);
    const width = widthOf(line.length);
    const height = heightOf(1);
    const { left: l, right: r, top: t } = marks.bar;
    const besideLeft = { left: l.x - GAP - width, top: l.y - height / 2 };
    const besideRight = { left: r.x + GAP, top: r.y - height / 2 };
    // Outside the rings first (wholly left of the left end, right of the right end, above the top), then pressed in.
    const tries: Try[] = [
      { ...besideLeft, slide: "none" },
      { ...besideRight, slide: "none" },
      { left: t.x - width / 2, top: t.y - GAP - height, slide: "across" },
      { ...besideLeft, slide: "both" },
      { ...besideRight, slide: "both" },
      { left: l.x, top: l.y + GAP, slide: "both" },
      { left: r.x - width, top: r.y + GAP, slide: "both" },
    ];
    if (!onCanvas(l.x, l.y, cell) && !onCanvas(r.x, r.y, cell)) tries.length = 0;
    wanted.push({ key: "bar", kind: "bar", seat: null, you: false, lines: [line], width, height, tries });
  }

  const placed: PlacedLabel[] = [];
  const taken: LabelRect[] = input.avoid.map((rect) => grown(rect, GAP));
  for (const want of wanted) {
    if (want.width > cell.width - 2 * EDGE || want.height > cell.height - 2 * EDGE) continue;
    for (const at of want.tries) {
      // Kept inside the cell: a label near an edge slides in rather than leaving it.
      const left = Math.round(Math.min(Math.max(at.left, EDGE), cell.width - EDGE - want.width));
      const top = Math.round(Math.min(Math.max(at.top, EDGE), cell.height - EDGE - want.height));
      if (at.slide !== "both" && Math.abs(top - at.top) > 1) continue;
      if (at.slide === "none" && Math.abs(left - at.left) > 1) continue;
      const rect: LabelRect = { left, top, right: left + want.width, bottom: top + want.height };
      if (taken.some((other) => overlaps(rect, other))) continue;
      placed.push({ key: want.key, kind: want.kind, seat: want.seat, you: want.you, lines: want.lines, left, top, width: want.width, height: want.height });
      taken.push(grown(rect, GAP / 2));
      break;
    }
  }
  // In seat order, the bar last, whatever order they were placed in.
  const order = (label: PlacedLabel): number => (label.seat === null ? Infinity : label.seat);
  return placed.sort((a, b) => order(a) - order(b));
};
