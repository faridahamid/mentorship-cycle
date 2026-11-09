import { requireRole, getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { SystemManagement, type UsageStats } from "@/components/system-management";

export default async function SystemPage() {
  await requireRole("admin");
  const session = await getSession();
  const supabase = await createClient();

  const { data: rawStats } = await supabase.rpc("usage_stats");

  const stats: UsageStats = (rawStats as unknown as UsageStats) ?? {
    db_bytes: 0,
    rows: {
      assignments: 0,
      teams: 0,
      mentors: 0,
      cycles: 0,
      audit_logs: 0,
      profiles: 0
    }
  };

  // Prepare full data snapshot for backup
  const [
    { data: cycles },
    { data: teams },
    { data: mentors },
    { data: categories },
    { data: locations }
  ] = await Promise.all([
    supabase.from("cycles").select("*"),
    supabase.from("teams").select("*,team_categories(*)"),
    supabase.from("mentors").select("*,mentor_categories(*)"),
    supabase.from("categories").select("*"),
    supabase.from("locations").select("*")
  ]);

  const fullBackupData = {
    metadata: {
      exported_at: new Date().toISOString(),
      platform: "NASA Space Apps Cairo 2026 - Mentor Cycle",
      exported_by: session?.fullName ?? "Admin"
    },
    cycles: cycles ?? [],
    teams: teams ?? [],
    mentors: mentors ?? [],
    categories: categories ?? [],
    locations: locations ?? []
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage Telemetry & Backup"
        sub="NASA Space Apps Cairo 2026 • Database storage quota, entity allocations, and disaster recovery snapshot."
      />
      <SystemManagement
        stats={stats}
        isSuper={session?.role === "super_admin"}
        fullBackupData={fullBackupData}
      />
    </div>
  );
}
