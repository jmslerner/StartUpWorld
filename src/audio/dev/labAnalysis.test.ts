import { describe, expect, it } from "vitest";
import { SOUNDS } from "../sounds";
import { mulberry32 } from "../synth";
import { THIRD_OCTAVES, analyze, analyzeBed, colourDistance, fft, loopCorrelation, loudness, mixToMono, spectralCentroid, spectrogram, thirdOctaveColour, toDb, windowedRmsDb } from "./labAnalysis";
import { PAIR_LIMITS, ambienceViolations, limitsFor, pairViolations, soundViolations, suggestedGain, worstCase, type AmbienceReport, type PairReport } from "./labChecks";

const RATE = 44100;

const sine = (freq: number, amplitude: number, seconds: number, phase = 0): Float32Array => {
  const data = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < data.length; i += 1) data[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / RATE + phase);
  return data;
};

const noise = (seconds: number, amplitude: number, seed: number): Float32Array => {
  const rand = mulberry32(seed);
  const data = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < data.length; i += 1) data[i] = (rand() * 2 - 1) * amplitude;
  return data;
};

/** A burst that fades in and out, padded with silence either side. */
const burst = (freq: number, amplitude: number, start: number, length: number, total: number): Float32Array => {
  const data = new Float32Array(Math.round(total * RATE));
  const from = Math.round(start * RATE);
  const n = Math.round(length * RATE);
  for (let i = 0; i < n; i += 1) {
    const env = Math.sin((Math.PI * i) / n) ** 2;
    data[from + i] = amplitude * env * Math.sin((2 * Math.PI * freq * i) / RATE);
  }
  return data;
};

describe("fft and spectra", () => {
  it("finds a sine in the right bin at the right level", () => {
    const n = 1024;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const bin = 37;
    for (let i = 0; i < n; i += 1) re[i] = Math.cos((2 * Math.PI * bin * i) / n);
    fft(re, im);
    const mags = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
    expect(mags.indexOf(Math.max(...mags))).toBe(bin);
    expect(mags[bin]).toBeCloseTo(n / 2, 6);
    expect(mags[bin + 5]).toBeLessThan(1e-6);
  });

  it("an impulse has a flat spectrum", () => {
    const re = new Float64Array(64);
    const im = new Float64Array(64);
    re[0] = 1;
    fft(re, im);
    for (let k = 0; k < 64; k += 1) expect(Math.hypot(re[k], im[k])).toBeCloseTo(1, 9);
  });

  it("spectrogram magnitudes read ≈ the sine's amplitude", () => {
    const spec = spectrogram(sine(1000, 0.5, 0.5), RATE, 1024, 256);
    const frame = spec.frames[10];
    expect(Math.max(...frame)).toBeGreaterThan(0.42);
    expect(Math.max(...frame)).toBeLessThan(0.52);
  });

  it("spectral centroid sits on a pure tone and between two equal ones", () => {
    expect(spectralCentroid(sine(1000, 0.5, 0.5), RATE)).toBeGreaterThan(940);
    expect(spectralCentroid(sine(1000, 0.5, 0.5), RATE)).toBeLessThan(1060);
    const two = sine(500, 0.3, 0.5);
    const high = sine(3500, 0.3, 0.5);
    for (let i = 0; i < two.length; i += 1) two[i] += high[i];
    const centroid = spectralCentroid(two, RATE);
    expect(centroid).toBeGreaterThan(1850);
    expect(centroid).toBeLessThan(2150);
    expect(spectralCentroid(new Float32Array(100), RATE)).toBe(0);
  });

  it("white noise has a high centroid, a low rumble a low one", () => {
    expect(spectralCentroid(noise(0.5, 0.3, 1), RATE)).toBeGreaterThan(8000);
    expect(spectralCentroid(sine(80, 0.5, 0.5), RATE)).toBeLessThan(150);
  });
});

