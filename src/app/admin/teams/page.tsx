import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { TeamManagement, type TeamItem } from "@/components/team-management";

export default async function TeamsPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [{ data: rawTeams }, { data: categories }, { data: locations }] = await Promise.all([
    supabase
      .from("teams")
      .select("id,name,location_id,info,created_at,team_categories(category_id)")
      .order("name")
      .limit(2000),
    supabase.from("categories").select("id,name,color").order("name"),
    supabase.from("locations").select("id,building,floor,section").order("building").order("floor").order("section")
  ]);

  interface RawTeam {
    id: string;
    name: string;
    location_id: string | null;
    info: Record<string, string> | null;
    created_at: string;
    team_categories: { category_id: string }[] | null;
  }

  const teams: TeamItem[] = ((rawTeams ?? []) as unknown as RawTeam[]).map((t) => ({
    id: t.id,
    name: t.name,
    location_id: t.location_id,
    info: t.info || {},
    created_at: t.created_at,
    categoryIds: (t.team_categories ?? []).map((tc) => tc.category_id)
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hackathon Teams Roster"
        sub="NASA Space Apps Cairo 2026 • Participating teams, challenge tracks, and station table assignments."
      />
      <TeamManagement
        teams={teams}
        categories={categories ?? []}
        locations={locations ?? []}
      />
    </div>
  );
}
