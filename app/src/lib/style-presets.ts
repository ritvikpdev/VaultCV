import type { ResumeStyle } from "../db/schema.ts";

/**
 * Customize options and their safe ranges.
 *
 * Ranges are not arbitrary: the low end is where a resume stops being readable
 * on paper, the high end is where one page stops being achievable. Clamping
 * here rather than trusting the slider means a hand-crafted request can't
 * produce a 4pt resume.
 */

/** Fonts that exist on Windows and macOS without a webfont download. */
export const FONT_FAMILIES = [
  { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Garamond", value: "Garamond, Georgia, serif" },
  { label: "Cambria", value: "Cambria, Georgia, serif" },
  { label: "Calibri", value: "Calibri, 'Segoe UI', sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
] as const;

export const HEADING_STYLES = [
  { label: "Rule", value: "rule", hint: "Uppercase with a line beneath" },
  { label: "Underline", value: "underline", hint: "Uppercase, underlined" },
  { label: "Caps", value: "caps", hint: "Uppercase, nothing else" },
  { label: "Plain", value: "plain", hint: "As typed, no transform" },
] as const;

export const PAGE_SIZES = [
  { label: "US Letter", value: "letter" },
  { label: "A4", value: "a4" },
] as const;

export type NumericStyleKey =
  | "baseSize"
  | "nameSize"
  | "headingSize"
  | "lineHeight"
  | "sectionGap"
  | "entryGap"
  | "bulletGap"
  | "marginX"
  | "marginY";

export type SliderSpec = {
  key: NumericStyleKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** Shown under the control when the value is doing something notable. */
  hint?: string;
};

export const FONT_SLIDERS: SliderSpec[] = [
  {
    key: "baseSize",
    label: "Base font size",
    min: 8,
    max: 13,
    step: 0.5,
    unit: "pt",
    hint: "Below 9.5pt gets hard to read on paper",
  },
  { key: "nameSize", label: "Full name", min: 12, max: 32, step: 1, unit: "pt" },
  { key: "headingSize", label: "Section headings", min: 8, max: 16, step: 0.5, unit: "pt" },
];

export const SPACING_SLIDERS: SliderSpec[] = [
  { key: "lineHeight", label: "Line height", min: 1, max: 1.8, step: 0.05, unit: "×" },
  { key: "sectionGap", label: "Between sections", min: 0, max: 24, step: 1, unit: "pt" },
  { key: "entryGap", label: "Between entries", min: 0, max: 16, step: 1, unit: "pt" },
  { key: "bulletGap", label: "Between bullets", min: 0, max: 8, step: 0.5, unit: "pt" },
];

/**
 * Margins get their own list because they're shown in millimetres while stored
 * in inches. Keeping the conversion at the edge means the renderer and the
 * database never have to know about mm.
 */
export const MARGIN_SLIDERS: SliderSpec[] = [
  { key: "marginX", label: "Left & right margin", min: 8, max: 32, step: 1, unit: "mm" },
  { key: "marginY", label: "Top & bottom margin", min: 8, max: 32, step: 1, unit: "mm" },
];

const RANGES = Object.fromEntries(
  [...FONT_SLIDERS, ...SPACING_SLIDERS].map((s) => [s.key, { min: s.min, max: s.max }]),
) as Record<NumericStyleKey, { min: number; max: number }>;

// Margin ranges are declared in mm; clamping happens against stored inches.
RANGES.marginX = { min: 8 / 25.4, max: 32 / 25.4 };
RANGES.marginY = { min: 8 / 25.4, max: 32 / 25.4 };

export function clampStyleValue(key: NumericStyleKey, value: number): number {
  const range = RANGES[key];
  if (!range || Number.isNaN(value)) return value;
  return Math.min(range.max, Math.max(range.min, value));
}

/** Matches the column defaults in schema.ts. Used by "Reset to defaults". */
export const DEFAULT_STYLE: Omit<ResumeStyle, "id"> = {
  fontFamily: '"Times New Roman", Times, serif',
  baseSize: 10,
  nameSize: 21,
  headingSize: 11,
  lineHeight: 1.25,
  sectionGap: 10,
  entryGap: 6,
  bulletGap: 2,
  marginX: 0.5,
  marginY: 0.5,
  headingStyle: "rule",
  accentColor: "#000000",
  pageSize: "letter",
  datePosition: "right",
  subtitleStyle: "italic",
};

export const DATE_POSITIONS = [
  { label: "Right", value: "right", hint: "Same line as the title" },
  { label: "Below title", value: "below", hint: "Stacked underneath" },
] as const;

export const SUBTITLE_STYLES = [
  { label: "Italic", value: "italic" },
  { label: "Normal", value: "normal" },
  { label: "Bold", value: "bold" },
] as const;

/**
 * Millimetres per inch. Margins are stored in inches (CSS `in` units drive the
 * renderer) but shown in mm, which is how the reference tool presents them and
 * gives finer steps than a 0.05in notch.
 */
export const MM_PER_INCH = 25.4;

export function inchesToMm(inches: number): number {
  return Math.round(inches * MM_PER_INCH);
}

export function mmToInches(mm: number): number {
  return Number((mm / MM_PER_INCH).toFixed(4));
}

/**
 * Ordered smallest-footprint-first. "Fit to one page" walks this list, nudging
 * each value one step at a time, so it tightens spacing before it shrinks type
 * — whitespace is cheaper to lose than legibility.
 */
export const COMPACTION_ORDER: Array<{ key: NumericStyleKey; step: number }> = [
  { key: "sectionGap", step: -1 },
  { key: "entryGap", step: -1 },
  { key: "bulletGap", step: -0.5 },
  { key: "marginY", step: -0.05 },
  { key: "marginX", step: -0.05 },
  { key: "lineHeight", step: -0.05 },
  { key: "baseSize", step: -0.5 },
];
