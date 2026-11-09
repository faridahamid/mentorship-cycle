import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { UserManagement, type ProfileUser } from "@/components/user-management";

export default async function UsersPage() {
  const session = await requireRole("admin");
  const supabase = await createClient();

  const [{ data: profiles }, { data: categories }, { data: locations }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,full_name,email,role,created_at")
      .order("created_at", { ascending: false }),
    supabase.from("categories").select("id,name,color").order("name"),
    supabase.from("locations").select("id,building,floor,section").order("building").order("floor").order("section")
  ]);

  const list: ProfileUser[] = (profiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    email: p.email,
    role: p.role,
    created_at: p.created_at
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Account Governance & Roles"
        sub="NASA Space Apps Cairo 2026 • Manage access privileges, control room admins, and mentor accounts."
      />
      <UserManagement
        users={list}
        currentUserId={session.id}
        currentUserRole={session.role}
        categories={categories ?? []}
        locations={locations ?? []}
      />
    </div>
  );
}

