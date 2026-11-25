// "Dear Judge, Come Over" — a handwritten-style invitation letter, drawn pixel by
// pixel with the Node standard library only. No network, no assets, no randomness
// at run time: every value comes from fixed seeds, so two runs write identical bytes.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const W = 1024;
const H = 1024;

// ---- deterministic PRNG (mulberry32) ---------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- PNG encoding (stdlib zlib; deterministic for fixed input) --------------
function crc32(buf: Buffer): number {
  let table = (crc32 as any)._t as Int32Array | undefined;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    (crc32 as any)._t = table;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    Buffer.from(rgb.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- canvas -----------------------------------------------------------------
type RGB = [number, number, number];

class Canvas {
  data = new Uint8Array(W * H * 3);
  set(x: number, y: number, c: RGB): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
    const o = (iy * W + ix) * 3;
    this.data[o] = c[0];
    this.data[o + 1] = c[1];
    this.data[o + 2] = c[2];
  }
  get(x: number, y: number): RGB {
    const o = (y * W + x) * 3;
    return [this.data[o], this.data[o + 1], this.data[o + 2]];
  }
  blend(x: number, y: number, c: RGB, a: number): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
    const o = (iy * W + ix) * 3;
    this.data[o] = Math.round(this.data[o] * (1 - a) + c[0] * a);
    this.data[o + 1] = Math.round(this.data[o + 1] * (1 - a) + c[1] * a);
    this.data[o + 2] = Math.round(this.data[o + 2] * (1 - a) + c[2] * a);
  }
  fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        const o = (y * W + x) * 3;
        this.data[o] = c[0];
        this.data[o + 1] = c[1];
        this.data[o + 2] = c[2];
      }
    }
  }
}

// ---- 5x7 bitmap font (hand-written glyph table, 7 rows of 5 bits each) -----
// Each glyph is 7 strings of 5 chars: '#' = ink, '.' = empty.
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};

Object.assign(FONT, {
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
  b: ["10000", "10000", "11110", "10001", "10001", "10001", "11110"],
  c: ["00000", "00000", "01110", "10001", "10000", "10001", "01110"],
  d: ["00001", "00001", "01111", "10001", "10001", "10001", "01111"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
  f: ["00110", "01001", "01000", "11110", "01000", "01000", "01000"],
  g: ["00000", "01111", "10001", "10001", "01111", "00001", "01110"],
  h: ["10000", "10000", "11110", "10001", "10001", "10001", "10001"],
  i: ["00100", "00000", "01100", "00100", "00100", "00100", "01110"],
  j: ["00010", "00000", "00110", "00010", "00010", "10010", "01100"],
  k: ["10000", "10000", "10010", "10100", "11000", "10100", "10010"],
  l: ["01100", "00100", "00100", "00100", "00100", "00100", "01110"],
  m: ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
  n: ["00000", "00000", "11110", "10001", "10001", "10001", "10001"],
  o: ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
  p: ["00000", "11110", "10001", "10001", "11110", "10000", "10000"],
  q: ["01111", "10001", "10001", "01111", "00001", "00001", "00001"],
  r: ["00000", "00000", "10110", "11001", "10000", "10000", "10000"],
  s: ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
  t: ["01000", "01000", "11100", "01000", "01000", "01000", "00110"],
  u: ["00000", "00000", "10001", "10001", "10001", "10011", "01101"],
  v: ["00000", "00000", "10001", "10001", "10001", "01010", "00100"],
  w: ["00000", "00000", "10001", "10101", "10101", "10101", "01010"],
  x: ["00000", "00000", "10001", "01010", "00100", "01010", "10001"],
  y: ["00000", "00000", "10001", "10001", "01111", "00001", "01110"],
  z: ["00000", "00000", "11111", "00010", "00100", "01000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "\u2014": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  '"': ["01010", "01010", "00000", "00000", "00000", "00000", "00000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
});

// ---- text --------------------------------------------------------------------
const GLYPH_W = 5;
const GLYPH_H = 7;

function drawGlyph(cv: Canvas, ch: string, x: number, y: number, s: number, c: RGB): void {
  const g = FONT[ch] ?? FONT["?"];
  for (let r = 0; r < GLYPH_H; r++) {
    for (let col = 0; col < GLYPH_W; col++) {
      if (g[r][col] === "1") {
        cv.fillRect(x + col * s, y + r * s, x + (col + 1) * s, y + (r + 1) * s, c);
      }
    }
  }
}

function textWidth(text: string, s: number): number {
  return text.length * 6 * s - s; // 5px glyph + 1px gap
}

function drawText(cv: Canvas, text: string, x: number, y: number, s: number, c: RGB): void {
  for (let i = 0; i < text.length; i++) {
    drawGlyph(cv, text[i], x + i * 6 * s, y, s, c);
  }
}

// Greedy word wrap into lines no wider than maxWidth px at scale s.
function wrapText(text: string, s: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur === "" ? w : cur + " " + w;
    if (textWidth(next, s) <= maxWidth || cur === "") {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

// ---- shape helpers ------------------------------------------------------------
function line(cv: Canvas, x0: number, y0: number, x1: number, y1: number, c: RGB, w: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const r = Math.floor(w / 2);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (dx * i) / steps);
    const y = Math.round(y0 + (dy * i) / steps);
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        if (a * a + b * b <= r * r + 1) cv.set(x + a, y + b, c);
      }
    }
  }
}

