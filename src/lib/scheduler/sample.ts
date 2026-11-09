import type { MentorInput, ScheduleInput, SlotInput, TeamInput } from "./types";

export const CATEGORIES = ["AI", "GIS", "Software Development", "Data Science", "Cybersecurity", "Digital Transformation"];

/** Deterministic PRNG so tests are reproducible. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makeSlots(n: number): SlotInput[] {
  return Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, index: i }));
}

/** Realistic cycle: 12 mentors, 24 teams (1–2 categories), 2 buildings, 3 floors, 12 slots. */
export function realisticCycle(opts: { mentors?: number; teams?: number; slots?: number; mode?: "sequential" | "simultaneous"; seed?: number } = {}): ScheduleInput {
  const r = rng(opts.seed ?? 7);
  const nM = opts.mentors ?? 12;
  const nT = opts.teams ?? 24;
  const locs = [
    { building: "A", floor: 1, section: "N" },
    { building: "A", floor: 2, section: "N" },
    { building: "A", floor: 3, section: "S" },
    { building: "B", floor: 1, section: "N" },
  ];
  const mentors: MentorInput[] = Array.from({ length: nM }, (_, i) => {
    const primary = CATEGORIES[i % CATEGORIES.length];
    const cats = [primary];
    if (r() < 0.25) cats.push(CATEGORIES[Math.floor(r() * CATEGORIES.length)]);
    return { id: `m${i + 1}`, name: `Mentor ${i + 1}`, categories: [...new Set(cats)], location: locs[i % locs.length], active: true };
  });
  const teams: TeamInput[] = Array.from({ length: nT }, (_, i) => {
    const cats = [CATEGORIES[Math.floor(r() * CATEGORIES.length)]];
    if (r() < 0.4) cats.push(CATEGORIES[Math.floor(r() * CATEGORIES.length)]);
    return { id: `t${i + 1}`, name: `Team ${i + 1}`, categories: [...new Set(cats)], location: locs[Math.floor(r() * locs.length)], active: true };
  });
  return { slots: makeSlots(opts.slots ?? 12), mentors, teams, mode: opts.mode ?? "sequential", maxSimultaneous: 2 };
}

