"use client";

import { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";

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
  const [exportError, setExportError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function saveTarget() {
    startTransition(() => void setResumeTarget(resumeId, role, company));
  }

  /**
   * Fetch rather than a plain link, so a failed export surfaces its reason
   * instead of navigating the tab to a JSON error blob.
   */
  async function downloadPdf() {
    setExporting(true);
    setExportError(null);

    try {
      const response = await fetch(`/api/export/${resumeId}`);

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setExportError(body.error ?? "Export failed");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${draftName || "resume"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
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
        <button className="btn-primary" onClick={downloadPdf} disabled={exporting}>
          {exporting ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Rendering…
            </>
          ) : (
            <>
              <Download size={15} /> Download
            </>
          )}
        </button>
      </div>

      {exportError && (
        <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {exportError}
        </p>
      )}
    </div>
  );
}
