import type { BubbleIcon } from "../types";

/**
 * Speech-bubble artwork, drawn with canvas paths only.
 *
 * No text or emoji glyphs are used anywhere — fonts differ per platform and an
 * emoji that looks friendly on one OS looks out of place on another. Every
 * pictogram here is a handful of strokes, so it is identical everywhere.
 *
 * Pictograms are drawn in a unit box: x and y run from −0.5 to 0.5 with +y
 * pointing down, and stroke widths are fractions of the box.
 */

type Ctx = CanvasRenderingContext2D;

const INK = "#0f172a";
const PAPER = "#f8fafc";

/** Canvas size of one bubble texture. Shown at ≤ 52 CSS px, so this is crisp at 2× DPR. */
export const BUBBLE_TEXTURE_WIDTH = 128;
export const BUBBLE_TEXTURE_HEIGHT = 144;
/** Where the tip of the tail sits, as a fraction of the texture height measured from the bottom. */
export const BUBBLE_TAIL_ANCHOR = 8 / BUBBLE_TEXTURE_HEIGHT;

const BODY = { left: 9, top: 8, right: 119, bottom: 112, radius: 30 };
const TAIL = { halfWidth: 12, tipY: 136 };
const ICON_CENTER = { x: 64, y: 60 };
const ICON_SIZE = 66;

const line = (ctx: Ctx, color: string, width: number, points: ReadonlyArray<readonly [number, number]>): void => {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
};

const disc = (ctx: Ctx, x: number, y: number, radius: number, fill: string, stroke?: string, width = 0.06): void => {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
};

const polygon = (
  ctx: Ctx,
  points: ReadonlyArray<readonly [number, number]>,
  fill: string,
  stroke?: string,
  width = 0.06
): void => {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
};

