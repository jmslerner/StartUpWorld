/**
 * Signal analysis for the audio lab. Pure functions over Float32Arrays — no Web Audio, no DOM —
 * so the numbers the lab reports are themselves unit-tested (labAnalysis.test.ts).
 */

export const DB_FLOOR = -160;

export const toDb = (linear: number): number => (linear > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(linear)) : DB_FLOOR);

/** −60 dBFS: where a sound is considered to have ended. */
export const SILENCE = 0.001;
/** Samples at or below this are treated as digital silence when looking for the edges of a sound. */
const DIGITAL_ZERO = 1e-6;

export interface Metrics {
  /** Length of the analysed render, seconds. */
  seconds: number;
  /** No NaN / Infinity anywhere. */
  finite: boolean;
  /** Largest sample magnitude, dBFS. */
  peakDb: number;
  /** RMS from the trigger to the end of the sound (both channels), dBFS. */
  rmsDb: number;
  /** Trigger → last sample at or above −60 dBFS. */
  durationS: number;
  /** Trigger → last sample within 60 dB of the sound's own peak. */
  durationRelS: number;
  /** Trigger → first sample at or above −60 dBFS. */
  onsetS: number;
  /** Largest |mean| of a channel over the sound's duration. */
  dc: number;
  /** Magnitude of the first sample that is not digital silence (a click if large). */
  startAbs: number;
  /** Magnitude of the last sample that is not digital silence (a click if large). */
  endAbs: number;
  /** Largest sample-to-sample jump (informational). */
  maxStep: number;
  /** Energy-weighted mean of the per-frame spectral centroid, Hz. */
  centroidHz: number;
  /** The render ended while the sound was still above −60 dBFS. */
  truncated: boolean;
  /**
   * Loudest K-weighted momentary loudness (ITU-R BS.1770, 400 ms window), LUFS. Peaks say how
   * close a sound comes to clipping; this says how loud it is to a listener — a held tone or a
   * crowd carries far more loudness per dB of peak than a pluck.
   */
  loudnessM: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// FFT
// ─────────────────────────────────────────────────────────────────────────────

/** In-place iterative radix-2 FFT. `re.length` must be a power of two. */
export const fft = (re: Float64Array, im: Float64Array): void => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k += 1) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
};

const hannCache = new Map<number, Float64Array>();
const hann = (size: number): Float64Array => {
  let window = hannCache.get(size);
  if (!window) {
    window = new Float64Array(size);
    for (let i = 0; i < size; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    hannCache.set(size, window);
  }
  return window;
};

export interface Spectrogram {
  /** frames × bins magnitudes (linear, normalised so a full-scale sine reads ≈ 1). */
  frames: Float32Array[];
  bins: number;
  fftSize: number;
  hop: number;
  sampleRate: number;
}

export const spectrogram = (mono: Float32Array, sampleRate: number, fftSize = 1024, hop = 256): Spectrogram => {
  const window = hann(fftSize);
  const bins = fftSize / 2;
  const frames: Float32Array[] = [];
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const norm = 4 / fftSize; // Hann coherent gain 0.5 → ×2, one-sided → ×2
  for (let start = 0; start + fftSize <= mono.length; start += hop) {
    for (let i = 0; i < fftSize; i += 1) {
      re[i] = mono[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    const mags = new Float32Array(bins);
    for (let k = 0; k < bins; k += 1) mags[k] = Math.hypot(re[k], im[k]) * norm;
    frames.push(mags);
  }
  return { frames, bins, fftSize, hop, sampleRate };
};

/** Energy-weighted mean of each frame's magnitude-weighted centroid. */
export const spectralCentroid = (mono: Float32Array, sampleRate: number): number => {
  const fftSize = mono.length >= 2048 ? 2048 : 1024;
  if (mono.length < fftSize) return 0;
  const spec = spectrogram(mono, sampleRate, fftSize, fftSize / 4);
  const binHz = sampleRate / fftSize;
  let weighted = 0;
  let total = 0;
  for (const mags of spec.frames) {
    let num = 0;
    let den = 0;
    let energy = 0;
    for (let k = 1; k < mags.length; k += 1) {
      num += k * binHz * mags[k];
      den += mags[k];
      energy += mags[k] * mags[k];
    }
    if (den <= 0) continue;
    weighted += (num / den) * energy;
    total += energy;
  }
  return total > 0 ? weighted / total : 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-sound metrics
// ─────────────────────────────────────────────────────────────────────────────

export const mixToMono = (channels: readonly Float32Array[]): Float32Array => {
  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i += 1) mono[i] += channel[i] / channels.length;
  return mono;
};

// ─────────────────────────────────────────────────────────────────────────────
// Loudness (ITU-R BS.1770 K-weighting)
// ─────────────────────────────────────────────────────────────────────────────

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Run a biquad (direct form I) over a signal. */
const runBiquad = (input: ArrayLike<number>, f: Biquad): Float64Array => {
  const out = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x = Number.isFinite(input[i]) ? input[i] : 0;
    const y = f.b0 * x + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
};

/** The two K-weighting stages for any sample rate (the BS.1770 analogue prototypes, bilinear-transformed). */
const kWeightingFilters = (sampleRate: number): [Biquad, Biquad] => {
  // Stage 1: the head's high shelf (+4 dB above ~1.7 kHz).
  const K = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  const Q1 = 0.7071752369554196;
  const a0 = 1 + K / Q1 + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q1 + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q1 + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q1 + K * K) / a0,
  };
  // Stage 2: the RLB high-pass (~38 Hz).
  const K2 = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  const Q2 = 0.5003270373238773;
  const d = 1 + K2 / Q2 + K2 * K2;
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K2 * K2 - 1)) / d, a2: (1 - K2 / Q2 + K2 * K2) / d };
  return [shelf, highpass];
};

