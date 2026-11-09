"use client";
import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { commitChange, previewChange } from "@/app/actions/cycles";
import type { Change } from "@/lib/cycle-model";
import type { PreviewResult } from "@/lib/change-service";
import { Modal, Msg } from "@/components/ui";

/**
 * Preview-then-apply flow shared by the board, availability panels and mentor dashboard.
 * Changes that alter no assignments are applied immediately; anything else shows a diff first.
 */
export function useChangeFlow(cycleId: string, opts: { onDone?: () => void; role?: "mentor" | "admin" } = {}) {
  const router = useRouter();
  const [pending, setPending] = useState<{ change: Change; title: string; preview: PreviewResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const finish = useCallback(() => {
    setPending(null);
    router.refresh();
    opts.onDone?.();
  }, [router, opts]);

  const apply = useCallback(
    async (change: Change) => {
      setBusy(true);
      setError("");
      const r = await commitChange(cycleId, change);
      setBusy(false);
      if (!r.ok) {
        setError(r.error);
        return false;
      }
      setNotice(`Applied: ${r.added} added, ${r.removed} removed.`);
      finish();
      return true;
    },
    [cycleId, finish]
  );

  const ask = useCallback(
    async (change: Change, title: string, force = false) => {
      setBusy(true);
      setError("");
      setNotice("");
      const r = await previewChange(cycleId, change);
      setBusy(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const p = r.preview;
      if (!force && p.added.length + p.removed.length === 0 && p.hidden === 0) await apply(change);
      else setPending({ change, title, preview: p });
    },
    [cycleId, apply]
  );

  const node: ReactNode = (
    <>
      <Modal open={!!pending} onClose={() => setPending(null)} title={pending?.title ?? ""} wide>
        {pending && (
          <div className="space-y-4 text-xs font-mono">
            <p className="text-muted leading-relaxed">
              {pending.preview.removed.length === 0
                ? `Ready to generate and assign ${pending.preview.added.length} optimal sessions across all participating mentors and teams.`
                : `Review the proposed schedule diff. Unaffected slots (${pending.preview.unchanged} assignments) remain locked in place.`}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <DiffList title={`Removed (${pending.preview.removed.length})`} tone="red" rows={pending.preview.removed} />
              <DiffList title={`Added (${pending.preview.added.length})`} tone="green" rows={pending.preview.added} />
            </div>
            {pending.preview.hidden > 0 && (
              <Msg kind="info">
                {pending.preview.hidden} other session(s) will be automatically rebalanced between available mentors.
              </Msg>
            )}
            {pending.preview.issues
              .filter((i) => i.severity !== "info")
              .slice(0, 8)
              .map((i, k) => (
                <Msg key={k} kind={i.severity === "error" ? "error" : "info"}>
                  {i.message}
                </Msg>
              ))}
            {error && <Msg kind="error">{error}</Msg>}
            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button className="btn" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button className="launchBtn font-bold" disabled={busy} onClick={() => apply(pending.change)}>
                {busy
                  ? "Applying Changes…"
                  : pending.preview.removed.length === 0
                  ? "Commit & Save Schedule"
                  : "Apply Schedule Diff"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );

  return {
    ask,
    apply,
    node,
    busy,
    error,
    notice,
    clear: () => {
      setError("");
      setNotice("");
    }
  };
}

function DiffList({
  title,
  rows,
  tone
}: {
  title: string;
  tone: "red" | "green";
  rows: { slot: string; mentor: string; team: string }[];
}) {
  return (
    <div
      className={`rounded-2xl border p-3 backdrop-blur ${
        tone === "red"
          ? "border-red-500/30 bg-red-500/10 text-[#ffaaa0]"
          : "border-[#65ffbd]/30 bg-[#65ffbd]/10 text-[#65ffbd]"
      }`}
    >
      <div className="mb-2 font-display text-base tracking-wide uppercase">{title}</div>
      <div className="max-h-56 space-y-1 overflow-auto font-mono text-[11px]">
        {rows.slice(0, 200).map((r, i) => (
          <div key={i} className="flex justify-between items-center py-0.5 border-b border-white/5">
            <span>{r.slot}</span>
            <span className="font-bold">{r.mentor} ↔ {r.team}</span>
          </div>
        ))}
        {!rows.length && <div className="text-muted font-mono text-[10px]">None</div>}
      </div>
    </div>
  );
}