describe("analyze", () => {
  it("measures peak, RMS and DC of a steady sine", () => {
    const data = sine(1000, 0.5, 1);
    const m = analyze([data, data], RATE);
    expect(m.finite).toBe(true);
    expect(m.peakDb).toBeCloseTo(-6.02, 1);
    expect(m.rmsDb).toBeCloseTo(-9.03, 1);
    expect(m.dc).toBeLessThan(1e-4);
    expect(m.centroidHz).toBeGreaterThan(940);
    expect(m.centroidHz).toBeLessThan(1060);
    expect(m.truncated).toBe(true); // still sounding at the end of the buffer
    expect(m.seconds).toBeCloseTo(1, 3);
  });

  it("measures when a sound starts and ends (−60 dBFS)", () => {
    const data = burst(800, 0.25, 0.1, 0.3, 1);
    const m = analyze([data], RATE);
    expect(m.onsetS).toBeGreaterThan(0.1);
    expect(m.onsetS).toBeLessThan(0.13);
    expect(m.durationS).toBeGreaterThan(0.37);
    expect(m.durationS).toBeLessThan(0.4);
    expect(m.durationRelS).toBeGreaterThanOrEqual(m.durationS);
    expect(m.truncated).toBe(false);
    expect(m.peakDb).toBeCloseTo(toDb(0.25), 0);
    // It fades in and out, so there is no step at either edge.
    expect(m.startAbs).toBeLessThan(0.002);
    expect(m.endAbs).toBeLessThan(0.002);
  });

  it("the relative duration follows the sound's own peak, the absolute one does not", () => {
    const quiet = burst(800, 0.01, 0, 0.5, 1);
    const m = analyze([quiet], RATE);
    expect(m.durationRelS).toBeGreaterThan(m.durationS);
  });

  it("flags clicks: a sound that starts or stops on a step", () => {
    const data = new Float32Array(RATE);
    for (let i = 4410; i < 8820; i += 1) data[i] = 0.3; // a rectangular pulse
    const m = analyze([data], RATE);
    expect(m.startAbs).toBeCloseTo(0.3, 5);
    expect(m.endAbs).toBeCloseTo(0.3, 5);
    expect(m.maxStep).toBeCloseTo(0.3, 5);
    expect(m.dc).toBeCloseTo(0.15, 2); // 0.3 for half of the measured span
  });

  it("flags NaN and Infinity", () => {
    const data = sine(440, 0.1, 0.1);
    data[100] = Number.NaN;
    expect(analyze([data], RATE).finite).toBe(false);
    data[100] = Number.POSITIVE_INFINITY;
    expect(analyze([data], RATE).finite).toBe(false);
  });

  it("takes the louder channel for the peak and both for RMS", () => {
    const left = sine(440, 0.5, 0.5);
    const right = new Float32Array(left.length);
    const m = analyze([left, right], RATE);
    expect(m.peakDb).toBeCloseTo(-6.02, 1);
    expect(m.rmsDb).toBeCloseTo(-12.04, 1);
    expect(mixToMono([left, right])[100]).toBeCloseTo(left[100] / 2, 6);
  });

  it("silence is silence", () => {
    const m = analyze([new Float32Array(1000)], RATE);
    expect(m.durationS).toBe(0);
    expect(m.startAbs).toBe(0);
    expect(m.peakDb).toBeLessThan(-150);
  });
});

