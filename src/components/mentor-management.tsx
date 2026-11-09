"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Download,
  Edit2,
  FileSpreadsheet,
  Mail,
  MapPin,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Users2,
  X,
  XCircle
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  createMentorDirect,
  createAccount,
  saveMentor,
  deleteMentor,
  deleteAllMentors,
  importMentors,
  type ImportMentorRow
} from "@/app/actions/admin";
import { matchLocation } from "@/lib/location-matcher";
import { downloadExcel, type Table } from "@/lib/export";
import { CatChip, CategoryPicker, Modal, Msg, locLabel, Pagination } from "@/components/ui";

export interface MentorItem {
  id: string;
  profile_id: string | null;
  full_name: string;
  gender: string | null;
  email: string | null;
  location_id: string | null;
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

export function MentorManagement({
  mentors,
  categories,
  locations,
  isSuper
}: {
  mentors: MentorItem[];
  categories: CategoryOption[];
  locations: LocationOption[];
  isSuper: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [genderFilter, setGenderFilter] = useState("all");

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

  // Single Create state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGender, setNewGender] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [withAccount, setWithAccount] = useState(false);
  const [selCats, setSelCats] = useState<string[]>([]);
  const [locId, setLocId] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editingMentor, setEditingMentor] = useState<MentorItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editGender, setEditGender] = useState("");
  const [editCats, setEditCats] = useState<string[]>([]);
  const [editLocId, setEditLocId] = useState("");

