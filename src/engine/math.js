// Deterministic integer math for the simulation.
//
// Lockstep multiplayer only works if every client computes bit-identical results.
// IEEE-754 + - * / and sqrt are exactly specified, but Math.sin/cos/atan2/hypot/pow are
// not (browsers may differ in the last bit). So the simulation only ever uses the
// helpers in this file, which are built from basic arithmetic.
//
// Units:  1 cell = 1024 world units (WDist). Angles: 1024 units per full turn (WAngle).
// Angle 0 points along +x, 256 along +y (y maps to three.js +z).

export const CELL = 1024;
export const HALF = 512;
export const ANGLE = 1024;

const PI = 3.141592653589793;

// sin(x) for x in [0, PI/2] by Taylor series. Arithmetic only => deterministic.
function sinQuarter(x) {
  const x2 = x * x;
  let term = x, sum = x;
  for (let n = 1; n < 12; n++) { term *= -x2 / ((2 * n) * (2 * n + 1)); sum += term; }
  return sum;
}

export const SIN = new Int32Array(ANGLE);
for (let k = 0; k < ANGLE; k++) {
  const q = k & 255, quad = k >> 8;
  const s = Math.round(sinQuarter((quad & 1 ? 256 - q : q) * (PI / 512)) * 1024);
  SIN[k] = quad >= 2 ? -s : s;
}
export const sin = (a) => SIN[a & 1023];
export const cos = (a) => SIN[(a + 256) & 1023];

// atan for |z| <= 1, polynomial approximation (max error ~0.0015 rad, well under one WAngle).
function atanUnit(z) {
  const az = z < 0 ? -z : z;
  return z * (PI / 4) - z * (az - 1) * (0.2447 + 0.0663 * az);
}

// Angle (0..1023) of the vector (dx, dy).
export function angleOf(dx, dy) {
  if (dx === 0 && dy === 0) return 0;
  const ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
  let r = ax >= ay ? atanUnit(ay / ax) : PI / 2 - atanUnit(ax / ay);
  if (dx < 0) r = PI - r;
  if (dy < 0) r = -r;
  return Math.round(r * (512 / PI)) & 1023;
}

// Signed shortest difference b - a in (-512, 512].
export function angleDiff(a, b) {
  let d = (b - a) & 1023;
  if (d > 512) d -= 1024;
  return d;
}

export function turnToward(cur, target, step) {
  const d = angleDiff(cur, target);
  if (d <= step && d >= -step) return target & 1023;
  return (cur + (d > 0 ? step : -step)) & 1023;
}

export function isqrt(n) { return n <= 0 ? 0 : Math.floor(Math.sqrt(n)); }
export function dist(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return isqrt(dx * dx + dy * dy); }
export function distSq(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }
export function idiv(a, b) { return Math.trunc(a / b); }

export const cellOf = (v) => Math.floor(v / CELL);
export const cellCenter = (c) => c * CELL + HALF;

// "4c512" -> 4*1024 + 512. Plain integers pass through.
export function parseWDist(s) {
  s = String(s).trim();
  const m = /^(-?)(\d+)c(\d+)$/.exec(s);
  if (m) return (m[1] ? -1 : 1) * (parseInt(m[2], 10) * CELL + parseInt(m[3], 10));
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Not a number: "${s}"`);
  return Math.trunc(n);
}

export function formatWDist(v) { return `${Math.trunc(v / CELL)}c${Math.abs(v % CELL)}`; }

// Mix a value into a 32-bit hash (FNV-style). Used for sync checks.
export function hashMix(h, v) { return Math.imul(h ^ (v | 0), 0x01000193) >>> 0; }

// Deterministic float sine (used by the map generator). Range-reduces with floor + arithmetic.
export function fsin(x) {
  const TWO_PI = 2 * PI;
  x = x - Math.floor(x / TWO_PI) * TWO_PI; // [0, 2PI)
  let sign = 1;
  if (x > PI) { x -= PI; sign = -1; }
  if (x > PI / 2) x = PI - x;
  return sign * sinQuarter(x);
}
export function fhypot(dx, dy) { return Math.sqrt(dx * dx + dy * dy); }
