"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/** Modal built on <dialog> so Escape, focus trapping and backdrop come free. */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Clicking the backdrop closes; clicking the panel does not.
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "w-full rounded-card border border-line bg-surface p-0 text-ink backdrop:bg-black/40",
        wide ? "max-w-3xl" : "max-w-xl",
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
    </dialog>
  );
}

/** Destructive-action guard. Nothing in the vault deletes without one. */
export function ConfirmButton({
  onConfirm,
  message,
  children,
  className,
  ...rest
}: {
  onConfirm: () => void;
  message: string;
  children: React.ReactNode;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      {...rest}
      type="button"
      className={className}
      onClick={() => {
        if (window.confirm(message)) onConfirm();
      }}
    >
      {children}
    </button>
  );
}

const STRENGTH_COLORS = [
  "bg-red-400",
  "bg-orange-400",
  "bg-yellow-400",
  "bg-lime-500",
  "bg-emerald-500",
];

/** Five-segment strength meter. Title carries the explanation. */
export function StrengthMeter({
  score,
  title,
}: {
  score: number;
  title?: string;
}) {
  return (
    <span className="inline-flex items-center gap-0.5" title={title}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={cn(
            "h-1 w-3 rounded-full",
            n <= score ? STRENGTH_COLORS[score - 1] : "bg-line",
          )}
        />
      ))}
    </span>
  );
}
