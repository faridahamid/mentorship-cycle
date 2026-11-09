import { hungarian } from "./hungarian";
import { buildReport, validateAssignments } from "./report";
import { compareLocations, isEligible, locationDistance } from "./util";
import type {
  Assignment,
  MentorInput,
  ScheduleInput,
  ScheduleResult,
  TeamInput,
  Weights,
} from "./types";

export const DEFAULT_WEIGHTS: Weights = {
  base: 100000, // keeps every eligible pair positive so the matching maximises coverage of mentors first
  newPair: 300,
  repeatPair: 250,
  categoryNeed: 100,
  urgency: 200,
  mentorLoad: 60,
  teamLoad: 50,
  distance: 12,
  sameCategoryInSlot: 40,
};

const FORBIDDEN = 1e12;

export { compareLocations, isEligible, locationDistance };

const key = (m: string, t: string) => `${m}|${t}`;

/**
 * Modern rotation distribution scheduler:
 * In each rotation slot, a mentor can hold multiple teams (up to maxTeamsPerMentor / quota).
 * Teams within the same category are clustered by geographic proximity (Building -> Floor -> Section).
 * Mentors cyclically shift across slots so teams meet diverse mentors while mentors travel minimal distances.
 * Multi-round Hungarian matching ensures optimal global coverage, category fairness, and load balancing.
 */