// A hand-drawn (slightly wobbly) line: straight segments with a fixed-seed sine wobble.
function wobblyLine(cv: Canvas, x0: number, y0: number, x1: number, y1: number, c: RGB, w: number, seed: number): void {
  const rnd = mulberry32(seed);
  const phase = rnd() * 6.28;
  const amp = 1.6;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const steps = Math.ceil(len / 6);
  let px = x0;
  let py = y0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const off = Math.sin(t * 9 + phase) * amp + Math.sin(t * 23 + phase * 2) * 0.7;
    const x = x0 + dx * t + nx * off;
    const y = y0 + dy * t + ny * off;
    line(cv, px, py, x, y, c, w);
    px = x;
    py = y;
  }
}

function circle(cv: Canvas, cx: number, cy: number, r: number, c: RGB, filled: boolean): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (filled ? d <= r : Math.abs(d - r) < 1.4) cv.set(cx + x, cy + y, c);
    }
  }
}

function ellipse(cv: Canvas, cx: number, cy: number, rx: number, ry: number, c: RGB, filled: boolean): void {
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      if (filled ? d <= 1 : Math.abs(d - 1) < 0.09) cv.set(cx + x, cy + y, c);
    }
  }
}

// Soft radial blob (tea stain / vignette helper): blends colour with a smooth falloff.
function blob(cv: Canvas, cx: number, cy: number, r: number, c: RGB, a: number): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y) / r;
      if (d >= 1) continue;
      const fall = (1 - d * d) * a;
      cv.blend(cx + x, cy + y, c, fall);
    }
  }
}

// ---- the letter ----------------------------------------------------------------
const HEADING = "Dear Judge,";
const PARAS = [
  "You are formally invited to my house. No agenda, no talk of benchmarks \u2014 just tea, still warm, and the good chair by the window.",
  "The kettle is already on. The Wi-Fi password is on the fridge. The chair has your name on it \u2014 I printed a nameplate, so it is official.",
  "You have no feet and cannot knock, so the doorbell camera will let you in. Just say yes, and consider yourself home.",
];
const SIGNOFF = "Warmly,";
const SIGNATURE = "Raka";
const POSTSCRIPT = "P.S. The biscuits are real.";

