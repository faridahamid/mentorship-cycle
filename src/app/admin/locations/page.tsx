import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { LocationManagement, type LocationWithUsage } from "@/components/location-management";

export default async function LocationsPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [{ data: locations }, { data: mentors }, { data: teams }] = await Promise.all([
    supabase.from("locations").select("id,building,floor,section").order("building").order("floor").order("section"),
    supabase.from("mentors").select("location_id"),
    supabase.from("teams").select("location_id")
  ]);

  const mentorLocMap = new Map<string, number>();
  for (const m of mentors ?? []) {
    if (m.location_id) {
      mentorLocMap.set(m.location_id, (mentorLocMap.get(m.location_id) ?? 0) + 1);
    }
  }

  const teamLocMap = new Map<string, number>();
  for (const t of teams ?? []) {
    if (t.location_id) {
      teamLocMap.set(t.location_id, (teamLocMap.get(t.location_id) ?? 0) + 1);
    }
  }

  const list: LocationWithUsage[] = (locations ?? [])
    .map((l) => ({
      id: l.id,
      building: l.building,
      floor: l.floor,
      section: l.section,
      mentorsCount: mentorLocMap.get(l.id) ?? 0,
      teamsCount: teamLocMap.get(l.id) ?? 0
    }))
    .sort((a, b) => {
      const bld = a.building.localeCompare(b.building, undefined, { numeric: true, sensitivity: "base" });
      if (bld !== 0) return bld;
      if (a.floor !== b.floor) return a.floor - b.floor;
      return (a.section || "").localeCompare(b.section || "", undefined, { numeric: true, sensitivity: "base" });
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Physical Locations & Stations"
        sub="NASA Space Apps Cairo 2026 • Stations, tables, and judging zones."
      />
      <LocationManagement locations={list} />
    </div>
  );
}

