"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Lock,
  LockOpen,
  RefreshCw,
  Search,
  Sparkles,
  Trash2
} from "lucide-react";
import { addAssignment, moveAssignment, removeAssignment, toggleLock } from "@/app/actions/cycles";
import { createClient } from "@/lib/supabase/client";
import { buildExportForView, downloadExcel, downloadPdf, slotLabel } from "@/lib/export";
import { computeAnalytics } from "@/lib/analytics";
import { getSlotTimeStatus, findOperatingSlot, type SlotTimeStatus } from "@/lib/slots";
import type { AssignmentRow, CycleData, CycleMentorRow } from "@/lib/cycle-model";
import { cn, getFullLocationKey, locationColor } from "@/lib/utils";
import { CatChip, Modal, Msg, locLabel } from "@/components/ui";
import { useChangeFlow } from "@/components/change-ui";
import { AvailabilityPanel, IssuesPanel, MembersPanel, SlotsPanel } from "@/components/board-panels";

type View = "mentor" | "team" | "category" | "location" | "slot";
type Tab = "schedule" | "issues" | "availability" | "slots" | "members";

export function ScheduleBoard({
  data,
  isSuper,
  allMentors,
  allTeams
}: {
  data: CycleData;
  isSuper: boolean;
  allMentors: { id: string; name: string }[];
  allTeams: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("schedule");
  const [view, setView] = useState<View>("mentor");
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "ok" | "info"; text: string } | null>(null);
  const [cellModal, setCellModal] = useState<{ mentor: CycleMentorRow; slotId: string } | null>(null);
  const [live, setLive] = useState(true);
  const flow = useChangeFlow(data.cycle.id);

  const catById = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);
  const teamById = useMemo(() => new Map(data.teams.map((t) => [t.id, t])), [data.teams]);
  const locById = useMemo(() => new Map(data.locations.map((l) => [l.id, l])), [data.locations]);
  const slots = data.slots;
  const sessions = slots.filter((s) => s.kind === "session");
  const cells = useMemo(() => {
    const m = new Map<string, AssignmentRow[]>();
    for (const a of data.assignments)
      m.set(`${a.cycle_mentor_id}|${a.slot_id}`, [...(m.get(`${a.cycle_mentor_id}|${a.slot_id}`) ?? []), a]);
    return m;
  }, [data.assignments]);
  const teamCells = useMemo(() => {
    const m = new Map<string, AssignmentRow[]>();
    for (const a of data.assignments)
      m.set(`${a.cycle_team_id}|${a.slot_id}`, [...(m.get(`${a.cycle_team_id}|${a.slot_id}`) ?? []), a]);
    return m;
  }, [data.assignments]);
  const absent = useMemo(
    () => new Map(data.mAvail.map((a) => [`${a.cycle_mentor_id}|${a.slot_id}`, a.reason ?? "absent"])),
    [data.mAvail]
  );
  const teamAbsent = useMemo(() => new Set(data.tAvail.map((a) => `${a.cycle_team_id}|${a.slot_id}`)), [data.tAvail]);
  const analytics = useMemo(() => computeAnalytics(data), [data]);
  const mentorLoad = useMemo(() => new Map(analytics.mentorLoad.map((m) => [m.id, m.sessions])), [analytics]);
  const slotLoad = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of data.assignments) m.set(a.slot_id, (m.get(a.slot_id) ?? 0) + 1);
    return m;
  }, [data.assignments]);
  const mentorName = useMemo(() => new Map(data.mentors.map((m) => [m.id, m.mentor_name])), [data.mentors]);
  const locationLegend = useMemo(() => {
    const map = new Map<string, { key: string; color: string; count: number }>();
    for (const t of data.teams) {
      if (t.status === "removed") continue;
      const loc = t.location_id ? locById.get(t.location_id) : null;
      const key = getFullLocationKey(loc);
      const color = locationColor(loc);
      const cur = map.get(key) ?? { key, color, count: 0 };
      cur.count++;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  }, [data.teams, locById]);

  // Live clock and operating slot tracking
  const [now, setNow] = useState<Date>(() => new Date());
  const [simulatedSlotId, setSimulatedSlotId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  const getSlotStatus = useCallback(
    (s: (typeof slots)[number]): SlotTimeStatus => {
      if (simulatedSlotId) {
        if (s.id === simulatedSlotId) return "operating";
        const targetSlot = slots.find((x) => x.id === simulatedSlotId);
        if (targetSlot) {
          return s.idx < targetSlot.idx ? "completed" : "upcoming";
        }
      }
      return getSlotTimeStatus(s, now);
    },
    [simulatedSlotId, slots, now]
  );

  const operatingSlot = useMemo(() => {
    if (simulatedSlotId) return slots.find((s) => s.id === simulatedSlotId) ?? null;
    return findOperatingSlot(slots, now);
  }, [slots, simulatedSlotId, now]);

  const completedCount = useMemo(() => {
    return slots.filter((s) => getSlotStatus(s) === "completed").length;
  }, [slots, getSlotStatus]);

  // Live updates realtime channel
  useEffect(() => {
    if (!live) return;
    const sb = createClient();
    let t: ReturnType<typeof setTimeout>;
    const ch = sb
      .channel(`asg-${data.cycle.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assignments", filter: `cycle_id=eq.${data.cycle.id}` },
        () => {
          clearTimeout(t);
          t = setTimeout(() => router.refresh(), 400);
        }
      )
      .subscribe();
    return () => {
      clearTimeout(t);
      sb.removeChannel(ch);
    };
  }, [live, data.cycle.id, router]);

  const ql = q.trim().toLowerCase();
  const matchMentor = (m: CycleMentorRow) =>
    !ql ||
    m.mentor_name.toLowerCase().includes(ql) ||
    m.categories.some((c) => catById.get(c)?.name.toLowerCase().includes(ql));
  const teamDim = (teamId: string) => {
    const t = teamById.get(teamId);
    if (!t) return false;
    if (catFilter && !t.categories.includes(catFilter)) return true;
    return ql
      ? !t.team_name.toLowerCase().includes(ql) &&
          !t.categories.some((c) => catById.get(c)?.name.toLowerCase().includes(ql))
      : false;
  };

  const mentorRows = useMemo(() => {
    let list = data.mentors.filter((m) => m.status !== "removed");
    if (ql) {
      const teamHit = new Set(data.teams.filter((t) => t.team_name.toLowerCase().includes(ql)).map((t) => t.id));
      list = list.filter(
        (m) =>
          matchMentor(m) ||
          data.assignments.some((a) => a.cycle_mentor_id === m.id && teamHit.has(a.cycle_team_id))
      );
    }
    if (catFilter) list = list.filter((m) => m.categories.includes(catFilter));
    return list;
  }, [data, ql, catFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const g = new Map<string, CycleMentorRow[]>();
    for (const m of mentorRows) {
      const key =
        view === "category"
          ? catById.get(m.categories[0])?.name ?? "Uncategorised"
          : view === "location"
          ? locLabel(m.location_id ? locById.get(m.location_id) : null)
          : "";
      g.set(key, [...(g.get(key) ?? []), m]);
    }
    return [...g.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: "base" })
    );
  }, [mentorRows, view, catById, locById]);

  async function run(f: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    const r = await f();
    if (!r.ok) setFlash({ kind: "error", text: r.error ?? "Failed" });
    else {
      setFlash(okMsg ? { kind: "ok", text: okMsg } : null);
      router.refresh();
    }
  }

  const onDrop = (mentorId: string, slotId: string) => {
    if (!drag) return;
    const id = drag;
    setDrag(null);
    run(() => moveAssignment(data.cycle.id, id, slotId, mentorId));
  };

  const asgPill = (a: AssignmentRow) => {
    const t = teamById.get(a.cycle_team_id);
    const loc = t?.location_id ? locById.get(t.location_id) : null;
    const color = locationColor(loc);
    return (
      <motion.div
        key={a.id}
        layout
        layoutId={a.id}
        draggable
        onDragStart={() => setDrag(a.id)}
        onDragEnd={() => setDrag(null)}
        title={`${t?.team_name}${loc ? ` · ${locLabel(loc)}` : ""} — ${t?.categories.map((c) => catById.get(c)?.name).join(", ")}${
          a.locked ? " (locked)" : ""
        }`}
        className={cn(
          "flex cursor-grab items-center justify-between gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-white shadow-md active:cursor-grabbing border border-white/20 transition-transform hover:scale-[1.02]",
          teamDim(a.cycle_team_id) && "opacity-25"
        )}
        style={{
          background: `linear-gradient(135deg, ${color}, ${color}cc)`,
          boxShadow: `0 2px 10px ${color}33`
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0 truncate">
          {a.locked && <Lock className="h-3 w-3 shrink-0 text-amber-300" />}
          <span className="truncate">{t?.team_name}</span>
        </div>
        {loc?.section ? (
          <span
            className="shrink-0 font-mono text-[9px] px-1 py-0.5 rounded bg-black/40 border border-white/15 text-white/95"
            title={locLabel(loc)}
          >
            {loc.section}
          </span>
        ) : (
          <span
            className="shrink-0 font-mono text-[9px] px-1 py-0.5 rounded bg-black/30 text-white/70"
            title="No location assigned"
          >
            —
          </span>
        )}
      </motion.div>
    );
  };

  const mentorCell = (m: CycleMentorRow, s: (typeof slots)[number]) => {
    const asg = cells.get(`${m.id}|${s.id}`) ?? [];
    const status = getSlotStatus(s);
    const isOperatingCol = status === "operating";
    const isCompletedCol = status === "completed";
    const why =
      s.kind === "break" || !s.enabled
        ? "break"
        : m.status === "absent"
        ? "absent"
        : absent.get(`${m.id}|${s.id}`);
    if (why === "break")
      return (
        <td
          key={s.id + m.id}
          className={cn(
            "cell-break h-10 min-w-28 text-center font-mono text-[9px] font-bold uppercase text-orange/80 transition-colors",
            isOperatingCol && "bg-cyan/15 ring-1 ring-cyan/40",
            isCompletedCol && "opacity-75"
          )}
        >
          {s.kind === "break" ? "Break" : "Off"}
        </td>
      );
    if (why)
      return (
        <td
          key={s.id + m.id}
          className={cn(
            "cell-absent h-10 min-w-28 text-center font-mono text-[9px] font-bold uppercase text-[#ffaaa0] transition-colors",
            isOperatingCol && "bg-cyan/15 ring-1 ring-cyan/40",
            isCompletedCol && "opacity-75"
          )}
        >
          {why === "absent" ? "Absent" : "On break"}
        </td>
      );
    return (
      <td
        key={s.id + m.id}
        className={cn(
          "h-10 min-w-28 max-w-36 cursor-pointer p-1 align-top transition-colors hover:bg-cyan/10",
          isOperatingCol && "bg-cyan/[0.06] border-x border-cyan/30",
          isCompletedCol && "bg-emerald-950/[0.04]",
          drag && "outline-dashed outline-1 -outline-offset-2 outline-cyan"
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => onDrop(m.id, s.id)}
        onClick={() => setCellModal({ mentor: m, slotId: s.id })}
      >
        <div className="space-y-1">{asg.map((a) => asgPill(a))}</div>
      </td>
    );
  };

  const mentorHeader = (m: CycleMentorRow) => (
    <td className="stick-col min-w-56 max-w-64 px-3 py-2 align-top">
      <div className="flex items-start gap-1.5">
        <button
          className="mt-0.5 text-muted hover:text-cream"
          onClick={() =>
            setExpanded((e) => {
              const n = new Set(e);
              if (n.has(m.id)) {
                n.delete(m.id);
              } else {
                n.add(m.id);
              }
              return n;
            })
          }
        >
          {expanded.has(m.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span
              className={cn(
                "truncate font-bold text-xs text-cream",
                m.status === "absent" && "text-[#ffaaa0] line-through"
              )}
            >
              {m.mentor_name}
            </span>
            <span
              className="rounded-full bg-cream px-1.5 py-0.2 font-mono text-[10px] font-bold text-navy"
              title="Assigned sessions"
            >
              {mentorLoad.get(m.id) ?? 0}
            </span>
          </div>
          {m.location_id && locById.get(m.location_id) && (
            <div className="font-mono text-[9px] text-cyan flex items-center gap-1 mt-0.5 truncate" title={`Assigned Station: ${locLabel(locById.get(m.location_id))}`}>
              <span className="text-[10px]">📍</span> {locLabel(locById.get(m.location_id))}
            </div>
          )}
          <div className="flex flex-wrap gap-1 mt-1">
            {m.categories.map((c) => (
              <CatChip
                key={c}
                name={catById.get(c)?.name ?? "?"}
                color={catById.get(c)?.color ?? "#999"}
                className="!px-1.5 !py-0 !text-[8.5px]"
              />
            ))}
          </div>
          <AnimatePresence initial={false}>
            {expanded.has(m.id) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden font-mono text-[10px] text-muted space-y-0.5 pt-2"
              >
                <div>{locLabel(m.location_id ? locById.get(m.location_id) : null)}</div>
                {sessions.map((s) =>
                  (cells.get(`${m.id}|${s.id}`) ?? []).map((a) => {
                    const tm = teamById.get(a.cycle_team_id);
                    const tLoc = tm?.location_id ? locById.get(tm.location_id) : null;
                    return (
                      <div key={a.id}>
                        {slotLabel(s)} → <b className="text-cream">{tm?.team_name}</b>
                        {tLoc && (
                          <span className="text-muted ml-1 font-normal">
                            ({locLabel(tLoc)})
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </td>
  );

  const slotHead = (s: (typeof slots)[number]) => {
    const status = getSlotStatus(s);
    const isOperating = status === "operating";
    const isCompleted = status === "completed";

    return (
      <th
        key={s.id}
        className={cn(
          "min-w-28 px-2 py-2 text-center font-mono text-[10px] font-bold border-r border-line transition-all relative",
          isOperating
            ? "bg-gradient-to-b from-cyan/30 via-cyan/15 to-[#0b163d] text-cyan border-b-2 border-b-cyan shadow-[0_0_20px_rgba(56,225,255,0.4)] ring-2 ring-cyan/80 ring-inset"
            : isCompleted
            ? "bg-emerald-950/20 text-cream/80 border-b-2 border-b-emerald-500/50"
            : s.kind === "break"
            ? "bg-orange/10 text-orange"
            : "text-cream"
        )}
      >
        {isOperating && (
          <div className="flex items-center justify-center gap-1 mb-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan"></span>
            </span>
            <span className="font-mono text-[8px] font-black uppercase tracking-wider text-cyan bg-cyan/25 px-1.5 py-0.5 rounded-full border border-cyan/50 shadow-sm">
              Live Operating
            </span>
          </div>
        )}
        {isCompleted && (
          <div className="flex items-center justify-center gap-1 mb-1">
            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded-full border border-emerald-500/40 inline-flex items-center gap-0.5">
              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />
              Complete
            </span>
          </div>
        )}
        <div className="text-[10px] text-muted">{s.day.slice(5)}</div>
        <div
          className={cn(
            "text-xs font-extrabold",
            isOperating
              ? "text-cyan drop-shadow-[0_0_8px_rgba(56,225,255,0.8)]"
              : isCompleted
              ? "text-emerald-400/90"
              : "text-cyan"
          )}
        >
          {s.starts_at.slice(0, 5)} - {s.ends_at.slice(0, 5)}
        </div>
        {s.kind === "session" && (
          <div className="font-mono text-[8px] text-muted mt-0.5">{slotLoad.get(s.id) ?? 0} asg</div>
        )}
      </th>
    );
  };

  const exportFile = (kind: "xlsx" | "pdf") => {
    const tables = buildExportForView(data, view, { catFilter, q });
    const viewSlug =
      view === "category"
        ? "by-category"
        : view === "team"
        ? "by-team"
        : view === "location"
        ? "by-location"
        : view === "slot"
        ? "by-slot"
        : "by-mentor";
    return kind === "xlsx"
      ? downloadExcel(`${data.cycle.name}-${viewSlug}`, tables)
      : downloadPdf(`${data.cycle.name}-${viewSlug}`, tables);
  };

  const errors = analytics.issues.filter((i) => i.severity === "error").length;
  const warns = analytics.issues.filter((i) => i.severity === "warning").length;
  const modalSlot = cellModal ? slots.find((s) => s.id === cellModal.slotId) : null;

  return (
    <div className="space-y-5">
      {/* Target Site Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <nav className="navTabs" aria-label="Cycle board views">
          {(
            [
              ["schedule", "Schedule Board"],
              ["issues", `Report${errors + warns ? ` (${errors + warns})` : ""}`],
              ["availability", "Availability"],
              ["slots", "Slots & Breaks"],
              ["members", "Settings & Members"]
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn("navTab cursor-pointer", tab === k && "active")}
            >
              {l}
            </button>
          ))}
        </nav>

        {/* Live indicator & refresh */}
        <div className="flex items-center gap-2">
          <button
            className={cn(
              "pillBtn !py-1.5 !px-3 font-mono text-[10px] uppercase font-bold",
              live ? "border-[#65ffbd]/40 text-[#65ffbd]" : "text-muted"
            )}
            onClick={() => setLive(!live)}
            title="Realtime updates channel"
          >
            <span className={live ? "liveDot" : "inline-block w-1.5 h-1.5 rounded-full bg-muted mr-1.5"} />
            {live ? "Live Sync Active" : "Sync Paused"}
          </button>
          <button
            className="iconBtn !w-8 !h-8"
            onClick={() => router.refresh()}
            title="Reload telemetry"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {flash && <Msg kind={flash.kind}>{flash.text}</Msg>}
      {flow.error && <Msg kind="error">{flow.error}</Msg>}
      {flow.notice && <Msg kind="ok">{flow.notice}</Msg>}
      {flow.node}

      {tab === "schedule" && (
        <>
          {/* Schedule Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="searchBox">
              <Search className="h-3.5 w-3.5 text-muted" />
              <input
                placeholder="Search mentor, team, tag…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <select
              className="input !w-44 !py-1.5 !text-xs font-mono"
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
            >
              <option value="" className="bg-[#080936]">All Categories</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#080936]">
                  {c.name}
                </option>
              ))}
            </select>

            <select
              className="input !w-40 !py-1.5 !text-xs font-mono"
              value={view}
              onChange={(e) => setView(e.target.value as View)}
            >
              <option value="mentor" className="bg-[#080936]">By Mentor</option>
              <option value="team" className="bg-[#080936]">By Team</option>
              <option value="category" className="bg-[#080936]">By Category</option>
              <option value="location" className="bg-[#080936]">By Location</option>
              <option value="slot" className="bg-[#080936]">By Time Slot</option>
            </select>

            {/* Live Clock / Simulation Selector */}
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <span className="text-[10px] text-muted uppercase hidden sm:inline">Operating Slot:</span>
              <select
                className="input !w-auto !py-1.5 !text-xs font-mono"
                value={simulatedSlotId ?? "live"}
                onChange={(e) => setSimulatedSlotId(e.target.value === "live" ? null : e.target.value)}
                title="Toggle between automatic live clock or simulate a specific operating slot"
              >
                <option value="live">Auto (Live Clock)</option>
                <optgroup label="Simulate / Test Active Slot">
                  {slots.map((s) => (
                    <option key={s.id} value={s.id}>
                      Slot {s.idx + 1}: {s.starts_at.slice(0, 5)} - {s.ends_at.slice(0, 5)} ({s.kind})
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button className="btn !py-1.5 !px-3 font-mono text-[11px]" onClick={() => exportFile("xlsx")}>
                <Download className="h-3.5 w-3.5 text-cyan" /> Excel
              </button>
              <button className="btn !py-1.5 !px-3 font-mono text-[11px]" onClick={() => exportFile("pdf")}>
                <FileText className="h-3.5 w-3.5 text-orange" /> PDF
              </button>
              <button
                className="btn-primary !py-1.5 !px-4 text-xs font-bold"
                disabled={flow.busy}
                onClick={() =>
                  flow.ask(
                    { type: "regenerate" },
                    data.assignments.length
                      ? "Regenerate schedule (manual locks will be preserved)"
                      : "Generate optimal cycle schedule",
                    true
                  )
                }
              >
                <Sparkles className="h-3.5 w-3.5" />
                {data.assignments.length ? "Regenerate" : "Generate Schedule"}
              </button>
            </div>
          </div>

          {/* Telemetry quick strip with live rotation indicator */}
          <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-muted py-1">
            {operatingSlot ? (
              <span className="flex items-center gap-2 px-3 py-1 rounded-xl bg-cyan/15 border border-cyan/40 shadow-[0_0_12px_rgba(56,225,255,0.25)] text-cyan">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan"></span>
                </span>
                <span className="font-mono text-[11px] font-black uppercase tracking-wider">
                  Operating Now: {operatingSlot.kind === "break" ? "Break Interval" : `Rotation ${operatingSlot.idx + 1}`} ({operatingSlot.starts_at.slice(0, 5)} - {operatingSlot.ends_at.slice(0, 5)})
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/[0.03] border border-line text-[11px] font-mono text-muted">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>{completedCount} / {slots.length} Rotations Complete</span>
              </span>
            )}

            <span className="text-cream">
              <strong className="text-orange">{analytics.totals.assignments}</strong> assignments
            </span>
            <span>
              <strong className="text-cyan">{Math.round(analytics.completion * 100)}%</strong> completion
            </span>
            <span>
              <strong className="text-cream">{Math.round(analytics.coverage * 100)}%</strong> exposure
            </span>
            {errors > 0 && <span className="text-[#ffaaa0]">{errors} conflicts</span>}
            {warns > 0 && <span className="text-orange">{warns} warnings</span>}

            <span className="ml-auto hidden md:flex items-center gap-3 flex-wrap">
              <span className="text-[10px] text-muted font-mono uppercase tracking-wider">Locations:</span>
              {locationLegend.map((item) => (
                <span key={item.key} className="flex items-center gap-1.5 text-[10px] font-medium text-white/90">
                  <i className="inline-block h-2.5 w-2.5 rounded-full shadow-sm" style={{ background: item.color }} />
                  {item.key} ({item.count})
                </span>
              ))}
            </span>
          </div>

          {/* Empty schedule callout */}
          {data.assignments.length === 0 && data.mentors.length > 0 && sessions.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 rounded-2xl border border-cyan/40 bg-gradient-to-r from-cyan/15 via-[#0d1645] to-cyan/5 backdrop-blur shadow-xl">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                  <Sparkles className="h-4 w-4 text-cyan animate-pulse" />
                  Schedule Not Yet Distributed
                </div>
                <p className="text-xs text-muted font-mono leading-relaxed">
                  This cycle has {data.mentors.length} mentors, {data.teams.length} teams, and {sessions.length} rotation slots configured.
                  Click below to automatically optimize category matching and physical room proximity.
                </p>
              </div>
              <button
                className="btn-primary !py-2.5 !px-5 text-xs font-bold shrink-0 shadow-cyan/25 shadow-lg hover:scale-105 transition-all inline-flex items-center gap-2"
                disabled={flow.busy}
                onClick={() =>
                  flow.ask(
                    { type: "regenerate" },
                    "Generate optimal cycle schedule",
                    true
                  )
                }
              >
                <Sparkles className="h-4 w-4" />
                {flow.busy ? "Computing Schedule…" : "Generate Schedule Now"}
              </button>
            </div>
          )}

          {/* Excel Spreadsheet Table Container */}
          <div className="panel max-h-[72vh] overflow-auto !rounded-2xl border border-line shadow-2xl">
            {!slots.length ? (
              <p className="p-8 text-center font-mono text-muted text-xs">This cycle has no time slots configured.</p>
            ) : !data.mentors.length ? (
              <p className="p-8 text-center font-mono text-muted text-xs">Add mentors in the Members tab.</p>
            ) : (
              <table className="sheet w-max min-w-full">
                {view === "team" ? (
                  <>
                    <thead>
                      <tr>
                        <th className="stick-col px-3 py-2 text-left font-mono text-[11px] font-bold uppercase tracking-wider text-muted">
                          TEAM
                        </th>
                        {sessions.map(slotHead)}
                      </tr>
                    </thead>
                    <tbody>
                      {data.teams
                        .filter(
                          (t) =>
                            t.status !== "removed" &&
                            (!catFilter || t.categories.includes(catFilter)) &&
                            (!ql || t.team_name.toLowerCase().includes(ql))
                        )
                        .map((t) => (
                          <tr key={t.id}>
                            <td className="stick-col min-w-56 px-3 py-2">
                              <div className="font-bold text-xs text-cream">{t.team_name}</div>
                              {t.location_id && locById.get(t.location_id) && (
                                <div className="font-mono text-[9px] text-amber truncate">
                                  {locLabel(locById.get(t.location_id))}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {t.categories.map((c) => (
                                  <CatChip
                                    key={c}
                                    name={catById.get(c)?.name ?? "?"}
                                    color={catById.get(c)?.color ?? "#999"}
                                    className="!px-1.5 !py-0 !text-[8.5px]"
                                  />
                                ))}
                              </div>
                            </td>
                            {sessions.map((s) => {
                              const isOperatingCol = operatingSlot?.id === s.id;
                              const isCompletedCol = getSlotStatus(s) === "completed";
                              return teamAbsent.has(`${t.id}|${s.id}`) || t.status === "absent" ? (
                                <td
                                  key={s.id}
                                  className={cn(
                                    "cell-absent text-center font-mono text-[9px] font-bold text-[#ffaaa0] transition-colors",
                                    isOperatingCol && "bg-cyan/15 ring-1 ring-cyan/40",
                                    isCompletedCol && "opacity-75"
                                  )}
                                >
                                  ABSENT
                                </td>
                              ) : (
                                <td
                                  key={s.id}
                                  className={cn(
                                    "p-1 align-top transition-colors",
                                    isOperatingCol && "bg-cyan/[0.06] border-x border-cyan/30",
                                    isCompletedCol && "bg-emerald-950/[0.04]"
                                  )}
                                >
                                  {(teamCells.get(`${t.id}|${s.id}`) ?? []).map((a) => (
                                    <div
                                      key={a.id}
                                      className={cn(
                                        "mb-1 flex items-center justify-between gap-1.5 rounded-lg border px-2 py-1 font-mono text-[10px] transition-colors",
                                        isOperatingCol
                                          ? "border-cyan/50 bg-cyan/15 text-cream font-bold shadow-sm"
                                          : isCompletedCol
                                          ? "border-emerald-500/30 bg-emerald-950/20 text-cream/80"
                                          : "border-line bg-white/[0.04] text-cream"
                                      )}
                                    >
                                      <span className="truncate">{mentorName.get(a.cycle_mentor_id)}</span>
                                      <button
                                        title="Remove"
                                        className="text-muted hover:text-[#ffaaa0]"
                                        onClick={() =>
                                          confirm("Remove this assignment?") &&
                                          run(() => removeAssignment(data.cycle.id, a.id))
                                        }
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ))}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                    </tbody>
                  </>
                ) : view === "slot" ? (
                  <>
                    <thead>
                      <tr>
                        <th className="stick-col px-3 py-2 text-left font-mono text-[11px] font-bold uppercase tracking-wider text-muted">
                          TIME SLOT
                        </th>
                        {mentorRows.map((m) => (
                          <th key={m.id} className="min-w-28 px-2 py-2 text-center font-mono text-[10px] text-cream">
                            {m.mentor_name}
                            <div className="font-normal text-[8px] text-muted">
                              {mentorLoad.get(m.id) ?? 0} asg
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {slots.map((s) => {
                        const status = getSlotStatus(s);
                        const isOperating = status === "operating";
                        const isCompleted = status === "completed";
                        return (
                          <tr
                            key={s.id}
                            className={cn(
                              isOperating && "bg-cyan/15 ring-2 ring-cyan/60 font-bold",
                              isCompleted && "bg-emerald-950/10"
                            )}
                          >
                            <td
                              className={cn(
                                "stick-col px-3 py-2 font-mono text-xs font-bold transition-colors",
                                isOperating
                                  ? "text-cyan bg-[#0a1740] border-l-4 border-l-cyan"
                                  : isCompleted
                                  ? "text-emerald-300/90 border-l-4 border-l-emerald-500/50"
                                  : s.kind === "break"
                                  ? "cell-break text-orange"
                                  : "text-cream"
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span>
                                  {slotLabel(s)}
                                  {s.kind === "break" && " · break"}
                                </span>
                                {isOperating && (
                                  <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase px-2 py-0.5 rounded-full bg-cyan/25 text-cyan border border-cyan/40">
                                    <span className="liveDot !h-1.5 !w-1.5" /> Operating Now
                                  </span>
                                )}
                                {isCompleted && (
                                  <span className="inline-flex items-center gap-0.5 font-mono text-[9px] uppercase px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                    <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" /> Complete
                                  </span>
                                )}
                              </div>
                            </td>
                            {mentorRows.map((m) => mentorCell(m, s))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead>
                      <tr>
                        <th className="stick-col px-3 py-2 text-left font-mono text-[11px] font-bold uppercase tracking-wider text-muted">
                          MENTOR
                        </th>
                        {slots.map(slotHead)}
                        <th className="px-3 py-2 text-center font-mono text-[10px] text-cream">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(([g, ms]) => (
                        <FragmentRows key={g} title={g} span={slots.length + 2}>
                          {ms.map((m) => (
                            <tr key={m.id}>
                              {mentorHeader(m)}
                              {slots.map((s) => mentorCell(m, s))}
                              <td className="px-2 text-center font-mono text-xs font-bold text-cream">
                                {mentorLoad.get(m.id) ?? 0}
                              </td>
                            </tr>
                          ))}
                        </FragmentRows>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="stick-col px-3 py-2 font-mono text-xs font-bold text-muted">
                          Per Slot Load
                        </td>
                        {slots.map((s) => (
                          <td key={s.id} className="bg-white/[0.02] text-center font-mono text-xs font-bold text-cyan">
                            {s.kind === "session" ? slotLoad.get(s.id) ?? 0 : ""}
                          </td>
                        ))}
                        <td className="bg-white/[0.02]" />
                      </tr>
                    </tfoot>
                  </>
                )}
              </table>
            )}
          </div>
          <p className="font-mono text-[10px] text-muted leading-relaxed">
            ✦ Drag a team onto another cell to move/swap. Click an open cell to assign manually. Manual assignments are automatically locked so automated regeneration respects them.
          </p>
        </>
      )}

      {tab === "issues" && <IssuesPanel analytics={analytics} cycleId={data.cycle.id} />}
      {tab === "availability" && <AvailabilityPanel data={data} flow={flow} />}
      {tab === "slots" && <SlotsPanel data={data} flow={flow} />}
      {tab === "members" && (
        <MembersPanel data={data} allMentors={allMentors} allTeams={allTeams} isSuper={isSuper} />
      )}

      <Modal
        open={!!cellModal}
        onClose={() => setCellModal(null)}
        title={cellModal ? `${cellModal.mentor.mentor_name} · ${modalSlot ? slotLabel(modalSlot) : ""}` : ""}
      >
        {cellModal && (
          <CellEditor
            key={cellModal.mentor.id + cellModal.slotId}
            data={data}
            mentor={cellModal.mentor}
            slotId={cellModal.slotId}
            asg={cells.get(`${cellModal.mentor.id}|${cellModal.slotId}`) ?? []}
            onDone={() => {
              setCellModal(null);
              router.refresh();
            }}
            onError={(t) => setFlash({ kind: "error", text: t })}
          />
        )}
      </Modal>
    </div>
  );
}

function FragmentRows({
  title,
  span,
  children
}: {
  title: string;
  span: number;
  children: React.ReactNode;
}) {
  return (
    <>
      {title && (
        <tr>
          <td
            colSpan={span}
            className="stick-col bg-[#05062d] border-y border-line px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan"
          >
            ✦ {title}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}

function CellEditor({
  data,
  mentor,
  slotId,
  asg,
  onDone,
  onError
}: {
  data: CycleData;
  mentor: CycleMentorRow;
  slotId: string;
  asg: AssignmentRow[];
  onDone: () => void;
  onError: (t: string) => void;
}) {
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const eligible = data.teams.filter(
    (t) => t.status !== "removed" && t.categories.some((c) => mentor.categories.includes(c))
  );
  const others = data.teams.filter((t) => t.status !== "removed" && !eligible.includes(t));

  const go = async (f: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const r = await f();
    setBusy(false);
    if (!r.ok) onError(r.error ?? "Failed");
    else onDone();
  };

  return (
    <div className="space-y-4 text-xs font-mono">
      {asg.map((a) => (
        <div key={a.id} className="flex items-center justify-between rounded-xl border border-line bg-white/[0.03] p-3">
          <b className="text-sm font-sans text-cream">{data.teams.find((t) => t.id === a.cycle_team_id)?.team_name}</b>
          <div className="flex gap-2">
            <button
              className="btn !py-1 !px-2.5 !text-xs"
              disabled={busy}
              onClick={() => go(() => toggleLock(data.cycle.id, a.id, !a.locked))}
            >
              {a.locked ? (
                <>
                  <LockOpen className="h-3.5 w-3.5 text-orange" /> Unlock
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5 text-cyan" /> Lock
                </>
              )}
            </button>
            <button
              className="btn btn-danger !py-1 !px-2.5 !text-xs"
              disabled={busy}
              onClick={() => go(() => removeAssignment(data.cycle.id, a.id))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}

      {!asg.length && <p className="font-mono text-muted text-xs">Empty slot — no team assigned yet.</p>}

      <div className="field">
        <label>Assign a Team</label>
        <select className="input" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="" className="bg-[#080936]">Select team…</option>
          <optgroup label="Matching Domain Categories" className="bg-[#080936]">
            {eligible.map((t) => (
              <option key={t.id} value={t.id}>
                {t.team_name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Other Categories (Needs Override)" className="bg-[#080936]">
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.team_name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <button
        className="btn-primary w-full justify-center !py-2.5 font-bold"
        disabled={!team || busy || asg.length > 0}
        onClick={() => go(() => addAssignment(data.cycle.id, slotId, mentor.id, team))}
      >
        Assign Team to Slot
      </button>

      {asg.length > 0 && (
        <p className="font-mono text-[10px] text-muted">
          Remove the existing assignment first, or drag teams on the board to swap.
        </p>
      )}
    </div>
  );
}
