"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { FolderPlus, GripVertical, ListPlus, Search, Trash2, Upload, X } from "lucide-react";

import { ConfirmButton } from "@/components/ui";
import type { VaultGroup, VaultSection } from "@/db/schema";
import { useSortable } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";

import { createGroup, deleteGroup, reorderBlocks, reorderSections } from "./actions";
import { SectionDialog } from "./section-dialog";

export type SidebarBlock = { group: VaultGroup | null; sections: VaultSection[] };

/**
 * Group ids are positive autoincrement, so zero is free to stand for "no group".
 * The sortable hook keys on numbers; this is the one place null needs a number.
 */
const UNGROUPED = 0;

const containerKey = (groupId: number | null) =>
  groupId === null ? "none" : String(groupId);

/**
 * Vault navigation.
 *
 * Sections are whatever the user made; groups are optional and named by them.
 * There is no fixed Career / Credentials / Personal taxonomy — that decided for
 * people how their own history should be filed, which isn't the app's call.
 *
 * Two independent drag lists live here: the blocks (each group, plus the
 * ungrouped one) reorder among themselves, and sections reorder within a block
 * or move between them. Dragging a section into another group's list is how you
 * file it — the edit dialog still works, but it was the only way before, and a
 * dialog is a poor place for something this spatial.
 */
