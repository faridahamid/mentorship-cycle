"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createCycle } from "@/app/actions/cycles";
import { CategoryPicker, Msg } from "@/components/ui";
import { generateTimeSlots, validateSlotConfig } from "@/lib/slots";
import { calculateAutoCycleQuotas } from "@/lib/cycle-model";

interface Opt {
  id: string;
  name: string;
}

export function CycleForm({
  categories,
  mentors,
  teams
}: {
  categories: { id: string; name: string; color: string }[];
  mentors: Opt[];
  teams: Opt[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    name: "",
    start_date: today,
    end_date: today,
    daily_start: "09:00",
    daily_end: "13:00",
    session_minutes: 20,
    break_count: 1,
    break_minutes: 10,
    slot_count: "" as string,
    mode: "sequential" as "sequential" | "simultaneous",
    max_simultaneous: 2,
    max_teams_per_mentor: "" as string
  });
  const [cats, setCats] = useState<string[]>(categories.map((c) => c.id));
  const [mIds, setM] = useState<string[]>(mentors.map((m) => m.id));
  const [tIds, setT] = useState<string[]>(teams.map((t) => t.id));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const cfg = {
    startDate: f.start_date,
    endDate: f.end_date,
    dailyStart: f.daily_start,
    dailyEnd: f.daily_end,
    sessionMinutes: +f.session_minutes,
    breakCount: +f.break_count,
    breakMinutes: +f.break_minutes,
    slotCount: f.slot_count ? +f.slot_count : null
  };

  const problems = useMemo(() => validateSlotConfig(cfg), [f]); // eslint-disable-line react-hooks/exhaustive-deps
  const slots = useMemo(() => generateTimeSlots(cfg), [f]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessions = slots.filter((s) => s.kind === "session").length;

  const autoQuotas = useMemo(
    () => calculateAutoCycleQuotas(mIds.length, tIds.length, f.mode as "sequential" | "simultaneous"),
    [mIds.length, tIds.length, f.mode]
  );

  const set = (k: string, v: string | number) => setF({ ...f, [k]: v });

  async function submit() {
    setBusy(true);
    setErr("");
    const finalMaxSimultaneous = f.max_simultaneous ? +f.max_simultaneous : autoQuotas.autoMaxSimultaneous;
    const finalTeamsPerMentor = f.max_teams_per_mentor ? +f.max_teams_per_mentor : autoQuotas.autoTeamsPerMentor;
    const r = await createCycle({
      ...f,
      max_simultaneous: finalMaxSimultaneous,
      max_teams_per_mentor: finalTeamsPerMentor,
      slot_count: f.slot_count ? +f.slot_count : null,
      category_ids: cats,
      mentor_ids: mIds,
      team_ids: tIds
    });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    router.push(`/admin/cycles/${r.id}`);
  }

  const num = (k: keyof typeof f, label: string, min = 0) => (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        type="number"
        min={min}
        value={f[k] as number}
        onChange={(e) => set(k, e.target.value)}
      />
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="panel space-y-5 p-6">
        {err && <Msg kind="error">{err}</Msg>}

        <div className="field">
          <label>Cycle Name</label>
          <input
            className="input text-base"
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Cairo NASA Space Apps 2026 Rotation"
          />
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="field">
            <label>Start Date</label>
            <input className="input" type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} />
          </div>
          <div className="field">
            <label>End Date</label>
            <input className="input" type="date" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} />
          </div>
          <div className="field">
            <label>Daily Start Time</label>
            <input className="input" type="time" value={f.daily_start} onChange={(e) => set("daily_start", e.target.value)} />
          </div>
          <div className="field">
            <label>Daily End Time</label>
            <input className="input" type="time" value={f.daily_end} onChange={(e) => set("daily_end", e.target.value)} />
          </div>
          {num("session_minutes", "Session Duration (Minutes)", 1)}
          {num("break_count", "Breaks Per Day")}
          {num("break_minutes", "Break Duration (Minutes)")}
          <div className="field">
            <label>Total Slot Cap (Optional)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={f.slot_count}
              placeholder="Auto-fill all hours"
              onChange={(e) => set("slot_count", e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2 pt-2 border-t border-line">
          <div className="field">
            <label>Scheduling Mode</label>
            <select className="input" value={f.mode} onChange={(e) => set("mode", e.target.value)}>
              <option value="sequential" className="bg-[#080936]">Sequential — one mentor per team per slot</option>
              <option value="simultaneous" className="bg-[#080936]">Simultaneous — multiple teams per mentor &amp; field mentors per team</option>
            </select>
          </div>
          {f.mode === "simultaneous" && (
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
                value={f.max_simultaneous}
                placeholder={`Auto: ${autoQuotas.autoMaxSimultaneous}`}
                onChange={(e) => set("max_simultaneous", e.target.value)}
              />
              <p className="font-mono text-[10px] text-muted mt-1">
                Calculated by system from {mIds.length} mentors and {tIds.length} teams. Can be overridden.
              </p>
            </div>
          )}
          <div className="field sm:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-amber font-bold">
                Teams Per Mentor Per Rotation{" "}
                <span className="font-mono text-xs text-cyan">(Auto: {autoQuotas.autoTeamsPerMentor} teams/mentor)</span>
              </label>
              <button
                type="button"
                className="text-[10px] font-mono text-cyan hover:underline"
                onClick={() => set("max_teams_per_mentor", autoQuotas.autoTeamsPerMentor.toString())}
              >
                Use System Auto ({autoQuotas.autoTeamsPerMentor})
              </button>
            </div>
            <input
              className="input font-mono border-amber/40"
              type="number"
              min={1}
              max={20}
              value={f.max_teams_per_mentor}
              placeholder={`Auto: ${autoQuotas.autoTeamsPerMentor} teams/mentor (system calculated)`}
              onChange={(e) => set("max_teams_per_mentor", e.target.value)}
            />
            <p className="font-mono text-[10px] text-muted mt-1">
              {autoQuotas.explanation}. Ensures all teams are mentored every rotation and no mentor is left empty.
            </p>
          </div>
        </div>

        <div className="pt-2 border-t border-line">
          <label className="lbl">Active Domain Categories</label>
          <CategoryPicker categories={categories} value={cats} onChange={setCats} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-line">
          <Pick
            title={`Participating Mentors (${mIds.length}/${mentors.length})`}
            all={mentors}
            value={mIds}
            onChange={setM}
          />
          <Pick
            title={`Registered Teams (${tIds.length}/${teams.length})`}
            all={teams}
            value={tIds}
            onChange={setT}
          />
        </div>

        <button
          className="btn-primary !py-2.5 w-full justify-center text-sm font-bold mt-4"
          disabled={busy || !f.name.trim() || problems.length > 0}
          onClick={submit}
        >
          <Plus className="h-4 w-4" /> {busy ? "Initializing Schedule…" : "Create & Launch Cycle"}
        </button>
      </div>

      {/* Live slot generator telemetry sidebar */}
      <aside className="panel h-fit space-y-4 p-5">
        <div className="panelHead !p-0 !pb-3">
          <h2>TELEMETRY PREVIEW</h2>
        </div>

        {problems.map((p) => (
          <Msg key={p} kind="error">{p}</Msg>
        ))}

        {!problems.length && (
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="metric !p-3">
              <div className="v !text-3xl text-orange">{sessions}</div>
              <div className="k">Sessions</div>
            </div>
            <div className="metric !p-3">
              <div className="v !text-3xl text-cyan">{slots.length - sessions}</div>
              <div className="k">Breaks</div>
            </div>
          </div>
        )}

        <div className="eyebrow mt-2">CALCULATED TIMELINE</div>
        <div className="max-h-96 space-y-1.5 overflow-auto pr-1">
          {slots.slice(0, 50).map((s) => (
            <div
              key={s.idx}
              className={`rounded-xl border border-line px-3 py-1.5 font-mono text-[11px] flex justify-between items-center ${
                s.kind === "break" ? "cell-break text-orange" : "bg-white/[0.02] text-cream"
              }`}
            >
              <span>{s.day.slice(5)}</span>
              <span>{s.starts_at}–{s.ends_at}</span>
              {s.kind === "break" && <span className="text-[9px] uppercase font-bold text-orange">Break</span>}
            </div>
          ))}
          {slots.length > 50 && (
            <div className="text-center font-mono text-[10px] text-muted py-1">
              …and {slots.length - 50} more slots
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Pick({
  title,
  all,
  value,
  onChange
}: {
  title: string;
  all: Opt[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const shown = all.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="lbl !mb-0">{title}</label>
        <span className="space-x-2 font-mono text-[10px]">
          <button
            type="button"
            className="text-cyan hover:underline"
            onClick={() => onChange(all.map((a) => a.id))}
          >
            all
          </button>
          <span className="text-muted">/</span>
          <button
            type="button"
            className="text-muted hover:underline"
            onClick={() => onChange([])}
          >
            none
          </button>
        </span>
      </div>
      <input
        className="input !py-1.5 !text-xs"
        placeholder="Filter list…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="max-h-44 overflow-auto rounded-xl border border-line bg-black/30 p-1.5 space-y-0.5">
        {shown.map((a) => (
          <label
            key={a.id}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-cream hover:bg-white/5 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={value.includes(a.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, a.id] : value.filter((x) => x !== a.id))
              }
              className="accent-cyan rounded h-3.5 w-3.5"
            />
            <span className="truncate">{a.name}</span>
          </label>
        ))}
        {!shown.length && <div className="p-2 font-mono text-[10px] text-muted">Nothing found.</div>}
      </div>
    </div>
  );
}