describe("analyzeBed", () => {
  it("a steady bed does not pump and has no periodicity", () => {
    const bed = analyzeBed(noise(30, 0.01, 3), RATE);
    expect(bed.rmsDb).toBeCloseTo(toDb(0.01 / Math.sqrt(3)), 0);
    expect(bed.pumpDb).toBeLessThan(0.5);
    expect(bed.spikeDb).toBeLessThan(1);
    expect(bed.periodicity).toBeLessThan(0.3);
  });

  it("catches a bed that is a short loop", () => {
    const loop = noise(4, 0.01, 5);
    // Give the loop a recognisable loudness shape, then repeat it.
    for (let i = 0; i < loop.length; i += 1) loop[i] *= 0.6 + 0.4 * Math.sin((2 * Math.PI * 3.3 * i) / loop.length) * Math.sin((2 * Math.PI * 7.1 * i) / loop.length);
    const data = new Float32Array(30 * RATE);
    for (let i = 0; i < data.length; i += 1) data[i] = loop[i % loop.length];
    const bed = analyzeBed(data, RATE);
    expect(bed.periodicity).toBeGreaterThan(0.8);
    expect(bed.periodicityLagS % 4).toBeLessThan(0.11);
  });

  it("catches a bed that breathes", () => {
    const data = noise(30, 0.01, 7);
    for (let i = 0; i < data.length; i += 1) data[i] *= 0.5 + 0.5 * Math.sin((2 * Math.PI * i) / (6 * RATE)) ** 2;
    expect(analyzeBed(data, RATE).pumpDb).toBeGreaterThan(4);
  });

  it("catches a one-shot poking out", () => {
    const data = noise(30, 0.003, 9);
    for (let i = 10 * RATE; i < 10.05 * RATE; i += 1) data[i] += 0.1 * Math.sin(i / 7);
    expect(analyzeBed(data, RATE).spikeDb).toBeGreaterThan(12);
  });

  it("windowed RMS covers the signal in order", () => {
    const data = new Float32Array(2 * RATE);
    data.fill(0.1, RATE);
    const windows = windowedRmsDb(data, RATE, 0.5);
    expect(windows).toHaveLength(4);
    expect(windows[0]).toBeLessThan(-100);
    expect(windows[3]).toBeCloseTo(-20, 3);
  });
});

