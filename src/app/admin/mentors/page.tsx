import { requireRole, getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { MentorManagement, type MentorItem } from "@/components/mentor-management";

export default async function MentorsPage() {
  await requireRole("admin");
  const session = await getSession();
  const supabase = await createClient();

  const [{ data: rawMentors }, { data: categories }, { data: locations }] = await Promise.all([
    supabase
      .from("mentors")
      .select("id,profile_id,full_name,gender,location_id,created_at,mentor_categories(category_id),profiles(email)")
      .order("full_name")
      .limit(1000),
    supabase.from("categories").select("id,name,color").order("name"),
    supabase.from("locations").select("id,building,floor,section").order("building").order("floor").order("section")
  ]);

  interface RawMentor {
    id: string;
    profile_id: string | null;
    full_name: string;
    gender: string | null;
    location_id: string | null;
    created_at: string;
    mentor_categories: { category_id: string }[] | null;
    profiles: { email: string } | null;
  }

  const mentors: MentorItem[] = ((rawMentors ?? []) as unknown as RawMentor[]).map((m) => ({
    id: m.id,
    profile_id: m.profile_id,
    full_name: m.full_name,
    gender: m.gender ?? null,
    email: m.profiles?.email ?? null,
    location_id: m.location_id,
    created_at: m.created_at,
    categoryIds: (m.mentor_categories ?? []).map((mc) => mc.category_id)
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Specialized Mentors Roster"
        sub="NASA Space Apps Cairo 2026 • Domain mentors, station locations, and challenge tracks."
      />
      <MentorManagement
        mentors={mentors}
        categories={categories ?? []}
        locations={locations ?? []}
        isSuper={session?.role === "super_admin"}
      />
    </div>
  );
}
