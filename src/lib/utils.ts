import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

const PALETTE = ["#e4572e", "#2e86ab", "#f3a712", "#29a96b", "#8e5bd6", "#d1478c", "#1f7a8c", "#bf6b04"];
export const colorFor = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

export const fmtTime = (t: string) => t.slice(0, 5);

export interface LocationLike {
  building?: string;
  floor?: number;
  section?: string;
}

export function locLabel(l?: LocationLike | null): string {
  return l ? `${l.building} · Floor ${l.floor}${l.section ? " · " + l.section : ""}` : "—";
}

/**
 * Extracts the full location key combining all available parts:
 * building, floor, zone, and room/section.
 * e.g. "Main · F1 · Zone B G019"
 */
export function getFullLocationKey(l?: LocationLike | null): string {
  if (!l) return "No Location";
  const parts: string[] = [];
  if (l.building && l.building.trim()) parts.push(l.building.trim());
  if (l.floor !== undefined && l.floor !== null) parts.push(`F${l.floor}`);
  if (l.section && l.section.trim()) parts.push(l.section.trim());
  return parts.length > 0 ? parts.join(" · ") : "Unassigned";
}

// Backwards-compatible alias
export const getZoneKey = getFullLocationKey;

function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function locationColor(l?: LocationLike | null): string {
  if (!l) return "#64748b"; // muted slate for teams without location
  const key = getFullLocationKey(l);
  if (key === "No Location" || key === "Unassigned") return "#64748b";
  const hue = fnv1a(key) % 360;
  return hslToHex(hue, 75, 45);
}
