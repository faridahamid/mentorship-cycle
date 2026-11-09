import { isEligible } from "./util";
import type {
  Assignment,
  Issue,
  Metrics,
  ScheduleDiff,
  ScheduleInput,
} from "./types";

const k = (a: string, b: string) => `${a}|${b}`;

/** Independent validator: finds overbooking and availability violations in ANY assignment set. */
export function validateAssignments(input: ScheduleInput, assignments: Assignment[]): Issue[] {
  const issues: Issue[] = [];
  const rounds = input.mode === "simultaneous" ? Math.max(1, input.maxSimultaneous ?? 2) : 1;
  const mentors = new Map(input.mentors.map((m) => [m.id, m]));
  const teams = new Map(input.teams.map((t) => [t.id, t]));
  const mSlot = new Map<string, number>();
  const tSlot = new Map<string, number>();
  const pair = new Map<string, number>();
  for (const a of assignments) {
    mSlot.set(k(a.slotId, a.mentorId), (mSlot.get(k(a.slotId, a.mentorId)) ?? 0) + 1);
    tSlot.set(k(a.slotId, a.teamId), (tSlot.get(k(a.slotId, a.teamId)) ?? 0) + 1);
    pair.set(k(a.slotId, k(a.mentorId, a.teamId)), 1);
    const m = mentors.get(a.mentorId);
    const t = teams.get(a.teamId);
    if (m?.unavailable?.includes(a.slotId))
      issues.push({ type: "unavailable_assignment", severity: "error", mentorId: m.id, message: `${m.name} is assigned while absent/on break.` });
    if (t?.unavailable?.includes(a.slotId))
      issues.push({ type: "unavailable_assignment", severity: "error", teamId: t.id, message: `${t.name} is assigned while absent.` });
  }

  // Calculate per-category demand and supply to allow scaled mentor capacities
  const catTeams = new Map<string, number>();
  const catMentors = new Map<string, number>();
  for (const t of input.teams) {
    for (const c of t.categories) catTeams.set(c, (catTeams.get(c) ?? 0) + 1);
  }
  for (const m of input.mentors) {
    for (const c of m.categories) catMentors.set(c, (catMentors.get(c) ?? 0) + 1);
  }
  const globalRatio = input.mode === "simultaneous"
    ? Math.max(1, Math.ceil(input.teams.reduce((acc, t) => acc + (t.categories.length || 1), 0) / Math.max(1, input.mentors.length)))
    : Math.max(1, Math.ceil(input.teams.length / Math.max(1, input.mentors.length)));

  const defaultMentorLimit = input.maxTeamsPerMentor ?? Math.max(1, Math.ceil(input.teams.length / Math.max(1, input.mentors.length)) + 2);
  const mentorLimit = (mId: string) => {
    if (input.mode !== "simultaneous") return defaultMentorLimit;
    const m = mentors.get(mId);
    let lim = Math.max(input.maxTeamsPerMentor ?? 1, globalRatio);
    if (m) {
      for (const c of m.categories) {
        const req = Math.ceil((catTeams.get(c) ?? 0) / Math.max(1, catMentors.get(c) ?? 1));
        if (req > lim) lim = req;
      }
    }
    // Headroom buffer (+ 1) accommodates slot-to-slot distribution variances and rounding
    return lim + 1;
  };

  for (const [key, n] of mSlot) {
    const id = key.split("|")[1];
    const maxMentorTeams = mentorLimit(id);
    if (n > maxMentorTeams) {
      issues.push({
        type: "mentor_overbooked",
        severity: input.mode === "simultaneous" ? "warning" : "error",
        mentorId: id,
        message: `${mentors.get(id)?.name ?? id} is booked with ${n} teams in one slot (${input.mode === "simultaneous" ? "calculated quota" : "limit"} ${maxMentorTeams}).`,
      });
    }
  }
  for (const [key, n] of tSlot) {
    const id = key.split("|")[1];
    const t = teams.get(id);
    const teamLimit = input.mode === "simultaneous" ? Math.max(rounds, t?.categories.length ?? rounds) : 1;
    if (n > teamLimit) {
      issues.push({ type: "team_overbooked", severity: "error", teamId: id, message: `${t?.name ?? id} has ${n} mentors in one slot (limit ${teamLimit}).` });
    }
  }

  // Check for duplicate category mentors assigned to the same team in the same slot
  const teamSlotAssignments = new Map<string, string[]>();
  for (const a of assignments) {
    const pk = `${a.slotId}|${a.teamId}`;
    if (!teamSlotAssignments.has(pk)) teamSlotAssignments.set(pk, []);
    teamSlotAssignments.get(pk)!.push(a.mentorId);
  }
  for (const [pk, mIds] of teamSlotAssignments) {
    if (mIds.length > 1) {
      const [, teamId] = pk.split("|");
      const t = teams.get(teamId);
      if (!t) continue;
      const assignedMentors = mIds.map((id) => mentors.get(id)).filter(Boolean) as typeof input.mentors;
      if (!canCoverDistinctCategories(assignedMentors, t)) {
        issues.push({
          type: "category_collision",
          severity: "warning",
          teamId: t.id,
          message: `${t.name} has multiple mentors (${assignedMentors.map((m) => m.name).join(", ")}) covering the same category in the same session.`,
        });
      }
    }
  }
  return issues;
}

