"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, useMemo } from "react";
import { motion } from "framer-motion";
import { Archive, ArchiveRestore, Copy, ExternalLink, GitCompare, Trash2 } from "lucide-react";
import { deleteCycle, deleteAllCycles, duplicateCycle, setCycleStatus } from "@/app/actions/cycles";
import { Msg, Pagination } from "@/components/ui";

interface C {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  mode: string;
  status: string;
}

export function CycleList({ cycles, isSuper }: { cycles: C[]; isSuper: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const totalPages = Math.max(1, Math.ceil(cycles.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const pagedCycles = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return cycles.slice(start, start + pageSize);
  }, [cycles, currentPage, pageSize]);

  const run = (f: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await f();
      if (!r.ok) setErr(r.error ?? "Failed");
      else {
        setErr("");
        router.refresh();
      }
    });

  return (
    <div className="space-y-6">
      {err && <Msg kind="error">{err}</Msg>}

      {sel.length >= 2 && (
        <div className="flex items-center gap-3 panel p-3 bg-cyan/10 border-cyan/30">
          <GitCompare className="h-4 w-4 text-cyan" />
          <span className="font-mono text-xs text-cream">{sel.length} cycles selected</span>
          <button
            className="launchBtn !py-1.5 !px-3.5 !text-xs ml-auto"
            onClick={() => router.push(`/admin/cycles?compare=${sel.join(",")}`)}
          >
            Compare cycles ↗
          </button>
        </div>
      )}

      {cycles.length > 0 && isSuper && (
        <div className="flex items-center justify-between panel p-3">
          <span className="monoLabel">{cycles.length} TOTAL CYCLES REGISTERED</span>
          <button
            onClick={() => {
              if (confirm(`Are you sure you want to permanently delete ALL ${cycles.length} cycles? This will remove all their schedule assignments.`)) {
                run(deleteAllCycles);
              }
            }}
            className="btn !py-1.5 !px-3 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10 hover:border-red-500/50"
            title="Delete All Cycles"
          >
            <Trash2 className="h-3.5 w-3.5 text-red-400" /> Delete All Cycles
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pagedCycles.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="panel p-5 relative group hover:border-cyan/40 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <Link
                href={`/admin/cycles/${c.id}`}
                className="font-bold text-lg text-white group-hover:text-cyan transition-colors"
              >
                {c.name}
              </Link>
              <input
                type="checkbox"
                title="Select to compare"
                checked={sel.includes(c.id)}
                onChange={(e) =>
                  setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))
                }
                className="h-4 w-4 accent-cyan cursor-pointer rounded bg-navy border-line mt-1"
              />
            </div>

            <div className="font-mono text-xs text-muted mt-1">
              {c.start_date} → {c.end_date}
            </div>

            <div className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase font-bold tracking-wider">
              <span className="rounded-full bg-cyan/15 border border-cyan/30 px-2 py-0.5 text-cyan">
                {c.mode}
              </span>
              <span className="rounded-full bg-orange/15 border border-orange/30 px-2 py-0.5 text-orange">
                {c.status}
              </span>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2 pt-3 border-t border-line">
              <Link href={`/admin/cycles/${c.id}`} className="launchBtn !py-1.5 !px-3 !text-[11px]">
                <ExternalLink className="h-3 w-3" /> Open
              </Link>
              <button
                className="btn !py-1.5 !px-2.5 !text-[11px]"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const r = await duplicateCycle(c.id);
                    if (r.ok) router.push(`/admin/cycles/${r.id}`);
                    return r;
                  })
                }
                title="Duplicate cycle"
              >
                <Copy className="h-3.5 w-3.5" /> Duplicate
              </button>
              <button
                className="btn !py-1.5 !px-2.5 !text-[11px]"
                disabled={pending}
                onClick={() =>
                  run(() => setCycleStatus(c.id, c.status === "archived" ? "draft" : "archived"))
                }
                title={c.status === "archived" ? "Restore" : "Archive"}
              >
                {c.status === "archived" ? (
                  <>
                    <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                  </>
                ) : (
                  <>
                    <Archive className="h-3.5 w-3.5" /> Archive
                  </>
                )}
              </button>
              {isSuper && (
                <button
                  className="btn btn-danger !py-1.5 !px-2 !text-[11px] ml-auto"
                  disabled={pending}
                  onClick={() =>
                    confirm(`Delete "${c.name}" permanently?`) && run(() => deleteCycle(c.id))
                  }
                  title="Delete cycle"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </motion.div>
        ))}
        {!cycles.length && (
          <div className="col-span-full panel p-8 text-center font-mono text-xs text-muted">
            No cycles found in this view.
          </div>
        )}
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={cycles.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={[10, 25, 50, 100]}
        className="panel !py-3 !border-t-0"
      />
    </div>
  );
}
