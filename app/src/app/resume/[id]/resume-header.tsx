"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MoreVertical,
  Plus,
  Settings2,
  Share2,
  Trash2,
} from "lucide-react";

import { MenuItem, Popover } from "@/components/popover";
import { Modal } from "@/components/ui";
import { cn } from "@/lib/utils";

import {
  createResume,
  deleteResume,
  duplicateResume,
  renameResume,
  setResumeTarget,
} from "../actions";
import type { Tab } from "./editor";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "content", label: "Content" },
  { id: "customize", label: "Customize" },
  { id: "tune", label: "Tune" },
];

/**
 * The resume page's top bar: switcher · tabs · Download · more.
 *
 * Everything the old header did still lives here — rename and the target
 * role/company moved into "Resume details" in the menu, the print view
 * link into the menu, Download stays the one primary button. Share and email
 * don't exist yet and are shown disabled, labelled, rather than hidden.
 */
export function ResumeHeader({
  resumeId,
  name,
  targetRole,
  targetCompany,
  resumes,
  activeTab,
}: {
  resumeId: number;
  name: string;
  targetRole: string;
  targetCompany: string;
  /** Every resume, for the switcher. */
  resumes: Array<{ id: number; name: string }>;
  activeTab: Tab;
}) {
  const router = useRouter();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [pending, startTransition] = useTransition();

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

  function addResume() {
    startTransition(async () => {
      const result = await createResume();
      if (result.ok) router.push(`/resume/${result.data}`);
      else setError(result.error);
    });
  }

  function duplicate() {
    startTransition(async () => {
      const result = await duplicateResume(resumeId);
      if (result.ok) router.push(`/resume/${result.data}`);
      else setError(result.error);
    });
  }

  function remove() {
    if (!window.confirm(`Delete "${name}"? Your vault keeps everything; only this resume goes.`)) return;
    startTransition(async () => {
      const result = await deleteResume(resumeId);
      if (result.ok) router.push("/");
      else setError(result.error);
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line/70 bg-surface p-2 shadow-card">
        <Popover
          label="Switch resume"
          triggerClassName="flex max-w-64 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors hover:bg-canvas"
          trigger={
            <>
              <FileText size={16} className="shrink-0 text-accent" />
              <span className="truncate">{name}</span>
              <ChevronDown size={14} className="shrink-0 text-muted" />
            </>
          }
          panelClassName="w-72"
        >
          {(close) => (
            <div>
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Your resumes
              </p>
              <div className="max-h-72 overflow-y-auto">
                {resumes.map((r) => (
                  <Link
                    key={r.id}
                    href={`/resume/${r.id}?tab=${activeTab}`}
                    onClick={close}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-canvas",
                      r.id === resumeId && "font-medium",
                    )}
                  >
                    <span className="flex-1 truncate">{r.name}</span>
                    {r.id === resumeId && <Check size={14} className="text-violet" />}
                  </Link>
                ))}
              </div>
              <div className="mt-1 border-t border-line pt-1">
                <MenuItem icon={<Plus size={15} />} onClick={addResume} disabled={pending}>
                  Add Resume
                </MenuItem>
              </div>
            </div>
          )}
        </Popover>

        <nav className="flex items-center gap-1 rounded-xl bg-canvas p-1" aria-label="Editor tabs">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`/resume/${resumeId}?tab=${t.id}`}
              aria-current={activeTab === t.id ? "page" : undefined}
              className={cn(
                "rounded-lg px-4 py-1.5 text-sm transition-all duration-150",
                activeTab === t.id
                  ? "bg-surface font-medium text-ink shadow-card"
                  : "text-muted hover:text-ink",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {error && <span className="mr-2 text-xs text-red-600">{error}</span>}
          <button
            className="btn-primary rounded-xl"
            onClick={downloadPdf}
            disabled={exporting}
            title='Opens the print dialog — choose "Save as PDF"'
          >
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {exporting ? "Preparing…" : "Download"}
          </button>

          <Popover
            label="More actions"
            align="right"
            triggerClassName="rounded-xl p-2 text-muted transition-colors hover:bg-canvas hover:text-ink"
            trigger={<MoreVertical size={18} />}
            panelClassName="w-60"
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<Settings2 size={15} />}
                  onClick={() => {
                    close();
                    setDetailsOpen(true);
                  }}
                >
                  Resume details
                </MenuItem>
                {/* Some mobile browsers print the parent page instead of a
                    frame; the print view in its own tab works everywhere. */}
                <MenuItem icon={<ExternalLink size={15} />} href={`/print/${resumeId}?print=1`}>
                  Open print view
                </MenuItem>
                <MenuItem
                  icon={<Copy size={15} />}
                  disabled={pending}
                  onClick={() => {
                    close();
                    duplicate();
                  }}
                >
                  Duplicate
                </MenuItem>
                <div className="my-1 border-t border-line" />
                <MenuItem icon={<Share2 size={15} />} disabled hint="Soon">
                  Share link
                </MenuItem>
                <MenuItem icon={<Mail size={15} />} disabled hint="Soon">
                  Email resume
                </MenuItem>
                <div className="my-1 border-t border-line" />
                <MenuItem
                  icon={<Trash2 size={15} />}
                  danger
                  disabled={pending}
                  onClick={() => {
                    close();
                    remove();
                  }}
                >
                  Delete resume
                </MenuItem>
              </>
            )}
          </Popover>
        </div>
      </div>

      {/* Keyed so each opening starts from the saved values. */}
      <ResumeDetailsDialog
        key={detailsOpen ? `open-${name}-${targetRole}-${targetCompany}` : "closed"}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        resumeId={resumeId}
        name={name}
        targetRole={targetRole}
        targetCompany={targetCompany}
      />
    </>
  );
}

/** Name plus the target role/company the tuner reads. */
function ResumeDetailsDialog({
  open,
  onClose,
  resumeId,
  name,
  targetRole,
  targetCompany,
}: {
  open: boolean;
  onClose: () => void;
  resumeId: number;
  name: string;
  targetRole: string;
  targetCompany: string;
}) {
  const [draftName, setDraftName] = useState(name);
  const [role, setRole] = useState(targetRole);
  const [company, setCompany] = useState(targetCompany);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      if (draftName.trim() && draftName.trim() !== name) {
        const renamed = await renameResume(resumeId, draftName);
        if (!renamed.ok) {
          setError(renamed.error);
          return;
        }
      }
      if (role !== targetRole || company !== targetCompany) {
        const target = await setResumeTarget(resumeId, role, company);
        if (!target.ok) {
          setError(target.error);
          return;
        }
      }
      onClose();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Resume details">
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="rd-name">
            Name
          </label>
          <input
            id="rd-name"
            className="field"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="rd-role">
              Target role
            </label>
            <input
              id="rd-role"
              className="field"
              placeholder="e.g. Backend Engineer"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="rd-company">
              Target company
            </label>
            <input
              id="rd-company"
              className="field"
              placeholder="e.g. Stripe"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
        </div>
        <p className="hint">Shown under the resume on your resume list, to tell tailored versions apart.</p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={pending || !draftName.trim()}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