const roundedRect = (ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const PICTOGRAMS: Record<BubbleIcon, (ctx: Ctx) => void> = {
  // </>
  code: (ctx) => {
    line(ctx, INK, 0.12, [
      [-0.19, -0.25],
      [-0.43, 0],
      [-0.19, 0.25],
    ]);
    line(ctx, INK, 0.12, [
      [0.19, -0.25],
      [0.43, 0],
      [0.19, 0.25],
    ]);
    line(ctx, "#0284c7", 0.12, [
      [0.08, -0.34],
      [-0.08, 0.34],
    ]);
  },

  // Light bulb with three rays.
  idea: (ctx) => {
    for (const angle of [-150, -90, -30]) {
      const a = (angle * Math.PI) / 180;
      const cx = 0;
      const cy = -0.06;
      line(ctx, "#f59e0b", 0.075, [
        [cx + Math.cos(a) * 0.33, cy + Math.sin(a) * 0.33],
        [cx + Math.cos(a) * 0.43, cy + Math.sin(a) * 0.43],
      ]);
    }
    roundedRect(ctx, -0.11, 0.14, 0.22, 0.24, 0.05);
    ctx.fillStyle = "#94a3b8";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.06;
    ctx.stroke();
    disc(ctx, 0, -0.06, 0.24, "#fbbf24", INK, 0.06);
    line(ctx, INK, 0.045, [
      [-0.11, 0.27],
      [0.11, 0.27],
    ]);
  },

  // Mug with a handle and two curls of steam.
  coffee: (ctx) => {
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 0.07;
    for (const x of [-0.18, 0.02]) {
      ctx.beginPath();
      ctx.moveTo(x, -0.16);
      ctx.bezierCurveTo(x - 0.1, -0.24, x + 0.1, -0.34, x, -0.44);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0.17, 0.15, 0.13, -Math.PI / 2, Math.PI / 2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.08;
    ctx.stroke();
    roundedRect(ctx, -0.32, -0.06, 0.5, 0.44, 0.09);
    ctx.fillStyle = "#b45309";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.06;
    ctx.stroke();
    line(ctx, "#fde68a", 0.05, [
      [-0.22, 0.04],
      [0.08, 0.04],
    ]);
  },

  // Gold coin with a dollar mark.
  money: (ctx) => {
    disc(ctx, 0, 0, 0.41, "#fbbf24", "#b45309", 0.07);
    ctx.beginPath();
    ctx.moveTo(0.15, -0.13);
    ctx.bezierCurveTo(0.08, -0.27, -0.2, -0.25, -0.16, -0.08);
    ctx.bezierCurveTo(-0.12, 0.06, 0.17, -0.02, 0.17, 0.12);
    ctx.bezierCurveTo(0.17, 0.27, -0.1, 0.27, -0.17, 0.14);
    ctx.strokeStyle = "#78350f";
    ctx.lineWidth = 0.085;
    ctx.stroke();
    line(ctx, "#78350f", 0.07, [
      [0, -0.3],
      [0, 0.3],
    ]);
  },

  heart: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(0, 0.4);
    ctx.bezierCurveTo(-0.14, 0.26, -0.44, 0.08, -0.44, -0.14);
    ctx.bezierCurveTo(-0.44, -0.38, -0.12, -0.44, 0, -0.22);
    ctx.bezierCurveTo(0.12, -0.44, 0.44, -0.38, 0.44, -0.14);
    ctx.bezierCurveTo(0.44, 0.08, 0.14, 0.26, 0, 0.4);
    ctx.closePath();
    ctx.fillStyle = "#f43f5e";
    ctx.fill();
    ctx.strokeStyle = "#9f1239";
    ctx.lineWidth = 0.055;
    ctx.stroke();
    // A glint, so it reads as a shape rather than a red blob at small sizes.
    line(ctx, "#fecdd3", 0.06, [
      [-0.27, -0.2],
      [-0.2, -0.26],
    ]);
  },

  // Storm cloud with a lightning bolt.
  stress: (ctx) => {
    polygon(
      ctx,
      [
        [0.06, 0.02],
        [-0.14, 0.26],
        [-0.01, 0.26],
        [-0.1, 0.48],
        [0.2, 0.18],
        [0.06, 0.18],
        [0.16, 0.02],
      ],
      "#f59e0b",
      "#b45309",
      0.045
    );
    ctx.beginPath();
    ctx.arc(-0.2, -0.1, 0.17, Math.PI * 0.5, Math.PI * 1.5);
    ctx.arc(-0.04, -0.24, 0.2, Math.PI * 1.1, Math.PI * 1.9);
    ctx.arc(0.2, -0.12, 0.18, Math.PI * 1.4, Math.PI * 0.5);
    ctx.closePath();
    ctx.fillStyle = "#475569";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.06;
    ctx.stroke();
  },

  // Three Zs drifting up and away.
  zzz: (ctx) => {
    const z = (x: number, y: number, size: number, width: number): void => {
      line(ctx, "#4f46e5", width, [
        [x - size / 2, y - size / 2],
        [x + size / 2, y - size / 2],
        [x - size / 2, y + size / 2],
        [x + size / 2, y + size / 2],
      ]);
    };
    z(-0.2, 0.2, 0.34, 0.1);
    z(0.14, -0.08, 0.24, 0.085);
    z(0.34, -0.34, 0.15, 0.07);
  },

  exclaim: (ctx) => {
    line(ctx, "#ea580c", 0.19, [
      [0, -0.36],
      [0, 0.06],
    ]);
    disc(ctx, 0, 0.35, 0.105, "#ea580c");
  },

  question: (ctx) => {
    ctx.beginPath();
    ctx.arc(0, -0.17, 0.2, Math.PI, Math.PI * 0.32);
    ctx.quadraticCurveTo(0, 0.02, 0, 0.13);
    ctx.strokeStyle = "#7c3aed";
    ctx.lineWidth = 0.14;
    ctx.stroke();
    disc(ctx, 0, 0.36, 0.095, "#7c3aed");
  },

  megaphone: (ctx) => {
    ctx.strokeStyle = "#ea580c";
    ctx.lineWidth = 0.065;
    for (const radius of [0.13, 0.26]) {
      ctx.beginPath();
      ctx.arc(0.16, -0.03, radius, -0.75, 0.75);
      ctx.stroke();
    }
    polygon(
      ctx,
      [
        [-0.26, 0.04],
        [-0.12, 0.04],
        [-0.08, 0.34],
        [-0.22, 0.34],
      ],
      "#94a3b8",
      INK,
      0.055
    );
    polygon(
      ctx,
      [
        [-0.42, -0.13],
        [0.1, -0.38],
        [0.1, 0.32],
        [-0.42, 0.07],
      ],
      "#fb923c",
      INK,
      0.06
    );
  },

  bug: (ctx) => {
    const legs: ReadonlyArray<readonly [number, number, number, number]> = [
      [0.17, -0.06, 0.4, -0.18],
      [0.2, 0.08, 0.43, 0.08],
      [0.17, 0.22, 0.38, 0.36],
    ];
    for (const [x1, y1, x2, y2] of legs) {
      line(ctx, INK, 0.06, [
        [x1, y1],
        [x2, y2],
      ]);
      line(ctx, INK, 0.06, [
        [-x1, y1],
        [-x2, y2],
      ]);
    }
    line(ctx, INK, 0.05, [
      [-0.05, -0.32],
      [-0.17, -0.47],
    ]);
    line(ctx, INK, 0.05, [
      [0.05, -0.32],
      [0.17, -0.47],
    ]);
    disc(ctx, 0, -0.24, 0.13, INK);
    ctx.beginPath();
    ctx.ellipse(0, 0.09, 0.22, 0.29, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#dc2626";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.06;
    ctx.stroke();
    line(ctx, INK, 0.045, [
      [0, -0.18],
      [0, 0.37],
    ]);
    disc(ctx, -0.1, 0.02, 0.045, INK);
    disc(ctx, 0.1, 0.02, 0.045, INK);
    disc(ctx, -0.1, 0.2, 0.04, INK);
    disc(ctx, 0.1, 0.2, 0.04, INK);
  },

  rocket: (ctx) => {
    ctx.rotate(Math.PI / 4.5);
    polygon(
      ctx,
      [
        [-0.09, 0.2],
        [0, 0.47],
        [0.09, 0.2],
      ],
      "#f59e0b",
      "#b45309",
      0.04
    );
    for (const side of [-1, 1]) {
      polygon(
        ctx,
        [
          [side * 0.15, 0],
          [side * 0.33, 0.27],
          [side * 0.15, 0.2],
        ],
        "#ef4444",
        INK,
        0.055
      );
    }
    ctx.beginPath();
    ctx.moveTo(0, -0.48);
    ctx.bezierCurveTo(0.14, -0.34, 0.18, -0.14, 0.17, 0.22);
    ctx.lineTo(-0.17, 0.22);
    ctx.bezierCurveTo(-0.18, -0.14, -0.14, -0.34, 0, -0.48);
    ctx.closePath();
    ctx.fillStyle = "#e2e8f0";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.06;
    ctx.stroke();
    disc(ctx, 0, -0.12, 0.085, "#38bdf8", INK, 0.05);
  },

  // Rising bars under a trend arrow.
  chart: (ctx) => {
    const bars: ReadonlyArray<readonly [number, number]> = [
      [-0.38, 0.2],
      [-0.1, 0.38],
      [0.18, 0.6],
    ];
    for (const [x, height] of bars) {
      roundedRect(ctx, x, 0.36 - height, 0.2, height, 0.03);
      ctx.fillStyle = "#22c55e";
      ctx.fill();
      ctx.strokeStyle = "#166534";
      ctx.lineWidth = 0.045;
      ctx.stroke();
    }
    line(ctx, INK, 0.07, [
      [-0.44, 0.39],
      [0.44, 0.39],
    ]);
    line(ctx, INK, 0.07, [
      [-0.42, -0.02],
      [-0.11, -0.25],
    ]);
    polygon(
      ctx,
      [
        [0.03, -0.36],
        [-0.17, -0.33],
        [-0.05, -0.17],
      ],
      INK
    );
  },

  // Handset: two pads joined by a curved grip.
  phone: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(-0.27, -0.27);
    ctx.quadraticCurveTo(-0.3, 0.3, 0.27, 0.27);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.21;
    ctx.stroke();
    ctx.strokeStyle = "#16a34a";
    ctx.lineWidth = 0.11;
    ctx.stroke();
    for (const [x, y, angle] of [
      [-0.26, -0.28, -0.3],
      [0.28, 0.26, 1.27],
    ] as const) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      roundedRect(ctx, -0.17, -0.11, 0.34, 0.22, 0.08);
      ctx.fillStyle = "#16a34a";
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.055;
      ctx.stroke();
      ctx.restore();
    }
  },

  // Open hand with motion marks.
  wave: (ctx) => {
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 0.06;
    for (const radius of [0.5, 0.62]) {
      ctx.beginPath();
      ctx.arc(-0.04, 0.1, radius, -0.95, -0.45);
      ctx.stroke();
    }
    ctx.rotate(-0.2);
    const fingers: ReadonlyArray<readonly [number, number, number, number]> = [
      [-0.2, 0.2, -0.4, 0.0],
      [-0.15, 0.02, -0.17, -0.3],
      [-0.05, 0.0, -0.05, -0.4],
      [0.05, 0.0, 0.06, -0.37],
      [0.15, 0.04, 0.18, -0.26],
    ];
    // Ink first, skin on top: outlined fingers without having to trace each one.
    roundedRect(ctx, -0.2, -0.03, 0.4, 0.415, 0.11);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.08;
    ctx.stroke();
    for (const [x1, y1, x2, y2] of fingers) {
      line(ctx, INK, 0.165, [
        [x1, y1],
        [x2, y2],
      ]);
    }
    roundedRect(ctx, -0.2, -0.03, 0.4, 0.415, 0.11);
    ctx.fillStyle = "#fbbf24";
    ctx.fill();
    for (const [x1, y1, x2, y2] of fingers) {
      line(ctx, "#fbbf24", 0.085, [
        [x1, y1],
        [x2, y2],
      ]);
    }
  },
};

