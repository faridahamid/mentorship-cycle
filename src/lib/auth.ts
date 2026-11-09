import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "super_admin" | "admin" | "mentor";
export interface Session {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("full_name,email,role").eq("id", user.id).single();
  if (!data) return null;
  return { id: user.id, email: data.email, fullName: data.full_name, role: data.role as Role };
}

const rank: Record<Role, number> = { mentor: 0, admin: 1, super_admin: 2 };

/** Server-side authorization gate. Throws/redirects when the caller lacks the role. */
export async function requireRole(min: Role): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (rank[s.role] < rank[min]) redirect(s.role === "mentor" ? "/mentor" : "/admin");
  return s;
}

/** For server actions: never redirect, throw so the client can show the error. */
export async function assertRole(min: Role): Promise<Session> {
  const s = await getSession();
  if (!s || rank[s.role] < rank[min]) throw new Error("Forbidden");
  return s;
}

export async function audit(action: string, entity?: string, entityId?: string, details: Record<string, unknown> = {}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("audit_logs").insert({ actor: user.id, action, entity, entity_id: entityId, details });
}

