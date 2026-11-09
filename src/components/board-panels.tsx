"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock, Plus, RefreshCw, Save, Settings, Sparkles } from "lucide-react";
import { setCycleMembers, setCycleStatus, updateCycleConfig } from "@/app/actions/cycles";
import type { Analytics } from "@/lib/analytics";
import type { CycleData, MemberStatus } from "@/lib/cycle-model";
import { calculateAutoCycleQuotas } from "@/lib/cycle-model";
import { slotLabel } from "@/lib/export";
import { getSlotTimeStatus } from "@/lib/slots";
import { cn } from "@/lib/utils";
import { Msg } from "@/components/ui";
import type { useChangeFlow } from "@/components/change-ui";

type Flow = ReturnType<typeof useChangeFlow>;

export function IssuesPanel({ analytics, cycleId }: { analytics: Analytics; cycleId: string }) {
  const order = { error: 0, warning: 1, info: 2 } as const;
  const issues = [...analytics.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 panel p-4">
        <div>
          <div className="eyebrow">DIAGNOSTIC REPORT</div>
          <p className="font-mono text-xs text-muted">
            Telemetry analysis for current schedule: unsatisfied constraints, workload spread, and absence handling.
          </p>
        </div>
        <Link className="btn-primary !py-1.5 !px-3.5 !text-xs font-bold" href={`/admin/cycles/${cycleId}/analytics`}>
          Detailed Analytics <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {!issues.length && (
        <Msg kind="ok">
          Optimal state reached: Zero scheduling conflicts detected. Every team has balanced exposure and workloads are fair.
        </Msg>
      )}

      <div className="space-y-2">
        {issues.map((i, k) => (
          <Msg key={k} kind={i.severity === "error" ? "error" : i.severity === "warning" ? "info" : "ok"}>
            <b className="mr-2 uppercase font-mono tracking-wider">{i.type.replace(/_/g, " ")}:</b>
            {i.message}
          </Msg>
        ))}
      </div>
    </div>
  );
}

function SlotToggles({
  slots,
  off,
  onToggle
}: {
  slots: CycleData["slots"];
  off: Map<string, string>;
  onToggle: (id: string, isOff: boolean) => void;
}) {
  return (
    <div className="flex max-h-44 flex-wrap gap-1.5 overflow-auto py-2.5">
      {slots
        .filter((s) => s.kind === "session" && s.enabled)
        .map((s) => {
          const r = off.get(s.id);
          return (
            <button
              key={s.id}
              onClick={() => onToggle(s.id, !!r)}
              title={r ? `${r} – click to restore availability` : "Click to mark unavailable for this slot"}
              className={cn(
                "rounded-lg border px-2 py-1 font-mono text-[10px] transition-all",
                r
                  ? r === "break"
                    ? "border-orange/40 bg-orange/15 text-orange"
                    : "border-red-500/40 bg-red-500/15 text-[#ffaaa0]"
                  : "border-line bg-white/[0.03] text-cream hover:border-cyan/50 hover:bg-cyan/10"
              )}
            >
              {slotLabel(s)}
            </button>
          );
        })}
    </div>
  );
}

