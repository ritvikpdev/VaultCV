"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Eye, X } from "lucide-react";

import { PagedResume, STRENGTH_GUTTER_PX } from "@/components/paged-resume";
import type { ResumeStyle } from "@/db/schema";
import { pageWidthIn } from "@/lib/resume-blocks";
import type { ResolvedResume } from "@/lib/resume-model";
import { cn } from "@/lib/utils";
import type { VaultIndex } from "@/lib/vault-path";

import { updateResumeStyle, type StylePatch } from "../style-actions";
import {
  ContentTab,
  type SectionVaultData,
  type VaultSkillContext,
} from "./content-tab";
import { CustomizeTab } from "./customize-tab";
import { DraftProvider, useResumeDraft } from "./draft";
import { TuneTab } from "./tune-tab";
import { VaultIndexProvider } from "./vault-index-context";

export type Tab = "content" | "customize" | "tune";


/**
 * Editor shell.
 *
 * Style lives here in client state rather than being read from the server on
 * every render. Dragging a slider has to repaint the preview at 60fps; a
 * server round-trip per pixel would make the whole customize tab feel broken.
 * So the preview renders from local state immediately and the durable write is
 * debounced behind it.
 *
 * Content edits keep going straight to the server — they're discrete actions
 * where a revalidate is both correct and fast enough.
 */