export function generateSchedule(input: ScheduleInput): ScheduleResult {
  const W: Weights = { ...DEFAULT_WEIGHTS, ...input.weights };
  const slots = [...input.slots].sort((a, b) => a.index - b.index);
  const mentors = input.mentors.filter((m) => m.active);
  const teams = input.teams.filter((t) => t.active);
  const rounds = input.mode === "simultaneous" ? Math.max(1, input.maxSimultaneous ?? 2) : 1;

  const mUnavail = new Map(mentors.map((m) => [m.id, new Set(m.unavailable ?? [])]));
  const tUnavail = new Map(teams.map((t) => [t.id, new Set(t.unavailable ?? [])]));
  const mentorById = new Map(mentors.map((m) => [m.id, m]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const eligibleMentors = new Map<string, MentorInput[]>(
    teams.map((t) => [t.id, mentors.filter((m) => isEligible(m, t))]),
  );
  const eligibleByTeamCat = new Map<string, Map<string, number>>();
  for (const t of teams) {
    const c = new Map<string, number>();
    for (const cat of t.categories)
      c.set(cat, eligibleMentors.get(t.id)!.filter((m) => m.categories.includes(cat)).length);
    eligibleByTeamCat.set(t.id, c);
  }

  // Calculate per-category demand and supply to ensure mentors in high-demand fields
  // are allocated adequate capacity to mentor every team each session.
  const catTeams = new Map<string, number>();
  const catMentors = new Map<string, number>();
  for (const t of teams) {
    for (const c of t.categories) catTeams.set(c, (catTeams.get(c) ?? 0) + 1);
  }
  for (const m of mentors) {
    for (const c of m.categories) catMentors.set(c, (catMentors.get(c) ?? 0) + 1);
  }

  const getTeamRounds = (t: TeamInput) =>
    input.mode === "simultaneous" ? Math.max(rounds, t.categories.length || 1) : 1;

  const mentorQuota = new Map<string, number>();
  if (input.mode === "simultaneous") {
    const totalSimultaneousNeeds = teams.reduce((acc, t) => acc + getTeamRounds(t), 0);
    const globalMentorQuota = Math.max(1, Math.ceil(totalSimultaneousNeeds / Math.max(1, mentors.length)));
    for (const m of mentors) {
      let quota = input.maxTeamsPerMentor ?? 1;
      for (const c of m.categories) {
        const tc = catTeams.get(c) ?? 0;
        const mc = catMentors.get(c) ?? 1;
        const catReq = Math.ceil(tc / Math.max(1, mc));
        if (catReq > quota) quota = catReq;
      }
      quota = Math.max(quota, globalMentorQuota);
      mentorQuota.set(m.id, quota);
    }
  } else {
    const defaultQuota = input.maxTeamsPerMentor ?? (
      input.slots.length * mentors.length < teams.length
        ? Math.max(1, Math.ceil(teams.length / Math.max(1, mentors.length)))
        : 1
    );
    for (const m of mentors) {
      mentorQuota.set(m.id, defaultQuota);
    }
  }

  // ── state ──
  const mentorLoad = new Map(mentors.map((m) => [m.id, 0]));
  const teamLoad = new Map(teams.map((t) => [t.id, 0]));
  const pairCount = new Map<string, number>();
  const metPerCat = new Map<string, Map<string, Set<string>>>(
    teams.map((t) => [t.id, new Map(t.categories.map((c) => [c, new Set<string>()]))]),
  );
  const out: Assignment[] = [];
  const droppedFixed: Assignment[] = [];

  const record = (a: Assignment) => {
    out.push(a);
    mentorLoad.set(a.mentorId, (mentorLoad.get(a.mentorId) ?? 0) + 1);
    teamLoad.set(a.teamId, (teamLoad.get(a.teamId) ?? 0) + 1);
    pairCount.set(key(a.mentorId, a.teamId), (pairCount.get(key(a.mentorId, a.teamId)) ?? 0) + 1);
    const m = mentorById.get(a.mentorId)!;
    const t = teamById.get(a.teamId)!;
    for (const c of t.categories) if (m.categories.includes(c)) metPerCat.get(t.id)!.get(c)!.add(m.id);
  };

  // Fixed assignments grouped by slot; counted up-front so load-balancing sees them
  const fixedBySlot = new Map<string, Assignment[]>();
  const slotIds = new Set(slots.map((s) => s.id));
  for (const f of input.fixed ?? []) {
    const m = mentorById.get(f.mentorId);
    const t = teamById.get(f.teamId);
    if (!m || !t || !slotIds.has(f.slotId) || mUnavail.get(m.id)!.has(f.slotId) || tUnavail.get(t.id)!.has(f.slotId)) {
      droppedFixed.push(f);
      continue;
    }
    if (!fixedBySlot.has(f.slotId)) fixedBySlot.set(f.slotId, []);
    fixedBySlot.get(f.slotId)!.push(f);
  }

  // Accept fixed rows, rejecting those that would overbook inside the same slot
  const accepted: Assignment[] = [];
  for (const [slotId, list] of fixedBySlot) {
    const mTeams = new Map<string, Set<string>>();
    const tCount = new Map<string, number>();
    for (const f of list) {
      const t = teamById.get(f.teamId);
      const teamMax = t ? getTeamRounds(t) : rounds;
      if ((tCount.get(f.teamId) ?? 0) >= teamMax) {
        droppedFixed.push(f);
        continue;
      }
      if (!mTeams.has(f.mentorId)) mTeams.set(f.mentorId, new Set());
      if (mTeams.get(f.mentorId)!.has(f.teamId)) {
        droppedFixed.push(f);
        continue;
      }
      mTeams.get(f.mentorId)!.add(f.teamId);
      tCount.set(f.teamId, (tCount.get(f.teamId) ?? 0) + 1);
      accepted.push({ ...f, slotId });
    }
  }
  for (const f of accepted) record(f);
  const acceptedBySlot = new Map<string, Assignment[]>();
  for (const f of accepted) {
    if (!acceptedBySlot.has(f.slotId)) acceptedBySlot.set(f.slotId, []);
    acceptedBySlot.get(f.slotId)!.push(f);
  }

  const minOf = (m: Map<string, number>) => (m.size ? Math.min(...m.values()) : 0);

  let prevSlotTeamsOfMentor = new Map<string, Set<string>>();

  // ── main loop across chronological rotation slots ──
  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si];
    const slotMentorsOfTeam = new Map<string, string[]>();
    const slotTeamsOfMentor = new Map<string, string[]>();
    const slotCoveredCatsOfTeam = new Map<string, Set<string>>(
      teams.map((t) => [t.id, new Set<string>()])
    );

    for (const f of acceptedBySlot.get(slot.id) ?? []) {
      if (!slotMentorsOfTeam.has(f.teamId)) slotMentorsOfTeam.set(f.teamId, []);
      slotMentorsOfTeam.get(f.teamId)!.push(f.mentorId);
      if (!slotTeamsOfMentor.has(f.mentorId)) slotTeamsOfMentor.set(f.mentorId, []);
      slotTeamsOfMentor.get(f.mentorId)!.push(f.teamId);

      const m = mentorById.get(f.mentorId);
      const t = teamById.get(f.teamId);
      if (m && t) {
        const covered = slotCoveredCatsOfTeam.get(t.id)!;
        const uncovered = m.categories.filter((c) => t.categories.includes(c) && !covered.has(c));
        if (uncovered.length > 0) {
          const chosen = uncovered.reduce((best, c) => ((catMentors.get(c) ?? 1) < (catMentors.get(best) ?? 1) ? c : best), uncovered[0]);
          covered.add(chosen);
        } else {
          const anyShared = m.categories.find((c) => t.categories.includes(c));
          if (anyShared) covered.add(anyShared);
        }
      }
    }
    const slotsLeftAfter = slots.length - si;

    const recordSlotMatch = (m: MentorInput, t: TeamInput) => {
      record({ slotId: slot.id, mentorId: m.id, teamId: t.id });
      if (!slotMentorsOfTeam.has(t.id)) slotMentorsOfTeam.set(t.id, []);
      slotMentorsOfTeam.get(t.id)!.push(m.id);
      if (!slotTeamsOfMentor.has(m.id)) slotTeamsOfMentor.set(m.id, []);
      slotTeamsOfMentor.get(m.id)!.push(t.id);

      const covered = slotCoveredCatsOfTeam.get(t.id)!;
      const uncoveredShared = m.categories.filter((c) => t.categories.includes(c) && !covered.has(c));
      if (uncoveredShared.length > 0) {
        const chosen = uncoveredShared.reduce((best, c) => ((catMentors.get(c) ?? 1) < (catMentors.get(best) ?? 1) ? c : best), uncoveredShared[0]);
        covered.add(chosen);
      } else {
        const anyShared = m.categories.find((c) => t.categories.includes(c));
        if (anyShared) covered.add(anyShared);
      }
    };

    // Balanced multi-pass matching:
    // In each pass, we match mentors under quota with teams under rounds.
    // We prioritize lowest-loaded mentors and lowest-loaded teams in this slot to maintain fairness.
    while (true) {
      const availMentors = mentors.filter(
        (m) => !mUnavail.get(m.id)!.has(slot.id) &&
               (slotTeamsOfMentor.get(m.id)?.length ?? 0) < (mentorQuota.get(m.id) ?? 1)
      );
      const availTeams = teams.filter((t) => {
        if (tUnavail.get(t.id)!.has(slot.id)) return false;
        const currentCount = slotMentorsOfTeam.get(t.id)?.length ?? 0;
        const target = getTeamRounds(t);
        if (currentCount >= target) return false;
        if (t.categories.length > 0) {
          const covered = slotCoveredCatsOfTeam.get(t.id)!;
          return covered.size < t.categories.length;
        }
        return true;
      });
      if (!availMentors.length || !availTeams.length) break;

      const minMLoad = Math.min(...availMentors.map((m) => slotTeamsOfMentor.get(m.id)?.length ?? 0));
      const minTLoad = Math.min(...availTeams.map((t) => slotMentorsOfTeam.get(t.id)?.length ?? 0));

      const freeMentors = availMentors.filter((m) => (slotTeamsOfMentor.get(m.id)?.length ?? 0) <= minMLoad);
      const freeTeams = availTeams.filter((t) => (slotMentorsOfTeam.get(t.id)?.length ?? 0) <= minTLoad);

      const buildCost = (ms: MentorInput[], ts: TeamInput[]) =>
        ms.map((m) =>
          ts.map((t) => {
            if (!isEligible(m, t)) return FORBIDDEN;
            // Never assign the same team to the same mentor twice in the same slot
            if (slotTeamsOfMentor.get(m.id)?.includes(t.id)) return FORBIDDEN;

            // In simultaneous mode, a mentor must cover an UNCOVERED category for this team in this slot
            const covered = slotCoveredCatsOfTeam.get(t.id) ?? new Set();
            if (t.categories.length > 0) {
              const uncoveredShared = m.categories.filter((c) => t.categories.includes(c) && !covered.has(c));
              if (uncoveredShared.length === 0) return FORBIDDEN;
            }

            const k = key(m.id, t.id);
            const pc = pairCount.get(k) ?? 0;
            let w = W.base;

            if (pc === 0) {
              w += W.newPair;
              // Category need: favour the shared category that is least covered so far
              let need = 0;
              for (const c of t.categories) {
                if (!m.categories.includes(c)) continue;
                const elig = eligibleByTeamCat.get(t.id)!.get(c) || 1;
                const met = metPerCat.get(t.id)!.get(c)!.size;
                need = Math.max(need, 1 - met / elig);
              }
              w += W.categoryNeed * need;

              // Urgency: unmet eligible mentors vs. remaining opportunities
              const unmet = eligibleMentors.get(t.id)!.filter((e) => !(pairCount.get(key(e.id, t.id)) ?? 0)).length;
              w += W.urgency * Math.min(1, unmet / Math.max(1, slotsLeftAfter * getTeamRounds(t)));
            } else {
              // Penalty for repeat pairings enforces cyclic rotation across slots!
              w -= W.repeatPair * pc;
            }

            // Consecutive session avoidance:
            // Teams should not have the same mentor session after session.
            // When peers exist in the same category, swap teams between them.
            if (prevSlotTeamsOfMentor.get(m.id)?.has(t.id)) {
              const candidateShared = m.categories.filter((c) => t.categories.includes(c));
              const hasAlternativeMentors = candidateShared.some((c) => {
                const count = eligibleByTeamCat.get(t.id)?.get(c) ?? 1;
                return count > 1;
              });
              if (hasAlternativeMentors) {
                // If peers exist in this category, prioritize swapping mentors
                w -= 60000;
              } else {
                // Single mentor in this category: rotate through other teams first
                w -= 8000;
              }
            }

            // Workload balancing
            w -= W.mentorLoad * ((mentorLoad.get(m.id) ?? 0) - minOf(mentorLoad));
            w -= W.teamLoad * ((teamLoad.get(t.id) ?? 0) - minOf(teamLoad));

            // Geographic clustering & location proximity:
            const existingTeamsInSlot = slotTeamsOfMentor.get(m.id) ?? [];
            if (existingTeamsInSlot.length === 0) {
              // First team for this mentor: measure distance to mentor's home station
              if (m.location && t.location) {
                const sameFloor = m.location.floor !== undefined && t.location.floor !== undefined && m.location.floor === t.location.floor;
                const sameBuilding = (m.location.building ?? "").trim().toLowerCase() === (t.location.building ?? "").trim().toLowerCase();
                if (sameBuilding && sameFloor) {
                  // High priority bonus for serving teams on mentor's assigned floor station!
                  w += 160;
                }
              }
              w -= W.distance * locationDistance(m.location, t.location);
            } else {
              // Subsequent teams: measure distance to the mentor's assigned cluster in this rotation
              const clusterDists = existingTeamsInSlot.map((tid) => {
                const assignedTeam = teamById.get(tid);
                return locationDistance(assignedTeam?.location, t.location);
              });
              const minDistToCluster = Math.min(...clusterDists);
              w -= (W.distance * 3) * minDistToCluster;
            }

            // Deterministic tie-break
            w += ((hash(m.id + t.id + slot.id) % 1000) / 1000) * 0.5;
            return -w;
          })
        );

      let cost = buildCost(freeMentors, freeTeams);
      let match = hungarian(cost);
      let matchedCount = 0;
      freeMentors.forEach((m, i) => {
        const j = match[i];
        if (j < 0 || cost[i][j] >= FORBIDDEN / 2) return;
        const t = freeTeams[j];
        matchedCount++;
        recordSlotMatch(m, t);
      });

      if (matchedCount === 0) {
        // Fallback: relax load filter to all available mentors and teams in this slot
        cost = buildCost(availMentors, availTeams);
        match = hungarian(cost);
        let relaxedMatched = 0;
        availMentors.forEach((m, i) => {
          const j = match[i];
          if (j < 0 || cost[i][j] >= FORBIDDEN / 2) return;
          const t = availTeams[j];
          relaxedMatched++;
          recordSlotMatch(m, t);
        });
        if (relaxedMatched === 0) break;
      }
    }

    prevSlotTeamsOfMentor = new Map();
    for (const [mId, tList] of slotTeamsOfMentor.entries()) {
      prevSlotTeamsOfMentor.set(mId, new Set(tList));
    }
  }

  const issues = validateAssignments(input, out);
  const report = buildReport(input, out, droppedFixed);
  return { assignments: out, issues: [...issues, ...report.issues], metrics: report.metrics };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