export function AvailabilityPanel({ data, flow }: { data: CycleData; flow: Flow }) {
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState<"absent" | "break">("absent");
  const [who, setWho] = useState<"mentors" | "teams">("mentors");

  const statusSel = (v: MemberStatus, on: (s: MemberStatus) => void) => (
    <select
      className="input !w-32 !py-1 !text-xs font-mono"
      value={v}
      onChange={(e) => on(e.target.value as MemberStatus)}
    >
      <option value="active" className="bg-[#080936]">Active</option>
      <option value="absent" className="bg-[#080936]">Absent (All)</option>
      <option value="removed" className="bg-[#080936]">Removed</option>
    </select>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="navTabs">
          {(["mentors", "teams"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setWho(k)}
              className={cn("navTab cursor-pointer capitalize", who === k && "active")}
            >
              {k}
            </button>
          ))}
        </div>

        {who === "mentors" && (
          <select
            className="input !w-44 !py-1.5 !text-xs font-mono"
            value={reason}
            onChange={(e) => setReason(e.target.value as "absent" | "break")}
          >
            <option value="absent" className="bg-[#080936]">Action: Mark as absent</option>
            <option value="break" className="bg-[#080936]">Action: Mark as break</option>
          </select>
        )}

        <span className="font-mono text-[10px] text-muted ml-auto">
          ✦ Click any slot to toggle availability. Changes show an instant diff preview.
        </span>
      </div>

      <div className="panel divide-y divide-line">
        {who === "mentors"
          ? data.mentors.map((m) => {
              const off = new Map(
                data.mAvail.filter((a) => a.cycle_mentor_id === m.id).map((a) => [a.slot_id, a.reason ?? "absent"])
              );
              return (
                <div key={m.id} className="p-3">
                  <div className="flex items-center gap-3">
                    <button
                      className="flex-1 text-left font-bold text-xs text-cream hover:text-cyan transition-colors"
                      onClick={() => setOpen(open === m.id ? null : m.id)}
                    >
                      {m.mentor_name}{" "}
                      <span className="font-mono text-[10px] font-normal text-muted ml-2">
                        {off.size ? `(${off.size} slots unavailable)` : ""}
                      </span>
                    </button>
                    {statusSel(m.status, (status) =>
                      flow.ask(
                        { type: "mentor_status", cycle_mentor_id: m.id, status },
                        `${m.mentor_name}: set status to ${status}`
                      )
                    )}
                  </div>
                  {open === m.id && (
                    <SlotToggles
                      slots={data.slots}
                      off={off}
                      onToggle={(sid, isOff) =>
                        flow.ask(
                          isOff
                            ? { type: "mentor_available", cycle_mentor_id: m.id, slot_ids: [sid] }
                            : { type: "mentor_unavailable", cycle_mentor_id: m.id, slot_ids: [sid], reason },
                          `${m.mentor_name}: ${isOff ? "restore slot availability" : reason}`
                        )
                      }
                    />
                  )}
                </div>
              );
            })
          : data.teams.map((t) => {
              const off = new Map(
                data.tAvail.filter((a) => a.cycle_team_id === t.id).map((a) => [a.slot_id, "absent"])
              );
              return (
                <div key={t.id} className="p-3">
                  <div className="flex items-center gap-3">
                    <button
                      className="flex-1 text-left font-bold text-xs text-cream hover:text-cyan transition-colors"
                      onClick={() => setOpen(open === t.id ? null : t.id)}
                    >
                      {t.team_name}{" "}
                      <span className="font-mono text-[10px] font-normal text-muted ml-2">
                        {off.size ? `(${off.size} slots absent)` : ""}
                      </span>
                    </button>
                    {statusSel(t.status, (status) =>
                      flow.ask(
                        { type: "team_status", cycle_team_id: t.id, status },
                        `${t.team_name}: set status to ${status}`
                      )
                    )}
                  </div>
                  {open === t.id && (
                    <SlotToggles
                      slots={data.slots}
                      off={off}
                      onToggle={(sid, isOff) =>
                        flow.ask(
                          isOff
                            ? { type: "team_available", cycle_team_id: t.id, slot_ids: [sid] }
                            : { type: "team_unavailable", cycle_team_id: t.id, slot_ids: [sid] },
                          `${t.team_name}: ${isOff ? "restore slot availability" : "absent"}`
                        )
                      }
                    />
                  )}
                </div>
              );
            })}
        {!(who === "mentors" ? data.mentors : data.teams).length && (
          <p className="p-6 text-center font-mono text-xs text-muted">No participants in this cycle yet.</p>
        )}
      </div>
    </div>
  );
}

