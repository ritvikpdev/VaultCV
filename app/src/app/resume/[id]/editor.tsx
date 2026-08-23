"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { PagedResume } from "@/components/paged-resume";
import type { ResumeStyle } from "@/db/schema";
import type { ResolvedResume } from "@/lib/resume-model";

import { updateResumeStyle, type StylePatch } from "../style-actions";
import {
  ContentTab,
  type SectionVaultData,
  type VaultSkillContext,
} from "./content-tab";
import { CustomizeTab } from "./customize-tab";
import { TuneTab } from "./tune-tab";

export type Tab = "content" | "customize" | "tune";

const TABS: Array<{ id: Tab; label: string; ready: boolean }> = [
  { id: "content", label: "Content", ready: true },
  { id: "customize", label: "Customize", ready: true },
  { id: "tune", label: "Tune", ready: true },
];

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
  activeTab,
  hasApiKey,
}: {
  resume: ResolvedResume;
  vaultData: SectionVaultData;
  vaultSkills: VaultSkillContext;
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

  const previewResume: ResolvedResume = { ...resume, style };

  const handlePageCount = useCallback((n: number) => setPages(n), []);
  const handleContactOverflow = useCallback((overflows: boolean) => {
    setContactOverflows(overflows);
  }, []);

  return (
    <>
      <nav className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.ready ? `/resume/${resume.id}?tab=${t.id}` : `/resume/${resume.id}`}
            aria-disabled={!t.ready}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              activeTab === t.id
                ? "border-accent font-medium text-accent"
                : t.ready
                  ? "border-transparent text-muted hover:text-ink"
                  : "pointer-events-none border-transparent text-muted/40"
            }`}
          >
            {t.label}
            {!t.ready && <span className="ml-1.5 text-[10px]">soon</span>}
          </Link>
        ))}
      </nav>

      <div className="mt-5 flex gap-6">
        <div className="w-[420px] shrink-0">
          {activeTab === "content" && (
            <ContentTab
              resume={resume}
              vaultData={vaultData}
              vaultSkills={vaultSkills}
            />
          )}

          {activeTab === "customize" && (
            <CustomizeTab
              resumeId={resume.id}
              sections={resume.sections}
              style={style}
              pages={pages}
              onChange={applyStyle}
              onCommit={commitStyle}
            />
          )}

          {activeTab === "tune" && (
            <TuneTab resumeId={resume.id} hasApiKey={hasApiKey} />
          )}
        </div>

        {/* Live preview — real page sheets. /print/[id] renders the same blocks
            continuously for Puppeteer. */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between">
            <p className="hint">Preview</p>
            <p className="hint">
              {pages} page{pages === 1 ? "" : "s"}
            </p>
          </div>
          {contactOverflows && (
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              The contact line under your name doesn't fit on one line.
              Shorten it in{" "}
              <Link href="/settings" className="font-medium underline underline-offset-2">
                Profile settings
              </Link>{" "}
              to keep it from running past the page.
            </p>
          )}
          {/* 0.72 fits an 8.5in sheet into the available column. */}
          <PagedResume
            resume={previewResume}
            scale={0.72}
            onPageCount={handlePageCount}
            onContactOverflow={handleContactOverflow}
          />
        </div>
      </div>
    </>
  );
}
