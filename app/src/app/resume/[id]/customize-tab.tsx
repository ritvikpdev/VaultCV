"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Eye,
  EyeOff,
  GripVertical,
  Minus,
  Plus,
  RotateCcw,
  Scissors,
  SeparatorHorizontal,
} from "lucide-react";

import { ConfirmButton } from "@/components/ui";
import type { ResumeStyle } from "@/db/schema";
import type { ResolvedSection } from "@/lib/resume-model";
import {
  clampStyleValue,
  COMPACTION_ORDER,
  DATE_POSITIONS,
  FONT_FAMILIES,
  FONT_SLIDERS,
  HEADING_STYLES,
  inchesToMm,
  MARGIN_SLIDERS,
  mmToInches,
  PAGE_SIZES,
  SPACING_SLIDERS,
  SUBTITLE_STYLES,
  type NumericStyleKey,
  type SliderSpec,
} from "@/lib/style-presets";
import { useSortable } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";

import { reorderResumeSections } from "../actions";
import {
  resetResumeStyle,
  setSectionPageBreak,
  toggleSectionVisible,
  type StylePatch,
} from "../style-actions";

function Slider({
  spec,
  value,
  onChange,
}: {
  spec: SliderSpec;
  value: number;
  onChange: (v: number) => void;
}) {
  const step = (delta: number) =>
    onChange(clampStyleValue(spec.key, Number((value + delta).toFixed(2))));

  // Trailing zeros read as noise on integer-valued controls.
  const display = Number.isInteger(value) ? value : value.toFixed(2).replace(/0$/, "");

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-sm">{spec.label}</label>
        <span className="text-xs tabular-nums text-muted">
          {display}
          {spec.unit}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="range"
          className="h-1 flex-1 cursor-pointer accent-accent"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <button
          className="rounded border border-line p-1 text-muted hover:bg-canvas disabled:opacity-30"
          onClick={() => step(-spec.step)}
          disabled={value <= spec.min}
          aria-label={`Decrease ${spec.label}`}
        >
          <Minus size={12} />
        </button>
        <button
          className="rounded border border-line p-1 text-muted hover:bg-canvas disabled:opacity-30"
          onClick={() => step(spec.step)}
          disabled={value >= spec.max}
          aria-label={`Increase ${spec.label}`}
        >
          <Plus size={12} />
        </button>
      </div>

      {spec.hint && value <= spec.min + spec.step && (
        <p className="hint mt-1 text-amber-600">{spec.hint}</p>
      )}
    </div>
  );
}

