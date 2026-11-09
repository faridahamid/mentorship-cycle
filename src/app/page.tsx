import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Hero } from "@/components/hero";

export default async function Home() {
  const s = process.env.NEXT_PUBLIC_SUPABASE_URL ? await getSession() : null;
  if (s) redirect(s.role === "mentor" ? "/mentor" : "/admin");
  return <Hero />;
}
