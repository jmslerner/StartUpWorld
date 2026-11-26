import { describe, expect, it } from "vitest";
import type { MarketScreenMarks } from "../world/types/handle";
import type { MarketCompany } from "../world/types/market";
import { count } from "./format";
import {
  barLabelText,
  companyLabelText,
  LABEL_MAX_WIDTH,
  placeMarketLabels,
  type LabelRect,
  type MarketLabelInput,
  type PlacedLabel,
} from "./marketLabels";

const company = (seat: number, name: string, users: number, state: MarketCompany["state"] = seat === 0 ? "player" : "rival"): MarketCompany => ({
  seat,
  name,
  state,
  users,
  height: 0.5,
  won: 0.25,
  listed: false,
  newcomer: false,
});

const COMPANIES: readonly MarketCompany[] = [
  company(0, "Check Co", 12_400),
  company(1, "Snerkster", 2_300_000),
  company(2, "Zorbtastic", 480_000),
  company(3, "Quillmoth", 61_000),
];

/**
 * The market as the world draws it at the three desktop sizes, read off the browser (office fixture, 1991, the
 * default shot; MARKS=1 node scripts/office-check.mjs --only 15 prints them): the canvas's size, each building's top
 * and the bar's ends. The page keeps the canvas 639 px wide; it grows in height. Four buildings in a row, about 100
 * px apart: the labels must make room for each other.
 */
const SIZES = {
  1280: {
    cell: { width: 639, height: 518 },
    tops: [
      [174, 221],
      [271, 242],
      [368, 255],
      [465, 362],
    ],
    bar: { left: [116, 112], right: [523, 281], top: [174, 79] },
  },
  1440: {
    cell: { width: 639, height: 618 },
    tops: [
      [151, 265],
      [263, 290],
      [376, 304],
      [488, 428],
    ],
    bar: { left: [85, 140], right: [554, 334], top: [151, 101] },
  },
  1920: {
    cell: { width: 639, height: 798 },
    tops: [
      [151, 355],
      [263, 380],
      [376, 394],
      [488, 518],
    ],
    bar: { left: [85, 230], right: [554, 424], top: [151, 191] },
  },
} as const;

type Input = MarketLabelInput & { readonly marks: MarketScreenMarks };

const inputAt = (size: keyof typeof SIZES, avoid: readonly LabelRect[] = [], companies = COMPANIES): Input => {
  const at = SIZES[size];
  return {
    companies,
    barUsers: 330_000,
    marks: {
      lots: companies.map((c, index) => ({ seat: c.seat, top: { x: at.tops[index][0], y: at.tops[index][1] } })),
      bar: {
        left: { x: at.bar.left[0], y: at.bar.left[1] },
        right: { x: at.bar.right[0], y: at.bar.right[1] },
        top: { x: at.bar.top[0], y: at.bar.top[1] },
      },
    },
    cell: at.cell,
    avoid,
  };
};

