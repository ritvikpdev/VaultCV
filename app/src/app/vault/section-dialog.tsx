"use client";

import { useState, useTransition } from "react";

import { Modal } from "@/components/ui";
import type { VaultGroup, VaultSection } from "@/db/schema";
import { cn } from "@/lib/utils";

import { createSection, updateSection } from "./actions";

/**
 * New / edit section — modelled on the reference tool's "New Custom Section".
 *
 * Heading and Type, nothing else required. There is no menu of predefined
 * sections to pick from: the vault used to impose a closed vocabulary and a
 * three-way grouping, which decided for the user how their career should be
 * filed. Everything here is named by them.
 *
 * Type is fixed after creation. Switching a section between normal and skill
 * would leave every entry in it holding fields the form no longer shows.
 */
export function SectionDialog({
  open,
  onClose,
  groups,
  section,
}: {
  open: boolean;
  onClose: () => void;
  groups: VaultGroup[];
  /** Present when editing; absent when creating. */
  section?: VaultSection;
}) {
  const editing = Boolean(section);

  const [heading, setHeading] = useState(section?.heading ?? "");
  const [type, setType] = useState<"normal" | "skill">(
    (section?.type as "normal" | "skill") ?? "normal",
  );
  const [groupId, setGroupId] = useState<number | null>(section?.groupId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = editing
        ? await updateSection(section!.id, { heading, groupId })
        : await createSection({ heading, type, groupId });

      if (result.ok) {
        onClose();
        if (!editing) setHeading("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit section" : "New section"}
    >
      <div className="space-y-5">
        <div>
          <label className="label" htmlFor="sec-heading">
            Heading
          </label>
          <input
            id="sec-heading"
            className="field"
            value={heading}
            autoFocus
            placeholder="e.g. Work Experience, Publications, Side Projects"
            onChange={(e) => setHeading(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && heading.trim()) submit();
            }}
          />
          <p className="hint mt-1">
            Whatever you call it here is what appears on your resume.
          </p>
        </div>

        <div>
          <label className="label">Type</label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                {
                  value: "normal" as const,
                  label: "Normal",
                  blurb: "Entries with dates and bullet points — jobs, degrees, projects",
                },
                {
                  value: "skill" as const,
                  label: "Skill",
                  blurb: "A label plus a list of sub-skills, rendered as one line",
                },
              ]
            ).map((t) => (
              <button
                key={t.value}
                type="button"
                disabled={editing}
                onClick={() => setType(t.value)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors disabled:opacity-50",
                  type === t.value
                    ? "border-accent bg-accentSoft"
                    : "border-line hover:border-muted",
                )}
              >
                <p className="text-sm font-medium">{t.label}</p>
                <p className="hint mt-0.5">{t.blurb}</p>
              </button>
            ))}
          </div>
          {editing && (
            <p className="hint mt-1.5">
              Type can&rsquo;t change after creation — existing entries are
              already shaped for it.
            </p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="sec-group">
            Group <span className="font-normal text-muted">(optional)</span>
          </label>
          <select
            id="sec-group"
            className="field"
            value={groupId ?? ""}
            onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <p className="hint mt-1">
            Groups are yours to name and only affect how the sidebar is
            organised.
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-accent"
            onClick={submit}
            disabled={pending || !heading.trim()}
          >
            {pending ? "Saving…" : editing ? "Save" : "Create section"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
