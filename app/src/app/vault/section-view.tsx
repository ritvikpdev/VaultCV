"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { FolderOpen, FolderX, Pencil, Plus, Trash2 } from "lucide-react";

import { ConfirmButton } from "@/components/ui";
import type { SectionWithEntries } from "@/db/queries";
import type { VaultGroup } from "@/db/schema";
import { useSortable } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";

import { createEntry, deleteSection, reorderEntries } from "./actions";
import { EntryPanel } from "./entry-panel";
import { EntryTile } from "./entry-tile";
import type { MoveTargetGroup } from "./move-entry-dialog";
import { SectionDialog } from "./section-dialog";

/**
 * One section as a grid of tiles; clicking a tile opens it in a side panel.
 *
 * The open entry lives in the URL (`?entry=`) so it survives a reload and the
 * back button closes it. It is written with the History API rather than the
 * router: a router push would re-render the page on the server and reload the
 * whole vault just to show a panel for data already on screen. Next keeps
 * `useSearchParams` in sync with History calls, so this stays declarative.
 */
export function SectionView({
  section,
  groups,
  moveTargets,
}: {
  section: SectionWithEntries;
  /** Every group; the section's own is looked up from these. */
  groups: VaultGroup[];
  /** Where an entry in this section may be moved. Same kind only, this one excluded. */
  moveTargets: MoveTargetGroup[];
}) {
  const params = useSearchParams();
  const openId = Number(params.get("entry")) || null;
  const [editOpen, setEditOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [, startTransition] = useTransition();

  // Whether the panel was opened by a click in this page, which pushed a
  // history entry; closing then goes back rather than stacking another.
  const pushed = useRef(false);

  const openEntry = useCallback((id: number) => {
    const next = new URLSearchParams(window.location.search);
    next.set("entry", String(id));
    window.history.pushState(null, "", `?${next}`);
    pushed.current = true;
  }, []);

  const closeEntry = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    const next = new URLSearchParams(window.location.search);
    next.delete("entry");
    window.history.replaceState(null, "", `?${next}`);
  }, []);

  const isSkill = section.type === "skill";
  const groupName = groups.find((g) => g.id === section.groupId)?.name ?? null;
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
    layout: "grid",
    onCommit: (next) =>
      startTransition(() => {
        void reorderEntries(section.id, next.entries ?? []);
      }),
  });

  const entries = (sort.order.entries ?? [])
    .map((id) => entryById.get(id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));

  // Missing while a just-created entry's revalidation is in flight, or after a
  // move or delete; either way there is nothing to show, so show nothing.
  const openEntryData = openId ? entryById.get(openId) : undefined;

  return (
    <div className="min-w-0 flex-1 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {groupName ? (
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
              <FolderOpen size={13} /> {groupName}
            </p>
          ) : (
            <button
              className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:underline"
              onClick={() => setEditOpen(true)}
            >
              <FolderX size={13} /> Not in a group — choose one
            </button>
          )}
          <div className="flex items-center gap-2">
            <h2 className="truncate text-2xl font-semibold tracking-tight">{section.heading}</h2>
            {isSkill && (
              <span className="rounded-full bg-accentSoft px-2 py-0.5 text-[11px] font-medium text-accent">
                Skills
              </span>
            )}
          </div>
          <p className="hint mt-1">
            {section.entries.length === 0
              ? isSkill
                ? "Skill lines — a label plus the skills under it"
                : "Jobs, degrees, projects — anything with dates and achievements"
              : isSkill
                ? `${section.entries.length} skill ${section.entries.length === 1 ? "line" : "lines"}`
                : `${section.entries.length} ${section.entries.length === 1 ? "entry" : "entries"} · ${bulletCount} ${bulletCount === 1 ? "bullet" : "bullets"}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            className="rounded-lg p-2 text-muted hover:bg-surface hover:text-ink"
            title="Rename section"
            onClick={() => setEditOpen(true)}
          >
            <Pencil size={15} />
          </button>
          <ConfirmButton
            className="rounded-lg p-2 text-muted hover:bg-surface hover:text-red-600"
            title="Delete section"
            message={`Delete "${section.heading}" and its ${section.entries.length} entr${section.entries.length === 1 ? "y" : "ies"}? This cannot be undone.`}
            onConfirm={() => startTransition(() => void deleteSection(section.id))}
          >
            <Trash2 size={15} />
          </ConfirmButton>
          <button className="btn-accent ml-2" onClick={() => setAdding(true)}>
            <Plus size={16} /> {isSkill ? "Add skill line" : "Add entry"}
          </button>
        </div>
      </div>

      <div
        ref={sort.registerContainer("entries")}
        className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4"
      >
        {entries.map((entry) => (
          <EntryTile
            key={entry.id}
            entry={entry}
            isSkill={isSkill}
            onOpen={() => openEntry(entry.id)}
            dragging={sort.draggingId === entry.id}
            register={sort.registerItem(entry.id)}
            handle={sort.handleProps(entry.id, "entries")}
          />
        ))}

        <AddTile
          isSkill={isSkill}
          empty={entries.length === 0}
          active={adding}
          onActivate={() => setAdding(true)}
          onCancel={() => setAdding(false)}
          onCreate={async (title) => {
            const result = await createEntry(section.id, { title });
            if (!result.ok) return result.error;
            setAdding(false);
            openEntry(result.data);
            return null;
          }}
        />
      </div>

      {openEntryData && (
        <EntryPanel
          key={openEntryData.id}
          entry={openEntryData}
          section={section}
          groupName={groupName}
          moveTargets={moveTargets}
          onClose={closeEntry}
        />
      )}

      {/*
        Keyed on the section it edits, so its fields re-seed from the section
        actually being edited — a long-lived instance kept the first one's
        heading. The heading is in the key so a rename re-seeds too.
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

/**
 * The last cell of the grid: a dashed "add" tile that turns into a title box.
 * A title is all an entry needs to exist; everything else is filled in the
 * panel it opens into.
 */
function AddTile({
  isSkill,
  empty,
  active,
  onActivate,
  onCancel,
  onCreate,
}: {
  isSkill: boolean;
  empty: boolean;
  active: boolean;
  onActivate: () => void;
  onCancel: () => void;
  /** Resolves to an error message, or null on success. */
  onCreate: (title: string) => Promise<string | null>;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const t = title.trim();
    if (!t) return;
    startTransition(async () => {
      const err = await onCreate(t);
      setError(err);
      if (!err) setTitle("");
    });
  }

  if (!active) {
    return (
      <button
        onClick={onActivate}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-line p-6 text-center text-sm text-muted transition-colors hover:border-accent/40 hover:bg-surface hover:text-accent",
          empty ? "min-h-48 sm:col-span-2" : "min-h-40",
        )}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface shadow-sm">
          <Plus size={18} />
        </span>
        <span className="font-medium">
          {empty
            ? isSkill
              ? "Add your first skill line"
              : "Add your first entry"
            : isSkill
              ? "Add skill line"
              : "Add entry"}
        </span>
        {empty && (
          <span className="max-w-xs text-xs">
            {isSkill
              ? "A label like “Languages” with the skills under it."
              : "A job, degree or project. Start with a title — the rest comes after."}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="card flex min-h-40 flex-col justify-center gap-3 border-accent p-4 shadow-lift">
      <label className="text-sm font-medium" htmlFor="new-entry-title">
        {isSkill ? "Skill label" : "Title"}
      </label>
      <input
        id="new-entry-title"
        className="field"
        autoFocus
        value={title}
        placeholder={isSkill ? "e.g. Languages" : "e.g. Software Engineer"}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setTitle("");
            setError(null);
            onCancel();
          }
        }}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-accent px-3 py-1.5 text-xs" disabled={pending || !title.trim()} onClick={submit}>
          {pending ? "Creating…" : "Create & open"}
        </button>
        <button
          className="btn-ghost px-3 py-1.5 text-xs"
          onClick={() => {
            setTitle("");
            setError(null);
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