/** K-weighted copy of a channel. */
export const kWeight = (channel: ArrayLike<number>, sampleRate: number): Float64Array => {
  const [shelf, highpass] = kWeightingFilters(sampleRate);
  return runBiquad(runBiquad(channel, shelf), highpass);
};

const LUFS_OFFSET = -0.691;

export interface Loudness {
  /** Loudest momentary loudness (400 ms windows, 50 ms hop), LUFS. */
  momentaryMax: number;
  /** Ungated integrated loudness over the whole signal, LUFS. */
  integrated: number;
}

/** BS.1770 loudness of a stereo (or mono) render. Silence reads −160. */
export const loudness = (channels: readonly ArrayLike<number>[], sampleRate: number, windowS = 0.4, hopS = 0.05): Loudness => {
  const length = channels[0]?.length ?? 0;
  if (length === 0) return { momentaryMax: DB_FLOOR, integrated: DB_FLOOR };
  // Sum of the channels' squared K-weighted signal (BS.1770 weights L and R by 1).
  const power = new Float64Array(length);
  for (const channel of channels) {
    const weighted = kWeight(channel, sampleRate);
    for (let i = 0; i < length; i += 1) power[i] += weighted[i] * weighted[i];
  }
  const prefix = new Float64Array(length + 1);
  for (let i = 0; i < length; i += 1) prefix[i + 1] = prefix[i] + power[i];
  const toLufs = (meanSquare: number): number => (meanSquare > 0 ? Math.max(DB_FLOOR, LUFS_OFFSET + 10 * Math.log10(meanSquare)) : DB_FLOOR);
  const size = Math.max(1, Math.round(windowS * sampleRate));
  const hop = Math.max(1, Math.round(hopS * sampleRate));
  let best = 0;
  if (length <= size) best = prefix[length] / size;
  else for (let start = 0; start + size <= length; start += hop) best = Math.max(best, (prefix[start + size] - prefix[start]) / size);
  return { momentaryMax: toLufs(best), integrated: toLufs(prefix[length] / length) };
};

/** Centre frequencies of the 1/3-octave bands the lab compares beds in (100 Hz – 8 kHz). */
export const THIRD_OCTAVES = [100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000] as const;

/**
 * Long-term spectrum in 1/3-octave bands, dB, level-normalised (mean 0): the "colour" of a bed,
 * independent of how loud it is. Two beds that sound like different places differ here.
 */
export const thirdOctaveColour = (mono: Float32Array, sampleRate: number): number[] => {
  const spec = spectrogram(mono, sampleRate, 4096, 4096);
  const binHz = sampleRate / spec.fftSize;
  const power = THIRD_OCTAVES.map(() => 0);
  for (const frame of spec.frames) {
    THIRD_OCTAVES.forEach((centre, band) => {
      const lo = Math.max(1, Math.floor((centre / 2 ** (1 / 6)) / binHz));
      const hi = Math.min(frame.length - 1, Math.ceil((centre * 2 ** (1 / 6)) / binHz));
      for (let k = lo; k <= hi; k += 1) power[band] += frame[k] * frame[k];
    });
  }
  const db = power.map((p) => 10 * Math.log10(p + 1e-20));
  const mean = db.reduce((a, b) => a + b, 0) / db.length;
  return db.map((value) => Math.round((value - mean) * 10) / 10);
};

/** RMS difference between two level-normalised colours, dB. */
export const colourDistance = (a: readonly number[], b: readonly number[]): number =>
  Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / Math.max(1, a.length));

// ─────────────────────────────────────────────────────────────────────────────
// Loops (waveform-level repetition of a bed)
// ─────────────────────────────────────────────────────────────────────────────