  // Delete state
  const [delOpen, setDelOpen] = useState(false);
  const [delTarget, setDelTarget] = useState<MentorItem | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);

  // Dynamic Excel / CSV Bulk Importer state
  const [importOpen, setImportOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);

  // Column mapping settings - dynamic multi-column like category!
  const [nameCols, setNameCols] = useState<string[]>([""]); // 1 to N name columns!
  const [genderCol, setGenderCol] = useState("");
  const [catCols, setCatCols] = useState<string[]>([""]); // 1 to N category columns!
  const [zoneCol, setZoneCol] = useState("");
  const [roomCol, setRoomCol] = useState("");
  const [locCol, setLocCol] = useState("");

  // Completed credentials report
  const [importReport, setImportReport] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<
    { fullName: string; email: string; password: string }[]
  >([]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return mentors.filter((m) => {
      const matchSearch =
        !q ||
        m.full_name.toLowerCase().includes(q) ||
        (m.email && m.email.toLowerCase().includes(q));
      const matchCat = catFilter === "all" || m.categoryIds.includes(catFilter);
      const matchGender =
        genderFilter === "all" ||
        (m.gender && m.gender.toLowerCase() === genderFilter.toLowerCase());
      return matchSearch && matchCat && matchGender;
    });
  }, [mentors, search, catFilter, genderFilter]);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const pagedMentors = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  function openCreate() {
    setNewName("");
    setNewGender("");
    setNewEmail("");
    setNewPassword("");
    setWithAccount(false);
    setSelCats(categories.length > 0 ? [categories[0].id] : []);
    setLocId("");
    setErr(null);
    setCreateOpen(true);
  }

  function openEdit(m: MentorItem) {
    setEditingMentor(m);
    setEditName(m.full_name);
    setEditGender(m.gender || "");
    setEditCats(m.categoryIds);
    setEditLocId(m.location_id || "");
    setErr(null);
    setEditOpen(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return setErr("Mentor name is required");
    if (!selCats.length) return setErr("Select at least one expertise category");

    setLoading(true);
    setErr(null);

    let res;
    if (withAccount && isSuper) {
      if (!newEmail.trim() || !newPassword.trim()) {
        setLoading(false);
        return setErr("Email and password (min 8 chars) are required for user account creation.");
      }
      res = await createAccount({
        role: "mentor",
        fullName: newName.trim(),
        email: newEmail.trim(),
        password: newPassword,
        categoryIds: selCats,
        locationId: locId || null
      });
    } else {
      res = await createMentorDirect({
        fullName: newName.trim(),
        gender: newGender || null,
        categoryIds: selCats,
        locationId: locId || null
      });
    }

    setLoading(false);
    if (!res.ok) {
      setErr(res.error);
    } else {
      setCreateOpen(false);
      router.refresh();
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingMentor) return;
    if (!editName.trim()) return setErr("Mentor name is required");
    if (!editCats.length) return setErr("Select at least one expertise category");

    setLoading(true);
    setErr(null);
    const r = await saveMentor({
      id: editingMentor.id,
      fullName: editName.trim(),
      gender: editGender || null,
      categoryIds: editCats,
      locationId: editLocId || null
    });
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setEditOpen(false);
      setEditingMentor(null);
      router.refresh();
    }
  }

  async function handleConfirmDelete() {
    if (!delTarget) return;
    setLoading(true);
    setErr(null);
    const r = await deleteMentor(delTarget.id);
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
    const r = await deleteAllMentors();
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setDeleteAllOpen(false);
      router.refresh();
    }
  }

  /* ────────── Dynamic Excel Import & Credential Generation ────────── */
  function openImportModal() {
    setErr(null);
    setImportReport(null);
    setCreatedCredentials([]);
    setFileName("");
    setSheetNames([]);
    setSelectedSheet("");
    setRawRows([]);
    setDetectedColumns([]);
    setNameCols([""]);
    setGenderCol("");
    setCatCols([""]);
    setZoneCol("");
    setRoomCol("");
    setLocCol("");
    setImportOpen(true);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setImportReport(null);
    setCreatedCredentials([]);
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

    const colsSet = new Set<string>();
    for (const row of json.slice(0, 20)) {
      Object.keys(row).forEach((k) => colsSet.add(k));
    }
    const cols = Array.from(colsSet);
    setDetectedColumns(cols);

    const lowerCols = cols.map((c) => ({ original: c, lower: c.toLowerCase() }));

    // Auto-detect name columns (can be single or multiple)
    const firstMatch = lowerCols.find((c) => c.lower.includes("first name") || c.lower === "first");
    const lastMatch = lowerCols.find((c) => c.lower.includes("last name") || c.lower === "last");

    if (firstMatch && lastMatch) {
      setNameCols([firstMatch.original, lastMatch.original]);
    } else {
      const nameMatch = lowerCols.find(
        (c) =>
          c.lower.includes("mentor") ||
          c.lower.includes("full name") ||
          c.lower.includes("name") ||
          c.lower.includes("instructor")
      );
      setNameCols([nameMatch ? nameMatch.original : cols[0] || ""]);
    }

    // Auto-detect gender column
    const genderMatch = lowerCols.find(
      (c) =>
        c.lower === "gender" ||
        c.lower.includes("gender") ||
        c.lower === "sex" ||
        c.lower.includes("sex")
    );
    setGenderCol(genderMatch ? genderMatch.original : "");

    // Auto-detect category columns
    const catMatches = lowerCols.filter(
      (c) =>
        c.lower.includes("track") ||
        c.lower.includes("specialty") ||
        c.lower.includes("category") ||
        c.lower.includes("domain") ||
        c.lower.includes("expertise")
    );
    if (catMatches.length > 0) {
      setCatCols(catMatches.map((m) => m.original));
    } else {
      setCatCols(cols.length > 1 ? [cols[1]] : [""]);
    }

    // Auto-detect zone column
    const zoneMatch = lowerCols.find((c) =>
      c.lower === "zone" ||
      c.lower.includes("zone") ||
      c.lower.includes("area") ||
      c.lower.includes("wing")
    );
    setZoneCol(zoneMatch ? zoneMatch.original : "");

    // Auto-detect room / table column (next to zone)
    const roomMatch = lowerCols.find((c) =>
      c.lower === "room" ||
      c.lower.includes("room") ||
      c.lower.includes("table") ||
      c.lower.includes("station") ||
      c.lower.includes("hall") ||
      c.lower.includes("location")
    );
    setRoomCol(roomMatch ? roomMatch.original : "");
    setLocCol(roomMatch ? roomMatch.original : "");
  }

  function addNameColumn() {
    setNameCols([...nameCols, ""]);
  }

  function removeNameColumn(idx: number) {
    if (nameCols.length <= 1) {
      setNameCols([""]);
      return;
    }
    setNameCols(nameCols.filter((_, i) => i !== idx));
  }

  function updateNameColumn(idx: number, colName: string) {
    const updated = [...nameCols];
    updated[idx] = colName;
    setNameCols(updated);
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

  // Sanitizer helper for email / password generation
  function cleanToken(str: string): string {
    return str
      .replace(/^(dr\.|eng\.|mr\.|ms\.|prof\.)\s+/i, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();
  }

  // Parse raw rows dynamically, generating @nsac.com emails and [name]12345 passwords
  const parsedData = useMemo(() => {
    if (!rawRows.length) return { rows: [], duplicatesCount: 0 };

    const existingEmails = new Set(
      mentors.map((m) => (m.email ?? "").trim().toLowerCase()).filter(Boolean)
    );
    const existingNames = new Set(mentors.map((m) => m.full_name.trim().toLowerCase()));
    const seenEmailsInFile = new Map<string, number>();

    interface ParsedMentorRow {
      idx: number;
      fullName: string;
      gender: string;
      email: string;
      password: string;
      categoryNames: string[];
      categoryIds: string[];
      locationId: string | null;
      zoneRaw: string;
      roomRaw: string;
      locationRaw: string;
      status: "ready" | "duplicate" | "missing_name";
      warning?: string;
    }

    const rows: ParsedMentorRow[] = [];
    let duplicatesCount = 0;

    rawRows.forEach((raw, i) => {
      const nameTokens = nameCols
        .map((c) => String(raw[c] ?? "").trim())
        .filter(Boolean);
      const fullName = nameTokens.join(" ");

      let firstName = "";
      let lastName = "";
      if (nameTokens.length >= 2) {
        firstName = nameTokens[0];
        lastName = nameTokens[nameTokens.length - 1];
      } else if (nameTokens.length === 1) {
        const parts = fullName
          .replace(/^(dr\.|eng\.|mr\.|ms\.|prof\.)\s+/i, "")
          .trim()
          .split(/\s+/);
        firstName = parts[0] || "";
        lastName = parts.slice(1).join(" ") || "";
      }

      const rawGender = genderCol ? String(raw[genderCol] ?? "").trim() : "";
      let normalizedGender = "";
      if (rawGender) {
        const gLow = rawGender.toLowerCase();
        if (gLow.startsWith("m") || gLow === "male" || gLow === "ذكر") normalizedGender = "Male";
        else if (gLow.startsWith("f") || gLow === "female" || gLow === "أنثى") normalizedGender = "Female";
        else normalizedGender = rawGender.charAt(0).toUpperCase() + rawGender.slice(1);
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
        baseEmail = `mentor${i + 1}@nsac.com`;
      }

      // Handle duplicate emails inside the file
      let finalEmail = baseEmail;
      const count = seenEmailsInFile.get(baseEmail) || 0;
      if (count > 0) {
        const atIdx = baseEmail.indexOf("@");
        finalEmail = `${baseEmail.slice(0, atIdx)}${count + 1}@nsac.com`;
      }
      seenEmailsInFile.set(baseEmail, count + 1);

      // 2. Generate Password: first name or name + 12345 (guarantee at least 8 chars)
      const namePart = cFirst || cleanToken(fullName) || "mentor";
      let password = `${namePart}12345`;
      if (password.length < 8) {
        password = `${namePart}12345678`.slice(0, 8);
      }

      // 3. Extract Categories across all mapped category columns (1 to N)
      const extractedCatNames: string[] = [];
      for (const col of catCols) {
        if (!col) continue;
        const val = String(raw[col] ?? "").trim();
        if (!val) continue;

        const parts = val.split(/[,;|\n•]+/).map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          extractedCatNames.push(p);
        }
      }

      const uniqueCatNames = Array.from(new Set(extractedCatNames));
      const resolvedCatIds: string[] = [];
      for (const cn of uniqueCatNames) {
        const id = catNameToId.get(cn.toLowerCase());
        if (id) resolvedCatIds.push(id);
      }

      // 4. Zone & Room (next to Zone) Extraction and Location Matching
      const rawZone = zoneCol ? String(raw[zoneCol] ?? "").trim() : "";
      const rawRoom = roomCol
        ? String(raw[roomCol] ?? "").trim()
        : locCol
        ? String(raw[locCol] ?? "").trim()
        : "";
      const rawLocVal = [rawZone, rawRoom].filter(Boolean).join(" ");

      const matchedLocId = matchLocation(rawZone, rawRoom, locations);

      // 5. Evaluate Status
      let status: ParsedMentorRow["status"] = "ready";
      let warning: string | undefined;

      if (!fullName) {
        status = "missing_name";
        warning = "Missing mentor name";
      } else if (existingEmails.has(finalEmail.toLowerCase()) || existingNames.has(fullName.toLowerCase())) {
        status = "duplicate";
        warning = "Mentor or email already enrolled (will skip)";
        duplicatesCount++;
      }

      rows.push({
        idx: i + 1,
        fullName,
        gender: normalizedGender,
        email: finalEmail,
        password,
        categoryNames: uniqueCatNames,
        categoryIds: resolvedCatIds,
        locationId: matchedLocId,
        zoneRaw: rawZone,
        roomRaw: rawRoom,
        locationRaw: rawLocVal,
        status,
        warning
      });
    });

    return {
      rows,
      duplicatesCount
    };
  }, [
    rawRows,
    nameCols,
    genderCol,
    catCols,
    zoneCol,
    roomCol,
    locCol,
    catNameToId,
    mentors,
    locations
  ]);

  async function handleStartImport() {
    if (!parsedData.rows.length) return setErr("No rows parsed from file.");
    setLoading(true);
    setErr(null);
    setImportReport(null);

    try {
      const validPayload: ImportMentorRow[] = [];

      for (const r of parsedData.rows) {
        if (r.status === "missing_name" || r.status === "duplicate") continue;

        // Ensure category array is valid; fallback to first category if none matched
        const catIds = r.categoryIds.length ? r.categoryIds : (categories.length ? [categories[0].id] : []);

        validPayload.push({
          fullName: r.fullName,
          gender: r.gender || null,
          email: r.email,
          password: r.password,
          categoryIds: [...new Set(catIds)],
          locationId: r.locationId
        });
      }

      if (!validPayload.length) {
        throw new Error("No eligible mentors to import (all rows missing names or already exist).");
      }

      const res = await importMentors(validPayload);
      setLoading(false);

      if (!res.ok) {
        setErr(res.error);
      } else {
        const s = res.summary;
        setCreatedCredentials(s.credentials);
        setImportReport(
          `Success: ${s.inserted} mentors provisioned with @nsac.com accounts! (${s.duplicates.length} duplicate(s) skipped, ${s.rejected.length} rejected).`
        );
        router.refresh();
      }
    } catch (ex: unknown) {
      setLoading(false);
      setErr((ex as Error)?.message || String(ex));
    }
  }

  async function handleExportCredentials() {
    const dataToExport = createdCredentials.length
      ? createdCredentials.map((c) => [c.fullName, c.email, c.password])
      : parsedData.rows
          .filter((r) => r.status === "ready")
          .map((r) => [r.fullName, r.email, r.password]);

    const table: Table = {
      title: "NASA Space Apps Cairo - Mentor Logins",
      headers: ["Full Name", "Assigned Email (@nsac.com)", "Initial Password"],
      rows: dataToExport
    };

    await downloadExcel("nsac_mentor_credentials", [table]);
  }

  async function handleExport() {
    const table: Table = {
      title: "NASA Space Apps Cairo 2026 - Mentors",
      headers: ["Mentor Name", "Gender", "Email / Account", "Expertise Categories", "Station Location", "Enrolled Date"],
      rows: mentors.map((m) => [
        m.full_name,
        m.gender || "Unspecified",
        m.email ?? "Manual Roster",
        m.categoryIds.map((c) => catMap.get(c)?.name ?? "").filter(Boolean).join(", "),
        locLabel(m.location_id ? locMap.get(m.location_id) : null),
        new Date(m.created_at).toLocaleDateString()
      ])
    };
    await downloadExcel("nasa-space-apps-cairo-mentors", [table]);
  }

  function downloadSampleExcel() {
    const sample = [
      {
        "First Name": "Sarah",
        "Last Name": "Mansour",
        Gender: "Female",
        "Domain Track 1": "AI / Machine Learning",
        "Domain Track 2": "Robotics & Hardware",
        Zone: "Zone A",
        "Room / Table": "Room 101"
      },
      {
        "First Name": "Ahmed",
        "Last Name": "Salah",
        Gender: "Male",
        "Domain Track 1": "Earth Observation",
        "Domain Track 2": "Space Physics",
        Zone: "Zone B",
        "Room / Table": "Table 12"
      },
      {
        "First Name": "Tarek",
        "Last Name": "Ibrahim",
        Gender: "Male",
        "Domain Track 1": "Life Sciences in Space",
        "Domain Track 2": "",
        Zone: "Zone C",
        "Room / Table": "Lab 3"
      }
    ];

    const ws = XLSX.utils.json_to_sheet(sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mentors");
    XLSX.writeFile(wb, "nsac_mentors_import_sample.xlsx");
  }

  return (
    <div className="space-y-6">
      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="searchBox">
            <Search className="h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search mentors by name/email..."
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
            <option value="all">All Specialties ({mentors.length})</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            className="input !w-auto !py-1.5 !text-xs font-mono"
            value={genderFilter}
            onChange={(e) => {
              setGenderFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All Genders ({mentors.length})</option>
            <option value="male">
              Male ({mentors.filter((m) => m.gender?.toLowerCase() === "male").length})
            </option>
            <option value="female">
              Female ({mentors.filter((m) => m.gender?.toLowerCase() === "female").length})
            </option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mentors.length > 0 && (
            <button
              onClick={() => {
                setErr(null);
                setDeleteAllOpen(true);
              }}
              className="btn !py-2 !px-3 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10 hover:border-red-500/50"
              title="Delete All Mentors"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-400" /> Delete All Mentors
            </button>
          )}
          <button onClick={handleExport} className="btn !py-2 !px-3 text-xs" title="Export Excel">
            <Download className="h-3.5 w-3.5 text-cyan" /> Export Excel
          </button>
          <button onClick={openImportModal} className="btn !py-2 !px-3 text-xs">
            <Upload className="h-3.5 w-3.5 text-orange" /> Dynamic Excel Import
          </button>
          <button onClick={openCreate} className="btn-primary !py-2 !px-4 text-xs font-bold">
            <Plus className="h-3.5 w-3.5" /> Enroll Mentor
          </button>
        </div>
      </div>

      {/* Mentors List Panel */}
      <div className="panel overflow-hidden">
        <div className="panelHead">
          <div className="flex items-center gap-2">
            <Users2 className="h-4 w-4 text-orange" />
            <h2>Specialized Mentors ({filtered.length})</h2>
          </div>
          <span className="monoLabel">{mentors.length} TOTAL ENROLLED</span>
        </div>

        {filtered.length > 0 ? (
          <>
            <div className="divide-y divide-line">
              {pagedMentors.map((m) => (
                <div
                  key={m.id}
                  className="p-4 flex flex-wrap items-center justify-between gap-4 hover:bg-white/[0.02] transition"
                >
                  <div className="space-y-1 min-w-[220px]">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-cream">{m.full_name}</span>
                      {m.gender && (
                        <span
                          className={`chip text-[9px] font-mono font-bold tracking-wide ${
                            m.gender.toLowerCase() === "male"
                              ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                              : m.gender.toLowerCase() === "female"
                              ? "border-pink-500/30 bg-pink-500/10 text-pink-300"
                              : "border-purple-500/30 bg-purple-500/10 text-purple-300"
                          }`}
                        >
                          {m.gender}
                        </span>
                      )}
                      {m.profile_id && (
                        <span className="chip border border-cyan/30 bg-cyan/10 text-cyan text-[9px] font-mono font-bold">
                          PORTAL USER
                        </span>
                      )}
                    </div>
                    {m.email && (
                      <div className="flex items-center gap-1 font-mono text-xs text-muted">
                        <Mail className="h-3 w-3 text-cyan" />
                        <span>{m.email}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
                      <MapPin className="h-3 w-3 text-amber" />
                      <span>{locLabel(m.location_id ? locMap.get(m.location_id) : null)}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 max-w-md">
                    {m.categoryIds.map((cid) => {
                      const c = catMap.get(cid);
                      return (
                        <CatChip
                          key={cid}
                          name={c?.name ?? "Specialty"}
                          color={c?.color ?? "#ffab2e"}
                          className="!text-[10px] !py-0.5"
                        />
                      );
                    })}
                    {!m.categoryIds.length && (
                      <span className="font-mono text-xs text-muted">No specialty tagged</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(m)}
                      className="p-2 text-muted hover:text-cyan rounded-xl hover:bg-white/5 transition"
                      title="Edit Mentor"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        setDelTarget(m);
                        setErr(null);
                        setDelOpen(true);
                      }}
                      className="p-2 text-muted hover:text-red-400 rounded-xl hover:bg-white/5 transition"
                      title="Remove Mentor"
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
              totalItems={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        ) : (
          <div className="p-12 text-center font-mono text-xs text-muted space-y-3">
            <p>No mentors match your search or filter.</p>
            <button onClick={openCreate} className="btn-primary inline-flex">
              <Plus className="h-3.5 w-3.5" /> Enroll First Mentor
            </button>
          </div>
        )}
      </div>

      {/* Enroll Single Mentor Modal */}
      <Modal
        open={createOpen}
        onClose={() => !loading && setCreateOpen(false)}
        title="Enroll Specialized Mentor"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}

          <div className="field">
            <label className="lbl">Mentor Full Name</label>
            <input
              required
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Dr. Hoda Mansour, Eng. Ahmed Salah"
            />
          </div>

          <div className="field">
            <label className="lbl">Gender (Optional)</label>
            <select
              className="input"
              value={newGender}
              onChange={(e) => setNewGender(e.target.value)}
            >
              <option value="">Unspecified</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="field">
            <label className="lbl">Expertise Categories</label>
            <CategoryPicker
              categories={categories}
              value={selCats}
              onChange={setSelCats}
            />
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

          {isSuper && (
            <div className="p-3 rounded-xl border border-line bg-white/[0.02] space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={withAccount}
                  onChange={(e) => setWithAccount(e.target.checked)}
                  className="rounded border-line"
                />
                <span className="text-xs font-semibold text-cream">
                  Create portal login account for this mentor
                </span>
              </label>

              {withAccount && (
                <div className="space-y-3 pt-2">
                  <div className="field">
                    <label className="lbl">Mentor Email Address</label>
                    <input
                      type="email"
                      required={withAccount}
                      className="input"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="mentor@nsac.com"
                    />
                  </div>
                  <div className="field">
                    <label className="lbl">Initial Password (min 8 characters)</label>
                    <input
                      type="password"
                      required={withAccount}
                      className="input"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
            <button
              type="button"
              disabled={loading}
              onClick={() => setCreateOpen(false)}
              className="btn"
            >
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "Enrolling..." : "Enroll Mentor"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Mentor Modal */}
      <Modal
        open={editOpen}
        onClose={() => !loading && setEditOpen(false)}
        title="Edit Mentor Profile"
      >
        <form onSubmit={handleSaveEdit} className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}

          <div className="field">
            <label className="lbl">Full Name</label>
            <input
              required
              className="input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="lbl">Gender (Optional)</label>
            <select
              className="input"
              value={editGender}
              onChange={(e) => setEditGender(e.target.value)}
            >
              <option value="">Unspecified</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="field">
            <label className="lbl">Specialties / Tracks</label>
            <CategoryPicker
              categories={categories}
              value={editCats}
              onChange={setEditCats}
            />
          </div>

          <div className="field">
            <label className="lbl">Station Location</label>
            <select
              className="input"
              value={editLocId}
              onChange={(e) => setEditLocId(e.target.value)}
            >
              <option value="">No assigned station (Floating)</option>
              {sortedLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.building} · Floor {l.floor}{l.section ? ` · ${l.section}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
            <button
              type="button"
              disabled={loading}
              onClick={() => setEditOpen(false)}
              className="btn"
            >
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={delOpen}
        onClose={() => !loading && setDelOpen(false)}
        title="Remove Mentor"
      >
        <div className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}
          <p className="text-sm text-cream">
            Are you sure you want to remove <b>{delTarget?.full_name}</b> from the mentor roster?
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
              {loading ? "Removing..." : "Remove Mentor"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete All Mentors Confirmation Modal */}
      <Modal
        open={deleteAllOpen}
        onClose={() => !loading && setDeleteAllOpen(false)}
        title="Delete All Enrolled Mentors"
      >
        <div className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}
          <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-300 space-y-1">
            <div className="font-bold text-red-200">Warning: Destructive Bulk Operation</div>
            <p>
              Are you sure you want to permanently delete <b>ALL {mentors.length} mentors</b>? This will also remove any active assignments and provisioned @nsac.com accounts.
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
              {loading ? "Deleting All Mentors..." : `Yes, Delete All ${mentors.length} Mentors`}
            </button>
          </div>
        </div>
      </Modal>

      {/* Dynamic Excel / CSV Mentor Bulk Importer with Email & Password Generator */}
      <Modal
        open={importOpen}
        onClose={() => !loading && setImportOpen(false)}
        title="Dynamic Mentor Excel Importer & Account Provisioner"
        extraWide
      >
        <div className="space-y-6">
          {err && <Msg kind="error">{err}</Msg>}
          {importReport && <Msg kind="ok">{importReport}</Msg>}

          {/* Explanation Callout Banner as requested */}
          <div className="p-4 rounded-2xl border border-cyan/30 bg-cyan/10 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-bold text-cream">
              <Sparkles className="h-4 w-4 text-cyan" />
              Automated Account &amp; Credential Generator:
            </div>
            <p className="text-xs text-[#c3c7e5] leading-relaxed">
              Mentors in your spreadsheet will automatically have portal login accounts provisioned with generated emails under <b>@nsac.com</b> and passwords formatted as <b>[name]12345</b>.
            </p>
            <div className="pt-1 font-mono text-[11px] text-cyan flex items-center gap-1.5">
              <span>✦</span>
              <span>
                <b>Note:</b> &quot;nsac&quot; stands for the first letter of each word in <b>N</b>ASA <b>S</b>pace <b>A</b>pps <b>C</b>airo.
              </span>
            </div>
          </div>

          {/* Upload and Sample download */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl border border-line bg-white/[0.02]">
            <div className="text-xs text-muted max-w-xl">
              Upload any mentor spreadsheet (.xlsx, .xls, .ods, .csv). Map any column layout dynamically with custom name columns, gender tags, and specialty tracks.
            </div>
            <button
              type="button"
              onClick={downloadSampleExcel}
              className="btn !py-2 !px-3.5 text-xs shrink-0"
            >
              <FileSpreadsheet className="h-4 w-4 text-cyan" /> Download Sample Excel
            </button>
          </div>

          <div className="field">
            <label className="lbl font-bold text-cream">Select Mentor Spreadsheet (.xlsx, .xls, .ods, .csv)</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.ods"
              onChange={handleFileUpload}
              className="input file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-cyan/20 file:text-cyan file:text-xs file:font-semibold"
            />
          </div>

          {/* When File Loaded */}
          {rawRows.length > 0 && (
            <div className="space-y-6 pt-3 border-t border-line">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="eyebrow !mb-0 text-cyan">DYNAMIC COLUMN MAPPING CONFIGURATION</span>
                <span className="font-mono text-xs text-cream bg-white/5 border border-line px-3 py-1 rounded-full">
                  {rawRows.length} rows loaded from <b>{fileName}</b>
                </span>
              </div>

              {sheetNames.length > 1 && (
                <div className="field">
                  <label className="lbl">Select Workbook Sheet</label>
                  <select
                    className="input font-mono text-xs"
                    value={selectedSheet}
                    onChange={(e) => setSelectedSheet(e.target.value)}
                  >
                    {sheetNames.map((s) => (
                      <option key={s} value={s}>
                        Sheet: {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Dynamic Mapping Controls: 2 Column Spacious Grid */}
              <div className="grid gap-5 lg:grid-cols-2 p-5 rounded-2xl border border-line bg-black/30">
                {/* Column A: Name & Gender */}
                <div className="space-y-5">
                  {/* 1. Mentor Name Columns (1 to N) */}
                  <div className="p-4 rounded-xl border border-line/70 bg-white/[0.02] space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="lbl text-cream font-bold !mb-0 text-sm">
                        1. Mentor Name Column(s) ({nameCols.length} mapped)
                      </label>
                      <button
                        type="button"
                        onClick={addNameColumn}
                        className="btn !py-1 !px-2.5 text-xs text-cyan border-cyan/30 hover:bg-cyan/10"
                      >
                        <Plus className="h-3 w-3" /> Add Name Column
                      </button>
                    </div>
                    <p className="text-[11px] text-muted">
                      Select a single Full Name column, or add columns (e.g. First Name, Last Name) to combine them with a space.
                    </p>

                    <div className="space-y-2 pt-1">
                      {nameCols.map((colVal, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted shrink-0 w-20">
                            Name #{idx + 1}:
                          </span>
                          <select
                            className="input font-mono text-xs flex-1"
                            value={colVal}
                            onChange={(e) => updateNameColumn(idx, e.target.value)}
                          >
                            <option value="">-- Choose Name Column #{idx + 1} --</option>
                            {detectedColumns.map((col) => (
                              <option key={col} value={col}>
                                &quot;{col}&quot; (e.g. {String(rawRows[0]?.[col] || "").slice(0, 30)})
                              </option>
                            ))}
                          </select>
                          {nameCols.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeNameColumn(idx)}
                              className="p-2 text-muted hover:text-red-400 rounded-lg hover:bg-white/5 transition"
                              title="Remove Column"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 2. Gender Column (Optional) */}
                  <div className="p-4 rounded-xl border border-line/70 bg-white/[0.02] space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="lbl text-cream font-bold !mb-0 text-sm">
                        2. Gender Column (Optional)
                      </label>
                      {genderCol && (
                        <span className="chip border-purple-500/30 bg-purple-500/10 text-purple-300 text-[10px] font-mono">
                          Mapped to &quot;{genderCol}&quot;
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted">
                      Extracts mentor gender tag (e.g. Male, Female). Auto-normalizes values.
                    </p>
                    <select
                      className="input font-mono text-xs"
                      value={genderCol}
                      onChange={(e) => setGenderCol(e.target.value)}
                    >
                      <option value="">None / Not in spreadsheet</option>
                      {detectedColumns.map((col) => (
                        <option key={col} value={col}>
                          &quot;{col}&quot; (e.g. {String(rawRows[0]?.[col] || "").slice(0, 30)})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Column B: Category Columns & Station Location */}
                <div className="space-y-5">
                  {/* 3. Specialty / Category Columns (1 to N) */}
                  <div className="p-4 rounded-xl border border-line/70 bg-white/[0.02] space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="lbl text-cream font-bold !mb-0 text-sm">
                        3. Domain Specialties ({catCols.length} mapped)
                      </label>
                      <button
                        type="button"
                        onClick={addCategoryColumn}
                        className="btn !py-1 !px-2.5 text-xs text-orange border-orange/30 hover:bg-orange/10"
                      >
                        <Plus className="h-3 w-3" /> Add Specialty Column
                      </button>
                    </div>
                    <p className="text-[11px] text-muted">
                      Mapped track columns for mentor technical specialties. Multiple columns or comma-separated values supported.
                    </p>

                    <div className="space-y-2 pt-1">
                      {catCols.map((colVal, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted shrink-0 w-24">
                            Specialty #{idx + 1}:
                          </span>
                          <select
                            className="input font-mono text-xs flex-1"
                            value={colVal}
                            onChange={(e) => updateCategoryColumn(idx, e.target.value)}
                          >
                            <option value="">-- Choose Column for Specialty #{idx + 1} --</option>
                            {detectedColumns.map((col) => (
                              <option key={col} value={col}>
                                &quot;{col}&quot; (e.g. {String(rawRows[0]?.[col] || "").slice(0, 30)})
                              </option>
                            ))}
                          </select>
                          {catCols.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeCategoryColumn(idx)}
                              className="p-2 text-muted hover:text-red-400 rounded-lg hover:bg-white/5 transition"
                              title="Remove Column Mapping"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 4. Physical Station Location (Zone & Room / Table) */}
                  <div className="p-4 rounded-xl border border-line/70 bg-white/[0.02] space-y-3">
                    <label className="lbl text-cream font-bold !mb-0 text-sm flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-amber" />
                      4. Physical Station Location (Optional)
                    </label>
                    <p className="text-[11px] text-muted">
                      Select Zone and Room/Table columns to match physical venue stations.
                    </p>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="field !mb-0">
                        <label className="lbl !text-[11px]">Zone Column</label>
                        <select
                          className="input font-mono text-xs"
                          value={zoneCol}
                          onChange={(e) => setZoneCol(e.target.value)}
                        >
                          <option value="">None / Not in sheet</option>
                          {detectedColumns.map((col) => (
                            <option key={col} value={col}>
                              &quot;{col}&quot;
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field !mb-0">
                        <label className="lbl !text-[11px] text-cream font-bold">Room / Table Column</label>
                        <select
                          className="input font-mono text-xs"
                          value={roomCol}
                          onChange={(e) => setRoomCol(e.target.value)}
                        >
                          <option value="">None / Floating</option>
                          {detectedColumns.map((col) => (
                            <option key={col} value={col}>
                              &quot;{col}&quot;
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Preview Table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="eyebrow !mb-0 text-cyan">
                    LIVE DYNAMIC PREVIEW (FIRST {Math.min(8, parsedData.rows.length)} MENTORS)
                  </span>
                  <div className="flex items-center gap-3 font-mono text-xs">
                    <span className="text-emerald font-bold">
                      {parsedData.rows.filter((r) => r.status === "ready").length} Ready to Provision
                    </span>
                    {parsedData.duplicatesCount > 0 && (
                      <span className="text-amber">
                        {parsedData.duplicatesCount} Duplicates (Will Skip)
                      </span>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-line bg-black/20">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-line bg-white/[0.04] text-left text-muted">
                        <th className="p-3">#</th>
                        <th className="p-3">Mentor Name</th>
                        <th className="p-3">Gender</th>
                        <th className="p-3">Generated Email</th>
                        <th className="p-3">Initial Password</th>
                        <th className="p-3">Specialties</th>
                        <th className="p-3">Zone</th>
                        <th className="p-3">Room / Table</th>
                        <th className="p-3">Station</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {parsedData.rows.slice(0, 8).map((r) => (
                        <tr key={r.idx} className="hover:bg-white/[0.02]">
                          <td className="p-3 text-muted">{r.idx}</td>
                          <td className="p-3 font-bold text-cream">
                            {r.fullName || <span className="text-red-400 italic">Empty Name</span>}
                          </td>
                          <td className="p-3">
                            {r.gender ? (
                              <span
                                className={`chip text-[9px] font-mono font-bold tracking-wide ${
                                  r.gender.toLowerCase() === "male"
                                    ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                                    : r.gender.toLowerCase() === "female"
                                    ? "border-pink-500/30 bg-pink-500/10 text-pink-300"
                                    : "border-purple-500/30 bg-purple-500/10 text-purple-300"
                                }`}
                              >
                                {r.gender}
                              </span>
                            ) : (
                              <span className="text-muted/60 italic text-[10px]">—</span>
                            )}
                          </td>
                          <td className="p-3 text-cyan font-semibold">
                            {r.email}
                          </td>
                          <td className="p-3 text-amber font-mono">
                            {r.password}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1">
                              {r.categoryNames.map((cn) => (
                                <CatChip
                                  key={cn}
                                  name={cn}
                                  color="#ffab2e"
                                  className="!text-[9px] !py-0.5"
                                />
                              ))}
                              {!r.categoryNames.length && (
                                <span className="text-muted/60 italic">Default</span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 font-mono text-xs text-cream">{r.zoneRaw || "—"}</td>
                          <td className="p-3 font-mono text-xs text-cream">{r.roomRaw || "—"}</td>
                          <td className="p-3 text-muted">
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
                          <td className="p-3">
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

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-line">
                <div className="text-xs font-mono text-muted">
                  Auto-generates @nsac.com credentials and imports all mapped rows.
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setImportOpen(false)}
                    className="btn !py-2 !px-4 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      loading ||
                      !parsedData.rows.filter((r) => r.status === "ready").length ||
                      !nameCols.some(Boolean)
                    }
                    onClick={handleStartImport}
                    className="btn-primary !py-2 !px-5 text-xs font-bold"
                  >
                    {loading
                      ? "Provisioning Accounts & Importing..."
                      : `Import & Provision ${
                          parsedData.rows.filter((r) => r.status === "ready").length
                        } Mentors`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Credentials Download Ready Banner */}
          {createdCredentials.length > 0 && (
            <div className="p-4 rounded-2xl border border-emerald/40 bg-emerald/10 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-cream">
                <CheckCircle2 className="h-4 w-4 text-emerald" />
                {createdCredentials.length} Mentor Accounts Successfully Provisioned!
              </div>
              <p className="text-xs text-[#c3c7e5]">
                Download the credentials spreadsheet now to distribute login emails and passwords to your mentors:
              </p>
              <button
                type="button"
                onClick={handleExportCredentials}
                className="btn-primary !bg-emerald !text-black !py-2 !px-4 text-xs font-bold inline-flex items-center gap-2"
              >
                <Download className="h-4 w-4" /> Download Mentors Login Sheet (.xlsx)
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
