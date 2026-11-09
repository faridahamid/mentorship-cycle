import { generateSchedule, diffSchedules, type Assignment, type Issue, type ScheduleInput, type ScheduleResult, type ScheduleDiff } from "@/lib/scheduler";

export type MemberStatus = "active" | "absent" | "removed";
export interface CycleRow {
  id: string; name: string; start_date: string; end_date: string; daily_start: string; daily_end: string;
  session_minutes: number; break_count: number; break_minutes: number; mode: "sequential" | "simultaneous";
  max_simultaneous: number; status: "draft" | "active" | "archived"; settings: Record<string, unknown>;
}
export interface SlotRow { id: string; idx: number; day: string; starts_at: string; ends_at: string; kind: "session" | "break"; enabled: boolean }
export interface LocationRow { id: string; building: string; floor: number; section: string }
export interface CategoryRow { id: string; name: string; color: string }
export interface CycleMentorRow { id: string; mentor_id: string | null; mentor_name: string; categories: string[]; location_id: string | null; status: MemberStatus }
export interface CycleTeamRow { id: string; team_id: string | null; team_name: string; categories: string[]; location_id: string | null; status: MemberStatus }
export interface AssignmentRow { id: string; slot_id: string; cycle_mentor_id: string; cycle_team_id: string; locked: boolean }
export interface AvailRow { cycle_mentor_id?: string; cycle_team_id?: string; slot_id: string; reason?: string }

export interface CycleData {
  cycle: CycleRow;
  slots: SlotRow[];
  mentors: CycleMentorRow[];
  teams: CycleTeamRow[];
  mAvail: AvailRow[];
  tAvail: AvailRow[];
  assignments: AssignmentRow[];
  categories: CategoryRow[];
  locations: LocationRow[];
}

export interface AutoQuotas {
  autoMaxSimultaneous: number;
  autoTeamsPerMentor: number;
  explanation: string;
}

/**
 * Calculates optimal system defaults for max simultaneous mentors per team
 * and teams per mentor per rotation, ensuring full coverage every session without leaving mentors idle.
 */
export function calculateAutoCycleQuotas(
  mentorsCount: number,
  teamsCount: number,
  mode: "sequential" | "simultaneous"
): AutoQuotas {
  const m = Math.max(1, mentorsCount);
  const t = Math.max(1, teamsCount);

  let autoMaxSimultaneous = 1;
  if (mode === "simultaneous") {
    if (m >= t) {
      autoMaxSimultaneous = Math.min(6, Math.max(1, Math.floor(m / t)));
    } else {
      autoMaxSimultaneous = 2;
    }
  }

  const rounds = mode === "simultaneous" ? autoMaxSimultaneous : 1;
  const autoTeamsPerMentor = Math.max(1, Math.ceil((t * rounds) / m));

  const explanation =
    mode === "simultaneous"
      ? `${autoTeamsPerMentor} teams/mentor (from ${t} teams × ${autoMaxSimultaneous} mentors/team ÷ ${m} mentors = ${((t * autoMaxSimultaneous) / m).toFixed(1)})`
      : `${autoTeamsPerMentor} teams/mentor (from ${t} teams ÷ ${m} mentors = ${(t / m).toFixed(1)})`;

  return {
    autoMaxSimultaneous,
    autoTeamsPerMentor,
    explanation,
  };
}

export type Change =
  | { type: "mentor_unavailable"; cycle_mentor_id: string; slot_ids: string[]; reason: "absent" | "break" }
  | { type: "mentor_available"; cycle_mentor_id: string; slot_ids: string[] }
  | { type: "mentor_status"; cycle_mentor_id: string; status: MemberStatus }
  | { type: "team_unavailable"; cycle_team_id: string; slot_ids: string[] }
  | { type: "team_available"; cycle_team_id: string; slot_ids: string[] }
  | { type: "team_status"; cycle_team_id: string; status: MemberStatus }
  | { type: "slot_toggle"; slot_id: string; enabled: boolean }
  | { type: "slot_kind"; slot_id: string; kind: "session" | "break" }
  | { type: "regenerate" }
  | { type: "manual" };