export function VaultSidebar({
  blocks,
  counts,
  activeId,
}: {
  blocks: SidebarBlock[];
  counts: Record<number, number>;
  activeId: number | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [newSectionOpen, setNewSectionOpen] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const groups = useMemo(
    () => blocks.map((b) => b.group).filter((g): g is VaultGroup => g !== null),
    [blocks],
  );

  const blockByKey = useMemo(
    () => new Map(blocks.map((b) => [b.group?.id ?? UNGROUPED, b])),
    [blocks],
  );

  const sectionById = useMemo(
    () => new Map(blocks.flatMap((b) => b.sections).map((s) => [s.id, s])),
    [blocks],
  );

  const blockOrder = useMemo(
    () => ({ blocks: blocks.map((b) => b.group?.id ?? UNGROUPED) }),
    [blocks],
  );

  const sectionOrder = useMemo(
    () =>
      Object.fromEntries(
        blocks.map((b) => [
          containerKey(b.group?.id ?? null),
          b.sections.map((s) => s.id),
        ]),
      ),
    [blocks],
  );

  const blockSort = useSortable({
    value: blockOrder,
    onCommit: (next) =>
      startTransition(() => {
        void reorderBlocks(
          (next.blocks ?? []).map((key) => (key === UNGROUPED ? null : key)),
        );
      }),
  });

  const sectionSort = useSortable({
    value: sectionOrder,
    onCommit: (next) =>
      startTransition(() => {
        // Section order is written as the whole sidebar in one call, so the
        // current block order has to travel with it — see reorderSections.
        void reorderSections(
          (blockSort.order.blocks ?? []).map((key) => {
            const groupId = key === UNGROUPED ? null : key;
            return { groupId, sectionIds: next[containerKey(groupId)] ?? [] };
          }),
        );
      }),
  });

  function submitGroup() {
    const name = groupName.trim();
    if (!name) return;

    setError(null);
    startTransition(async () => {
      const result = await createGroup(name);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setGroupName("");
      setAddingGroup(false);
      // Creating a group produces no visible change until a section joins it,
      // so say so explicitly rather than leaving the click feeling ignored.
      setNotice(`Group "${name}" created`);
      setTimeout(() => setNotice(null), 4000);
    });
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/vault?q=${encodeURIComponent(q)}` : "/vault");
  }

  const orderedKeys = blockSort.order.blocks ?? [];
  const hasGroups = groups.length > 0;

  return (
    <aside className="w-60 shrink-0 space-y-5">
      <form onSubmit={submitSearch} className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          className="field pl-8 pr-8"
          placeholder="Search vault"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
            onClick={() => {
              setQuery("");
              router.push("/vault");
            }}
          >
            <X size={14} />
          </button>
        )}
      </form>

      <Link
        href="/vault/import"
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-canvas hover:text-ink"
      >
        <Upload size={14} />
        Import a resume
      </Link>

      {sectionById.size === 0 && (
        <p className="hint px-3">
          No sections yet. Create one, or import a resume and the sections it
          contains will be created for you.
        </p>
      )}

      <div ref={blockSort.registerContainer("blocks")} className="space-y-4">
        {orderedKeys.map((key) => {
          const block = blockByKey.get(key);
          if (!block) return null;

          const groupId = key === UNGROUPED ? null : key;
          const ids = sectionSort.order[containerKey(groupId)] ?? [];
          const sections = ids
            .map((id) => sectionById.get(id))
            .filter((s): s is VaultSection => Boolean(s));

          return (
            <div
              key={key}
              ref={blockSort.registerItem(key)}
              className={cn(
                "group/g rounded-lg transition-opacity",
                blockSort.draggingId === key && "opacity-40",
              )}
            >
              {/*
                The ungrouped block gets a header only once a group exists.
                Before that it is the entire sidebar, with nothing to reorder it
                against, so an "Ungrouped" label would be pure noise.
              */}
              {(block.group || hasGroups) && (
                <div className="flex items-center gap-1 px-3 pb-1.5">
                  <span
                    {...blockSort.handleProps(key, "blocks")}
                    className="-ml-1.5 rounded text-muted opacity-0 transition-opacity hover:text-ink group-hover/g:opacity-100"
                    title="Drag to reorder"
                  >
                    <GripVertical size={12} />
                  </span>

                  <p className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {block.group ? block.group.name : "Ungrouped"}
                  </p>

                  {block.group && (
                    <ConfirmButton
                      className="text-muted opacity-0 transition-opacity hover:text-red-600 group-hover/g:opacity-100"
                      title="Delete group"
                      message={`Delete the group "${block.group.name}"? Its sections stay in your vault, just ungrouped.`}
                      onConfirm={() => {
                        const id = block.group?.id;
                        if (id) startTransition(() => void deleteGroup(id));
                      }}
                    >
                      <Trash2 size={11} />
                    </ConfirmButton>
                  )}
                </div>
              )}

              {/*
                Registered as a drop target even when empty — that is precisely
                when you most need to be able to drag a section into it.
              */}
              <div ref={sectionSort.registerContainer(containerKey(groupId))}>
                {sections.length === 0 ? (
                  <p className="hint px-3 pb-1">
                    Empty — drag a section here, or use the pencil to file one.
                  </p>
                ) : (
                  <nav className="space-y-0.5">
                    {sections.map((s) => (
                      <SectionRow
                        key={s.id}
                        section={s}
                        count={counts[s.id] ?? 0}
                        active={activeId === s.id}
                        dragging={sectionSort.draggingId === s.id}
                        register={sectionSort.registerItem(s.id)}
                        handle={sectionSort.handleProps(s.id, containerKey(groupId))}
                      />
                    ))}
                  </nav>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-1 border-t border-line pt-4">
        <button
          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-canvas hover:text-ink"
          onClick={() => setNewSectionOpen(true)}
        >
          <ListPlus size={14} /> New section
        </button>

        {addingGroup ? (
          <div className="px-3 pt-1">
            <input
              className="field text-sm"
              placeholder="Group name"
              value={groupName}
              autoFocus
              onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setGroupName("");
                  setAddingGroup(false);
                }
                if (e.key === "Enter" && groupName.trim()) submitGroup();
              }}
              // Deliberately NOT closing on blur. Clicking the Create button
              // blurs the input first, so a blur-to-cancel handler threw the
              // name away before the click could register.
            />
            <div className="mt-1.5 flex gap-1.5">
              <button
                className="btn-accent px-2 py-1 text-xs"
                disabled={pending || !groupName.trim()}
                onClick={submitGroup}
              >
                Create
              </button>
              <button
                className="btn-ghost px-2 py-1 text-xs"
                onClick={() => {
                  setGroupName("");
                  setAddingGroup(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-canvas hover:text-ink"
            onClick={() => setAddingGroup(true)}
          >
            <FolderPlus size={14} /> New group
          </button>
        )}
      </div>

      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      <SectionDialog
        key={newSectionOpen ? "open" : "closed"}
        open={newSectionOpen}
        onClose={() => setNewSectionOpen(false)}
        groups={groups}
      />
    </aside>
  );
}

function SectionRow({
  section,
  count,
  active,
  dragging,
  register,
  handle,
}: {
  section: VaultSection;
  count: number;
  active: boolean;
  dragging: boolean;
  register: (el: HTMLElement | null) => void;
  handle: ReturnType<ReturnType<typeof useSortable>["handleProps"]>;
}) {
  return (
    <div
      ref={register}
      className={cn(
        "group/s flex items-center rounded-lg transition-opacity",
        dragging && "opacity-40",
      )}
    >
      {/*
        The grip sits beside the link, not inside it. Dragging from within an
        anchor fights the browser's own link-drag behaviour, and a press that
        ends without moving would navigate.
      */}
      <span
        {...handle}
        className="shrink-0 pl-1 text-muted opacity-0 transition-opacity hover:text-ink group-hover/s:opacity-100"
        title="Drag to reorder, or into another group"
      >
        <GripVertical size={12} />
      </span>

      <Link
        href={`/vault?section=${section.id}`}
        className={cn(
          "flex min-w-0 flex-1 items-center justify-between rounded-lg py-1.5 pl-1.5 pr-3 text-sm transition-colors",
          active
            ? "bg-accentSoft font-medium text-accent"
            : "text-muted hover:bg-canvas hover:text-ink",
        )}
      >
        <span className="truncate">{section.heading}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {section.type === "skill" && (
            <span className="text-[10px] uppercase tracking-wide opacity-60">
              skill
            </span>
          )}
          {count > 0 && (
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px]",
                active ? "bg-accent text-white" : "bg-line text-muted",
              )}
            >
              {count}
            </span>
          )}
        </span>
      </Link>
    </div>
  );
}
