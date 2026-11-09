import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AssignmentRow,
  AvailRow,
  CycleData,
  CycleMentorRow,
  CycleTeamRow,
  LocationRow,
} from "./cycle-model";

/**
 * Paginates through all records for a query to ensure results are never truncated
 * by PostgREST's default max-rows limit (1000 rows on Supabase free/cloud tier).
 */
async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const pageSize = 1000;
  let from = 0;
  const results: T[] = [];
  while (true) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || !Array.isArray(data) || data.length === 0) break;
    results.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return results;
}

/** Loads everything for one cycle in a handful of batched queries (free-tier friendly). */
export async function loadCycle(supabase: SupabaseClient, cycleId: string): Promise<CycleData | null> {
  const { data: cycle } = await supabase.from("cycles").select("*").eq("id", cycleId).single();
  if (!cycle) return null;

  const [slots, mentors, teams, assignments, categories, locations] = await Promise.all([
    supabase.from("time_slots").select("id,idx,day,starts_at,ends_at,kind,enabled").eq("cycle_id", cycleId).order("idx"),
    fetchAllPages<CycleMentorRow>((from, to) =>
      supabase.from("cycle_mentors").select("id,mentor_id,mentor_name,categories,location_id,status").eq("cycle_id", cycleId).order("mentor_name").range(from, to)
    ),
    fetchAllPages<CycleTeamRow>((from, to) =>
      supabase.from("cycle_teams").select("id,team_id,team_name,categories,location_id,status").eq("cycle_id", cycleId).order("team_name").range(from, to)
    ),
    fetchAllPages<AssignmentRow>((from, to) =>
      supabase.from("assignments").select("id,slot_id,cycle_mentor_id,cycle_team_id,locked").eq("cycle_id", cycleId).range(from, to)
    ),
    supabase.from("categories").select("id,name,color").order("name"),
    fetchAllPages<LocationRow>((from, to) =>
      supabase.from("locations").select("id,building,floor,section").range(from, to)
    ),
  ]);

  const slotIds = (slots.data ?? []).map((s) => s.id);
  const [mAvail, tAvail] = await Promise.all([
    slotIds.length
      ? fetchAllPages<AvailRow>((from, to) =>
          supabase.from("mentor_availability").select("cycle_mentor_id,slot_id,reason").in("slot_id", slotIds).range(from, to)
        )
      : Promise.resolve([]),
    slotIds.length
      ? fetchAllPages<AvailRow>((from, to) =>
          supabase.from("team_availability").select("cycle_team_id,slot_id,reason").in("slot_id", slotIds).range(from, to)
        )
      : Promise.resolve([]),
  ]);

  return {
    cycle,
    slots: slots.data ?? [],
    mentors,
    teams,
    mAvail,
    tAvail,
    assignments,
    categories: categories.data ?? [],
    locations,
  };
}
