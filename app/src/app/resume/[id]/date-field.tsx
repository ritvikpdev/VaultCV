"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";

import {
  formatMonthYear,
  isCompleteDate,
  maskMonthYear,
  MONTHS,
  parseMonthYear,
} from "@/lib/date-mask";
import { cn } from "@/lib/utils";

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR + 6 - 1970 }, (_, i) => THIS_YEAR + 5 - i);

/**
 * MM/YYYY input with a month/year picker.
 *
 * Typing is masked (see date-mask.ts). Only complete values — empty, MM/YYYY,
 * YYYY — reach `onChange`, so the preview never prints half a date; while a
 * value is partial it lives only in this field. Focusing opens the picker; the
 * X clears the field and the preview.
 */
export function DateField({
  id,
  value,
  onChange,
  disabled,
  placeholder = "MM / YYYY",
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const yearsRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  // Follow outside changes (picker, undo, server) unless mid-typing.
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    // Bring the selected (or current) year into view.
    yearsRef.current?.querySelector<HTMLElement>("[data-selected=true]")?.scrollIntoView({ block: "center" });
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const { month, year } = parseMonthYear(isCompleteDate(text) ? text : value);

  function set(next: string) {
    setText(next);
    if (isCompleteDate(next)) onChange(next);
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <CalendarDays
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          className={cn("field pl-9 pr-8", !isCompleteDate(text) && !open && "border-amber-300")}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={!isCompleteDate(text)}
          onFocus={() => {
            focused.current = true;
            setOpen(true);
          }}
          onBlur={() => {
            focused.current = false;
            // A half-typed date goes back to the last complete one.
            if (!isCompleteDate(text)) setText(value);
          }}
          onChange={(e) => {
            const deleting = e.target.value.length < text.length;
            set(maskMonthYear(e.target.value, deleting));
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
              e.stopPropagation();
              setOpen(false);
            }
            if (e.key === "Enter") setOpen(false);
          }}
        />
        {text && !disabled && (
          <button
            type="button"
            aria-label="Clear date"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:bg-line hover:text-ink"
            onClick={() => {
              set("");
              setOpen(false);
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="absolute left-0 top-full z-30 mt-2 flex w-60 animate-pop-in gap-1 rounded-xl border border-line bg-surface p-2 shadow-lift">
          <div className="grid flex-1 grid-cols-2 gap-1" role="listbox" aria-label="Month">
            {MONTHS.map((m, i) => (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={month === i + 1}
                className={cn(
                  "rounded-lg px-2 py-1.5 text-xs transition-colors",
                  month === i + 1 ? "bg-violet font-medium text-white" : "hover:bg-violetSoft",
                )}
                // Keep focus in the input so typing can continue after a click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => set(formatMonthYear(i + 1, year ?? THIS_YEAR))}
              >
                {m}
              </button>
            ))}
          </div>
          <div
            ref={yearsRef}
            className="max-h-48 w-16 overflow-y-auto border-l border-line pl-1"
            role="listbox"
            aria-label="Year"
          >
            {YEARS.map((y) => (
              <button
                key={y}
                type="button"
                role="option"
                aria-selected={year === y}
                data-selected={year === y || (year === null && y === THIS_YEAR)}
                className={cn(
                  "block w-full rounded-lg px-2 py-1 text-left text-xs transition-colors",
                  year === y ? "bg-violet font-medium text-white" : "hover:bg-violetSoft",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => set(formatMonthYear(month, y))}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
