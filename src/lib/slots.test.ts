import { describe, expect, it } from "vitest";
import { generateTimeSlots, getSlotTimeStatus, findOperatingSlot } from "./slots";

describe("generateTimeSlots", () => {
  const base = { startDate: "2026-03-01", endDate: "2026-03-01", dailyStart: "09:00", dailyEnd: "13:00", sessionMinutes: 30, breakCount: 1, breakMinutes: 15 };
  it("fits sessions and a mid-day break", () => {
    const s = generateTimeSlots(base);
    expect(s.filter((x) => x.kind === "break")).toHaveLength(1);
    expect(s.filter((x) => x.kind === "session")).toHaveLength(7); // (240-15)/30
    expect(s[s.length - 1].ends_at <= "13:00").toBe(true);
  });
  it("honours slot count across days", () => {
    const s = generateTimeSlots({ ...base, endDate: "2026-03-03", slotCount: 10 });
    expect(s.filter((x) => x.kind === "session")).toHaveLength(10);
  });
  it("rejects impossible configs", () => {
    expect(generateTimeSlots({ ...base, dailyEnd: "09:10" })).toEqual([]);
  });
});

describe("getSlotTimeStatus and findOperatingSlot", () => {
  const slot1 = { id: "s1", day: "2026-11-02", starts_at: "09:00:00", ends_at: "09:45:00" };
  const slot2 = { id: "s2", day: "2026-11-02", startsAt: "10:00:00", endsAt: "10:45:00" };
  const slot3 = { id: "s3", day: "2026-11-02", starts_at: "11:00:00", ends_at: "11:45:00" };

  it("marks slot complete when time has passed", () => {
    const ref = new Date("2026-11-02T09:45:01");
    expect(getSlotTimeStatus(slot1, ref)).toBe("completed");
  });

  it("marks slot operating when time is within range", () => {
    const ref = new Date("2026-11-02T10:20:00");
    expect(getSlotTimeStatus(slot2, ref)).toBe("operating");
    expect(findOperatingSlot([slot1, slot2, slot3], ref)?.id).toBe("s2");
  });

  it("marks slot upcoming when time is before start", () => {
    const ref = new Date("2026-11-02T10:20:00");
    expect(getSlotTimeStatus(slot3, ref)).toBe("upcoming");
  });
});

