"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  buildBlocks,
  pageContentHeightPt,
  pageWidthIn,
  paginate,
} from "@/lib/resume-blocks";
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
 * its own when Puppeteer exports. They agree because both treat `.r-entry` as
 * unbreakable (`break-inside: avoid` in globals.css) and use the same page
 * geometry — but they are two implementations, and a very long single entry is
 * where they're most likely to diverge.
 */
export function PagedResume({
  resume,
  scale = 1,
  onPageCount,
}: {
  resume: ResolvedResume;
  scale?: number;
  /** Reports the real page count so callers can stop estimating it. */
  onPageCount?: (n: number) => void;
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
  }, [styleKey, blockKey, resume]);

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

  return (
    <div style={{ height: unscaledHeight * scale }}>
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

      <div className="flex flex-col gap-4">
        {pages.map((pageBlocks, i) => (
          <div key={i} className="relative">
            <div
              className="resume-doc overflow-hidden bg-white shadow-sm ring-1 ring-line"
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
