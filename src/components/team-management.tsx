"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Download,
  Edit2,
  FileSpreadsheet,
  MapPin,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  X,
  XCircle
} from "lucide-react";
import * as XLSX from "xlsx";
import { saveTeam, deleteTeam, deleteAllTeams, importTeams, ensureCategories, type ImportRow } from "@/app/actions/admin";
import { matchLocation } from "@/lib/location-matcher";
import { downloadExcel, type Table } from "@/lib/export";
import { CatChip, CategoryPicker, Modal, Msg, locLabel, Pagination } from "@/components/ui";

export interface TeamItem {
  id: string;
  name: string;
  location_id: string | null;
  info: Record<string, string>;
  created_at: string;
  categoryIds: string[];
}

export interface CategoryOption {
  id: string;
  name: string;
  color: string;
}

export interface LocationOption {
  id: string;
  building: string;
  floor: number;
  section: string;
}

export function TeamManagement({
  teams,
  categories: initialCategories,
  locations
}: {
  teams: TeamItem[];
  categories: CategoryOption[];
  locations: LocationOption[];
}) {
  const router = useRouter();
  const [extraCategories, setExtraCategories] = useState<CategoryOption[]>([]);
  const categories = useMemo(() => {
    const existingIds = new Set(initialCategories.map((c) => c.id));
    return [...initialCategories, ...extraCategories.filter((c) => !existingIds.has(c.id))];
  }, [initialCategories, extraCategories]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const catNameToId = useMemo(
    () => new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id])),
    [categories]
  );
  const locMap = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const sortedLocations = useMemo(() => {
    return [...locations].sort((a, b) => {
      const bld = a.building.localeCompare(b.building, undefined, { numeric: true, sensitivity: "base" });
      if (bld !== 0) return bld;
      if (a.floor !== b.floor) return a.floor - b.floor;
      return (a.section || "").localeCompare(b.section || "", undefined, { numeric: true, sensitivity: "base" });
    });
  }, [locations]);

  // Single Add / Edit state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selCats, setSelCats] = useState<string[]>([]);
  const [locId, setLocId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [newCatName, setNewCatName] = useState("");
  const [creatingCat, setCreatingCat] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Delete state
  const [delOpen, setDelOpen] = useState(false);
  const [delTarget, setDelTarget] = useState<TeamItem | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);

  // Dynamic Excel / CSV Import state
  const [importOpen, setImportOpen] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);

  // Dynamic Column Mapping Configuration
  const [nameCol, setNameCol] = useState<string>("");
  const [catCols, setCatCols] = useState<string[]>([""]); // 1 to N category columns!
  const [zoneCol, setZoneCol] = useState<string>("");
  const [roomCol, setRoomCol] = useState<string>("");
  const [locCol, setLocCol] = useState<string>("");
  const [infoCols, setInfoCols] = useState<string[]>([]);
  const [importReport, setImportReport] = useState<string | null>(null);

  const filteredTeams = useMemo(() => {
    const q = search.toLowerCase().trim();
    return teams.filter((t) => {
      const matchSearch =
        !q ||
        t.name.toLowerCase().includes(q) ||
        (t.info?.notes && t.info.notes.toLowerCase().includes(q));
      const matchCat = catFilter === "all" || t.categoryIds.includes(catFilter);
      return matchSearch && matchCat;
    });
  }, [teams, search, catFilter]);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const totalPages = Math.max(1, Math.ceil(filteredTeams.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const pagedTeams = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTeams.slice(start, start + pageSize);
  }, [filteredTeams, currentPage, pageSize]);

  /* ────────── Single Team Addition / Edit ────────── */
  function openCreate() {
    setEditingId(null);
    setName("");
    setSelCats(categories.length > 0 ? [categories[0].id] : []);
    setLocId("");
    setNotes("");
    setNewCatName("");
    setErr(null);
    setModalOpen(true);
  }

  function openEdit(t: TeamItem) {
    setEditingId(t.id);
    setName(t.name);
    setSelCats(t.categoryIds);
    setLocId(t.location_id || "");
    setNotes(t.info?.notes || "");
    setNewCatName("");
    setErr(null);
    setModalOpen(true);
  }

  async function handleQuickAddCategory() {
    if (!newCatName.trim()) return;
    setCreatingCat(true);
    const r = await ensureCategories([newCatName.trim()]);
    setCreatingCat(false);
    if (r.ok && r.categories) {
      setExtraCategories((prev) => [...prev, ...(r.categories ?? [])]);
      const created = r.categories.find(
        (c) => c.name.toLowerCase() === newCatName.trim().toLowerCase()
      );
      if (created && !selCats.includes(created.id)) {
        setSelCats([...selCats, created.id]);
      }
      setNewCatName("");
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setErr("Team name is required");
    if (!selCats.length) return setErr("Select at least 1 challenge track category (teams may have 1 or more).");

    setLoading(true);
    setErr(null);
    const r = await saveTeam({
      id: editingId || undefined,
      name: name.trim(),
      categoryIds: selCats,
      locationId: locId || null,
      info: notes.trim() ? { notes: notes.trim() } : {}
    });
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setModalOpen(false);
      router.refresh();
    }
  }

  async function handleConfirmDelete() {
    if (!delTarget) return;
    setLoading(true);
    setErr(null);
    const r = await deleteTeam(delTarget.id);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setDelOpen(false);
      setDelTarget(null);
      router.refresh();
    }
  }

  async function handleConfirmDeleteAll() {
    setLoading(true);
    setErr(null);
    const r = await deleteAllTeams();
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setDeleteAllOpen(false);
      router.refresh();
    }
  }

  /* ────────── Dynamic Bulk Import Logic ────────── */
  function openImportModal() {
    setErr(null);
    setImportReport(null);
    setFileName("");
    setSheetNames([]);
    setSelectedSheet("");
    setRawRows([]);
    setDetectedColumns([]);
    setNameCol("");
    setCatCols([""]);
    setZoneCol("");
    setRoomCol("");
    setLocCol("");
    setInfoCols([]);
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
      if (!wb.SheetNames.length) throw new Error("Uploaded workbook contains no sheets.");

      setSheetNames(wb.SheetNames);
      const firstSheet = wb.SheetNames[0];
      setSelectedSheet(firstSheet);
      processSheet(wb, firstSheet);
    } catch (ex: unknown) {
      setErr((ex as Error)?.message || "Failed to parse file.");
    }
  }

  function processSheet(wb: XLSX.WorkBook, sheetName: string) {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    setRawRows(json);

    // Extract headers
    const colsSet = new Set<string>();
    for (const row of json.slice(0, 20)) {
      Object.keys(row).forEach((k) => colsSet.add(k));
    }
    const cols = Array.from(colsSet);
    setDetectedColumns(cols);

    // Auto-detect best column matches
    const lowerCols = cols.map((c) => ({ original: c, lower: c.toLowerCase() }));

    // Name column auto-guess
    const nameMatch = lowerCols.find((c) =>
      c.lower.includes("team name") ||
      c.lower.includes("project name") ||
      c.lower === "team" ||
      c.lower === "name" ||
      c.lower.includes("submission")
    );
    setNameCol(nameMatch ? nameMatch.original : cols[0] || "");

    // Category columns auto-guess (find all columns mentioning track or category)
    const catMatches = lowerCols.filter((c) =>
      c.lower.includes("category") ||
      c.lower.includes("track") ||
      c.lower.includes("domain") ||
      c.lower.includes("specialty")
    );
    if (catMatches.length > 0) {
      setCatCols(catMatches.map((m) => m.original));
    } else {
      setCatCols(cols.length > 1 ? [cols[1]] : [""]);
    }

    // Zone column auto-guess
    const zoneMatch = lowerCols.find((c) =>
      c.lower === "zone" ||
      c.lower.includes("zone") ||
      c.lower.includes("area") ||
      c.lower.includes("wing")
    );
    setZoneCol(zoneMatch ? zoneMatch.original : "");

    // Room / Table column auto-guess (next to zone)
    const roomMatch = lowerCols.find((c) =>
      c.lower === "room" ||
      c.lower.includes("room") ||
      c.lower.includes("table") ||
      c.lower.includes("station") ||
      c.lower.includes("hall") ||
      c.lower.includes("lab") ||
      c.lower.includes("location")
    );
    setRoomCol(roomMatch ? roomMatch.original : "");
    setLocCol(roomMatch ? roomMatch.original : "");
  }

  function handleSheetChange(sheetName: string) {
    setSelectedSheet(sheetName);
  }

  function addCategoryColumn() {
    setCatCols([...catCols, ""]);
  }

  function removeCategoryColumn(idx: number) {
    if (catCols.length <= 1) {
      setCatCols([""]);
      return;
    }
    setCatCols(catCols.filter((_, i) => i !== idx));
  }

  function updateCategoryColumn(idx: number, colName: string) {
    const updated = [...catCols];
    updated[idx] = colName;
    setCatCols(updated);
  }

  function toggleInfoColumn(colName: string) {
    if (infoCols.includes(colName)) {
      setInfoCols(infoCols.filter((c) => c !== colName));
    } else {
      setInfoCols([...infoCols, colName]);
    }
  }

  // Parse raw rows dynamically based on the admin's column mappings
  const parsedData = useMemo(() => {
    if (!rawRows.length || !nameCol) return { rows: [], duplicatesCount: 0 };

    const existingTeamNames = new Set(teams.map((t) => t.name.trim().toLowerCase()));
    const seenInFile = new Set<string>();

    interface ParsedRow {
      idx: number;
      name: string;
      categoryNames: string[];
      categoryIds: string[];
      locationId: string | null;
      zoneRaw: string;
      roomRaw: string;
      locationRaw: string;
      info: Record<string, string>;
      status: "ready" | "duplicate" | "missing_name" | "missing_category";
      warning?: string;
    }

    const rows: ParsedRow[] = [];
    let duplicatesCount = 0;

    rawRows.forEach((raw, i) => {
      const rawName = String(raw[nameCol] ?? "").trim();

      // Extract categories across all mapped category columns (1 to N columns!)
      const extractedCatNames: string[] = [];
      for (const col of catCols) {
        if (!col) continue;
        const val = String(raw[col] ?? "").trim();
        if (!val) continue;

        // Support delimited values within a column as well (e.g. "Earth Science, AI/ML" or "Earth Science; AI/ML" or newline/pipe)
        const parts = val.split(/[,;|\n•]+/).map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          extractedCatNames.push(p);
        }
      }

      // De-duplicate categories for this team
      const uniqueCatNames = Array.from(new Set(extractedCatNames));

      // Resolve category UUIDs
      const resolvedIds: string[] = [];
      for (const cn of uniqueCatNames) {
        const id = catNameToId.get(cn.toLowerCase());
        if (id) resolvedIds.push(id);
      }

      // Zone & Room (next to Zone) extraction and Location matching
      const rawZone = zoneCol ? String(raw[zoneCol] ?? "").trim() : "";
      const rawRoom = roomCol
        ? String(raw[roomCol] ?? "").trim()
        : locCol
        ? String(raw[locCol] ?? "").trim()
        : "";
      const rawLocVal = [rawZone, rawRoom].filter(Boolean).join(" ");

      const matchedLocId = matchLocation(rawZone, rawRoom, locations);

      // Extra Info extraction
      const infoObj: Record<string, string> = {};
      for (const col of infoCols) {
        const v = String(raw[col] ?? "").trim();
        if (v) infoObj[col] = v;
      }

      // Status evaluation
      let status: ParsedRow["status"] = "ready";
      let warning: string | undefined;

      if (!rawName) {
        status = "missing_name";
        warning = "Missing team name";
      } else if (seenInFile.has(rawName.toLowerCase()) || existingTeamNames.has(rawName.toLowerCase())) {
        status = "duplicate";
        warning = "Duplicate team name (will be skipped)";
        duplicatesCount++;
      }

      seenInFile.add(rawName.toLowerCase());

      rows.push({
        idx: i + 1,
        name: rawName,
        categoryNames: uniqueCatNames,
        categoryIds: resolvedIds,
        locationId: matchedLocId,
        zoneRaw: rawZone,
        roomRaw: rawRoom,
        locationRaw: rawLocVal,
        info: infoObj,
        status,
        warning
      });
    });

    return {
      rows,
      duplicatesCount
    };
  }, [rawRows, nameCol, catCols, zoneCol, roomCol, locCol, infoCols, catNameToId, teams, locations]);

  async function handleStartImport() {
    if (!parsedData.rows.length) return setErr("No rows parsed from file.");
    setLoading(true);
    setErr(null);
    setImportReport(null);

    try {
      const currentCatMap = new Map(catNameToId);

      // Prepare payload for importTeams
      const validPayload: ImportRow[] = [];
      for (const r of parsedData.rows) {
        if (r.status === "missing_name" || r.status === "duplicate") continue;

        // Resolve all category IDs using category map
        const catIds: string[] = [];
        for (const cn of r.categoryNames) {
          const id = currentCatMap.get(cn.toLowerCase());
          if (id) catIds.push(id);
        }

        // Fallback: if no category was extracted, attach the first available category
        if (!catIds.length && categories.length > 0) {
          catIds.push(categories[0].id);
        }

        validPayload.push({
          name: r.name,
          categoryIds: [...new Set(catIds)], // 1 to N categories
          locationId: r.locationId,
          info: r.info
        });
      }

      if (!validPayload.length) {
        throw new Error("No eligible teams to insert (all rows were missing names or duplicate).");
      }

      // 3. Execute bulk import
      const res = await importTeams(validPayload);
      setLoading(false);
      if (!res.ok) {
        setErr(res.error);
      } else {
        const s = res.summary;
        setImportReport(
          `Success: ${s.inserted} teams imported with their complete categories! (${s.duplicates.length} duplicate(s) skipped, ${s.rejected.length} rejected).`
        );
        router.refresh();
      }
    } catch (ex: unknown) {
      setLoading(false);
      setErr((ex as Error)?.message || String(ex));
    }
  }

  async function handleExport() {
    const table: Table = {
      title: "NASA Space Apps Cairo 2026 - Teams",
      headers: ["Team Name", "Categories", "Location", "Notes", "Registration Date"],
      rows: teams.map((t) => [
        t.name,
        t.categoryIds.map((c) => catMap.get(c)?.name ?? "").filter(Boolean).join(", "),
        locLabel(t.location_id ? locMap.get(t.location_id) : null),
        t.info?.notes ?? "",
        new Date(t.created_at).toLocaleDateString()
      ])
    };
    await downloadExcel("nasa-space-apps-cairo-teams", [table]);
  }

  function downloadSampleExcel() {
    const sample = [
      {
        "Team Name": "Apollo 11 Rovers",
        "Primary Track": "AI / Machine Learning",
        "Secondary Track": "Robotics & Hardware",
        Zone: "Zone A",
        "Room / Table": "Room 101",
        "Team Members": "4 Cairo University engineering students",
        "Project Description": "Autonomous planetary sample return robot"
      },
      {
        "Team Name": "Solar Pulse Observers",
        "Primary Track": "Earth Observation",
        "Secondary Track": "Space Physics",
        Zone: "Zone B",
        "Room / Table": "Table 12",
        "Team Members": "Data science hackathon team",
        "Project Description": "Real-time solar coronal mass ejection early warning"
      },
      {
        "Team Name": "Deep Space Biologists",
        "Primary Track": "Life Sciences in Space",
        "Secondary Track": "",
        Zone: "Zone C",
        "Room / Table": "Lab 3",
        "Team Members": "Biotech researchers",
        "Project Description": "Hydroponic growth optimization in microgravity"
      }
    ];

    const ws = XLSX.utils.json_to_sheet(sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Teams");
    XLSX.writeFile(wb, "nasa_teams_import_sample.xlsx");
  }

  return (
    <div className="space-y-6">
      {/* Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="searchBox">
            <Search className="h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search teams by name..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <select
            className="input !w-auto !py-1.5 !text-xs font-mono"
            value={catFilter}
            onChange={(e) => {
              setCatFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All Challenge Tracks ({teams.length})</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {teams.length > 0 && (
            <button
              onClick={() => {
                setErr(null);
                setDeleteAllOpen(true);
              }}
              className="btn !py-2 !px-3 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10 hover:border-red-500/50"
              title="Delete All Teams"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-400" /> Delete All Teams
            </button>
          )}
          <button onClick={handleExport} className="btn !py-2 !px-3 text-xs" title="Export Excel">
            <Download className="h-3.5 w-3.5 text-cyan" /> Export Excel
          </button>
          <button onClick={openImportModal} className="btn !py-2 !px-3 text-xs">
            <Upload className="h-3.5 w-3.5 text-orange" /> Dynamic Excel Import
          </button>
          <button onClick={openCreate} className="btn-primary !py-2 !px-4 text-xs font-bold">
            <Plus className="h-3.5 w-3.5" /> New Team
          </button>
        </div>
      </div>

      {/* Teams Grid / Table */}
      <div className="panel overflow-hidden">
        <div className="panelHead">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-cyan" />
            <h2>Hackathon Teams ({filteredTeams.length})</h2>
          </div>
          <span className="monoLabel">{teams.length} TOTAL REGISTERED</span>
        </div>

        {filteredTeams.length > 0 ? (
          <>
            <div className="divide-y divide-line">
              {pagedTeams.map((t) => (
                <div
                  key={t.id}
                  className="p-4 flex flex-wrap items-center justify-between gap-4 hover:bg-white/[0.02] transition"
                >
                  <div className="space-y-1 min-w-[220px]">
                    <div className="text-base font-bold text-cream">{t.name}</div>
                    {t.info && Object.keys(t.info).length > 0 && (
                      <div className="font-mono text-xs text-muted max-w-md truncate">
                        {Object.entries(t.info)
                          .map(([k, v]) => `${k !== "notes" ? k + ": " : ""}${v}`)
                          .join(" • ")}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
                      <MapPin className="h-3 w-3 text-amber" />
                      <span>{locLabel(t.location_id ? locMap.get(t.location_id) : null)}</span>
                    </div>
                  </div>

                  {/* 1 to N Categories displayed per team */}
                  <div className="flex flex-wrap items-center gap-1.5 max-w-md">
                    {t.categoryIds.map((cid) => {
                      const c = catMap.get(cid);
                      return (
                        <CatChip
                          key={cid}
                          name={c?.name ?? "Track"}
                          color={c?.color ?? "#58efff"}
                          className="!text-[10px] !py-0.5"
                        />
                      );
                    })}
                    {!t.categoryIds.length && (
                      <span className="font-mono text-xs text-muted">Uncategorized</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(t)}
                      className="p-2 text-muted hover:text-cyan rounded-xl hover:bg-white/5 transition"
                      title="Edit Team"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        setDelTarget(t);
                        setErr(null);
                        setDelOpen(true);
                      }}
                      className="p-2 text-muted hover:text-red-400 rounded-xl hover:bg-white/5 transition"
                      title="Delete Team"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              totalItems={filteredTeams.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        ) : (
          <div className="p-12 text-center font-mono text-xs text-muted space-y-3">
            <p>No teams match your search or filter.</p>
            <button onClick={openCreate} className="btn-primary inline-flex">
              <Plus className="h-3.5 w-3.5" /> Register First Team
            </button>
          </div>
        )}
      </div>

      {/* Single Add / Edit Team Modal with 1..N Categories & Inline Category Creator */}
      <Modal
        open={modalOpen}
        onClose={() => !loading && setModalOpen(false)}
        title={editingId ? "Edit Team Details" : "Register Hackathon Team"}
      >
        <form onSubmit={handleSave} className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}

          <div className="field">
            <label className="lbl">Team Name</label>
            <input
              required
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Celestial Orbiters, Solar Pulse"
            />
          </div>

          {/* 1..N Categories Picker */}
          <div className="field">
            <div className="flex items-center justify-between mb-1.5">
              <label className="lbl !mb-0">
                Challenge Track Categories ({selCats.length} selected)
              </label>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <button
                  type="button"
                  onClick={() => setSelCats(categories.map((c) => c.id))}
                  className="text-cyan hover:underline"
                >
                  Select All
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => setSelCats([])}
                  className="text-muted hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>

            <CategoryPicker
              categories={categories}
              value={selCats}
              onChange={setSelCats}
            />

            {/* Inline Quick Category Creator */}
            <div className="mt-3 pt-3 border-t border-line/60 flex items-center gap-2">
              <input
                type="text"
                placeholder="New track name (e.g. Deep Space Comms)..."
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleQuickAddCategory();
                  }
                }}
                className="input !py-1 !text-xs flex-1"
              />
              <button
                type="button"
                disabled={creatingCat || !newCatName.trim()}
                onClick={handleQuickAddCategory}
                className="btn !py-1 !px-3 text-xs shrink-0"
              >
                <Plus className="h-3.5 w-3.5 text-cyan" />
                {creatingCat ? "Adding..." : "Add Track"}
              </button>
            </div>
          </div>

          <div className="field">
            <label className="lbl">Station Location (Optional)</label>
            <select
              className="input"
              value={locId}
              onChange={(e) => setLocId(e.target.value)}
            >
              <option value="">No assigned station (Floating)</option>
              {sortedLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.building} · Floor {l.floor}{l.section ? ` · ${l.section}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="lbl">Project Notes / Members (Optional)</label>
            <textarea
              className="input min-h-[70px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. 4 students working on Mars Water Discovery"
            />
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
              {loading ? "Saving..." : editingId ? "Save Team Changes" : "Register Team"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={delOpen}
        onClose={() => !loading && setDelOpen(false)}
        title="Delete Team"
      >
        <div className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}
          <p className="text-sm text-cream">
            Are you sure you want to permanently delete team <b>{delTarget?.name}</b>?
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
              {loading ? "Deleting..." : "Delete Team"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete All Teams Confirmation Modal */}
      <Modal
        open={deleteAllOpen}
        onClose={() => !loading && setDeleteAllOpen(false)}
        title="Delete All Registered Teams"
      >
        <div className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}
          <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-300 space-y-1">
            <div className="font-bold text-red-200">Warning: Destructive Bulk Operation</div>
            <p>
              Are you sure you want to permanently delete <b>ALL {teams.length} teams</b>? This will also remove all their associated category links and cycle team assignments.
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
              {loading ? "Deleting All Teams..." : `Yes, Delete All ${teams.length} Teams`}
            </button>
          </div>
        </div>
      </Modal>

      {/* Dynamic Excel / CSV Import Modal with 1..N Category Columns Mapping */}
      <Modal
        open={importOpen}
        onClose={() => !loading && setImportOpen(false)}
        title="Dynamic Excel / CSV Team Importer"
        extraWide
      >
        <div className="space-y-5">
          {err && <Msg kind="error">{err}</Msg>}
          {importReport && <Msg kind="ok">{importReport}</Msg>}

          {/* Step 1: Upload or Download Sample */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-line bg-white/[0.02]">
            <div>
              <div className="font-bold text-xs text-cream">Upload any Excel or CSV spreadsheet</div>
              <div className="font-mono text-[11px] text-muted">
                No need to reformat your file. The website lets you dynamically map any column names and any number of category columns!
              </div>
            </div>
            <button
              type="button"
              onClick={downloadSampleExcel}
              className="btn !py-1.5 !px-3 text-xs"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-cyan" /> Download Sample Excel
            </button>
          </div>

          <div className="field">
            <label className="lbl">Select File (.xlsx, .xls, .ods, .csv)</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.ods"
              onChange={handleFileUpload}
              className="input file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:bg-cyan/20 file:text-cyan file:text-xs file:font-semibold"
            />
          </div>

          {/* When File is Loaded: Show Sheet Selector & Dynamic Mapping Controls */}
          {rawRows.length > 0 && (
            <div className="space-y-4 pt-2 border-t border-line">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="eyebrow !mb-0">DYNAMIC COLUMN CONFIGURATION</span>
                <span className="font-mono text-xs text-cyan">
                  {rawRows.length} rows loaded from <b>{fileName}</b>
                </span>
              </div>

              {sheetNames.length > 1 && (
                <div className="field">
                  <label className="lbl">Select Workbook Sheet</label>
                  <select
                    className="input font-mono text-xs"
                    value={selectedSheet}
                    onChange={(e) => handleSheetChange(e.target.value)}
                  >
                    {sheetNames.map((s) => (
                      <option key={s} value={s}>
                        Sheet: {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Dynamic Mapping Form */}
              <div className="grid gap-3 sm:grid-cols-2 p-3.5 rounded-xl border border-line/80 bg-black/20">
                {/* 1. Team Name Column */}
                <div className="field sm:col-span-2">
                  <label className="lbl text-cream font-bold">1. Team Name Column</label>
                  <select
                    className="input font-mono text-xs"
                    value={nameCol}
                    onChange={(e) => setNameCol(e.target.value)}
                  >
                    <option value="">-- Select Column for Team Name --</option>
                    {detectedColumns.map((col) => (
                      <option key={col} value={col}>
                        Column: &quot;{col}&quot; (e.g. {String(rawRows[0]?.[col] || "").slice(0, 25)})
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Category Columns (1 to N columns!) */}
                <div className="field sm:col-span-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="lbl text-cream font-bold !mb-0">
                      2. Category / Specialty Columns ({catCols.length} mapped)
                    </label>
                    <button
                      type="button"
                      onClick={addCategoryColumn}
                      className="btn !py-1 !px-2.5 text-xs text-cyan border-cyan/30"
                    >
                      <Plus className="h-3 w-3" /> Add Another Category Column
                    </button>
                  </div>
                  <p className="font-mono text-[10px] text-muted">
                    Teams may have 1 or N categories. If your Excel has multiple category columns (e.g. &quot;Primary Track&quot; and &quot;Secondary Track&quot;), add them here! Delimited values (e.g. &quot;AI, Robotics&quot;) are also split automatically.
                  </p>

                  <div className="space-y-2">
                    {catCols.map((colVal, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted shrink-0 w-20">
                          Track #{idx + 1}:
                        </span>
                        <select
                          className="input font-mono text-xs flex-1"
                          value={colVal}
                          onChange={(e) => updateCategoryColumn(idx, e.target.value)}
                        >
                          <option value="">-- Choose Column for Category #{idx + 1} --</option>
                          {detectedColumns.map((col) => (
                            <option key={col} value={col}>
                              &quot;{col}&quot; (e.g. {String(rawRows[0]?.[col] || "").slice(0, 25)})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeCategoryColumn(idx)}
                          className="p-2 text-muted hover:text-red-400 rounded-lg hover:bg-white/5"
                          title="Remove Column Mapping"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Zone Column (Optional) & 4. Room / Table Column (next to Zone) */}
                <div className="field">
                  <label className="lbl">3. Zone Column (Optional)</label>
                  <select
                    className="input font-mono text-xs"
                    value={zoneCol}
                    onChange={(e) => setZoneCol(e.target.value)}
                  >
                    <option value="">None / Not in sheet</option>
                    {detectedColumns.map((col) => (
                      <option key={col} value={col}>
                        &quot;{col}&quot; (e.g. {String(rawRows[0]?.[col] || "").slice(0, 25)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="lbl text-cream font-bold">4. Room / Table Column (next to Zone)</label>
                  <select
                    className="input font-mono text-xs"
                    value={roomCol}
                    onChange={(e) => setRoomCol(e.target.value)}
                  >
                    <option value="">None / Floating (No assigned room)</option>
                    {detectedColumns.map((col) => (
                      <option key={col} value={col}>
                        &quot;{col}&quot; (e.g. {String(rawRows[0]?.[col] || "").slice(0, 25)})
                      </option>
                    ))}
                  </select>
                </div>

                {/* 5. Extra Info Columns */}
                <div className="field sm:col-span-2">
                  <label className="lbl">5. Extra Info / Notes Columns</label>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1.5 rounded-lg border border-line bg-black/30">
                    {detectedColumns
                      .filter((c) => c !== nameCol && !catCols.includes(c) && c !== zoneCol && c !== roomCol && c !== locCol)
                      .map((col) => {
                        const active = infoCols.includes(col);
                        return (
                          <button
                            type="button"
                            key={col}
                            onClick={() => toggleInfoColumn(col)}
                            className={`rounded-md border px-2 py-0.5 font-mono text-[10px] transition ${
                              active
                                ? "border-cyan/50 bg-cyan/15 text-cyan"
                                : "border-line text-muted hover:text-cream"
                            }`}
                          >
                            {active ? "✓ " : "+ "}
                            {col}
                          </button>
                        );
                      })}
                    {!detectedColumns.length && (
                      <span className="font-mono text-[10px] text-muted">No other columns</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Step 3: Real-Time Dynamic Live Preview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="eyebrow !mb-0">
                    LIVE DYNAMIC PREVIEW (FIRST {Math.min(8, parsedData.rows.length)} ROWS)
                  </span>
                  <div className="flex items-center gap-3 font-mono text-xs">
                    <span className="text-emerald font-bold">
                      {parsedData.rows.filter((r) => r.status === "ready").length} Ready to Import
                    </span>
                    {parsedData.duplicatesCount > 0 && (
                      <span className="text-amber">
                        {parsedData.duplicatesCount} Duplicates (Will Skip)
                      </span>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-line bg-white/[0.04] text-left text-muted">
                        <th className="p-2">#</th>
                        <th className="p-2">Team Name</th>
                        <th className="p-2">Extracted Categories (1..N)</th>
                        <th className="p-2">Zone</th>
                        <th className="p-2">Room / Table</th>
                        <th className="p-2">Matched Station</th>
                        <th className="p-2">Additional Metadata</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {parsedData.rows.slice(0, 8).map((r) => (
                        <tr key={r.idx} className="hover:bg-white/[0.02]">
                          <td className="p-2 text-muted">{r.idx}</td>
                          <td className="p-2 font-bold text-cream">
                            {r.name || <span className="text-red-400 italic">Empty Name</span>}
                          </td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-1">
                              {r.categoryNames.map((cn) => (
                                <CatChip
                                  key={cn}
                                  name={cn}
                                  color="#58efff"
                                  className="!text-[9px] !py-0.5"
                                />
                              ))}
                              {!r.categoryNames.length && (
                                <span className="text-muted/60 italic">None</span>
                              )}
                            </div>
                          </td>
                          <td className="p-2 font-mono text-xs text-cream">{r.zoneRaw || "—"}</td>
                          <td className="p-2 font-mono text-xs text-cream">{r.roomRaw || "—"}</td>
                          <td className="p-2 text-muted">
                            {r.locationId ? (
                              <span className="text-amber">
                                {locLabel(locMap.get(r.locationId))}
                              </span>
                            ) : r.locationRaw ? (
                              <span className="text-muted">{r.locationRaw}</span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="p-2 text-muted max-w-xs truncate">
                            {Object.entries(r.info)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(", ") || "—"}
                          </td>
                          <td className="p-2">
                            {r.status === "ready" ? (
                              <span className="text-emerald flex items-center gap-1 font-bold">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                              </span>
                            ) : r.status === "duplicate" ? (
                              <span className="text-amber flex items-center gap-1 font-bold">
                                <XCircle className="h-3.5 w-3.5" /> Skip (Dup)
                              </span>
                            ) : (
                              <span className="text-red-400 flex items-center gap-1 font-bold">
                                <XCircle className="h-3.5 w-3.5" /> {r.warning}
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

          {/* Action buttons */}
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
              disabled={loading || !parsedData.rows.length || !nameCol}
              onClick={handleStartImport}
              className="btn-primary"
            >
              {loading
                ? "Processing Import..."
                : `Import ${
                    parsedData.rows.filter((r) => r.status === "ready").length
                  } Teams With Categories`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