export function ResumeEditor({
  resume,
  vaultData,
  vaultSkills,
  vaultIndex,
  activeTab,
  hasApiKey,
}: {
  resume: ResolvedResume;
  vaultData: SectionVaultData;
  vaultSkills: VaultSkillContext;
  vaultIndex: VaultIndex;
  activeTab: Tab;
  hasApiKey: boolean;
}) {
  const [style, setStyle] = useState<ResumeStyle>(resume.style);
  // Reported by the paginator after measuring — a real count, not an estimate.
  const [pages, setPages] = useState(1);
  // Reported by the paginator after measuring the header at true page width.
  const [contactOverflows, setContactOverflows] = useState(false);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The server is authoritative on load and after any content mutation. Without
  // this, a revalidate would leave the local copy stale (e.g. after Reset).
  useEffect(() => {
    setStyle(resume.style);
  }, [resume.style]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /** Apply locally at once; persist once the user stops moving. */
  function applyStyle(patch: StylePatch) {
    setStyle((prev) => ({ ...prev, ...patch }));

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startTransition(() => void updateResumeStyle(resume.id, patch));
    }, 400);
  }

  /** Commit immediately — for discrete controls where debouncing adds nothing. */
  function commitStyle(patch: StylePatch) {
    setStyle((prev) => ({ ...prev, ...patch }));
    if (timer.current) clearTimeout(timer.current);
    startTransition(() => void updateResumeStyle(resume.id, patch));
  }

  // The working copy every Content edit writes to. The preview renders from
  // it, so it is a pure function of the same state the editor shows — no
  // second copy to keep in step. Style stays separate: Customize already
  // applies it locally and debounces the write.
  const draft = useResumeDraft(resume, activeTab);
  const previewResume: ResolvedResume = { ...draft.resume, style };

  const handlePageCount = useCallback((n: number) => setPages(n), []);

  // Below lg the preview is an overlay; this opens it.
  const [previewOpen, setPreviewOpen] = useState(false);

  // Fit the page to whatever width its column has — 550px on desktop, the
  // screen on a phone. Measured rather than assumed, so a narrower window or
  // an A4 page (slightly narrower than Letter) still fills edge to edge.
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(550);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setPreviewWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // The strength strip beside the page: Content tab only, on by default.
  const [strengthOn, setStrengthOn] = useState(true);
  const showStrength = strengthOn && activeTab === "content";
  const previewScale = Math.min(
    1,
    (previewWidth - (showStrength ? STRENGTH_GUTTER_PX : 0)) / (pageWidthIn(style) * 96),
  );

  /** A strength marker was clicked: open that bullet's entry in the editor. */
  const openBullet = useCallback(
    (bulletId: number) => {
      const entry = draft.resume.sections
        .flatMap((s) => s.entries)
        .find((e) => e.bullets.some((b) => b.id === bulletId));
      if (!entry) return;
      const next = new URLSearchParams(window.location.search);
      next.set("tab", "content");
      next.set("edit", `entry-${entry.id}`);
      window.history.pushState(null, "", `?${next}`);
      setPreviewOpen(false);
    },
    [draft.resume],
  );
  const handleContactOverflow = useCallback((overflows: boolean) => {
    setContactOverflows(overflows);
  }, []);

  return (
    <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="w-full shrink-0 lg:w-[440px]">
        <VaultIndexProvider index={vaultIndex}>
          <DraftProvider draft={draft}>
            {activeTab === "content" && (
              <ContentTab vaultData={vaultData} vaultSkills={vaultSkills} />
            )}

            {activeTab === "customize" && (
              <CustomizeTab
                resumeId={resume.id}
                sections={draft.resume.sections}
                style={style}
                pages={pages}
                onChange={applyStyle}
                onCommit={commitStyle}
              />
            )}

            {activeTab === "tune" && (
              <TuneTab resumeId={resume.id} hasApiKey={hasApiKey} />
            )}
          </DraftProvider>
        </VaultIndexProvider>
      </div>

      {/*
        Live preview — real page sheets. /print/[id] renders the same blocks
        continuously for the browser's print.

        At lg and up it is a sticky 550px column. Below that it would push the
        editor off screen, so it becomes a full-screen sheet opened by the
        floating Preview button — the same component either way.
      */}
      <div
        className={cn(
          "lg:sticky lg:top-24 lg:block lg:w-[550px] lg:shrink-0",
          previewOpen
            ? "fixed inset-0 z-40 block overflow-y-auto bg-canvas p-4 pt-16 lg:static lg:z-auto lg:overflow-visible lg:bg-transparent lg:p-0"
            : "hidden",
        )}
      >
        {previewOpen && (
          <button
            className="btn-primary fixed right-4 top-4 z-50 rounded-full lg:hidden"
            onClick={() => setPreviewOpen(false)}
          >
            <X size={15} /> Close preview
          </button>
        )}
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <p className="hint">Live preview</p>
          <div className="flex items-center gap-3">
            {activeTab === "content" && (
              <button
                type="button"
                role="switch"
                aria-checked={strengthOn}
                onClick={() => setStrengthOn((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted hover:text-ink"
                title="Writing strength of each bullet, beside the page — not job relevance"
              >
                <span className={cn("relative h-3.5 w-6 rounded-full transition-colors", strengthOn ? "bg-violet" : "bg-line")}>
                  <span
                    className={cn(
                      "absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-all",
                      strengthOn ? "left-3" : "left-0.5",
                    )}
                  />
                </span>
                Strength
              </button>
            )}
            <p className="hint">
              {pages} page{pages === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {contactOverflows && (
          <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            The contact line under your name doesn&rsquo;t fit on one line.
            Shorten it in{" "}
            <Link href="/settings" className="font-medium underline underline-offset-2">
              Profile settings
            </Link>{" "}
            to keep it from running past the page.
          </p>
        )}
        <div ref={previewRef} className="lg:max-h-[calc(100vh-8.5rem)] lg:overflow-y-auto lg:pb-4">
          <PagedResume
            resume={previewResume}
            scale={previewScale}
            showStrength={showStrength}
            onBulletPick={openBullet}
            onPageCount={handlePageCount}
            onContactOverflow={handleContactOverflow}
          />
        </div>
      </div>

      {!previewOpen && (
        <button
          className="btn-primary fixed bottom-5 right-5 z-30 rounded-full shadow-lift lg:hidden"
          onClick={() => setPreviewOpen(true)}
        >
          <Eye size={15} /> Preview
        </button>
      )}
    </div>
  );
}
