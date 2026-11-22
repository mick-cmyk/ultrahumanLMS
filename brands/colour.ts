// Colour helpers. A brand supplies one primary colour; everything else the UI
// needs (text on it, a readable version for text on white, a pale tint) is
// derived here and checked against WCAG contrast, so a brand file cannot
// accidentally produce white text on yellow.

type RGB = [number, number, number];

const INK = '#14161a';
const WHITE = '#ffffff';

export function isHex6(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function parse(hex: string): RGB {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

function toHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function luminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parse(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(from: string, to: string, amount: number): string {
  const a = parse(from);
  const b = parse(to);
  return toHex(a.map((v, i) => v + (b[i] - v) * amount) as RGB);
}

/** Whichever of white or ink reads better on top of this colour. */
export function textOn(hex: string): string {
  return contrast(hex, WHITE) >= contrast(hex, INK) ? WHITE : INK;
}

/** The brand colour, darkened just enough to be readable as text on `bg` (4.5:1). */
export function inkFor(hex: string, bg: string = WHITE, min = 4.5): string {
  let out = hex;
  for (let i = 0; i < 40 && contrast(out, bg) < min; i++) out = mix(out, '#000000', 0.06);
  return out;
}

/** Page background in dark mode. Must match --surface in app/globals.css. */
export const DARK_SURFACE = '#0f1115';

/** The brand colour, lightened just enough to be readable as text on a dark background. */
export function lightInkFor(hex: string, bg: string = DARK_SURFACE, min = 4.5): string {
  let out = hex;
  for (let i = 0; i < 40 && contrast(out, bg) < min; i++) out = mix(out, WHITE, 0.08);
  return out;
}

export type BrandTokens = {
  /** Fills: buttons, bars, the header accent. */
  brand: string;
  /** Text and icons that sit on a brand fill. */
  brandFg: string;
  /** Brand-coloured text and focus rings on white. Always at least 4.5:1. */
  brandInk: string;
  /** Pale tint for highlighted rows and banners. */
  brandSoft: string;
  /** brandInk for dark mode: readable on the dark page background. */
  brandInkDark: string;
  /** brandSoft for dark mode: a deep tint instead of a pale one. */
  brandSoftDark: string;
};

export function deriveTokens(primary: string): BrandTokens {
  return {
    brand: primary,
    brandFg: textOn(primary),
    brandInk: inkFor(primary),
    brandSoft: mix(primary, WHITE, 0.92),
    brandInkDark: lightInkFor(primary),
    brandSoftDark: mix(primary, DARK_SURFACE, 0.82),
  };
}
