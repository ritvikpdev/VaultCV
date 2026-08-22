"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderInput,
  GripVertical,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from "lucide-react";

import { ConfirmButton, StrengthMeter } from "@/components/ui";
import type { EntryWithBullets } from "@/db/queries";
import type { VaultBullet, VaultSection } from "@/db/schema";
import { scoreBullet, STRENGTH_LABELS } from "@/lib/bullet-strength";
import { extractSkills } from "@/lib/skill-index";
import { useSortable, type SortableHandleProps } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";

import {
  createBullet,
  deleteBullet,
  deleteEntry,
  reorderBullets,
  toggleBulletPin,
  updateBullet,
} from "./actions";
import { EntryDialog } from "./entry-dialog";
import { MoveEntryDialog, type MoveTargetGroup } from "./move-entry-dialog";

function dateRange(entry: EntryWithBullets): string {
  if (!entry.startDate && !entry.endDate && !entry.isCurrent) return "";
  const end = entry.isCurrent ? "Present" : entry.endDate;
  return [entry.startDate, end].filter(Boolean).join(" – ");
}

function StrengthHint({ text }: { text: string }) {
  const { score, reasons } = scoreBullet(text);
  const missing = reasons.filter((r) => r.delta > 0 && !r.met);
  const penalties = reasons.filter((r) => r.delta < 0 && r.met);

  if (!text.trim()) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <StrengthMeter score={score} />
        {STRENGTH_LABELS[score]}
      </span>
      {penalties.map((p) => (
        <span key={p.label} className="text-red-600">
          {p.label.replace("Avoids a", "Has a").replace("Not overlong", "Too long")}
        </span>
      ))}
      {missing.slice(0, 2).map((m) => (
        <span key={m.label}>· {m.label}</span>
      ))}
    </div>
  );
}

