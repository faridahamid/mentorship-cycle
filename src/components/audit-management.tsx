"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Download, ScrollText, Search, Trash2 } from "lucide-react";
import { pruneAudit } from "@/app/actions/admin";
import { downloadExcel, type Table } from "@/lib/export";
import { Modal, Msg, Pagination } from "@/components/ui";

export interface AuditItem {
  id: number;
  actor: string | null;
  actorName: string;
  actorEmail: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export function AuditManagement({ logs }: { logs: AuditItem[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Prune state
  const [pruneOpen, setPruneOpen] = useState(false);
  const [keepDays, setKeepDays] = useState(90);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const actionTypes = useMemo(() => {
    const set = new Set(logs.map((l) => l.action.split(":")[0]));
    return Array.from(set).sort();
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return logs.filter((l) => {
      const matchSearch =
        !q ||
        l.action.toLowerCase().includes(q) ||
        l.actorName.toLowerCase().includes(q) ||
        l.actorEmail.toLowerCase().includes(q) ||
        (l.entity && l.entity.toLowerCase().includes(q)) ||
        (l.entity_id && l.entity_id.toLowerCase().includes(q));
      const matchAction =
        actionFilter === "all" || l.action.startsWith(actionFilter);
      return matchSearch && matchAction;
    });
  }, [logs, search, actionFilter]);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const pagedLogs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

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
      setReport(`Pruned ${r.deleted} audit log entries older than ${keepDays} days.`);
      router.refresh();
    }
  }

  async function handleExport() {
    const table: Table = {
      title: "NASA Space Apps Cairo 2026 - Audit Logs",
      headers: ["Timestamp", "Actor", "Action", "Entity", "Entity ID", "Details"],
      rows: logs.map((l) => [
        new Date(l.created_at).toLocaleString(),
        `${l.actorName} (${l.actorEmail})`,
        l.action,
        l.entity ?? "",
        l.entity_id ?? "",
        JSON.stringify(l.details)
      ])
    };
    await downloadExcel("nasa-space-apps-cairo-audit-logs", [table]);
  }

  function getActionColor(action: string) {
    if (action.includes("delete")) return "text-red-400 bg-red-500/10 border-red-500/30";
    if (action.includes("create")) return "text-emerald bg-emerald/10 border-emerald/30";
    if (action.includes("schedule") || action.includes("commit")) return "text-cyan bg-cyan/10 border-cyan/30";
    if (action.includes("role") || action.includes("status")) return "text-orange bg-orange/10 border-orange/30";
    return "text-cream bg-white/5 border-white/10";
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
              placeholder="Search audit actions, actors, entities..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <select
            className="input !w-auto !py-1.5 !text-xs font-mono"
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All Action Types ({logs.length})</option>
            {actionTypes.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={handleExport} className="btn !py-2 !px-3 text-xs" title="Export Excel">
            <Download className="h-3.5 w-3.5 text-cyan" /> Export Excel
          </button>
          <button
            onClick={() => {
              setErr(null);
              setReport(null);
              setPruneOpen(true);
            }}
            className="btn !py-2 !px-3 text-xs text-muted hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5 text-red-400" /> Prune Logs
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="panel overflow-hidden">
        <div className="panelHead">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-cyan" />
            <h2>Security & Operational Audit Log ({filtered.length})</h2>
          </div>
          <span className="monoLabel">{logs.length} RECORDED ACTIONS</span>
        </div>

        {filtered.length > 0 ? (
          <>
            <div className="divide-y divide-line">
              {pagedLogs.map((l) => {
                const isExpanded = expandedId === l.id;
                return (
                  <div key={l.id} className="hover:bg-white/[0.02] transition">
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : l.id)}
                      className="p-4 flex flex-wrap items-center justify-between gap-4 cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-[240px]">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-cyan shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted shrink-0" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`chip border font-mono text-[10px] font-bold ${getActionColor(
                                l.action
                              )}`}
                            >
                              {l.action}
                            </span>
                            {l.entity && (
                              <span className="font-mono text-[10px] text-muted uppercase">
                                {l.entity} {l.entity_id ? `· ${l.entity_id.slice(0, 8)}` : ""}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 font-mono text-xs text-muted">
                            by <b className="text-cream">{l.actorName}</b> ({l.actorEmail})
                          </div>
                        </div>
                      </div>

                      <div className="font-mono text-xs text-muted">
                        {new Date(l.created_at).toLocaleString()}
                      </div>
                    </div>

                    {/* Expanded JSON details */}
                    {isExpanded && (
                      <div className="px-6 pb-4 pt-1">
                        <div className="rounded-xl border border-line bg-black/40 p-3 font-mono text-xs text-cyan overflow-x-auto">
                          <pre>{JSON.stringify(l.details, null, 2)}</pre>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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
          <div className="p-12 text-center font-mono text-xs text-muted">
            No audit log entries matching your criteria.
          </div>
        )}
      </div>

      {/* Prune Logs Modal */}
      <Modal
        open={pruneOpen}
        onClose={() => !loading && setPruneOpen(false)}
        title="Prune Historical Audit Logs"
      >
        <form onSubmit={handlePrune} className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}
          {report && <Msg kind="ok">{report}</Msg>}

          <p className="text-sm text-cream">
            Trimming older logs frees database space on the Supabase free tier while retaining recent security events.
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
              <option value={365}>365 Days (1 Year)</option>
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
