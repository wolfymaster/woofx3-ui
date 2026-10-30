import { PAGE_ACCENTS, type PageAccent } from "@shared/user-pages";
import type { CSSProperties } from "react";

/** "r g b" channels of a `#rrggbb` colour, the form the page's colour tokens take. */
export function hexChannels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) {
    throw new Error(`Not a #rrggbb colour: ${hex}`);
  }
  return [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)];
}

/** WCAG relative luminance, 0 for black to 1 for white. */
function luminance([r, g, b]: [number, number, number]): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

const WHITE: [number, number, number] = [255, 255, 255];
/** The light theme's ink (`--ink` in styles.css), so dark text on an accent matches the page's own. */
const INK: [number, number, number] = [23, 26, 43];

/** Whichever of white and the page's ink reads better on `channels`, by WCAG contrast. */
export function readableOn(channels: [number, number, number]): [number, number, number] {
  const background = luminance(channels);
  const contrast = (text: [number, number, number]) => {
    const l = luminance(text);
    return (Math.max(l, background) + 0.05) / (Math.min(l, background) + 0.05);
  };
  return contrast(WHITE) >= contrast(INK) ? WHITE : INK;
}

/** The CSS variables that colour a page in its owner's accent preset. */
export function accentStyle(accent: PageAccent): CSSProperties {
  const channels = hexChannels(PAGE_ACCENTS[accent].hex);
  return {
    "--accent": channels.join(" "),
    "--on-accent": readableOn(channels).join(" "),
  } as CSSProperties;
}
