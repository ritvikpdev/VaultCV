"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Text that becomes an input when you click it, and saves when you leave.
 *
 * It is always an <input> — styled flat until hovered or focused — rather than
 * a span that swaps for an input. A swap moves the caret to the end and loses
 * the click position, and the layout jumps by the input's padding.
 *
 * Enter and blur commit; Escape restores what was there and stops the key from
 * also closing the panel around it. A value that fails `validate` is held in
 * the field with the reason shown, not committed and not thrown away.
 */
export function InlineField({
  value,
  onCommit,
  placeholder,
  validate,
  label,
  className,
  disabled = false,
  autoFocus = false,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  /** Returns a reason the value can't be saved, or null. */
  validate?: (next: string) => string | null;
  /** Accessible name; the panel's visual labels sit beside rather than wrap. */
  label: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);

  // Follow outside changes (another field's save revalidating the page), but
  // never while the user is typing here.
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);

  function commit() {
    const next = text.trim();
    if (next === value.trim()) {
      setError(null);
      return;
    }
    const reason = validate?.(next) ?? null;
    setError(reason);
    if (!reason) onCommit(next);
  }

  return (
    <div className="min-w-0">
      <input
        aria-label={label}
        aria-invalid={Boolean(error)}
        className={cn(
          "-mx-2 w-[calc(100%+1rem)] rounded-md border border-transparent bg-transparent px-2 py-1",
          "outline-none transition-colors placeholder:text-muted/60",
          "hover:bg-canvas focus:border-accent focus:bg-surface",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
          error && "border-red-400 bg-red-50/50",
          className,
        )}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.stopPropagation();
            setText(value);
            setError(null);
            // Restore first, then blur — blurring commits, and must see the
            // restored text so it finds nothing to save.
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
      />
      {error && <p className="mt-0.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