/** RBJ-cookbook high- / low-pass at `freq` (Q 0.707). */
const passFilter = (type: "highpass" | "lowpass", freq: number, sampleRate: number): Biquad => {
  const w = (2 * Math.PI * freq) / sampleRate;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b1 = type === "lowpass" ? 1 - cos : -(1 + cos);
  const b0 = type === "lowpass" ? (1 - cos) / 2 : (1 + cos) / 2;
  return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
};

export interface LoopReport {
  /** Largest normalised autocorrelation of the band-limited waveform at lags in the search range. */
  correlation: number;
  lagS: number;
}

/**
 * Does the waveform itself repeat? The 50 ms loudness envelope cannot tell a noise loop read at a
 * fixed speed (which comes round sample-for-sample every period) from fresh noise; this can.
 * The bed is band-limited to `fromHz`–`toHz` (above the hums, whose steady tones would correlate
 * at every multiple of their period, and where voices and air sit), decimated, and its
 * autocorrelation computed with an FFT and normalised by the energy actually overlapped. Fresh
 * noise reads a few hundredths; a loop reads up to 1.
 */
export const loopCorrelation = (mono: Float32Array, sampleRate: number, minLagS = 2, maxLagS = 25, fromHz = 1000, toHz = 2500): LoopReport => {
  let band: ArrayLike<number> = mono;
  for (const f of [passFilter("highpass", fromHz, sampleRate), passFilter("highpass", fromHz, sampleRate), passFilter("lowpass", toHz, sampleRate), passFilter("lowpass", toHz, sampleRate)]) {
    band = runBiquad(band, f);
  }
  // Any linear processing of a loop is still a loop, so a crude decimation is fine here.
  const factor = Math.max(1, Math.floor(sampleRate / (2.2 * toHz)));
  const rate = sampleRate / factor;
  const m = Math.floor(band.length / factor);
  const minOverlap = Math.round(5 * rate);
  const maxLag = Math.min(Math.round(maxLagS * rate), m - minOverlap);
  const minLag = Math.round(minLagS * rate);
  if (maxLag <= minLag) return { correlation: 0, lagS: 0 };
  let size = 1;
  while (size < 2 * m) size <<= 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < m; i += 1) re[i] = band[i * factor];
  const energy = new Float64Array(m + 1);
  for (let i = 0; i < m; i += 1) energy[i + 1] = energy[i] + re[i] * re[i];
  fft(re, im);
  for (let i = 0; i < size; i += 1) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  // Inverse FFT of a real, even spectrum = forward FFT / size.
  fft(re, im);
  let correlation = 0;
  let lagS = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const head = energy[m - lag];
    const tail = energy[m] - energy[lag];
    if (head <= 0 || tail <= 0) continue;
    const r = re[lag] / size / Math.sqrt(head * tail);
    if (r > correlation) {
      correlation = r;
      lagS = lag / rate;
    }
  }
  return { correlation, lagS };
};

export const analyze = (channels: readonly Float32Array[], sampleRate: number): Metrics => {
  const length = channels[0]?.length ?? 0;
  let finite = true;
  let peak = 0;
  let first = -1;
  let last = -1;
  let firstNonZero = -1;
  let lastNonZero = -1;
  let maxStep = 0;
  for (const data of channels) {
    let prev = 0;
    for (let i = 0; i < length; i += 1) {
      const x = data[i];
      if (!Number.isFinite(x)) {
        finite = false;
        continue;
      }
      const ax = Math.abs(x);
      if (ax > peak) peak = ax;
      if (ax >= SILENCE) {
        if (first < 0 || i < first) first = i;
        if (i > last) last = i;
      }
      if (ax > DIGITAL_ZERO) {
        if (firstNonZero < 0 || i < firstNonZero) firstNonZero = i;
        if (i > lastNonZero) lastNonZero = i;
      }
      const step = Math.abs(x - prev);
      if (step > maxStep) maxStep = step;
      prev = x;
    }
  }

  const relThreshold = peak * SILENCE;
  let lastRel = -1;
  for (const data of channels) {
    for (let i = length - 1; i > lastRel; i -= 1) {
      if (Math.abs(data[i]) >= relThreshold && relThreshold > 0) {
        lastRel = i;
        break;
      }
    }
  }

  // The size of the jump out of (or back into) digital silence: a click if it is large.
  const edge = (index: number): number => {
    if (index < 0) return 0;
    let max = 0;
    for (const data of channels) max = Math.max(max, Math.abs(data[index]));
    return max;
  };

  const end = Math.max(last + 1, Math.min(length, Math.round(0.02 * sampleRate)));
  let sumSquares = 0;
  let dc = 0;
  for (const data of channels) {
    let sum = 0;
    for (let i = 0; i < end; i += 1) {
      sum += data[i];
      sumSquares += data[i] * data[i];
    }
    dc = Math.max(dc, Math.abs(sum / Math.max(1, end)));
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, end * channels.length));

  return {
    seconds: length / sampleRate,
    finite,
    peakDb: toDb(peak),
    rmsDb: toDb(rms),
    durationS: last < 0 ? 0 : (last + 1) / sampleRate,
    durationRelS: lastRel < 0 ? 0 : (lastRel + 1) / sampleRate,
    onsetS: first < 0 ? 0 : first / sampleRate,
    dc,
    startAbs: edge(firstNonZero),
    endAbs: edge(lastNonZero),
    maxStep,
    centroidHz: spectralCentroid(mixToMono(channels), sampleRate),
    truncated: last >= length - 2,
    loudnessM: loudness(channels, sampleRate).momentaryMax,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Continuity of a bed (ambience / music)
// ─────────────────────────────────────────────────────────────────────────────

/** RMS of consecutive windows, dBFS. */
export const windowedRmsDb = (mono: Float32Array, sampleRate: number, windowS: number, hopS = windowS): number[] => {
  const size = Math.max(1, Math.round(windowS * sampleRate));
  const hop = Math.max(1, Math.round(hopS * sampleRate));
  const out: number[] = [];
  for (let start = 0; start + size <= mono.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + size; i += 1) sum += mono[i] * mono[i];
    out.push(toDb(Math.sqrt(sum / size)));
  }
  return out;
};

