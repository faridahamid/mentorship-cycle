/** Pure, framework-free types for the scheduling engine. No DB or React imports allowed here. */

export type ScheduleMode = "sequential" | "simultaneous";

export interface Loc {
  building?: string;
  floor?: number;
  section?: string;
}

export interface SlotInput {
  id: string;
  /** Chronological order across the whole cycle. */
  index: number;
}

export interface MentorInput {
  id: string;
  name: string;
  categories: string[];
  location?: Loc;
  /** Set to false for mentors that are removed/inactive. */
  active: boolean;
  /** Slot ids where the mentor is absent or on break. */
  unavailable?: string[];
}

export interface TeamInput {
  id: string;
  name: string;
  categories: string[];
  location?: Loc;
  active: boolean;
  unavailable?: string[];
}

export interface Assignment {
  slotId: string;
  mentorId: string;
  teamId: string;
}

export interface Weights {
  base: number;
  newPair: number;
  repeatPair: number;
  categoryNeed: number;
  urgency: number;
  mentorLoad: number;
  teamLoad: number;
  distance: number;
  sameCategoryInSlot: number;
}

export interface ScheduleInput {
  slots: SlotInput[];
  mentors: MentorInput[];
  teams: TeamInput[];
  mode: ScheduleMode;
  /** Max mentors that may meet one team in the same slot (mode "simultaneous"). Default 2. */
  maxSimultaneous?: number;
  /** Max teams that may be assigned to one mentor in the same rotation slot. Default is dynamic quota ceil(T / M). */
  maxTeamsPerMentor?: number;
  /**
   * Assignments that must be kept (manual/locked ones, or the existing schedule when
   * redistributing). Invalid ones (absent mentor, etc.) are dropped and reported.
   */
  fixed?: Assignment[];
  weights?: Partial<Weights>;
}

export type IssueType =
  | "insufficient_slots"
  | "insufficient_mentor_availability"
  | "category_mismatch"
  | "category_collision"
  | "mentor_overbooked"
  | "team_overbooked"
  | "unassigned_team"
  | "idle_mentor"
  | "incomplete_coverage"
  | "unequal_workload"
  | "dropped_fixed_assignment"
  | "unavailable_assignment";

export interface Issue {
  type: IssueType;
  severity: "error" | "warning" | "info";
  message: string;
  teamId?: string;
  mentorId?: string;
}

export interface Metrics {
  totalAssignments: number;
  mentorLoad: Record<string, number>;
  teamLoad: Record<string, number>;
  /** team id -> number of unique mentors met */
  teamUniqueMentors: Record<string, number>;
  /** team id -> number of eligible mentors in the cycle */
  teamEligibleMentors: Record<string, number>;
  /** 0..1 average of unique/eligible across teams */
  coverage: number;
  /** max - min load across active mentors that had capacity to be assigned */
  workloadSpread: number;
  /** fraction of teams with zero assignments */
  unassignedTeams: number;
  /** per-team per-category unique mentors met */
  categoryCoverage: Record<string, Record<string, { met: number; eligible: number }>>;
}

export interface ScheduleResult {
  assignments: Assignment[];
  issues: Issue[];
  metrics: Metrics;
}

export interface ScheduleDiff {
  added: Assignment[];
  removed: Assignment[];
  unchanged: number;
}

