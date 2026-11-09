"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  Tag,
  Search,
  Printer,
  Download,
  Coffee,
  CheckCircle2,
  X,
  ChevronRight,
  Shield,
  Info,
  Briefcase,
  Sparkles,
} from "lucide-react";
import { CatChip, Modal } from "@/components/ui";
import { getSlotTimeStatus, findOperatingSlot, type SlotTimeStatus } from "@/lib/slots";
import { cn, getFullLocationKey, locationColor, locLabel, type LocationLike } from "@/lib/utils";

export interface CycleSlot {
  id: string;
  idx: number;
  day: string;
  startsAt: string;
  endsAt: string;
  kind: "session" | "break";
  enabled: boolean;
}

export interface TeamAssignment {
  assignmentId: string;
  slotId: string;
  teamId: string;
  teamName: string;
  teamLocation?: LocationLike | null;
  categories: string[];
}

export interface MentorCycleInfo {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  mode: string;
  status: string;
  cycleMentorId: string;
  slots: CycleSlot[];
  assignments: TeamAssignment[];
  unavailableSlots: string[];
}

export interface MentorScheduleViewProps {
  mentor: {
    id: string;
    name: string;
    gender?: string | null;
    email: string;
    stationLocation?: LocationLike | null;
    categories: string[];
  };
  cycles: MentorCycleInfo[];
  allCategories: { id: string; name: string; color: string }[];
  allLocations: LocationLike[];
  isAdmin?: boolean;
  availableMentorsForAdmin?: { id: string; name: string }[];
  currentAdminMentorId?: string;
  onAdminSelectMentorUrl?: string;
}

type ViewMode = "calendar" | "agenda" | "team" | "category" | "location";

