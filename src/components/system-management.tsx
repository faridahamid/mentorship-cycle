"use client";
import { useState } from "react";
import { Database, Download, HardDrive, Server, ShieldCheck, Trash2, Zap } from "lucide-react";
import { pruneAudit } from "@/app/actions/admin";
import { Modal, Msg } from "@/components/ui";

export interface UsageStats {
  db_bytes: number;
  rows: {
    assignments: number;
    teams: number;
    mentors: number;
    cycles: number;
    audit_logs: number;
    profiles: number;
  };
}

export function SystemManagement({
  stats,
  isSuper,
  fullBackupData
}: {
  stats: UsageStats;
  isSuper: boolean;
  fullBackupData: Record<string, unknown>;
}) {
  const [pruneOpen, setPruneOpen] = useState(false);
  const [keepDays, setKeepDays] = useState(90);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 500 MB Supabase Free Tier Limit
  const LIMIT_BYTES = 500 * 1024 * 1024;
  const usedMB = (stats.db_bytes / (1024 * 1024)).toFixed(2);
  const percentUsed = Math.min(100, (stats.db_bytes / LIMIT_BYTES) * 100).toFixed(1);

  function handleDownloadBackup() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(fullBackupData, null, 2));
    const a = document.createElement("a");
    a.setAttribute("href", dataStr);
    a.setAttribute(
      "download",
      `nasa-space-apps-cairo-backup-${new Date().toISOString().slice(0, 10)}.json`
    );
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handlePrune(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    setReport(null);
    const r = await pruneAudit(keepDays);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setReport(`Pruned ${r.deleted} audit log entries.`);
      window.location.reload();
    }
  }

  const tableRows = [
    { label: "Cycle Assignments", count: stats.rows.assignments, desc: "Rotation schedules & session matches" },
    { label: "Hackathon Teams", count: stats.rows.teams, desc: "Participating student & developer teams" },
    { label: "Specialized Mentors", count: stats.rows.mentors, desc: "Technical advisors and challenge domain experts" },
    { label: "Rotation Cycles", count: stats.rows.cycles, desc: "Scheduled cycles and time slots" },
    { label: "Audit Log Records", count: stats.rows.audit_logs, desc: "Operational change and security logs" },
    { label: "User Accounts", count: stats.rows.profiles, desc: "Admins and authenticated mentor profiles" },
  ];

  return (
    <div className="space-y-6">
      {/* Top Storage Bar */}
      <div className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan/10 border border-cyan/30 flex items-center justify-center text-cyan">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <div className="eyebrow">STORAGE TELEMETRY</div>
              <h2 className="text-lg font-bold text-cream m-0">
                Supabase Free-Tier Quota: {usedMB} MB / 500 MB ({percentUsed}%)
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isSuper && (
              <button
                onClick={() => {
                  setErr(null);
                  setReport(null);
                  setPruneOpen(true);
                }}
                className="btn text-xs text-muted hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-400" /> Prune Logs
              </button>
            )}
            <button onClick={handleDownloadBackup} className="btn-primary text-xs font-bold">
              <Download className="h-3.5 w-3.5" /> Full Data Snapshot (JSON)
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-3 rounded-full bg-white/[0.05] border border-line overflow-hidden p-0.5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan via-amber to-orange transition-all duration-500"
            style={{ width: `${Math.max(2, Number(percentUsed))}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] text-muted">
          <span>0 MB</span>
          <span className="text-cyan font-bold">{usedMB} MB Active</span>
          <span>500 MB Free Cap</span>
        </div>
      </div>

      {/* Row Counts Table */}
      <div className="panel overflow-hidden">
        <div className="panelHead">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-cyan" />
            <h2>Database Entity Allocations</h2>
          </div>
          <span className="monoLabel">POSTGRESQL POOLER ACTIVE</span>
        </div>

        <div className="divide-y divide-line">
          {tableRows.map((r) => (
            <div key={r.label} className="p-4 flex items-center justify-between hover:bg-white/[0.02]">
              <div>
                <div className="text-sm font-bold text-cream">{r.label}</div>
                <div className="font-mono text-xs text-muted">{r.desc}</div>
              </div>
              <div className="font-mono text-lg font-bold text-cyan">
                {r.count.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* System Health Indicators */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald/10 border border-emerald/30 flex items-center justify-center text-emerald shrink-0">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-cream">Supabase Realtime</div>
            <div className="font-mono text-[10px] text-emerald mt-0.5">
              Assignments publication active
            </div>
          </div>
        </div>

        <div className="panel p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan/10 border border-cyan/30 flex items-center justify-center text-cyan shrink-0">
            <Server className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-cream">Next.js Turbopack</div>
            <div className="font-mono text-[10px] text-cyan mt-0.5">
              App Router v16.4.3
            </div>
          </div>
        </div>

        <div className="panel p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber/10 border border-amber/30 flex items-center justify-center text-amber shrink-0">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-cream">Security & RLS</div>
            <div className="font-mono text-[10px] text-amber mt-0.5">
              Strict role row-level security
            </div>
          </div>
        </div>
      </div>

      {/* Prune Logs Modal */}
      <Modal
        open={pruneOpen}
        onClose={() => !loading && setPruneOpen(false)}
        title="Trim Historical Audit Logs"
      >
        <form onSubmit={handlePrune} className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}
          {report && <Msg kind="ok">{report}</Msg>}

          <p className="text-sm text-cream">
            Trimming old audit logs frees database disk storage on the Supabase free tier while retaining recent operational logs.
          </p>

          <div className="field">
            <label className="lbl">Keep Audit Logs From The Last</label>
            <select
              className="input font-mono"
              value={keepDays}
              onChange={(e) => setKeepDays(Number(e.target.value))}
            >
              <option value={30}>30 Days (1 Month)</option>
              <option value={60}>60 Days (2 Months)</option>
              <option value={90}>90 Days (3 Months)</option>
              <option value={180}>180 Days (6 Months)</option>
            </select>
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
            <button
              type="button"
              disabled={loading}
              onClick={() => setPruneOpen(false)}
              className="btn"
            >
              Close
            </button>
            <button type="submit" disabled={loading} className="btn btn-danger">
              {loading ? "Pruning..." : "Prune Old Records"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