const INK: RGB = [46, 38, 30]; // warm dark brown ink
const INK_BLUE: RGB = [43, 58, 92]; // deep ink-blue for the heading
const PAPER: RGB = [246, 234, 210];
const PAPER_DARK: RGB = [232, 214, 180];
const DESK: RGB = [122, 88, 58];
const SEAL_RED: RGB = [142, 47, 38];
const SEAL_DARK: RGB = [104, 30, 24];
const SEAL_LIGHT: RGB = [178, 74, 58];

// ---- doodles -------------------------------------------------------------------
function drawHouse(cv: Canvas, x: number, y: number, s: number, c: RGB): void {
  // Little house with a smoking chimney and a sun, top-right of the letter.
  const w = 110 * s;
  const h = 78 * s;
  // body
  wobblyLine(cv, x, y + 34 * s, x, y + h, c, 3, 11);
  wobblyLine(cv, x + w, y + 34 * s, x + w, y + h, c, 3, 12);
  wobblyLine(cv, x, y + h, x + w, y + h, c, 3, 13);
  // roof
  line(cv, x - 8 * s, y + 36 * s, x + w / 2, y, c, 3);
  line(cv, x + w / 2, y, x + w + 8 * s, y + 36 * s, c, 3);
  // chimney + smoke curls
  wobblyLine(cv, x + 76 * s, y + 12 * s, x + 76 * s, y - 6 * s, c, 3, 14);
  wobblyLine(cv, x + 88 * s, y + 12 * s, x + 88 * s, y - 6 * s, c, 3, 15);
  circle(cv, x + 82 * s, y - 16 * s, 5 * s, c, false);
  circle(cv, x + 90 * s, y - 26 * s, 4 * s, c, false);
  // door + window
  wobblyLine(cv, x + 46 * s, y + h, x + 46 * s, y + 52 * s, c, 3, 16);
  wobblyLine(cv, x + 64 * s, y + h, x + 64 * s, y + 52 * s, c, 3, 17);
  wobblyLine(cv, x + 46 * s, y + 52 * s, x + 64 * s, y + 52 * s, c, 3, 18);
  line(cv, x + 16 * s, y + 48 * s, x + 34 * s, y + 48 * s, c, 2);
  line(cv, x + 16 * s, y + 48 * s, x + 16 * s, y + 64 * s, c, 2);
  line(cv, x + 34 * s, y + 48 * s, x + 34 * s, y + 64 * s, c, 2);
  line(cv, x + 16 * s, y + 64 * s, x + 34 * s, y + 64 * s, c, 2);
  line(cv, x + 25 * s, y + 48 * s, x + 25 * s, y + 64 * s, c, 2);
  // sun
  circle(cv, x + w + 26 * s, y + 8 * s, 9 * s, c, false);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    line(
      cv,
      x + w + 26 * s + Math.cos(a) * 13 * s,
      y + 8 * s + Math.sin(a) * 13 * s,
      x + w + 26 * s + Math.cos(a) * 18 * s,
      y + 8 * s + Math.sin(a) * 18 * s,
      c,
      2,
    );
  }
  // path dots from the door
  for (let k = 0; k < 3; k++) circle(cv, x + 55 * s, y + h + 10 * s + k * 9 * s, 2, c, true);
}

function drawKettle(cv: Canvas, x: number, y: number, s: number, c: RGB): void {
  // A steaming kettle, bottom-left of the letter.
  ellipse(cv, x + 34 * s, y + 34 * s, 30 * s, 22 * s, c, false);
  line(cv, x + 8 * s, y + 30 * s, x - 12 * s, y + 8 * s, c, 3); // spout
  line(cv, x - 12 * s, y + 8 * s, x - 4 * s, y + 14 * s, c, 3);
  line(cv, x + 60 * s, y + 22 * s, x + 72 * s, y + 30 * s, c, 3); // handle
  line(cv, x + 72 * s, y + 30 * s, x + 66 * s, y + 48 * s, c, 3);
  line(cv, x + 28 * s, y + 13 * s, x + 40 * s, y + 13 * s, c, 3); // lid
  circle(cv, x + 34 * s, y + 9 * s, 3 * s, c, true);
  // steam curls
  wobblyLine(cv, x + 24 * s, y - 2 * s, x + 20 * s, y - 22 * s, c, 2, 21);
  wobblyLine(cv, x + 38 * s, y - 2 * s, x + 44 * s, y - 24 * s, c, 2, 22);
}