describe("acceptance checks", () => {
  const good = analyze([burst(900, 0.2, 0.01, 0.2, 1)], RATE);

  it("passes a sound that meets its family's numbers", () => {
    const report = worstCase([good, good]);
    expect(report.seeds).toBe(2);
    expect(soundViolations(SOUNDS.success, report)).toEqual([]);
    expect(limitsFor(SOUNDS.success)).toEqual({ peakMin: -20, peakMax: -9, maxDur: 0.7 });
    expect(limitsFor(SOUNDS["gameover-ipo"]).maxDur).toBe(1.6);
    expect(limitsFor(SOUNDS["ui-hover"])).toEqual({ peakMin: -30, peakMax: -18, maxDur: 0.12 });
    expect(limitsFor(SOUNDS["door-open"])).toEqual({ peakMin: -24, peakMax: -10, maxDur: 2 });
    expect(limitsFor(SOUNDS["amb-key"]).maxDur).toBeNull();
  });

  it("uses the worst seed for every number", () => {
    const loud = analyze([burst(900, 0.5, 0.01, 0.2, 1)], RATE);
    const long = analyze([burst(900, 0.2, 0.01, 0.9, 1.5)], RATE);
    const report = worstCase([good, loud, long]);
    expect(report.peakMaxDb).toBeCloseTo(loud.peakDb, 6);
    expect(report.peakMinDb).toBeCloseTo(good.peakDb, 1);
    expect(report.durationMaxS).toBeCloseTo(long.durationS, 6);
    const problems = soundViolations(SOUNDS.success, report);
    expect(problems.some((p) => p.includes("above -9"))).toBe(true);
    expect(problems.some((p) => p.includes("not under 0.7"))).toBe(true);
  });

  it("names each kind of failure", () => {
    const check = (data: Float32Array) => soundViolations(SOUNDS["ui-select"], worstCase([analyze([data], RATE)]));
    expect(check(burst(900, 0.5, 0.01, 0.05, 0.5)).join()).toMatch(/above -18/);
    expect(check(burst(900, 0.01, 0.01, 0.05, 0.5)).join()).toMatch(/below -30/);
    expect(check(burst(900, 0.06, 0.01, 0.3, 0.6)).join()).toMatch(/not under 0\.12/);
    expect(check(burst(60, 0.06, 0.01, 0.1, 0.5)).join()).toMatch(/boomy/);
    expect(check(burst(9000, 0.06, 0.01, 0.1, 0.5)).join()).toMatch(/shrill/);
    const click = burst(900, 0.06, 0.01, 0.1, 0.5);
    click[0] = 0.05;
    expect(check(click).join()).toMatch(/click at start/);
    const nan = burst(900, 0.06, 0.01, 0.1, 0.5);
    nan[5] = Number.NaN;
    expect(check(nan).join()).toMatch(/NaN/);
    const offset = burst(900, 0.06, 0.01, 0.1, 0.5).map((v, i) => (i > 441 && i < 4851 ? v + 0.01 : v));
    expect(check(offset).join()).toMatch(/DC offset/);
    expect(check(sine(900, 0.06, 0.5)).join()).toMatch(/still sounding/);
    expect(check(burst(900, 0.95, 0.01, 0.05, 0.5)).join()).toMatch(/ceiling/);
  });

  it("suggests the gain that puts the loudest seed on the designed level", () => {
    const def = SOUNDS.success;
    const report = worstCase([good]);
    const next = suggestedGain(def, report);
    expect(20 * Math.log10(next / def.gain)).toBeCloseTo(def.level - report.peakMaxDb, 6);
  });

  it("judges the ambience bed against its window", () => {
    const base: AmbienceReport = {
      ...good,
      rmsDb: -40,
      peakDb: -27,
      windowMinDb: -41,
      windowMaxDb: -39,
      pumpDb: 2,
      spikeDb: 3,
      periodicity: 0.1,
      periodicityLagS: 5,
      bedOnlyRmsDb: -40,
      oneShotPeakDb: -35,
      oneShotOverBedDb: 5,
      oneShots: 100,
      loudnessI: -38,
      colourDb: [],
      loopCorrelation: 0.03,
      loopLagS: 7,
    };
    expect(ambienceViolations(base, true)).toEqual([]);
    expect(ambienceViolations({ ...base, rmsDb: -50 }, true).join()).toMatch(/below -46/);
    expect(ambienceViolations({ ...base, rmsDb: -30 }, true).join()).toMatch(/above -32/);
    expect(ambienceViolations({ ...base, oneShotOverBedDb: 13 }, true).join()).toMatch(/above the bed/);
    expect(ambienceViolations({ ...base, pumpDb: 9 }, true).join()).toMatch(/pumps/);
    expect(ambienceViolations({ ...base, periodicity: 0.9 }, true).join()).toMatch(/repeats/);
    expect(ambienceViolations({ ...base, loopCorrelation: 0.6, loopLagS: 9.73 }, true).join()).toMatch(/waveform loops every 9\.730 s/);
    // A state that should be almost silent is held to that instead.
    expect(ambienceViolations({ ...base, rmsDb: -58 }, false)).toEqual([]);
    expect(ambienceViolations(base, false).join()).toMatch(/almost silent/);
  });

  it("judges a stinger + world pair: no pile-up, and the stinger stays on top", () => {
    const mix = analyze([burst(900, 0.25, 0.01, 0.5, 1.2)], RATE);
    const base: PairReport = {
      mix,
      stingerPeakDb: -14,
      worldPeakDb: -16,
      worldUnderStingerDb: -22,
      stingerWindowS: 0.3,
      stingerLoudnessM: -28,
      worldLoudnessM: -33,
      loudnessLeadLu: 5,
      loudnessRule: true,
      seeds: 3,
    };
    expect(pairViolations(base)).toEqual([]);
    const loud = analyze([burst(900, 0.7, 0.01, 0.5, 1.2)], RATE);
    expect(pairViolations({ ...base, mix: loud }).join()).toMatch(new RegExp(`above ${PAIR_LIMITS.mixPeakMaxDb}`));
    expect(pairViolations({ ...base, worldUnderStingerDb: -15 }).join()).toMatch(/under the stinger/);
    // Louder over the whole moment than the stinger it supports: a second stinger in disguise.
    expect(pairViolations({ ...base, worldLoudnessM: -27, loudnessLeadLu: -1 }).join()).toMatch(/in loudness/);
    // …unless the only stinger is the week's tick.
    expect(pairViolations({ ...base, worldLoudnessM: -27, loudnessLeadLu: -1, loudnessRule: false })).toEqual([]);
    const click = burst(900, 0.25, 0.01, 0.5, 1.2);
    click[0] = 0.05;
    expect(pairViolations({ ...base, mix: analyze([click], RATE) }).join()).toMatch(/click at start/);
  });
});

