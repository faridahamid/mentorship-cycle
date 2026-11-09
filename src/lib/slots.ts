export interface SlotConfig {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  dailyStart: string; // HH:MM
  dailyEnd: string;
  sessionMinutes: number;
  breakCount: number; // breaks per day
  breakMinutes: number;
  /** Optional cap on the total number of sessions across the cycle. */
  slotCount?: number | null;
}
export interface GeneratedSlot {
  idx: number;
  day: string;
  starts_at: string;
  ends_at: string;
  kind: "session" | "break";
}

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function validateSlotConfig(c: SlotConfig): string[] {
  const e: string[] = [];
  if (c.endDate < c.startDate) e.push("End date must not be before start date.");
  if (toMin(c.dailyEnd) <= toMin(c.dailyStart)) e.push("Daily end time must be after the start time.");
  if (c.sessionMinutes < 1) e.push("Session duration must be positive.");
  if (c.breakCount < 0 || c.breakMinutes < 0) e.push("Breaks cannot be negative.");
  const window = toMin(c.dailyEnd) - toMin(c.dailyStart);
  if (c.sessionMinutes + c.breakCount * c.breakMinutes > window) e.push("The daily window cannot fit one session plus the configured breaks.");
  return e;
}

function days(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  while (d <= e && out.length < 366) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Generates sessions and breaks for every day of the cycle. */
export function generateTimeSlots(c: SlotConfig): GeneratedSlot[] {
  if (validateSlotConfig(c).length) return [];
  const window = toMin(c.dailyEnd) - toMin(c.dailyStart);
  const perDayMax = Math.floor((window - c.breakCount * c.breakMinutes) / c.sessionMinutes);
  let remaining = c.slotCount ?? Infinity;
  const out: GeneratedSlot[] = [];
  let idx = 0;
  for (const day of days(c.startDate, c.endDate)) {
    if (remaining <= 0) break;
    const n = Math.min(perDayMax, remaining);
    remaining -= n;
    const breakAfter = new Set<number>();
    const breaks = n > c.breakCount ? c.breakCount : 0;
    for (let i = 1; i <= breaks; i++) breakAfter.add(Math.floor((i * n) / (breaks + 1)));
    let t = toMin(c.dailyStart);
    for (let s = 1; s <= n; s++) {
      out.push({ idx: idx++, day, starts_at: fromMin(t), ends_at: fromMin(t + c.sessionMinutes), kind: "session" });
      t += c.sessionMinutes;
      if (breakAfter.has(s) && s < n) {
        out.push({ idx: idx++, day, starts_at: fromMin(t), ends_at: fromMin(t + c.breakMinutes), kind: "break" });
        t += c.breakMinutes;
      }
    }
  }
  return out;
}

export type SlotTimeStatus = "completed" | "operating" | "upcoming";

export interface SlotLike {
  id?: string;
  idx?: number;
  day: string;
  starts_at?: string;
  ends_at?: string;
  startsAt?: string;
  endsAt?: string;
  kind?: string;
}

/**
 * Returns whether a slot is "completed", "operating", or "upcoming".
 * Handles both starts_at/ends_at (database) and startsAt/endsAt (camelCase).
 */
export function getSlotTimeStatus(
  slot: SlotLike,
  referenceTime: Date = new Date()
): SlotTimeStatus {
  const startStr = slot.starts_at ?? slot.startsAt;
  const endStr = slot.ends_at ?? slot.endsAt;
  if (!slot.day || !startStr || !endStr) return "upcoming";

  try {
    const sNorm = startStr.length === 5 ? `${startStr}:00` : startStr.slice(0, 8);
    const eNorm = endStr.length === 5 ? `${endStr}:00` : endStr.slice(0, 8);
    const start = new Date(`${slot.day}T${sNorm}`);
    const end = new Date(`${slot.day}T${eNorm}`);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return "upcoming";
    }

    const t = referenceTime.getTime();
    if (t > end.getTime()) return "completed";
    if (t >= start.getTime() && t <= end.getTime()) return "operating";
    return "upcoming";
  } catch {
    return "upcoming";
  }
}

/**
 * Given a list of slots, finds the current operating slot (if any).
 */
export function findOperatingSlot<T extends SlotLike>(
  slots: T[],
  referenceTime: Date = new Date()
): T | null {
  for (const s of slots) {
    if (getSlotTimeStatus(s, referenceTime) === "operating") {
      return s;
    }
  }
  return null;
}