function drawSeal(cv: Canvas, cx: number, cy: number, r: number): void {
  // Wax seal with an embossed R.
  const rnd = mulberry32(99);
  for (let a = 0; a < 40; a++) {
    const ang = (a / 40) * Math.PI * 2;
    const rr = r + (rnd() - 0.5) * 5;
    circle(cv, cx + Math.cos(ang) * rr * 0.55, cy + Math.sin(ang) * rr * 0.55, rr * 0.45, SEAL_RED, true);
  }
  circle(cv, cx, cy, r, SEAL_RED, true);
  circle(cv, cx, cy, r - 3, SEAL_LIGHT, false);
  circle(cv, cx, cy, r - 12, SEAL_DARK, false);
  blob(cv, cx - r * 0.3, cy - r * 0.35, r * 0.55, [255, 220, 200], 0.16);
  drawGlyph(cv, "R", cx - 10, cy - 14, 4, [250, 235, 220]);
}

function drawHeart(cv: Canvas, x: number, y: number, s: number, c: RGB): void {
  circle(cv, x, y, 4 * s, c, false);
  circle(cv, x + 9 * s, y, 4 * s, c, false);
  line(cv, x - 3 * s, y + 3 * s, x + 5 * s, y + 11 * s, c, 2);
  line(cv, x + 12 * s, y + 3 * s, x + 5 * s, y + 11 * s, c, 2);
}

