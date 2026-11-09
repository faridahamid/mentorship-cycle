"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Download,
  Edit2,
  FileSpreadsheet,
  Plus,
  Search,
  Trash2,
  Upload,
  XCircle
} from "lucide-react";
import * as XLSX from "xlsx";
import { saveCategory, deleteCategory, deleteAllCategories, importCategories } from "@/app/actions/admin";
import { downloadExcel, type Table } from "@/lib/export";
import { Modal, Msg, Pagination } from "@/components/ui";

const COLOR_PRESETS = [
  "#58efff", // Cyan
  "#ffab2e", // Orange
  "#65ffbd", // Live Emerald
  "#a855f7", // Purple
  "#ec4899", // Pink
  "#3b82f6", // Blue
  "#f43f5e", // Rose
  "#eab308", // Yellow
  "#14b8a6", // Teal
  "#8b5cf6"  // Violet
];

export interface CategoryWithStats {
  id: string;
  name: string;
  color: string;
  created_at: string;
  mentorsCount: number;
  teamsCount: number;
}

export function CategoryManagement({ categories }: { categories: CategoryWithStats[] }) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#58efff");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [delModalOpen, setDelModalOpen] = useState(false);
  const [deletingCat, setDeletingCat] = useState<CategoryWithStats | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);

  // Search & Pagination state
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const pagedCategories = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  // Dynamic Excel Bulk Import state
  const [importOpen, setImportOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [nameCol, setNameCol] = useState("");
  const [colorCol, setColorCol] = useState("");
  const [importReport, setImportReport] = useState<string | null>(null);

  function openCreate() {
    setEditingId(null);
    setName("");
    setColor(COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)]);
    setErr(null);
    setModalOpen(true);
  }

  function openEdit(c: CategoryWithStats) {
    setEditingId(c.id);
    setName(c.name);
    setColor(c.color || "#58efff");
    setErr(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    const r = await saveCategory({
      id: editingId || undefined,
      name: name.trim(),
      color: color.trim()
    });
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setModalOpen(false);
      router.refresh();
    }
  }

  async function confirmDelete() {
    if (!deletingCat) return;
    setLoading(true);
    setErr(null);
    const r = await deleteCategory(deletingCat.id);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setDelModalOpen(false);
      setDeletingCat(null);
      router.refresh();
    }
  }

  async function confirmDeleteAll() {
    setLoading(true);
    setErr(null);
    const r = await deleteAllCategories();
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setDeleteAllOpen(false);
      router.refresh();
    }
  }

  /* ────────── Dynamic Category Excel Importer ────────── */
  function openImport() {
    setErr(null);
    setImportReport(null);
    setFileName("");
    setRawRows([]);
    setDetectedColumns([]);
    setNameCol("");
    setColorCol("");
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
      const nMatch = lowerCols.find(
        (c) =>
          c.lower.includes("category") ||
          c.lower.includes("track") ||
          c.lower.includes("specialty") ||
          c.lower.includes("domain") ||
          c.lower.includes("challenge") ||
          c.lower.includes("name")
      );
      const cMatch = lowerCols.find(
        (c) => c.lower.includes("color") || c.lower.includes("hex") || c.lower.includes("theme")
      );

      setNameCol(nMatch ? nMatch.original : cols[0] || "");
      setColorCol(cMatch ? cMatch.original : "");
    } catch (ex: unknown) {
      setErr((ex as Error)?.message || "Failed to parse spreadsheet.");
    }
  }

  const parsedData = useMemo(() => {
    if (!rawRows.length || !nameCol) return { rows: [], duplicatesCount: 0 };

    const seen = new Set<string>();
    const existingNames = new Set(categories.map((c) => c.name.toLowerCase()));

    interface ParsedCatRow {
      idx: number;
      name: string;
      color: string;
      status: "ready" | "duplicate" | "missing_name";
    }

    const rows: ParsedCatRow[] = [];
    let duplicatesCount = 0;

    rawRows.forEach((raw, i) => {
      const catName = String(raw[nameCol] ?? "").trim();
      const rawColor = colorCol ? String(raw[colorCol] ?? "").trim() : "";
      const validColor = /^#[0-9a-fA-F]{6}$/.test(rawColor)
        ? rawColor
        : COLOR_PRESETS[i % COLOR_PRESETS.length];

      if (!catName) {
        rows.push({
          idx: i + 1,
          name: "(empty)",
          color: validColor,
          status: "missing_name"
        });
        return;
      }

      const key = catName.toLowerCase();
      if (existingNames.has(key) || seen.has(key)) {
        duplicatesCount++;
        rows.push({
          idx: i + 1,
          name: catName,
          color: validColor,
          status: "duplicate"
        });
        return;
      }

      seen.add(key);
      rows.push({
        idx: i + 1,
        name: catName,
        color: validColor,
        status: "ready"
      });
    });

    return { rows, duplicatesCount };
  }, [rawRows, nameCol, colorCol, categories]);

  async function handleStartImport() {
    const validRows = parsedData.rows
      .filter((r) => r.status === "ready")
      .map((r) => ({
        name: r.name,
        color: r.color
      }));

    if (!validRows.length) {
      setErr("No new or valid categories to import.");
      return;
    }

    setLoading(true);
    setErr(null);
    setImportReport(null);

    const res = await importCategories(validRows);
    setLoading(false);

    if (!res.ok) {
      setErr(res.error);
    } else {
      setImportReport(
        `Successfully imported ${res.summary.inserted} new challenge track(s). ${res.summary.duplicates} duplicate(s) skipped.`
      );
      router.refresh();
    }
  }

  function downloadSample() {
    const sampleTable: Table = {
      title: "Sample Categories Template",
      headers: ["Track Name", "Color Hex (Optional)"],
      rows: [
        ["Earth Observation & Climate", "#58efff"],
        ["Space Medicine & Biology", "#65ffbd"],
        ["Astrophysics & Deep Space", "#a855f7"],
        ["Planetary Habitation", "#ffab2e"],
        ["AI & Autonomous Rovers", "#3b82f6"]
      ]
    };
    downloadExcel("sample_categories_template", [sampleTable]);
  }

  function handleExport() {
    const table: Table = {
      title: "NASA Space Apps Cairo – Challenge Tracks",
      headers: ["Category Name", "Color Code", "Assigned Mentors", "Assigned Teams", "Created At"],
      rows: categories.map((c) => [
        c.name,
        c.color,
        c.mentorsCount,
        c.teamsCount,
        new Date(c.created_at).toISOString().split("T")[0]
      ])
    };
    downloadExcel("nsac_categories", [table]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="searchBox">
            <Search className="h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search challenge tracks..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <span className="monoLabel">{categories.length} REGISTERED TRACKS</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {categories.length > 0 && (
            <button
              onClick={() => {
                setErr(null);
                setDeleteAllOpen(true);
              }}
              className="btn text-xs text-red-400 border-red-500/30 hover:bg-red-500/10 hover:border-red-500/50"
              title="Delete All Categories"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-400" /> Delete All Categories
            </button>
          )}
          <button onClick={handleExport} className="btn text-xs">
            <Download className="h-3.5 w-3.5 text-cyan" /> Export Excel
          </button>
          <button onClick={openImport} className="btn text-xs">
            <Upload className="h-3.5 w-3.5 text-orange" /> Dynamic Excel Import
          </button>
          <button onClick={openCreate} className="btn-primary text-xs font-bold">
            <Plus className="h-4 w-4" /> Add Category
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pagedCategories.map((c) => (
          <div
            key={c.id}
            className="panel p-4.5 transition-all hover:border-white/25 flex flex-col justify-between group"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: c.color, boxShadow: `0 0 10px ${c.color}66` }}
                  />
                  <h3 className="text-base font-bold text-cream m-0">{c.name}</h3>
                </div>
                <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEdit(c)}
                    className="p-1.5 text-muted hover:text-cyan rounded-lg hover:bg-white/5 transition"
                    title="Edit category"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setDeletingCat(c);
                      setErr(null);
                      setDelModalOpen(true);
                    }}
                    className="p-1.5 text-muted hover:text-red-400 rounded-lg hover:bg-white/5 transition"
                    title="Delete category"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3 font-mono text-[11px] text-[#969bc4]">
                <div>
                  <span className="text-cream font-bold">{c.mentorsCount}</span> mentors
                </div>
                <span>•</span>
                <div>
                  <span className="text-cream font-bold">{c.teamsCount}</span> teams
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between font-mono text-[10px] text-muted">
              <span>{c.color}</span>
              <span className="text-muted/60">{new Date(c.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        ))}

        {!filtered.length && (
          <div className="col-span-full panel p-8 text-center font-mono text-xs text-muted">
            {search
              ? `No tracks matching "${search}".`
              : "No categories defined yet. Add categories for Earth Science, Space Exploration, AI/ML, Design, etc."}
          </div>
        )}
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={filtered.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={[10, 25, 50, 100]}
        className="panel !py-3 !border-t-0"
      />

      {/* Create / Edit Category Modal */}
      <Modal
        open={modalOpen}
        onClose={() => !loading && setModalOpen(false)}
        title={editingId ? "Edit Category" : "Add Challenge Track Category"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}

          <div className="field">
            <label className="lbl">Category Name</label>
            <input
              required
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Earth Observation, AI/ML, Robotics"
            />
          </div>

          <div className="field">
            <label className="lbl">Color Theme</label>
            <div className="flex items-center gap-3 mb-2.5">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-12 rounded-lg cursor-pointer bg-transparent border border-line"
              />
              <input
                type="text"
                pattern="^#[0-9a-fA-F]{6}$"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="input font-mono !w-32"
                placeholder="#58efff"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => setColor(p)}
                  className="w-6 h-6 rounded-full border transition-transform hover:scale-110"
                  style={{
                    backgroundColor: p,
                    borderColor: color.toLowerCase() === p.toLowerCase() ? "#fff" : "transparent",
                    boxShadow: color.toLowerCase() === p.toLowerCase() ? `0 0 10px ${p}` : "none"
                  }}
                />
              ))}
            </div>
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
              {loading ? "Saving..." : editingId ? "Update Category" : "Create Category"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={delModalOpen}
        onClose={() => !loading && setDelModalOpen(false)}
        title="Delete Category"
      >
        <div className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}
          <p className="text-sm text-cream">
            Are you sure you want to delete category <b>{deletingCat?.name}</b>?
          </p>
          {(deletingCat?.mentorsCount || 0) + (deletingCat?.teamsCount || 0) > 0 && (
            <Msg kind="info">
              Notice: This category is currently tagged on <b>{deletingCat?.mentorsCount}</b> mentor(s) and{" "}
              <b>{deletingCat?.teamsCount}</b> team(s). Deleting it will detach the category association.
            </Msg>
          )}

          <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
            <button
              type="button"
              disabled={loading}
              onClick={() => setDelModalOpen(false)}
              className="btn"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={confirmDelete}
              className="btn btn-danger"
            >
              {loading ? "Deleting..." : "Delete Category"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete All Categories Confirmation Modal */}
      <Modal
        open={deleteAllOpen}
        onClose={() => !loading && setDeleteAllOpen(false)}
        title="Delete All Challenge Track Categories"
      >
        <div className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}
          <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-300 space-y-1">
            <div className="font-bold text-red-200">Warning: Destructive Bulk Operation</div>
            <p>
              Are you sure you want to permanently delete <b>ALL {categories.length} challenge track categories</b>? This will detach all specialty tags from mentors and teams.
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
              onClick={confirmDeleteAll}
              className="btn btn-danger"
            >
              {loading ? "Deleting All Categories..." : `Yes, Delete All ${categories.length} Categories`}
            </button>
          </div>
        </div>
      </Modal>
      {/* Dynamic Excel Bulk Importer for Categories */}
      <Modal
        open={importOpen}
        onClose={() => !loading && setImportOpen(false)}
        title="Dynamic Category / Challenge Track Spreadsheet Importer"
        extraWide
      >
        <div className="space-y-5">
          {err && <Msg kind="error">{err}</Msg>}
          {importReport && <Msg kind="ok">{importReport}</Msg>}

          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-line bg-white/[0.02]">
            <div className="text-xs text-muted">
              Upload any spreadsheet containing track names and optional colors. Columns can be in any position.
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

              <div className="grid gap-3 sm:grid-cols-2 p-3.5 rounded-xl border border-line/80 bg-black/20">
                <div className="field">
                  <label className="lbl text-cream font-bold">Category / Track Name Column</label>
                  <select
                    className="input font-mono text-xs"
                    value={nameCol}
                    onChange={(e) => setNameCol(e.target.value)}
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
                  <label className="lbl">Color Theme Column (Optional)</label>
                  <select
                    className="input font-mono text-xs"
                    value={colorCol}
                    onChange={(e) => setColorCol(e.target.value)}
                  >
                    <option value="">Auto-assign vibrant NASA palette colors</option>
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
                    PREVIEW (FIRST {Math.min(8, parsedData.rows.length)} CATEGORIES)
                  </span>
                  <div className="flex items-center gap-3 font-mono text-xs">
                    <span className="text-emerald font-bold">
                      {parsedData.rows.filter((r) => r.status === "ready").length} Ready to Import
                    </span>
                    {parsedData.duplicatesCount > 0 && (
                      <span className="text-amber">
                        {parsedData.duplicatesCount} Duplicates Skipped
                      </span>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-line bg-white/[0.04] text-left text-muted">
                        <th className="p-2">#</th>
                        <th className="p-2">Track Name</th>
                        <th className="p-2">Assigned Color</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {parsedData.rows.slice(0, 8).map((r) => (
                        <tr key={r.idx} className="hover:bg-white/[0.02]">
                          <td className="p-2 text-muted">{r.idx}</td>
                          <td className="p-2 font-bold text-cream">{r.name}</td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-3.5 h-3.5 rounded-full inline-block border border-white/20"
                                style={{ backgroundColor: r.color }}
                              />
                              <span className="text-muted">{r.color}</span>
                            </div>
                          </td>
                          <td className="p-2">
                            {r.status === "ready" ? (
                              <span className="text-emerald flex items-center gap-1 font-bold">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                              </span>
                            ) : r.status === "duplicate" ? (
                              <span className="text-amber flex items-center gap-1 font-bold">
                                <XCircle className="h-3.5 w-3.5" /> Duplicate
                              </span>
                            ) : (
                              <span className="text-red-400 flex items-center gap-1 font-bold">
                                <XCircle className="h-3.5 w-3.5" /> Missing Name
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
              disabled={loading || !parsedData.rows.length || !nameCol}
              onClick={handleStartImport}
              className="btn-primary"
            >
              {loading
                ? "Importing..."
                : `Import ${parsedData.rows.filter((r) => r.status === "ready").length} Categories`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
