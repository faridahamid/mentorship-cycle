import "server-only";
import { assertRole, audit, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCycle } from "@/lib/cycle-data";
import { applyChange, plan, type Change, type CycleData } from "@/lib/cycle-model";
import type { Issue } from "@/lib/scheduler";

export interface PreviewResult {
  added: { slot: string; mentor: string; team: string }[];
  removed: { slot: string; mentor: string; team: string }[];
  unchanged: number;
  issues: Issue[];
  /** number of rows hidden from a mentor's view (other mentors' rebalanced sessions) */
  hidden: number;
}

const MENTOR_CHANGES = new Set(["mentor_unavailable", "mentor_available"]);

async function authorize(session: Session, change: Change, data: CycleData) {
  if (session.role !== "mentor") return;
  if (!MENTOR_CHANGES.has(change.type)) throw new Error("Forbidden");
  const cmId = (change as { cycle_mentor_id: string }).cycle_mentor_id;
  const supabase = await createClient();
  const { data: own } = await supabase.from("mentors").select("id").eq("profile_id", session.id).maybeSingle();
  const cm = data.mentors.find((m) => m.id === cmId);
  if (!own || !cm || cm.mentor_id !== own.id) throw new Error("Forbidden");
}

async function load(session: Session, cycleId: string) {
  // Mentors cannot read other mentors' rows under RLS; recomputation needs the whole cycle,
  // so the (validated) mentor path reads through the service role. Writes still go through the
  // SECURITY DEFINER RPC that re-checks ownership in SQL.
  const client = session.role === "mentor" ? createAdminClient() : await createClient();
  const data = await loadCycle(client, cycleId);
  if (!data) throw new Error("Cycle not found");
  return data;
}

function describe(d: CycleData) {
  const slot = new Map(d.slots.map((s) => [s.id, `${s.day} ${s.starts_at.slice(0, 5)}`]));
  const m = new Map(d.mentors.map((x) => [x.id, x.mentor_name]));
  const t = new Map(d.teams.map((x) => [x.id, x.team_name]));
  return (a: { slotId: string; mentorId: string; teamId: string }) => ({ slot: slot.get(a.slotId) ?? "?", mentor: m.get(a.mentorId) ?? "?", team: t.get(a.teamId) ?? "?" });
}

export async function previewChangeService(cycleId: string, change: Change): Promise<PreviewResult> {
  const session = await assertRole("mentor");
  const data = await load(session, cycleId);
  await authorize(session, change, data);
  const next = applyChange(data, change);
  const p = plan(next, change.type === "regenerate" ? "fresh" : "redistribute");
  const d = describe(next);
  let added = p.diff.added;
  let removed = p.diff.removed;
  let hidden = 0;
  if (session.role === "mentor") {
    const cmId = (change as { cycle_mentor_id: string }).cycle_mentor_id;
    hidden = added.filter((a) => a.mentorId !== cmId).length;
    added = added.filter((a) => a.mentorId === cmId);
    removed = removed.filter((a) => a.mentorId === cmId);
  }
  return { added: added.map(d), removed: removed.map(d), unchanged: p.diff.unchanged, issues: session.role === "mentor" ? [] : p.issues.slice(0, 50), hidden };
}

export async function commitChangeService(cycleId: string, change: Change) {
  const session = await assertRole("mentor");
  const data = await load(session, cycleId);
  await authorize(session, change, data);
  const next = applyChange(data, change);
  const p = plan(next, change.type === "regenerate" ? "fresh" : "redistribute");
  // Always the caller's own client: the RPC re-validates the role and mentor ownership.
  const supabase = await createClient();
  const { error } = await supabase.rpc("commit_change", { p_cycle: cycleId, p_change: change, p_remove: p.removeIds, p_add: p.add });
  if (error) throw new Error(error.message);
  if (session.role === "mentor") {
    // notify admins that a mentor changed availability
    const admin = createAdminClient();
    const { data: admins } = await admin.from("profiles").select("id").in("role", ["admin", "super_admin"]);
    const who = data.mentors.find((m) => m.id === (change as { cycle_mentor_id: string }).cycle_mentor_id)?.mentor_name ?? "A mentor";
    if (admins?.length) await admin.from("notifications").insert(admins.map((a) => ({ profile_id: a.id, message: `${who} updated their availability (${change.type.replace("_", " ")}); schedule rebalanced.` })));
  } else {
    await audit(`schedule:${change.type}`, "cycle", cycleId);
  }
  // Tell affected mentors their schedule changed.
  const affected = new Set([...p.diff.added, ...p.diff.removed].map((a) => a.mentorId));
  const targets = data.mentors.filter((m) => affected.has(m.id) && m.mentor_id);
  if (targets.length) {
    const admin = createAdminClient();
    const { data: ms } = await admin.from("mentors").select("id,profile_id").in("id", targets.map((m) => m.mentor_id!));
    const rows = (ms ?? []).filter((m) => m.profile_id).map((m) => ({ profile_id: m.profile_id, message: `Your schedule in "${data.cycle.name}" was updated.` }));
    if (rows.length) await admin.from("notifications").insert(rows);
  }
  return { added: p.diff.added.length, removed: p.diff.removed.length, issues: session.role === "mentor" ? [] : p.issues };
}

