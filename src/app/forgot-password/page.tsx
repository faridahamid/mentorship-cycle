import { AuthShell, ForgotForm } from "@/components/auth-forms";

export default function Page() {
  return (
    <AuthShell title="Password Recovery" sub="Enter your registered email to receive a secure access link.">
      <ForgotForm />
    </AuthShell>
  );
}
