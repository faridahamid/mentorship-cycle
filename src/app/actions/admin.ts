"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole, audit } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e) });
const uuid = z.string().uuid();
const password = z.string().min(8, "Password must be at least 8 characters").max(72);

/* ───────────── auth (public) ───────────── */
export async function signIn(email: string, pw: string): Promise<Res> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) return { ok: false, error: "Invalid email or password." };
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function signUpMentor(v: { fullName: string; email: string; password: string; categoryIds: string[]; locationId?: string; code?: string }): Promise<Res<{ needsConfirmation: boolean }>> {
  try {
    const p = z.object({ fullName: z.string().trim().min(2).max(100), email: z.string().email(), password, categoryIds: z.array(uuid).min(1, "Select at least one expertise category"), locationId: uuid.optional().or(z.literal("")), code: z.string().optional() }).parse(v);
    const required = process.env.MENTOR_REGISTRATION_CODE;
    if (required && p.code !== required) return { ok: false, error: "Invalid registration link." };
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email: p.email, password: p.password,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`, data: { full_name: p.fullName, signup_kind: "mentor", categories: p.categoryIds, location_id: p.locationId || "" } },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, needsConfirmation: !data.session };
  } catch (e) { return e instanceof z.ZodError ? { ok: false, error: e.issues[0].message } : fail(e); }
}

export async function requestPasswordReset(email: string): Promise<Res> {
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password` });
  return { ok: true }; // never reveal whether the email exists
}

export async function updateOwnPassword(pw: string): Promise<Res> {
  try {
    const p = password.parse(pw);
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password: p });
    if (error) throw error;
    return { ok: true };
  } catch (e) { return e instanceof z.ZodError ? { ok: false, error: e.issues[0].message } : fail(e); }
}

/* ───────────── categories & locations ───────────── */
export async function saveCategory(v: { id?: string; name: string; color: string }): Promise<Res> {
  try {
    await assertRole("admin");
    const p = z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).parse(v);
    const supabase = await createClient();
    const { error } = p.id ? await supabase.from("categories").update({ name: p.name, color: p.color }).eq("id", p.id) : await supabase.from("categories").insert({ name: p.name, color: p.color });
    if (error) throw error;
    await audit(p.id ? "category:update" : "category:create", "category", p.id, p);
    revalidatePath("/admin/categories");
    return { ok: true };
  } catch (e) { return e instanceof z.ZodError ? { ok: false, error: e.issues[0].message } : fail(e); }
}
export async function deleteCategory(id: string): Promise<Res> {
  try {
    await assertRole("admin");
    const supabase = await createClient();
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) throw error;
    await audit("category:delete", "category", id);
    revalidatePath("/admin/categories");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteAllCategories(): Promise<Res<{ deletedCount: number }>> {
  try {
    await assertRole("admin");
    const adminClient = createAdminClient();
    const { data: catsToDelete } = await adminClient.from("categories").select("id");
    const count = catsToDelete?.length ?? 0;
    const { error } = await adminClient.from("categories").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw error;
    await audit("category:delete_all", "category", undefined, { count });
    revalidatePath("/admin/categories");
    revalidatePath("/admin/teams");
    revalidatePath("/admin/mentors");
    return { ok: true, deletedCount: count };
  } catch (e) {
    return fail(e);
  }
}

export async function ensureCategories(names: string[]): Promise<Res<{ categories: { id: string; name: string; color: string }[] }>> {
  try {
    await assertRole("admin");
    const supabase = await createClient();
    const { data: existing } = await supabase.from("categories").select("id,name,color");
    const existingMap = new Map((existing ?? []).map((c) => [c.name.trim().toLowerCase(), c]));

    const PRESETS = ["#58efff", "#ffab2e", "#65ffbd", "#a855f7", "#ec4899", "#3b82f6", "#f43f5e", "#eab308", "#14b8a6", "#8b5cf6"];
    const toCreate: { name: string; color: string }[] = [];

    for (const raw of names) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (!existingMap.has(trimmed.toLowerCase())) {
        const color = PRESETS[Math.floor(Math.random() * PRESETS.length)];
        toCreate.push({ name: trimmed, color });
        existingMap.set(trimmed.toLowerCase(), { id: "", name: trimmed, color });
      }
    }

    if (toCreate.length > 0) {
      const adminClient = createAdminClient();
      const { data: inserted, error } = await adminClient.from("categories").insert(toCreate).select("id,name,color");
      if (error) throw error;
      for (const ins of inserted ?? []) {
        existingMap.set(ins.name.trim().toLowerCase(), ins);
      }
      await audit("category:auto_create", "category", undefined, { count: toCreate.length, names: toCreate.map((c) => c.name) });
      revalidatePath("/admin/categories");
      revalidatePath("/admin/teams");
    }

    const { data: all } = await supabase.from("categories").select("id,name,color").order("name");
    return { ok: true, categories: all ?? [] };
  } catch (e) {
    return fail(e);
  }
}

