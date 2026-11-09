import Link from "next/link";
import { ArrowUpRight, CalendarRange, Plus, Sparkles, Users, Users2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";

export default async function Overview() {
  const supabase = await createClient();
  const count = async (t: string) => (await supabase.from(t).select("*", { count: "exact", head: true })).count ?? 0;
  const [teams, mentors, cycles, cats] = await Promise.all([
    count("teams"),
    count("mentors"),
    count("cycles"),
    count("categories")
  ]);
  const { data: active } = await supabase
    .from("cycles")
    .select("id,name,start_date,end_date,mode,status")
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(6);

  const stats = [
    { label: "Active Teams", value: teams, color: "#f7a224", icon: Users },
    { label: "Mentors Enrolled", value: mentors, color: "#38e1ff", icon: Users2 },
    { label: "Total Cycles", value: cycles, color: "#f8fafc", icon: CalendarRange },
    { label: "Domain Tracks", value: cats, color: "#10b981", icon: Sparkles },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Control Room Overview"
        sub="NASA Space Apps Cairo 2026 • Mentor telemetry, active cycles, and live allocations."
        actions={
          <Link className="btn-primary" href="/admin/cycles/new">
            <Plus className="h-4 w-4" /> Create Cycle
          </Link>
        }
      />

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="metric group">
            <div className="flex items-center justify-between mb-2">
              <span className="k">{s.label}</span>
              <s.icon className="h-4 w-4" style={{ color: s.color }} />
            </div>
            <div className="v" style={{ color: s.color }}>{s.value}</div>
            <div
              className="absolute -right-4 -bottom-4 w-16 h-16 rounded-full blur-xl opacity-20 pointer-events-none transition-opacity group-hover:opacity-40"
              style={{ backgroundColor: s.color }}
            />
          </div>
        ))}
      </div>

      {/* Active Cycles Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="liveDot" />
            <h2 className="text-xl font-bold text-white m-0">Active Cycles</h2>
          </div>
          <Link href="/admin/cycles" className="font-mono text-xs text-cyan hover:underline flex items-center gap-1">
            View all cycles <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(active ?? []).map((c) => (
            <Link
              key={c.id}
              href={`/admin/cycles/${c.id}`}
              className="panel block p-5 transition-all hover:border-cyan/40 group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-lg font-bold text-white group-hover:text-cyan transition-colors">
                  {c.name}
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted group-hover:text-cyan transition-colors shrink-0" />
              </div>
              <div className="font-mono text-xs text-[#8e96bb] mt-1">
                {c.start_date} → {c.end_date}
              </div>
              <div className="mt-4 flex items-center gap-2 font-mono text-[10px] uppercase font-bold tracking-wider">
                <span className="rounded-full bg-cyan/15 border border-cyan/30 px-2 py-0.5 text-cyan">
                  {c.mode}
                </span>
                <span className="rounded-full bg-amber/15 border border-amber/30 px-2 py-0.5 text-amber">
                  {c.status}
                </span>
              </div>
            </Link>
          ))}
          {!active?.length && (
            <div className="col-span-full panel p-8 text-center">
              <p className="font-mono text-xs text-muted">
                No active cycles yet. Add categories, teams, and mentors, then launch your first cycle.
              </p>
              <Link href="/admin/cycles/new" className="btn-primary mt-4 inline-flex">
                <Plus className="h-4 w-4" /> Start Cycle Now
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
