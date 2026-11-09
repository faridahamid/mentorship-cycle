import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { loadCycle } from "@/lib/cycle-data";
import { computeAnalytics } from "@/lib/analytics";
import { AnalyticsView } from "@/components/analytics-view";

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const data = await loadCycle(supabase, id);
  if (!data) notFound();
  const a = computeAnalytics(data);

  return (
    <div className="space-y-6">
      <Link href={`/admin/cycles/${id}`} className="btn !py-1.5 !px-3 text-xs text-muted hover:text-white inline-flex items-center gap-1.5">
        <ArrowLeft className="h-3.5 w-3.5 text-cyan" /> Back to Schedule Board
      </Link>
      <div className="border-b border-white/10 pb-4">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white m-0">
          {data.cycle.name} · Analytics
        </h1>
      </div>
      <AnalyticsView a={a} name={data.cycle.name} />
    </div>
  );
}
