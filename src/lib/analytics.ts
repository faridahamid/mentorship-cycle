import { buildReport, validateAssignments, type Issue } from "@/lib/scheduler";
import { buildInput, sessionSlots, type CycleData } from "@/lib/cycle-model";

export interface Analytics {
  totals: { teams: number; mentors: number; sessions: number; assignments: number; breaks: number };
  mentorLoad: { id: string; name: string; sessions: number; uniqueTeams: number; absentSlots: number; breakSlots: number; attendance: number }[];
  teamCoverage: { id: string; name: string; met: number; eligible: number; sessions: number }[];
  categoryCoverage: { category: string; color: string; teams: number; met: number; eligible: number }[];
  unassignedTeams: string[];
  completion: number; // assigned mentor-slot cells / available mentor-slot cells
  coverage: number;
  workloadSpread: number;
  issues: Issue[];
  absences: number;
  breaks: number;
}

export function computeAnalytics(d: CycleData): Analytics {
  const input = buildInput(d);
  const asg = d.assignments.map((a) => ({ slotId: a.slot_id, mentorId: a.cycle_mentor_id, teamId: a.cycle_team_id }));
  const { metrics, issues: rep } = buildReport(input, asg);
  const issues = [...validateAssignments(input, asg), ...rep];
  const slots = sessionSlots(d);
  const mentorTeams = new Map<string, Set<string>>();
  for (const a of asg) mentorTeams.set(a.mentorId, (mentorTeams.get(a.mentorId) ?? new Set()).add(a.teamId));
  const slotSet = new Set(slots.map((s) => s.id));
  const mentorLoad = d.mentors.filter((m) => m.status !== "removed").map((m) => {
    const un = input.mentors.find((x) => x.id === m.id)!.unavailable ?? [];
    const absent = d.mAvail.filter((a) => a.cycle_mentor_id === m.id && a.reason !== "break" && slotSet.has(a.slot_id)).length + (m.status === "absent" ? slots.length : 0);
    const brk = d.mAvail.filter((a) => a.cycle_mentor_id === m.id && a.reason === "break" && slotSet.has(a.slot_id)).length;
    return { id: m.id, name: m.mentor_name, sessions: metrics.mentorLoad[m.id] ?? 0, uniqueTeams: mentorTeams.get(m.id)?.size ?? 0, absentSlots: Math.min(absent, slots.length), breakSlots: brk, attendance: slots.length ? Math.max(0, 1 - un.length / slots.length) : 1 };
  });
  const teamCoverage = d.teams.filter((t) => t.status !== "removed").map((t) => ({ id: t.id, name: t.team_name, met: metrics.teamUniqueMentors[t.id] ?? 0, eligible: metrics.teamEligibleMentors[t.id] ?? 0, sessions: metrics.teamLoad[t.id] ?? 0 }));
  const categoryCoverage = d.categories.map((c) => {
    let teams = 0, met = 0, eligible = 0;
    for (const [, cats] of Object.entries(metrics.categoryCoverage)) if (cats[c.id]) { teams++; met += cats[c.id].met; eligible += cats[c.id].eligible; }
    return { category: c.name, color: c.color, teams, met, eligible };
  }).filter((c) => c.teams > 0);
  const cells = input.mentors.filter((m) => m.active).reduce((n, m) => n + slots.length - (m.unavailable ?? []).filter((s) => slotSet.has(s)).length, 0);
  return {
    totals: { teams: d.teams.filter((t) => t.status !== "removed").length, mentors: mentorLoad.length, sessions: slots.length, assignments: d.assignments.length, breaks: d.slots.filter((s) => s.kind === "break").length },
    mentorLoad, teamCoverage, categoryCoverage,
    unassignedTeams: teamCoverage.filter((t) => t.sessions === 0).map((t) => t.name),
    completion: cells ? Math.min(1, d.assignments.length / cells) : 0,
    coverage: metrics.coverage,
    workloadSpread: metrics.workloadSpread,
    issues,
    absences: d.mAvail.filter((a) => a.reason !== "break").length + d.tAvail.length,
    breaks: d.mAvail.filter((a) => a.reason === "break").length,
  };
}

