"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Download, FileText } from "lucide-react";
import type { Analytics } from "@/lib/analytics";
import { analyticsTables, downloadExcel, downloadPdf } from "@/lib/export";
import { Msg } from "@/components/ui";

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function AnalyticsView({ a, name }: { a: Analytics; name: string }) {
  const avg = a.mentorLoad.length ? a.mentorLoad.reduce((n, m) => n + m.sessions, 0) / a.mentorLoad.length : 0;
  const stats: [string, string | number, string][] = [
    ["Teams", a.totals.teams, "#ffab2e"],
    ["Mentors", a.totals.mentors, "#58efff"],
    ["Sessions", a.totals.sessions, "#fff0cf"],
    ["Assignments", a.totals.assignments, "#65ffbd"],
    ["Completion", pct(a.completion), "#8e7bff"],
    ["Mentor Exposure", pct(a.coverage), "#ffab2e"],
    ["Unassigned Teams", a.unassignedTeams.length, a.unassignedTeams.length ? "#ffaaa0" : "#65ffbd"],
    ["Absences / Breaks", `${a.absences} / ${a.breaks}`, "#969bc4"]
  ];
  const incomplete = a.teamCoverage.filter((t) => t.eligible > 0 && t.met < t.eligible);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 panel p-4">
        <div>
          <div className="eyebrow">TELEMETRY ANALYTICS</div>
          <h2 className="text-xl font-extrabold tracking-tight text-white m-0">PERFORMANCE & FAIRNESS METRICS</h2>
        </div>
        <div className="flex gap-2">
          <button className="btn !py-1.5 !px-3 font-mono text-xs" onClick={() => downloadExcel(`${name}-analytics`, analyticsTables(a, name))}>
            <Download className="h-3.5 w-3.5 text-cyan" /> Excel
          </button>
          <button className="btn !py-1.5 !px-3 font-mono text-xs" onClick={() => downloadPdf(`${name}-analytics`, analyticsTables(a, name))}>
            <FileText className="h-3.5 w-3.5 text-orange" /> PDF
          </button>
        </div>
      </div>

      {/* Target Site Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map(([l, v, c]) => (
          <div key={l} className="metric relative overflow-hidden">
            <div className="k">{l}</div>
            <div className="v" style={{ color: c }}>{v}</div>
            <div
              className="absolute -right-4 -bottom-4 w-14 h-14 rounded-full blur-xl opacity-20 pointer-events-none"
              style={{ backgroundColor: c }}
            />
          </div>
        ))}
      </div>

      {a.workloadSpread > 1 && (
        <Msg kind="info">
          Workload spread detected: mentors vary by {a.workloadSpread} sessions across the cycle.
        </Msg>
      )}
      {incomplete.length > 0 && (
        <Msg kind="info">{incomplete.length} team(s) have not met every eligible specialized mentor yet.</Msg>
      )}
      {a.unassignedTeams.length > 0 && (
        <Msg kind="error">Unassigned teams pending allocation: {a.unassignedTeams.join(", ")}</Msg>
      )}

      {/* Mentor Workload Chart */}
      <section className="panel p-5">
        <div className="panelHead !p-0 !pb-3 !mb-4">
          <h2>MENTOR WORKLOAD DISTRIBUTION</h2>
          <span className="monoLabel">AVG: {avg.toFixed(1)} SESSIONS</span>
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={a.mentorLoad}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 240, 207, 0.08)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#969bc4" }} interval={0} angle={-25} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#969bc4" }} />
              <Tooltip contentStyle={{ backgroundColor: "#080936", borderColor: "rgba(255, 240, 207, 0.2)", borderRadius: 12, color: "#fff0cf" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={avg} stroke="#ffab2e" strokeDasharray="4 4" label={{ value: "avg", fontSize: 11, fill: "#ffab2e" }} />
              <Bar dataKey="sessions" name="Assigned Sessions" radius={[4, 4, 0, 0]}>
                {a.mentorLoad.map((m) => (
                  <Cell key={m.id} fill={Math.abs(m.sessions - avg) > 1.5 ? "#ffaaa0" : "#58efff"} />
                ))}
              </Bar>
              <Bar dataKey="uniqueTeams" name="Unique Teams Met" fill="#ffab2e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted">
          ✦ Bars highlighted in coral deviate from the mean load by more than 1.5 sessions.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Category Coverage Chart */}
        <section className="panel p-5">
          <div className="panelHead !p-0 !pb-3 !mb-4">
            <h2>DOMAIN CATEGORY COVERAGE</h2>
          </div>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={a.categoryCoverage.map((c) => ({ ...c, pct: c.eligible ? Math.round((c.met / c.eligible) * 100) : 0 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 240, 207, 0.08)" />
                <XAxis dataKey="category" tick={{ fontSize: 10, fill: "#969bc4" }} />
                <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: "#969bc4" }} />
                <Tooltip contentStyle={{ backgroundColor: "#080936", borderColor: "rgba(255, 240, 207, 0.2)", borderRadius: 12, color: "#fff0cf" }} />
                <Bar dataKey="pct" name="Coverage %" radius={[4, 4, 0, 0]}>
                  {a.categoryCoverage.map((c) => (
                    <Cell key={c.category} fill={c.color || "#58efff"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Mentor Attendance Chart */}
        <section className="panel p-5">
          <div className="panelHead !p-0 !pb-3 !mb-4">
            <h2>MENTOR ATTENDANCE & BREAKS</h2>
          </div>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={a.mentorLoad} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 240, 207, 0.08)" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#969bc4" }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: "#969bc4" }} />
                <Tooltip contentStyle={{ backgroundColor: "#080936", borderColor: "rgba(255, 240, 207, 0.2)", borderRadius: 12, color: "#fff0cf" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="absentSlots" name="Absent Slots" stackId="a" fill="#ffaaa0" />
                <Bar dataKey="breakSlots" name="Break Slots" stackId="a" fill="#ffab2e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Unique Mentors Table */}
      <section className="panel overflow-x-auto p-5">
        <div className="panelHead !p-0 !pb-3 !mb-4">
          <h2>UNIQUE MENTOR EXPOSURE PER TEAM</h2>
        </div>
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-left text-muted uppercase border-b border-line">
              <th className="p-2">Team Name</th>
              <th>Met</th>
              <th>Eligible</th>
              <th>Total Sessions</th>
              <th className="w-48">Coverage Ratio</th>
            </tr>
          </thead>
          <tbody>
            {a.teamCoverage.map((t) => {
              const p = t.eligible ? t.met / t.eligible : 0;
              return (
                <tr key={t.id} className="border-t border-line/50 hover:bg-white/[0.02]">
                  <td className="p-2 font-bold font-sans text-cream text-sm">{t.name}</td>
                  <td className="text-cyan font-bold">{t.met}</td>
                  <td>{t.eligible}</td>
                  <td>{t.sessions}</td>
                  <td>
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: pct(p),
                          background: p >= 1 ? "#65ffbd" : p >= 0.5 ? "#ffab2e" : "#ffaaa0"
                        }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Issues Log */}
      <section className="panel p-5">
        <div className="panelHead !p-0 !pb-3 !mb-4">
          <h2>DIAGNOSTIC ISSUES LOG ({a.issues.length})</h2>
        </div>
        <div className="space-y-2">
          {a.issues.map((i, k) => (
            <Msg key={k} kind={i.severity === "error" ? "error" : i.severity === "warning" ? "info" : "ok"}>
              <b className="mr-2 uppercase font-mono">{i.type.replace(/_/g, " ")}:</b>
              {i.message}
            </Msg>
          ))}
          {!a.issues.length && <Msg kind="ok">No anomalies detected in the current cycle.</Msg>}
        </div>
      </section>
    </div>
  );
}
