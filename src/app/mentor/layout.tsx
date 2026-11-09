import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/shell";

export default async function MentorLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("mentor");
  const supabase = await createClient();
  const { data: notifications } = await supabase.from("notifications").select("id,message,read,created_at").eq("profile_id", s.id).order("created_at", { ascending: false }).limit(15);
  return <Shell nav={[{ href: "/mentor", label: "My schedule", icon: "me" }]} user={{ name: s.fullName, role: s.role }} notifications={notifications ?? []}>{children}</Shell>;
}

