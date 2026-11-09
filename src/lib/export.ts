import type { CycleData } from "@/lib/cycle-model";
import type { Analytics } from "@/lib/analytics";

export interface StyledCell {
  text: string | number;
  color?: string; // Text hex color e.g. "#ffffff" or "#0F172A"
  bg?: string;    // Background hex color e.g. "#3b82f6"
  bold?: boolean;
  align?: "left" | "center" | "right";
}

export type CellValue = string | number | StyledCell;

export interface Table {
  title: string;
  subtitle?: string;
  themeColor?: string; // Hex color for header/theme accents e.g. "#0c1033" or category color
  headers: string[];
  rows: CellValue[][];
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return [r, g, b];
  }
  const num = parseInt(clean || "000000", 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** Determines whether a background hex color is light or dark to ensure readable contrast */
export function isLightColor(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 155;
}

export function slotLabel(s: { day: string; starts_at: string; ends_at: string }) {
  return `${s.day.slice(5)} ${s.starts_at.slice(0, 5)}-${s.ends_at.slice(0, 5)}`;
}

/** Mentor × slot matrix with vibrant category styling and break/absent badges */
export function scheduleTable(
  d: CycleData,
  opts?: { catFilter?: string; q?: string; title?: string; themeColor?: string; filterMentorIds?: Set<string> }
): Table {
  const catMap = new Map(d.categories.map((c) => [c.id, c]));
  const loc = new Map(
    d.locations.map((l) => [l.id, `${l.building} · Fl ${l.floor}${l.section ? " · " + l.section : ""}`])
  );
  const team = new Map(
    d.teams.map((t) => {
      const locStr = t.location_id ? loc.get(t.location_id) : "";
      const label = locStr ? `${t.team_name} [${locStr}]` : t.team_name;
      return [t.id, label];
    })
  );
  const cell = new Map<string, string[]>();
  for (const a of d.assignments) {
    const k = `${a.cycle_mentor_id}|${a.slot_id}`;
    cell.set(k, [...(cell.get(k) ?? []), team.get(a.cycle_team_id) ?? "?"]);
  }
  const unav = new Set(d.mAvail.map((a) => `${a.cycle_mentor_id}|${a.slot_id}|${a.reason}`));
  const slots = d.slots;

  let mentors = d.mentors.filter((m) => m.status !== "removed");
  if (opts?.filterMentorIds) {
    mentors = mentors.filter((m) => opts.filterMentorIds!.has(m.id));
  }
  if (opts?.catFilter) {
    mentors = mentors.filter((m) => m.categories.includes(opts.catFilter!));
  }
  if (opts?.q) {
    const ql = opts.q.toLowerCase();
    mentors = mentors.filter(
      (m) =>
        m.mentor_name.toLowerCase().includes(ql) ||
        m.categories.some((c) => catMap.get(c)?.name.toLowerCase().includes(ql))
    );
  }

  const rows: CellValue[][] = mentors.map((m) => {
    let total = 0;
    const primCat = m.categories[0] ? catMap.get(m.categories[0]) : null;
    const catBadges = m.categories.map((c) => catMap.get(c)?.name ?? "").filter(Boolean).join(", ");

    const catCell: StyledCell = primCat
      ? {
          text: catBadges,
          bg: primCat.color,
          color: isLightColor(primCat.color) ? "#0f172a" : "#ffffff",
          bold: true,
          align: "center",
        }
      : { text: catBadges, align: "center" };

    const slotCells: CellValue[] = slots.map((s) => {
      if (s.kind === "break") {
        return { text: "BREAK", bg: "#fef3c7", color: "#b45309", bold: true, align: "center" };
      }
      if (m.status === "absent" || unav.has(`${m.id}|${s.id}|absent`)) {
        return { text: "ABSENT", bg: "#fee2e2", color: "#b91c1c", bold: true, align: "center" };
      }
      if (unav.has(`${m.id}|${s.id}|break`)) {
        return { text: "BREAK", bg: "#fef3c7", color: "#b45309", bold: true, align: "center" };
      }
      const v = cell.get(`${m.id}|${s.id}`);
      if (v) total += v.length;
      return v && v.length > 0
        ? { text: v.join(" + "), align: "left" }
        : { text: "—", color: "#94a3b8", align: "center" };
    });

    const mentorCell: StyledCell = { text: m.mentor_name, bold: true, align: "left" };
    const locCell: StyledCell = {
      text: m.location_id ? loc.get(m.location_id) ?? "—" : "—",
      color: "#475569",
      align: "center",
    };
    const totalCell: StyledCell = {
      text: total,
      bold: true,
      align: "center",
      bg: "#f1f5f9",
    };

    return [mentorCell, catCell, locCell, ...slotCells, totalCell];
  });

  return {
    title: opts?.title ?? `${d.cycle.name} – Mentors Schedule`,
    themeColor: opts?.themeColor,
    headers: [
      "Mentor",
      "Specialty Categories",
      "Location",
      ...slots.map((s) => slotLabel(s) + (s.kind === "break" ? " (Break)" : "")),
      "Total Teams",
    ],
    rows,
  };
}

/** Team × session matrix with category colors */
export function teamScheduleTable(
  d: CycleData,
  opts?: { catFilter?: string; q?: string; title?: string }
): Table {
  const catMap = new Map(d.categories.map((c) => [c.id, c]));
  const loc = new Map(
    d.locations.map((l) => [l.id, `${l.building} · Fl ${l.floor}${l.section ? " · " + l.section : ""}`])
  );
  const mentor = new Map(
    d.mentors.map((m) => {
      const mLoc = m.location_id ? loc.get(m.location_id) : "";
      return [m.id, mLoc ? `${m.mentor_name} [${mLoc}]` : m.mentor_name];
    })
  );
  const cell = new Map<string, string[]>();
  for (const a of d.assignments) {
    cell.set(
      `${a.cycle_team_id}|${a.slot_id}`,
      [...(cell.get(`${a.cycle_team_id}|${a.slot_id}`) ?? []), mentor.get(a.cycle_mentor_id) ?? "?"]
    );
  }
  const sessions = d.slots.filter((s) => s.kind === "session");

  let teams = d.teams.filter((t) => t.status !== "removed");
  if (opts?.catFilter) {
    teams = teams.filter((t) => t.categories.includes(opts.catFilter!));
  }
  if (opts?.q) {
    const ql = opts.q.toLowerCase();
    teams = teams.filter(
      (t) =>
        t.team_name.toLowerCase().includes(ql) ||
        t.categories.some((c) => catMap.get(c)?.name.toLowerCase().includes(ql))
    );
  }

  const rows: CellValue[][] = teams.map((t) => {
    let total = 0;
    const primCat = t.categories[0] ? catMap.get(t.categories[0]) : null;
    const catBadges = t.categories.map((c) => catMap.get(c)?.name ?? "").filter(Boolean).join(", ");

    const catCell: StyledCell = primCat
      ? {
          text: catBadges,
          bg: primCat.color,
          color: isLightColor(primCat.color) ? "#0f172a" : "#ffffff",
          bold: true,
          align: "center",
        }
      : { text: catBadges, align: "center" };

    const slotCells: CellValue[] = sessions.map((s) => {
      const v = cell.get(`${t.id}|${s.id}`);
      if (v) total += v.length;
      return v && v.length > 0
        ? { text: v.join(" + "), align: "left" }
        : { text: "—", color: "#94a3b8", align: "center" };
    });

    const teamCell: StyledCell = { text: t.team_name, bold: true, align: "left" };
    const locCell: StyledCell = {
      text: t.location_id ? loc.get(t.location_id) ?? "—" : "—",
      color: "#475569",
      align: "center",
    };
    const totalCell: StyledCell = {
      text: total,
      bold: true,
      align: "center",
      bg: "#f1f5f9",
    };

    return [teamCell, catCell, locCell, ...slotCells, totalCell];
  });

  return {
    title: opts?.title ?? `${d.cycle.name} – Teams Schedule`,
    headers: [
      "Team",
      "Categories",
      "Station Location",
      ...sessions.map(slotLabel),
      "Total Mentors",
    ],
    rows,
  };
}

/** Multiple tables/sheets grouped by Category */
export function categoryScheduleTables(
  d: CycleData,
  opts?: { catFilter?: string; q?: string }
): Table[] {
  let categories = d.categories;
  if (opts?.catFilter) {
    categories = categories.filter((c) => c.id === opts.catFilter);
  }

  const tables: Table[] = [];

  for (const cat of categories) {
    const mentorIdsInCat = new Set(
      d.mentors
        .filter((m) => m.status !== "removed" && m.categories.includes(cat.id))
        .map((m) => m.id)
    );

    if (mentorIdsInCat.size === 0) continue;

    const t = scheduleTable(d, {
      ...opts,
      title: `${cat.name} (${mentorIdsInCat.size} Mentors)`,
      themeColor: cat.color,
      filterMentorIds: mentorIdsInCat,
    });
    tables.push(t);
  }

  if (tables.length === 0) {
    tables.push(scheduleTable(d, opts));
  }
  return tables;
}

/** Multiple tables/sheets grouped by Location */
export function locationScheduleTables(
  d: CycleData,
  opts?: { catFilter?: string; q?: string }
): Table[] {
  const locMap = new Map(
    d.locations.map((l) => [l.id, `${l.building} · Fl ${l.floor}${l.section ? " · " + l.section : ""}`])
  );

  const locGroups = new Map<string, Set<string>>();
  for (const m of d.mentors) {
    if (m.status === "removed") continue;
    const lStr = m.location_id ? locMap.get(m.location_id) ?? "Unassigned Station" : "Unassigned Station";
    if (!locGroups.has(lStr)) locGroups.set(lStr, new Set());
    locGroups.get(lStr)!.add(m.id);
  }

  const sortedLocations = [...locGroups.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  const tables: Table[] = [];
  for (const lStr of sortedLocations) {
    const mIds = locGroups.get(lStr)!;
    tables.push(
      scheduleTable(d, {
        ...opts,
        title: `${lStr} (${mIds.size} Mentors)`,
        filterMentorIds: mIds,
      })
    );
  }
  if (tables.length === 0) tables.push(scheduleTable(d, opts));
  return tables;
}

/** Agenda organized chronologically by Time Slot */
export function slotScheduleTable(
  d: CycleData,
  opts?: { catFilter?: string; q?: string }
): Table {
  const catMap = new Map(d.categories.map((c) => [c.id, c]));
  const loc = new Map(
    d.locations.map((l) => [l.id, `${l.building} · Fl ${l.floor}${l.section ? " · " + l.section : ""}`])
  );
  const mentorMap = new Map(d.mentors.map((m) => [m.id, m]));
  const teamMap = new Map(d.teams.map((t) => [t.id, t]));

  const rows: CellValue[][] = [];

  for (const slot of d.slots) {
    const slotTitle = `Slot ${slot.idx + 1}: ${slotLabel(slot)}${slot.kind === "break" ? " (Break)" : ""}`;
    const asgs = d.assignments.filter((a) => a.slot_id === slot.id);

    if (slot.kind === "break") {
      rows.push([
        { text: slotTitle, bg: "#fef3c7", color: "#b45309", bold: true },
        { text: "ALL PARTICIPANTS ON BREAK", bg: "#fef3c7", color: "#b45309", bold: true },
        "",
        "",
        "",
        "",
      ]);
      continue;
    }

    if (asgs.length === 0) {
      rows.push([
        { text: slotTitle, bold: true },
        { text: "No assignments scheduled", color: "#94a3b8" },
        "",
        "",
        "",
        "",
      ]);
      continue;
    }

    for (const a of asgs) {
      const m = mentorMap.get(a.cycle_mentor_id);
      const t = teamMap.get(a.cycle_team_id);
      if (!m || !t) continue;
      if (opts?.catFilter && !m.categories.includes(opts.catFilter) && !t.categories.includes(opts.catFilter)) continue;

      const primCat = m.categories[0] ? catMap.get(m.categories[0]) : null;
      const catCell: StyledCell = primCat
        ? {
            text: catMap.get(primCat.id)?.name ?? "",
            bg: primCat.color,
            color: isLightColor(primCat.color) ? "#0f172a" : "#ffffff",
            bold: true,
            align: "center",
          }
        : { text: "—", align: "center" };

      rows.push([
        slotTitle,
        m.mentor_name,
        catCell,
        m.location_id ? loc.get(m.location_id) ?? "—" : "—",
        t.team_name,
        t.location_id ? loc.get(t.location_id) ?? "—" : "—",
      ]);
    }
  }

  return {
    title: `${d.cycle.name} – By Time Slot`,
    headers: ["Time Slot", "Mentor", "Category", "Mentor Location", "Assigned Team", "Team Location"],
    rows,
  };
}

/** Dispatches the export tables organized according to the user's active screen view */
export function buildExportForView(
  d: CycleData,
  view: "mentor" | "team" | "category" | "location" | "slot",
  opts?: { catFilter?: string; q?: string }
): Table[] {
  switch (view) {
    case "category": {
      const catTables = categoryScheduleTables(d, opts);
      catTables.push(teamScheduleTable(d, opts));
      return catTables;
    }
    case "team": {
      return [teamScheduleTable(d, opts), scheduleTable(d, opts)];
    }
    case "location": {
      const locTables = locationScheduleTables(d, opts);
      locTables.push(teamScheduleTable(d, opts));
      return locTables;
    }
    case "slot": {
      return [slotScheduleTable(d, opts), scheduleTable(d, opts), teamScheduleTable(d, opts)];
    }
    case "mentor":
    default: {
      return [scheduleTable(d, opts), teamScheduleTable(d, opts)];
    }
  }
}

export function analyticsTables(a: Analytics, name: string): Table[] {
  return [
    { title: `${name} – Summary`, headers: ["Metric", "Value"], rows: [["Teams", a.totals.teams], ["Mentors", a.totals.mentors], ["Sessions", a.totals.sessions], ["Assignments", a.totals.assignments], ["Schedule completion %", Math.round(a.completion * 100)], ["Mentor exposure %", Math.round(a.coverage * 100)], ["Workload spread", a.workloadSpread], ["Unassigned teams", a.unassignedTeams.length], ["Absences", a.absences], ["Breaks", a.breaks]] },
    { title: "Mentor Workload", headers: ["Mentor", "Sessions", "Unique teams", "Absent slots", "Break slots", "Attendance %"], rows: a.mentorLoad.map((m) => [m.name, m.sessions, m.uniqueTeams, m.absentSlots, m.breakSlots, Math.round(m.attendance * 100)]) },
    { title: "Team Coverage", headers: ["Team", "Unique mentors met", "Eligible mentors", "Sessions"], rows: a.teamCoverage.map((t) => [t.name, t.met, t.eligible, t.sessions]) },
    { title: "Issues", headers: ["Severity", "Type", "Message"], rows: a.issues.map((i) => [i.severity, i.type, i.message]) },
  ];
}

/** Downloads a beautiful, multi-colored Excel workbook with custom fills, headers, and borders */
export async function downloadExcel(filename: string, tables: Table[]) {
  const mod = await import("xlsx-js-style");
  // Handle both ESM default and CommonJS module shapes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX: any = (mod as any).default ?? mod;
  const wb = XLSX.utils.book_new();

  const usedSheetNames = new Set<string>();

  tables.forEach((t, i) => {
    const rawHeaders = t.headers.map((h) => String(h));
    const rawRows = t.rows.map((row) =>
      row.map((cell) => (typeof cell === "object" && cell !== null && "text" in cell ? cell.text : cell ?? ""))
    );

    const ws = XLSX.utils.aoa_to_sheet([rawHeaders, ...rawRows]);

    const headerBg = t.themeColor ? t.themeColor.replace("#", "") : "0C1033";
    const headerTextColor = t.themeColor
      ? isLightColor(t.themeColor)
        ? "0F172A"
        : "FFFFFF"
      : "00E5FF";

    // Style Header Row (row index 0)
    rawHeaders.forEach((_, colIdx) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIdx });
      if (ws[cellRef]) {
        ws[cellRef].s = {
          fill: { fgColor: { rgb: headerBg.toUpperCase() } },
          font: { name: "Calibri", sz: 11, bold: true, color: { rgb: headerTextColor } },
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
          border: {
            top: { style: "thin", color: { rgb: "CBD5E1" } },
            bottom: { style: "medium", color: { rgb: "94A3B8" } },
            left: { style: "thin", color: { rgb: "CBD5E1" } },
            right: { style: "thin", color: { rgb: "CBD5E1" } },
          },
        };
      }
    });

    // Style Data Rows
    t.rows.forEach((row, rIdx) => {
      const rowIndex = rIdx + 1;
      const isEven = rIdx % 2 === 0;
      const defaultBg = isEven ? "FFFFFF" : "F8FAFC";

      row.forEach((cell, cIdx) => {
        const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: cIdx });
        if (!ws[cellRef]) return;

        let bg = defaultBg;
        let color = "1E293B";
        let bold = false;
        let align: "left" | "center" | "right" = cIdx === 0 ? "left" : "center";

        if (typeof cell === "object" && cell !== null && "text" in cell) {
          if (cell.bg) bg = cell.bg.replace("#", "");
          if (cell.color) color = cell.color.replace("#", "");
          if (cell.bold !== undefined) bold = cell.bold;
          if (cell.align) align = cell.align;
        } else {
          const valStr = String(cell ?? "");
          if (valStr === "BREAK") {
            bg = "FEF3C7"; // Amber 100
            color = "B45309"; // Amber 700
            bold = true;
          } else if (valStr === "ABSENT") {
            bg = "FEE2E2"; // Red 100
            color = "B91C1C"; // Red 700
            bold = true;
          }
        }

        ws[cellRef].s = {
          fill: { fgColor: { rgb: bg.toUpperCase() } },
          font: { name: "Calibri", sz: 10, bold, color: { rgb: color.toUpperCase() } },
          alignment: { horizontal: align, vertical: "center", wrapText: true },
          border: {
            top: { style: "thin", color: { rgb: "E2E8F0" } },
            bottom: { style: "thin", color: { rgb: "E2E8F0" } },
            left: { style: "thin", color: { rgb: "E2E8F0" } },
            right: { style: "thin", color: { rgb: "E2E8F0" } },
          },
        };
      });
    });

    // Column widths
    ws["!cols"] = rawHeaders.map((h, c) => {
      const maxLen = Math.max(
        h.length,
        ...rawRows.slice(0, 100).map((r) => String(r[c] ?? "").length)
      );
      return { wch: Math.min(42, Math.max(12, maxLen + 3)) };
    });

    let baseName = t.title;
    if (baseName.includes(" – ")) {
      baseName = baseName.split(" – ").pop() || baseName;
    } else if (baseName.includes(" - ")) {
      baseName = baseName.split(" - ").pop() || baseName;
    }
    let sheetName = baseName.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || `Sheet ${i + 1}`;
    if (usedSheetNames.has(sheetName.toLowerCase())) {
      sheetName = `${sheetName.slice(0, 24)} (${i + 1})`;
    }
    usedSheetNames.add(sheetName.toLowerCase());

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : filename + ".xlsx");
}

