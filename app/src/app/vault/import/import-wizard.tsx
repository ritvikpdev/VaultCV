"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, FileText, Loader2, Sparkles, Upload } from "lucide-react";

import type { Profile } from "@/db/schema";
import { cn } from "@/lib/utils";

import {
  parseImportInput,
  saveReviewedImport,
  type AnnotatedImport,
  type ProfileImportAction,
  type ReviewedEntryInput,
} from "./actions";

type ReviewBullet = { text: string; checked: boolean; possibleDuplicateOf?: string };

type ReviewEntry = Omit<ReviewedEntryInput, "bullets"> & { bullets: ReviewBullet[] };

function toReviewEntries(annotated: AnnotatedImport): ReviewEntry[] {
  return annotated.entries.map((e) => ({
    sectionHeading: e.sectionHeading,
    sectionType: e.sectionType,
    existingSectionId: e.existingSectionId,
    existingEntryId: e.existingEntryId,
    title: e.title,
    organization: e.organization,
    subtitle: e.subtitle,
    location: e.location,
    startDate: e.startDate,
    endDate: e.endDate,
    isCurrent: e.isCurrent,
    information: e.information,
    checked: true,
    // A flagged duplicate starts unchecked — the point of flagging it is that
    // you probably don't want it twice.
    bullets: e.bullets.map((b) => ({ ...b, checked: !b.possibleDuplicateOf })),
  }));
}

/**
 * Import review.
 *
 * Only what the resume contains gets imported — there is no template of empty
 * sections. Where a heading already exists in the vault the entries merge into
 * it, and where an entry matches by title and employer only its new bullets are
 * added. Everything is visible and unchecking anything keeps it out.
 */
