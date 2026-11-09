import { describe, expect, it } from "vitest";
import { generateSchedule, redistribute, validateAssignments } from "./index";
import { hungarian } from "./hungarian";
import { makeSlots, realisticCycle } from "./sample";
import type { MentorInput, ScheduleInput, TeamInput } from "./types";

const mentor = (id: string, cats: string[], extra: Partial<MentorInput> = {}): MentorInput => ({ id, name: id, categories: cats, active: true, ...extra });
const team = (id: string, cats: string[], extra: Partial<TeamInput> = {}): TeamInput => ({ id, name: id, categories: cats, active: true, ...extra });

describe("hungarian", () => {
  it("solves a rectangular min-cost assignment", () => {
    expect(hungarian([[1, 9, 9], [9, 1, 9]])).toEqual([0, 1]);
    const m = hungarian([[1, 9], [9, 1], [5, 5]]);
    expect(m[0]).toBe(0);
    expect(m[1]).toBe(1);
    expect(m[2]).toBe(-1);
  });
});

describe("spec example: 4 AI mentors, 1 AI team", () => {
  it("team rotates through all four mentors", () => {
    const input: ScheduleInput = { slots: makeSlots(4), mentors: ["a", "b", "c", "d"].map((i) => mentor(i, ["AI"])), teams: [team("t", ["AI"])], mode: "sequential" };
    const r = generateSchedule(input);
    expect(new Set(r.assignments.map((a) => a.mentorId)).size).toBe(4);
    expect(r.metrics.coverage).toBe(1);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("realistic sequential cycle", () => {
  const input = realisticCycle();
  const r = generateSchedule(input);
  it("has no overbooking or availability errors", () => {
    expect(validateAssignments(input, r.assignments)).toEqual([]);
  });
  it("assigns every team and never mismatches categories", () => {
    expect(r.metrics.unassignedTeams).toBe(0);
    for (const a of r.assignments) {
      const m = input.mentors.find((x) => x.id === a.mentorId)!;
      const t = input.teams.find((x) => x.id === a.teamId)!;
      expect(m.categories.some((c) => t.categories.includes(c))).toBe(true);
    }
  });
  it("keeps all mentors busy and balanced", () => {
    for (const m of input.mentors) expect(r.metrics.mentorLoad[m.id]).toBeGreaterThan(0);
    expect(r.metrics.workloadSpread).toBeLessThanOrEqual(2);
  });
  it("gives high mentor exposure", () => {
    expect(r.metrics.coverage).toBeGreaterThan(0.85);
  });
  it("covers every selected category for multi-category teams", () => {
    for (const t of input.teams) {
      for (const c of t.categories) expect(r.metrics.categoryCoverage[t.id][c].met).toBeGreaterThan(0);
    }
  });
  it("is deterministic", () => {
    expect(generateSchedule(input).assignments).toEqual(r.assignments);
  });
});

describe("simultaneous mode", () => {
  const input = realisticCycle({ mode: "simultaneous", slots: 6, teams: 4 });
  const r = generateSchedule(input);
  it("may place 2 mentors with a team in a slot, without overbooking or category collisions", () => {
    expect(validateAssignments(input, r.assignments)).toEqual([]);
    const per = new Map<string, number>();
    for (const a of r.assignments) per.set(a.slotId + a.teamId, (per.get(a.slotId + a.teamId) ?? 0) + 1);
    expect(Math.max(...per.values())).toBe(2);
  });
  it("never assigns two mentors of the same category to a team in the same slot", () => {
    const mById = new Map(input.mentors.map((m) => [m.id, m]));
    const tById = new Map(input.teams.map((t) => [t.id, t]));
    const slotTeams = new Map<string, string[]>();
    for (const a of r.assignments) {
      const k = `${a.slotId}|${a.teamId}`;
      if (!slotTeams.has(k)) slotTeams.set(k, []);
      slotTeams.get(k)!.push(a.mentorId);
    }
    for (const [k, mIds] of slotTeams) {
      if (mIds.length > 1) {
        const [, teamId] = k.split("|");
        const t = tById.get(teamId)!;
        const m1 = mById.get(mIds[0])!;
        const m2 = mById.get(mIds[1])!;
        const shared = m1.categories.filter((c) => m2.categories.includes(c) && t.categories.includes(c));
        expect(shared).toEqual([]);
      }
    }
  });
  it("gives more mentors per team than sequential in the same slots", () => {
    const seq = generateSchedule(realisticCycle({ mode: "sequential", slots: 2, teams: 4 }));
    expect(r.metrics.coverage).toBeGreaterThan(seq.metrics.coverage);
  });
  it("assigns distinct mentors covering all fields of multi-field teams in every session", () => {
    const mAI = mentor("mAI", ["AI"]);
    const mWeb = mentor("mWeb", ["Web"]);
    const tMulti = team("t1", ["AI", "Web"]);
    const testSlots = makeSlots(3);

    const testInput: ScheduleInput = {
      slots: testSlots,
      mentors: [mAI, mWeb],
      teams: [tMulti],
      mode: "simultaneous",
      maxSimultaneous: 2,
    };
    const res = generateSchedule(testInput);
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);

    for (const s of testSlots) {
      const assigned = res.assignments.filter((a) => a.slotId === s.id && a.teamId === tMulti.id);
      expect(assigned.length).toBe(2);
      const mentorIds = assigned.map((a) => a.mentorId).sort();
      expect(mentorIds).toEqual(["mAI", "mWeb"]);
    }
  });
  it("allows mentors with overlapping categories to co-mentor multi-category teams", () => {
    const m1 = mentor("m1", ["AI", "Web"]);
    const m2 = mentor("m2", ["AI", "Web"]);
    const t = team("t1", ["AI", "Web"]);
    const testSlots = makeSlots(1);

    const testInput: ScheduleInput = {
      slots: testSlots,
      mentors: [m1, m2],
      teams: [t],
      mode: "simultaneous",
      maxSimultaneous: 2,
    };
    const res = generateSchedule(testInput);
    expect(res.issues.filter((i) => i.type === "category_collision")).toEqual([]);
    const assigned = res.assignments.filter((a) => a.slotId === testSlots[0].id && a.teamId === t.id);
    expect(assigned.length).toBe(2);
  });
  it("scales to 3 distinct field mentors when team has 3 fields in simultaneous mode", () => {
    const mAI = mentor("mAI", ["AI"]);
    const mWeb = mentor("mWeb", ["Web"]);
    const m3D = mentor("m3D", ["3D"]);
    const t3 = team("t3", ["AI", "Web", "3D"]);
    const testSlots = makeSlots(2);

    const testInput: ScheduleInput = {
      slots: testSlots,
      mentors: [mAI, mWeb, m3D],
      teams: [t3],
      mode: "simultaneous",
      maxSimultaneous: 2, // team has 3 categories, should dynamically adapt
    };
    const res = generateSchedule(testInput);
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
    for (const s of testSlots) {
      const assigned = res.assignments.filter((a) => a.slotId === s.id && a.teamId === t3.id);
      expect(assigned.length).toBe(3);
    }
  });
});

describe("constraints and reporting", () => {
  it("reports category mismatch and insufficient slots instead of failing silently", () => {
    const input: ScheduleInput = { slots: makeSlots(2), mentors: ["a", "b", "c"].map((i) => mentor(i, ["AI"])), teams: [team("t", ["AI"]), team("x", ["GIS"])], mode: "sequential" };
    const r = generateSchedule(input);
    const types = r.issues.map((i) => i.type);
    expect(types).toContain("category_mismatch");
    expect(types).toContain("insufficient_slots");
    expect(types).toContain("unassigned_team");
  });
  it("respects mentor absence", () => {
    const input = realisticCycle();
    input.mentors[0].unavailable = ["s1", "s2", "s3"];
    const r = generateSchedule(input);
    expect(r.assignments.filter((a) => a.mentorId === "m1" && ["s1", "s2", "s3"].includes(a.slotId))).toEqual([]);
  });
  it("respects team absence", () => {
    const input = realisticCycle();
    input.teams[0].unavailable = ["s1", "s2"];
    const r = generateSchedule(input);
    expect(r.assignments.filter((a) => a.teamId === "t1" && ["s1", "s2"].includes(a.slotId))).toEqual([]);
  });
  it("prefers nearby mentors when everything else is equal", () => {
    const near = { building: "A", floor: 1 };
    const far = { building: "B", floor: 5 };
    const input: ScheduleInput = { slots: makeSlots(1), mentors: [mentor("far", ["AI"], { location: far }), mentor("near", ["AI"], { location: near })], teams: [team("t", ["AI"], { location: near })], mode: "sequential" };
    expect(generateSchedule(input).assignments[0].mentorId).toBe("near");
  });
  it("allows repeats only when needed to keep mentors busy", () => {
    const input: ScheduleInput = { slots: makeSlots(3), mentors: [mentor("a", ["AI"])], teams: [team("t", ["AI"])], mode: "sequential" };
    expect(generateSchedule(input).assignments.length).toBe(3);
  });
});

describe("redistribution preserves schedule", () => {
  it("keeps untouched assignments when a mentor becomes absent", () => {
    const input = realisticCycle();
    const base = generateSchedule(input);
    const changed: ScheduleInput = { ...input, mentors: input.mentors.map((m) => (m.id === "m3" ? { ...m, unavailable: ["s4", "s5"] } : m)) };
    const { result, diff } = redistribute(changed, base.assignments);
    expect(validateAssignments(changed, result.assignments)).toEqual([]);
    const affected = base.assignments.filter((a) => a.mentorId === "m3" && ["s4", "s5"].includes(a.slotId)).length;
    expect(diff.removed.length).toBe(affected);
    expect(diff.unchanged).toBe(base.assignments.length - affected);
    expect(result.assignments.filter((a) => a.mentorId === "m3" && ["s4", "s5"].includes(a.slotId))).toEqual([]);
  });
  it("drops and reports assignments of removed teams", () => {
    const input = realisticCycle();
    const base = generateSchedule(input);
    const changed: ScheduleInput = { ...input, teams: input.teams.map((t) => (t.id === "t2" ? { ...t, active: false } : t)) };
    const { result } = redistribute(changed, base.assignments);
    expect(result.assignments.some((a) => a.teamId === "t2")).toBe(false);
    expect(result.issues.some((i) => i.type === "dropped_fixed_assignment")).toBe(true);
  });
});

describe("scale", () => {
  it("handles 60 mentors, 150 teams, 30 slots quickly", () => {
    const input = realisticCycle({ mentors: 60, teams: 150, slots: 30 });
    const t0 = Date.now();
    const r = generateSchedule(input);
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(validateAssignments(input, r.assignments)).toEqual([]);
  });
});

describe("multi-team rotational distribution with geographic clustering (legacy algorithm modernized)", () => {
  it("assigns multiple teams per mentor in the same rotation slot, clustered by proximity, and shifts cyclically", () => {
    const locB1 = { building: "B1", floor: 1, section: "West Hall" };
    const locB2 = { building: "B2", floor: 1, section: "East Hall" };

    const mentors = [
      mentor("mA", ["AI"], { location: locB1 }),
      mentor("mB", ["AI"], { location: locB2 }),
    ];

    const teams = [
      team("t1", ["AI"], { location: locB1 }),
      team("t2", ["AI"], { location: locB1 }),
      team("t3", ["AI"], { location: locB1 }),
      team("t4", ["AI"], { location: locB2 }),
      team("t5", ["AI"], { location: locB2 }),
      team("t6", ["AI"], { location: locB2 }),
    ];

    const input: ScheduleInput = {
      slots: makeSlots(2), // 2 rotation slots
      mentors,
      teams,
      mode: "sequential",
      maxTeamsPerMentor: 3, // Each mentor holds 3 teams per rotation
    };

    const res = generateSchedule(input);
    expect(validateAssignments(input, res.assignments)).toEqual([]);

    // Check Slot 1 (Rotation 1)
    const s1A = res.assignments.filter((a) => a.slotId === "s1" && a.mentorId === "mA").map((a) => a.teamId);
    const s1B = res.assignments.filter((a) => a.slotId === "s1" && a.mentorId === "mB").map((a) => a.teamId);

    // Mentor mA gets the 3 teams clustered in Building 1
    expect(s1A.sort()).toEqual(["t1", "t2", "t3"]);
    // Mentor mB gets the 3 teams clustered in Building 2
    expect(s1B.sort()).toEqual(["t4", "t5", "t6"]);

    // Check Slot 2 (Rotation 2) - Mentors cyclically rotate to the other cluster!
    const s2A = res.assignments.filter((a) => a.slotId === "s2" && a.mentorId === "mA").map((a) => a.teamId);
    const s2B = res.assignments.filter((a) => a.slotId === "s2" && a.mentorId === "mB").map((a) => a.teamId);

    expect(s2A.sort()).toEqual(["t4", "t5", "t6"]);
    expect(s2B.sort()).toEqual(["t1", "t2", "t3"]);

    // In 2 rotations, all teams met both mentors with 100% coverage
    expect(res.metrics.coverage).toBe(1);
    expect(res.metrics.unassignedTeams).toBe(0);
  });

  it("prioritizes mentor's assigned floor station over other floors", () => {
    const fl1 = { building: "Main", floor: 1, section: "Zone A" };
    const fl2 = { building: "Main", floor: 2, section: "Zone B" };

    const mFloor1 = mentor("m1", ["AI"], { location: fl1 });
    const mFloor2 = mentor("m2", ["AI"], { location: fl2 });

    const tFloor1 = team("t1", ["AI"], { location: fl1 });
    const tFloor2 = team("t2", ["AI"], { location: fl2 });

    const input: ScheduleInput = {
      slots: makeSlots(1),
      mentors: [mFloor1, mFloor2],
      teams: [tFloor1, tFloor2],
      mode: "sequential",
    };

    const res = generateSchedule(input);
    expect(validateAssignments(input, res.assignments)).toEqual([]);

    const asg1 = res.assignments.find((a) => a.mentorId === "m1");
    const asg2 = res.assignments.find((a) => a.mentorId === "m2");

    // Mentor stationed on Floor 1 serves Floor 1 team; Mentor stationed on Floor 2 serves Floor 2 team
    expect(asg1?.teamId).toBe("t1");
    expect(asg2?.teamId).toBe("t2");
  });

  it("clusters multiple teams in the same rotation to the same zone", () => {
    const locZoneA1 = { building: "Main", floor: 1, section: "Zone A Room 1" };
    const locZoneA2 = { building: "Main", floor: 1, section: "Zone A Room 2" };
    const locZoneB = { building: "Main", floor: 1, section: "Zone B Room 10" };

    const m = mentor("m1", ["AI"], { location: locZoneA1 });
    const tA1 = team("tA1", ["AI"], { location: locZoneA1 });
    const tA2 = team("tA2", ["AI"], { location: locZoneA2 });
    const tB = team("tB", ["AI"], { location: locZoneB });

    const input: ScheduleInput = {
      slots: makeSlots(1),
      mentors: [m],
      teams: [tA1, tA2, tB],
      mode: "sequential",
      maxTeamsPerMentor: 2, // Mentor visits 2 teams in this rotation
    };

    const res = generateSchedule(input);
    const assignedTeams = res.assignments.map((a) => a.teamId);

    // Mentor stationed in Zone A takes the two teams in Zone A, leaving distant Zone B for another slot
    expect(assignedTeams.sort()).toEqual(["tA1", "tA2"]);
  });

  describe("consecutive back-to-back meeting avoidance", () => {
    it("swaps teams between mentors across consecutive sessions when multiple mentors exist", () => {
      const m1 = mentor("m1", ["AI"]);
      const m2 = mentor("m2", ["AI"]);
      const t1 = team("t1", ["AI"]);
      const t2 = team("t2", ["AI"]);
      const slots = makeSlots(2);

      const input: ScheduleInput = {
        slots,
        mentors: [m1, m2],
        teams: [t1, t2],
        mode: "sequential",
        maxTeamsPerMentor: 1,
      };

      const res = generateSchedule(input);
      const s0Asgs = res.assignments.filter((a) => a.slotId === slots[0].id);
      const s1Asgs = res.assignments.filter((a) => a.slotId === slots[1].id);

      const m1Slot0Team = s0Asgs.find((a) => a.mentorId === "m1")!.teamId;
      const m1Slot1Team = s1Asgs.find((a) => a.mentorId === "m1")!.teamId;

      // m1 meets a different team in slot 1 than in slot 0 (swapped!)
      expect(m1Slot0Team).not.toBe(m1Slot1Team);

      const m2Slot0Team = s0Asgs.find((a) => a.mentorId === "m2")!.teamId;
      const m2Slot1Team = s1Asgs.find((a) => a.mentorId === "m2")!.teamId;
      expect(m2Slot0Team).not.toBe(m2Slot1Team);
    });

    it("rotates teams across sessions when only one mentor exists", () => {
      const m1 = mentor("m1", ["General"]);
      const t1 = team("t1", ["General"]);
      const t2 = team("t2", ["General"]);
      const t3 = team("t3", ["General"]);
      const t4 = team("t4", ["General"]);
      const slots = makeSlots(2);

      const input: ScheduleInput = {
        slots,
        mentors: [m1],
        teams: [t1, t2, t3, t4],
        mode: "sequential",
        maxTeamsPerMentor: 2,
      };

      const res = generateSchedule(input);
      const s0Teams = res.assignments.filter((a) => a.slotId === slots[0].id).map((a) => a.teamId);
      const s1Teams = res.assignments.filter((a) => a.slotId === slots[1].id).map((a) => a.teamId);

      expect(s0Teams.length).toBe(2);
      expect(s1Teams.length).toBe(2);
      // No overlap between slot 0 and slot 1 teams
      const overlap = s0Teams.filter((id) => s1Teams.includes(id));
      expect(overlap).toEqual([]);
    });
  });
});
