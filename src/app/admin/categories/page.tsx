import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { CategoryManagement, type CategoryWithStats } from "@/components/category-management";

export default async function CategoriesPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [{ data: categories }, { data: mentorCats }, { data: teamCats }] = await Promise.all([
    supabase.from("categories").select("id,name,color,created_at").order("name"),
    supabase.from("mentor_categories").select("category_id"),
    supabase.from("team_categories").select("category_id")
  ]);

  const mentorCountMap = new Map<string, number>();
  for (const m of mentorCats ?? []) {
    mentorCountMap.set(m.category_id, (mentorCountMap.get(m.category_id) ?? 0) + 1);
  }

  const teamCountMap = new Map<string, number>();
  for (const t of teamCats ?? []) {
    teamCountMap.set(t.category_id, (teamCountMap.get(t.category_id) ?? 0) + 1);
  }

  const list: CategoryWithStats[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    created_at: c.created_at,
    mentorsCount: mentorCountMap.get(c.id) ?? 0,
    teamsCount: teamCountMap.get(c.id) ?? 0
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Challenge Track Categories"
        sub="NASA Space Apps Cairo 2026 • Manage technical domain specialties and challenge themes."
      />
      <CategoryManagement categories={list} />
    </div>
  );
}

