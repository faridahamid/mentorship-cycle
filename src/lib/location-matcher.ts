export interface MatchableLocation {
  id: string;
  building: string;
  floor: number;
  section: string;
}

/**
 * Accurately resolves a team or mentor's location from parsed spreadsheet values.
 *
 * Prevents false-positive matches (such as matching "Zone B G012" when the team is in "G038").
 * Priority hierarchy:
 * 1. Exact match on normalized full section (e.g. "Zone B G038" === "Zone B G038")
 * 2. If both Zone and Room are provided, the location MUST match BOTH Zone AND Room.
 * 3. Exact Room / Table match (e.g. "G038" matches "Zone B G038")
 * 4. Full combined address match (Building + Floor + Section)
 * 5. Zone ONLY match (strictly allowed ONLY when no specific room/table was provided)
 */
export function matchLocation(
  rawZone: string,
  rawRoom: string,
  locations: MatchableLocation[]
): string | null {
  const z = (rawZone ?? "").trim();
  const r = (rawRoom ?? "").trim();
  const combined = [z, r].filter(Boolean).join(" ");
  if (!combined) return null;

  const norm = (s: string) =>
    (s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const normCombined = norm(combined);
  const normZone = norm(z);
  const normRoom = norm(r);

  // Strategy 1: Exact normalized section match
  const exactSection = locations.find((l) => norm(l.section) === normCombined);
  if (exactSection) return exactSection.id;

  // Strategy 2: If BOTH Zone and Room are provided, MUST match BOTH Zone AND Room
  // This guarantees "Zone B" + "G038" NEVER matches "Zone B G012"!
  if (normZone && normRoom) {
    const bothMatch = locations.find((l) => {
      const s = norm(l.section);
      const b = norm(l.building);
      const locText = `${b} ${s}`;
      const hasZone = locText.includes(normZone);
      const hasRoom = s.includes(normRoom);
      return hasZone && hasRoom;
    });
    if (bothMatch) return bothMatch.id;
  }

  // Strategy 3: Specific Room / Station match
  if (normRoom) {
    const roomMatch = locations.find((l) => {
      const s = norm(l.section);
      return s.includes(normRoom) || (normRoom.length >= 3 && normRoom.includes(s));
    });
    if (roomMatch) return roomMatch.id;
  }

  // Strategy 4: Full combined address substring
  const combinedSubstr = locations.find((l) => {
    const s = norm(l.section);
    const full = norm(`${l.building} floor ${l.floor} ${l.section}`);
    return s.includes(normCombined) || full.includes(normCombined) || normCombined.includes(s);
  });
  if (combinedSubstr) return combinedSubstr.id;

  // Strategy 5: Zone-only match (STRICTLY when NO Room was provided)
  // If the user specified a Room, we must not arbitrarily drop them into a different room!
  if (!normRoom && normZone) {
    const zoneOnly = locations.find((l) => {
      const s = norm(l.section);
      const b = norm(l.building);
      return s.includes(normZone) || b.includes(normZone) || normZone.includes(s);
    });
    if (zoneOnly) return zoneOnly.id;
  }

  return null;
}

