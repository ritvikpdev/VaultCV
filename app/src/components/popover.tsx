"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A button that toggles a floating panel beneath it.
 *
 * Closes on outside click and on Escape (which is swallowed, so an enclosing
 * editor or panel doesn't also close). Focus returns to the trigger on close
 * so keyboard users stay where they were. `children` may be a function to get
 * a `close` callback — menu items close the menu after acting.
 *
 * Deliberately no portal: the panel is positioned against its wrapper, which
 * is enough for menus in bars and cards and keeps it inside the same stacking
 * context as the thing it belongs to.
 */
export function Popover({
  trigger,
  label,
  children,
  align = "left",
  className,
  panelClassName,
  triggerClassName,
  onOpenChange,
}: {
  trigger: React.ReactNode;
  /** Accessible name for the trigger button. */
  label: string;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: "left" | "right";
  className?: string;
  panelClassName?: string;
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const set = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const close = useCallback(() => {
    set(false);
    triggerRef.current?.focus();
  }, [set]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) set(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, set]);

  return (
    <div
      ref={wrapRef}
      className={cn("relative", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        className={triggerClassName}
        onClick={() => set(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div
          className={cn(
            "absolute top-full z-40 mt-2 min-w-48 animate-pop-in rounded-xl border border-line bg-surface p-1.5 shadow-lift",
            align === "right" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/** One row of a menu inside a Popover. */
export function MenuItem({
  icon,
  children,
  onClick,
  href,
  disabled,
  danger,
  hint,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Small right-aligned note, e.g. "Soon". */
  hint?: string;
}) {
  const cls = cn(
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
    disabled
      ? "cursor-not-allowed text-muted/60"
      : danger
        ? "text-red-600 hover:bg-red-50"
        : "text-ink hover:bg-canvas",
  );
  const body = (
    <>
      {icon && <span className="shrink-0 text-current opacity-80">{icon}</span>}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{hint}</span>}
    </>
  );

  if (href && !disabled) {
    return (
      <a href={href} className={cls} target="_blank" rel="noreferrer">
        {body}
      </a>
    );
  }
  return (
    <button type="button" className={cls} disabled={disabled} onClick={onClick}>
      {body}
    </button>
  );
}
