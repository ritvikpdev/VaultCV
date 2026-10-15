"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  Vault,
} from "lucide-react";

import { SectionPath } from "@/components/section-path";
import { ConfirmButton, Modal } from "@/components/ui";
import type { VaultSection } from "@/db/schema";
import {
  groupSkillsForEditing,
  type ResolvedResume,
  type ResolvedSection,
} from "@/lib/resume-model";
import { SECTION_DEFS, getSectionDef } from "@/lib/sections";
import { useSortable, type SortableHandleProps } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";
import { pathOfEntry } from "@/lib/vault-path";

import {
  addSection,
  editResumeBullet,
  removeResumeEntry,
  removeResumeSkill,
  removeSection,
  removeSkillCategory,
  renameSection,
  reorderResumeBullets,
  reorderResumeEntries,
  reorderSkillCategories,
  toggleBulletVisible,
  toggleEntryVisible,
} from "../actions";
import { AddBullet } from "./add-bullet";
import { ManualEntryDialog } from "./manual-entry-dialog";
import { useVaultIndex } from "./vault-index-context";
import {
  SkillCategoryDialog,
  type VaultSkillTarget,
} from "./skill-category-dialog";
import {
  VaultPicker,
  type VaultEntryOption,
  type VaultSkillOption,
} from "./vault-picker";

export type SectionVaultData = Record<
  number,
  {
    sections: VaultSection[];
    entries: VaultEntryOption[];
    skills: VaultSkillOption[];
    usedEntryIds: number[];
    usedSkillIds: number[];
  }
>;

function BulletRow({
  bullet,
  dragging,
  register,
  handle,
}: {
  bullet: ResolvedSection["entries"][number]["bullets"][number];
  dragging: boolean;
  register: (el: HTMLElement | null) => void;
  handle: SortableHandleProps;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bullet.text);
  const [, startTransition] = useTransition();

  if (editing) {
    return (
      <li className="rounded-lg bg-canvas p-2">
        <textarea
          className="field min-h-16 resize-y bg-surface text-sm"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(bullet.text);
              setEditing(false);
            }
          }}
        />
        <div className="mt-1.5 flex gap-2">
          <button
            className="btn-accent px-2 py-0.5 text-xs"
            onClick={() =>
              startTransition(async () => {
                await editResumeBullet(bullet.id, draft);
                setEditing(false);
              })
            }
          >
            Save
          </button>
          <button
            className="btn-ghost px-2 py-0.5 text-xs"
            onClick={() => {
              setDraft(bullet.text);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
        <p className="hint mt-1.5">
          Editing here changes this resume only — your vault copy is untouched.
        </p>
      </li>
    );
  }

  return (
    <li
      ref={register}
      className={cn(
        "group flex items-start gap-1 rounded py-1 pr-1 transition-opacity hover:bg-canvas",
        dragging && "opacity-40",
      )}
    >
      <span
        {...handle}
        className="mt-0.5 shrink-0 text-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
        title="Drag to reorder"
      >
        <GripVertical size={11} />
      </span>

      <span
        className={cn(
          "mt-1.5 h-1 w-1 shrink-0 rounded-full",
          bullet.isVisible ? "bg-ink" : "bg-line",
        )}
      />
      <span
        className={cn(
          "flex-1 text-sm leading-snug",
          !bullet.isVisible && "text-muted line-through",
        )}
      >
        {bullet.text}
      </span>
      <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
        <button
          className="rounded p-1 text-muted hover:bg-line"
          title={bullet.isVisible ? "Hide from resume" : "Show on resume"}
          onClick={() => startTransition(() => void toggleBulletVisible(bullet.id))}
        >
          {bullet.isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <button
          className="rounded p-1 text-muted hover:bg-line"
          title="Edit for this resume"
          onClick={() => setEditing(true)}
        >
          <Pencil size={12} />
        </button>
      </span>
    </li>
  );
}

