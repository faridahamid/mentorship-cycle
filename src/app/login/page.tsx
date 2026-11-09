import { Suspense } from "react";
import { AuthShell, LoginForm } from "@/components/auth-forms";

export default function Page() {
  return (
    <AuthShell title="Sign In to Workspace" sub="Access your live schedule board, team rotations, and cycle settings.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
