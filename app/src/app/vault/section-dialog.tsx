"use client";

import { useState, useTransition } from "react";

import { Modal } from "@/components/ui";
import type { VaultGroup, VaultSection } from "@/db/schema";
import { cn } from "@/lib/utils";

import { createGroup, createSection, updateSection } from "./actions";

/** The select's value for "make a new group with the name typed below". */
const NEW_GROUP = "new";

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
 *
 * The group is required and comes first: groups are the vault's top level
 * ("Work Experience") and a section is a shelf inside one ("SDE Experience").
 * A group can be created from here, so an empty vault isn't a dead end.
 */
export function SectionDialog({
  open,
  onClose,
  groups,
  section,
  defaultGroupId,
}: {
  open: boolean;
  onClose: () => void;
  groups: VaultGroup[];
  /** Present when editing; absent when creating. */
  section?: VaultSection;
  /** Preselected group when creating — set by a group's own "+" in the sidebar. */
  defaultGroupId?: number;
}) {
  const editing = Boolean(section);

  const [heading, setHeading] = useState(section?.heading ?? "");
  const [type, setType] = useState<"normal" | "skill">(
    (section?.type as "normal" | "skill") ?? "normal",
  );
  const [group, setGroup] = useState<number | typeof NEW_GROUP | null>(
    section?.groupId ??
      defaultGroupId ??
      (groups.length === 0 ? NEW_GROUP : groups.length === 1 ? groups[0]!.id : null),
  );
  const [newGroupName, setNewGroupName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const groupReady = group === NEW_GROUP ? Boolean(newGroupName.trim()) : group !== null;

  function submit() {
    setError(null);
    startTransition(async () => {
      let groupId: number;
      if (group === NEW_GROUP) {
        const made = await createGroup(newGroupName);
        if (!made.ok) {
          setError(made.error);
          return;
        }
        groupId = made.data;
      } else if (group === null) {
        setError("Choose a group for this section");
        return;
      } else {
        groupId = group;
      }

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
          <label className="label" htmlFor="sec-group">
            Group
          </label>
          <select
            id="sec-group"
            className="field"
            value={group ?? ""}
            onChange={(e) =>
              setGroup(
                e.target.value === NEW_GROUP
                  ? NEW_GROUP
                  : e.target.value
                    ? Number(e.target.value)
                    : null,
              )
            }
          >
            {group === null && <option value="">Choose a group…</option>}
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value={NEW_GROUP}>+ New group…</option>
          </select>
          {group === NEW_GROUP && (
            <input
              className="field mt-2"
              placeholder="Group name — e.g. Work Experience, Skills"
              aria-label="New group name"
              value={newGroupName}
              autoFocus={groups.length > 0}
              onChange={(e) => setNewGroupName(e.target.value)}
            />
          )}
          <p className="hint mt-1">
            The broad area this belongs to. One group can hold several sections —
            &ldquo;Work Experience&rdquo; might hold &ldquo;SDE Experience&rdquo; and
            &ldquo;AI/ML Experience&rdquo;.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="sec-heading">
            Heading
          </label>
          <input
            id="sec-heading"
            className="field"
            value={heading}
            autoFocus
            placeholder="e.g. SDE Experience, Publications, Web Dev Skills"
            onChange={(e) => setHeading(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && heading.trim() && groupReady) submit();
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
            disabled={pending || !heading.trim() || !groupReady}
          >
            {pending ? "Saving…" : editing ? "Save" : "Create section"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
