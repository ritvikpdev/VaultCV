"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Trash2,
  Undo2,
  Vault,
} from "lucide-react";

import { SectionPath } from "@/components/section-path";
import { ConfirmButton, Modal } from "@/components/ui";
import type { VaultSection } from "@/db/schema";
import { groupSkillsForEditing, type ResolvedEntry, type ResolvedSection } from "@/lib/resume-model";
import { SECTION_DEFS, getSectionDef } from "@/lib/sections";
import { useSortable, type SortableHandleProps } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";
import { pathOfEntry } from "@/lib/vault-path";

import { addSection, removeSection } from "../actions";
import { createBlankEntry } from "../editor-actions";
import { useDraft, type SaveState } from "./draft";
import { EntryEditor } from "./entry-editor";
import { PersonalEditor } from "./personal-editor";
import { defaultIconFor, iconNameFor, SECTION_ICONS, SectionIcon } from "./section-icons";
import { SkillEditor } from "./skill-editor";
import type { VaultSkillTarget } from "./skill-category-dialog";
import { useVaultIndex } from "./vault-index-context";
import { VaultPicker, type VaultEntryOption, type VaultSkillOption } from "./vault-picker";

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

/** Everything the skill-category editor needs, and none of it per-section. */
export type VaultSkillContext = {
  targets: VaultSkillTarget[];
  /** Names already in the vault index, so the save step can skip the obvious. */
  known: string[];
};

/**
 * The Content tab: a list of cards, or one editor.
 *
 * Which one shows is `?edit=` in the URL — `personal`, `entry-<id>`, or
 * `skill-<sectionId>-<category>` — written with the History API so switching
 * doesn't reload the page, and Back returns to the list. Everything renders
 * from the draft (see draft.tsx), so the preview follows every keystroke.
 */