/** One entry on the resume, owning the drag list for its own bullets. */
function ResumeEntryCard({
  entry,
  dragging,
  register,
  handle,
}: {
  entry: ResolvedSection["entries"][number];
  dragging: boolean;
  register: (el: HTMLElement | null) => void;
  handle: SortableHandleProps;
}) {
  const [, startTransition] = useTransition();
  // Where in the vault this entry was pulled from, as it is filed now. Null for
  // an entry typed straight into the resume, or one whose source was deleted.
  const source = pathOfEntry(useVaultIndex(), entry.sourceEntryId);

  const bulletById = useMemo(
    () => new Map(entry.bullets.map((b) => [b.id, b])),
    [entry.bullets],
  );

  const order = useMemo(
    () => ({ bullets: entry.bullets.map((b) => b.id) }),
    [entry.bullets],
  );

  const sort = useSortable({
    value: order,
    onCommit: (next) =>
      startTransition(() => {
        void reorderResumeBullets(entry.id, next.bullets ?? []);
      }),
  });

  const bullets = (sort.order.bullets ?? [])
    .map((id) => bulletById.get(id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b));

  return (
    <div
      ref={register}
      className={cn(
        "group/e rounded-lg border border-line p-3 transition-opacity",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-1.5">
        <span
          {...handle}
          className="mt-0.5 shrink-0 text-muted opacity-0 transition-opacity hover:text-ink group-hover/e:opacity-100"
          title="Drag to reorder"
        >
          <GripVertical size={12} />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm font-medium",
              !entry.isVisible && "text-muted line-through",
            )}
          >
            {entry.title}
            {entry.organization && (
              <span className="font-normal text-muted">, {entry.organization}</span>
            )}
          </p>
          <p className="hint">
            {[entry.startDate, entry.isCurrent ? "Present" : entry.endDate]
              .filter(Boolean)
              .join(" – ")}
            {entry.location ? ` · ${entry.location}` : ""}
          </p>
          {source && (
            <p className="mt-1 flex min-w-0 items-center gap-1 text-[11px]">
              <span className="shrink-0 text-muted">From</span>
              <SectionPath path={source} />
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-0.5">
          <button
            className="rounded p-1 text-muted hover:bg-canvas"
            title={entry.isVisible ? "Hide from resume" : "Show on resume"}
            onClick={() => startTransition(() => void toggleEntryVisible(entry.id))}
          >
            {entry.isVisible ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <ConfirmButton
            className="rounded p-1 text-muted hover:bg-canvas hover:text-red-600"
            title="Remove from this resume"
            message={`Remove "${entry.title}" from this resume? It stays in your vault.`}
            onConfirm={() => startTransition(() => void removeResumeEntry(entry.id))}
          >
            <Trash2 size={13} />
          </ConfirmButton>
        </div>
      </div>

      {bullets.length > 0 && (
        <ul ref={sort.registerContainer("bullets")} className="mt-2 space-y-0.5">
          {bullets.map((b) => (
            <BulletRow
              key={b.id}
              bullet={b}
              dragging={sort.draggingId === b.id}
              register={sort.registerItem(b.id)}
              handle={sort.handleProps(b.id, "bullets")}
            />
          ))}
        </ul>
      )}

      <AddBullet
        resumeEntryId={entry.id}
        entryLabel={
          entry.organization ? `${entry.title}, ${entry.organization}` : entry.title
        }
      />
    </div>
  );
}

/**
 * The entries of one section, draggable among themselves.
 *
 * Deliberately one container per section rather than one across the tab.
 * Resume sections are typed — EDUCATION renders degrees, WORK EXPERIENCE
 * renders jobs with dates and bullets — so a job dragged into Education would
 * be rendered under the wrong heading with fields that don't apply.
 */
function ResumeEntries({ section }: { section: ResolvedSection }) {
  const [, startTransition] = useTransition();

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
        void reorderResumeEntries(section.id, next.entries ?? []);
      }),
  });

  if (section.entries.length === 0) {
    return <p className="hint mt-3">No entries yet.</p>;
  }

  const entries = (sort.order.entries ?? [])
    .map((id) => entryById.get(id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));

  return (
    <div ref={sort.registerContainer("entries")} className="mt-3 space-y-3">
      {entries.map((entry) => (
        <ResumeEntryCard
          key={entry.id}
          entry={entry}
          dragging={sort.draggingId === entry.id}
          register={sort.registerItem(entry.id)}
          handle={sort.handleProps(entry.id, "entries")}
        />
      ))}
    </div>
  );
}

/** Everything the skill-category editor needs, and none of it per-section. */
export type VaultSkillContext = {
  targets: VaultSkillTarget[];
  /** Names already in the vault index, so the save step can skip the obvious. */
  known: string[];
};

/**
 * The skills of one section, grouped into the lines the resume actually prints.
 *
 * A category is derived — it is simply the rows that share a category string —
 * so the row's identity here is its first skill's id. That is stable for as
 * long as the group exists, and it is rebuilt from server state on every
 * render, so a reorder never leaves it pointing at a row that moved.
 */
