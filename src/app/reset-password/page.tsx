import { AuthShell, ResetForm } from "@/components/auth-forms";

export default function Page() {
  return (
    <AuthShell title="Update Password" sub="Set a new secure password of at least 8 characters.">
      <ResetForm />
    </AuthShell>
  );
}