export async function importCategories(rows: { name: string; color?: string }[]): Promise<Res<{ summary: { inserted: number; duplicates: number } }>> {
  try {
    await assertRole("super_admin");
    const supabase = await createClient();
    const { data: existing } = await supabase.from("categories").select("name");
    const seen = new Set((existing ?? []).map((c) => c.name.trim().toLowerCase()));

    const PRESETS = ["#58efff", "#ffab2e", "#65ffbd", "#a855f7", "#ec4899", "#3b82f6", "#f43f5e", "#eab308", "#14b8a6", "#8b5cf6"];
    const toInsert: { name: string; color: string }[] = [];
    let duplicates = 0;

    for (const r of rows) {
      const name = (r.name ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      const color = r.color && /^#[0-9a-fA-F]{6}$/.test(r.color)
        ? r.color
        : PRESETS[Math.floor(Math.random() * PRESETS.length)];
      toInsert.push({ name, color });
    }

    if (toInsert.length > 0) {
      const adminClient = createAdminClient();
      const { error } = await adminClient.from("categories").insert(toInsert);
      if (error) throw error;
    }

    await audit("category:import", "category", undefined, { inserted: toInsert.length, duplicates });
    revalidatePath("/admin/categories");
    return { ok: true, summary: { inserted: toInsert.length, duplicates } };
  } catch (e) { return fail(e); }
}

export async function saveLocation(v: { building: string; floor: number; section: string }): Promise<Res> {
  try {
    await assertRole("admin");
    const p = z.object({ building: z.string().trim().min(1).max(60), floor: z.coerce.number().int().min(-5).max(200), section: z.string().trim().max(60) }).parse(v);
    const supabase = await createClient();
    const { error } = await supabase.from("locations").insert(p);
    if (error) throw error;
    await audit("location:create", "location", undefined, p);
    revalidatePath("/admin/locations");
    return { ok: true };
  } catch (e) { return e instanceof z.ZodError ? { ok: false, error: e.issues[0].message } : fail(e); }
}
export async function deleteLocation(id: string): Promise<Res> {
  try {
    await assertRole("admin");
    const supabase = await createClient();
    const { error } = await supabase.from("locations").delete().eq("id", id);
    if (error) throw error;
    revalidatePath("/admin/locations");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteAllLocations(): Promise<Res<{ deletedCount: number }>> {
  try {
    await assertRole("admin");
    const adminClient = createAdminClient();
    const { data: locsToDelete } = await adminClient.from("locations").select("id");
    const count = locsToDelete?.length ?? 0;
    await adminClient.from("teams").update({ location_id: null }).neq("id", "00000000-0000-0000-0000-000000000000");
    await adminClient.from("mentors").update({ location_id: null }).neq("id", "00000000-0000-0000-0000-000000000000");
    const { error } = await adminClient.from("locations").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw error;
    await audit("location:delete_all", "location", undefined, { count });
    revalidatePath("/admin/locations");
    revalidatePath("/admin/teams");
    revalidatePath("/admin/mentors");
    return { ok: true, deletedCount: count };
  } catch (e) {
    return fail(e);
  }
}

export async function importLocations(rows: { building: string; floor: number; section: string }[]): Promise<Res<{ summary: { inserted: number; duplicates: number } }>> {
  try {
    await assertRole("admin");
    const supabase = await createClient();
    const { data: existing } = await supabase.from("locations").select("building,floor,section");
    const seen = new Set((existing ?? []).map((l) => `${l.building.toLowerCase()}|${l.floor}|${(l.section || "").toLowerCase()}`));

    const toInsert: { building: string; floor: number; section: string }[] = [];
    let duplicates = 0;

    for (const r of rows) {
      const b = (r.building ?? "").trim();
      const s = (r.section ?? "").trim();
      const f = typeof r.floor === "number" ? r.floor : parseInt(String(r.floor), 10) || 0;
      if (!b) continue;
      const key = `${b.toLowerCase()}|${f}|${s.toLowerCase()}`;
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      toInsert.push({ building: b, floor: f, section: s });
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from("locations").insert(toInsert);
      if (error) throw error;
    }

    await audit("location:import", "location", undefined, { inserted: toInsert.length, duplicates });
    revalidatePath("/admin/locations");
    return { ok: true, summary: { inserted: toInsert.length, duplicates } };
  } catch (e) { return fail(e); }
}

/* ───────────── teams ───────────── */
const TeamIn = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Team name is required").max(120),
  categoryIds: z.array(uuid).min(1, "Select at least one category"),
  locationId: uuid.nullable().optional(),
  info: z.record(z.string(), z.string()).default({}),
});
export async function saveTeam(v: z.input<typeof TeamIn>): Promise<Res> {
  try {
    await assertRole("admin");
    const p = TeamIn.parse(v);
    const supabase = await createClient();
    let id = p.id;
    if (id) {
      const { error } = await supabase.from("teams").update({ name: p.name, location_id: p.locationId ?? null, info: p.info }).eq("id", id);
      if (error) throw error;
      await supabase.from("team_categories").delete().eq("team_id", id);
    } else {
      const { data, error } = await supabase.from("teams").insert({ name: p.name, location_id: p.locationId ?? null, info: p.info }).select("id").single();
      if (error) throw error.code === "23505" ? new Error(`A team named "${p.name}" already exists.`) : error;
      id = data.id;
    }
    const { error: ce } = await supabase.from("team_categories").insert(p.categoryIds.map((category_id) => ({ team_id: id!, category_id })));
    if (ce) throw ce;
    await audit(p.id ? "team:update" : "team:create", "team", id, { name: p.name });
    revalidatePath("/admin/teams");
    return { ok: true };
  } catch (e) { return e instanceof z.ZodError ? { ok: false, error: e.issues[0].message } : fail(e); }
}
export async function deleteTeam(id: string): Promise<Res> {
  try {
    await assertRole("admin");
    const supabase = await createClient();
    const { error } = await supabase.from("teams").delete().eq("id", id);
    if (error) throw error;
    await audit("team:delete", "team", id);
    revalidatePath("/admin/teams");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteAllTeams(): Promise<Res<{ deletedCount: number }>> {
  try {
    await assertRole("admin");
    const adminClient = createAdminClient();
    const { data: teamsToDelete } = await adminClient.from("teams").select("id");
    const count = teamsToDelete?.length ?? 0;
    const { error } = await adminClient.from("teams").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw error;
    await audit("team:delete_all", "team", undefined, { count });
    revalidatePath("/admin/teams");
    revalidatePath("/admin/cycles");
    return { ok: true, deletedCount: count };
  } catch (e) {
    return fail(e);
  }
}

export interface ImportRow { name: string; categoryIds: string[]; locationId: string | null; info: Record<string, string> }
export interface ImportSummary { inserted: number; duplicates: string[]; rejected: { name: string; reason: string }[] }

/** Server re-validates everything: the client preview is a convenience, never trusted. */
export async function importTeams(rows: ImportRow[]): Promise<Res<{ summary: ImportSummary }>> {
  try {
    await assertRole("admin");
    if (rows.length > 2000) return { ok: false, error: "Import at most 2000 rows at once." };
    const supabase = await createClient();
    const { data: cats } = await supabase.from("categories").select("id");
    const catSet = new Set((cats ?? []).map((c) => c.id));
    const { data: existing } = await supabase.from("teams").select("name");
    const seen = new Set((existing ?? []).map((t) => t.name.trim().toLowerCase()));
    const summary: ImportSummary = { inserted: 0, duplicates: [], rejected: [] };
    const good: ImportRow[] = [];
    for (const r of rows) {
      const name = (r.name ?? "").trim();
      if (!name) { summary.rejected.push({ name: "(missing)", reason: "Missing team name" }); continue; }
      if (!r.categoryIds?.length || r.categoryIds.some((c) => !catSet.has(c))) { summary.rejected.push({ name, reason: "Missing or unknown category" }); continue; }
      if (seen.has(name.toLowerCase())) { summary.duplicates.push(name); continue; }
      seen.add(name.toLowerCase());
      good.push({ ...r, name });
    }
    for (let i = 0; i < good.length; i += 200) {
      const chunk = good.slice(i, i + 200);
      const { data: ins, error } = await supabase.from("teams").insert(chunk.map((g) => ({ name: g.name, location_id: g.locationId, info: g.info }))).select("id,name");
      if (error) throw error;
      const byName = new Map((ins ?? []).map((t) => [t.name, t.id]));
      const links = chunk.flatMap((g) => [...new Set(g.categoryIds)].map((category_id) => ({ team_id: byName.get(g.name)!, category_id })));
      const { error: le } = await supabase.from("team_categories").insert(links);
      if (le) throw le;
      summary.inserted += chunk.length;
    }
    await audit("team:import", "team", undefined, { inserted: summary.inserted, duplicates: summary.duplicates.length, rejected: summary.rejected.length });
    revalidatePath("/admin/teams");
    return { ok: true, summary };
  } catch (e) { return fail(e); }
}

/* ───────────── mentors ───────────── */
export async function createMentorDirect(v: { fullName: string; gender?: string | null; categoryIds: string[]; locationId: string | null }): Promise<Res> {
  try {
    await assertRole("admin");
    const p = z.object({
      fullName: z.string().trim().min(2).max(100),
      gender: z.string().trim().max(30).nullable().optional(),
      categoryIds: z.array(uuid).min(1, "Select at least one category"),
      locationId: uuid.nullable()
    }).parse(v);
    const supabase = await createClient();
    const { data, error } = await supabase.from("mentors").insert({
      full_name: p.fullName,
      gender: p.gender || null,
      location_id: p.locationId
    }).select("id").single();
    if (error) throw error;
    if (p.categoryIds.length) {
      const { error: ce } = await supabase.from("mentor_categories").insert(p.categoryIds.map((category_id) => ({ mentor_id: data.id, category_id })));
      if (ce) throw ce;
    }
    await audit("mentor:create", "mentor", data.id, { name: p.fullName, gender: p.gender });
    revalidatePath("/admin/mentors");
    return { ok: true };
  } catch (e) { return e instanceof z.ZodError ? { ok: false, error: e.issues[0].message } : fail(e); }
}

export async function saveMentor(v: { id: string; fullName: string; gender?: string | null; categoryIds: string[]; locationId: string | null }): Promise<Res> {
  try {
    await assertRole("admin");
    const p = z.object({
      id: uuid,
      fullName: z.string().trim().min(2).max(100),
      gender: z.string().trim().max(30).nullable().optional(),
      categoryIds: z.array(uuid).min(1, "Select at least one category"),
      locationId: uuid.nullable()
    }).parse(v);
    const supabase = await createClient();
    const { error } = await supabase.from("mentors").update({
      full_name: p.fullName,
      gender: p.gender || null,
      location_id: p.locationId
    }).eq("id", p.id);
    if (error) throw error;
    await supabase.from("mentor_categories").delete().eq("mentor_id", p.id);
    const { error: ce } = await supabase.from("mentor_categories").insert(p.categoryIds.map((category_id) => ({ mentor_id: p.id, category_id })));
    if (ce) throw ce;
    await audit("mentor:update", "mentor", p.id, { gender: p.gender });
    revalidatePath("/admin/mentors");
    return { ok: true };
  } catch (e) { return e instanceof z.ZodError ? { ok: false, error: e.issues[0].message } : fail(e); }
}

export async function deleteMentor(id: string): Promise<Res> {
  try {
    await assertRole("admin");
    const supabase = await createClient();
    const { error } = await supabase.from("mentors").delete().eq("id", id);
    if (error) throw error;
    await audit("mentor:delete", "mentor", id);
    revalidatePath("/admin/mentors");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteAllMentors(): Promise<Res<{ deletedCount: number }>> {
  try {
    await assertRole("admin");
    const adminClient = createAdminClient();
    const { data: mentorsToDelete } = await adminClient.from("mentors").select("id, profile_id");
    const count = mentorsToDelete?.length ?? 0;
    const { error } = await adminClient.from("mentors").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw error;

    for (const m of mentorsToDelete ?? []) {
      if (m.profile_id) {
        try {
          await adminClient.auth.admin.deleteUser(m.profile_id);
        } catch {
          // ignore
        }
      }
    }

    await audit("mentor:delete_all", "mentor", undefined, { count });
    revalidatePath("/admin/mentors");
    revalidatePath("/admin/cycles");
    return { ok: true, deletedCount: count };
  } catch (e) {
    return fail(e);
  }
}

export interface ImportMentorRow {
  fullName: string;
  gender?: string | null;
  email: string;
  password: string;
  categoryIds: string[];
  locationId: string | null;
}

export interface ImportMentorSummary {
  inserted: number;
  duplicates: string[];
  rejected: { name: string; reason: string }[];
  credentials: { fullName: string; email: string; password: string }[];
}

export async function importMentors(rows: ImportMentorRow[]): Promise<Res<{ summary: ImportMentorSummary }>> {
  try {
    await assertRole("admin");
    if (rows.length > 1000) return { ok: false, error: "Import at most 1000 mentors at once." };
    const adminClient = createAdminClient();

    // Fetch existing emails to prevent duplicates
    const { data: userList, error: listErr } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw listErr;
    const existingEmails = new Set((userList?.users ?? []).map((u) => (u.email ?? "").trim().toLowerCase()));

    const summary: ImportMentorSummary = {
      inserted: 0,
      duplicates: [],
      rejected: [],
      credentials: []
    };

    for (const r of rows) {
      const fullName = (r.fullName ?? "").trim();
      const email = (r.email ?? "").trim().toLowerCase();
      const rawPassword = (r.password ?? "").trim();
      const pw = rawPassword.length >= 8 ? rawPassword : `${rawPassword}12345`.slice(0, 72);

      if (!fullName) {
        summary.rejected.push({ name: "(missing)", reason: "Missing mentor name" });
        continue;
      }
      if (!email || !email.includes("@")) {
        summary.rejected.push({ name: fullName, reason: "Invalid generated email" });
        continue;
      }
      if (existingEmails.has(email)) {
        summary.duplicates.push(email);
        continue;
      }
      existingEmails.add(email);

      const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password: pw,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          gender: r.gender ?? null,
          signup_kind: "mentor",
          categories: r.categoryIds,
          location_id: r.locationId ?? ""
        }
      });

      if (createErr || !newUser?.user) {
        summary.rejected.push({ name: fullName, reason: createErr?.message || "Auth user creation failed" });
        continue;
      }

      const userId = newUser.user.id;
      // Guarantee profile, mentor, and category linkage
      const { data: mRec } = await adminClient.from("mentors").select("id").eq("profile_id", userId).maybeSingle();
      let mentorId = mRec?.id;
      if (!mentorId) {
        const { data: insM } = await adminClient.from("mentors").insert({
          profile_id: userId,
          full_name: fullName,
          gender: r.gender ?? null,
          location_id: r.locationId ?? null
        }).select("id").single();
        mentorId = insM?.id;
      } else {
        const upd: Record<string, unknown> = {};
        if (r.locationId) upd.location_id = r.locationId;
        if (r.gender) upd.gender = r.gender;
        if (Object.keys(upd).length > 0) {
          await adminClient.from("mentors").update(upd).eq("id", mentorId);
        }
      }

      if (mentorId && r.categoryIds.length) {
        const catRows = r.categoryIds.map((category_id) => ({ mentor_id: mentorId!, category_id }));
        await adminClient.from("mentor_categories").upsert(catRows, { onConflict: "mentor_id,category_id", ignoreDuplicates: true });
      }

      summary.inserted++;
      summary.credentials.push({
        fullName,
        email,
        password: pw
      });
    }

    await audit("mentor:import", "mentor", undefined, {
      inserted: summary.inserted,
      duplicates: summary.duplicates.length,
      rejected: summary.rejected.length
    });
    revalidatePath("/admin/mentors");
    revalidatePath("/admin/users");
    return { ok: true, summary };
  } catch (e) {
    return fail(e);
  }
}

/* ───────────── accounts management with rank hierarchy ───────────── */
const ROLE_RANK: Record<string, number> = { mentor: 0, admin: 1, super_admin: 2 };

export async function createAccount(v: { role: "mentor" | "admin"; fullName: string; email: string; password: string; categoryIds?: string[]; locationId?: string | null }): Promise<Res> {
  try {
    const me = await assertRole("admin");
    const p = z.object({ role: z.enum(["mentor", "admin"]), fullName: z.string().trim().min(2).max(100), email: z.string().email(), password, categoryIds: z.array(uuid).default([]), locationId: uuid.nullable().optional() }).parse(v);
    if ((ROLE_RANK[me.role] ?? 0) <= (ROLE_RANK[p.role] ?? 0)) {
      return { ok: false, error: "Permission denied. You can only create accounts of lower ranking than your own." };
    }
    if (p.role === "mentor" && !p.categoryIds.length) return { ok: false, error: "Select at least one category for a mentor." };
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email, password: p.password, email_confirm: true,
      user_metadata: { full_name: p.fullName, signup_kind: p.role === "mentor" ? "mentor" : "admin", categories: p.categoryIds, location_id: p.locationId ?? "" },
    });
    if (error) throw error;
    if (p.role === "admin") await admin.from("profiles").update({ role: "admin" }).eq("id", data.user.id);
    await audit("account:create", "profile", data.user.id, { role: p.role, email: p.email, by: me.id });
    revalidatePath("/admin/mentors");
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (e) { return e instanceof z.ZodError ? { ok: false, error: e.issues[0].message } : fail(e); }
}

export async function resetUserPassword(userId: string, pw: string): Promise<Res> {
  try {
    const me = await assertRole("admin");
    const p = password.parse(pw);
    uuid.parse(userId);
    const admin = createAdminClient();
    const { data: target } = await admin.from("profiles").select("id, role").eq("id", userId).single();
    if (!target) return { ok: false, error: "User not found." };
    if ((ROLE_RANK[me.role] ?? 0) <= (ROLE_RANK[target.role] ?? 0)) {
      return { ok: false, error: "Permission denied. You can only change passwords for lower-ranking accounts." };
    }
    const { error } = await admin.auth.admin.updateUserById(userId, { password: p });
    if (error) throw error;
    await audit("account:reset_password", "profile", userId, { by: me.id });
    return { ok: true };
  } catch (e) { return e instanceof z.ZodError ? { ok: false, error: e.issues[0].message } : fail(e); }
}

export async function setUserRole(userId: string, role: "mentor" | "admin" | "super_admin"): Promise<Res> {
  try {
    const me = await assertRole("admin");
    uuid.parse(userId);
    if (userId === me.id) return { ok: false, error: "You cannot change your own role." };
    const admin = createAdminClient();
    const { data: target } = await admin.from("profiles").select("id, role").eq("id", userId).single();
    if (!target) return { ok: false, error: "User not found." };
    if ((ROLE_RANK[me.role] ?? 0) <= (ROLE_RANK[target.role] ?? 0) || (ROLE_RANK[me.role] ?? 0) <= (ROLE_RANK[role] ?? 0)) {
      return { ok: false, error: "Permission denied. You can only manage roles for lower-ranking accounts." };
    }
    const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
    if (error) throw error;
    await audit("account:set_role", "profile", userId, { role, by: me.id });
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteAccount(userId: string): Promise<Res> {
  try {
    const me = await assertRole("admin");
    uuid.parse(userId);
    if (userId === me.id) return { ok: false, error: "You cannot delete your own account." };
    const admin = createAdminClient();
    const { data: target } = await admin.from("profiles").select("id, role").eq("id", userId).single();
    if (!target) return { ok: false, error: "User not found." };
    if ((ROLE_RANK[me.role] ?? 0) <= (ROLE_RANK[target.role] ?? 0)) {
      return { ok: false, error: "Permission denied. You can only delete lower-ranking accounts." };
    }
    await admin.from("mentors").delete().eq("profile_id", userId); // cycle history keeps its snapshots
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
    await audit("account:delete", "profile", userId, { by: me.id });
    revalidatePath("/admin/mentors");
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function pruneAudit(days: number): Promise<Res<{ deleted: number }>> {
  try {
    await assertRole("super_admin");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("prune_audit_logs", { p_keep_days: Math.max(7, Math.floor(days)) });
    if (error) throw error;
    return { ok: true, deleted: data as number };
  } catch (e) { return fail(e); }
}

export async function markNotificationsRead(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) await supabase.from("notifications").update({ read: true }).eq("profile_id", user.id).eq("read", false);
  revalidatePath("/", "layout");
}