function Group({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && <p className="hint mt-0.5">{subtitle}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function CustomizeTab({
  resumeId,
  sections,
  style,
  pages,
  onChange,
  onCommit,
}: {
  resumeId: number;
  sections: ResolvedSection[];
  style: ResumeStyle;
  pages: number;
  onChange: (patch: StylePatch) => void;
  onCommit: (patch: StylePatch) => void;
}) {
  const [, startTransition] = useTransition();
  const [compacting, setCompacting] = useState(false);

  const sectionById = useMemo(
    () => new Map(sections.map((s) => [s.id, s])),
    [sections],
  );

  const sectionOrder = useMemo(
    () => ({ sections: sections.map((s) => s.id) }),
    [sections],
  );

  /**
   * Section order lives here now — the Content tab has no move controls at all.
   *
   * Note this list sits in a scrolling panel and the drag hook has no
   * auto-scroll. With a handful of sections it fits on screen and this is fine;
   * a resume with enough sections to scroll the panel is the point to add
   * auto-scroll rather than live with a drag that can't reach the bottom.
   */
  const sectionSort = useSortable({
    value: sectionOrder,
    onCommit: (next) =>
      startTransition(() => {
        void reorderResumeSections(resumeId, next.sections ?? []);
      }),
  });

  const orderedSections = (sectionSort.order.sections ?? [])
    .map((id) => sectionById.get(id))
    .filter((s): s is ResolvedSection => Boolean(s));

  /**
   * Tighten the layout one notch at a time in COMPACTION_ORDER — whitespace
   * first, type size last. Deliberately a single pass rather than a loop to a
   * target: it nudges in the right direction and leaves you in control, instead
   * of silently driving the resume to 8pt to win an argument with the estimator.
   */
  function compactOneStep() {
    setCompacting(true);
    const patch: StylePatch = {};

    for (const { key, step } of COMPACTION_ORDER) {
      const current = style[key as NumericStyleKey] as number;
      const next = clampStyleValue(key, Number((current + step).toFixed(2)));
      if (next !== current) {
        patch[key] = next;
        break;
      }
    }

    if (Object.keys(patch).length > 0) onCommit(patch);
    setTimeout(() => setCompacting(false), 250);
  }

  const atMinimum = COMPACTION_ORDER.every(({ key, step }) => {
    const current = style[key as NumericStyleKey] as number;
    return clampStyleValue(key, Number((current + step).toFixed(2))) === current;
  });

  return (
    <div className="space-y-4">
      {pages > 1 && (
        <div className="card border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium">Spilling onto page {pages}</p>
          <p className="hint mt-1">
            Tighten one step at a time — spacing first, font size last.
          </p>
          <button
            className="btn-ghost mt-3 text-xs"
            onClick={compactOneStep}
            disabled={compacting || atMinimum}
          >
            <Scissors size={13} />
            {atMinimum ? "Nothing left to tighten" : "Tighten one step"}
          </button>
        </div>
      )}

      <Group title="Font">
        <div>
          <label className="label">Family</label>
          <select
            className="field"
            value={style.fontFamily}
            onChange={(e) => onCommit({ fontFamily: e.target.value })}
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {FONT_SLIDERS.map((spec) => (
          <Slider
            key={spec.key}
            spec={spec}
            value={style[spec.key] as number}
            onChange={(v) => onChange({ [spec.key]: v } as StylePatch)}
          />
        ))}
      </Group>

      <Group
        title="Spacing"
        subtitle="Usually the cheapest way to gain a line — try this before shrinking type."
      >
        {SPACING_SLIDERS.map((spec) => (
          <Slider
            key={spec.key}
            spec={spec}
            value={style[spec.key] as number}
            onChange={(v) => onChange({ [spec.key]: v } as StylePatch)}
          />
        ))}

        {/* Shown in mm, stored in inches — the conversion lives here so the
            renderer and database never deal in millimetres. */}
        {MARGIN_SLIDERS.map((spec) => (
          <Slider
            key={spec.key}
            spec={spec}
            value={inchesToMm(style[spec.key] as number)}
            onChange={(mm) => onChange({ [spec.key]: mmToInches(mm) } as StylePatch)}
          />
        ))}
      </Group>

      <Group title="Entries">
        <div>
          <label className="label">Date &amp; location position</label>
          <div className="grid grid-cols-2 gap-2">
            {DATE_POSITIONS.map((d) => (
              <button
                key={d.value}
                onClick={() => onCommit({ datePosition: d.value })}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  style.datePosition === d.value
                    ? "border-accent bg-accentSoft"
                    : "border-line hover:border-muted",
                )}
              >
                <p className="text-sm font-medium">{d.label}</p>
                <p className="hint mt-0.5">{d.hint}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Employer &amp; subtitle style</label>
          <div className="grid grid-cols-3 gap-2">
            {SUBTITLE_STYLES.map((s) => (
              <button
                key={s.value}
                onClick={() => onCommit({ subtitleStyle: s.value })}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm transition-colors",
                  style.subtitleStyle === s.value
                    ? "border-accent bg-accentSoft font-medium"
                    : "border-line hover:border-muted",
                )}
                style={{
                  fontStyle: s.value === "italic" ? "italic" : "normal",
                  fontWeight: s.value === "bold" ? 700 : undefined,
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </Group>

      <Group title="Headings">
        <div className="grid grid-cols-2 gap-2">
          {HEADING_STYLES.map((h) => (
            <button
              key={h.value}
              onClick={() => onCommit({ headingStyle: h.value })}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                style.headingStyle === h.value
                  ? "border-accent bg-accentSoft"
                  : "border-line hover:border-muted",
              )}
            >
              <p className="text-sm font-medium">{h.label}</p>
              <p className="hint mt-0.5">{h.hint}</p>
            </button>
          ))}
        </div>

        <div>
          <label className="label">Heading colour</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              className="h-9 w-14 cursor-pointer rounded border border-line bg-surface"
              value={style.accentColor}
              onChange={(e) => onChange({ accentColor: e.target.value })}
            />
            <span className="hint">
              Black prints and scans most reliably through ATS.
            </span>
          </div>
        </div>
      </Group>

      <Group
        title="Sections"
        subtitle="Drag to reorder. Hiding keeps the content in the resume."
      >
        <div ref={sectionSort.registerContainer("sections")} className="space-y-1.5">
          {orderedSections.map((section) => (
            <div
              key={section.id}
              ref={sectionSort.registerItem(section.id)}
              className={cn(
                "group/s flex items-center gap-1 rounded-lg border border-line px-2 py-2 transition-opacity",
                sectionSort.draggingId === section.id && "opacity-40",
              )}
            >
              <span
                {...sectionSort.handleProps(section.id, "sections")}
                className="shrink-0 text-muted opacity-0 transition-opacity hover:text-ink group-hover/s:opacity-100"
                title="Drag to reorder"
              >
                <GripVertical size={12} />
              </span>

              <span
                className={cn(
                  "flex-1 truncate pl-0.5 text-sm",
                  !section.isVisible && "text-muted line-through",
                )}
              >
                {section.heading}
              </span>

              <button
                className={cn(
                  "rounded p-1 hover:bg-canvas",
                  section.pageBreakAfter ? "text-accent" : "text-muted",
                )}
                title={
                  section.pageBreakAfter
                    ? "Remove page break after this section"
                    : "Start a new page after this section"
                }
                onClick={() =>
                  startTransition(
                    () => void setSectionPageBreak(section.id, !section.pageBreakAfter),
                  )
                }
              >
                <SeparatorHorizontal size={13} />
              </button>
              <button
                className="rounded p-1 text-muted hover:bg-canvas"
                title={section.isVisible ? "Hide section" : "Show section"}
                onClick={() =>
                  startTransition(() => void toggleSectionVisible(section.id))
                }
              >
                {section.isVisible ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
            </div>
          ))}
        </div>
      </Group>

      <Group title="Page">
        <div className="grid grid-cols-2 gap-2">
          {PAGE_SIZES.map((p) => (
            <button
              key={p.value}
              onClick={() => onCommit({ pageSize: p.value })}
              className={cn(
                "rounded-lg border p-3 text-sm transition-colors",
                style.pageSize === p.value
                  ? "border-accent bg-accentSoft font-medium"
                  : "border-line hover:border-muted",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Group>

      <ConfirmButton
        className="btn-ghost w-full text-sm"
        message="Reset every style setting on this resume to the defaults? Your content is not affected."
        onConfirm={() => startTransition(() => void resetResumeStyle(resumeId))}
      >
        <RotateCcw size={14} /> Reset to defaults
      </ConfirmButton>
    </div>
  );
}
