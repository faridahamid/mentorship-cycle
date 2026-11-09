"use client";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  CalendarRange,
  Compass,
  Layers,
  LogIn,
  Shuffle
} from "lucide-react";

export function Hero() {
  return (
    <div className="min-h-screen flex flex-col justify-between relative overflow-hidden bg-[#080936] text-[#fff0cf]">
      {/* Topbar matching NASA Space Apps Cairo */}
      <header className="topbar">
        <Link href="/" className="brandLockup">
          <span className="brandOrb">
            <span />
          </span>
          <span>
            <strong>NASA SPACE APPS CAIRO</strong>
            <small>MENTOR CYCLE • ONE SPARK, INFINITE IMPACT</small>
          </span>
        </Link>

        <nav className="hidden md:flex navTabs" aria-label="Primary navigation">
          <Link className="navTab active" href="/">Overview</Link>
          <Link className="navTab" href="/login">Control Room</Link>
          <Link className="navTab" href="/register/mentor">Mentor Portal</Link>
        </nav>

        <div className="flex items-center gap-2.5">
          <Link className="iconBtn" aria-label="Sign in" href="/login" title="Sign In">
            <LogIn className="h-4 w-4 text-cream" />
          </Link>
          <Link className="btn-primary !text-xs font-bold" href="/login">
            Control Room <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* Main Landing Hero */}
      <main className="max-w-6xl mx-auto px-6 pt-12 pb-16 relative z-10 w-full flex-1 flex flex-col justify-center">
        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="eyebrow"
            >
              NASA SPACE APPS CAIRO • 2026
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-[1.08] text-white"
            >
              MENTOR CYCLE
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-orange via-cream to-cyan mt-1 text-3xl sm:text-4xl font-bold">
                ONE SPARK, INFINITE IMPACT
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.12 }}
              className="mt-5 text-base sm:text-lg text-[#c3c7e5] leading-relaxed max-w-xl"
            >
              The official mentor scheduling and rotation platform for NASA Space Apps Cairo 2026.
              Coordinates fair matching between specialized mentors and hackathon teams, live drag-and-drop session tracking, and real-time absence rebalancing.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="mt-8 flex flex-wrap gap-3.5 items-center"
            >
              <Link href="/login" className="btn-primary !py-3 !px-6 !text-sm">
                Enter Control Room <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/register/mentor" className="btn !py-3 !px-5 !text-sm">
                <Compass className="h-4 w-4 text-cyan" /> Mentor Registration
              </Link>
            </motion.div>
          </div>

          {/* Official NASA Space Apps Cairo Brand Visual */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="relative flex items-center justify-center py-6"
          >
            <div className="relative rounded-2xl p-4 border border-line bg-gradient-to-br from-white/[0.04] to-transparent shadow-2xl backdrop-blur-md max-w-md w-full">
              <Image
                src="/brand-2026.png"
                alt="NASA Space Apps Cairo 2026"
                width={600}
                height={350}
                priority
                className="w-full h-auto object-contain drop-shadow-[0_15px_35px_rgba(0,0,0,0.7)]"
              />
              <div className="mt-4 pt-3 border-t border-line flex items-center justify-between font-mono text-[10px] text-muted">
                <span>CAIRO LOCAL EVENT</span>
                <span className="text-orange font-bold">13—14 NOV 2026</span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Platform Core Capabilities */}
        <div className="mt-16 grid md:grid-cols-3 gap-5">
          <div className="panel p-5">
            <div className="w-9 h-9 rounded-xl bg-orange/10 border border-orange/30 flex items-center justify-center text-orange mb-3">
              <Shuffle className="h-4 w-4" />
            </div>
            <h3 className="text-base font-bold text-cream mb-1">Hungarian Rotation Matching</h3>
            <p className="text-xs text-[#969bc4] leading-relaxed">
              Equitably balances mentor session loads and maximizes team domain coverage across challenge tracks.
            </p>
          </div>

          <div className="panel p-5">
            <div className="w-9 h-9 rounded-xl bg-cyan/10 border border-cyan/30 flex items-center justify-center text-cyan mb-3">
              <Layers className="h-4 w-4" />
            </div>
            <h3 className="text-base font-bold text-cream mb-1">Live Drag & Drop Board</h3>
            <p className="text-xs text-[#969bc4] leading-relaxed">
              Interactive spreadsheet grid with slot locking, conflict detection, and export to Excel/PDF.
            </p>
          </div>

          <div className="panel p-5">
            <div className="w-9 h-9 rounded-xl bg-emerald/10 border border-emerald/30 flex items-center justify-center text-emerald mb-3">
              <CalendarRange className="h-4 w-4" />
            </div>
            <h3 className="text-base font-bold text-cream mb-1">Absence & Break Rebalancing</h3>
            <p className="text-xs text-[#969bc4] leading-relaxed">
              Instantly adapts the schedule when mentors take breaks or step out, while preserving locked sessions.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-line py-6 px-6 text-center font-mono text-[10px] text-muted tracking-wider">
        NASA SPACE APPS CAIRO 2026 • ONE SPARK, INFINITE IMPACT • MENTOR CYCLE
      </footer>
    </div>
  );
}
