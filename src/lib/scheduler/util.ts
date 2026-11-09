import type { Loc, MentorInput, TeamInput } from "./types";

export function locationDistance(a?: Loc, b?: Loc): number {
  if (!a || !b) return 0;
  let d = 0;
  if ((a.building ?? "").trim().toLowerCase() !== (b.building ?? "").trim().toLowerCase()) d += 6;
  d += Math.min(Math.abs((a.floor ?? 0) - (b.floor ?? 0)), 5);
  const sA = (a.section ?? "").trim().toLowerCase();
  const sB = (b.section ?? "").trim().toLowerCase();
  if (sA && sB && sA !== sB) {
    const zA = sA.match(/zone\s*([a-z0-9]+)/i)?.[1]?.toLowerCase();
    const zB = sB.match(/zone\s*([a-z0-9]+)/i)?.[1]?.toLowerCase();
    if (zA && zB && zA !== zB) d += 2; // Different zones
    else d += 0.5;                      // Same zone, adjacent desk/room
  }
  return d;
}

/** Compares locations hierarchically: Building -> Floor -> Section (natural numeric order). */
export function compareLocations(a?: Loc, b?: Loc): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const bA = (a.building ?? "").toLowerCase();
  const bB = (b.building ?? "").toLowerCase();
  if (bA !== bB) return bA.localeCompare(bB);
  const fA = a.floor ?? 0;
  const fB = b.floor ?? 0;
  if (fA !== fB) return fA - fB;
  const sA = (a.section ?? "").toLowerCase();
  const sB = (b.section ?? "").toLowerCase();
  return sA.localeCompare(sB, undefined, { numeric: true });
}

export function isEligible(m: MentorInput, t: TeamInput): boolean {
  return m.categories.some((c) => t.categories.includes(c));
}