function BulletRow({
  bullet,
  dragging,
  register,
  handle,
}: {
  bullet: VaultBullet;
  dragging: boolean;
  register: (el: HTMLElement | null) => void;
  handle: SortableHandleProps;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bullet.text);
  const [, startTransition] = useTransition();

  function save() {
    if (!draft.trim()) return;
    startTransition(async () => {
      await updateBullet(bullet.id, draft);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <li className="rounded-lg bg-canvas p-3">
        <textarea
          className="field min-h-20 resize-y bg-surface"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(bullet.text);
              setEditing(false);
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          }}
        />
        <StrengthHint text={draft} />
        <div className="mt-2 flex gap-2">
          <button className="btn-accent px-3 py-1 text-xs" onClick={save}>
            Save
          </button>
          <button
            className="btn-ghost px-3 py-1 text-xs"
            onClick={() => {
              setDraft(bullet.text);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li
      ref={register}
      className={cn(
        "group flex items-start gap-1 rounded-lg py-1.5 pr-2 transition-opacity hover:bg-canvas",
        dragging && "opacity-40",
      )}
    >
      <span
        {...handle}
        className="mt-0.5 shrink-0 text-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
        title="Drag to reorder"
      >
        <GripVertical size={12} />
      </span>

      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink" />
      <span className="flex-1 pl-1 text-sm leading-relaxed">{bullet.text}</span>

      <span className="mt-1 shrink-0">
        <StrengthMeter
          score={bullet.strength}
          title={`${STRENGTH_LABELS[bullet.strength]} — writing quality, not job relevance`}
        />
      </span>

      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className={cn(
            "rounded p-1 hover:bg-line",
            bullet.isPinned ? "text-accent" : "text-muted",
          )}
          title={bullet.isPinned ? "Unpin" : "Pin — auto-selected when tuning"}
          onClick={() => startTransition(() => void toggleBulletPin(bullet.id))}
        >
          <Pin size={13} fill={bullet.isPinned ? "currentColor" : "none"} />
        </button>
        <button
          className="rounded p-1 text-muted hover:bg-line"
          title="Edit"
          onClick={() => setEditing(true)}
        >
          <Pencil size={13} />
        </button>
        <ConfirmButton
          className="rounded p-1 text-muted hover:bg-line hover:text-red-600"
          title="Delete bullet"
          message="Delete this bullet? Any resume that copied it keeps its copy."
          onConfirm={() => startTransition(() => void deleteBullet(bullet.id))}
        >
          <Trash2 size={13} />
        </ConfirmButton>
      </span>

      {bullet.isPinned && (
        <span className="mt-0.5 shrink-0 rounded bg-accentSoft px-1.5 py-0.5 text-[10px] font-medium text-accent group-hover:hidden">
          Pinned
        </span>
      )}
    </li>
  );
}

export function EntryCard({
  entry,
  section,
  moveTargets,
  collapsed,
  onToggle,
  dragging,
  register,
  handle,
}: {
  entry: EntryWithBullets;
  section: VaultSection;
  /** Sections of the same kind, minus this one. Empty means nowhere to move to. */
  moveTargets: MoveTargetGroup[];
  collapsed: boolean;
  onToggle: () => void;
  dragging: boolean;
  register: (el: HTMLElement | null) => void;
  handle: SortableHandleProps;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newBullet, setNewBullet] = useState("");
  const [pending, startTransition] = useTransition();

  const canMove = moveTargets.some((g) => g.sections.length > 0);

  const isSkill = section.type === "skill";
  const range = dateRange(entry);
  const skills = useMemo(
    () => (isSkill ? extractSkills(entry.information) : []),
    [isSkill, entry.information],
  );

  const bulletById = useMemo(
    () => new Map(entry.bullets.map((b) => [b.id, b])),
    [entry.bullets],
  );

  const bulletOrder = useMemo(
    () => ({ bullets: entry.bullets.map((b) => b.id) }),
    [entry.bullets],
  );

  const sort = useSortable({
    value: bulletOrder,
    onCommit: (next) =>
      startTransition(() => {
        void reorderBullets(entry.id, next.bullets ?? []);
      }),
  });

  const bullets = (sort.order.bullets ?? [])
    .map((id) => bulletById.get(id))
    .filter((b): b is VaultBullet => Boolean(b));

  function addBullet() {
    if (!newBullet.trim()) return;
    startTransition(async () => {
      await createBullet(entry.id, newBullet);
      setNewBullet("");
    });
  }

  // What the card says when it's shut: enough to identify it without opening.
  const summary = isSkill
    ? skills.length === 1
      ? "1 skill"
      : `${skills.length} skills`
    : entry.bullets.length === 1
      ? "1 bullet"
      : `${entry.bullets.length} bullets`;

  return (
    <>
      <div
        ref={register}
        className={cn("card p-5 transition-opacity", dragging && "opacity-40")}
      >
        <div className="group/e flex items-start gap-2">
          <span
            {...handle}
            className="mt-1 shrink-0 text-muted opacity-0 transition-opacity hover:text-ink group-hover/e:opacity-100"
            title="Drag to reorder"
          >
            <GripVertical size={14} />
          </span>

          <button
            className="mt-0.5 shrink-0 rounded p-0.5 text-muted hover:bg-canvas hover:text-ink"
            title={collapsed ? "Expand" : "Collapse"}
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>

          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {entry.title}
              {entry.organization && (
                <span className="font-normal text-muted">, {entry.organization}</span>
              )}
            </p>
            {entry.subtitle && (
              <p className="mt-0.5 text-sm italic text-muted">{entry.subtitle}</p>
            )}
            {!isSkill && (range || entry.location) && (
              <p className="hint mt-1">
                {[range, entry.location].filter(Boolean).join(" · ")}
              </p>
            )}
            {isSkill && entry.level && (
              <p className="hint mt-1 capitalize">{entry.level}</p>
            )}
            {/*
              A count while collapsed, so a folded card still tells you whether
              there is anything inside it worth opening.
            */}
            {collapsed && <p className="hint mt-1">{summary}</p>}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              className="rounded p-1.5 text-muted hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canMove}
              title={
                canMove
                  ? "Move to another section"
                  : section.type === "skill"
                    ? "No other skill section to move this into"
                    : "No other section of this kind to move this into"
              }
              onClick={() => setMoveOpen(true)}
            >
              <FolderInput size={15} />
            </button>
            <button
              className="rounded p-1.5 text-muted hover:bg-canvas"
              title="Edit entry"
              onClick={() => setEditOpen(true)}
            >
              <Pencil size={15} />
            </button>
            <ConfirmButton
              className="rounded p-1.5 text-muted hover:bg-canvas hover:text-red-600"
              title="Delete entry"
              message={`Delete "${entry.title}"${entry.bullets.length ? ` and its ${entry.bullets.length} bullet(s)` : ""}? This cannot be undone.`}
              onConfirm={() => startTransition(() => void deleteEntry(entry.id))}
            >
              <Trash2 size={15} />
            </ConfirmButton>
          </div>
        </div>

        {!collapsed &&
          (isSkill ? (
            <div className="mt-3">
              {skills.length === 0 ? (
                <p className="hint">No sub-skills yet — edit to add them.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((s) => (
                    <span
                      key={s.name}
                      className="rounded-lg border border-line px-2.5 py-1 text-sm"
                      title={
                        s.aliases.length
                          ? `Also matches: ${s.aliases.join(", ")}`
                          : undefined
                      }
                    >
                      {s.name}
                      {s.aliases.length > 0 && (
                        <span className="ml-1 text-[10px] text-muted">
                          +{s.aliases.length}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {bullets.length > 0 && (
                <ul
                  ref={sort.registerContainer("bullets")}
                  className="mt-3 space-y-0.5"
                >
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

              {adding ? (
                <div className="mt-3 rounded-lg bg-canvas p-3">
                  <textarea
                    className="field min-h-20 resize-y bg-surface"
                    placeholder="Engineered Spring Boot microservices processing 300K transactions daily, cutting latency 35%…"
                    value={newBullet}
                    autoFocus
                    onChange={(e) => setNewBullet(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setNewBullet("");
                        setAdding(false);
                      }
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addBullet();
                    }}
                  />
                  <StrengthHint text={newBullet} />
                  <div className="mt-2 flex gap-2">
                    <button
                      className="btn-accent px-3 py-1 text-xs"
                      onClick={addBullet}
                      disabled={pending || !newBullet.trim()}
                    >
                      Add bullet
                    </button>
                    <button
                      className="btn-ghost px-3 py-1 text-xs"
                      onClick={() => {
                        setNewBullet("");
                        setAdding(false);
                      }}
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="mt-3 flex items-center gap-1.5 text-sm text-muted hover:text-accent"
                  onClick={() => setAdding(true)}
                >
                  <Plus size={14} /> Add bullet
                </button>
              )}
            </>
          ))}
      </div>

      <EntryDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        section={section}
        entry={entry}
      />

      <MoveEntryDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        entryId={entry.id}
        entryTitle={entry.title}
        currentHeading={section.heading}
        targets={moveTargets}
      />
    </>
  );
}