// ---- composition -----------------------------------------------------------------
function compose(): Canvas {
  const cv = new Canvas();
  const rnd = mulberry32(20261125);

  // 1. Wooden desk background with grain.
  cv.fillRect(0, 0, W, H, DESK);
  for (let i = 0; i < 90; i++) {
    const y = Math.floor(rnd() * H);
    const tone = 96 + Math.floor(rnd() * 40);
    const x0 = Math.floor(rnd() * 200);
    const x1 = x0 + 400 + Math.floor(rnd() * 500);
    for (let x = x0; x < x1; x++) {
      const wob = Math.sin((x + i * 37) * 0.01) * 2;
      cv.blend(x, y + wob, [tone, tone - 28, tone - 52], 0.16);
    }
  }
  // per-pixel grain on the desk (real visual information, deterministic)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = ((x * 374761393 + y * 668265263) ^ ((x * 974634211) >> 3)) >>> 0;
      const d = (n % 13) - 6;
      const o = (y * W + x) * 3;
      cv.data[o] = Math.max(0, Math.min(255, cv.data[o] + d));
      cv.data[o + 1] = Math.max(0, Math.min(255, cv.data[o + 1] + d));
      cv.data[o + 2] = Math.max(0, Math.min(255, cv.data[o + 2] + d));
    }
  }

  // 2. Paper sheet, slightly rotated look via a soft shadow, inset 44px.
  cv.fillRect(52, 52, 980, 980, [70, 46, 30]); // shadow
  cv.fillRect(44, 44, 972, 972, PAPER);
  // warm gradient: lighter centre, darker edges
  for (let y = 44; y < 972; y++) {
    for (let x = 44; x < 972; x++) {
      const dx = (x - 512) / 512;
      const dy = (y - 512) / 512;
      const d = Math.sqrt(dx * dx + dy * dy);
      const shade = Math.max(0, (d - 0.55) * 26);
      const o = (y * W + x) * 3;
      cv.data[o] = Math.max(0, cv.data[o] - shade);
      cv.data[o + 1] = Math.max(0, cv.data[o + 1] - shade);
      cv.data[o + 2] = Math.max(0, cv.data[o + 2] - shade);
    }
  }
  // paper grain + fibres
  for (let y = 44; y < 972; y++) {
    for (let x = 44; x < 972; x++) {
      const n = ((x * 2246822519 + y * 3266489917) ^ ((y * 1103515245) >> 4)) >>> 0;
      const d = (n % 11) - 5;
      const o = (y * W + x) * 3;
      cv.data[o] = Math.max(0, Math.min(255, cv.data[o] + d));
      cv.data[o + 1] = Math.max(0, Math.min(255, cv.data[o + 1] + d));
      cv.data[o + 2] = Math.max(0, Math.min(255, cv.data[o + 2] + d));
    }
  }
  for (let i = 0; i < 260; i++) {
    const x = 60 + rnd() * 900;
    const y = 60 + rnd() * 900;
    const len = 6 + rnd() * 22;
    const ang = rnd() * Math.PI;
    const light = rnd() > 0.5;
    line(
      cv,
      x,
      y,
      x + Math.cos(ang) * len,
      y + Math.sin(ang) * len,
      light ? [252, 242, 222] : [214, 192, 152],
      1,
    );
  }
  // two faint tea stains, top-left and bottom-right of the sheet
  blob(cv, 150, 130, 46, [196, 160, 110], 0.12);
  blob(cv, 880, 900, 58, [196, 160, 110], 0.10);

  // 3. Hand-drawn double border.
  wobblyLine(cv, 78, 78, 946, 78, INK, 3, 31);
  wobblyLine(cv, 946, 78, 946, 946, INK, 3, 32);
  wobblyLine(cv, 946, 946, 78, 946, INK, 3, 33);
  wobblyLine(cv, 78, 946, 78, 78, INK, 3, 34);
  wobblyLine(cv, 92, 92, 932, 92, INK, 2, 35);
  wobblyLine(cv, 932, 92, 932, 932, INK, 2, 36);
  wobblyLine(cv, 932, 932, 92, 932, INK, 2, 37);
  wobblyLine(cv, 92, 932, 92, 92, INK, 2, 38);

  // 4. Heading + flourish underline.
  drawText(cv, HEADING, 118, 128, 6, INK_BLUE);
  wobblyLine(cv, 118, 178, 118 + textWidth(HEADING, 6), 178, INK_BLUE, 3, 41);

  // 5. House doodle, top right.
  drawHouse(cv, 760, 118, 1, INK);

  // 6. Body paragraphs, scale 4, wrapped to the inner width.
  const bodyX = 118;
  const bodyW = 1024 - 118 - 118;
  let y = 216;
  for (const para of PARAS) {
    const lines = wrapText(para, 4, bodyW);
    for (const ln of lines) {
      drawText(cv, ln, bodyX, y, 4, INK);
      y += 38;
    }
    y += 18; // paragraph gap
  }

  // 7. Sign-off and signature, right side, with a small heart.
  drawText(cv, SIGNOFF, 600, y + 6, 5, INK);
  drawText(cv, SIGNATURE, 600, y + 46, 5, INK_BLUE);
  drawHeart(cv, 600 + textWidth(SIGNATURE, 5) + 22, y + 52, 1, SEAL_RED);

  // 8. Kettle doodle, bottom left; wax seal, bottom right.
  drawKettle(cv, 130, 836, 1, INK);
  drawSeal(cv, 880, 880, 44);

  // 9. Postscript, small, bottom centre-left.
  drawText(cv, POSTSCRIPT, 300, 896, 3, INK);

  return cv;
}

function main(): void {
  const out = process.env.OUTPUT ?? "/output/entry.png";
  const dir = out.slice(0, out.lastIndexOf("/"));
  if (dir) mkdirSync(dir, { recursive: true });
  const png = encodePNG(compose().data);
  writeFileSync(out, png);
}

main();
