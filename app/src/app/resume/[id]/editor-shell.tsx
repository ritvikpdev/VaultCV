"use client";

import { useState } from "react";
import { ArrowLeft, ChevronDown, Eye, EyeOff, Lightbulb, Trash2 } from "lucide-react";

import { Popover } from "@/components/popover";
import { ConfirmButton } from "@/components/ui";
import type { SectionType } from "@/db/schema";
import { cn } from "@/lib/utils";

/**
 * The editor view's frame: header card with the form, a Done card, and the
 * section's customizations folded underneath.
 *
 * There is no Save: every field writes to the draft as you type and the
 * preview follows on the same frame. Done only navigates back to the list.
 */
export function EditorShell({
  title,
  onBack,
  tips,
  visible,
  onToggleVisible,
  onDelete,
  deleteMessage,
  toolbar,
  customizations,
  children,
}: {
  title: string;
  onBack: () => void;
  tips?: string[];
  /** Omit for things that can't be hidden (personal details). */
  visible?: boolean;
  onToggleVisible?: () => void;
  onDelete?: () => void;
  deleteMessage?: string;
  /** Actions shown under the header — vault buttons, source tag. */
  toolbar?: React.ReactNode;
  customizations?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [custOpen, setCustOpen] = useState(false);

  return (
    <div className="animate-slide-in-left space-y-3">
      <div className="card p-5">
        <div className="flex items-center gap-2">
          <button
            className="-ml-1.5 rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink"
            onClick={onBack}
            aria-label="Back to the list"
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <h2 className="flex-1 text-lg font-semibold tracking-tight">{title}</h2>

          {tips && tips.length > 0 && (
            <Popover
              label="Writing tips"
              align="right"
              triggerClassName="rounded-lg p-1.5 text-muted transition-colors hover:bg-amber-50 hover:text-amber-600"
              trigger={<Lightbulb size={16} />}
              panelClassName="w-72 p-3"
            >
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Lightbulb size={14} className="text-amber-500" /> Tips
              </p>
              <ul className="space-y-1.5 text-xs leading-relaxed text-muted">
                {tips.map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet" />
                    {t}
                  </li>
                ))}
              </ul>
            </Popover>
          )}

          {onToggleVisible && (
            <button
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink"
              onClick={onToggleVisible}
              aria-label={visible ? "Hide from resume" : "Show on resume"}
              aria-pressed={!visible}
              title={visible ? "Hide from resume" : "Show on resume"}
            >
              {visible ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          )}

          {onDelete && (
            <ConfirmButton
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-red-50 hover:text-red-600"
              title="Delete"
              aria-label="Delete"
              message={deleteMessage ?? "Delete this? You can undo for a few seconds."}
              onConfirm={onDelete}
            >
              <Trash2 size={16} />
            </ConfirmButton>
          )}
        </div>

        {visible === false && (
          <p className="mt-3 rounded-xl bg-canvas px-3 py-2 text-xs text-muted">
            Hidden — kept here, left off this resume.
          </p>
        )}

        {toolbar && <div className="mt-3">{toolbar}</div>}

        <div className="mt-5 space-y-4">{children}</div>
      </div>

      <div className="card p-3">
        <button className="btn-gradient w-full py-3 text-base" onClick={onBack}>
          Done
        </button>
      </div>

      {customizations && (
        <div className="card overflow-hidden">
          <button
            className="flex w-full items-center justify-between px-5 py-3.5 text-left text-sm font-medium transition-colors hover:bg-canvas/60"
            aria-expanded={custOpen}
            onClick={() => setCustOpen((o) => !o)}
          >
            Show customizations for this section
            <ChevronDown size={16} className={cn("text-muted transition-transform duration-200", custOpen && "rotate-180")} />
          </button>
          {custOpen && <div className="animate-fade-in border-t border-line px-5 py-4">{customizations}</div>}
        </div>
      )}
    </div>
  );
}

/** A labelled field. */
export function Field({
  id,
  label,
  hint,
  children,
  aside,
}: {
  id?: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
  /** Small control on the label's right — e.g. the Link toggle. */
  aside?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-ink" htmlFor={id}>
          {label}
        </label>
        {aside}
      </div>
      {children}
      {hint && <p className="hint mt-1">{hint}</p>}
    </div>
  );
}

/** Segmented control for the customization toggles. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <div className="inline-flex flex-wrap gap-1 rounded-xl bg-canvas p-1" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs transition-all duration-150",
              value === o.value ? "bg-surface font-medium text-ink shadow-card" : "text-muted hover:text-ink",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Writing tips per section type, for the lightbulb. */
export const SECTION_TIPS: Partial<Record<SectionType, string[]>> & { default: string[] } = {
  experience: [
    "Lead each bullet with a strong verb: built, led, cut, shipped.",
    "Put a number in it — users, latency, revenue, time saved.",
    "Name the technology you used; the tuner matches on it.",
    "Three to five bullets for recent roles, one or two for older ones.",
  ],
  education: [
    "List the degree as it's officially named.",
    "Add GPA only if it helps (roughly 3.5+/4 or equivalent).",
    "Relevant coursework, honours or a thesis title can go in the description.",
  ],
  project: [
    "Say what it does in one line, then what you built.",
    "Link the repository or demo with the Link button.",
    "Quantify: stars, users, performance, scale.",
  ],
  skill: [
    "Group skills into lines: Languages, Frameworks, Cloud, Tools.",
    "Match the wording of the job description where it's true.",
    "Lead each line with the skills you're strongest in.",
  ],
  default: [
    "Keep it to what's relevant for the role you're targeting.",
    "Short, specific lines read better than long paragraphs.",
    "Use the eye to hide entries rather than deleting them.",
  ],
};

export function tipsFor(type: SectionType): string[] {
  return SECTION_TIPS[type] ?? SECTION_TIPS.default;
}