export function ImportWizard({ currentProfile }: { currentProfile: Profile }) {
  const [mode, setMode] = useState<"text" | "pdf">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [annotated, setAnnotated] = useState<AnnotatedImport | null>(null);
  const [entries, setEntries] = useState<ReviewEntry[]>([]);
  const [profileAction, setProfileAction] = useState<ProfileImportAction>("merge");
  const [saved, setSaved] = useState<{
    sections: number;
    entries: number;
    bullets: number;
    merged: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function parse() {
    setError(null);
    const formData = new FormData();
    if (mode === "pdf" && file) formData.set("file", file);
    else formData.set("text", text);

    startTransition(async () => {
      const result = await parseImportInput(formData);
      if (result.ok) {
        setAnnotated(result.data);
        setEntries(toReviewEntries(result.data));
      } else {
        setError(result.error);
      }
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveReviewedImport({
        profileAction,
        profile: annotated?.profile,
        entries,
      });
      if (result.ok) setSaved(result.data);
      else setError(result.error);
    });
  }

  function updateEntry(i: number, patch: Partial<ReviewEntry>) {
    setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  }

  if (saved) {
    return (
      <div className="card p-6">
        <p className="flex items-center gap-2 font-medium">
          <Check size={16} className="text-emerald-600" /> Imported
        </p>
        <ul className="hint mt-2 space-y-0.5">
          <li>{saved.sections} new section{saved.sections === 1 ? "" : "s"} created</li>
          <li>{saved.entries} new entr{saved.entries === 1 ? "y" : "ies"} added</li>
          <li>{saved.merged} merged into entries you already had</li>
          <li>{saved.bullets} bullet{saved.bullets === 1 ? "" : "s"} added</li>
        </ul>
        <a href="/vault" className="btn-accent mt-5 inline-flex">
          Go to vault
        </a>
      </div>
    );
  }

  if (!annotated) {
    return (
      <div className="card p-5">
        <div className="flex gap-2">
          <button
            className={cn(
              "rounded-lg border px-4 py-2 text-sm",
              mode === "text" ? "border-accent text-accent" : "border-line text-muted",
            )}
            onClick={() => setMode("text")}
          >
            <FileText size={14} className="mr-1.5 inline" /> Paste text
          </button>
          <button
            className={cn(
              "rounded-lg border px-4 py-2 text-sm",
              mode === "pdf" ? "border-accent text-accent" : "border-line text-muted",
            )}
            onClick={() => setMode("pdf")}
          >
            <Upload size={14} className="mr-1.5 inline" /> Upload PDF
          </button>
        </div>

        {mode === "text" ? (
          <textarea
            className="field mt-4 min-h-64 resize-y font-mono text-xs"
            placeholder="Paste your resume text here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <input
            type="file"
            accept="application/pdf"
            className="field mt-4"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          className="btn-accent mt-4 w-full"
          onClick={parse}
          disabled={pending || (mode === "text" ? text.trim().length < 40 : !file)}
        >
          {pending ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Parsing…
            </>
          ) : (
            <>
              <Sparkles size={15} /> Parse
            </>
          )}
        </button>
      </div>
    );
  }

  const checkedEntries = entries.filter((e) => e.checked).length;
  const checkedBullets = entries.reduce(
    (n, e) => n + (e.checked ? e.bullets.filter((b) => b.checked).length : 0),
    0,
  );
  const newSections = new Set(
    entries.filter((e) => e.checked && !e.existingSectionId).map((e) => e.sectionHeading),
  );

  return (
    <div className="space-y-4">
      <p className="card px-4 py-2.5 text-sm">
        <Sparkles size={13} className="mr-1.5 inline text-muted" />
        Parsed {annotated.source === "claude" ? "with AI" : "locally"} — nothing is
        saved until you press the button at the bottom.
      </p>

      {/* A provider was configured but didn't produce usable output. Saying why
          turns "the AI isn't working" into something the user can act on. */}
      {annotated.fallbackReason && (
        <div className="card border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium">
            AI parsing was unavailable — used the local parser instead
          </p>
          <p className="mt-1 font-mono text-[11px] text-amber-900">
            {annotated.fallbackReason}
          </p>
          <p className="hint mt-2">
            The result below is still usable; AI parsing mainly helps with
            unusual layouts.
          </p>
        </div>
      )}

      {/* Some PDFs position words without space characters. Saying so beats
          letting the user discover glued text in their vault later. */}
      {annotated.gluedSamples.length > 0 && (
        <div className="card border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangle size={14} /> Some text lost its spacing
          </p>
          <p className="hint mt-1">
            This PDF positions some words without space characters — common with
            LaTeX résumés — so a few lines came through run together:
          </p>
          <ul className="mt-2 space-y-0.5">
            {annotated.gluedSamples.map((s) => (
              <li key={s} className="truncate font-mono text-[11px] text-amber-900">
                {s}…
              </li>
            ))}
          </ul>
          <p className="hint mt-2">
            Fix them here before saving, or press Start over and paste the text
            instead — copy-paste keeps the spaces.
          </p>
        </div>
      )}

      {annotated.profile && (
        <div className="card p-5">
          <p className="font-medium">Contact details found</p>
          <p className="hint mt-1">
            {[
              annotated.profile.fullName,
              annotated.profile.email,
              annotated.profile.phone,
              annotated.profile.location,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                ["skip", "Keep what's in the vault"],
                ["merge", "Fill in only what's missing"],
                ["overwrite", "Use imported details"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setProfileAction(value)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs",
                  profileAction === value
                    ? "border-accent bg-accentSoft text-accent"
                    : "border-line text-muted hover:border-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="hint">
        {checkedEntries} of {entries.length} entries · {checkedBullets} bullets ·{" "}
        {newSections.size} new section{newSections.size === 1 ? "" : "s"} will be created
      </p>

      {entries.map((entry, i) => (
        <div key={i} className="card p-4">
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1.5 accent-accent"
              checked={entry.checked}
              onChange={(e) => updateEntry(i, { checked: e.target.checked })}
            />

            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="field flex-1 text-sm font-medium"
                  value={entry.title}
                  onChange={(e) => updateEntry(i, { title: e.target.value })}
                />
                {entry.sectionType === "normal" && (
                  <input
                    className="field w-48 text-sm"
                    placeholder="Organization"
                    value={entry.organization}
                    onChange={(e) => updateEntry(i, { organization: e.target.value })}
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted">Section</span>
                <input
                  className="field w-52 text-xs"
                  value={entry.sectionHeading}
                  onChange={(e) => updateEntry(i, { sectionHeading: e.target.value })}
                />
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px]",
                    entry.existingSectionId
                      ? "bg-sky-50 text-sky-700"
                      : "bg-emerald-50 text-emerald-700",
                  )}
                >
                  {entry.existingSectionId ? "merges into existing" : "new section"}
                </span>
                {entry.existingEntryId && (
                  <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
                    merges into existing entry
                  </span>
                )}
                {entry.sectionType === "skill" && (
                  <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] text-muted">
                    skill
                  </span>
                )}
              </div>

              {entry.sectionType === "skill" ? (
                <div>
                  <input
                    className="field text-sm"
                    value={entry.information}
                    placeholder="Sub-skills"
                    onChange={(e) => updateEntry(i, { information: e.target.value })}
                  />
                </div>
              ) : (
                <>
                  {(entry.startDate || entry.endDate || entry.isCurrent) && (
                    <p className="hint">
                      {[entry.startDate, entry.isCurrent ? "Present" : entry.endDate]
                        .filter(Boolean)
                        .join(" – ") || "No dates found"}
                      {entry.location ? ` · ${entry.location}` : ""}
                    </p>
                  )}

                  {entry.bullets.length > 0 && (
                    <ul className="space-y-1.5">
                      {entry.bullets.map((b, j) => (
                        <li key={j} className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-1 accent-accent"
                            checked={b.checked}
                            onChange={(e) =>
                              updateEntry(i, {
                                bullets: entry.bullets.map((x, k) =>
                                  k === j ? { ...x, checked: e.target.checked } : x,
                                ),
                              })
                            }
                          />
                          <div className="min-w-0 flex-1">
                            {/* Editable: a bullet whose spacing the PDF lost is
                                fixable here, before it reaches the vault. */}
                            <textarea
                              className="field min-h-14 resize-y text-sm leading-snug"
                              value={b.text}
                              onChange={(e) =>
                                updateEntry(i, {
                                  bullets: entry.bullets.map((x, k) =>
                                    k === j ? { ...x, text: e.target.value } : x,
                                  ),
                                })
                              }
                            />
                            {b.possibleDuplicateOf && (
                              <p className="hint mt-0.5 text-amber-700">
                                Looks like one you already have
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex gap-2">
        <button className="btn-accent flex-1" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save selected to vault"}
        </button>
        <button
          className="btn-ghost"
          onClick={() => {
            setAnnotated(null);
            setEntries([]);
          }}
        >
          Start over
        </button>
      </div>
    </div>
  );
}
