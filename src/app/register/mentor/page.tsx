import { AuthShell, MentorRegisterForm } from "@/components/auth-forms";
import { createClient } from "@/lib/supabase/server";

export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const supabase = await createClient();
  const [{ data: categories }, { data: locations }] = await Promise.all([
    supabase.from("categories").select("id,name,color").order("name"),
    supabase.from("locations").select("id,building,floor,section").order("building").order("floor")
  ]);
  return (
    <AuthShell
      title="Join as a Mentor"
      sub="Register your profile, station location, and specialized expertise categories."
    >
      <MentorRegisterForm categories={categories ?? []} locations={locations ?? []} code={code} />
    </AuthShell>
  );
}
