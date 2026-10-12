"use client";

import { useRef, useState, useTransition } from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";

import { renameResume, setResumeTarget } from "../actions";

/** Inline-editable resume name plus the target role/company the tuner will use. */
export function ResumeHeader({
  resumeId,
  name,
  targetRole,
  targetCompany,
}: {
  resumeId: number;
  name: string;
  targetRole: string;
  targetCompany: string;
}) {
  const [draftName, setDraftName] = useState(name);
  const [role, setRole] = useState(targetRole);
  const [company, setCompany] = useState(targetCompany);
  const [exporting, setExporting] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [, startTransition] = useTransition();

  function saveTarget() {
    startTransition(() => void setResumeTarget(resumeId, role, company));
  }

  /**
   * Print the resume through the browser's own engine.
   *
   * Loads `/print/[id]` — the same renderer as the preview — in a hidden frame,
   * which opens the print dialog once its fonts have settled. Choose "Save as
   * PDF" there. No new tab, and nothing to render on the server.
   *
   * The frame is dropped when printing ends, or after a minute in case the
   * browser never reports it.
   */
  function downloadPdf() {
    frameRef.current?.remove();
    setExporting(true);

    const frame = document.createElement("iframe");
    frame.src = `/print/${resumeId}?print=1`;
    frame.title = "Print view";
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
    frameRef.current = frame;

    const done = () => {
      setExporting(false);
      setTimeout(() => frame.remove(), 1000);
    };
    frame.addEventListener("load", () => {
      frame.contentWindow?.addEventListener("afterprint", done);
      // The dialog is open by now in most browsers; stop showing a spinner
      // behind it either way.
      setTimeout(() => setExporting(false), 1500);
    });
    setTimeout(done, 60_000);

    document.body.appendChild(frame);
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <input
        className="min-w-48 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-2xl font-semibold tracking-tight outline-none hover:border-line focus:border-accent focus:bg-surface"
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        onBlur={() => {
          if (draftName.trim() && draftName !== name) {
            startTransition(() => void renameResume(resumeId, draftName));
          } else if (!draftName.trim()) {
            setDraftName(name);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />

      <div className="flex gap-2">
        <input
          className="field w-40"
          placeholder="Target role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          onBlur={saveTarget}
        />
        <input
          className="field w-40"
          placeholder="Target company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          onBlur={saveTarget}
        />
        <button
          className="btn-primary"
          onClick={downloadPdf}
          disabled={exporting}
          title='Opens the print dialog — choose "Save as PDF"'
        >
          {exporting ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Preparing…
            </>
          ) : (
            <>
              <Download size={15} /> Download PDF
            </>
          )}
        </button>
        {/* Some mobile browsers print the parent page instead of a frame; the
            print view in its own tab works everywhere. */}
        <a
          className="btn-ghost"
          href={`/print/${resumeId}?print=1`}
          target="_blank"
          rel="noreferrer"
          title="Open the print view in a new tab"
        >
          <ExternalLink size={15} />
        </a>
      </div>
    </div>
  );
}
