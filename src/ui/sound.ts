import type { EndingType } from "../types/game";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function isEnabled(): boolean {
  try {
    const master = localStorage.getItem("startupworld:sfx:master");
    // Default ON; only disable if master is explicitly "0".
    return master !== "0";
  } catch {
    return true;
  }
}

// --- Helpers ---

function tone(
  freq: number,
  duration: number,
  type: OscillatorType = "sine",
  gain = 0.06,
  delay = 0,
) {
  const ac = getCtx();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + duration + 0.01);
}

function slide(
  freqStart: number,
  freqEnd: number,
  duration: number,
  type: OscillatorType = "sine",
  gain = 0.06,
  delay = 0,
) {
  const ac = getCtx();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, t);
  osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration * 0.8);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + duration + 0.01);
}

function noiseBurst(duration: number, hpFreq: number, gain = 0.04, delay = 0) {
  const ac = getCtx();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const bufSize = Math.ceil(ac.sampleRate * duration);
  const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const hp = ac.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.setValueAtTime(hpFreq, t);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(hp).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + duration + 0.01);
}

// --- Public API ---

/** Rising chirp: C5→E5 */
function success() {
  if (!isEnabled()) return;
  slide(523, 659, 0.08, "sine", 0.06);
}

/** Descending buzz: E4→C4 */
function fail() {
  if (!isEnabled()) return;
  slide(330, 262, 0.12, "square", 0.04);
}

/** Three quick pips: G5 */
function alert() {
  if (!isEnabled()) return;
  tone(784, 0.04, "sine", 0.05, 0);
  tone(784, 0.04, "sine", 0.05, 0.06);
  tone(784, 0.04, "sine", 0.05, 0.12);
}

/** Low rumble + high ping */
function crisis() {
  if (!isEnabled()) return;
  noiseBurst(0.15, 100, 0.05);
  tone(1568, 0.1, "sine", 0.04, 0.08);
}

/** Ascending arpeggio: C5→E5→G5 */
function opportunity() {
  if (!isEnabled()) return;
  tone(523, 0.06, "sine", 0.05, 0);
  tone(659, 0.06, "sine", 0.05, 0.06);
  tone(784, 0.08, "sine", 0.06, 0.12);
}

/** Soft clock tick */
function tick() {
  if (!isEnabled()) return;
  noiseBurst(0.015, 2000, 0.04);
}

/** Register ching */
function cashIn() {
  if (!isEnabled()) return;
  tone(2000, 0.06, "sine", 0.05);
  noiseBurst(0.03, 4000, 0.03, 0.01);
}

/** Two-tone alarm */
function warning() {
  if (!isEnabled()) return;
  tone(880, 0.08, "square", 0.04, 0);
  tone(698, 0.08, "square", 0.04, 0.1);
  tone(880, 0.08, "square", 0.04, 0.2);
  tone(698, 0.08, "square", 0.04, 0.3);
}

/** Tiny UI pop */
function click() {
  if (!isEnabled()) return;
  noiseBurst(0.008, 3000, 0.03);
}

/** Ending-specific game over sting */
function gameOver(ending: EndingType) {
  if (!isEnabled()) return;
  switch (ending) {
    case "ipo":
      // Major chord swell: C4→E4→G4→C5
      tone(262, 0.4, "triangle", 0.04, 0);
      tone(330, 0.35, "triangle", 0.05, 0.05);
      tone(392, 0.3, "triangle", 0.06, 0.1);
      tone(523, 0.35, "triangle", 0.07, 0.15);
      break;
    case "acquisition":
      // Bittersweet: C4→Eb4
      tone(262, 0.2, "sine", 0.06, 0);
      tone(311, 0.3, "sine", 0.04, 0.12);
      break;
    case "bankruptcy":
      // Descending chromatic
      tone(330, 0.1, "square", 0.04, 0);
      tone(311, 0.1, "square", 0.04, 0.1);
      tone(294, 0.1, "square", 0.04, 0.2);
      tone(262, 0.2, "square", 0.03, 0.3);
      break;
    case "founder-removal":
      // Door slam: noise burst + low thud
      noiseBurst(0.06, 200, 0.06);
      tone(100, 0.15, "sine", 0.06, 0.1);
      break;
    case "zombie-saas":
      // Flatline drone
      tone(220, 0.5, "sine", 0.04);
      break;
    case "ai-hype-exit":
      // Slot machine ascending pips
      tone(523, 0.04, "sine", 0.05, 0);
      tone(587, 0.04, "sine", 0.05, 0.05);
      tone(659, 0.04, "sine", 0.05, 0.1);
      tone(784, 0.04, "sine", 0.05, 0.15);
      tone(880, 0.04, "sine", 0.05, 0.2);
      tone(1047, 0.08, "sine", 0.06, 0.25);
      break;
  }
}

export const SFX = {
  success,
  fail,
  alert,
  crisis,
  opportunity,
  tick,
  gameOver,
  cashIn,
  warning,
  click,
};
