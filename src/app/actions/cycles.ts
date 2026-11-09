"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertRole, audit } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateTimeSlots, validateSlotConfig } from "@/lib/slots";
import { commitChangeService, previewChangeService } from "@/lib/change-service";
import { loadCycle } from "@/lib/cycle-data";
import { isEligible } from "@/lib/scheduler";
import { calculateAutoCycleQuotas, type Change } from "@/lib/cycle-model";

const time = z.string().regex(/^\d{2}:\d{2}/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CycleInput = z.object({
  name: z.string().trim().min(1).max(120),
  start_date: date, end_date: date, daily_start: time, daily_end: time,
  session_minutes: z.coerce.number().int().min(1).max(600),
  break_count: z.coerce.number().int().min(0).max(20),
  break_minutes: z.coerce.number().int().min(0).max(240),
  slot_count: z.coerce.number().int().min(1).max(500).nullable().optional(),
  mode: z.enum(["sequential", "simultaneous"]),
  max_simultaneous: z.coerce.number().int().min(1).max(6).default(2),
  max_teams_per_mentor: z.coerce.number().int().min(1).max(20).nullable().optional(),
  category_ids: z.array(z.string().uuid()).default([]),
  mentor_ids: z.array(z.string().uuid()).default([]),
  team_ids: z.array(z.string().uuid()).default([]),
});
export type CycleInputT = z.input<typeof CycleInput>;
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

async function snapshotMembers(cycleId: string, mentorIds: string[], teamIds: string[]) {
  const supabase = await createClient();
  if (mentorIds.length) {
    const { data: ms } = await supabase.from("mentors").select("id,full_name,location_id,mentor_categories(category_id)").in("id", mentorIds);
    const rows = (ms ?? []).map((m) => ({ cycle_id: cycleId, mentor_id: m.id, mentor_name: m.full_name, location_id: m.location_id, categories: (m.mentor_categories as { category_id: string }[]).map((c) => c.category_id) }));
    if (rows.length) { const { error } = await supabase.from("cycle_mentors").upsert(rows, { onConflict: "cycle_id,mentor_id", ignoreDuplicates: true }); if (error) throw error; }
  }
  if (teamIds.length) {
    const { data: ts } = await supabase.from("teams").select("id,name,location_id,team_categories(category_id)").in("id", teamIds);
    const rows = (ts ?? []).map((t) => ({ cycle_id: cycleId, team_id: t.id, team_name: t.name, location_id: t.location_id, categories: (t.team_categories as { category_id: string }[]).map((c) => c.category_id) }));
    if (rows.length) { const { error } = await supabase.from("cycle_teams").upsert(rows, { onConflict: "cycle_id,team_id", ignoreDuplicates: true }); if (error) throw error; }
  }
}

export async function createCycle(raw: CycleInputT): Promise<Res<{ id: string }>> {
  try {
    const session = await assertRole("admin");
    const i = CycleInput.parse(raw);
    const errs = validateSlotConfig({ startDate: i.start_date, endDate: i.end_date, dailyStart: i.daily_start, dailyEnd: i.daily_end, sessionMinutes: i.session_minutes, breakCount: i.break_count, breakMinutes: i.break_minutes });
    if (errs.length) return { ok: false, error: errs.join(" ") };
    const slots = generateTimeSlots({ startDate: i.start_date, endDate: i.end_date, dailyStart: i.daily_start, dailyEnd: i.daily_end, sessionMinutes: i.session_minutes, breakCount: i.break_count, breakMinutes: i.break_minutes, slotCount: i.slot_count });

    const autoQuotas = calculateAutoCycleQuotas(i.mentor_ids.length, i.team_ids.length, i.mode);
    const finalMaxSimultaneous = i.max_simultaneous || autoQuotas.autoMaxSimultaneous;
    const finalTeamsPerMentor = i.max_teams_per_mentor || autoQuotas.autoTeamsPerMentor;

    const supabase = await createClient();
    const { data: c, error } = await supabase.from("cycles").insert({
      name: i.name, start_date: i.start_date, end_date: i.end_date, daily_start: i.daily_start, daily_end: i.daily_end,
      session_minutes: i.session_minutes, break_count: i.break_count, break_minutes: i.break_minutes, mode: i.mode,
      max_simultaneous: finalMaxSimultaneous, created_by: session.id,
      settings: { slot_count: i.slot_count ?? null, max_teams_per_mentor: finalTeamsPerMentor },
    }).select("id").single();
    if (error) throw error;
    if (slots.length) { const { error: e } = await supabase.from("time_slots").insert(slots.map((s) => ({ ...s, cycle_id: c.id }))); if (e) throw e; }
    if (i.category_ids.length) await supabase.from("cycle_categories").insert(i.category_ids.map((category_id) => ({ cycle_id: c.id, category_id })));
    await snapshotMembers(c.id, i.mentor_ids, i.team_ids);
    if (i.mentor_ids.length > 0 && i.team_ids.length > 0 && slots.some((s) => s.kind === "session")) {
      try {
        await commitChangeService(c.id, { type: "regenerate" });
      } catch (distErr) {
        console.error("Auto-distribution on cycle creation warning:", distErr);
      }
    }
    await audit("cycle:create", "cycle", c.id, { name: i.name });
    revalidatePath("/admin/cycles");
    return { ok: true, id: c.id };
  } catch (e) { return fail(e); }
}

export async function duplicateCycle(id: string): Promise<Res<{ id: string }>> {
  try {
    const session = await assertRole("admin");
    const supabase = await createClient();
    const d = await loadCycle(supabase, id);
    if (!d) return { ok: false, error: "Cycle not found" };
    const c = d.cycle;
    const { data: n, error } = await supabase.from("cycles").insert({
      name: `${c.name} (copy)`, start_date: c.start_date, end_date: c.end_date, daily_start: c.daily_start, daily_end: c.daily_end,
      session_minutes: c.session_minutes, break_count: c.break_count, break_minutes: c.break_minutes, mode: c.mode,
      max_simultaneous: c.max_simultaneous, settings: c.settings, created_by: session.id,
    }).select("id").single();
    if (error) throw error;
    if (d.slots.length) await supabase.from("time_slots").insert(d.slots.map((s) => ({ cycle_id: n.id, idx: s.idx, day: s.day, starts_at: s.starts_at, ends_at: s.ends_at, kind: s.kind, enabled: s.enabled })));
    const { data: cc } = await supabase.from("cycle_categories").select("category_id").eq("cycle_id", id);
    if (cc?.length) await supabase.from("cycle_categories").insert(cc.map((x) => ({ cycle_id: n.id, category_id: x.category_id })));
    // Members are copied as independent snapshots; assignments/availability start empty.
    if (d.mentors.length) await supabase.from("cycle_mentors").insert(d.mentors.map((m) => ({ cycle_id: n.id, mentor_id: m.mentor_id, mentor_name: m.mentor_name, categories: m.categories, location_id: m.location_id })));
    if (d.teams.length) await supabase.from("cycle_teams").insert(d.teams.map((t) => ({ cycle_id: n.id, team_id: t.team_id, team_name: t.team_name, categories: t.categories, location_id: t.location_id })));
    await audit("cycle:duplicate", "cycle", n.id, { from: id });
    revalidatePath("/admin/cycles");
    return { ok: true, id: n.id };
  } catch (e) { return fail(e); }
}

export async function setCycleStatus(id: string, status: "draft" | "active" | "archived"): Promise<Res> {
  try {
    await assertRole("admin");
    const supabase = await createClient();
    const { error } = await supabase.from("cycles").update({ status }).eq("id", id);
    if (error) throw error;
    await audit("cycle:status", "cycle", id, { status });
    revalidatePath("/admin/cycles");
    revalidatePath(`/admin/cycles/${id}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

const UpdateCycleInput = z.object({
  name: z.string().trim().min(1).max(120),
  start_date: date,
  end_date: date,
  daily_start: time,
  daily_end: time,
  session_minutes: z.coerce.number().int().min(1).max(600),
  break_count: z.coerce.number().int().min(0).max(20),
  break_minutes: z.coerce.number().int().min(0).max(240),
  slot_count: z.coerce.number().int().min(1).max(500).nullable().optional(),
  mode: z.enum(["sequential", "simultaneous"]),
  max_simultaneous: z.coerce.number().int().min(1).max(6).default(2),
  max_teams_per_mentor: z.coerce.number().int().min(1).max(20).nullable().optional(),
  regenerate_slots: z.boolean().default(false),
});
export type UpdateCycleInputT = z.input<typeof UpdateCycleInput>;

export async function updateCycleConfig(id: string, raw: UpdateCycleInputT): Promise<Res> {
  try {
    await assertRole("admin");
    const i = UpdateCycleInput.parse(raw);
    const errs = validateSlotConfig({
      startDate: i.start_date,
      endDate: i.end_date,
      dailyStart: i.daily_start,
      dailyEnd: i.daily_end,
      sessionMinutes: i.session_minutes,
      breakCount: i.break_count,
      breakMinutes: i.break_minutes,
    });
    if (errs.length) return { ok: false, error: errs.join(" ") };

    const supabase = await createClient();
    const { error: cycleErr } = await supabase.from("cycles").update({
      name: i.name,
      start_date: i.start_date,
      end_date: i.end_date,
      daily_start: i.daily_start,
      daily_end: i.daily_end,
      session_minutes: i.session_minutes,
      break_count: i.break_count,
      break_minutes: i.break_minutes,
      mode: i.mode,
      max_simultaneous: i.max_simultaneous,
      settings: {
        slot_count: i.slot_count ?? null,
        max_teams_per_mentor: i.max_teams_per_mentor ?? null,
      },
    }).eq("id", id);
    if (cycleErr) throw cycleErr;

    if (i.regenerate_slots) {
      const slots = generateTimeSlots({
        startDate: i.start_date,
        endDate: i.end_date,
        dailyStart: i.daily_start,
        dailyEnd: i.daily_end,
        sessionMinutes: i.session_minutes,
        breakCount: i.break_count,
        breakMinutes: i.break_minutes,
        slotCount: i.slot_count,
      });
      // Delete old slots (cascade removes old assignments tied to old slots)
      await supabase.from("time_slots").delete().eq("cycle_id", id);
      if (slots.length) {
        const { error: slotInsertErr } = await supabase.from("time_slots").insert(slots.map((s) => ({ ...s, cycle_id: id })));
        if (slotInsertErr) throw slotInsertErr;
      }
      try {
        await commitChangeService(id, { type: "regenerate" });
      } catch (err) {
        console.error("Auto-distribution on slot regeneration:", err);
      }
    } else {
      // Re-distribute if mode / multi-team quota was updated
      try {
        await commitChangeService(id, { type: "regenerate" });
      } catch (err) {
        console.error("Schedule update notice:", err);
      }
    }

    await audit("cycle:update_config", "cycle", id, { name: i.name, mode: i.mode });
    revalidatePath(`/admin/cycles/${id}`);
    revalidatePath("/admin/cycles");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function updateCycleBasics(id: string, v: { name: string; mode: "sequential" | "simultaneous"; max_simultaneous: number; max_teams_per_mentor?: number | null }): Promise<Res> {
  try {
    await assertRole("admin");
    const p = z.object({
      name: z.string().trim().min(1).max(120),
      mode: z.enum(["sequential", "simultaneous"]),
      max_simultaneous: z.number().int().min(1).max(6),
      max_teams_per_mentor: z.number().int().min(1).max(20).nullable().optional(),
    }).parse(v);
    const supabase = await createClient();
    const { data: cur } = await supabase.from("cycles").select("settings").eq("id", id).single();
    const settings = { ...(cur?.settings ?? {}), max_teams_per_mentor: p.max_teams_per_mentor ?? null };
    const { error } = await supabase.from("cycles").update({
      name: p.name,
      mode: p.mode,
      max_simultaneous: p.max_simultaneous,
      settings,
    }).eq("id", id);
    if (error) throw error;
    try {
      await commitChangeService(id, { type: "regenerate" });
    } catch (err) {
      console.error("Schedule update on basics change:", err);
    }
    await audit("cycle:update", "cycle", id, p);
    revalidatePath(`/admin/cycles/${id}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteCycle(id: string): Promise<Res> {
  try {
    await assertRole("super_admin");
    const supabase = await createClient();
    const { error } = await supabase.from("cycles").delete().eq("id", id);
    if (error) throw error;
    await audit("cycle:delete", "cycle", id);
    revalidatePath("/admin/cycles");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteAllCycles(): Promise<Res> {
  try {
    await assertRole("super_admin");
    const supabase = await createClient();
    const { error } = await supabase.from("cycles").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw error;
    await audit("cycle:delete_all", "cycle", undefined);
    revalidatePath("/admin/cycles");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function setCycleMembers(id: string, mentorIds: string[], teamIds: string[], removeOthers: boolean): Promise<Res> {
  try {
    await assertRole("admin");
    const supabase = await createClient();
    await snapshotMembers(id, mentorIds, teamIds);
    if (removeOthers) {
      const { data: cm } = await supabase.from("cycle_mentors").select("id,mentor_id").eq("cycle_id", id);
      const gone = (cm ?? []).filter((m) => m.mentor_id && !mentorIds.includes(m.mentor_id)).map((m) => m.id);
      if (gone.length) await supabase.from("cycle_mentors").delete().in("id", gone);
      const { data: ct } = await supabase.from("cycle_teams").select("id,team_id").eq("cycle_id", id);
      const goneT = (ct ?? []).filter((t) => t.team_id && !teamIds.includes(t.team_id)).map((t) => t.id);
      if (goneT.length) await supabase.from("cycle_teams").delete().in("id", goneT);
    }
    await audit("cycle:members", "cycle", id, { mentors: mentorIds.length, teams: teamIds.length });
    revalidatePath(`/admin/cycles/${id}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Preview any change (generate, availability, status...) without writing anything. */
export async function previewChange(cycleId: string, change: Change) {
  try { return { ok: true as const, preview: await previewChangeService(cycleId, change) }; } catch (e) { return fail(e); }
}

export async function commitChange(cycleId: string, change: Change) {
  try {
    const r = await commitChangeService(cycleId, change);
    revalidatePath(`/admin/cycles/${cycleId}`);
    revalidatePath("/mentor");
    return { ok: true as const, ...r };
  } catch (e) { return fail(e); }
}

/** Drag-and-drop: move an assignment into another mentor/slot cell (swap if occupied). */
export async function moveAssignment(cycleId: string, assignmentId: string, toSlotId: string, toCycleMentorId: string, force = false): Promise<Res<{ warnings: string[] }>> {
  try {
    const session = await assertRole("admin");
    const supabase = await createClient();
    const d = await loadCycle(supabase, cycleId);
    if (!d) return { ok: false, error: "Cycle not found" };
    const a = d.assignments.find((x) => x.id === assignmentId);
    if (!a) return { ok: false, error: "Assignment not found" };
    const target = d.assignments.find((x) => x.slot_id === toSlotId && x.cycle_mentor_id === toCycleMentorId);
    if (target?.id === a.id) return { ok: true, warnings: [] };
    const mentor = d.mentors.find((m) => m.id === toCycleMentorId);
    const team = d.teams.find((t) => t.id === a.cycle_team_id);
    const slot = d.slots.find((s) => s.id === toSlotId);
    if (!mentor || !team || !slot || slot.kind !== "session") return { ok: false, error: "Invalid target cell" };
    const warnings: string[] = [];
    const locMap = new Map(d.locations.map((l) => [l.id, l]));
    const mLoc = mentor.location_id ? locMap.get(mentor.location_id) : undefined;
    const tLoc = team.location_id ? locMap.get(team.location_id) : undefined;
    if (!isEligible(
      { id: mentor.id, name: mentor.mentor_name, active: true, categories: mentor.categories, location: mLoc },
      { id: team.id, name: team.team_name, active: true, categories: team.categories, location: tLoc }
    )) {
      if (!mentor.categories.some((c) => team.categories.includes(c))) {
        warnings.push(`${mentor.mentor_name} does not share a category with ${team.team_name}.`);
      }
      if (mLoc?.floor !== undefined && tLoc?.floor !== undefined && mLoc.floor !== tLoc.floor) {
        warnings.push(`${mentor.mentor_name} is stationed on floor ${mLoc.floor}, but ${team.team_name} is on floor ${tLoc.floor}.`);
      }
      if (mLoc?.building && tLoc?.building && mLoc.building.trim().toLowerCase() !== tLoc.building.trim().toLowerCase()) {
        warnings.push(`${mentor.mentor_name} is in ${mLoc.building}, but ${team.team_name} is in ${tLoc.building}.`);
      }
    }
    if (d.mAvail.some((x) => x.cycle_mentor_id === mentor.id && x.slot_id === toSlotId) || mentor.status !== "active") warnings.push(`${mentor.mentor_name} is absent/on break then.`);
    if (d.tAvail.some((x) => x.cycle_team_id === team.id && x.slot_id === toSlotId) || team.status !== "active") warnings.push(`${team.team_name} is unavailable then.`);
    if (!target && d.assignments.some((x) => x.slot_id === toSlotId && x.cycle_team_id === team.id && x.id !== a.id) && d.cycle.mode === "sequential") warnings.push(`${team.team_name} already has a session in that slot.`);
    if (warnings.length && !(force && session.role === "super_admin")) return { ok: false, error: warnings.join(" ") + (session.role === "super_admin" ? " (Super admin may override.)" : "") };
    const remove = [a.id, ...(target ? [target.id] : [])];
    const add = [{ slot_id: toSlotId, cycle_mentor_id: toCycleMentorId, cycle_team_id: a.cycle_team_id, locked: true }];
    if (target) add.push({ slot_id: a.slot_id, cycle_mentor_id: a.cycle_mentor_id, cycle_team_id: target.cycle_team_id, locked: true });
    const { error } = await supabase.rpc("commit_change", { p_cycle: cycleId, p_change: { type: "manual" }, p_remove: remove, p_add: add });
    if (error) throw error;
    revalidatePath(`/admin/cycles/${cycleId}`);
    return { ok: true, warnings };
  } catch (e) { return fail(e); }
}

export async function addAssignment(cycleId: string, slotId: string, cycleMentorId: string, cycleTeamId: string, force = false): Promise<Res> {
  try {
    const session = await assertRole("admin");
    const supabase = await createClient();
    const d = await loadCycle(supabase, cycleId);
    const mentor = d?.mentors.find((m) => m.id === cycleMentorId);
    const team = d?.teams.find((t) => t.id === cycleTeamId);
    const slot = d?.slots.find((s) => s.id === slotId);
    if (!d || !mentor || !team || !slot || slot.kind !== "session") return { ok: false, error: "Invalid cell" };
    const warnings: string[] = [];
    const locMap = new Map(d.locations.map((l) => [l.id, l]));
    const mLoc = mentor.location_id ? locMap.get(mentor.location_id) : undefined;
    const tLoc = team.location_id ? locMap.get(team.location_id) : undefined;
    if (!isEligible(
      { id: mentor.id, name: mentor.mentor_name, active: true, categories: mentor.categories, location: mLoc },
      { id: team.id, name: team.team_name, active: true, categories: team.categories, location: tLoc }
    )) {
      if (!mentor.categories.some((c) => team.categories.includes(c))) {
        warnings.push(`${mentor.mentor_name} does not share a category with ${team.team_name}.`);
      }
      if (mLoc?.floor !== undefined && tLoc?.floor !== undefined && mLoc.floor !== tLoc.floor) {
        warnings.push(`${mentor.mentor_name} is stationed on floor ${mLoc.floor}, but ${team.team_name} is on floor ${tLoc.floor}.`);
      }
      if (mLoc?.building && tLoc?.building && mLoc.building.trim().toLowerCase() !== tLoc.building.trim().toLowerCase()) {
        warnings.push(`${mentor.mentor_name} is in ${mLoc.building}, but ${team.team_name} is in ${tLoc.building}.`);
      }
    }
    if (d.tAvail.some((x) => x.cycle_team_id === team.id && x.slot_id === slotId) || team.status !== "active") warnings.push(`${team.team_name} is unavailable then.`);
    if (d.cycle.mode === "sequential" && d.assignments.some((x) => x.slot_id === slotId && x.cycle_team_id === team.id)) warnings.push(`${team.team_name} already has a session in that slot.`);
    if (warnings.length && !(force && session.role === "super_admin")) return { ok: false, error: warnings.join(" ") + (session.role === "super_admin" ? " Super admins can override." : "") };
    const { error } = await supabase.rpc("commit_change", { p_cycle: cycleId, p_change: { type: "manual" }, p_remove: [], p_add: [{ slot_id: slotId, cycle_mentor_id: cycleMentorId, cycle_team_id: cycleTeamId, locked: true }] });
    if (error) throw error;
    revalidatePath(`/admin/cycles/${cycleId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function removeAssignment(cycleId: string, assignmentId: string): Promise<Res> {
  try {
    await assertRole("admin");
    const supabase = await createClient();
    const { error } = await supabase.rpc("commit_change", { p_cycle: cycleId, p_change: { type: "manual" }, p_remove: [assignmentId], p_add: [] });
    if (error) throw error;
    revalidatePath(`/admin/cycles/${cycleId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function toggleLock(cycleId: string, assignmentId: string, locked: boolean): Promise<Res> {
  try {
    await assertRole("admin");
    const supabase = await createClient();
    const { error } = await supabase.from("assignments").update({ locked }).eq("id", assignmentId).eq("cycle_id", cycleId);
    if (error) throw error;
    revalidatePath(`/admin/cycles/${cycleId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}
