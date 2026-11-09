"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Check, KeyRound, LogIn, UserPlus } from "lucide-react";
import { signIn, requestPasswordReset, updateOwnPassword, signUpMentor } from "@/app/actions/admin";
import { CategoryPicker, Msg } from "@/components/ui";

export function AuthShell({
  title,
  sub,
  children
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen grid place-items-center p-6 bg-[#080936] relative overflow-hidden text-[#fff0cf]">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="login relative z-10 w-full"
      >
        <div className="flex items-center justify-between mb-6">
          <Link href="/" className="btn !py-1.5 !px-3 !text-xs text-muted hover:text-cream inline-flex items-center gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5 text-cyan" /> Home
          </Link>
          <Link href="/" className="brandLockup">
            <span className="brandOrb !w-6 !h-6">
              <span className="!w-1.5 !h-1.5" />
            </span>
            <span className="text-[11px] font-bold text-white tracking-wider">
              NASA SPACE APPS CAIRO
            </span>
          </Link>
        </div>

        <h1 className="text-2xl font-extrabold tracking-tight text-cream m-0">{title}</h1>
        <p className="mt-1.5 mb-6 font-mono text-xs text-muted leading-relaxed">{sub}</p>
        {children}
      </motion.div>
    </main>
  );
}

export function LoginForm() {
  const router = useRouter();
  const qp = useSearchParams();
  const [err, setErr] = useState(qp.get("error") === "link" ? "That link is invalid or expired." : "");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr("");
    const r = await signIn(String(f.get("email")), String(f.get("password")));
    if (!r.ok) {
      setErr(r.error);
      setBusy(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {err && <Msg kind="error">{err}</Msg>}
      <div className="field">
        <label>Email Address</label>
        <input className="input" name="email" type="email" placeholder="admin@domain.com" required autoComplete="email" />
      </div>
      <div className="field">
        <label>Password</label>
        <input className="input" name="password" type="password" required autoComplete="current-password" />
      </div>
      <button className="btn-primary w-full justify-center !py-2.5 font-bold mt-2" disabled={busy}>
        {busy ? (
          "Signing in…"
        ) : (
          <>
            <LogIn className="h-4 w-4" /> Sign In to Workspace
          </>
        )}
      </button>
      <div className="flex justify-between pt-2 font-mono text-[11px] text-muted">
        <Link className="hover:text-cyan transition underline underline-offset-4" href="/forgot-password">
          Forgot password?
        </Link>
        <Link className="hover:text-white transition underline underline-offset-4" href="/register/mentor">
          Mentor registration ↗
        </Link>
      </div>
    </form>
  );
}

export function ForgotForm() {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    await requestPasswordReset(String(new FormData(e.currentTarget).get("email")));
    setDone(true);
    setBusy(false);
  }

  if (done) return <Msg kind="ok">If that email has an account, a recovery link has been sent.</Msg>;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="field">
        <label>Registered Email</label>
        <input className="input" name="email" type="email" placeholder="user@domain.com" required />
      </div>
      <button className="btn-primary w-full justify-center !py-2.5 font-bold" disabled={busy}>
        <KeyRound className="h-4 w-4" /> {busy ? "Sending…" : "Send Reset Link"}
      </button>
      <div className="text-center pt-2 font-mono text-[11px]">
        <Link className="text-muted hover:text-white transition underline underline-offset-4" href="/login">
          ← Back to sign in
        </Link>
      </div>
    </form>
  );
}

export function ResetForm() {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) return setErr("Passwords do not match.");
    const r = await updateOwnPassword(String(f.get("password")));
    if (!r.ok) return setErr(r.error);
    setOk(true);
    setTimeout(() => router.replace("/"), 900);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {err && <Msg kind="error">{err}</Msg>}
      {ok && <Msg kind="ok">Password updated successfully. Redirecting…</Msg>}
      <div className="field">
        <label>New Password</label>
        <input className="input" name="password" type="password" minLength={8} required />
      </div>
      <div className="field">
        <label>Confirm Password</label>
        <input className="input" name="confirm" type="password" minLength={8} required />
      </div>
      <button className="btn-primary w-full justify-center !py-2.5 font-bold">
        <Check className="h-4 w-4" /> Update Password
      </button>
    </form>
  );
}

export function MentorRegisterForm({
  categories,
  locations,
  code
}: {
  categories: { id: string; name: string; color: string }[];
  locations: { id: string; building: string; floor: number; section: string }[];
  code?: string;
}) {
  const [cats, setCats] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<null | boolean>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr("");
    const r = await signUpMentor({
      fullName: String(f.get("name")),
      email: String(f.get("email")),
      password: String(f.get("password")),
      categoryIds: cats,
      locationId: String(f.get("location") || ""),
      code
    });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setDone(r.needsConfirmation);
  }

  if (done !== null)
    return (
      <div className="space-y-4">
        <Msg kind="ok">
          {done
            ? "Almost done — please check your email to confirm your address, then sign in."
            : "Account created successfully. You can now access your schedule."}
        </Msg>
        <Link href="/login" className="btn-primary w-full justify-center">
          Go to Sign In
        </Link>
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-4">
      {err && <Msg kind="error">{err}</Msg>}
      <div className="field">
        <label>Full Name</label>
        <input className="input" name="name" required minLength={2} placeholder="Dr. Sarah Connor" />
      </div>
      <div className="field">
        <label>Email</label>
        <input className="input" name="email" type="email" required placeholder="mentor@domain.com" />
      </div>
      <div className="field">
        <label>Password</label>
        <input className="input" name="password" type="password" minLength={8} required />
      </div>
      <div className="field">
        <label>Expertise Categories</label>
        <CategoryPicker categories={categories} value={cats} onChange={setCats} />
      </div>
      <div className="field">
        <label>Physical Station / Location</label>
        <select className="input" name="location" defaultValue="">
          <option value="" className="bg-[#090d24]">Not specified</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id} className="bg-[#090d24]">
              {l.building} · Floor {l.floor}
              {l.section ? ` · ${l.section}` : ""}
            </option>
          ))}
        </select>
      </div>
      <button className="btn-primary w-full justify-center !py-2.5 font-bold" disabled={busy}>
        {busy ? (
          "Registering…"
        ) : (
          <>
            <UserPlus className="h-4 w-4" /> Create Mentor Account
          </>
        )}
      </button>
      <div className="text-center pt-2 font-mono text-[11px]">
        <Link className="text-muted hover:text-white transition underline underline-offset-4" href="/login">
          Already registered? Sign in
        </Link>
      </div>
    </form>
  );
}
