import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { AuditManagement, type AuditItem } from "@/components/audit-management";

export default async function AuditPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [{ data: rawLogs }, { data: profiles }] = await Promise.all([
    supabase
      .from("audit_logs")
      .select("id,actor,action,entity,entity_id,details,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("id,full_name,email")
  ]);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const logs: AuditItem[] = (rawLogs ?? []).map((l) => {
    const prof = l.actor ? profileMap.get(l.actor) : null;
    return {
      id: l.id,
      actor: l.actor,
      actorName: prof?.full_name ?? (l.actor ? "Unknown User" : "System / Migration"),
      actorEmail: prof?.email ?? "system",
      action: l.action,
      entity: l.entity,
      entity_id: l.entity_id,
      details: (l.details as Record<string, unknown>) || {},
      created_at: l.created_at
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security & Audit Telemetry"
        sub="NASA Space Apps Cairo 2026 • Real-time operational traceability and governance audit trails."
      />
      <AuditManagement logs={logs} />
    </div>
  );
}
