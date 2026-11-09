import { generateSchedule } from "../src/lib/scheduler";
import { realisticCycle } from "../src/lib/scheduler/sample";

for (const mode of ["sequential", "simultaneous"] as const) {
  const input = realisticCycle({ mode });
  const r = generateSchedule(input);
  const loads = Object.values(r.metrics.mentorLoad);
  console.log(`\n== ${mode}: ${input.mentors.length} mentors, ${input.teams.length} teams, ${input.slots.length} slots`);
  console.log("assignments:", r.metrics.totalAssignments, "| coverage:", (r.metrics.coverage * 100).toFixed(1) + "%");
  console.log("mentor load min/max:", Math.min(...loads), Math.max(...loads), "| unassigned teams:", r.metrics.unassignedTeams);
  console.log("issues:", r.issues.length);
  for (const i of r.issues.slice(0, 8)) console.log(` - [${i.severity}] ${i.type}: ${i.message}`);
}

