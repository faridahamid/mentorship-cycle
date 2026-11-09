import { describe, expect, it } from "vitest";
import { getFullLocationKey, getZoneKey, locationColor } from "./utils";

describe("locationColor & getFullLocationKey", () => {
  it("extracts full location keys combining building, floor, zone, and room", () => {
    expect(getFullLocationKey({ section: "Zone B G019", floor: 1, building: "Main" })).toBe("Main · F1 · Zone B G019");
    expect(getFullLocationKey({ section: "Zone D F011", floor: 1, building: "Main" })).toBe("Main · F1 · Zone D F011");
    expect(getFullLocationKey({ section: "Zone E F008", floor: 1, building: "Main" })).toBe("Main · F1 · Zone E F008");
    expect(getFullLocationKey({ section: "Room 101", floor: 2, building: "Main" })).toBe("Main · F2 · Room 101");
    expect(getFullLocationKey({ floor: 3, building: "Main" })).toBe("Main · F3");
    expect(getFullLocationKey(null)).toBe("No Location");
    expect(getZoneKey({ section: "Zone B G019", floor: 1, building: "Main" })).toBe("Main · F1 · Zone B G019");
  });

  it("provides distinct, deterministic colors for different rooms and stations", () => {
    const colorB1 = locationColor({ section: "Zone B G019", floor: 1, building: "Main" });
    const colorB2 = locationColor({ section: "Zone B G038", floor: 1, building: "Main" });
    const colorD = locationColor({ section: "Zone D F011", floor: 1, building: "Main" });
    const colorE = locationColor({ section: "Zone E F008", floor: 1, building: "Main" });
    const colorNull = locationColor(null);

    // Each distinct room/station has a unique color (not just one color per zone)
    expect(colorB1).not.toBe(colorB2);
    expect(colorB1).not.toBe(colorD);
    expect(colorD).not.toBe(colorE);
    expect(colorNull).toBe("#64748b");

    // Identical locations produce identical colors
    expect(locationColor({ section: "Zone B G019", floor: 1, building: "Main" })).toBe(colorB1);
    expect(locationColor({ section: "Zone B G038", floor: 1, building: "Main" })).toBe(colorB2);
  });
});