export function SlotsPanel({ data, flow }: { data: CycleData; flow: Flow }) {
  return (
    <div className="space-y-4">
      <div className="panel p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="eyebrow">SLOT TIMELINE CONFIGURATION</div>
          <p className="font-mono text-xs text-muted">
            Toggle sessions, convert to breaks, or disable slots. Assignments in affected slots are adjusted with an instant preview.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className="px-2.5 py-1 rounded-lg bg-cyan/15 text-cyan border border-cyan/30 flex items-center gap-1.5 font-bold">
            <Clock className="h-3.5 w-3.5" />
            {data.cycle.session_minutes} min per rotation
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-white/5 text-cream border border-white/10">
            {data.cycle.daily_start.slice(0, 5)}–{data.cycle.daily_end.slice(0, 5)} daily
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-white/5 text-muted border border-white/10">
            {data.slots.filter((s) => s.kind === "session").length} sessions · {data.slots.filter((s) => s.kind === "break").length} breaks
          </span>
        </div>
      </div>

      <div className="panel divide-y divide-line max-h-[65vh] overflow-auto">
        {data.slots.map((s) => {
          const status = getSlotTimeStatus(s);
          const isOperating = status === "operating";
          const isCompleted = status === "completed";

          return (
            <div
              key={s.id}
              className={cn(
                "flex flex-wrap items-center gap-3 p-3 transition",
                isOperating
                  ? "bg-cyan/10 border-l-4 border-l-cyan ring-1 ring-cyan/40"
                  : isCompleted
                  ? "bg-emerald-950/10"
                  : s.kind === "break"
                  ? "cell-break"
                  : "hover:bg-white/[0.02]"
              )}
            >
              <span className="w-56 font-mono text-xs font-bold text-cream flex items-center gap-2">
                <span>{slotLabel(s)}</span>
                {isOperating && (
                  <span className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase font-bold bg-cyan/25 text-cyan border border-cyan/40 shadow-sm flex items-center gap-1">
                    <span className="liveDot !h-1.5 !w-1.5" /> Operating Now
                  </span>
                )}
                {isCompleted && (
                  <span className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-0.5">
                    <CheckCircle2 className="h-2.5 w-2.5" /> Complete
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-mono text-[9px] uppercase font-bold",
                  s.kind === "break"
                    ? "bg-orange/20 text-orange"
                    : !s.enabled
                    ? "bg-red-500/20 text-[#ffaaa0]"
                    : "bg-cyan/20 text-cyan"
                )}
              >
                {s.kind}
                {!s.enabled && " · disabled"}
              </span>

            <div className="ml-auto flex items-center gap-2">
              <button
                className="btn !py-1 !px-3 !text-xs"
                onClick={() =>
                  flow.ask(
                    { type: "slot_kind", slot_id: s.id, kind: s.kind === "break" ? "session" : "break" },
                    s.kind === "break" ? "Convert break to session" : "Convert session to break"
                  )
                }
              >
                {s.kind === "break" ? "Make session" : "Make break"}
              </button>
              <button
                className="btn !py-1 !px-3 !text-xs"
                onClick={() =>
                  flow.ask(
                    { type: "slot_toggle", slot_id: s.id, enabled: !s.enabled },
                    s.enabled ? "Disable slot" : "Enable slot"
                  )
                }
              >
                {s.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        )})}
        {!data.slots.length && <p className="p-6 text-center font-mono text-xs text-muted">No slots defined.</p>}
      </div>
    </div>
  );
}

export function MembersPanel({
  data,
  allMentors,
  allTeams,
  isSuper
}: {
  data: CycleData;
  allMentors: { id: string; name: string }[];
  allTeams: { id: string; name: string }[];
  isSuper: boolean;
}) {
  const router = useRouter();
  const c = data.cycle;
  const inM = new Set(data.mentors.map((m) => m.mentor_id));
  const inT = new Set(data.teams.map((t) => t.team_id));
  const freeM = allMentors.filter((m) => !inM.has(m.id));
  const freeT = allTeams.filter((t) => !inT.has(t.id));
  const [selM, setSelM] = useState<string[]>([]);
  const [selT, setSelT] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ k: "ok" | "error"; t: string } | null>(null);
  const [busySave, setBusySave] = useState(false);

  const [cfg, setCfg] = useState({
    name: c.name,
    start_date: c.start_date,
    end_date: c.end_date,
    daily_start: c.daily_start.slice(0, 5),
    daily_end: c.daily_end.slice(0, 5),
    session_minutes: c.session_minutes,
    break_count: c.break_count,
    break_minutes: c.break_minutes,
    slot_count: (c.settings as Record<string, unknown> | null)?.slot_count?.toString() ?? "",
    mode: c.mode,
    max_simultaneous: c.max_simultaneous,
    max_teams_per_mentor: (c.settings as Record<string, unknown> | null)?.max_teams_per_mentor?.toString() ?? "",
    regenerate_slots: false,
  });

  const autoQuotas = useMemo(
    () => calculateAutoCycleQuotas(data.mentors.length, data.teams.length, cfg.mode as "sequential" | "simultaneous"),
    [data.mentors.length, data.teams.length, cfg.mode]
  );

  const timingsChanged =
    cfg.start_date !== c.start_date ||
    cfg.end_date !== c.end_date ||
    cfg.daily_start !== c.daily_start.slice(0, 5) ||
    cfg.daily_end !== c.daily_end.slice(0, 5) ||
    Number(cfg.session_minutes) !== c.session_minutes ||
    Number(cfg.break_count) !== c.break_count ||
    Number(cfg.break_minutes) !== c.break_minutes ||
    (cfg.slot_count === "" ? null : Number(cfg.slot_count)) !== ((c.settings as Record<string, unknown> | null)?.slot_count ?? null);

  async function add() {
    const r = await setCycleMembers(
      data.cycle.id,
      [...(data.mentors.map((m) => m.mentor_id).filter(Boolean) as string[]), ...selM],
      [...(data.teams.map((t) => t.team_id).filter(Boolean) as string[]), ...selT],
      false
    );
    if (!r.ok) setMsg({ k: "error", t: r.error });
    else {
      setMsg({ k: "ok", t: "Members added. Use Generate to include them in the active schedule." });
      setSelM([]);
      setSelT([]);
      router.refresh();
    }
  }

  async function save() {
    setBusySave(true);
    setMsg(null);
    const shouldRegen = cfg.regenerate_slots || timingsChanged;
    const finalMaxSimultaneous = cfg.max_simultaneous ? Number(cfg.max_simultaneous) : autoQuotas.autoMaxSimultaneous;
    const finalTeamsPerMentor = cfg.max_teams_per_mentor !== "" ? Number(cfg.max_teams_per_mentor) : autoQuotas.autoTeamsPerMentor;

    const r = await updateCycleConfig(data.cycle.id, {
      name: cfg.name,
      start_date: cfg.start_date,
      end_date: cfg.end_date,
      daily_start: cfg.daily_start,
      daily_end: cfg.daily_end,
      session_minutes: Number(cfg.session_minutes),
      break_count: Number(cfg.break_count),
      break_minutes: Number(cfg.break_minutes),
      slot_count: cfg.slot_count !== "" ? Number(cfg.slot_count) : null,
      mode: cfg.mode as "sequential" | "simultaneous",
      max_simultaneous: finalMaxSimultaneous,
      max_teams_per_mentor: finalTeamsPerMentor,
      regenerate_slots: shouldRegen,
    });
    setBusySave(false);
    if (!r.ok) {
      setMsg({ k: "error", t: r.error });
    } else {
      setMsg({
        k: "ok",
        t: shouldRegen
          ? "Cycle configuration saved! Timeline slots have been regenerated and optimal schedule redistributed."
          : "Cycle configuration saved! Schedule updated with the new distribution rules.",
      });
      router.refresh();
    }
  }

  const box = (
    title: string,
    list: { id: string; name: string }[],
    sel: string[],
    set: (v: string[]) => void
  ) => (
    <div className="panel p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-white m-0">
          {title} <span className="font-mono text-xs text-muted">({list.length} available)</span>
        </h3>
        <span className="space-x-2 font-mono text-[10px]">
          <button type="button" className="text-cyan hover:underline" onClick={() => set(list.map((x) => x.id))}>
            all
          </button>
          <span className="text-muted">/</span>
          <button type="button" className="text-muted hover:underline" onClick={() => set([])}>
            none
          </button>
        </span>
      </div>
      <div className="max-h-52 overflow-auto rounded-xl border border-line bg-black/25 p-2 space-y-1">
        {list.map((x) => (
          <label
            key={x.id}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-cream hover:bg-white/5 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={sel.includes(x.id)}
              onChange={(e) =>
                set(e.target.checked ? [...sel, x.id] : sel.filter((y) => y !== x.id))
              }
              className="accent-cyan rounded h-3.5 w-3.5"
            />
            <span className="truncate">{x.name}</span>
          </label>
        ))}
        {!list.length && <p className="p-3 font-mono text-[10px] text-muted">Everyone is already in this cycle.</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {msg && <Msg kind={msg.k}>{msg.t}</Msg>}

      {/* Main Cycle Settings Panel */}
      <div className="panel p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-cyan" />
            <h2 className="text-base font-bold text-white m-0">Cycle Period, Timings & Distribution Rules</h2>
          </div>
          <span className="font-mono text-xs text-muted uppercase">Editable Cycle Parameters</span>
        </div>

        {/* Section 1: Cycle Period & Rotation Durations */}
        <div className="space-y-3">
          <div className="eyebrow text-cyan">1. TIMELINE & ROTATION PERIOD</div>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div className="field md:col-span-2">
              <label>Cycle Name</label>
              <input
                className="input"
                value={cfg.name}
                onChange={(e) => setCfg({ ...cfg, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Start Date</label>
              <input
                className="input font-mono text-xs"
                type="date"
                value={cfg.start_date}
                onChange={(e) => setCfg({ ...cfg, start_date: e.target.value })}
              />
            </div>
            <div className="field">
              <label>End Date</label>
              <input
                className="input font-mono text-xs"
                type="date"
                value={cfg.end_date}
                onChange={(e) => setCfg({ ...cfg, end_date: e.target.value })}
              />
            </div>

            <div className="field">
              <label>Daily Start Time</label>
              <input
                className="input font-mono text-xs"
                type="time"
                value={cfg.daily_start}
                onChange={(e) => setCfg({ ...cfg, daily_start: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Daily End Time</label>
              <input
                className="input font-mono text-xs"
                type="time"
                value={cfg.daily_end}
                onChange={(e) => setCfg({ ...cfg, daily_end: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="text-cyan font-bold">Rotation Duration (Min)</label>
              <input
                className="input font-mono font-bold text-white border-cyan/40"
                type="number"
                min={1}
                value={cfg.session_minutes}
                onChange={(e) => setCfg({ ...cfg, session_minutes: +e.target.value })}
              />
              <span className="font-mono text-[9.5px] text-muted">Expand or shorten all rotation slots</span>
            </div>
            <div className="field">
              <label>Total Slot Cap (Optional)</label>
              <input
                className="input font-mono text-xs"
                type="number"
                min={1}
                value={cfg.slot_count}
                placeholder="Auto-fill"
                onChange={(e) => setCfg({ ...cfg, slot_count: e.target.value })}
              />
            </div>

            <div className="field">
              <label>Breaks Per Day</label>
              <input
                className="input font-mono text-xs"
                type="number"
                min={0}
                value={cfg.break_count}
                onChange={(e) => setCfg({ ...cfg, break_count: +e.target.value })}
              />
            </div>
            <div className="field">
              <label>Break Duration (Min)</label>
              <input
                className="input font-mono text-xs"
                type="number"
                min={0}
                value={cfg.break_minutes}
                onChange={(e) => setCfg({ ...cfg, break_minutes: +e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Section 2: Distribution & Multi-Team Quotas */}
        <div className="space-y-3 pt-3 border-t border-line">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="eyebrow text-cyan">2. DISTRIBUTION & MULTI-TEAM ROTATION RULES</div>
            <button
              type="button"
              className="btn !py-1 !px-2.5 text-[10px] font-bold text-cyan border-cyan/30 hover:bg-cyan/15 inline-flex items-center gap-1 font-mono"
              onClick={() =>
                setCfg((prev) => ({
                  ...prev,
                  max_simultaneous: autoQuotas.autoMaxSimultaneous,
                  max_teams_per_mentor: autoQuotas.autoTeamsPerMentor.toString(),
                }))
              }
            >
              <Sparkles className="h-3 w-3" /> Use System Auto Defaults
            </button>
          </div>

          <div className="p-3.5 rounded-xl bg-cyan/10 border border-cyan/25 font-mono text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="text-white font-bold">System Recommended Quotas: </span>
              <span className="text-cyan font-bold">
                {autoQuotas.autoTeamsPerMentor} teams/mentor per rotation · {autoQuotas.autoMaxSimultaneous} mentors/team per slot
              </span>
              <p className="text-[10px] text-muted mt-0.5">{autoQuotas.explanation}</p>
            </div>
            <div className="text-[10px] text-cream/70 font-sans">
              Ensures every team meets a different mentor in their field across rotations without leaving mentors empty.
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="field">
              <label>Scheduling Mode</label>
              <select
                className="input"
                value={cfg.mode}
                onChange={(e) => setCfg({ ...cfg, mode: e.target.value as "sequential" | "simultaneous" })}
              >
                <option value="sequential" className="bg-[#080936]">Sequential (1 mentor per team per slot)</option>
                <option value="simultaneous" className="bg-[#080936]">Simultaneous (Multiple teams per mentor)</option>
              </select>
              <span className="font-mono text-[9.5px] text-muted">Simultaneous allows mentors to handle multiple teams &amp; teams to meet multiple field mentors</span>
            </div>

            {cfg.mode === "simultaneous" && (
              <div className="field">
                <label>
                  Max Mentors Per Team Per Slot{" "}
                  <span className="text-cyan font-mono text-xs">(Auto: {autoQuotas.autoMaxSimultaneous})</span>
                </label>
                <input
                  className="input font-mono"
                  type="number"
                  min={1}
                  max={6}
                  value={cfg.max_simultaneous}
                  placeholder={`Auto: ${autoQuotas.autoMaxSimultaneous}`}
                  onChange={(e) => setCfg({ ...cfg, max_simultaneous: +e.target.value })}
                />
                <span className="font-mono text-[9.5px] text-muted">
                  Calculated from {data.mentors.length} mentors and {data.teams.length} teams. Can be overridden.
                </span>
              </div>
            )}

            <div className="field">
              <div className="flex items-center justify-between">
                <label className="text-amber font-bold">
                  Teams Per Mentor Per Rotation{" "}
                  <span className="text-cyan font-mono text-xs">(Auto: {autoQuotas.autoTeamsPerMentor})</span>
                </label>
              </div>
              <input
                className="input font-mono border-amber/40"
                type="number"
                min={1}
                max={20}
                placeholder={`Auto: ${autoQuotas.autoTeamsPerMentor} teams/mentor`}
                value={cfg.max_teams_per_mentor}
                onChange={(e) => setCfg({ ...cfg, max_teams_per_mentor: e.target.value })}
              />
              <span className="font-mono text-[9.5px] text-muted">
                Allows mentor to visit multiple teams in 1 slot (clustered by nearest location). Leave blank for auto quota ({autoQuotas.autoTeamsPerMentor}).
              </span>
            </div>
          </div>
        </div>

        {/* Regeneration warning / checkbox if timings changed */}
        {timingsChanged && (
          <div className="flex items-center gap-3 p-3.5 rounded-xl border border-amber/30 bg-amber/10 font-mono text-xs text-amber">
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
            <div className="flex-1">
              <b>Cycle dates, hours, or session duration were modified.</b> Saving will automatically regenerate time slots and redistribute the schedule.
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-line">
          <button
            className="btn-primary !py-2.5 !px-5 text-xs font-bold flex items-center gap-2"
            disabled={busySave}
            onClick={save}
          >
            <Save className="h-3.5 w-3.5" />
            {busySave ? "Saving & Recomputing Schedule…" : "Save & Update Cycle Rules"}
          </button>
          <button
            className="btn !py-2.5 !px-4 text-xs font-mono"
            onClick={async () => {
              const r = await setCycleStatus(data.cycle.id, data.cycle.status === "active" ? "draft" : "active");
              if (r.ok) router.refresh();
            }}
          >
            {data.cycle.status === "active" ? "Set to Draft" : "Activate Cycle"}
          </button>
          <button
            className="btn btn-danger !py-2.5 !px-4 text-xs font-mono"
            onClick={async () => {
              if (confirm("Archive this cycle? It will remain viewable in historical logs.")) {
                const r = await setCycleStatus(data.cycle.id, "archived");
                if (r.ok) router.push("/admin/cycles");
              }
            }}
          >
            Archive Cycle
          </button>
          {isSuper && (
            <span className="ml-auto font-mono text-[10px] text-muted">
              ✦ Super admin: manual cell overrides bypass matching constraints.
            </span>
          )}
        </div>
      </div>

      {/* Participating Members Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white m-0">Add Members to Cycle Snapshot</h3>
          <span className="font-mono text-xs text-muted">
            {data.mentors.length} active mentors · {data.teams.length} active teams
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {box("Mentors", freeM, selM, setSelM)}
          {box("Teams", freeT, selT, setSelT)}
        </div>

        <button
          className="btn-primary !py-2.5 !px-5 text-xs font-bold"
          disabled={!selM.length && !selT.length}
          onClick={add}
        >
          <Plus className="h-4 w-4" /> Add Selected to Active Cycle
        </button>

        <p className="font-mono text-[10px] text-muted leading-relaxed">
          ✦ Cycle member lists are immutable snapshots: later modifications to external accounts never overwrite this cycle&apos;s history.
        </p>
      </div>
    </div>
  );
}