/** Downloads a beautiful, multi-colored PDF with banners, category badges, and clean typography */
export async function downloadPdf(filename: string, tables: Table[]) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const wide = tables.some((t) => t.headers.length > 7);
  const doc = new jsPDF({
    orientation: wide ? "landscape" : "portrait",
    unit: "pt",
    format: wide ? "a3" : "a4",
  });

  tables.forEach((t, i) => {
    if (i > 0) doc.addPage();

    const pageWidth = doc.internal.pageSize.getWidth();

    // Draw stylish header banner with theme/category color
    const themeRgb: [number, number, number] = t.themeColor ? hexToRgb(t.themeColor) : [12, 16, 51];
    doc.setFillColor(themeRgb[0], themeRgb[1], themeRgb[2]);
    doc.rect(28, 20, pageWidth - 56, 36, "F");

    // Title
    const titleTextColor: [number, number, number] = t.themeColor
      ? isLightColor(t.themeColor)
        ? [15, 23, 42]
        : [255, 255, 255]
      : [0, 229, 255];
    doc.setTextColor(titleTextColor[0], titleTextColor[1], titleTextColor[2]);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(t.title, 38, 43);

    const rawHeaders = t.headers.map((h) => String(h));
    const rawBody = t.rows.map((row) =>
      row.map((cell) =>
        typeof cell === "object" && cell !== null && "text" in cell ? String(cell.text) : String(cell ?? "")
      )
    );

    autoTable(doc, {
      head: [rawHeaders],
      body: rawBody,
      startY: 64,
      theme: "grid",
      styles: {
        fontSize: 7.5,
        cellPadding: 3.5,
        lineColor: [226, 232, 240],
        lineWidth: 0.5,
        valign: "middle",
      },
      headStyles: {
        fillColor: themeRgb,
        textColor: titleTextColor,
        fontStyle: "bold",
        halign: "center",
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      didParseCell: (data) => {
        if (data.section === "body") {
          const rowData = t.rows[data.row.index];
          const cellData = rowData ? rowData[data.column.index] : null;

          if (typeof cellData === "object" && cellData !== null && "text" in cellData) {
            if (cellData.bg) data.cell.styles.fillColor = hexToRgb(cellData.bg);
            if (cellData.color) data.cell.styles.textColor = hexToRgb(cellData.color);
            if (cellData.bold) data.cell.styles.fontStyle = "bold";
            if (cellData.align) data.cell.styles.halign = cellData.align;
          } else {
            const str = String(data.cell.text || "");
            if (str === "BREAK") {
              data.cell.styles.fillColor = [254, 243, 199];
              data.cell.styles.textColor = [180, 83, 9];
              data.cell.styles.fontStyle = "bold";
              data.cell.styles.halign = "center";
            } else if (str === "ABSENT") {
              data.cell.styles.fillColor = [254, 226, 226];
              data.cell.styles.textColor = [185, 28, 28];
              data.cell.styles.fontStyle = "bold";
              data.cell.styles.halign = "center";
            }
          }
        }
      },
    });
  });

  doc.save(filename.endsWith(".pdf") ? filename : filename + ".pdf");
}
