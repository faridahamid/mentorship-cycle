import { describe, it, expect } from "vitest";

// Sanitizer helper matching mentor-management.tsx logic
function cleanToken(str: string): string {
  return str
    .replace(/^(dr\.|eng\.|mr\.|ms\.|prof\.)\s+/i, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

// Mentor credential generator matching mentor-management.tsx logic
function generateMentorCredentials(
  input: { fullName?: string; firstName?: string; lastName?: string },
  seenEmails: Map<string, number>
) {
  let fullName = "";
  let firstName = "";
  let lastName = "";

  if (input.firstName !== undefined || input.lastName !== undefined) {
    firstName = (input.firstName ?? "").trim();
    lastName = (input.lastName ?? "").trim();
    fullName = [firstName, lastName].filter(Boolean).join(" ");
  } else {
    fullName = (input.fullName ?? "").trim();
    const parts = fullName
      .replace(/^(dr\.|eng\.|mr\.|ms\.|prof\.)\s+/i, "")
      .trim()
      .split(/\s+/);
    firstName = parts[0] || "";
    lastName = parts.slice(1).join(" ") || "";
  }

  const cFirst = cleanToken(firstName);
  const cLast = cleanToken(lastName);

  // 1. Generate Email: [first].[last]@nsac.com or [first]@nsac.com
  let baseEmail = "";
  if (cFirst && cLast) {
    baseEmail = `${cFirst}.${cLast}@nsac.com`;
  } else if (cFirst) {
    baseEmail = `${cFirst}@nsac.com`;
  } else {
    baseEmail = `mentor@nsac.com`;
  }

  // Handle duplicate emails inside the file
  let finalEmail = baseEmail;
  const count = seenEmails.get(baseEmail) || 0;
  if (count > 0) {
    const atIdx = baseEmail.indexOf("@");
    finalEmail = `${baseEmail.slice(0, atIdx)}${count + 1}@nsac.com`;
  }
  seenEmails.set(baseEmail, count + 1);

  // 2. Generate Password: first name or name + 12345 (guarantee at least 8 chars)
  const namePart = cFirst || cleanToken(fullName) || "mentor";
  let password = `${namePart}12345`;
  if (password.length < 8) {
    password = `${namePart}12345678`.slice(0, 8);
  }

  return { fullName, email: finalEmail, password };
}

// 1..N category columns extraction helper matching team and mentor dynamic mappers
function extractCategoriesFromRow(
  row: Record<string, unknown>,
  categoryCols: string[]
): string[] {
  const extracted: string[] = [];
  for (const col of categoryCols) {
    if (!col) continue;
    const val = String(row[col] ?? "").trim();
    if (!val) continue;

    const parts = val.split(/[,;|\n•]+/).map((p) => p.trim()).filter(Boolean);
    for (const p of parts) {
      extracted.push(p);
    }
  }
  return Array.from(new Set(extracted));
}

describe("Mentor Email & Password Generation (@nsac.com)", () => {
  it("generates @nsac.com email from single full name and strips academic titles", () => {
    const seen = new Map<string, number>();
    const res = generateMentorCredentials({ fullName: "Dr. Ahmed Hassan" }, seen);

    expect(res.fullName).toBe("Dr. Ahmed Hassan");
    expect(res.email).toBe("ahmed.hassan@nsac.com");
    expect(res.password).toBe("ahmed12345");
    expect(res.password.length).toBeGreaterThanOrEqual(8);
  });

  it("generates @nsac.com email from split first and last name columns", () => {
    const seen = new Map<string, number>();
    const res = generateMentorCredentials(
      { firstName: "Sara", lastName: "Ibrahim" },
      seen
    );

    expect(res.fullName).toBe("Sara Ibrahim");
    expect(res.email).toBe("sara.ibrahim@nsac.com");
    expect(res.password).toBe("sara12345");
    expect(res.password.length).toBeGreaterThanOrEqual(8);
  });

  it("handles short names ensuring minimum 8 character password constraint", () => {
    const seen = new Map<string, number>();
    const res = generateMentorCredentials({ fullName: "Al Omar" }, seen);

    expect(res.email).toBe("al.omar@nsac.com");
    // "al" + 12345 = 7 chars, so it pads to 8 chars "al123456"
    expect(res.password.length).toBeGreaterThanOrEqual(8);
    expect(res.password).toBe("al123456");
  });

  it("handles duplicate mentor names with numeric deduplication suffixes", () => {
    const seen = new Map<string, number>();
    const m1 = generateMentorCredentials({ fullName: "Omar Tarek" }, seen);
    const m2 = generateMentorCredentials({ fullName: "Omar Tarek" }, seen);
    const m3 = generateMentorCredentials({ fullName: "Omar Tarek" }, seen);

    expect(m1.email).toBe("omar.tarek@nsac.com");
    expect(m2.email).toBe("omar.tarek2@nsac.com");
    expect(m3.email).toBe("omar.tarek3@nsac.com");
  });
});

describe("Dynamic Multi-Column Category Extraction (1 to N columns)", () => {
  it("extracts and deduplicates categories across single column with mixed delimiters", () => {
    const row = {
      Track: "Earth Science, AI/ML; Robotics | Planetary Systems"
    };
    const cats = extractCategoriesFromRow(row, ["Track"]);

    expect(cats).toEqual([
      "Earth Science",
      "AI/ML",
      "Robotics",
      "Planetary Systems"
    ]);
  });

  it("extracts and deduplicates categories across N distinct columns", () => {
    const row = {
      PrimaryCategory: "Climate Modeling",
      SecondaryCategory: "AI / ML",
      Track3: "Deep Space Exploration",
      Track4: "Climate Modeling" // duplicate
    };
    const cats = extractCategoriesFromRow(row, [
      "PrimaryCategory",
      "SecondaryCategory",
      "Track3",
      "Track4"
    ]);

    expect(cats).toEqual([
      "Climate Modeling",
      "AI / ML",
      "Deep Space Exploration"
    ]);
  });
});

describe("OpenDocument Spreadsheet (.ods) Parsing Support", () => {
  it("reads and parses .ods workbook files identically to .xlsx", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const wsData = [
      ["Mentor Name", "Specialty Track", "Venue Station"],
      ["Dr. Farouk El-Baz", "Earth Observation", "Main Hall Floor 1 Table 4"],
      ["Sara Ahmed", "AI/ML", "Tower Floor 2 Lab 102"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "Mentors");

    // Write as OpenDocument Spreadsheet (.ods)
    const odsBuffer = XLSX.write(wb, { bookType: "ods", type: "buffer" });
    expect(odsBuffer).toBeDefined();

    // Read back using identical SheetJS array buffer parse logic used in the importers
    const readWb = XLSX.read(odsBuffer, { type: "buffer" });
    const sheetName = readWb.SheetNames[0];
    const parsedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(readWb.Sheets[sheetName]);

    expect(parsedRows.length).toBe(2);
    expect(parsedRows[0]["Mentor Name"]).toBe("Dr. Farouk El-Baz");
    expect(parsedRows[0]["Specialty Track"]).toBe("Earth Observation");
    expect(parsedRows[1]["Mentor Name"]).toBe("Sara Ahmed");
  });
});

describe("Location Matcher (No False-Positives)", () => {
  const mockLocations = [
    { id: "loc_g012", building: "Main", floor: 1, section: "Zone B G012" },
    { id: "loc_g019", building: "Main", floor: 1, section: "Zone B G019" },
    { id: "loc_g038", building: "Main", floor: 1, section: "Zone B G038" },
    { id: "loc_f008", building: "Main", floor: 1, section: "Zone E F008" },
    { id: "loc_f011", building: "Main", floor: 1, section: "Zone E F011" },
  ];

  it("correctly matches team Ecosphere to G038 instead of G012 when Zone B and G038 are provided", async () => {
    const { matchLocation } = await import("./location-matcher");
    const matched = matchLocation("Zone B", "G038", mockLocations);
    expect(matched).toBe("loc_g038");
    expect(matched).not.toBe("loc_g012");
  });

  it("matches by room code alone when zone is not provided", async () => {
    const { matchLocation } = await import("./location-matcher");
    const matched = matchLocation("", "G038", mockLocations);
    expect(matched).toBe("loc_g038");
  });

  it("does not false-match G012 if an unknown room in Zone B is given", async () => {
    const { matchLocation } = await import("./location-matcher");
    const matched = matchLocation("Zone B", "G999", mockLocations);
    expect(matched).toBeNull();
  });

  it("matches zone when no room is specified", async () => {
    const { matchLocation } = await import("./location-matcher");
    const matched = matchLocation("Zone E", "", mockLocations);
    expect(matched).toBe("loc_f008");
  });
});
