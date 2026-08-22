"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { ChevronsDownUp, ChevronsUpDown, Pencil, Plus, Trash2 } from "lucide-react";

import { ConfirmButton } from "@/components/ui";
import type { SectionWithEntries } from "@/db/queries";
import type { VaultGroup } from "@/db/schema";
import { useSortable } from "@/lib/use-sortable";

import { deleteSection, reorderEntries } from "./actions";
import { EntryCard } from "./entry-card";
import { EntryDialog } from "./entry-dialog";
import type { MoveTargetGroup } from "./move-entry-dialog";
import { SectionDialog } from "./section-dialog";

export function SectionView({
  section,
  groups,
  moveTargets,
}: {
  section: SectionWithEntries;
  groups: VaultGroup[];
  /** Where an entry in this section may be moved. Same kind only, this one excluded. */
  moveTargets: MoveTargetGroup[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [, startTransition] = useTransition();

  const isSkill = section.type === "skill";
  const bulletCount = section.entries.reduce((n, e) => n + e.bullets.length, 0);

  const entryById = useMemo(
    () => new Map(section.entries.map((e) => [e.id, e])),
    [section.entries],
  );

  const order = useMemo(
    () => ({ entries: section.entries.map((e) => e.id) }),
    [section.entries],
  );

  const sort = useSortable({
    value: order,
    onCommit: (next) =>
      startTransition(() => {
        void reorderEntries(section.id, next.entries ?? []);
      }),
  });

  const toggle = useCallback((id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // One control that reads the current state, rather than separate Collapse and
  // Expand buttons — it can never be pressed into a no-op.
  const allCollapsed =
    section.entries.length > 0 && collapsed.size >= section.entries.length;

  const entries = (sort.order.entries ?? [])
    .map((id) => entryById.get(id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));

  return (
    <div className="min-w-0 flex-1 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{section.heading}</h2>
          <p className="hint mt-0.5">
            {section.entries.length === 0
              ? isSkill
                ? "Skill entries — a label plus its sub-skills"
                : "Entries with dates and bullet points"
              : isSkill
                ? `${section.entries.length} skill ${section.entries.length === 1 ? "entry" : "entries"}`
                : `${section.entries.length} ${section.entries.length === 1 ? "entry" : "entries"} · ${bulletCount} ${bulletCount === 1 ? "bullet" : "bullets"}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {section.entries.length > 1 && (
            <button
              className="rounded p-1.5 text-muted hover:bg-canvas"
              title={allCollapsed ? "Expand all" : "Collapse all"}
              onClick={() =>
                setCollapsed(
                  allCollapsed ? new Set() : new Set(section.entries.map((e) => e.id)),
                )
              }
            >
              {allCollapsed ? (
                <ChevronsUpDown size={15} />
              ) : (
                <ChevronsDownUp size={15} />
              )}
            </button>
          )}
          <button
            className="rounded p-1.5 text-muted hover:bg-canvas"
            title="Rename section"
            onClick={() => setEditOpen(true)}
          >
            <Pencil size={15} />
          </button>
          <ConfirmButton
            className="rounded p-1.5 text-muted hover:bg-canvas hover:text-red-600"
            title="Delete section"
            message={`Delete "${section.heading}" and its ${section.entries.length} entr${section.entries.length === 1 ? "y" : "ies"}? This cannot be undone.`}
            onConfirm={() => startTransition(() => void deleteSection(section.id))}
          >
            <Trash2 size={15} />
          </ConfirmButton>
          <button className="btn-accent ml-2" onClick={() => setAddOpen(true)}>
            <Plus size={16} /> Add entry
          </button>
        </div>
      </div>

      {section.entries.length === 0 ? (
        <div className="card flex min-h-48 flex-col items-center justify-center border-dashed p-8 text-center">
          <p className="font-medium">Nothing here yet</p>
          <p className="hint mt-1 max-w-sm">
            {isSkill
              ? "A skill entry is one line on your resume — a label like “Languages” plus the skills under it."
              : "Add jobs, degrees, projects — whatever this section is for."}
          </p>
          <button className="btn-ghost mt-4" onClick={() => setAddOpen(true)}>
            <Plus size={15} /> Add the first entry
          </button>
        </div>
      ) : (
        <div ref={sort.registerContainer("entries")} className="space-y-4">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              section={section}
              moveTargets={moveTargets}
              collapsed={collapsed.has(entry.id)}
              onToggle={() => toggle(entry.id)}
              dragging={sort.draggingId === entry.id}
              register={sort.registerItem(entry.id)}
              handle={sort.handleProps(entry.id, "entries")}
            />
          ))}
        </div>
      )}

      <EntryDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        section={section}
      />
      {/*
        Keyed on the section it edits.

        Without this the dialog is one long-lived instance: `useState` seeds its
        fields from `section` on first mount only, so after visiting Education
        first, every subsequent section opened the form still pre-filled with
        "EDUCATION". Changing the key forces a remount, which re-runs the
        initialisers against the section actually being edited. The heading is
        in the key too, so a rename doesn't leave the form showing the old one.
      */}
      <SectionDialog
        key={`${section.id}-${section.heading}`}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        groups={groups}
        section={section}
      />
    </div>
  );
}
