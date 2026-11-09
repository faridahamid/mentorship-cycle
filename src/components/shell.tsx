"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Bell,
  BookOpenCheck,
  CalendarRange,
  Database,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  ScrollText,
  Tags,
  UserCog,
  Users,
  Users2,
  X
} from "lucide-react";
import { useState } from "react";
import { signOut, markNotificationsRead } from "@/app/actions/admin";
import { cn } from "@/lib/utils";

const icons = {
  dash: LayoutDashboard,
  cycles: CalendarRange,
  teams: Users,
  mentors: Users2,
  cats: Tags,
  loc: MapPin,
  users: UserCog,
  audit: ScrollText,
  system: Database,
  me: BookOpenCheck
} as const;

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof icons;
}

export function Shell({
  nav,
  user,
  notifications,
  children
}: {
  nav: NavItem[];
  user: { name: string; role: string };
  notifications: { id: string; message: string; read: boolean; created_at: string }[];
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="flex min-h-screen bg-[#080936] text-[#fff0cf]">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-line bg-[#080936]/95 p-5 backdrop-blur-2xl transition-transform md:static md:translate-x-0 flex flex-col justify-between",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div>
          {/* NASA Space Apps Cairo Brand Lockup */}
          <div className="mb-7 flex items-center justify-between">
            <Link href="/" className="brandLockup">
              <span className="brandOrb">
                <span />
              </span>
              <span>
                <strong>NASA SPACE APPS CAIRO</strong>
                <small>MENTOR CYCLE • CONTROL ROOM</small>
              </span>
            </Link>
            <button
              className="md:hidden text-muted hover:text-white"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="eyebrow px-3 mb-2">MANAGEMENT</div>
          <nav className="space-y-1">
            {nav.map((n) => {
              const Icon = icons[n.icon];
              const active = n.href === path || (n.href.length > 6 && path.startsWith(n.href));
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold tracking-wide transition-all",
                    active ? "text-navy font-bold" : "text-[#969bc4] hover:bg-white/5 hover:text-cream"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="navpill"
                      className="absolute inset-0 -z-0 rounded-xl bg-cream shadow-[0_0_15px_rgba(255,240,207,0.25)]"
                    />
                  )}
                  <Icon className={cn("relative z-10 h-4 w-4", active ? "text-navy" : "text-cyan")} />
                  <span className="relative z-10">{n.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User profile & sign out */}
        <div className="pt-4 border-t border-line space-y-3">
          <div className="rounded-xl border border-line bg-white/[0.03] p-3 backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="liveDot" />
              <div className="truncate font-bold text-xs text-cream">{user.name}</div>
            </div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted">
              {user.role.replace("_", " ")}
            </div>
          </div>

          <form action={signOut}>
            <button className="btn w-full justify-center !rounded-xl !py-2 text-xs border-red-500/30 text-[#ffaaa0] hover:bg-red-500/10">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="min-w-0 flex-1 flex flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b border-line bg-[#080936]/80 px-6 backdrop-blur-xl md:justify-end">
          <button
            className="btn btn-ghost md:hidden !p-2"
            onClick={() => setOpen(!open)}
            aria-label="Toggle navigation"
          >
            <Menu className="h-5 w-5 text-cream" />
          </button>

          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                className="iconBtn relative"
                onClick={() => {
                  setBell(!bell);
                  if (!bell && unread) markNotificationsRead();
                }}
                aria-label="Notifications"
                title="Notifications"
              >
                <Bell className="h-4 w-4 text-cream" />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-orange px-1 font-mono text-[9px] font-bold text-navy shadow-[0_0_8px_#ffab2e]">
                    {unread}
                  </span>
                )}
              </button>

              {bell && (
                <div className="panel absolute right-0 mt-3 max-h-96 w-80 overflow-auto p-3 text-xs shadow-2xl z-50">
                  <div className="panelHead !p-2 !mb-2">
                    <h2>NOTIFICATIONS</h2>
                    <span className="font-mono text-[10px] text-muted">{notifications.length} TOTAL</span>
                  </div>
                  {notifications.length === 0 && (
                    <p className="p-4 text-center font-mono text-muted text-[11px]">No notifications.</p>
                  )}
                  <div className="space-y-1.5">
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        className={cn(
                          "rounded-xl border border-line p-2.5 transition",
                          !n.read ? "bg-cyan/10 border-cyan/30 text-cream" : "bg-white/[0.02] text-muted"
                        )}
                      >
                        <div className="font-medium text-cream">{n.message}</div>
                        <div className="mt-1 font-mono text-[9px] text-muted">
                          {new Date(n.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-6 md:p-8 flex-1">{children}</main>
      </div>
    </div>
  );
}