export function ContentTab({
  vaultData,
  vaultSkills,
}: {
  vaultData: SectionVaultData;
  vaultSkills: VaultSkillContext;
}) {
  const draft = useDraft();
  const resume = draft.resume;
  const params = useSearchParams();
  const edit = params.get("edit");
  const [openSection, setOpenSection] = useState<number | null>(resume.sections[0]?.id ?? null);
  const pushed = useRef(false);

  const openEditor = useCallback((value: string, sectionId?: number) => {
    if (sectionId !== undefined) setOpenSection(sectionId);
    const next = new URLSearchParams(window.location.search);
    next.set("tab", "content");
    next.set("edit", value);
    window.history.pushState(null, "", `?${next}`);
    pushed.current = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const closeEditor = useCallback(() => {
    draft.flush();
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    const next = new URLSearchParams(window.location.search);
    next.delete("edit");
    window.history.replaceState(null, "", `?${next}`);
  }, [draft]);

  const editor = edit ? (
    <EditorView
      edit={edit}
      onBack={closeEditor}
      vaultSkills={vaultSkills}
      onSectionFound={setOpenSection}
    />
  ) : null;

  return (
    <div className="space-y-3">
      <SaveStatus state={draft.saveState} error={draft.saveError} />
      {editor ?? (
        <ListView
          vaultData={vaultData}
          openSection={openSection}
          setOpenSection={setOpenSection}
          openEditor={openEditor}
        />
      )}
      <UndoToasts />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editor view                                                         */
/* ------------------------------------------------------------------ */

function parseEdit(edit: string):
  | { kind: "personal" }
  | { kind: "entry"; id: number }
  | { kind: "skill"; sectionId: number; category: string }
  | null {
  if (edit === "personal") return { kind: "personal" };
  const entry = edit.match(/^entry-(\d+)$/);
  if (entry) return { kind: "entry", id: Number(entry[1]) };
  const skill = edit.match(/^skill-(\d+)-(.*)$/);
  if (skill) return { kind: "skill", sectionId: Number(skill[1]), category: decodeURIComponent(skill[2] ?? "") };
  return null;
}

function EditorView({
  edit,
  onBack,
  vaultSkills,
  onSectionFound,
}: {
  edit: string;
  onBack: () => void;
  vaultSkills: VaultSkillContext;
  onSectionFound: (id: number) => void;
}) {
  const { resume } = useDraft();
  const target = parseEdit(edit);

  if (target?.kind === "personal") return <PersonalEditor onBack={onBack} />;

  if (target?.kind === "entry") {
    const section = resume.sections.find((s) => s.entries.some((e) => e.id === target.id));
    const entry = section?.entries.find((e) => e.id === target.id);
    if (!section || !entry) return <Missing onBack={onBack} />;
    return (
      <EntryEditor
        key={entry.id}
        entry={entry}
        section={section}
        onBack={() => {
          onSectionFound(section.id);
          onBack();
        }}
      />
    );
  }

  if (target?.kind === "skill") {
    const section = resume.sections.find((s) => s.id === target.sectionId);
    if (!section) return <Missing onBack={onBack} />;
    return (
      <SkillEditor
        key={`${section.id}-${target.category}`}
        section={section}
        initialCategory={target.category}
        knownSkills={vaultSkills.known}
        vaultTargets={vaultSkills.targets}
        onBack={() => {
          onSectionFound(section.id);
          onBack();
        }}
      />
    );
  }

  return <Missing onBack={onBack} />;
}

/**
 * The thing in the URL isn't in the resume — it was deleted, or (for a moment
 * after Add Entry) hasn't arrived from the server yet.
 */
function Missing({ onBack }: { onBack: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-3 p-8 text-center">
      <Loader2 size={18} className="animate-spin text-muted" />
      <p className="text-sm text-muted">Opening…</p>
      <button className="text-xs font-medium text-violet hover:underline" onClick={onBack}>
        Back to the list
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* List view                                                           */
/* ------------------------------------------------------------------ */

function ListView({
  vaultData,
  openSection,
  setOpenSection,
  openEditor,
}: {
  vaultData: SectionVaultData;
  openSection: number | null;
  setOpenSection: (id: number | null) => void;
  openEditor: (value: string, sectionId?: number) => void;
}) {
  const draft = useDraft();
  const { resume } = draft;
  const [addOpen, setAddOpen] = useState(false);

  const byId = useMemo(() => new Map(resume.sections.map((s) => [s.id, s])), [resume.sections]);
  const order = useMemo(() => ({ sections: resume.sections.map((s) => s.id) }), [resume.sections]);
  const sort = useSortable({
    value: order,
    onCommit: (next) => draft.reorderSections(next.sections ?? []),
  });

  const sections = (sort.order.sections ?? [])
    .map((id) => byId.get(id))
    .filter((s): s is ResolvedSection => Boolean(s));

  return (
    <div className="space-y-3">
      <PersonalCard onEdit={() => openEditor("personal")} />

      <div ref={sort.registerContainer("sections")} className="space-y-3">
        {sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            vault={vaultData[section.id]}
            open={openSection === section.id}
            onToggle={() => setOpenSection(openSection === section.id ? null : section.id)}
            openEditor={openEditor}
            dragging={sort.draggingId === section.id}
            register={sort.registerItem(section.id)}
            handle={sort.handleProps(section.id, "sections")}
          />
        ))}
      </div>

      <div className="flex justify-center pt-2">
        <button className="btn-gradient px-8 py-3" onClick={() => setAddOpen(true)}>
          <Plus size={18} /> Add Content
        </button>
      </div>

      <AddContentModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(sectionId, layout) => {
          setAddOpen(false);
          setOpenSection(sectionId);
          if (layout === "skill") openEditor(`skill-${sectionId}-`, sectionId);
        }}
        onEntry={(entryId, sectionId) => openEditor(`entry-${entryId}`, sectionId)}
      />
    </div>
  );
}

function PersonalCard({ onEdit }: { onEdit: () => void }) {
  const { resume } = useDraft();
  const p = resume.profile;
  const initials = (p.fullName || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onEdit())}
      className="card group relative flex cursor-pointer items-center gap-4 p-5 transition-all duration-150 hover:shadow-lift"
      aria-label="Edit personal details"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-bold tracking-tight">{p.fullName || "Your name"}</p>
        {p.title && <p className="truncate text-sm text-muted">{p.title}</p>}
        <div className="mt-2 space-y-1 text-xs text-muted">
          {p.email && (
            <p className="flex items-center gap-1.5 truncate">
              <Mail size={12} className="shrink-0" /> {p.email}
            </p>
          )}
          {p.phone && (
            <p className="flex items-center gap-1.5">
              <Phone size={12} className="shrink-0" /> {p.phone}
            </p>
          )}
          {p.location && (
            <p className="flex items-center gap-1.5 truncate">
              <MapPin size={12} className="shrink-0" /> {p.location}
            </p>
          )}
          {!p.email && !p.phone && !p.location && <p>Add your contact details</p>}
        </div>
      </div>
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-lg font-semibold text-white">
        {initials}
      </div>
      <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white shadow-card transition-transform group-hover:scale-110">
        <Pencil size={13} />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section card                                                        */
/* ------------------------------------------------------------------ */

function SectionCard({
  section,
  vault,
  open,
  onToggle,
  openEditor,
  dragging,
  register,
  handle,
}: {
  section: ResolvedSection;
  vault: SectionVaultData[number] | undefined;
  open: boolean;
  onToggle: () => void;
  openEditor: (value: string, sectionId?: number) => void;
  dragging: boolean;
  register: (el: HTMLElement | null) => void;
  handle: SortableHandleProps;
}) {
  const draft = useDraft();
  const [editingHeading, setEditingHeading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const def = getSectionDef(section.sectionType);
  const isSkill = section.layout === "skill";

  async function addEntry() {
    if (isSkill) {
      openEditor(`skill-${section.id}-`, section.id);
      return;
    }
    setAdding(true);
    const r = await draft.runAndWait(() => createBlankEntry(section.id));
    setAdding(false);
    if (r.ok) openEditor(`entry-${r.data}`, section.id);
  }

  const count = isSkill ? groupSkillsForEditing(section.skills).length : section.entries.length;

  return (
    <div ref={register} className={cn("card overflow-hidden transition-opacity", dragging && "opacity-40")}>
      {editingHeading ? (
        <HeadingForm section={section} onDone={() => setEditingHeading(false)} />
      ) : (
        <div className="group/h flex items-center gap-2 px-3 py-3">
          <span
            {...handle}
            className="rounded p-1 text-muted opacity-0 transition-opacity hover:text-ink focus:opacity-100 group-hover/h:opacity-100"
            aria-label={`Drag to reorder ${section.heading}`}
            title="Drag to reorder sections"
          >
            <GripVertical size={15} />
          </span>
          <button
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            onClick={onToggle}
            aria-expanded={open}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violetSoft text-violet">
              <SectionIcon section={section} size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{section.heading || def.label}</span>
              {!open && (
                <span className="block text-xs text-muted">
                  {count} {isSkill ? (count === 1 ? "line" : "lines") : count === 1 ? "entry" : "entries"}
                  {!section.isVisible && " · hidden in Customize"}
                </span>
              )}
            </span>
          </button>
          {open && (
            <button
              className="rounded-full bg-violetSoft px-2.5 py-1 text-xs font-medium text-violet transition-colors hover:bg-violet/15"
              onClick={() => setEditingHeading(true)}
            >
              Edit Heading
            </button>
          )}
          <button
            className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink"
            onClick={onToggle}
            aria-label={open ? `Collapse ${section.heading}` : `Expand ${section.heading}`}
          >
            <ChevronDown size={16} className={cn("transition-transform duration-200", open && "rotate-180")} />
          </button>
        </div>
      )}

      {/* Height animation: a grid row that goes from 0fr to 1fr. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-line px-3 pb-3 pt-2">
            {isSkill ? (
              <SkillRows section={section} openEditor={openEditor} />
            ) : (
              <EntryRows section={section} openEditor={openEditor} />
            )}

            <div className="mt-2 flex items-center gap-2 border-t border-line pt-3">
              <button
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-violetSoft hover:text-violet"
                onClick={() => setPickerOpen(true)}
                disabled={!vault}
              >
                <Vault size={14} /> Pull from vault
              </button>
              <button
                className="mx-auto flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold text-accent transition-colors hover:bg-accentSoft"
                onClick={addEntry}
                disabled={adding}
              >
                {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                {isSkill ? "Add Skill" : "Add Entry"}
              </button>
              <ConfirmButton
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-red-50 hover:text-red-600"
                aria-label={`Delete the ${section.heading} section`}
                title="Delete section"
                message={`Remove the ${section.heading} section from this resume? Your vault keeps everything.`}
                onConfirm={() => void draft.runAndWait(() => removeSection(section.id))}
              >
                <Trash2 size={15} />
              </ConfirmButton>
            </div>
          </div>
        </div>
      </div>

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
    </div>
  );
}

/** Edit Heading: an icon picker and the heading, both live in the preview. */
function HeadingForm({ section, onDone }: { section: ResolvedSection; onDone: () => void }) {
  const draft = useDraft();
  const current = iconNameFor(section);
  const Default = defaultIconFor(section.sectionType);

  return (
    <div className="animate-fade-in space-y-3 bg-canvas/50 p-4">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">Icon (editor only — headings print as plain text)</p>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Section icon">
          <button
            type="button"
            role="radio"
            aria-checked={section.icon === null}
            aria-label="Default icon"
            title="Default"
            onClick={() => draft.patchSection(section.id, { icon: null })}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
              section.icon === null ? "bg-violet text-white" : "bg-surface text-muted hover:text-violet",
            )}
          >
            <Default size={15} />
          </button>
          {Object.entries(SECTION_ICONS).map(([name, Icon]) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={section.icon === name}
              aria-label={name}
              title={name}
              onClick={() => draft.patchSection(section.id, { icon: name })}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                section.icon === name ? "bg-violet text-white" : "bg-surface text-muted hover:text-violet",
                section.icon === null && current === name && "ring-1 ring-violet/30",
              )}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          className="field flex-1 bg-surface font-semibold"
          aria-label="Section heading"
          autoFocus
          value={section.heading}
          onChange={(e) => draft.patchSection(section.id, { heading: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") onDone();
          }}
        />
        <button className="btn-primary px-4" onClick={onDone} disabled={!section.heading.trim()}>
          <Check size={15} /> Done
        </button>
      </div>
      {!section.heading.trim() && <p className="text-xs text-amber-700">A heading can&rsquo;t be empty.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function RowShell({
  onOpen,
  visible,
  onToggleVisible,
  dragging,
  register,
  handle,
  children,
  label,
}: {
  onOpen: () => void;
  visible: boolean;
  onToggleVisible: () => void;
  dragging: boolean;
  register: (el: HTMLElement | null) => void;
  handle: SortableHandleProps;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div
      ref={register}
      className={cn(
        "group flex items-center gap-1.5 rounded-xl px-1.5 py-2 transition-all duration-150 hover:bg-canvas",
        dragging && "opacity-40",
        !visible && "opacity-55",
      )}
    >
      <span
        {...handle}
        onClick={(e) => e.stopPropagation()}
        className="rounded p-0.5 text-muted/60 transition-colors hover:text-ink"
        aria-label={`Drag to reorder ${label}`}
        title="Drag to reorder"
      >
        <GripVertical size={14} />
      </span>
      <button className="min-w-0 flex-1 text-left" onClick={onOpen} aria-label={`Edit ${label}`}>
        {children}
      </button>
      <button
        className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-ink"
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisible();
        }}
        aria-label={visible ? `Hide ${label} from resume` : `Show ${label} on resume`}
        aria-pressed={!visible}
        title={visible ? "Hide from resume" : "Show on resume"}
      >
        {visible ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>
    </div>
  );
}

function EntryRows({
  section,
  openEditor,
}: {
  section: ResolvedSection;
  openEditor: (value: string, sectionId?: number) => void;
}) {
  const draft = useDraft();
  const index = useVaultIndex();
  const byId = useMemo(() => new Map(section.entries.map((e) => [e.id, e])), [section.entries]);
  const order = useMemo(() => ({ entries: section.entries.map((e) => e.id) }), [section.entries]);
  const sort = useSortable({
    value: order,
    onCommit: (next) => draft.reorderEntries(section.id, next.entries ?? []),
  });

  if (section.entries.length === 0) {
    return <p className="px-2 py-3 text-sm text-muted">No entries yet — add one, or pull from your vault.</p>;
  }

  const entries = (sort.order.entries ?? [])
    .map((id) => byId.get(id))
    .filter((e): e is ResolvedEntry => Boolean(e));

  return (
    <div ref={sort.registerContainer("entries")} className="space-y-0.5">
      {entries.map((entry) => {
        const source = pathOfEntry(index, entry.sourceEntryId);
        const secondary = entry.organization || [entry.startDate, entry.isCurrent ? "Present" : entry.endDate].filter(Boolean).join(" – ");
        return (
          <RowShell
            key={entry.id}
            label={entry.title || "entry"}
            onOpen={() => openEditor(`entry-${entry.id}`, section.id)}
            visible={entry.isVisible}
            onToggleVisible={() => draft.setEntryVisible(entry.id, !entry.isVisible)}
            dragging={sort.draggingId === entry.id}
            register={sort.registerItem(entry.id)}
            handle={sort.handleProps(entry.id, "entries")}
          >
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className={cn("truncate text-sm font-semibold", !entry.title && "italic text-muted")}>
                {entry.title || "Untitled"}
              </span>
              {secondary && <span className="truncate text-xs text-muted">{secondary}</span>}
            </span>
            {source && (
              <span className="mt-0.5 flex min-w-0 text-[10px]">
                <SectionPath path={source} />
              </span>
            )}
          </RowShell>
        );
      })}
    </div>
  );
}

function SkillRows({
  section,
  openEditor,
}: {
  section: ResolvedSection;
  openEditor: (value: string, sectionId?: number) => void;
}) {
  const draft = useDraft();
  const groups = useMemo(() => groupSkillsForEditing(section.skills), [section.skills]);
  // A category's identity is its name; ids for the sortable are positions.
  const order = useMemo(() => ({ categories: groups.map((_, i) => i) }), [groups]);
  const sort = useSortable({
    value: order,
    onCommit: (next) =>
      draft.reorderSkillCategories(
        section.id,
        (next.categories ?? []).map((i) => groups[i]?.category).filter((c): c is string => c !== undefined),
      ),
  });

  if (groups.length === 0) {
    return <p className="px-2 py-3 text-sm text-muted">No skills yet — add a line, or pull from your vault.</p>;
  }

  return (
    <div ref={sort.registerContainer("categories")} className="space-y-0.5">
      {(sort.order.categories ?? []).map((i) => {
        const g = groups[i];
        if (!g) return null;
        const visible = g.skills.some((k) => k.isVisible);
        return (
          <RowShell
            key={`${g.category}-${i}`}
            label={g.category || "skills"}
            onOpen={() => openEditor(`skill-${section.id}-${encodeURIComponent(g.category)}`, section.id)}
            visible={visible}
            onToggleVisible={() => draft.setSkillCategoryVisible(section.id, g.category, !visible)}
            dragging={sort.draggingId === i}
            register={sort.registerItem(i)}
            handle={sort.handleProps(i, "categories")}
          >
            <span className="block truncate text-sm font-semibold">{g.category || "Uncategorised"}</span>
            <span className="block truncate text-xs text-muted">{g.skills.map((k) => k.name).join(", ")}</span>
          </RowShell>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add Content                                                         */
/* ------------------------------------------------------------------ */

function AddContentModal({
  open,
  onClose,
  onAdded,
  onEntry,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (sectionId: number, layout: "normal" | "skill") => void;
  onEntry: (entryId: number, sectionId: number) => void;
}) {
  const draft = useDraft();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const present = new Set(draft.resume.sections.map((s) => s.sectionType));

  async function add(type: (typeof SECTION_DEFS)[number]) {
    setBusy(type.type);
    setError(null);
    const r = await draft.runAndWait(() => addSection(draft.resume.id, type.type));
    if (!r.ok) {
      setBusy(null);
      setError(r.error);
      return;
    }
    onAdded(r.data, type.layout);
    // A normal section opens straight onto its first, empty entry.
    if (type.layout === "normal") {
      const e = await draft.runAndWait(() => createBlankEntry(r.data));
      if (e.ok) onEntry(e.data, r.data);
    }
    setBusy(null);
  }

  return (
    <Modal open={open} onClose={onClose} title="Add content" wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SECTION_DEFS.map((def) => {
          // One of each type, except Custom, which exists to be repeated.
          const taken = present.has(def.type) && def.type !== "custom";
          const Icon = defaultIconFor(def.type);
          return (
            <button
              key={def.type}
              className="group flex items-start gap-3 rounded-card border border-line p-4 text-left transition-all duration-150 hover:border-violet/40 hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-line disabled:hover:shadow-none"
              disabled={taken || busy !== null}
              onClick={() => add(def)}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violetSoft text-violet">
                {busy === def.type ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">
                  {def.label}
                  {taken && <span className="ml-2 text-xs font-normal text-muted">Added</span>}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">{def.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Status & undo                                                       */
/* ------------------------------------------------------------------ */

function SaveStatus({ state, error }: { state: SaveState; error: string | null }) {
  return (
    <div className="flex h-5 items-center justify-end px-1 text-xs" aria-live="polite">
      {state === "saving" && (
        <span className="flex items-center gap-1.5 text-muted">
          <Loader2 size={12} className="animate-spin" /> Saving…
        </span>
      )}
      {state === "saved" && (
        <span className="flex items-center gap-1.5 text-emerald-700">
          <Check size={12} /> Saved
        </span>
      )}
      {state === "error" && <span className="text-red-600" title={error ?? undefined}>Not saved — {error}</span>}
    </div>
  );
}

function UndoToasts() {
  const { removals, undoRemove } = useDraft();
  if (removals.length === 0) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2" aria-live="polite">
      {removals.map((r) => (
        <div key={r.entryId} className="flex animate-pop-in items-center gap-3 rounded-full bg-ink py-2 pl-4 pr-2 text-sm text-white shadow-lift">
          <span className="max-w-60 truncate">&ldquo;{r.title}&rdquo; removed</span>
          <button
            className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-xs font-medium hover:bg-white/25"
            onClick={() => undoRemove(r.entryId)}
          >
            <Undo2 size={12} /> Undo
          </button>
        </div>
      ))}
    </div>
  );
}
