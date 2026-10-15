"use client";

import { useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";

import { Modal } from "@/components/ui";
import type { VaultSection } from "@/db/schema";

import { moveEntryToSection } from "./actions";

/**
 * One group of candidate sections, as the sidebar files them.
 *
 * The group name is carried because the section headings alone are ambiguous:
 * "Work Experience SDE" and "Projects SDE" read very differently once you know
 * which family they sit in, and a flat list of nine makes you read every one.
 */
export type MoveTargetGroup = {
  groupName: string | null;
  sections: VaultSection[];
};

export function MoveEntryDialog({
  open,
  onClose,
  entryTitle,
  currentHeading,
  targets,
  entryId,
}: {
  open: boolean;
  onClose: () => void;
  entryTitle: string;
  currentHeading: string;
  targets: MoveTargetGroup[];
  entryId: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function move(sectionId: number) {
    setError(null);
    startTransition(async () => {
      const result = await moveEntryToSection(entryId, sectionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Move entry">
      <p className="text-sm text-muted">
        Move <span className="font-medium text-ink">{entryTitle}</span> out of{" "}
        <span className="font-medium text-ink">{currentHeading}</span>. Its
        bullets go with it, and any resume that already used it keeps its copy.
      </p>

      <div className="mt-5 space-y-5">
        {targets.map((group) => (
          <div key={group.groupName ?? "__ungrouped"}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              {group.groupName ?? "Not in a group"}
            </p>
            <div className="space-y-1">
              {group.sections.map((s) => (
                <button
                  key={s.id}
                  disabled={pending}
                  onClick={() => move(s.id)}
                  className="group flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-sm transition-colors hover:border-accent hover:bg-accentSoft disabled:opacity-50"
                >
                  <span className="truncate">{s.heading}</span>
                  <ArrowRight
                    size={14}
                    className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </Modal>
  );
}
