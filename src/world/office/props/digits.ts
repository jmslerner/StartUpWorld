/**
 * Digits drawn as bars, the way a seven-segment display draws them, so the wall calendar can show the year without
 * writing a word. Segments in the usual order: a (top), b (top right), c (bottom right), d (bottom), e (bottom
 * left), f (top left), g (middle).
 */

const SEGMENTS: readonly (readonly boolean[])[] = [
  // a      b      c      d      e      f      g
  [true, true, true, true, true, true, false], // 0
  [false, true, true, false, false, false, false], // 1
  [true, true, false, true, true, false, true], // 2
  [true, true, true, true, false, false, true], // 3
  [false, true, true, false, false, true, true], // 4
  [true, false, true, true, false, true, true], // 5
  [true, false, true, true, true, true, true], // 6
  [true, true, true, false, false, false, false], // 7
  [true, true, true, true, true, true, true], // 8
  [true, true, true, true, false, true, true], // 9
];

const NONE: readonly boolean[] = Object.freeze([]);

/** Which of the seven segments are lit for `digit`; none at all for anything but a whole number from 0 to 9. */
export const digitSegments = (digit: number): readonly boolean[] =>
  Number.isInteger(digit) && digit >= 0 && digit <= 9 ? SEGMENTS[digit] : NONE;