function SkillCategories({
  section,
  onEdit,
}: {
  section: ResolvedSection;
  onEdit: (category: string, skills: string) => void;
}) {
  const [, startTransition] = useTransition();

  const groups = useMemo(
    () => groupSkillsForEditing(section.skills),
    [section.skills],
  );

  const byKey = useMemo(
    () => new Map(groups.map((g) => [g.skills[0]!.id, g])),
    [groups],
  );

  const order = useMemo(
    () => ({ categories: groups.map((g) => g.skills[0]!.id) }),
    [groups],
  );

  const sort = useSortable({
    value: order,
    onCommit: (next) =>
      startTransition(() => {
        void reorderSkillCategories(
          section.id,
          (next.categories ?? [])
            .map((id) => byKey.get(id)?.category)
            .filter((c): c is string => c !== undefined),
        );
      }),
  });

  if (groups.length === 0) {
    return (
      <p className="hint mt-3">
        No skills yet. Add a category, or pull what you have from the vault.
      </p>
    );
  }

  const ordered = (sort.order.categories ?? [])
    .map((id) => byKey.get(id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g));

  return (
    <div ref={sort.registerContainer("categories")} className="mt-3 space-y-2">
      {ordered.map((group) => {
        const key = group.skills[0]!.id;
        return (
          <div
            key={key}
            ref={sort.registerItem(key)}
            className={cn(
              "group/c rounded-lg border border-line p-2.5 transition-opacity",
              sort.draggingId === key && "opacity-40",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span
                {...sort.handleProps(key, "categories")}
                className="shrink-0 text-muted opacity-0 transition-opacity hover:text-ink group-hover/c:opacity-100"
                title="Drag to reorder"
              >
                <GripVertical size={12} />
              </span>
              <p className="flex-1 truncate text-xs font-semibold">
                {group.category || <span className="text-muted">Uncategorised</span>}
              </p>
              <button
                className="rounded p-1 text-muted opacity-0 transition-opacity hover:bg-canvas group-hover/c:opacity-100"
                title="Edit category"
                onClick={() =>
                  onEdit(group.category, group.skills.map((s) => s.name).join(", "))
                }
              >
                <Pencil size={12} />
              </button>
              <ConfirmButton
                className="rounded p-1 text-muted opacity-0 transition-opacity hover:bg-canvas hover:text-red-600 group-hover/c:opacity-100"
                title="Remove category"
                message={`Remove the "${group.category}" line from this resume? Your vault keeps everything.`}
                onConfirm={() =>
                  startTransition(
                    () => void removeSkillCategory(section.id, group.category),
                  )
                }
              >
                <Trash2 size={12} />
              </ConfirmButton>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5 pl-4">
              {group.skills.map((s) => (
                <span
                  key={s.id}
                  className="group/s inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs"
                >
                  {s.name}
                  <button
                    className="text-muted opacity-0 hover:text-red-600 group-hover/s:opacity-100"
                    title="Remove this skill"
                    onClick={() => startTransition(() => void removeResumeSkill(s.id))}
                  >
                    <Trash2 size={10} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SectionCard({
  section,
  vault,
  vaultSkills,
  collapsed,
  onToggle,
}: {
  section: ResolvedSection;
  vault: SectionVaultData[number] | undefined;
  vaultSkills: VaultSkillContext;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [heading, setHeading] = useState(section.heading);
  const [editingCategory, setEditingCategory] = useState<{
    category: string;
    skills: string;
  } | null>(null);
  const [, startTransition] = useTransition();

  const def = getSectionDef(section.sectionType);

  // What a folded card says about itself, so collapsing doesn't hide whether
  // there is anything inside worth opening.
  const summary =
    section.layout === "skill"
      ? (() => {
          const n = groupSkillsForEditing(section.skills).length;
          return n === 1 ? "1 category" : `${n} categories`;
        })()
      : section.entries.length === 1
        ? "1 entry"
        : `${section.entries.length} entries`;

  return (
    <>
      <div className="card p-4">
        <div className="flex items-center gap-2">
          {renaming ? (
            <input
              className="field flex-1 text-sm font-semibold"
              value={heading}
              autoFocus
              onChange={(e) => setHeading(e.target.value)}
              onBlur={() =>
                startTransition(async () => {
                  await renameSection(section.id, heading);
                  setRenaming(false);
                })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setHeading(section.heading);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <button
              className="flex-1 text-left text-sm font-semibold uppercase tracking-wide hover:text-accent"
              onClick={() => setRenaming(true)}
              title="Click to rename"
            >
              {section.heading}
            </button>
          )}

          <button
            className="rounded p-1 text-muted hover:bg-canvas"
            title={collapsed ? "Expand" : "Collapse"}
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <ConfirmButton
            className="rounded p-1 text-muted hover:bg-canvas hover:text-red-600"
            title="Remove section"
            message={`Remove the ${section.heading} section from this resume? Your vault keeps everything.`}
            onConfirm={() => startTransition(() => void removeSection(section.id))}
          >
            <Trash2 size={14} />
          </ConfirmButton>
        </div>

        {collapsed ? (
          <p className="hint mt-2">{summary}</p>
        ) : section.layout === "skill" ? (
          <SkillCategories
            section={section}
            onEdit={(category, skills) => setEditingCategory({ category, skills })}
          />
        ) : (
          <ResumeEntries section={section} />
        )}

        <div className={cn("mt-3 flex gap-3", collapsed && "hidden")}>
          <button
            className="flex items-center gap-1.5 text-sm text-muted hover:text-accent"
            onClick={() =>
              section.layout === "skill"
                ? setEditingCategory({ category: "", skills: "" })
                : setManualOpen(true)
            }
          >
            <Plus size={14} />
            {section.layout === "skill" ? "Add category" : "Add entry"}
          </button>
          <button
            className="flex items-center gap-1.5 text-sm text-muted hover:text-accent"
            onClick={() => setPickerOpen(true)}
          >
            <Vault size={14} /> Pull from vault
          </button>
        </div>
      </div>

      {section.layout !== "skill" && (
        <ManualEntryDialog
          open={manualOpen}
          onClose={() => setManualOpen(false)}
          sectionId={section.id}
          def={def}
        />
      )}

      {/*
        Keyed on the category it edits, so reopening for a different line
        re-runs the field initialisers instead of showing the previous one.
      */}
      {editingCategory && (
        <SkillCategoryDialog
          key={editingCategory.category || "__new"}
          open
          onClose={() => setEditingCategory(null)}
          sectionId={section.id}
          initialCategory={editingCategory.category || undefined}
          initialSkills={editingCategory.skills}
          knownSkills={vaultSkills.known}
          vaultTargets={vaultSkills.targets}
        />
      )}

      {vault && (
        <VaultPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          sectionId={section.id}
          sectionLabel={def.label}
          layout={section.layout}
          vaultSections={vault.sections}
          entries={vault.entries}
          skills={vault.skills}
          usedEntryIds={vault.usedEntryIds}
          usedSkillIds={vault.usedSkillIds}
        />
      )}
    </>
  );
}

export function ContentTab({
  resume,
  vaultData,
  vaultSkills,
}: {
  resume: ResolvedResume;
  vaultData: SectionVaultData;
  vaultSkills: VaultSkillContext;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [, startTransition] = useTransition();

  const present = new Set(resume.sections.map((s) => s.sectionType));

  const toggle = useCallback((id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // One control that reads the current state, so it can't be pressed into a
  // no-op. Content stacks every section vertically, which is where folding
  // earns its place — the whole resume becomes an outline in one click.
  const allCollapsed =
    resume.sections.length > 0 && collapsed.size >= resume.sections.length;

  return (
    <div className="space-y-4">
      {resume.sections.length > 1 && (
        <div className="flex justify-end">
          <button
            className="flex items-center gap-1.5 text-xs text-muted hover:text-accent"
            onClick={() =>
              setCollapsed(
                allCollapsed ? new Set() : new Set(resume.sections.map((s) => s.id)),
              )
            }
          >
            {allCollapsed ? (
              <>
                <ChevronsUpDown size={13} /> Expand all
              </>
            ) : (
              <>
                <ChevronsDownUp size={13} /> Collapse all
              </>
            )}
          </button>
        </div>
      )}

      {resume.sections.map((section) => (
        <SectionCard
          key={section.id}
          section={section}
          vault={vaultData[section.id]}
          vaultSkills={vaultSkills}
          collapsed={collapsed.has(section.id)}
          onToggle={() => toggle(section.id)}
        />
      ))}

      <button className="btn-accent w-full" onClick={() => setAddOpen(true)}>
        <Plus size={16} /> Add content
      </button>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add content" wide>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SECTION_DEFS.map((def) => (
            <button
              key={def.type}
              className="rounded-lg border border-line p-4 text-left transition-colors hover:border-accent disabled:opacity-40 disabled:hover:border-line"
              disabled={present.has(def.type)}
              onClick={() =>
                startTransition(async () => {
                  await addSection(resume.id, def.type);
                  setAddOpen(false);
                })
              }
            >
              <p className="text-sm font-medium">
                {def.label}
                {present.has(def.type) && (
                  <span className="ml-2 text-xs font-normal text-muted">Added</span>
                )}
              </p>
              <p className="hint mt-1">{def.blurb}</p>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