export function MentorScheduleView({
  mentor,
  cycles,
  allCategories,
  isAdmin,
  availableMentorsForAdmin = [],
  currentAdminMentorId,
}: MentorScheduleViewProps) {
  const router = useRouter();
  const [selectedCycleId, setSelectedCycleId] = useState<string>(cycles[0]?.id ?? "");
  const [view, setView] = useState<ViewMode>("calendar");

  // Filters state
  const [search, setSearch] = useState("");
  const [selectedDay, setSelectedDay] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [selectedSlotId, setSelectedSlotId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "scheduled" | "breaks">("all");

  // Selected team modal
  const [modalTeam, setModalTeam] = useState<{
    teamId: string;
    teamName: string;
    location?: LocationLike | null;
    categories: string[];
    currentSlot?: CycleSlot;
  } | null>(null);

  const activeCycle = useMemo(
    () => cycles.find((c) => c.id === selectedCycleId) ?? cycles[0],
    [cycles, selectedCycleId]
  );

  const catById = useMemo(() => new Map(allCategories.map((c) => [c.id, c])), [allCategories]);

  // Available days in active cycle
  const availableDays = useMemo(() => {
    if (!activeCycle) return [];
    return Array.from(new Set(activeCycle.slots.map((s) => s.day))).filter(Boolean);
  }, [activeCycle]);

  // Unique locations among assigned teams
  const availableLocations = useMemo(() => {
    if (!activeCycle) return [];
    const set = new Set<string>();
    for (const a of activeCycle.assignments) {
      if (a.teamLocation) set.add(getFullLocationKey(a.teamLocation));
    }
    return Array.from(set).sort();
  }, [activeCycle]);

  // Slots lookup
  const slotsById = useMemo(
    () => new Map(activeCycle?.slots.map((s) => [s.id, s]) ?? []),
    [activeCycle]
  );

  // Group assignments by slot_id
  const asgsBySlot = useMemo(() => {
    const map = new Map<string, TeamAssignment[]>();
    for (const a of activeCycle?.assignments ?? []) {
      map.set(a.slotId, [...(map.get(a.slotId) ?? []), a]);
    }
    return map;
  }, [activeCycle]);

  // Live clock and operating rotation tracking
  const [now, setNow] = useState<Date>(() => new Date());
  const [simulatedSlotId, setSimulatedSlotId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  const getSlotStatus = useCallback(
    (slot: CycleSlot): SlotTimeStatus => {
      if (simulatedSlotId) {
        if (slot.id === simulatedSlotId) return "operating";
        const target = activeCycle?.slots.find((s) => s.id === simulatedSlotId);
        if (target) {
          return slot.idx < target.idx ? "completed" : "upcoming";
        }
      }
      return getSlotTimeStatus(slot, now);
    },
    [simulatedSlotId, activeCycle, now]
  );

  const operatingSlot = useMemo(() => {
    if (!activeCycle) return null;
    if (simulatedSlotId) return activeCycle.slots.find((s) => s.id === simulatedSlotId) ?? null;
    return findOperatingSlot(activeCycle.slots, now);
  }, [activeCycle, simulatedSlotId, now]);

  const currentOperatingAsgs = useMemo(() => {
    if (!operatingSlot) return [];
    return asgsBySlot.get(operatingSlot.id) ?? [];
  }, [operatingSlot, asgsBySlot]);

  const completedSlotsCount = useMemo(() => {
    if (!activeCycle) return 0;
    return activeCycle.slots.filter((s) => getSlotStatus(s) === "completed").length;
  }, [activeCycle, getSlotStatus]);

  // Unique teams list
  const uniqueTeams = useMemo(() => {
    if (!activeCycle) return [];
    const map = new Map<string, {
      teamId: string;
      teamName: string;
      teamLocation?: LocationLike | null;
      categories: string[];
      slots: CycleSlot[];
    }>();

    for (const a of activeCycle.assignments) {
      const slot = slotsById.get(a.slotId);
      const existing = map.get(a.teamId) ?? {
        teamId: a.teamId,
        teamName: a.teamName,
        teamLocation: a.teamLocation,
        categories: a.categories,
        slots: [],
      };
      if (slot && !existing.slots.some((s) => s.id === slot.id)) {
        existing.slots.push(slot);
      }
      map.set(a.teamId, existing);
    }

    return Array.from(map.values()).sort((a, b) => a.teamName.localeCompare(b.teamName));
  }, [activeCycle, slotsById]);

  // Filtered Slots
  const filteredSlots = useMemo(() => {
    if (!activeCycle) return [];
    return activeCycle.slots.filter((slot) => {
      // Day filter
      if (selectedDay !== "all" && slot.day !== selectedDay) return false;

      // Slot filter
      if (selectedSlotId !== "all" && slot.id !== selectedSlotId) return false;

      // Status filter
      if (statusFilter === "breaks" && slot.kind !== "break") return false;
      const asgs = asgsBySlot.get(slot.id) ?? [];
      if (statusFilter === "scheduled" && asgs.length === 0) return false;

      // Category / Location / Search filters apply to teams within slot
      if (selectedCategory !== "all" || selectedLocation !== "all" || search.trim()) {
        if (slot.kind === "break") return false;
        const matchingTeams = asgs.filter((a) => {
          if (selectedCategory !== "all" && !a.categories.includes(selectedCategory)) return false;
          if (selectedLocation !== "all" && getFullLocationKey(a.teamLocation) !== selectedLocation) return false;
          if (search.trim()) {
            const q = search.toLowerCase();
            const matchName = a.teamName.toLowerCase().includes(q);
            const matchLoc = a.teamLocation ? locLabel(a.teamLocation).toLowerCase().includes(q) : false;
            const matchCat = a.categories.some((c) => catById.get(c)?.name.toLowerCase().includes(q));
            if (!matchName && !matchLoc && !matchCat) return false;
          }
          return true;
        });
        if (matchingTeams.length === 0) return false;
      }

      return true;
    });
  }, [
    activeCycle,
    selectedDay,
    selectedSlotId,
    statusFilter,
    selectedCategory,
    selectedLocation,
    search,
    asgsBySlot,
    catById,
  ]);

  // Filtered unique teams for "team" view
  const filteredTeams = useMemo(() => {
    return uniqueTeams.filter((t) => {
      if (selectedDay !== "all" && !t.slots.some((s) => s.day === selectedDay)) return false;
      if (selectedCategory !== "all" && !t.categories.includes(selectedCategory)) return false;
      if (selectedLocation !== "all" && getFullLocationKey(t.teamLocation) !== selectedLocation) return false;
      if (selectedSlotId !== "all" && !t.slots.some((s) => s.id === selectedSlotId)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = t.teamName.toLowerCase().includes(q);
        const matchLoc = t.teamLocation ? locLabel(t.teamLocation).toLowerCase().includes(q) : false;
        const matchCat = t.categories.some((c) => catById.get(c)?.name.toLowerCase().includes(q));
        if (!matchName && !matchLoc && !matchCat) return false;
      }
      return true;
    });
  }, [uniqueTeams, selectedDay, selectedCategory, selectedLocation, selectedSlotId, search, catById]);

  // Active filter count
  const activeFiltersCount =
    (selectedDay !== "all" ? 1 : 0) +
    (selectedCategory !== "all" ? 1 : 0) +
    (selectedLocation !== "all" ? 1 : 0) +
    (selectedSlotId !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (search.trim() ? 1 : 0);

  const resetFilters = () => {
    setSearch("");
    setSelectedDay("all");
    setSelectedCategory("all");
    setSelectedLocation("all");
    setSelectedSlotId("all");
    setStatusFilter("all");
  };

  // CSV Export
  const downloadCsv = () => {
    if (!activeCycle) return;
    const rows = [
      ["Cycle", "Day", "Slot Index", "Time Start", "Time End", "Slot Type", "Team Name", "Location", "Tracks"],
    ];

    for (const slot of activeCycle.slots) {
      const asgs = asgsBySlot.get(slot.id) ?? [];
      if (asgs.length === 0) {
        rows.push([
          activeCycle.name,
          slot.day,
          String(slot.idx + 1),
          slot.startsAt,
          slot.endsAt,
          slot.kind === "break" ? "Break" : "Open / Free",
          "—",
          "—",
          "—",
        ]);
      } else {
        for (const a of asgs) {
          rows.push([
            activeCycle.name,
            slot.day,
            String(slot.idx + 1),
            slot.startsAt,
            slot.endsAt,
            "Rotation Session",
            a.teamName,
            a.teamLocation ? locLabel(a.teamLocation) : "Unassigned",
            a.categories.map((c) => catById.get(c)?.name ?? c).join("; "),
          ]);
        }
      }
    }

    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${activeCycle.name.replace(/\s+/g, "_")}_${mentor.name}_Schedule.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // iCal / ICS Export
  const downloadIcs = () => {
    if (!activeCycle) return;
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//MentorCycle//MentorSchedule//EN",
      `X-WR-CALNAME:${activeCycle.name} - ${mentor.name}`,
    ];

    for (const slot of activeCycle.slots) {
      if (slot.kind === "break") continue;
      const asgs = asgsBySlot.get(slot.id) ?? [];
      if (!asgs.length) continue;

      const teamNames = asgs.map((a) => a.teamName).join(", ");
      const loc = asgs[0]?.teamLocation ? locLabel(asgs[0].teamLocation) : mentor.stationLocation ? locLabel(mentor.stationLocation) : "Venue Station";
      const dtDate = activeCycle.startDate.replace(/-/g, "");
      const dtStart = `${dtDate}T${slot.startsAt.replace(/:/g, "")}00`;
      const dtEnd = `${dtDate}T${slot.endsAt.replace(/:/g, "")}00`;

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:session-${slot.id}-${mentor.id}@mentorcycle.com`);
      lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`);
      lines.push(`DTSTART:${dtStart}`);
      lines.push(`DTEND:${dtEnd}`);
      lines.push(`SUMMARY:Mentoring: ${teamNames}`);
      lines.push(`LOCATION:${loc}`);
      lines.push(`DESCRIPTION:Rotation ${slot.idx + 1} (${slot.startsAt} - ${slot.endsAt}) with teams: ${teamNames}`);
      lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");

    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeCycle.name.replace(/\s+/g, "_")}_${mentor.name}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Admin Preview Mode Switcher */}
      {isAdmin && availableMentorsForAdmin.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-amber/40 bg-gradient-to-r from-amber/15 via-[#1c1810] to-transparent text-amber-200 text-xs">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber shrink-0" />
            <span>
              <strong>Admin Preview Mode:</strong> You are viewing the schedule scoped to mentor{" "}
              <strong>{mentor.name}</strong>.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted">Preview as:</span>
            <select
              value={currentAdminMentorId || mentor.id}
              onChange={(e) => {
                const targetId = e.target.value;
                router.push(`/mentor?mentorId=${targetId}`);
              }}
              className="rounded-lg bg-black/60 border border-amber/40 px-2.5 py-1 text-xs text-white focus:outline-none focus:border-amber"
            >
              {availableMentorsForAdmin.map((m) => (
                <option key={m.id} value={m.id} className="bg-slate-900 text-white">
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Header Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="metric">
          <div className="flex items-center justify-between mb-1">
            <span className="k">Mentor Identity</span>
            <CheckCircle2 className="h-4 w-4 text-cyan" />
          </div>
          <div className="text-base font-bold text-white truncate flex items-center gap-1.5">
            <span className="truncate">{mentor.name}</span>
            {mentor.gender && (
              <span className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-white/10 text-white/80 shrink-0 font-normal">
                {mentor.gender}
              </span>
            )}
          </div>
          <div className="font-mono text-[10px] text-muted truncate">{mentor.email || "Verified Mentor"}</div>
        </div>

        {/* Mentor Field / Specialty Card */}
        <div className="metric border-cyan/20 bg-gradient-to-br from-cyan/5 via-transparent to-transparent">
          <div className="flex items-center justify-between mb-1">
            <span className="k text-cyan font-bold">Field / Track</span>
            <Briefcase className="h-4 w-4 text-cyan" />
          </div>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {mentor.categories.length > 0 ? (
              mentor.categories.map((c) => (
                <CatChip
                  key={c}
                  name={catById.get(c)?.name ?? "Specialty"}
                  color={catById.get(c)?.color ?? "#58efff"}
                  className="!px-2 !py-0.5 !text-[10px] font-bold"
                />
              ))
            ) : (
              <span className="text-xs text-muted font-mono">General Track</span>
            )}
          </div>
          <div className="font-mono text-[10px] text-muted mt-1">Mentor Specialty Track</div>
        </div>

        <div className="metric">
          <div className="flex items-center justify-between mb-1">
            <span className="k">Assigned Station</span>
            <MapPin className="h-4 w-4 text-amber" />
          </div>
          <div className="text-base font-bold text-amber truncate" title={locLabel(mentor.stationLocation)}>
            {locLabel(mentor.stationLocation)}
          </div>
          <div className="font-mono text-[10px] text-muted">NASA Space Apps Cairo Venue</div>
        </div>

        <div className="metric">
          <div className="flex items-center justify-between mb-1">
            <span className="k">Rotation Progress</span>
            <CheckCircle2 className="h-4 w-4 text-emerald" />
          </div>
          <div className="v text-emerald flex items-baseline gap-1.5">
            <span>{completedSlotsCount}</span>
            <span className="text-xs font-mono text-muted font-normal">/ {activeCycle?.slots.length ?? 0} Done</span>
          </div>
          <div className="font-mono text-[10px] text-muted">
            {completedSlotsCount === (activeCycle?.slots.length ?? 0)
              ? "All Rotations Complete"
              : `${(activeCycle?.slots.length ?? 0) - completedSlotsCount} Remaining`}
          </div>
        </div>

        <div className="metric">
          <div className="flex items-center justify-between mb-1">
            <span className="k">Unique Teams</span>
            <Users className="h-4 w-4 text-[#8b5cf6]" />
          </div>
          <div className="v text-[#8b5cf6]">{uniqueTeams.length}</div>
          <div className="font-mono text-[10px] text-muted">Distinct Teams Mentored</div>
        </div>
      </div>

      {/* Current Operating Rotation Live Dispatch Banner */}
      {operatingSlot && (
        <div className="p-4 rounded-2xl border border-cyan/60 bg-gradient-to-r from-cyan/25 via-[#0d1c48] to-cyan/10 shadow-[0_0_25px_rgba(56,225,255,0.25)] flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-300">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan"></span>
            </span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] font-black uppercase tracking-wider text-navy bg-cyan px-2 py-0.5 rounded-full">
                  CURRENT OPERATING ROTATION
                </span>
                <span className="font-mono text-xs font-bold text-cream">
                  {operatingSlot.kind === "break" ? "Break Interval" : `Rotation ${operatingSlot.idx + 1}`} ({operatingSlot.startsAt} – {operatingSlot.endsAt})
                </span>
              </div>
              <div className="text-xs text-white/90 mt-1">
                {operatingSlot.kind === "break" ? (
                  <span className="text-amber-300 font-medium">Rest & Refreshment Interval. No team mentoring duties.</span>
                ) : currentOperatingAsgs.length > 0 ? (
                  <span>
                    Current Assignment: <strong className="text-cream text-sm">{currentOperatingAsgs.map((a) => a.teamName).join(", ")}</strong>
                    {currentOperatingAsgs[0]?.teamLocation && (
                      <span className="text-cyan font-mono ml-2 font-bold">📍 {locLabel(currentOperatingAsgs[0].teamLocation)}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted">Open rotation period. Available for float mentoring or check-ins.</span>
                )}
              </div>
            </div>
          </div>
          <div className="font-mono text-xs text-cyan font-black px-3 py-1.5 rounded-xl bg-black/40 border border-cyan/40 shadow-sm">
            LIVE OPERATING
          </div>
        </div>
      )}

      {/* Control Bar: Cycle Switcher + View Toggles + Action Utilities */}
      <div className="panel p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Cycle Selector & Field Badge */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-wider text-muted">Cycle:</span>
              {cycles.length > 1 ? (
                <select
                  value={selectedCycleId}
                  onChange={(e) => setSelectedCycleId(e.target.value)}
                  className="rounded-lg bg-black/40 border border-line px-3 py-1.5 text-xs text-white font-semibold focus:outline-none focus:border-cyan"
                >
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                      {c.name} ({c.mode})
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-bold text-sm text-cream">{activeCycle?.name ?? "Active Cycle"}</span>
              )}
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-cyan/10 border border-cyan/30 text-cyan uppercase font-bold">
                {activeCycle?.mode ?? "sequential"}
              </span>
            </div>

            {/* Mentor Field Badge */}
            <div className="hidden sm:flex items-center gap-1.5 pl-3 border-l border-line/60">
              <span className="text-[10px] font-mono text-muted uppercase tracking-wider">Field:</span>
              <div className="flex items-center gap-1 flex-wrap">
                {mentor.categories.length > 0 ? (
                  mentor.categories.map((c) => (
                    <CatChip
                      key={c}
                      name={catById.get(c)?.name ?? "Specialty"}
                      color={catById.get(c)?.color ?? "#58efff"}
                      className="!px-2 !py-0.5 !text-[9.5px] font-bold"
                    />
                  ))
                ) : (
                  <span className="text-xs text-muted font-mono">General</span>
                )}
              </div>
            </div>
          </div>

          {/* View Modes Selector */}
          <div className="inline-flex rounded-xl bg-black/40 p-1 border border-line/80">
            <button
              onClick={() => setView("calendar")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                view === "calendar"
                  ? "bg-gradient-to-r from-cyan/20 to-blue-500/20 text-cyan border border-cyan/40 shadow-sm"
                  : "text-muted hover:text-white"
              )}
            >
              <Calendar className="h-3.5 w-3.5" />
              Calendar Grid
            </button>
            <button
              onClick={() => setView("agenda")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                view === "agenda"
                  ? "bg-gradient-to-r from-cyan/20 to-blue-500/20 text-cyan border border-cyan/40 shadow-sm"
                  : "text-muted hover:text-white"
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              Timeline Agenda
            </button>
            <button
              onClick={() => setView("team")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                view === "team"
                  ? "bg-gradient-to-r from-cyan/20 to-blue-500/20 text-cyan border border-cyan/40 shadow-sm"
                  : "text-muted hover:text-white"
              )}
            >
              <Users className="h-3.5 w-3.5" />
              By Team
            </button>
            <button
              onClick={() => setView("category")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                view === "category"
                  ? "bg-gradient-to-r from-cyan/20 to-blue-500/20 text-cyan border border-cyan/40 shadow-sm"
                  : "text-muted hover:text-white"
              )}
            >
              <Tag className="h-3.5 w-3.5" />
              By Track
            </button>
            <button
              onClick={() => setView("location")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                view === "location"
                  ? "bg-gradient-to-r from-cyan/20 to-blue-500/20 text-cyan border border-cyan/40 shadow-sm"
                  : "text-muted hover:text-white"
              )}
            >
              <MapPin className="h-3.5 w-3.5" />
              By Location
            </button>
          </div>

          {/* Export / Print Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={downloadIcs}
              title="Add to Google Calendar, Apple Calendar or Outlook"
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/[0.04] transition-colors"
            >
              <Calendar className="h-3.5 w-3.5 text-cyan" />
              <span className="hidden sm:inline">Add to Calendar (.ics)</span>
            </button>
            <button
              onClick={downloadCsv}
              title="Download CSV agenda"
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/[0.04] transition-colors"
            >
              <Download className="h-3.5 w-3.5 text-emerald" />
              <span className="hidden sm:inline">CSV</span>
            </button>
            <button
              onClick={() => window.print()}
              title="Print schedule"
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/[0.04] transition-colors"
            >
              <Printer className="h-3.5 w-3.5 text-amber" />
              <span className="hidden sm:inline">Print</span>
            </button>
          </div>
        </div>

        {/* Filter Bar with Multiple Options */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-line/60">
          {/* Search filter */}
          <div className="relative min-w-44 flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team, track, station..."
              className="w-full rounded-lg bg-black/30 border border-line pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-muted/60 focus:outline-none focus:border-cyan"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Day filter */}
          {availableDays.length > 1 && (
            <select
              value={selectedDay}
              onChange={(e) => setSelectedDay(e.target.value)}
              className="rounded-lg bg-black/30 border border-line px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan"
            >
              <option value="all" className="bg-slate-900">
                All Days
              </option>
              {availableDays.map((d) => (
                <option key={d} value={d} className="bg-slate-900">
                  {d}
                </option>
              ))}
            </select>
          )}

          {/* Track / Category filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="rounded-lg bg-black/30 border border-line px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan"
          >
            <option value="all" className="bg-slate-900">
              All Tracks
            </option>
            {allCategories.map((c) => (
              <option key={c.id} value={c.id} className="bg-slate-900">
                {c.name}
              </option>
            ))}
          </select>

          {/* Location filter */}
          {availableLocations.length > 0 && (
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="rounded-lg bg-black/30 border border-line px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan max-w-44 truncate"
            >
              <option value="all" className="bg-slate-900">
                All Locations
              </option>
              {availableLocations.map((loc) => (
                <option key={loc} value={loc} className="bg-slate-900">
                  {loc}
                </option>
              ))}
            </select>
          )}

          {/* Slot filter */}
          <select
            value={selectedSlotId}
            onChange={(e) => setSelectedSlotId(e.target.value)}
            className="rounded-lg bg-black/30 border border-line px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan"
          >
            <option value="all" className="bg-slate-900">
              All Rotations
            </option>
            {activeCycle?.slots.map((s) => (
              <option key={s.id} value={s.id} className="bg-slate-900">
                Rotation {s.idx + 1} ({s.startsAt} - {s.endsAt})
              </option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | "scheduled" | "breaks")}
            className="rounded-lg bg-black/30 border border-line px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan"
          >
            <option value="all" className="bg-slate-900">
              All Statuses
            </option>
            <option value="scheduled" className="bg-slate-900">
              Scheduled Only
            </option>
            <option value="breaks" className="bg-slate-900">
              Breaks Only
            </option>
          </select>

          {/* Live / Simulated Operating Slot Selector */}
          <div className="flex items-center gap-1.5 font-mono text-xs">
            <span className="text-[10px] text-muted uppercase hidden sm:inline">Operating Slot:</span>
            <select
              value={simulatedSlotId ?? "live"}
              onChange={(e) => setSimulatedSlotId(e.target.value === "live" ? null : e.target.value)}
              className="rounded-lg bg-black/30 border border-line px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan"
              title="Toggle between automatic live clock or simulate a specific operating rotation"
            >
              <option value="live" className="bg-slate-900">Auto (Live Clock)</option>
              <optgroup label="Simulate / Test Active Slot">
                {(activeCycle?.slots ?? []).map((s) => (
                  <option key={s.id} value={s.id} className="bg-slate-900">
                    Rotation {s.idx + 1}: {s.startsAt} – {s.endsAt} ({s.kind})
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Reset button */}
          {activeFiltersCount > 0 && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-cyan hover:underline ml-auto"
            >
              <X className="h-3 w-3" />
              Reset filters ({activeFiltersCount})
            </button>
          )}
        </div>
      </div>

      {/* VIEW 1: CALENDAR GRID VIEW */}
      {view === "calendar" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {filteredSlots.map((slot) => {
              const asgs = asgsBySlot.get(slot.id) ?? [];
              const isBreak = slot.kind === "break";
              const isUnavailable = activeCycle?.unavailableSlots.includes(slot.id);
              const status = getSlotStatus(slot);
              const isOperating = status === "operating";
              const isCompleted = status === "completed";

              return (
                <div
                  key={slot.id}
                  className={cn(
                    "rounded-2xl border p-4 flex flex-col justify-between transition-all shadow-md relative group",
                    isOperating
                      ? "border-cyan bg-gradient-to-b from-cyan/20 via-[#0d1842] to-[#070b28] shadow-[0_0_25px_rgba(56,225,255,0.35)] ring-2 ring-cyan"
                      : isCompleted
                      ? "border-emerald-500/40 bg-emerald-950/15 hover:border-emerald-500/60"
                      : isBreak
                      ? "border-amber/30 bg-gradient-to-br from-amber/10 via-[#181510] to-transparent"
                      : isUnavailable
                      ? "border-red-500/30 bg-red-950/20"
                      : asgs.length > 0
                      ? "border-line bg-white/[0.02] hover:border-cyan/40"
                      : "border-line/40 bg-white/[0.01] opacity-70"
                  )}
                >
                  {/* Operating glowing pulse & beacon */}
                  {isOperating && (
                    <div className="absolute -top-3 left-4 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan text-navy font-mono text-[9px] font-black uppercase tracking-wider shadow-[0_0_12px_rgba(56,225,255,0.7)] z-10">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-navy opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-navy"></span>
                      </span>
                      Operating Now
                    </div>
                  )}

                  {/* Completed badge */}
                  {isCompleted && (
                    <div className="absolute -top-2.5 left-4 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono text-[8.5px] font-bold uppercase tracking-wider z-10">
                      <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />
                      Complete
                    </div>
                  )}

                  {/* Slot Header */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/90">
                        {isBreak ? "Break Period" : `Rotation ${slot.idx + 1}`}
                      </span>
                      <span className="font-mono text-xs text-cyan font-bold">
                        {slot.startsAt} – {slot.endsAt}
                      </span>
                    </div>

                    <div className="text-[11px] text-muted mb-3 flex items-center justify-between">
                      <span>{slot.day || "Day 1"}</span>
                      {asgs.length > 0 && (
                        <span className="font-mono text-[10px] text-emerald font-semibold">
                          {asgs.length} {asgs.length === 1 ? "team" : "teams"}
                        </span>
                      )}
                    </div>

                    {/* Slot Content */}
                    {isBreak ? (
                      <div className="p-4 rounded-xl bg-amber/10 border border-amber/20 text-center my-auto space-y-1">
                        <Coffee className="h-5 w-5 text-amber mx-auto animate-pulse" />
                        <div className="font-bold text-xs text-amber">Break & Rest Interval</div>
                        <div className="font-mono text-[10px] text-amber/80">No mentoring duties assigned</div>
                      </div>
                    ) : isUnavailable ? (
                      <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-center my-auto space-y-1">
                        <div className="font-bold text-xs text-red-300">Unavailable</div>
                        <div className="font-mono text-[10px] text-red-400">Marked as away during this slot</div>
                      </div>
                    ) : asgs.length === 0 ? (
                      <div className="p-4 rounded-xl border border-dashed border-line/60 text-center my-auto space-y-1">
                        <div className="font-bold text-xs text-muted">Open Rotation</div>
                        <div className="font-mono text-[10px] text-muted/70">No teams scheduled in this slot</div>
                      </div>
                    ) : (
                      <div className="space-y-2 mt-2">
                        {asgs.map((a) => {
                          const locColor = locationColor(a.teamLocation);
                          return (
                            <button
                              key={a.assignmentId}
                              onClick={() =>
                                setModalTeam({
                                  teamId: a.teamId,
                                  teamName: a.teamName,
                                  location: a.teamLocation,
                                  categories: a.categories,
                                  currentSlot: slot,
                                })
                              }
                              className="w-full text-left p-2.5 rounded-xl border border-white/10 hover:border-cyan/50 bg-black/40 hover:bg-black/60 transition-all group space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="font-bold text-xs text-cream group-hover:text-cyan truncate">
                                  {a.teamName}
                                </span>
                                <ChevronRight className="h-3.5 w-3.5 text-muted group-hover:text-cyan shrink-0 transition-transform group-hover:translate-x-0.5" />
                              </div>

                              {/* Location Badge with distinct room color */}
                              {a.teamLocation ? (
                                <div className="flex items-center gap-1.5 truncate">
                                  <span
                                    className="h-2 w-2 rounded-full shrink-0 shadow-sm"
                                    style={{ background: locColor }}
                                  />
                                  <span className="font-mono text-[10px] text-white/90 truncate">
                                    {getFullLocationKey(a.teamLocation)}
                                  </span>
                                </div>
                              ) : (
                                <div className="font-mono text-[10px] text-muted truncate">— No station</div>
                              )}

                              {/* Tracks / Categories */}
                              <div className="flex flex-wrap gap-1">
                                {a.categories.map((c) => (
                                  <CatChip
                                    key={c}
                                    name={catById.get(c)?.name ?? "?"}
                                    color={catById.get(c)?.color ?? "#58efff"}
                                    className="!px-1.5 !py-0 !text-[8.5px]"
                                  />
                                ))}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {filteredSlots.length === 0 && (
            <div className="panel p-12 text-center font-mono text-xs text-muted space-y-2">
              <Info className="h-6 w-6 text-cyan mx-auto mb-2" />
              <div>No rotation slots match your active filters.</div>
              <button onClick={resetFilters} className="text-cyan underline">
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: AGENDA / TIMELINE LIST VIEW */}
      {view === "agenda" && (
        <div className="panel p-5 space-y-4">
          <div className="panelHead !p-0 !pb-3 !mb-4">
            <div className="flex items-center gap-2">
              <span className="liveDot" />
              <h2>Chronological Agenda</h2>
            </div>
            <span className="monoLabel">{filteredSlots.length} SLOTS</span>
          </div>

          <div className="relative border-l-2 border-line/60 ml-4 pl-6 space-y-6">
            {filteredSlots.map((slot) => {
              const asgs = asgsBySlot.get(slot.id) ?? [];
              const isBreak = slot.kind === "break";
              const status = getSlotStatus(slot);
              const isOperating = status === "operating";
              const isCompleted = status === "completed";

              return (
                <div key={slot.id} className="relative group">
                  {/* Timeline dot */}
                  <div
                    className={cn(
                      "absolute -left-[31px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-black transition-all",
                      isOperating
                        ? "bg-cyan ring-4 ring-cyan/50 animate-pulse"
                        : isCompleted
                        ? "bg-emerald-400 border-emerald-500"
                        : isBreak
                        ? "bg-amber"
                        : asgs.length > 0
                        ? "bg-cyan/70"
                        : "bg-muted"
                    )}
                  />

                  <div
                    className={cn(
                      "rounded-2xl border p-4 space-y-3 transition-colors",
                      isOperating
                        ? "border-cyan bg-cyan/10 ring-1 ring-cyan shadow-[0_0_20px_rgba(56,225,255,0.25)]"
                        : isCompleted
                        ? "border-emerald-500/30 bg-emerald-950/15"
                        : "border-line bg-white/[0.02] hover:border-cyan/40"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-cream">
                          {isBreak ? "BREAK" : `ROTATION ${slot.idx + 1}`}
                        </span>
                        <span className="font-mono text-xs text-muted">· {slot.day}</span>
                        {isOperating && (
                          <span className="font-mono text-[9px] font-black uppercase tracking-wider text-navy bg-cyan px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                            <span className="liveDot !h-1.5 !w-1.5 !bg-navy" /> Operating Now
                          </span>
                        )}
                        {isCompleted && (
                          <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                            <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" /> Completed
                          </span>
                        )}
                      </div>
                      <div
                        className={cn(
                          "rounded-full px-3 py-1 font-mono text-xs font-bold",
                          isOperating
                            ? "bg-cyan text-navy shadow-[0_0_10px_rgba(56,225,255,0.5)]"
                            : isCompleted
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : "bg-cyan/10 border border-cyan/30 text-cyan"
                        )}
                      >
                        {slot.startsAt} – {slot.endsAt}
                      </div>
                    </div>

                    {isBreak ? (
                      <div className="flex items-center gap-2 text-xs text-amber font-medium">
                        <Coffee className="h-4 w-4" />
                        <span>Break interval. No mentoring assignments.</span>
                      </div>
                    ) : asgs.length === 0 ? (
                      <div className="text-xs text-muted font-mono">Open rotation. Free period.</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {asgs.map((a) => (
                          <div
                            key={a.assignmentId}
                            onClick={() =>
                              setModalTeam({
                                teamId: a.teamId,
                                teamName: a.teamName,
                                location: a.teamLocation,
                                categories: a.categories,
                                currentSlot: slot,
                              })
                            }
                            className="cursor-pointer p-3 rounded-xl border border-white/10 hover:border-cyan/50 bg-black/40 hover:bg-black/60 transition-all space-y-1.5"
                          >
                            <div className="font-bold text-sm text-cream hover:text-cyan">{a.teamName}</div>
                            {a.teamLocation && (
                              <div className="flex items-center gap-1.5 font-mono text-[10px] text-white/90">
                                <span
                                  className="h-2 w-2 rounded-full shrink-0"
                                  style={{ background: locationColor(a.teamLocation) }}
                                />
                                <span className="truncate">{locLabel(a.teamLocation)}</span>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-1">
                              {a.categories.map((c) => (
                                <CatChip
                                  key={c}
                                  name={catById.get(c)?.name ?? "?"}
                                  color={catById.get(c)?.color ?? "#58efff"}
                                  className="!px-1.5 !py-0 !text-[8.5px]"
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 3: BY TEAM VIEW */}
      {view === "team" && (
        <div className="space-y-4">
          <div className="panelHead !p-0 !pb-2">
            <h2>Assigned Teams Portfolio</h2>
            <span className="monoLabel">{filteredTeams.length} TEAMS</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredTeams.map((team) => (
              <div
                key={team.teamId}
                onClick={() =>
                  setModalTeam({
                    teamId: team.teamId,
                    teamName: team.teamName,
                    location: team.teamLocation,
                    categories: team.categories,
                  })
                }
                className="cursor-pointer rounded-2xl border border-line bg-white/[0.02] p-4 hover:border-cyan/50 hover:bg-white/[0.04] transition-all flex flex-col justify-between space-y-3"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-bold text-base text-cream">{team.teamName}</div>
                    <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan/15 text-cyan border border-cyan/30 shrink-0">
                      {team.slots.length} {team.slots.length === 1 ? "Session" : "Sessions"}
                    </span>
                  </div>

                  {team.teamLocation ? (
                    <div className="flex items-center gap-1.5 font-mono text-xs text-white/90">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ background: locationColor(team.teamLocation) }}
                      />
                      <span className="truncate">{locLabel(team.teamLocation)}</span>
                    </div>
                  ) : (
                    <div className="font-mono text-xs text-muted">— No Station Assigned</div>
                  )}

                  <div className="flex flex-wrap gap-1">
                    {team.categories.map((c) => (
                      <CatChip
                        key={c}
                        name={catById.get(c)?.name ?? "?"}
                        color={catById.get(c)?.color ?? "#58efff"}
                        className="!px-2 !py-0.5 !text-[9px]"
                      />
                    ))}
                  </div>
                </div>

                {/* Scheduled Slots Pills */}
                <div className="pt-2 border-t border-line/60">
                  <div className="text-[10px] font-mono text-muted uppercase tracking-wider mb-1.5">
                    Meeting Times:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {team.slots.map((s) => (
                      <span
                        key={s.id}
                        className="font-mono text-[10px] px-2 py-0.5 rounded bg-black/40 border border-white/10 text-cream"
                      >
                        Rot. {s.idx + 1} ({s.startsAt})
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredTeams.length === 0 && (
            <div className="panel p-12 text-center font-mono text-xs text-muted">
              No teams match your filter criteria.
            </div>
          )}
        </div>
      )}

      {/* VIEW 4: BY TRACK / CATEGORY VIEW */}
      {view === "category" && (
        <div className="space-y-6">
          {allCategories
            .filter((c) => selectedCategory === "all" || c.id === selectedCategory)
            .map((cat) => {
              const catTeams = uniqueTeams.filter((t) => t.categories.includes(cat.id));
              if (catTeams.length === 0 && selectedCategory !== "all") return null;
              if (catTeams.length === 0) return null;

              return (
                <div key={cat.id} className="panel p-5 space-y-3">
                  <div className="flex items-center justify-between gap-3 pb-3 border-b border-line/60">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: cat.color }} />
                      <h3 className="font-bold text-base text-cream">{cat.name}</h3>
                    </div>
                    <span className="monoLabel">{catTeams.length} TEAMS</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {catTeams.map((team) => (
                      <div
                        key={team.teamId}
                        onClick={() =>
                          setModalTeam({
                            teamId: team.teamId,
                            teamName: team.teamName,
                            location: team.teamLocation,
                            categories: team.categories,
                          })
                        }
                        className="cursor-pointer p-3 rounded-xl border border-line bg-black/30 hover:border-cyan/40 transition-colors space-y-1.5"
                      >
                        <div className="font-bold text-sm text-cream">{team.teamName}</div>
                        {team.teamLocation && (
                          <div className="flex items-center gap-1.5 font-mono text-[10px] text-white/90">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ background: locationColor(team.teamLocation) }}
                            />
                            <span className="truncate">{locLabel(team.teamLocation)}</span>
                          </div>
                        )}
                        <div className="font-mono text-[10px] text-muted">
                          {team.slots.length} rotation {team.slots.length === 1 ? "session" : "sessions"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* VIEW 5: BY LOCATION VIEW */}
      {view === "location" && (
        <div className="space-y-6">
          {availableLocations
            .filter((loc) => selectedLocation === "all" || loc === selectedLocation)
            .map((locKey) => {
              const locTeams = uniqueTeams.filter(
                (t) => t.teamLocation && getFullLocationKey(t.teamLocation) === locKey
              );
              if (locTeams.length === 0) return null;

              const sampleLoc = locTeams[0]?.teamLocation;
              const color = locationColor(sampleLoc);

              return (
                <div key={locKey} className="panel p-5 space-y-3">
                  <div className="flex items-center justify-between gap-3 pb-3 border-b border-line/60">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: color }} />
                      <h3 className="font-bold text-base text-cream">{locKey}</h3>
                    </div>
                    <span className="monoLabel">{locTeams.length} TEAMS</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {locTeams.map((team) => (
                      <div
                        key={team.teamId}
                        onClick={() =>
                          setModalTeam({
                            teamId: team.teamId,
                            teamName: team.teamName,
                            location: team.teamLocation,
                            categories: team.categories,
                          })
                        }
                        className="cursor-pointer p-3 rounded-xl border border-line bg-black/30 hover:border-cyan/40 transition-colors space-y-1.5"
                      >
                        <div className="font-bold text-sm text-cream">{team.teamName}</div>
                        <div className="flex flex-wrap gap-1">
                          {team.categories.map((c) => (
                            <CatChip
                              key={c}
                              name={catById.get(c)?.name ?? "?"}
                              color={catById.get(c)?.color ?? "#58efff"}
                              className="!px-1.5 !py-0 !text-[8.5px]"
                            />
                          ))}
                        </div>
                        <div className="font-mono text-[10px] text-muted">
                          {team.slots.length} rotation {team.slots.length === 1 ? "session" : "sessions"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* TEAM / SESSION MODAL DETAILS */}
      {modalTeam && (
        <Modal
          title={modalTeam.teamName}
          open={!!modalTeam}
          onClose={() => setModalTeam(null)}
          className="max-w-md"
        >
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted">Physical Station</span>
              <div className="p-3 rounded-xl bg-black/40 border border-line flex items-center gap-2.5">
                <span
                  className="h-3.5 w-3.5 rounded-full shrink-0"
                  style={{ background: locationColor(modalTeam.location) }}
                />
                <div className="font-mono text-xs text-white">
                  {modalTeam.location ? locLabel(modalTeam.location) : "No station assigned"}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted">Challenge Tracks</span>
              <div className="flex flex-wrap gap-1.5">
                {modalTeam.categories.map((c) => (
                  <CatChip
                    key={c}
                    name={catById.get(c)?.name ?? "?"}
                    color={catById.get(c)?.color ?? "#58efff"}
                    className="!px-2.5 !py-1 !text-xs font-semibold"
                  />
                ))}
              </div>
            </div>

            {/* Mentor Field Match Highlight */}
            {modalTeam.categories.some((c) => mentor.categories.includes(c)) && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-cyan/10 border border-cyan/30 text-cyan text-xs font-medium">
                <Sparkles className="h-4 w-4 shrink-0 text-cyan animate-pulse" />
                <span>
                  <strong>Field Match:</strong> Team challenges align with your field (
                  {modalTeam.categories
                    .filter((c) => mentor.categories.includes(c))
                    .map((c) => catById.get(c)?.name ?? "Specialty")
                    .join(", ")}
                  ).
                </span>
              </div>
            )}

            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted">
                Rotation Sessions with {mentor.name}
              </span>
              <div className="space-y-2">
                {activeCycle?.slots
                  .filter((s) => asgsBySlot.get(s.id)?.some((a) => a.teamId === modalTeam.teamId))
                  .map((s) => {
                    const st = getSlotStatus(s);
                    return (
                      <div
                        key={s.id}
                        className={cn(
                          "flex items-center justify-between p-2.5 rounded-lg border transition-colors",
                          st === "operating"
                            ? "border-cyan/60 bg-cyan/15 text-cream ring-1 ring-cyan/40"
                            : st === "completed"
                            ? "border-emerald-500/30 bg-emerald-950/20 text-cream/80"
                            : "border-line/80 bg-white/[0.02]"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-cream">
                            Rotation {s.idx + 1} ({s.day})
                          </span>
                          {st === "operating" && (
                            <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded-full bg-cyan text-navy font-black shadow-sm">
                              Live Now
                            </span>
                          )}
                          {st === "completed" && (
                            <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                              ✓ Complete
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-xs text-cyan font-bold">
                          {s.startsAt} – {s.endsAt}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => setModalTeam(null)}
                className="w-full rounded-xl bg-white/10 hover:bg-white/15 py-2 text-xs font-bold text-white transition-colors"
              >
                Close Details
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
