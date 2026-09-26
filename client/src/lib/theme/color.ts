/**
 * Color math for themes. Palettes and the custom editor speak `#rrggbb` (what
 * published palettes and `<input type="color">` use); the stylesheet speaks
 * bare `H S% L%` triples so Tailwind can append an alpha channel.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string): boolean {
  return HEX_PATTERN.test(value);
}

function hexToRgb(hex: string): Rgb {
  if (!isHexColor(hex)) {
    throw new Error(`Expected a #rrggbb color, got "${hex}"`);
  }
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number) => Math.round(value).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** `#7c3aed` → `"262 83% 58%"`, the form every `--color` variable holds. */
export function hexToHslTriple(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  const delta = max - min;

  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === rn) {
      hue = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      hue = (bn - rn) / delta + 2;
    } else {
      hue = (rn - gn) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) {
      hue += 360;
    }
  }

  const round = (value: number) => Math.round(value * 10) / 10;
  return `${round(hue)} ${round(saturation * 100)}% ${round(lightness * 100)}%`;
}

/** Linear blend in sRGB; `amount` 0 returns `from`, 1 returns `to`. */
export function mixHex(from: string, to: string, amount: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2 contrast ratio, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Whichever candidate reads better on `surface`. */
export function mostReadable(surface: string, candidates: readonly string[]): string {
  if (candidates.length === 0) {
    throw new Error("mostReadable needs at least one candidate");
  }
  let best = candidates[0];
  for (const candidate of candidates) {
    if (contrastRatio(surface, candidate) > contrastRatio(surface, best)) {
      best = candidate;
    }
  }
  return best;
}
