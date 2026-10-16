"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Pencil } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A name you rename by clicking it.
 *
 * Reads as plain text with a faint pencil; a click (or Enter on focus) turns it
 * into an input with the text selected. Enter or clicking away saves, Escape
 * puts the old name back. An empty name is refused rather than saved, and a
 * failed save keeps the field open with the reason, so nothing is lost.
 */
export function RenameField({
  value,
  onSave,
  label,
  className,
  inputClassName,
}: {
  value: string;
  onSave: (next: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** What is being renamed, for screen readers — e.g. "resume". */
  label: string;
  className?: string;
  inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Follow a rename made elsewhere (the details dialog), unless mid-edit.
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function save() {
    const next = text.trim();
    if (!next) {
      setError("A name can't be empty");
      return;
    }
    if (next === value) {
      setEditing(false);
      setError(null);
      return;
    }
    startTransition(async () => {
      const result = await onSave(next);
      if (result.ok) {
        setEditing(false);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }

  if (editing) {
    return (
      <div className={cn("min-w-0", className)}>
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            aria-label={`Rename ${label}`}
            className={cn("field py-1.5 font-semibold", inputClassName)}
            value={text}
            maxLength={120}
            disabled={pending}
            onChange={(e) => setText(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setText(value);
                setError(null);
                setEditing(false);
              }
            }}
          />
          {pending && <Loader2 size={14} className="shrink-0 animate-spin text-muted" />}
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "group/rename flex min-w-0 items-center gap-1.5 rounded-lg text-left transition-colors hover:bg-canvas",
        className,
      )}
      title="Click to rename"
      aria-label={`${value} — click to rename ${label}`}
      onClick={() => setEditing(true)}
    >
      <span className="truncate">{value}</span>
      <Pencil size={12} className="shrink-0 text-muted opacity-40 transition-opacity group-hover/rename:opacity-100" />
    </button>
  );
}
