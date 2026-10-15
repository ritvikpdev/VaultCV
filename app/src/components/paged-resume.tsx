"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  buildBlocks,
  pageContentHeightPt,
  pageWidthIn,
  paginate,
} from "@/lib/resume-blocks";
import { scoreBullet, STRENGTH_COLORS, STRENGTH_LABELS } from "@/lib/bullet-strength";
import type { ResolvedResume } from "@/lib/resume-model";

import { ResumeBlockView, resumeCssVars } from "./resume-document";

/**
 * Paginated preview — real page sheets, real breaks.
 *
 * How it works: every block is rendered once into a hidden container at true
 * page width, measured, and then distributed across page sheets by
 * `paginate()`. When page one fills, a second sheet appears below it.
 *
 * Why measure rather than estimate: character-count estimates are wrong by
 * whole lines as soon as wrapping is involved, and a page-break preview that's
 * off by a line is worse than none — you'd trust it and be wrong.
 *
 * The measuring pass runs in `useLayoutEffect` so the sheets are populated
 * before paint; measuring after paint would show a one-frame flash of an empty
 * page on every keystroke.
 *
 * Caveat worth knowing: this is our pagination, and Chrome's print engine does
 * its own when the browser prints the export. They agree because both treat `.r-entry` as
 * unbreakable (`break-inside: avoid` in globals.css) and use the same page
 * geometry — but they are two implementations, and a very long single entry is
 * where they're most likely to diverge.
 */
/** Width the strength strip needs beside the page, in screen pixels. */
export const STRENGTH_GUTTER_PX = 26;

type Marker = { id: number; top: number; score: number; hint: string };

