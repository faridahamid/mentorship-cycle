import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { CycleList } from "@/components/cycle-list";
import { getSession } from "@/lib/auth";
import { loadCycle } from "@/lib/cycle-data";
import { computeAnalytics } from "@/lib/analytics";

export default async function Cycles({
  searchParams
}: {
  searchParams: Promise<{ compare?: string; archived?: string }>;
}) {
  const { compare, archived } = await searchParams;
  const session = await getSession();
  const supabase = await createClient();
  let q = supabase
    .from("cycles")
    .select("id,name,start_date,end_date,mode,status,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  q = archived ? q.eq("status", "archived") : q.neq("status", "archived");
  const { data: cycles } = await q;

  const ids = (compare ?? "").split(",").filter(Boolean).slice(0, 4);
  type ComparisonRow = { id: string; name: string } & ReturnType<typeof computeAnalytics>;
  const rows: ComparisonRow[] = [];
  for (const id of ids) {
    const d = await loadCycle(supabase, id);
    if (d) {
      const a = computeAnalytics(d);
      rows.push({ id, name: d.cycle.name, ...a });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={archived ? "Archived Cycles" : "Schedule Cycles"}
        sub="Each cycle maintains isolated slot models, participant memberships, and manual locks."
        actions={
          <>
            <Link className="btn font-mono text-xs" href={archived ? "/admin/cycles" : "/admin/cycles?archived=1"}>
              {archived ? "Active Cycles" : "Archive & History"}
            </Link>
            <Link className="btn-primary font-bold" href="/admin/cycles/new">
              <Plus className="h-4 w-4" /> New Cycle
            </Link>
          </>
        }
      />

      <CycleList cycles={cycles ?? []} isSuper={session?.role === "super_admin"} />

      {rows.length > 0 && (
        <div className="panel overflow-x-auto p-5 mt-8">
          <div className="panelHead !p-0 !pb-3 !mb-4">
            <h2>CYCLE COMPARISON TELEMETRY</h2>
          </div>
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-left text-muted uppercase border-b border-line">
                <th className="p-2.5">Metric</th>
                {rows.map((r) => (
                  <th key={r.id} className="p-2.5 font-sans font-bold text-cream text-sm">
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Teams", (r: (typeof rows)[0]) => r.totals.teams],
                  ["Mentors", (r: (typeof rows)[0]) => r.totals.mentors],
                  ["Sessions (Slots)", (r: (typeof rows)[0]) => r.totals.sessions],
                  ["Total Assignments", (r: (typeof rows)[0]) => r.totals.assignments],
                  ["Schedule Completion", (r: (typeof rows)[0]) => `${Math.round(r.completion * 100)}%`],
                  ["Mentor Exposure (Coverage)", (r: (typeof rows)[0]) => `${Math.round(r.coverage * 100)}%`],
                  ["Workload Spread", (r: (typeof rows)[0]) => r.workloadSpread],
                  ["Unassigned Teams", (r: (typeof rows)[0]) => r.unassignedTeams.length],
                  ["Absences / Breaks", (r: (typeof rows)[0]) => `${r.absences} / ${r.breaks}`],
                  [
                    "Active Issues",
                    (r: (typeof rows)[0]) => r.issues.filter((i) => i.severity !== "info").length
                  ]
                ] as const
              ).map(([label, f]) => (
                <tr key={label} className="border-t border-line/40 hover:bg-white/[0.02]">
                  <td className="p-2.5 font-bold text-cream">{label}</td>
                  {rows.map((r) => (
                    <td key={r.id} className="p-2.5 text-cyan">
                      {f(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
