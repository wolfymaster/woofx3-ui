import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Returns true when `candidate` is a newer semver than `baseline`.
 * Compares dot-separated numeric segments; pre-release suffixes are ignored.
 */
export function isNewerVersion(candidate: string, baseline: string): boolean {
  const parse = (v: string) =>
    v
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(candidate);
  const b = parse(baseline);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai > bi) {
      return true;
    }
    if (ai < bi) {
      return false;
    }
  }
  return false;
}

export function formatUptime(startedAt: string, now: number): string {
  const startedAtMs = Date.parse(startedAt);
  const elapsedSec = Number.isFinite(startedAtMs) ? Math.max(0, Math.floor((now - startedAtMs) / 1000)) : 0;
  const hh = Math.floor(elapsedSec / 3600);
  const mm = Math.floor((elapsedSec % 3600) / 60);
  const ss = elapsedSec % 60;
  return [hh, mm, ss].map((n) => n.toString().padStart(2, "0")).join(":");
}