export function PagedResume({
  resume,
  scale = 1,
  onPageCount,
  onContactOverflow,
  showStrength = false,
  onBulletPick,
}: {
  resume: ResolvedResume;
  scale?: number;
  /**
   * Draw a marker beside the page for each bullet, coloured by its writing
   * strength. Editor chrome: it sits outside the page sheet, so it can never
   * reach the printed document. The caller leaves STRENGTH_GUTTER_PX free.
   */
  showStrength?: boolean;
  /** Clicking a marker: the caller opens the bullet's entry. */
  onBulletPick?: (bulletId: number) => void;
  /** Reports the real page count so callers can stop estimating it. */
  onPageCount?: (n: number) => void;
  /**
   * Reports whether the header's contact line (forced onto one line via
   * `white-space: nowrap`) is wider than the page. Measured the same way as
   * page height: on the hidden pass, at true page width, via `scrollWidth`
   * vs. `clientWidth` rather than an estimate.
   */
  onContactOverflow?: (overflows: boolean) => void;
}) {
  const blocks = buildBlocks(resume);
  const measureRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});

  // Re-measure whenever content or styling could change the layout. Style is
  // in the dependency list because font size and spacing change every height.
  const styleKey = JSON.stringify(resume.style);
  const blockKey = blocks.map((b) => b.key).join("|");

  useLayoutEffect(() => {
    const container = measureRef.current;
    if (!container) return;

    const next: Record<string, number> = {};
    for (const child of Array.from(container.children)) {
      const key = (child as HTMLElement).dataset.blockKey;
      if (!key) continue;

      // `offsetHeight`, not `getBoundingClientRect`. The preview is rendered
      // inside a `transform: scale()` wrapper, and getBoundingClientRect reports
      // the *visual* box — so every block measured 28% short at scale 0.72 and
      // the page never filled. offsetHeight is the untransformed layout height,
      // which is what page capacity is expressed in.
      //
      // The wrapper is `display: flow-root`, so this already includes the
      // block's own margins.
      next[key] = (child as HTMLElement).offsetHeight;
    }

    setHeights((prev) => {
      const same =
        Object.keys(next).length === Object.keys(prev).length &&
        Object.entries(next).every(([k, v]) => Math.abs((prev[k] ?? 0) - v) < 0.5);
      return same ? prev : next;
    });

    const contact = container.querySelector<HTMLElement>(".r-contact");
    onContactOverflow?.(contact ? contact.scrollWidth > contact.clientWidth + 0.5 : false);
  }, [styleKey, blockKey, resume, onContactOverflow]);

  const widthIn = pageWidthIn(resume.style);
  const heightIn = resume.style.pageSize === "a4" ? 11.69 : 11;

  // Heights are measured in CSS pixels; capacity is in points. 1pt = 1/72in,
  // and the browser lays out at 96 CSS px per inch.
  const capacityPx = (pageContentHeightPt(resume.style) / 72) * 96;

  const measured = Object.keys(heights).length > 0;
  const pages = measured ? paginate(blocks, heights, capacityPx) : [blocks];

  const cssVars = resumeCssVars(resume.style);

  useEffect(() => {
    onPageCount?.(pages.length);
  }, [pages.length, onPageCount]);

  // `transform: scale` doesn't shrink the layout box, so the wrapper needs an
  // explicit height or the page leaves a tall empty gap beneath the preview.
  const PAGE_GAP_PX = 16;
  const LABEL_PX = 20;
  const unscaledHeight =
    pages.length * (heightIn * 96 + LABEL_PX) + (pages.length - 1) * PAGE_GAP_PX;

  // Strength markers: measured from the visible pages after layout, in screen
  // pixels relative to the wrapper, so they line up with each bullet's first
  // line whatever the scale.
  const outerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const bulletText = new Map(
    resume.sections.flatMap((s) => s.entries.flatMap((e) => e.bullets.map((b) => [b.id, b.text] as const))),
  );
  const textKey = [...bulletText].map(([id, t]) => `${id}:${t.length}`).join("|");

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const pagesEl = pagesRef.current;
    if (!showStrength || !outer || !pagesEl) {
      setMarkers((m) => (m.length ? [] : m));
      return;
    }
    const base = outer.getBoundingClientRect().top;
    const next: Marker[] = [];
    for (const el of Array.from(pagesEl.querySelectorAll<HTMLElement>("[data-bullet-id]"))) {
      const id = Number(el.dataset.bulletId);
      const text = bulletText.get(id);
      if (!text?.trim()) continue;
      const rect = el.getBoundingClientRect();
      const line = (parseFloat(getComputedStyle(el).lineHeight) || 14) * scale;
      const { score, reasons } = scoreBullet(text);
      const missing = reasons.find((r) => r.delta > 0 && !r.met);
      const penalty = reasons.find((r) => r.delta < 0 && r.met);
      next.push({
        id,
        top: rect.top - base + Math.min(line, rect.height) / 2,
        score,
        hint: penalty
          ? penalty.label.replace("Avoids a", "Has a").replace("Not overlong", "Too long")
          : missing
            ? missing.label
            : "",
      });
    }
    setMarkers(next);
    // Keyed on what moves bullets: layout inputs and bullet text, summarised
    // as strings so a re-render with identical content doesn't re-measure.
  }, [showStrength, scale, styleKey, blockKey, textKey, heights]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageRightPx = widthIn * 96 * scale;

  return (
    <div ref={outerRef} className="relative" style={{ height: unscaledHeight * scale }}>
      {showStrength &&
        markers.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onBulletPick?.(m.id)}
            aria-label={`${STRENGTH_LABELS[m.score]} bullet${m.hint ? ` — ${m.hint}` : ""}. Open it.`}
            className="group absolute z-10 flex -translate-y-1/2 items-center"
            style={{ top: m.top, left: pageRightPx + 2 }}
          >
            {/* The tick points from the page edge to the bullet's line. */}
            <span className="h-px w-2 bg-line transition-colors group-hover:bg-ink/40" />
            <span
              className={`h-2.5 w-2.5 rounded-full ring-2 ring-canvas transition-transform group-hover:scale-125 ${STRENGTH_COLORS[m.score - 1]}`}
            />
            <span className="pointer-events-none absolute right-full top-1/2 mr-1 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[11px] text-white shadow-lift group-hover:block">
              <span className="font-medium">{STRENGTH_LABELS[m.score]}</span>
              {m.hint && <span className="opacity-75"> — {m.hint.toLowerCase()}</span>}
            </span>
          </button>
        ))}
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
      {/* Hidden measuring pass. Same width and styling as a real page, so the
          wrapping — and therefore the height — is identical. */}
      <div
        ref={measureRef}
        aria-hidden
        className="resume-doc"
        data-heading-style={resume.style.headingStyle}
        style={{
          ...cssVars,
          width: `${widthIn}in`,
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          top: 0,
          left: 0,
          zIndex: -1,
          padding: `0 var(--r-margin-x)`,
        }}
      >
        {blocks.map((block) => (
          <div
            key={block.key}
            data-block-key={block.key}
            // `flow-root` stops the block's own margin-top escaping the wrapper.
            // Without it the wrapper measures only the block's content box while
            // the section gap collapses out, so every block under-reports by its
            // leading margin and the page never appears to fill.
            style={{ display: "flow-root" }}
          >
            <ResumeBlockView block={block} resume={resume} />
          </div>
        ))}
      </div>

      <div ref={pagesRef} className="flex flex-col gap-4">
        {pages.map((pageBlocks, i) => (
          <div key={i} className="relative">
            <div
              className="resume-doc overflow-hidden bg-white shadow-page"
              data-heading-style={resume.style.headingStyle}
              style={{
                ...cssVars,
                width: `${widthIn}in`,
                height: `${heightIn}in`,
              }}
            >
              {pageBlocks.map((block) => (
                <ResumeBlockView key={block.key} block={block} resume={resume} />
              ))}
            </div>

              <p className="mt-1 text-right text-[10px] text-muted">
                Page {i + 1} of {pages.length}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
