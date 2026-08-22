"use client";

import { useState, useTransition } from "react";

import { Modal } from "@/components/ui";
import type { SectionDef } from "@/lib/sections";

import { addManualEntry, saveEntryToVault } from "../manual-actions";

/**
 * Type an entry straight into a resume.
 *
 * The resume write happens first and unconditionally — your edit lands whatever
 * you decide about the vault. Only then, and only if nothing similar is already
 * in the vault, does the Yes/No prompt appear. Asking about something already
 * stored would be noise; saving it anyway would duplicate.
 */
export function ManualEntryDialog({
  open,
  onClose,
  sectionId,
  def,
}: {
  open: boolean;
  onClose: () => void;
  sectionId: number;
  def: SectionDef;
}) {
  const [isCurrent, setIsCurrent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savePrompt, setSavePrompt] = useState<{ id: number; title: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setSavePrompt(null);
    setError(null);
    setIsCurrent(false);
    onClose();
  }

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addManualEntry(sectionId, {
        title: String(formData.get("title") ?? ""),
        organization: String(formData.get("organization") ?? ""),
        subtitle: String(formData.get("subtitle") ?? ""),
        location: String(formData.get("location") ?? ""),
        startDate: String(formData.get("startDate") ?? ""),
        endDate: isCurrent ? "" : String(formData.get("endDate") ?? ""),
        isCurrent,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (result.data.existsInVault) close();
      else
        setSavePrompt({
          id: result.data.resumeEntryId,
          title: String(formData.get("title") ?? "this entry"),
        });
    });
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={savePrompt ? "Added to this resume" : `Add ${def.label.replace(/s$/, "")}`}
    >
      {savePrompt ? (
        <div>
          <p className="text-sm">
            <span className="font-medium">{savePrompt.title}</span> is on this resume.
          </p>
          <p className="hint mt-2">
            It isn&rsquo;t in your vault yet. Save it there too, so you can pull it
            into future resumes without retyping?
          </p>

          <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
            <button className="btn-ghost" onClick={close}>
              No, this resume only
            </button>
            <button
              className="btn-accent"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await saveEntryToVault(savePrompt.id);
                  close();
                })
              }
            >
              Yes, save to vault
            </button>
          </div>
        </div>
      ) : (
        <form action={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="m-title">
              {def.type === "education" ? "Degree" : "Title"}
            </label>
            <input id="m-title" name="title" className="field" required autoFocus />
          </div>

          {def.hasOrganization && (
            <div>
              <label className="label" htmlFor="m-org">
                {def.type === "education" ? "School" : "Employer"}
              </label>
              <input id="m-org" name="organization" className="field" />
            </div>
          )}

          <div>
            <label className="label" htmlFor="m-subtitle">
              Subtitle <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="m-subtitle" name="subtitle" className="field" />
          </div>

          {def.hasDates && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label" htmlFor="m-start">
                    Start
                  </label>
                  <input id="m-start" name="startDate" className="field" placeholder="10/2022" />
                </div>
                <div>
                  <label className="label" htmlFor="m-end">
                    End
                  </label>
                  <input
                    id="m-end"
                    name="endDate"
                    className="field"
                    placeholder="07/2025"
                    disabled={isCurrent}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="m-loc">
                    Location
                  </label>
                  <input id="m-loc" name="location" className="field" />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isCurrent}
                  onChange={(e) => setIsCurrent(e.target.checked)}
                  className="accent-accent"
                />
                Currently here
              </label>
            </>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button type="button" className="btn-ghost" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn-accent" disabled={pending}>
              {pending ? "Adding…" : "Add entry"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