/** Helper to determine if assigned mentors can each cover a distinct category of the team */
function canCoverDistinctCategories(assignedMentors: { categories: string[] }[], t: { categories: string[] }): boolean {
  const cats = t.categories;
  const n = assignedMentors.length;
  if (n > cats.length) return false;

  const match = new Map<number, number>(); // catIndex -> mentorIndex
  const mentorCats = assignedMentors.map((m) =>
    cats.map((c, idx) => (m.categories.includes(c) ? idx : -1)).filter((idx) => idx !== -1)
  );

  function dfs(u: number, visited: Set<number>): boolean {
    for (const v of mentorCats[u]) {
      if (visited.has(v)) continue;
      visited.add(v);
      const cur = match.get(v);
      if (cur === undefined || dfs(cur, visited)) {
        match.set(v, u);
        return true;
      }
    }
    return false;
  }

  for (let i = 0; i < n; i++) {
    if (!dfs(i, new Set<number>())) {
      return false;
    }
  }
  return true;
}

export function buildReport(
  input: ScheduleInput,
  assignments: Assignment[],
  droppedFixed: Assignment[] = [],
): { metrics: Metrics; issues: Issue[] } {
  const issues: Issue[] = [];
  const rounds = input.mode === "simultaneous" ? Math.max(1, input.maxSimultaneous ?? 2) : 1;
  const mentors = input.mentors.filter((m) => m.active);
  const teams = input.teams.filter((t) => t.active);
  const slotIds = input.slots.map((s) => s.id);

  const mentorLoad: Record<string, number> = Object.fromEntries(mentors.map((m) => [m.id, 0]));
  const teamLoad: Record<string, number> = Object.fromEntries(teams.map((t) => [t.id, 0]));
  const met = new Map<string, Set<string>>(teams.map((t) => [t.id, new Set()]));
  for (const a of assignments) {
    if (a.mentorId in mentorLoad) mentorLoad[a.mentorId]++;
    if (a.teamId in teamLoad) teamLoad[a.teamId]++;
    met.get(a.teamId)?.add(a.mentorId);
  }

  const teamUniqueMentors: Record<string, number> = {};
  const teamEligibleMentors: Record<string, number> = {};
  const categoryCoverage: Metrics["categoryCoverage"] = {};
  let covSum = 0;
  let covN = 0;

  for (const t of teams) {
    const elig = mentors.filter((m) => isEligible(m, t));
    const metSet = met.get(t.id)!;
    teamUniqueMentors[t.id] = metSet.size;
    teamEligibleMentors[t.id] = elig.length;
    categoryCoverage[t.id] = {};
    for (const c of t.categories) {
      const e = elig.filter((m) => m.categories.includes(c));
      categoryCoverage[t.id][c] = { met: e.filter((m) => metSet.has(m.id)).length, eligible: e.length };
    }
    if (elig.length) {
      covSum += metSet.size / elig.length;
      covN++;
    }

    const tSlots = slotIds.filter((s) => !t.unavailable?.includes(s));
    if (elig.length === 0) {
      issues.push({ type: "category_mismatch", severity: "error", teamId: t.id, message: `${t.name}: no active mentor covers its categories (${t.categories.join(", ") || "none"}).` });
      issues.push({ type: "unassigned_team", severity: "error", teamId: t.id, message: `${t.name} has no assignments (category mismatch).` });
      continue;
    }
    if (teamLoad[t.id] === 0) {
      issues.push({ type: "unassigned_team", severity: "error", teamId: t.id, message: `${t.name} has no assignments${tSlots.length === 0 ? " (team unavailable for every slot)" : ""}.` });
    }
    const teamRounds = input.mode === "simultaneous" ? Math.max(rounds, t.categories.length || 1) : 1;
    if (elig.length > tSlots.length * teamRounds) {
      issues.push({ type: "insufficient_slots", severity: "warning", teamId: t.id, message: `${t.name}: ${elig.length} eligible mentors but only ${tSlots.length} available slot(s)${teamRounds > 1 ? ` × ${teamRounds} simultaneous` : ""}.` });
    }
    const missing = elig.filter((m) => !metSet.has(m.id));
    if (missing.length && teamLoad[t.id] > 0) {
      const noOverlap = missing.filter((m) => !tSlots.some((s) => !m.unavailable?.includes(s)));
      if (noOverlap.length)
        issues.push({ type: "insufficient_mentor_availability", severity: "warning", teamId: t.id, message: `${t.name}: ${noOverlap.map((m) => m.name).join(", ")} never available when the team is.` });
      const rest = missing.filter((m) => !noOverlap.includes(m));
      if (rest.length)
        issues.push({ type: "incomplete_coverage", severity: "warning", teamId: t.id, message: `${t.name} did not meet ${rest.length} eligible mentor(s): ${rest.map((m) => m.name).join(", ")}${elig.length > tSlots.length * teamRounds ? " (not enough slots)" : " (slot competition with other teams)"}.` });
    }
  }

  // mentors
  const loadable: number[] = [];
  for (const m of mentors) {
    const hasTeam = teams.some((t) => isEligible(m, t));
    const free = slotIds.filter((s) => !m.unavailable?.includes(s));
    if (hasTeam && free.length) loadable.push(mentorLoad[m.id]);
    if (mentorLoad[m.id] === 0) {
      const why = !hasTeam
        ? "no active team selects its categories"
        : free.length === 0
          ? "absent for every slot"
          : "more mentors than teams in each slot";
      issues.push({ type: "idle_mentor", severity: !hasTeam || free.length === 0 ? "info" : "warning", mentorId: m.id, message: `${m.name} has no assignments: ${why}.` });
    }
  }
  const spread = loadable.length ? Math.max(...loadable) - Math.min(...loadable) : 0;
  if (spread > 1) {
    const hi = mentors.reduce((a, b) => (mentorLoad[a.id] >= mentorLoad[b.id] ? a : b));
    const lo = mentors.filter((m) => teams.some((t) => isEligible(m, t))).reduce((a, b) => (mentorLoad[a.id] <= mentorLoad[b.id] ? a : b));
    issues.push({ type: "unequal_workload", severity: "warning", message: `Mentor workload spread is ${spread} (${hi.name}: ${mentorLoad[hi.id]}, ${lo.name}: ${mentorLoad[lo.id]}). Usually caused by category sizes or absences.` });
  }

  for (const d of droppedFixed)
    issues.push({ type: "dropped_fixed_assignment", severity: "info", mentorId: d.mentorId, teamId: d.teamId, message: `Existing assignment could not be preserved (mentor/team unavailable, inactive or conflicting).` });

  return {
    metrics: {
      totalAssignments: assignments.length,
      mentorLoad,
      teamLoad,
      teamUniqueMentors,
      teamEligibleMentors,
      coverage: covN ? covSum / covN : 0,
      workloadSpread: spread,
      unassignedTeams: teams.length ? teams.filter((t) => teamLoad[t.id] === 0).length / teams.length : 0,
      categoryCoverage,
    },
    issues,
  };
}

/** Preview of what a regeneration changes. */
export function diffSchedules(before: Assignment[], after: Assignment[]): ScheduleDiff {
  const key = (a: Assignment) => `${a.slotId}|${a.mentorId}|${a.teamId}`;
  const b = new Set(before.map(key));
  const a = new Set(after.map(key));
  return {
    added: after.filter((x) => !b.has(key(x))),
    removed: before.filter((x) => !a.has(key(x))),
    unchanged: after.filter((x) => b.has(key(x))).length,
  };
}
