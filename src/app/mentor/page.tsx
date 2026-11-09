import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import {
  MentorScheduleView,
  type MentorCycleInfo,
  type TeamAssignment,
} from "@/components/mentor-schedule-view";

export default async function MentorDashboard({
  searchParams,
}: {
  searchParams?: Promise<{ mentorId?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : {};
  const s = await requireRole("mentor");
  const supabase = await createClient();
  const isAdmin = s.role === "admin" || s.role === "super_admin";

  let availableMentorsForAdmin: { id: string; name: string }[] = [];
  if (isAdmin) {
    const { data: allMentors } = await supabase
      .from("mentors")
      .select("id,full_name")
      .order("full_name");
    availableMentorsForAdmin = (allMentors ?? []).map((m) => ({ id: m.id, name: m.full_name }));
  }

  // Find target mentor record
  let mentorRec: {
    id: string;
    full_name: string;
    gender?: string | null;
    location_id: string | null;
    mentor_categories?: { category_id: string }[];
  } | null = null;

  if (isAdmin && resolvedParams.mentorId) {
    const { data } = await supabase
      .from("mentors")
      .select("id,full_name,gender,location_id,mentor_categories(category_id)")
      .eq("id", resolvedParams.mentorId)
      .maybeSingle();
    mentorRec = data;
  }

  if (!mentorRec) {
    // Lookup by user's profile id
    const { data } = await supabase
      .from("mentors")
      .select("id,full_name,gender,location_id,mentor_categories(category_id)")
      .eq("profile_id", s.id)
      .maybeSingle();
    mentorRec = data;
  }

  // Fallback for admin if no mentor is linked to their profile
  if (!mentorRec && isAdmin && availableMentorsForAdmin.length > 0) {
    const { data } = await supabase
      .from("mentors")
      .select("id,full_name,gender,location_id,mentor_categories(category_id)")
      .eq("id", availableMentorsForAdmin[0].id)
      .maybeSingle();
    mentorRec = data;
  }

  // Get locations, categories, and cycles
  const [locationsRes, categoriesRes, cyclesRes] = await Promise.all([
    supabase.from("locations").select("id,building,floor,section"),
    supabase.from("categories").select("id,name,color").order("name"),
    supabase
      .from("cycles")
      .select("id,name,start_date,end_date,mode,status")
      .neq("status", "archived")
      .order("created_at", { ascending: false }),
  ]);

  const locations = locationsRes.data ?? [];
  const categories = categoriesRes.data ?? [];
  const activeCycles = cyclesRes.data ?? [];
  const locMap = new Map(locations.map((l) => [l.id, l]));

  if (!mentorRec) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My Mentor Schedule"
          sub="NASA Space Apps Cairo 2026 • Your personal rotation schedule, matched teams, and challenge tracks."
        />
        <div className="panel p-8 text-center font-mono text-xs text-muted space-y-2">
          <p>No mentor profile found linked to your account ({s.email}).</p>
          <p className="text-white/60">
            Please contact the event administrator to link your profile to a mentor station.
          </p>
        </div>
      </div>
    );
  }

  // Query cycle_mentors for this mentor
  const { data: cmList } = await supabase
    .from("cycle_mentors")
    .select("id,cycle_id,location_id,categories,status")
    .eq("mentor_id", mentorRec.id);

  const cmByCycle = new Map((cmList ?? []).map((cm) => [cm.cycle_id, cm]));

  // For each cycle where the mentor is enrolled:
  const mentorCycles: MentorCycleInfo[] = [];

  for (const c of activeCycles) {
    const cm = cmByCycle.get(c.id);
    if (!cm) continue;

    // Fetch slots
    const { data: slotsData } = await supabase
      .from("time_slots")
      .select("id,idx,day,starts_at,ends_at,kind,enabled")
      .eq("cycle_id", c.id)
      .order("idx");

    const slots = (slotsData ?? []).map((slot) => ({
      id: slot.id,
      idx: slot.idx,
      day: slot.day,
      startsAt: slot.starts_at.slice(0, 5),
      endsAt: slot.ends_at.slice(0, 5),
      kind: slot.kind as "session" | "break",
      enabled: slot.enabled,
    }));

    // Fetch assignments for this cycle_mentor
    const { data: asgsData } = await supabase
      .from("assignments")
      .select("id,slot_id,cycle_team_id")
      .eq("cycle_mentor_id", cm.id);

    // Fetch team info
    const teamIds = Array.from(new Set((asgsData ?? []).map((a) => a.cycle_team_id)));
    let teamsMap = new Map<string, { id: string; team_name: string; location_id: string | null; categories: string[] }>();

    if (teamIds.length > 0) {
      const { data: teamsData } = await supabase
        .from("cycle_teams")
        .select("id,team_name,location_id,categories")
        .in("id", teamIds);
      teamsMap = new Map((teamsData ?? []).map((t) => [t.id, t]));
    }

    // Fetch mentor availability
    const { data: mAvailData } = await supabase
      .from("mentor_availability")
      .select("slot_id")
      .eq("cycle_mentor_id", cm.id);

    const unavailableSlots = (mAvailData ?? []).map((a) => a.slot_id);

    const assignments: TeamAssignment[] = (asgsData ?? []).map((a) => {
      const team = teamsMap.get(a.cycle_team_id);
      const tLoc = team?.location_id ? locMap.get(team.location_id) : null;
      return {
        assignmentId: a.id,
        slotId: a.slot_id,
        teamId: a.cycle_team_id,
        teamName: team?.team_name ?? "Assigned Team",
        teamLocation: tLoc ? { building: tLoc.building, floor: tLoc.floor, section: tLoc.section } : null,
        categories: team?.categories ?? [],
      };
    });

    mentorCycles.push({
      id: c.id,
      name: c.name,
      startDate: c.start_date,
      endDate: c.end_date,
      mode: c.mode,
      status: c.status,
      cycleMentorId: cm.id,
      slots,
      assignments,
      unavailableSlots,
    });
  }

  const mentorStation = mentorRec.location_id ? locMap.get(mentorRec.location_id) : null;
  const mentorCats = Array.from(
    new Set([
      ...(mentorRec.mentor_categories ?? []).map((c) => c.category_id),
      ...(cmList ?? []).flatMap((cm) => cm.categories ?? []),
    ])
  );

  const mentorFieldNames = mentorCats
    .map((c) => categories.find((cat) => cat.id === c)?.name)
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Mentor Schedule"
        sub={`NASA Space Apps Cairo 2026 • Field: ${mentorFieldNames || "General Mentorship"} • Your personal rotation schedule, matched teams, and challenge tracks.`}
      />

      <MentorScheduleView
        mentor={{
          id: mentorRec.id,
          name: mentorRec.full_name,
          gender: mentorRec.gender ?? null,
          email: s.email,
          stationLocation: mentorStation
            ? { building: mentorStation.building, floor: mentorStation.floor, section: mentorStation.section }
            : null,
          categories: mentorCats,
        }}
        cycles={mentorCycles}
        allCategories={categories}
        allLocations={locations}
        isAdmin={isAdmin}
        availableMentorsForAdmin={availableMentorsForAdmin}
        currentAdminMentorId={mentorRec.id}
      />
    </div>
  );
}
