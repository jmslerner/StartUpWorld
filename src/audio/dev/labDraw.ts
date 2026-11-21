/**
 * Canvas drawing for the audio lab: a waveform with a dB envelope over it, and a
 * log-frequency spectrogram. These are what "listening" looks like when you cannot hear.
 */
import { spectrogram, toDb } from "./labAnalysis";

const INK = "#0b0d10";
const GRID = "rgba(169, 179, 191, 0.14)";
const LABEL = "rgba(169, 179, 191, 0.75)";
const NEON = "#7dd3fc";
const EMBER = "#f59e0b";

/** Envelope axis: bottom of the canvas is this many dBFS. */
const ENV_FLOOR_DB = -84;
/** Spectrogram colour range, dBFS. */
const SPEC_MIN_DB = -102;
const SPEC_MAX_DB = -24;
const SPEC_MIN_HZ = 50;
const SPEC_MAX_HZ = 16000;

const prepare = (canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number } | null => {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, width, height);
  ctx.font = `${Math.round(10 * ratio)}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = "top";
  return { ctx, width, height };
};

const timeStep = (seconds: number): number => (seconds <= 0.7 ? 0.05 : seconds <= 1.6 ? 0.25 : seconds <= 6 ? 0.5 : seconds <= 20 ? 2 : 10);

const drawTimeGrid = (ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number, labels: boolean): void => {
  const step = timeStep(seconds);
  ctx.strokeStyle = GRID;
  ctx.fillStyle = LABEL;
  ctx.lineWidth = 1;
  for (let t = step; t < seconds - 1e-6; t += step) {
    const x = Math.round((t / seconds) * width) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    if (labels) ctx.fillText(`${Number(t.toFixed(2))}s`, x + 3, height - 12 * (ctx.canvas.height / ctx.canvas.clientHeight || 1));
  }
};

export interface WaveMarks {
  /** Draw a marker where the sound falls below −60 dBFS. */
  durationS?: number;
  /** Draw a marker at the sound's allowed maximum length. */
  limitS?: number | null;
}

/**
 * Waveform (min/max per pixel, scaled so the peak fills the height) with the 5 ms RMS
 * envelope in dB drawn over it (top = 0 dBFS, bottom = −84 dBFS). A clean exponential decay
 * is a straight line in the envelope.
 */
export const drawWaveform = (canvas: HTMLCanvasElement, mono: Float32Array, sampleRate: number, marks: WaveMarks = {}): void => {
  const prepared = prepare(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  const seconds = mono.length / sampleRate;
  drawTimeGrid(ctx, width, height, seconds, true);

  let peak = 0;
  for (let i = 0; i < mono.length; i += 1) peak = Math.max(peak, Math.abs(mono[i]));
  const scale = peak > 0 ? (height * 0.46) / peak : 0;
  const mid = height / 2;
  const perPixel = mono.length / width;

  ctx.strokeStyle = GRID;
  ctx.beginPath();
  ctx.moveTo(0, mid + 0.5);
  ctx.lineTo(width, mid + 0.5);
  ctx.stroke();

  ctx.fillStyle = "rgba(125, 211, 252, 0.8)";
  for (let x = 0; x < width; x += 1) {
    const from = Math.floor(x * perPixel);
    const to = Math.min(mono.length, Math.max(from + 1, Math.floor((x + 1) * perPixel)));
    let min = 0;
    let max = 0;
    for (let i = from; i < to; i += 1) {
      const v = mono[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const top = mid - max * scale;
    ctx.fillRect(x, top, 1, Math.max(1, (max - min) * scale));
  }

  // dB envelope
  const windowSize = Math.max(8, Math.round(0.005 * sampleRate));
  ctx.strokeStyle = EMBER;
  ctx.lineWidth = Math.max(1, height / 90);
  ctx.beginPath();
  let started = false;
  for (let x = 0; x < width; x += 1) {
    const centre = Math.floor((x + 0.5) * perPixel);
    const from = Math.max(0, centre - (windowSize >> 1));
    const to = Math.min(mono.length, from + windowSize);
    let sum = 0;
    for (let i = from; i < to; i += 1) sum += mono[i] * mono[i];
    const db = toDb(Math.sqrt(sum / Math.max(1, to - from)));
    const y = Math.min(height - 1, Math.max(0, (db / ENV_FLOOR_DB) * height));
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // −60 dBFS reference line for the envelope
  const floorY = Math.round((-60 / ENV_FLOOR_DB) * height) + 0.5;
  ctx.strokeStyle = "rgba(245, 158, 11, 0.35)";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.lineTo(width, floorY);
  ctx.stroke();

  const marker = (time: number, color: string): void => {
    const x = Math.round((time / seconds) * width) + 0.5;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  };
  if (marks.limitS !== undefined && marks.limitS !== null && marks.limitS < seconds) marker(marks.limitS, "rgba(248, 113, 113, 0.8)");
  if (marks.durationS !== undefined && marks.durationS > 0) marker(marks.durationS, "rgba(74, 222, 128, 0.9)");
  ctx.setLineDash([]);

  ctx.fillStyle = LABEL;
  ctx.fillText(`peak ${toDb(peak).toFixed(1)} dBFS`, 4, 3);
};

/** Dark → violet → ember → pale: readable on the app's dark panels. */
const COLOR_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [11, 13, 16],
  [43, 30, 92],
  [141, 42, 110],
  [228, 98, 46],
  [250, 204, 21],
  [255, 250, 225],
];

const colorAt = (t: number): [number, number, number] => {
  const clamped = Math.min(1, Math.max(0, t)) * (COLOR_STOPS.length - 1);
  const index = Math.min(COLOR_STOPS.length - 2, Math.floor(clamped));
  const k = clamped - index;
  const a = COLOR_STOPS[index];
  const b = COLOR_STOPS[index + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};

/** Spectrogram on a log frequency axis (50 Hz – 16 kHz), colour = level per FFT bin in dBFS. */
export const drawSpectrogram = (canvas: HTMLCanvasElement, mono: Float32Array, sampleRate: number, centroidHz?: number): void => {
  const prepared = prepare(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  const seconds = mono.length / sampleRate;
  const fftSize = seconds > 8 ? 4096 : seconds < 0.25 ? 512 : 1024;
  if (mono.length < fftSize) return;
  const hop = Math.max(32, Math.floor((mono.length - fftSize) / Math.max(1, width - 1)));
  const spec = spectrogram(mono, sampleRate, fftSize, hop);
  const image = ctx.createImageData(width, height);
  const binHz = sampleRate / fftSize;
  const logMin = Math.log(SPEC_MIN_HZ);
  const logSpan = Math.log(Math.min(SPEC_MAX_HZ, sampleRate / 2)) - logMin;

  const rowBin = new Float32Array(height);
  for (let y = 0; y < height; y += 1) {
    const freq = Math.exp(logMin + logSpan * (1 - (y + 0.5) / height));
    rowBin[y] = freq / binHz;
  }
  for (let x = 0; x < width; x += 1) {
    const frame = spec.frames[Math.min(spec.frames.length - 1, Math.floor((x / width) * spec.frames.length))];
    if (!frame) continue;
    for (let y = 0; y < height; y += 1) {
      const position = rowBin[y];
      const lower = Math.min(frame.length - 1, Math.floor(position));
      const upper = Math.min(frame.length - 1, lower + 1);
      const k = position - lower;
      const magnitude = frame[lower] * (1 - k) + frame[upper] * k;
      const [r, g, b] = colorAt((toDb(magnitude) - SPEC_MIN_DB) / (SPEC_MAX_DB - SPEC_MIN_DB));
      const offset = (y * width + x) * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const yFor = (freq: number): number => (1 - (Math.log(freq) - logMin) / logSpan) * height;
  ctx.fillStyle = LABEL;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.lineWidth = 1;
  for (const [freq, label] of [
    [100, "100"],
    [1000, "1k"],
    [6000, "6k"],
  ] as const) {
    const y = Math.round(yFor(freq)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillText(label, 3, y + 2);
  }
  if (centroidHz !== undefined && centroidHz > SPEC_MIN_HZ) {
    const y = Math.round(yFor(centroidHz)) + 0.5;
    ctx.strokeStyle = NEON;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawTimeGrid(ctx, width, height, seconds, false);
};
