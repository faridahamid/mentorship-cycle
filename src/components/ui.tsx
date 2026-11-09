"use client";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Info, X, XCircle } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function CatChip({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      className={cn("chip border border-white/10 font-mono text-[10px]", className)}
      style={{
        backgroundColor: `${color}25`,
        borderColor: `${color}40`,
        color: color
      }}
    >
      {name}
    </span>
  );
}

export function Msg({ kind, children }: { kind: "error" | "ok" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-red-500/30 bg-red-500/10 text-[#fca5a5]",
    ok: "border-emerald/30 bg-emerald/10 text-emerald",
    info: "border-cyan/30 bg-cyan/10 text-[#bafaff]"
  }[kind];

  const Icon = kind === "error" ? XCircle : kind === "ok" ? CheckCircle2 : Info;

  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-medium backdrop-blur", styles)}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  extraWide,
  className
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  extraWide?: boolean;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modalBackdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ y: 20, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 16, opacity: 0 }}
            className={cn(
              "modal",
              extraWide
                ? "!max-w-6xl !w-[95vw]"
                : wide
                ? "!max-w-5xl !w-[92vw]"
                : "!max-w-lg",
              className
            )}
          >
            <div className="modalHeader">
              <div>
                <span className="eyebrow">WORKSPACE DIALOG</span>
                <h3 className="text-xl font-extrabold text-white">{title}</h3>
              </div>
              <button className="close" onClick={onClose} aria-label="Close dialog">
                <X className="h-4 w-4 text-muted hover:text-white" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function CategoryPicker({
  categories,
  value,
  onChange
}: {
  categories: { id: string; name: string; color: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((c) => {
        const on = value.includes(c.id);
        return (
          <button
            type="button"
            key={c.id}
            onClick={() => onChange(on ? value.filter((x) => x !== c.id) : [...value, c.id])}
            className="rounded-full border px-3 py-1 font-mono text-[10px] font-semibold tracking-wide transition-all"
            style={{
              borderColor: on ? c.color : "rgba(255, 255, 255, 0.12)",
              backgroundColor: on ? `${c.color}20` : "rgba(255, 255, 255, 0.02)",
              color: on ? c.color : "#8e96bb",
              boxShadow: on ? `0 0 10px ${c.color}33` : "none"
            }}
          >
            {on ? "✦ " : ""}{c.name}
          </button>
        );
      })}
      {!categories.length && <span className="font-mono text-xs text-muted">No categories defined.</span>}
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  actions
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white m-0">
          {title}
        </h1>
        {sub && <p className="mt-1 font-mono text-xs text-[#8e96bb]">{sub}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">{actions}</div>
    </div>
  );
}

export { locLabel } from "@/lib/utils";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className
}: PaginationProps) {
  if (totalItems === 0) return null;

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  // Generate page numbers with ellipsis windowing
  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (currentPage <= 4) {
      return [1, 2, 3, 4, 5, "...", totalPages];
    }
    if (currentPage >= totalPages - 3) {
      return [1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
  };

  const pages = getPageNumbers();

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 pt-3 pb-2 border-t border-line/60 px-4",
        className
      )}
    >
      <div className="flex items-center gap-3 font-mono text-xs text-muted">
        <span>
          Showing <b className="text-cream">{startItem}</b>–<b className="text-cream">{endItem}</b> of{" "}
          <b className="text-cream">{totalItems}</b>
        </span>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-[11px] text-muted/70">Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
              className="bg-black/40 border border-line rounded px-1.5 py-0.5 text-[11px] font-mono text-cream focus:outline-none focus:border-cyan"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt} className="bg-bg text-cream">
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={currentPage <= 1}
            aria-label="First page"
            title="First page"
            className="p-1.5 rounded-lg text-muted hover:text-cream hover:bg-white/5 disabled:opacity-25 disabled:cursor-not-allowed transition"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Previous page"
            title="Previous page"
            className="p-1.5 rounded-lg text-muted hover:text-cream hover:bg-white/5 disabled:opacity-25 disabled:cursor-not-allowed transition"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-1">
            {pages.map((p, idx) => {
              if (p === "...") {
                return (
                  <span key={`ellipsis-${idx}`} className="px-2 font-mono text-xs text-muted select-none">
                    …
                  </span>
                );
              }
              const pageNum = p as number;
              const isActive = pageNum === currentPage;
              return (
                <button
                  type="button"
                  key={pageNum}
                  onClick={() => onPageChange(pageNum)}
                  className={cn(
                    "min-w-[28px] h-7 px-2 rounded-lg font-mono text-xs transition flex items-center justify-center font-bold",
                    isActive
                      ? "bg-cyan text-black shadow-[0_0_10px_rgba(88,239,255,0.35)]"
                      : "text-muted hover:text-cream hover:bg-white/5"
                  )}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            aria-label="Next page"
            title="Next page"
            className="p-1.5 rounded-lg text-muted hover:text-cream hover:bg-white/5 disabled:opacity-25 disabled:cursor-not-allowed transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage >= totalPages}
            aria-label="Last page"
            title="Last page"
            className="p-1.5 rounded-lg text-muted hover:text-cream hover:bg-white/5 disabled:opacity-25 disabled:cursor-not-allowed transition"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