const rectOf = (label: PlacedLabel): LabelRect => ({ left: label.left, top: label.top, right: label.left + label.width, bottom: label.top + label.height });
const overlaps = (a: LabelRect, b: LabelRect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const expectTidy = (labels: readonly PlacedLabel[], cell: { width: number; height: number }, avoid: readonly LabelRect[] = []): void => {
  for (const label of labels) {
    const rect = rectOf(label);
    expect(rect.left, `${label.key} leaves the cell on the left`).toBeGreaterThanOrEqual(0);
    expect(rect.top, `${label.key} leaves the cell at the top`).toBeGreaterThanOrEqual(0);
    expect(rect.right, `${label.key} leaves the cell on the right`).toBeLessThanOrEqual(cell.width);
    expect(rect.bottom, `${label.key} leaves the cell at the bottom`).toBeLessThanOrEqual(cell.height);
    for (const other of labels) {
      if (other !== label) expect(overlaps(rect, rectOf(other)), `${label.key} overlaps ${other.key}`).toBe(false);
    }
    for (const covered of avoid) expect(overlaps(rect, covered), `${label.key} is under a card`).toBe(false);
  }
};

describe("the labels' words", () => {
  it("a company's label says its name and its users in short; the player's says You", () => {
    expect(companyLabelText(company(1, "Snerkster", 2_300_000))).toEqual({ you: false, name: "Snerkster", users: `${count(2_300_000)} users` });
    expect(companyLabelText(company(0, "Check Co", 12_400))).toEqual({ you: true, name: "Check Co", users: `${count(12_400)} users` });
    expect(companyLabelText(company(2, "One", 1))).toEqual({ you: false, name: "One", users: "1 user" });
  });

  it("a name too long for a label is cut with an ellipsis, never wider than the label", () => {
    const text = companyLabelText(company(1, "A Very Long Company Name Indeed Of Many Words", 10));
    expect(text.name.endsWith("…")).toBe(true);
    expect(text.name.length).toBeLessThan(30);
  });

  it("the bar's label says the bar to go public as the rivals' panel does", () => {
    expect(barLabelText(330_000)).toBe(`Bar to go public: ${count(330_000)} users`);
  });

  it("never says a period word of the race", () => {
    const all = [barLabelText(5), ...COMPANIES.map((c) => Object.values(companyLabelText(c)).join(" "))].join(" ");
    expect(all).not.toMatch(/\b(quarters?|quarterly|turns?)\b|\bQ\d/i);
  });
});

describe("where the labels stand", () => {
  for (const size of [1280, 1440, 1920] as const) {
    it(`at ${size}, one label over each building and one on the bar, none overlapping, none leaving the cell`, () => {
      const labels = placeMarketLabels(inputAt(size));
      expect(labels.map((label) => label.key)).toEqual(["company:0", "company:1", "company:2", "company:3", "bar"]);
      expectTidy(labels, SIZES[size].cell);
      // Each company's label stands above its building, roughly centred on it.
      for (const label of labels.filter((each) => each.kind === "company")) {
        const index = COMPANIES.findIndex((c) => c.seat === label.seat);
        const [x, y] = SIZES[size].tops[index];
        expect(label.top + label.height).toBeLessThanOrEqual(y);
        expect(Math.abs(label.left + label.width / 2 - x)).toBeLessThanOrEqual(label.width);
      }
    });
  }

  it("the bar's label stands outside the bar's rings: wholly left of its left end, right of its right end, or above its top", () => {
    for (const size of [1280, 1440, 1920] as const) {
      const input = inputAt(size);
      const bar = placeMarketLabels(input).find((label) => label.kind === "bar");
      expect(bar, `at ${size} the bar has no label`).toBeDefined();
      if (!bar || !input.marks.bar) continue;
      const { left, right, top } = input.marks.bar;
      const clear = bar.left + bar.width <= left.x || bar.left >= right.x || bar.top + bar.height <= top.y;
      expect(clear, `at ${size} the bar's label ${JSON.stringify(bar)} sits on the rings`).toBe(true);
    }
  });

  it("the player's label is the one marked You", () => {
    const labels = placeMarketLabels(inputAt(1280));
    expect(labels.filter((label) => label.you).map((label) => label.seat)).toEqual([0]);
  });

  it("a label that a company's card would cover is hidden, the others stay where they are", () => {
    const open = placeMarketLabels(inputAt(1280));
    // The card over the right of the cell, as CareerOffice draws it (top right, 16rem wide).
    const card: LabelRect = { left: 638 - 8 - 256, top: 8, right: 638 - 8, bottom: 8 + 470 };
    const covered = placeMarketLabels(inputAt(1280, [card]));
    expectTidy(covered, SIZES[1280].cell, [card]);
    expect(covered.length).toBeLessThan(open.length);
    for (const label of covered) {
      const before = open.find((each) => each.key === label.key);
      expect(before).toBeDefined();
      if (before && !overlaps(rectOf(before), card)) expect([label.left, label.top]).toEqual([before.left, before.top]);
    }
  });

  it("the view switch in the top left is never covered", () => {
    const switchRect: LabelRect = { left: 8, top: 8, right: 136, bottom: 42 };
    for (const size of [1280, 1440, 1920] as const) expectTidy(placeMarketLabels(inputAt(size, [switchRect])), SIZES[size].cell, [switchRect]);
  });

  it("buildings bunched together: the labels make room, stacked, and still never overlap", () => {
    const input = inputAt(1280);
    const bunched: MarketLabelInput = {
      ...input,
      marks: { ...input.marks, lots: input.marks.lots.map((lot, index) => ({ seat: lot.seat, top: { x: 300 + index * 30, y: 300 } })) },
    };
    const labels = placeMarketLabels(bunched);
    expectTidy(labels, input.cell);
    expect(labels.some((label) => label.you)).toBe(true);
  });

  it("a building drawn off the canvas has no label; a company that is out has none", () => {
    const input = inputAt(1280, [], [COMPANIES[0], COMPANIES[1], COMPANIES[2], company(3, "Gone", 0, "out")]);
    const off: MarketLabelInput = {
      ...input,
      marks: { ...input.marks, lots: input.marks.lots.map((lot) => (lot.seat === 1 ? { seat: 1, top: { x: -40, y: 200 } } : lot)) },
    };
    expect(placeMarketLabels(off).map((label) => label.key)).toEqual(["company:0", "company:2", "bar"]);
  });

  it("no marks (the market not drawn): no labels", () => {
    expect(placeMarketLabels({ ...inputAt(1280), marks: null })).toEqual([]);
  });

  it("random rows of buildings in cells of desktop sizes never give overlapping labels or labels out of the cell", () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let run = 0; run < 300; run++) {
      const width = 500 + Math.floor(random() * 600);
      const height = 400 + Math.floor(random() * 400);
      const base = inputAt(1280);
      const step = 40 + random() * 140;
      const start = random() * (width - 3 * step);
      const input: MarketLabelInput = {
        ...base,
        cell: { width, height },
        marks: {
          lots: base.marks.lots.map((lot, index) => ({ seat: lot.seat, top: { x: start + index * step, y: random() * height } })),
          bar: {
            left: { x: random() * width, y: random() * height },
            right: { x: random() * width, y: random() * height },
            top: { x: random() * width, y: random() * height },
          },
        },
        avoid: random() < 0.5 ? [] : [{ left: width - 264, top: 8, right: width - 8, bottom: 8 + random() * 400 }],
      };
      expectTidy(placeMarketLabels(input), input.cell, input.avoid);
    }
  });

  it("no label is wider than the cap", () => {
    for (const label of placeMarketLabels(inputAt(1920))) expect(label.width).toBeLessThanOrEqual(label.kind === "bar" ? 260 : LABEL_MAX_WIDTH);
  });
});
