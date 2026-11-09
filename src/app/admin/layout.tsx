import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Shell, type NavItem } from "@/components/shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("admin");
  const supabase = await createClient();
  const { data: notifications } = await supabase.from("notifications").select("id,message,read,created_at").eq("profile_id", s.id).order("created_at", { ascending: false }).limit(15);
  const nav: NavItem[] = [
    { href: "/admin", label: "Overview", icon: "dash" },
    { href: "/admin/cycles", label: "Cycles", icon: "cycles" },
    { href: "/admin/teams", label: "Teams", icon: "teams" },
    { href: "/admin/mentors", label: "Mentors", icon: "mentors" },
    { href: "/admin/locations", label: "Locations", icon: "loc" },
    { href: "/admin/categories", label: "Categories", icon: "cats" },
    { href: "/admin/users", label: "Accounts", icon: "users" },
    { href: "/admin/system", label: "Usage & backup", icon: "system" },
    { href: "/admin/audit", label: "Audit log", icon: "audit" },
  ];
  return <Shell nav={nav} user={{ name: s.fullName, role: s.role }} notifications={notifications ?? []}>{children}</Shell>;
}

