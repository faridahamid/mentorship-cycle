import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { CycleForm } from "@/components/cycle-form";

export default async function NewCycle() {
  const supabase = await createClient();
  const [cats, mentors, teams] = await Promise.all([
    supabase.from("categories").select("id,name,color").order("name"),
    supabase.from("mentors").select("id,full_name").order("full_name").limit(1000),
    supabase.from("teams").select("id,name").order("name").limit(2000)
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Create New Cycle"
        sub="Timeline slots, session rotations, and break rhythms are calculated automatically."
      />
      <CycleForm
        categories={cats.data ?? []}
        mentors={(mentors.data ?? []).map((m) => ({ id: m.id, name: m.full_name }))}
        teams={teams.data ?? []}
      />
    </div>
  );
}