/** Applies a change to an in-memory copy (used for previews and before recomputation). */
export function applyChange(d: CycleData, c: Change): CycleData {
  const n: CycleData = { ...d };
  switch (c.type) {
    case "mentor_unavailable": {
      const have = new Set(d.mAvail.filter((a) => a.cycle_mentor_id === c.cycle_mentor_id).map((a) => a.slot_id));
      n.mAvail = [...d.mAvail, ...c.slot_ids.filter((s) => !have.has(s)).map((slot_id) => ({ cycle_mentor_id: c.cycle_mentor_id, slot_id, reason: c.reason }))];
      break;
    }
    case "mentor_available":
      n.mAvail = d.mAvail.filter((a) => !(a.cycle_mentor_id === c.cycle_mentor_id && c.slot_ids.includes(a.slot_id)));
      break;
    case "mentor_status":
      n.mentors = d.mentors.map((m) => (m.id === c.cycle_mentor_id ? { ...m, status: c.status } : m));
      break;
    case "team_unavailable": {
      const have = new Set(d.tAvail.filter((a) => a.cycle_team_id === c.cycle_team_id).map((a) => a.slot_id));
      n.tAvail = [...d.tAvail, ...c.slot_ids.filter((s) => !have.has(s)).map((slot_id) => ({ cycle_team_id: c.cycle_team_id, slot_id }))];
      break;
    }
    case "team_available":
      n.tAvail = d.tAvail.filter((a) => !(a.cycle_team_id === c.cycle_team_id && c.slot_ids.includes(a.slot_id)));
      break;
    case "team_status":
      n.teams = d.teams.map((t) => (t.id === c.cycle_team_id ? { ...t, status: c.status } : t));
      break;
    case "slot_kind":
      n.slots = d.slots.map((s) => (s.id === c.slot_id ? { ...s, kind: c.kind } : s));
      break;
    case "slot_toggle":
      n.slots = d.slots.map((s) => (s.id === c.slot_id ? { ...s, enabled: c.enabled } : s));
      break;
  }
  return n;
}

export const sessionSlots = (d: CycleData) => d.slots.filter((s) => s.kind === "session" && s.enabled);

export function buildInput(d: CycleData): ScheduleInput {
  const slots = sessionSlots(d);
  const allIds = slots.map((s) => s.id);
  const loc = new Map(d.locations.map((l) => [l.id, l]));
  const toLoc = (id: string | null) => (id && loc.get(id) ? { building: loc.get(id)!.building, floor: loc.get(id)!.floor, section: loc.get(id)!.section } : undefined);
  const mUn = new Map<string, string[]>();
  for (const a of d.mAvail) mUn.set(a.cycle_mentor_id!, [...(mUn.get(a.cycle_mentor_id!) ?? []), a.slot_id]);
  const tUn = new Map<string, string[]>();
  for (const a of d.tAvail) tUn.set(a.cycle_team_id!, [...(tUn.get(a.cycle_team_id!) ?? []), a.slot_id]);
  return {
    mode: d.cycle.mode,
    maxSimultaneous: d.cycle.max_simultaneous,
    maxTeamsPerMentor: d.cycle.settings?.max_teams_per_mentor ? Number(d.cycle.settings.max_teams_per_mentor) : undefined,
    slots: slots.map((s) => ({ id: s.id, index: s.idx })),
    mentors: d.mentors.map((m) => ({
      id: m.id, name: m.mentor_name, categories: m.categories, location: toLoc(m.location_id),
      active: m.status !== "removed",
      unavailable: m.status === "absent" ? allIds : mUn.get(m.id) ?? [],
    })),
    teams: d.teams.map((t) => ({
      id: t.id, name: t.team_name, categories: t.categories, location: toLoc(t.location_id),
      active: t.status !== "removed",
      unavailable: t.status === "absent" ? allIds : tUn.get(t.id) ?? [],
    })),
  };
}

export interface Plan {
  result: ScheduleResult;
  diff: ScheduleDiff;
  removeIds: string[];
  add: { slot_id: string; cycle_mentor_id: string; cycle_team_id: string }[];
  issues: Issue[];
}

const key = (a: { slotId: string; mentorId: string; teamId: string }) => `${a.slotId}|${a.mentorId}|${a.teamId}`;
const toA = (a: AssignmentRow): Assignment => ({ slotId: a.slot_id, mentorId: a.cycle_mentor_id, teamId: a.cycle_team_id });

/**
 * "redistribute": keep every still-valid assignment, fill gaps.
 * "fresh": keep only locked (manual) assignments, rebuild the rest.
 */
export function plan(d: CycleData, kind: "redistribute" | "fresh"): Plan {
  const input = buildInput(d);
  const keep = kind === "fresh" ? d.assignments.filter((a) => a.locked) : d.assignments;
  const result = generateSchedule({ ...input, fixed: keep.map(toA) });
  const next = new Set(result.assignments.map(key));
  const existing = new Map(d.assignments.map((a) => [key(toA(a)), a]));

  if (kind === "fresh") {
    const lockedKeys = new Set(d.assignments.filter((a) => a.locked).map((a) => key(toA(a))));
    const removeIds = d.assignments.filter((a) => !a.locked).map((a) => a.id);
    const add = result.assignments
      .filter((a) => !lockedKeys.has(key(a)))
      .map((a) => ({ slot_id: a.slotId, cycle_mentor_id: a.mentorId, cycle_team_id: a.teamId }));
    return {
      result,
      diff: diffSchedules(d.assignments.map(toA), result.assignments),
      removeIds,
      add,
      issues: result.issues,
    };
  }

  const removeIds = d.assignments.filter((a) => !next.has(key(toA(a)))).map((a) => a.id);
  const add = result.assignments
    .filter((a) => !existing.has(key(a)))
    .map((a) => ({ slot_id: a.slotId, cycle_mentor_id: a.mentorId, cycle_team_id: a.teamId }));
  return { result, diff: diffSchedules(d.assignments.map(toA), result.assignments), removeIds, add, issues: result.issues };
}
