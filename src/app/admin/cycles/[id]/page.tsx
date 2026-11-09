import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { loadCycle } from "@/lib/cycle-data";
import { ScheduleBoard } from "@/components/schedule-board";

export default async function CyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [session, data] = await Promise.all([getSession(), loadCycle(supabase, id)]);
  if (!data) notFound();
  const [mentors, teams] = await Promise.all([
    supabase.from("mentors").select("id,full_name").order("full_name").limit(1000),
    supabase.from("teams").select("id,name").order("name").limit(2000)
  ]);
  const c = data.cycle;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <Link href="/admin/cycles" className="btn !py-1.5 !px-3 text-xs text-muted hover:text-white inline-flex items-center gap-1.5 mb-3">
            <ArrowLeft className="h-3.5 w-3.5 text-cyan" /> Back to Cycles
          </Link>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white m-0">
            {c.name}
          </h1>
          <p className="mt-1.5 font-mono text-xs text-[#8e96bb]">
            {c.start_date} → {c.end_date} · {c.daily_start.slice(0, 5)}–{c.daily_end.slice(0, 5)} ·{" "}
            {c.session_minutes} min sessions · <b className="uppercase text-cyan">{c.mode}</b> ·{" "}
            <span className="text-amber">{c.status}</span>
          </p>
        </div>
        <Link href={`/admin/cycles/${id}/analytics`} className="btn-primary font-bold">
          <BarChart3 className="h-4 w-4" /> Telemetry & Analytics
        </Link>
      </div>

      <ScheduleBoard
        data={data}
        isSuper={session?.role === "super_admin"}
        allMentors={(mentors.data ?? []).map((m) => ({ id: m.id, name: m.full_name }))}
        allTeams={teams.data ?? []}
      />
    </div>
  );
}
