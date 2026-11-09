"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  MapPin,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  Users2,
  XCircle
} from "lucide-react";
import * as XLSX from "xlsx";
import { saveLocation, deleteLocation, deleteAllLocations, importLocations } from "@/app/actions/admin";
import { downloadExcel, type Table } from "@/lib/export";
import { Modal, Msg, Pagination } from "@/components/ui";

export interface LocationWithUsage {
  id: string;
  building: string;
  floor: number;
  section: string;
  mentorsCount: number;
  teamsCount: number;
}

export function formatLocationFullAddress(loc: { building: string; floor: number; section: string }): string {
  return `${loc.building} · Floor ${loc.floor}${loc.section ? " · " + loc.section : ""}`;
}

export function LocationManagement({ locations }: { locations: LocationWithUsage[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"address_asc" | "address_desc" | "floor_asc" | "floor_desc" | "teams" | "mentors">("address_asc");
  const [modalOpen, setModalOpen] = useState(false);
  const [building, setBuilding] = useState("Main Venue");
  const [floor, setFloor] = useState(1);
  const [zone, setZone] = useState("");
  const [room, setRoom] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [delOpen, setDelOpen] = useState(false);
  const [targetLoc, setTargetLoc] = useState<LocationWithUsage | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);

  // Filtered and Sorted Locations by Full Address Lettering Position
  const filteredAndSortedLocations = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = locations.filter((loc) => {
      if (!q) return true;
      const full = formatLocationFullAddress(loc).toLowerCase();
      return (
        full.includes(q) ||
        loc.building.toLowerCase().includes(q) ||
        `floor ${loc.floor}`.includes(q) ||
        `f${loc.floor}`.includes(q) ||
        (loc.section && loc.section.toLowerCase().includes(q))
      );
    });

    return list.sort((a, b) => {
      if (sortBy === "address_desc") {
        return formatLocationFullAddress(b).localeCompare(formatLocationFullAddress(a), undefined, {
          numeric: true,
          sensitivity: "base"
        });
      }
      if (sortBy === "floor_asc") {
        if (a.floor !== b.floor) return a.floor - b.floor;
        return (a.section || "").localeCompare(b.section || "", undefined, {
          numeric: true,
          sensitivity: "base"
        });
      }
      if (sortBy === "floor_desc") {
        if (a.floor !== b.floor) return b.floor - a.floor;
        return (a.section || "").localeCompare(b.section || "", undefined, {
          numeric: true,
          sensitivity: "base"
        });
      }
      if (sortBy === "teams") return b.teamsCount - a.teamsCount;
      if (sortBy === "mentors") return b.mentorsCount - a.mentorsCount;

      // Default: "address_asc"
      // Natural lettering position: Building A -> Building B -> Floor 1 Zone A -> Floor 1 Zone B -> Floor 2 Zone A -> Floor 2 Zone B
      const bld = a.building.localeCompare(b.building, undefined, {
        numeric: true,
        sensitivity: "base"
      });
      if (bld !== 0) return bld;
      if (a.floor !== b.floor) return a.floor - b.floor;
      return (a.section || "").localeCompare(b.section || "", undefined, {
        numeric: true,
        sensitivity: "base"
      });
    });
  }, [locations, search, sortBy]);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedLocations.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const pagedLocations = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedLocations.slice(start, start + pageSize);
  }, [filteredAndSortedLocations, currentPage, pageSize]);

  // Dynamic Excel / ODS Bulk Import state
  const [importOpen, setImportOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [buildingCol, setBuildingCol] = useState("");
  const [floorCol, setFloorCol] = useState("");
  const [zoneCol, setZoneCol] = useState("");
  const [roomCol, setRoomCol] = useState("");
  const [importReport, setImportReport] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    const s = [zone.trim(), room.trim()].filter(Boolean).join(" ");
    const r = await saveLocation({
      building: building.trim(),
      floor: Number(floor),
      section: s
    });
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setModalOpen(false);
      setZone("");
      setRoom("");
      router.refresh();
    }
  }

  async function handleConfirmDelete() {
    if (!targetLoc) return;
    setLoading(true);
    setErr(null);
    const r = await deleteLocation(targetLoc.id);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setDelOpen(false);
      setTargetLoc(null);
      router.refresh();
    }
  }

  async function handleConfirmDeleteAll() {
    setLoading(true);
    setErr(null);
    const r = await deleteAllLocations();
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setDeleteAllOpen(false);
      router.refresh();
    }
  }

  /* ────────── Dynamic Location Excel Importer ────────── */
  function openImport() {
    setErr(null);
    setImportReport(null);
    setFileName("");
    setRawRows([]);
    setDetectedColumns([]);
    setBuildingCol("");
    setFloorCol("");
    setZoneCol("");
    setRoomCol("");
    setImportOpen(true);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setImportReport(null);
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const sheetName = wb.SheetNames[0];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" });
      setRawRows(json);

      const colsSet = new Set<string>();
      for (const row of json.slice(0, 20)) {
        Object.keys(row).forEach((k) => colsSet.add(k));
      }
      const cols = Array.from(colsSet);
      setDetectedColumns(cols);

      const lowerCols = cols.map((c) => ({ original: c, lower: c.toLowerCase() }));

      // Auto-detect columns
      const bMatch = lowerCols.find((c) => c.lower.includes("building") || c.lower.includes("venue") || c.lower === "location");
      const fMatch = lowerCols.find((c) => c.lower.includes("floor") || c.lower.includes("level"));
      const zMatch = lowerCols.find((c) => c.lower.includes("zone") || c.lower.includes("area") || c.lower.includes("wing"));
      const rMatch = lowerCols.find((c) => c.lower.includes("room") || c.lower.includes("table") || c.lower.includes("lab") || c.lower.includes("section") || c.lower.includes("hall"));

      setBuildingCol(bMatch ? bMatch.original : cols[0] || "");
      setFloorCol(fMatch ? fMatch.original : "");
      setZoneCol(zMatch ? zMatch.original : "");
      setRoomCol(rMatch ? rMatch.original : "");
    } catch (ex: unknown) {
      setErr((ex as Error)?.message || "Failed to parse spreadsheet.");
    }
  }

  const parsedData = useMemo(() => {
    if (!rawRows.length || !buildingCol) return { rows: [], duplicatesCount: 0 };

    const seen = new Set<string>();
    const existingKeys = new Set(
      locations.map((l) => `${l.building.toLowerCase()}|${l.floor}|${(l.section || "").toLowerCase()}`)
    );

    interface ParsedLocRow {
      idx: number;
      building: string;
      floor: number;
      zone: string;
      room: string;
      section: string;
      status: "ready" | "duplicate" | "missing_building";
    }

    const rows: ParsedLocRow[] = [];
    let duplicatesCount = 0;

    rawRows.forEach((raw, i) => {
      const b = String(raw[buildingCol] ?? "").trim();
      const rawFloor = floorCol ? raw[floorCol] : 1;
      const f = typeof rawFloor === "number" ? rawFloor : parseInt(String(rawFloor).replace(/[^0-9-]/g, ""), 10) || 1;
      const z = zoneCol ? String(raw[zoneCol] ?? "").trim() : "";
      const r = roomCol ? String(raw[roomCol] ?? "").trim() : "";
      const s = [z, r].filter(Boolean).join(" ");

      const key = `${b.toLowerCase()}|${f}|${s.toLowerCase()}`;

      let status: ParsedLocRow["status"] = "ready";
      if (!b) {
        status = "missing_building";
      } else if (seen.has(key) || existingKeys.has(key)) {
        status = "duplicate";
        duplicatesCount++;
      }
      seen.add(key);

      rows.push({
        idx: i + 1,
        building: b,
        floor: f,
        zone: z,
        room: r,
        section: s,
        status
      });
    });

    return { rows, duplicatesCount };
  }, [rawRows, buildingCol, floorCol, zoneCol, roomCol, locations]);

  async function handleStartImport() {
    if (!parsedData.rows.length) return setErr("No rows parsed from file.");
    setLoading(true);
    setErr(null);
    setImportReport(null);

    try {
      const valid = parsedData.rows.filter((r) => r.status === "ready").map((r) => ({
        building: r.building,
        floor: r.floor,
        section: r.section
      }));

      if (!valid.length) throw new Error("No eligible new locations to insert.");

      const res = await importLocations(valid);
      setLoading(false);
      if (!res.ok) {
        setErr(res.error);
      } else {
        setImportReport(`Successfully imported ${res.summary.inserted} stations (${res.summary.duplicates} duplicates skipped).`);
        router.refresh();
      }
    } catch (ex: unknown) {
      setLoading(false);
      setErr((ex as Error)?.message || String(ex));
    }
  }

  function downloadSample() {
    const sample = [
      { Building: "Main Building", Floor: 1, Zone: "Zone A", Room: "Table 01" },
      { Building: "Main Building", Floor: 1, Zone: "Zone A", Room: "Table 02" },
      { Building: "Engineering Tower", Floor: 2, Zone: "Zone B", Room: "Robotics Lab" },
      { Building: "Innovation Hub", Floor: 3, Zone: "Zone C", Room: "Auditorium" }
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stations");
    XLSX.writeFile(wb, "locations_import_sample.xlsx");
  }

  async function handleExport() {
    const table: Table = {
      title: "NASA Space Apps Cairo - Station Locations",
      headers: ["Full Address", "Building", "Floor", "Zone & Room / Section", "Mentors Stationed", "Teams Stationed"],
      rows: filteredAndSortedLocations.map((l) => [
        formatLocationFullAddress(l),
        l.building,
        `Floor ${l.floor}`,
        l.section || "—",
        l.mentorsCount,
        l.teamsCount
      ])
    };
    await downloadExcel("nsac_station_locations", [table]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="searchBox">
            <Search className="h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search address (Floor 1, Zone B, Main)..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <select
            className="input !w-auto !py-1.5 !text-xs font-mono"
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as "address_asc" | "address_desc" | "floor_asc" | "floor_desc" | "teams" | "mentors");
              setPage(1);
            }}
          >
            <option value="address_asc">Sort: Full Address (A → Z, Floor 1 first)</option>
            <option value="address_desc">Sort: Full Address (Z → A)</option>
            <option value="floor_asc">Sort: Floor (1 → 9)</option>
            <option value="floor_desc">Sort: Floor (9 → 1)</option>
            <option value="teams">Sort: Most Teams Stationed</option>
            <option value="mentors">Sort: Most Mentors Stationed</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {locations.length > 0 && (
            <button
              onClick={() => {
                setErr(null);
                setDeleteAllOpen(true);
              }}
              className="btn text-xs text-red-400 border-red-500/30 hover:bg-red-500/10 hover:border-red-500/50"
              title="Delete All Stations"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-400" /> Delete All Stations
            </button>
          )}
          <button onClick={handleExport} className="btn text-xs">
            <Download className="h-3.5 w-3.5 text-cyan" /> Export Excel
          </button>
          <button onClick={openImport} className="btn text-xs">
            <Upload className="h-3.5 w-3.5 text-orange" /> Dynamic Excel Import
          </button>
          <button onClick={() => { setErr(null); setModalOpen(true); }} className="btn-primary text-xs font-bold">
            <Plus className="h-4 w-4" /> Add Station
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <span className="eyebrow !mb-0">
          REGISTERED STATIONS ({filteredAndSortedLocations.length})
        </span>
        <span className="font-mono text-xs text-muted">
          Sorted by: <b className="text-cyan">{sortBy.replace("_", " ").toUpperCase()}</b>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pagedLocations.map((loc) => (
          <div
            key={loc.id}
            className="panel p-4.5 transition-all hover:border-white/25 flex flex-col justify-between group"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-cyan/10 border border-cyan/30 flex items-center justify-center text-cyan shrink-0">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-cream m-0 leading-snug break-words" title={formatLocationFullAddress(loc)}>
                      {formatLocationFullAddress(loc)}
                    </h3>
                    <div className="font-mono text-xs text-cyan mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="chip border border-cyan/30 bg-cyan/10 text-cyan text-[10px] font-bold">
                        Floor {loc.floor}
                      </span>
                      {loc.section && (
                        <span className="chip border border-amber/30 bg-amber/10 text-amber text-[10px] font-bold">
                          {loc.section}
                        </span>
                      )}
                      <span className="text-muted text-[10px]">Venue: {loc.building}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setTargetLoc(loc);
                    setErr(null);
                    setDelOpen(true);
                  }}
                  className="p-1.5 text-muted hover:text-red-400 rounded-lg hover:bg-white/5 transition opacity-80 group-hover:opacity-100 shrink-0"
                  title="Delete location"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-4 flex items-center gap-4 font-mono text-[11px] text-[#969bc4]">
                <div className="flex items-center gap-1.5">
                  <Users2 className="h-3.5 w-3.5 text-cyan" />
                  <span>
                    <b className="text-cream">{loc.mentorsCount}</b> mentors
                  </span>
                </div>
                <span>•</span>
                <div className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-orange" />
                  <span>
                    <b className="text-cream">{loc.teamsCount}</b> teams
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between font-mono text-[10px] text-muted">
              <span>Station ID: {loc.id.slice(0, 8)}</span>
              <span className="text-emerald font-semibold">Active</span>
            </div>
          </div>
        ))}

        {!filteredAndSortedLocations.length && (
          <div className="col-span-full panel p-8 text-center font-mono text-xs text-muted">
            {search ? `No stations matching "${search}".` : "No physical locations registered. Add venue buildings, floors, and station halls."}
          </div>
        )}
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={filteredAndSortedLocations.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={[10, 25, 50, 100]}
        className="panel !py-3 !border-t-0"
      />

      {/* Add Single Location Modal */}
      <Modal
        open={modalOpen}
        onClose={() => !loading && setModalOpen(false)}
        title="Add Physical Station Location"
      >
        <form onSubmit={handleAdd} className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}

          <div className="field">
            <label className="lbl">Building / Venue Name</label>
            <input
              required
              className="input"
              value={building}
              onChange={(e) => setBuilding(e.target.value)}
              placeholder="e.g. Main Hall, Engineering Tower, Campus Building A"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="field">
              <label className="lbl">Floor Number</label>
              <input
                required
                type="number"
                className="input"
                value={floor}
                onChange={(e) => setFloor(parseInt(e.target.value, 10) || 0)}
              />
            </div>
            <div className="field">
              <label className="lbl">Zone (Optional)</label>
              <input
                className="input"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                placeholder="e.g. Zone A, West Hall"
              />
            </div>
            <div className="field">
              <label className="lbl">Room / Table</label>
              <input
                className="input"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="e.g. Room 101, Table 04"
              />
            </div>
          </div>

          <div className="p-3 rounded-xl border border-cyan/30 bg-cyan/10 font-mono text-xs flex items-center justify-between">
            <span className="text-muted">Full Address Preview:</span>
            <span className="text-cyan font-bold">
              {[building.trim() || "Main Venue", `Floor ${floor || 1}`, zone.trim(), room.trim()].filter(Boolean).join(" · ")}
            </span>
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
            <button
              type="button"
              disabled={loading}
              onClick={() => setModalOpen(false)}
              className="btn"
            >
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "Adding..." : "Add Location"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Location Modal */}
      <Modal
        open={delOpen}
        onClose={() => !loading && setDelOpen(false)}
        title="Delete Location"
      >
        <div className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}
          <p className="text-sm text-cream">
            Are you sure you want to remove <b>{targetLoc?.building} (Floor {targetLoc?.floor} {targetLoc?.section ? `• ${targetLoc?.section}` : ""})</b>?
          </p>
          <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
            <button
              type="button"
              disabled={loading}
              onClick={() => setDelOpen(false)}
              className="btn"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleConfirmDelete}
              className="btn btn-danger"
            >
              {loading ? "Deleting..." : "Delete Location"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete All Stations Confirmation Modal */}
      <Modal
        open={deleteAllOpen}
        onClose={() => !loading && setDeleteAllOpen(false)}
        title="Delete All Station Locations"
      >
        <div className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}
          <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-300 space-y-1">
            <div className="font-bold text-red-200">Warning: Destructive Bulk Operation</div>
            <p>
              Are you sure you want to permanently delete <b>ALL {locations.length} station locations</b>? Any mentors or teams currently assigned to these locations will be unassigned (floating).
            </p>
          </div>
          <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
            <button
              type="button"
              disabled={loading}
              onClick={() => setDeleteAllOpen(false)}
              className="btn"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleConfirmDeleteAll}
              className="btn btn-danger"
            >
              {loading ? "Deleting All Stations..." : `Yes, Delete All ${locations.length} Stations`}
            </button>
          </div>
        </div>
      </Modal>

      {/* Dynamic Excel Bulk Importer for Locations */}
      <Modal
        open={importOpen}
        onClose={() => !loading && setImportOpen(false)}
        title="Dynamic Location Spreadsheet Importer"
        extraWide
      >
        <div className="space-y-5">
          {err && <Msg kind="error">{err}</Msg>}
          {importReport && <Msg kind="ok">{importReport}</Msg>}

          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-line bg-white/[0.02]">
            <div className="text-xs text-muted">
              Upload any spreadsheet containing venue buildings, floors, or rooms. Map columns dynamically!
            </div>
            <button
              type="button"
              onClick={downloadSample}
              className="btn !py-1.5 !px-3 text-xs"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-cyan" /> Download Sample Excel
            </button>
          </div>

          <div className="field">
            <div className="flex items-center justify-between">
              <label className="lbl">Select Spreadsheet (.xlsx, .xls, .ods, .csv)</label>
              {fileName && <span className="font-mono text-[11px] text-cyan">{fileName}</span>}
            </div>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.ods"
              onChange={handleFileUpload}
              className="input file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:bg-cyan/20 file:text-cyan file:text-xs file:font-semibold"
            />
          </div>

          {rawRows.length > 0 && (
            <div className="space-y-4 pt-2 border-t border-line">
              <span className="eyebrow !mb-0">MAP EXCEL COLUMNS</span>

              <div className="grid gap-3 sm:grid-cols-4 p-3.5 rounded-xl border border-line/80 bg-black/20">
                <div className="field">
                  <label className="lbl text-cream font-bold">Building Column</label>
                  <select
                    className="input font-mono text-xs"
                    value={buildingCol}
                    onChange={(e) => setBuildingCol(e.target.value)}
                  >
                    <option value="">-- Choose Column --</option>
                    {detectedColumns.map((c) => (
                      <option key={c} value={c}>
                        &quot;{c}&quot;
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="lbl">Floor Column (Optional)</label>
                  <select
                    className="input font-mono text-xs"
                    value={floorCol}
                    onChange={(e) => setFloorCol(e.target.value)}
                  >
                    <option value="">Default to Floor 1</option>
                    {detectedColumns.map((c) => (
                      <option key={c} value={c}>
                        &quot;{c}&quot;
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="lbl">Zone Column</label>
                  <select
                    className="input font-mono text-xs"
                    value={zoneCol}
                    onChange={(e) => setZoneCol(e.target.value)}
                  >
                    <option value="">None / Open Area</option>
                    {detectedColumns.map((c) => (
                      <option key={c} value={c}>
                        &quot;{c}&quot;
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="lbl text-cream font-bold">Room / Table Column</label>
                  <select
                    className="input font-mono text-xs"
                    value={roomCol}
                    onChange={(e) => setRoomCol(e.target.value)}
                  >
                    <option value="">None / Open Room</option>
                    {detectedColumns.map((c) => (
                      <option key={c} value={c}>
                        &quot;{c}&quot;
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Preview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="eyebrow !mb-0">
                    PREVIEW (FIRST {Math.min(6, parsedData.rows.length)} LOCATIONS)
                  </span>
                  <span className="font-mono text-xs text-emerald font-bold">
                    {parsedData.rows.filter((r) => r.status === "ready").length} Ready to Import
                  </span>
                </div>

                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-line bg-white/[0.04] text-left text-muted">
                        <th className="p-2">#</th>
                        <th className="p-2">Building</th>
                        <th className="p-2">Floor</th>
                        <th className="p-2">Zone</th>
                        <th className="p-2">Room / Table</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {parsedData.rows.slice(0, 6).map((r) => (
                        <tr key={r.idx} className="hover:bg-white/[0.02]">
                          <td className="p-2 text-muted">{r.idx}</td>
                          <td className="p-2 font-bold text-cream">{r.building}</td>
                          <td className="p-2 text-cyan">Floor {r.floor}</td>
                          <td className="p-2 text-orange font-mono">{r.zone || "—"}</td>
                          <td className="p-2 text-muted font-mono">{r.room || r.section || "—"}</td>
                          <td className="p-2">
                            {r.status === "ready" ? (
                              <span className="text-emerald flex items-center gap-1 font-bold">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                              </span>
                            ) : (
                              <span className="text-amber flex items-center gap-1 font-bold">
                                <XCircle className="h-3.5 w-3.5" /> Skip
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
            <button
              type="button"
              disabled={loading}
              onClick={() => setImportOpen(false)}
              className="btn"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loading || !parsedData.rows.length || !buildingCol}
              onClick={handleStartImport}
              className="btn-primary"
            >
              {loading
                ? "Importing..."
                : `Import ${parsedData.rows.filter((r) => r.status === "ready").length} Stations`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
