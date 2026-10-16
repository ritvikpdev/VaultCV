"use client";

import { useRef, useState } from "react";
import { CalendarDays, Copy, GripVertical, Loader2, MapPin, Pin } from "lucide-react";

import { NicknameChip } from "@/components/section-path";
import { StrengthMeter } from "@/components/ui";
import type { EntryWithBullets } from "@/db/queries";
import { STRENGTH_LABELS } from "@/lib/bullet-strength";
import { splitSkillTokens } from "@/lib/skill-index";
import type { SortableHandleProps } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";

/** "01/2022 – Present", or "" when the entry has no dates at all. */
export function dateRange(entry: {
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}): string {
  if (!entry.startDate && !entry.endDate && !entry.isCurrent) return "";
  const end = entry.isCurrent ? "Present" : entry.endDate;
  return [entry.startDate, end].filter(Boolean).join(" – ");
}

/**
 * Soft tints for entry badges. Listed literally so Tailwind keeps them; picked
 * by a hash of the name so one employer keeps its colour across sections and
 * across visits, with nothing stored.
 */
const BADGE_TONES = [
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-800",
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
  "bg-orange-100 text-orange-700",
  "bg-indigo-100 text-indigo-700",
];

function tone(name: string): string {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return BADGE_TONES[Math.abs(h) % BADGE_TONES.length]!;
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Monogram for an entry: the organization if there is one, else the title. */
export function EntryBadge({
  name,
  size = "md",
}: {
  name: string;
  size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl font-semibold tracking-tight",
        size === "lg" ? "h-12 w-12 text-base" : "h-10 w-10 text-sm",
        tone(name || "?"),
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Movement past this between press and click means it was a drag, not a click. */
const CLICK_SLOP_PX = 5;

export function EntryTile({
  entry,
  isSkill,
  onOpen,
  onDuplicate,
  dragging,
  register,
  handle,
}: {
  entry: EntryWithBullets;
  isSkill: boolean;
  onOpen: () => void;
  /** Copy this entry (and its bullets); resolves once the copy exists. */
  onDuplicate: () => Promise<void>;
  dragging: boolean;
  register: (el: HTMLElement | null) => void;
  handle: SortableHandleProps;
}) {
  // A drag that starts on the grip and ends over this same tile still fires a
  // click on it. Remember where the press began and ignore clicks that moved.
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const [duplicating, setDuplicating] = useState(false);

  const range = dateRange(entry);
  const pinned = entry.bullets.filter((b) => b.isPinned).length;
  const avg = entry.bullets.length
    ? Math.round(entry.bullets.reduce((n, b) => n + b.strength, 0) / entry.bullets.length)
    : 0;
  const skills = isSkill ? splitSkillTokens(entry.information) : [];
  const shownSkills = skills.slice(0, 8);

  return (
    <div
      ref={register}
      role="button"
      tabIndex={0}
      aria-label={`Open ${entry.title}`}
      onPointerDown={(e) => (pressedAt.current = { x: e.clientX, y: e.clientY })}
      onClick={(e) => {
        const p = pressedAt.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP_PX) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "card group flex cursor-pointer flex-col gap-3 p-4 text-left outline-none transition-all duration-150",
        "hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-lift",
        "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-3">
        <EntryBadge name={entry.organization || entry.title} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-semibold leading-snug">
            {entry.title}
            {entry.nickname && <NicknameChip nickname={entry.nickname} className="align-middle" />}
          </p>
          {!isSkill && entry.organization && (
            <p className="mt-0.5 truncate text-sm text-muted">{entry.organization}</p>
          )}
          {isSkill && entry.level && (
            <p className="mt-0.5 text-sm capitalize text-muted">{entry.level}</p>
          )}
        </div>
        <button
          type="button"
          // Its own click, not the tile's — the tile opens the entry.
          onClick={(e) => {
            e.stopPropagation();
            if (duplicating) return;
            setDuplicating(true);
            void onDuplicate().finally(() => setDuplicating(false));
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="shrink-0 rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-ink focus:opacity-100 group-hover:opacity-100"
          title="Duplicate"
          aria-label={`Duplicate ${entry.title}`}
        >
          {duplicating ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
        </button>
        <span
          {...handle}
          onClick={(e) => e.stopPropagation()}
          className="-mr-1 shrink-0 rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-ink focus:opacity-100 group-hover:opacity-100"
          title="Drag to reorder"
        >
          <GripVertical size={15} />
        </span>
      </div>

      {isSkill ? (
        shownSkills.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {shownSkills.map((s) => (
              <span key={s} className="rounded-full bg-canvas px-2 py-0.5 text-xs">
                {s}
              </span>
            ))}
            {skills.length > shownSkills.length && (
              <span className="rounded-full px-1.5 py-0.5 text-xs text-muted">
                +{skills.length - shownSkills.length} more
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-amber-700">No skills listed yet</p>
        )
      ) : (
        <>
          {entry.subtitle && (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted">{entry.subtitle}</p>
          )}
          {(range || entry.location) && (
            <div className="flex flex-wrap gap-1.5">
              {range && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                    entry.isCurrent ? "bg-emerald-50 text-emerald-800" : "bg-canvas text-muted",
                  )}
                >
                  <CalendarDays size={11} />
                  {range}
                </span>
              )}
              {entry.location && (
                <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-canvas px-2 py-0.5 text-xs text-muted">
                  <MapPin size={11} className="shrink-0" />
                  <span className="truncate">{entry.location}</span>
                </span>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
        {isSkill ? (
          <span>
            {skills.length} skill{skills.length === 1 ? "" : "s"}
          </span>
        ) : entry.bullets.length === 0 ? (
          <span className="text-amber-700">No bullets yet</span>
        ) : (
          <>
            <span className="flex items-center gap-2">
              {entry.bullets.length} bullet{entry.bullets.length === 1 ? "" : "s"}
              {pinned > 0 && (
                <span className="inline-flex items-center gap-0.5 text-accent" title={`${pinned} pinned`}>
                  <Pin size={11} fill="currentColor" />
                  {pinned}
                </span>
              )}
            </span>
            <StrengthMeter
              score={avg}
              title={`Average writing strength: ${STRENGTH_LABELS[avg]}`}
            />
          </>
        )}
      </div>
    </div>
  );
}
