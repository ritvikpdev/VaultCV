"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";

import { RenameField } from "@/components/rename-field";
import { ConfirmButton } from "@/components/ui";
import type { Resume } from "@/db/schema";

import { createResume, deleteResume, duplicateResume, renameResume } from "./resume/actions";

function relativeDate(unixSeconds: number): string {
  const days = Math.floor((Date.now() / 1000 - unixSeconds) / 86400);
  if (days <= 0) return "edited today";
  if (days === 1) return "edited yesterday";
  if (days < 30) return `edited ${days} days ago`;
  const months = Math.round(days / 30);
  return `edited ${months} month${months === 1 ? "" : "s"} ago`;
}

export function ResumeList({ resumes }: { resumes: Resume[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createResume();
      // Straight into the editor — a new resume with nothing in it is not a
      // destination, it's a step.
      if (result.ok) router.push(`/resume/${result.data}?tab=content`);
      // A silently-swallowed failure looks identical to a dead button. Say so.
      else setError(result.error);
    });
  }

  return (
    <>
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">My Resumes</h1>
        <button className="btn-accent" onClick={onCreate} disabled={pending}>
          <Plus size={16} /> New resume
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {resumes.length === 0 ? (
        <div className="card mt-8 flex min-h-64 flex-col items-center justify-center border-dashed p-10 text-center">
          <p className="font-medium">No resumes yet</p>
          <p className="hint mt-1 max-w-sm">
            A resume is composed from your vault — pick the entries and bullets
            that fit the job, and never retype an achievement.
          </p>
          <button className="btn-accent mt-5" onClick={onCreate} disabled={pending}>
            <Plus size={16} /> Create your first resume
          </button>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {resumes.map((r) => (
            <div key={r.id} className="card group relative p-5">
              {/* Clicking the name renames it; the rest of the card opens the resume. */}
              <RenameField
                value={r.name}
                label="resume"
                onSave={(next) => renameResume(r.id, next)}
                className="-ml-1.5 max-w-[calc(100%-4.5rem)] px-1.5 py-0.5 font-medium"
              />
              <Link href={`/resume/${r.id}?tab=content`} className="block">
                <p className="hint mt-1">
                  {[r.targetRole, r.targetCompany].filter(Boolean).join(" · ") ||
                    "No target set"}
                </p>
                <p className="hint mt-4 text-xs">{relativeDate(r.updatedAt)}</p>
              </Link>

              <div className="absolute right-3 top-3 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  className="rounded p-1.5 text-muted hover:bg-canvas"
                  title="Duplicate"
                  onClick={() =>
                    startTransition(async () => {
                      const result = await duplicateResume(r.id);
                      if (result.ok) router.push(`/resume/${result.data}?tab=content`);
                    })
                  }
                >
                  <Copy size={14} />
                </button>
                <ConfirmButton
                  className="rounded p-1.5 text-muted hover:bg-canvas hover:text-red-600"
                  title="Delete"
                  message={`Delete "${r.name}"? Your vault content is not affected.`}
                  onConfirm={() => startTransition(() => void deleteResume(r.id))}
                >
                  <Trash2 size={14} />
                </ConfirmButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