/** The bubble outline (body + tail) as one path, so the stroke flows around both. */
const traceBubble = (ctx: Ctx): void => {
  const { left, top, right, bottom, radius } = BODY;
  const middle = (left + right) / 2;
  ctx.beginPath();
  ctx.moveTo(left + radius, top);
  ctx.arcTo(right, top, right, bottom, radius);
  ctx.arcTo(right, bottom, left, bottom, radius);
  ctx.lineTo(middle + TAIL.halfWidth, bottom);
  ctx.lineTo(middle, TAIL.tipY);
  ctx.lineTo(middle - TAIL.halfWidth, bottom);
  ctx.arcTo(left, bottom, left, top, radius);
  ctx.arcTo(left, top, right, top, radius);
  ctx.closePath();
};

/** Paint a complete bubble for `icon` onto a BUBBLE_TEXTURE_WIDTH × BUBBLE_TEXTURE_HEIGHT canvas. */
export const drawBubble = (ctx: Ctx, icon: BubbleIcon): void => {
  ctx.clearRect(0, 0, BUBBLE_TEXTURE_WIDTH, BUBBLE_TEXTURE_HEIGHT);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.save();
  ctx.shadowColor = "rgba(2, 6, 12, 0.45)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 3;
  traceBubble(ctx);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.restore();

  traceBubble(ctx);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.save();
  ctx.translate(ICON_CENTER.x, ICON_CENTER.y);
  ctx.scale(ICON_SIZE, ICON_SIZE);
  PICTOGRAMS[icon](ctx);
  ctx.restore();
};

export const BUBBLE_ICONS = Object.keys(PICTOGRAMS) as BubbleIcon[];
