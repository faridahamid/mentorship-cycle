import { generateSchedule } from "./engine";
import { diffSchedules } from "./report";
import type { Assignment, ScheduleInput, ScheduleResult } from "./types";

export * from "./types";
export { generateSchedule, locationDistance, isEligible, DEFAULT_WEIGHTS } from "./engine";
export { validateAssignments, buildReport, diffSchedules } from "./report";

/**
 * Recalculate after availability changed, keeping every still-valid existing assignment
 * (and only filling the gaps). Returns the new schedule plus a diff for the preview dialog.
 */
export function redistribute(input: ScheduleInput, existing: Assignment[]) {
  const result: ScheduleResult = generateSchedule({ ...input, fixed: existing });
  return { result, diff: diffSchedules(existing, result.assignments) };
}