export interface BedMetrics {
  /** Integrated RMS over the analysed span, dBFS. */
  rmsDb: number;
  peakDb: number;
  /** Quietest and loudest 1-second windows, dBFS. */
  windowMinDb: number;
  windowMaxDb: number;
  /** windowMaxDb − windowMinDb: how much the bed breathes over seconds. Small = steady. */
  pumpDb: number;
  /** Loudest 50 ms window relative to the integrated RMS: a one-shot poking out. */
  spikeDb: number;
  /**
   * Largest normalised autocorrelation of the (detrended) 50 ms loudness envelope at lags ≥ 2 s.
   * 1 = the bed repeats exactly (a loop); near 0 = no periodicity.
   */
  periodicity: number;
  periodicityLagS: number;
}

export const analyzeBed = (mono: Float32Array, sampleRate: number, skipS = 0.5): BedMetrics => {
  const skip = Math.min(mono.length, Math.round(skipS * sampleRate));
  const body = mono.subarray(skip);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < body.length; i += 1) {
    sum += body[i] * body[i];
    const ax = Math.abs(body[i]);
    if (ax > peak) peak = ax;
  }
  const rmsDb = toDb(Math.sqrt(sum / Math.max(1, body.length)));
  const seconds = windowedRmsDb(body, sampleRate, 1, 0.5);
  const windowMinDb = seconds.length ? Math.min(...seconds) : rmsDb;
  const windowMaxDb = seconds.length ? Math.max(...seconds) : rmsDb;

  const hopS = 0.05;
  const env = windowedRmsDb(body, sampleRate, hopS).map((db) => 10 ** (db / 20));
  const spikeDb = env.length ? toDb(Math.max(...env)) - rmsDb : 0;

  // Remove slow swells (a passing car, a murmur rising) with a ±1 s moving average: what is
  // left is the fine grain of the loudness, which only lines up with itself if a loop repeats.
  const half = Math.round(1 / hopS);
  const centred = env.map((value, i) => {
    const from = Math.max(0, i - half);
    const to = Math.min(env.length, i + half + 1);
    let sum = 0;
    for (let k = from; k < to; k += 1) sum += env[k];
    return value - sum / (to - from);
  });
  const power = centred.reduce((a, b) => a + b * b, 0);
  const level = env.reduce((a, b) => a + b * b, 0);
  let periodicity = 0;
  let periodicityLagS = 0;
  const minLag = Math.round(2 / hopS);
  const maxLag = Math.floor(centred.length / 2);
  // (a perfectly flat envelope — silence — has no grain to correlate)
  if (power > level * 1e-9) {
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let acc = 0;
      for (let i = 0; i + lag < centred.length; i += 1) acc += centred[i] * centred[i + lag];
      // Normalise by the energy actually overlapped so long lags are not penalised.
      const r = acc / (power * ((centred.length - lag) / centred.length));
      if (r > periodicity) {
        periodicity = r;
        periodicityLagS = lag * hopS;
      }
    }
  }
  return { rmsDb, peakDb: toDb(peak), windowMinDb, windowMaxDb, pumpDb: windowMaxDb - windowMinDb, spikeDb, periodicity, periodicityLagS };
};