describe("loudness (BS.1770)", () => {
  it("reads a full-scale 1 kHz sine at about −3 LUFS per channel (+3 for two channels)", () => {
    const tone = sine(1000, 1, 2);
    // K-weighting is ≈ +0.7 dB at 1 kHz; the −0.691 offset cancels it: a 0 dBFS-peak sine is −3.01 LUFS.
    expect(loudness([tone], RATE).integrated).toBeCloseTo(-3.01, 1);
    expect(loudness([tone, tone], RATE).integrated).toBeCloseTo(0, 1);
  });

  it("weights low frequencies down and the presence region up", () => {
    const low = loudness([sine(40, 0.1, 2)], RATE).integrated;
    const mid = loudness([sine(1000, 0.1, 2)], RATE).integrated;
    const high = loudness([sine(4000, 0.1, 2)], RATE).integrated;
    expect(low).toBeLessThan(mid - 1);
    expect(high).toBeGreaterThan(mid + 2);
  });

  it("momentary loudness finds the loudest 400 ms; a held tone outweighs a blip of the same peak", () => {
    const blip = burst(900, 0.3, 0.1, 0.05, 1.5);
    const held = burst(900, 0.3, 0.1, 0.6, 1.5);
    expect(analyze([held], RATE).peakDb).toBeCloseTo(analyze([blip], RATE).peakDb, 0);
    expect(loudness([held], RATE).momentaryMax).toBeGreaterThan(loudness([blip], RATE).momentaryMax + 6);
    expect(loudness([new Float32Array(1000)], RATE).momentaryMax).toBe(-160);
  });

  it("works at 48 kHz too", () => {
    const tone = new Float32Array(96000);
    for (let i = 0; i < tone.length; i += 1) tone[i] = Math.sin((2 * Math.PI * 1000 * i) / 48000);
    expect(loudness([tone], 48000).integrated).toBeCloseTo(-3.01, 1);
  });
});

describe("loopCorrelation", () => {
  it("sees a noise loop that the loudness envelope cannot, and not fresh noise", () => {
    const period = noise(9.7, 0.2, 5);
    const looped = new Float32Array(Math.round(30 * RATE));
    for (let i = 0; i < looped.length; i += 1) looped[i] = period[i % period.length];
    const fresh = noise(30, 0.2, 6);
    const loop = loopCorrelation(looped, RATE);
    // (below 1 only because the period is not a whole number of decimated samples)
    expect(loop.correlation).toBeGreaterThan(0.6);
    expect(loop.lagS).toBeCloseTo(9.7, 1);
    expect(loopCorrelation(fresh, RATE).correlation).toBeLessThan(0.08);
  });

  it("is not fooled by a loop read at a slowly wandering speed", () => {
    const period = noise(11, 0.2, 7);
    const out = new Float32Array(Math.round(30 * RATE));
    let position = 0;
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      position += 1 + 0.02 * Math.sin(2 * Math.PI * 0.09 * t + 1) + 0.012 * Math.sin(2 * Math.PI * 0.031 * t);
      const k = Math.floor(position);
      const frac = position - k;
      out[i] = period[k % period.length] * (1 - frac) + period[(k + 1) % period.length] * frac;
    }
    expect(loopCorrelation(out, RATE).correlation).toBeLessThan(0.1);
  });
});

describe("thirdOctaveColour", () => {
  it("is independent of level and tells a low rumble from a bright hiss", () => {
    const low = sine(160, 0.2, 2);
    const quietLow = sine(160, 0.02, 2);
    const high = sine(2500, 0.2, 2);
    const a = thirdOctaveColour(low, RATE);
    expect(a).toHaveLength(THIRD_OCTAVES.length);
    expect(colourDistance(a, thirdOctaveColour(quietLow, RATE))).toBeLessThan(0.5);
    expect(colourDistance(a, thirdOctaveColour(high, RATE))).toBeGreaterThan(10);
  });
});
