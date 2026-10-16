"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CornerDownLeft, GripVertical, Pin, Trash2 } from "lucide-react";

import { ConfirmButton, StrengthMeter } from "@/components/ui";
import type { VaultBullet } from "@/db/schema";
import { scoreBullet, STRENGTH_COLORS, STRENGTH_LABELS } from "@/lib/bullet-strength";
import { useSortable, type SortableHandleProps } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";

import { createBullet, deleteBullet, reorderBullets, toggleBulletPin, updateBullet } from "./actions";

/**
 * An entry's bullets, as editable fact cards.
 *
 * Shown inside the entry panel. Each bullet is a card rather than a dotted
 * line on purpose: the vault holds facts to draw from, and a resume-styled
 * list made it read as a resume being written rather than a record being kept.
 */

/** Live writing-quality feedback while typing. Not job relevance — see bullet-strength.ts. */
export function StrengthHint({ text }: { text: string }) {
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

/** A textarea that grows with its content, so a long bullet never scrolls inside a box. */
function AutoTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string },
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} />;
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
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Adopt the saved text when the server's copy changes, unless mid-edit.
  // Keyed on the text alone: re-running when `editing` flips would snap the
  // card back to the old text in the moment between Save and revalidation.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => {
    if (!editingRef.current) setDraft(bullet.text);
  }, [bullet.text]);

  function save() {
    const next = draft.trim();
    setEditing(false);
    // Clearing a bullet is not how you delete one — deletes confirm. Put it back.
    if (!next) {
      setDraft(bullet.text);
      return;
    }
    if (next === bullet.text) return;

    startTransition(async () => {
      const result = await updateBullet(bullet.id, next, bullet.tags);
      if (!result.ok) {
        setError(result.error);
        setDraft(bullet.text);
      } else {
        setError(null);
      }
    });
  }

  const strength = Math.max(1, Math.min(5, bullet.strength));

  return (
    <li
      ref={register}
      className={cn(
        "group relative flex items-start gap-1.5 overflow-hidden rounded-lg border bg-surface py-2.5 pl-3 pr-2 transition-all",
        editing ? "border-accent shadow-lift" : "border-line hover:shadow-lift",
        dragging && "opacity-40",
      )}
    >
      {/* Strength edge. The meter and its tooltip carry the same fact in words. */}
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-1", STRENGTH_COLORS[strength - 1])}
      />

      <span
        {...handle}
        className="mt-0.5 shrink-0 text-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
        title="Drag to reorder"
      >
        <GripVertical size={13} />
      </span>

      <div className="min-w-0 flex-1">
        {editing ? (
          <>
            <AutoTextarea
              className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none"
              value={draft}
              autoFocus
              onFocus={(e) => {
                const end = e.currentTarget.value.length;
                e.currentTarget.setSelectionRange(end, end);
              }}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setDraft(bullet.text);
                  setEditing(false);
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            <StrengthHint text={draft} />
            <p className="mt-1 text-[11px] text-muted">
              Saves when you click away · Enter to finish · Esc to undo
            </p>
          </>
        ) : (
          <button
            type="button"
            className="block w-full cursor-text text-left text-sm leading-relaxed"
            title="Click to edit"
            onClick={() => setEditing(true)}
          >
            {draft}
          </button>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>

      {!editing && (
        <span className="flex shrink-0 items-center gap-0.5">
          <span className="mr-1 hidden sm:inline-flex">
            <StrengthMeter
              score={strength}
              title={`${STRENGTH_LABELS[strength]} — writing quality, not job relevance`}
            />
          </span>
          <button
            className={cn(
              "rounded p-1 transition-colors hover:bg-canvas",
              bullet.isPinned ? "text-accent" : "text-muted/50 hover:text-ink",
            )}
            title={bullet.isPinned ? "Pinned — click to unpin" : "Pin — auto-selected when tuning"}
            aria-pressed={bullet.isPinned}
            onClick={() => startTransition(() => void toggleBulletPin(bullet.id))}
          >
            <Pin size={13} fill={bullet.isPinned ? "currentColor" : "none"} />
          </button>
          <ConfirmButton
            className="rounded p-1 text-muted/50 transition-colors hover:bg-canvas hover:text-red-600"
            title="Delete bullet"
            message="Delete this bullet? Any resume that copied it keeps its copy."
            onConfirm={() => startTransition(() => void deleteBullet(bullet.id))}
          >
            <Trash2 size={13} />
          </ConfirmButton>
        </span>
      )}
    </li>
  );
}

/** Always-open box at the foot of the list. Enter adds and keeps focus for the next one. */
function BulletComposer({ entryId, first }: { entryId: number; first: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    const next = text.trim();
    if (!next || pending) return;
    startTransition(async () => {
      const result = await createBullet(entryId, next);
      if (result.ok) {
        setText("");
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="rounded-lg border border-dashed border-line bg-canvas/60 p-3 transition-colors focus-within:border-accent focus-within:bg-surface">
      <AutoTextarea
        className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted/70"
        placeholder={
          first
            ? "Add a description line — start with a verb, include a number…"
            : "Add another line…"
        }
        aria-label="New bullet"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.stopPropagation();
            setText("");
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            add();
          }
        }}
      />
      <StrengthHint text={text} />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {text.trim() && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <span className="text-[11px] text-muted">Shift+Enter for a new line</span>
          <button className="btn-accent px-3 py-1 text-xs" disabled={pending} onClick={add}>
            <CornerDownLeft size={12} /> {pending ? "Adding…" : "Add"}
          </button>
        </div>
      )}
    </div>
  );
}

export function BulletList({ entryId, bullets }: { entryId: number; bullets: VaultBullet[] }) {
  const [, startTransition] = useTransition();

  const bulletById = useMemo(() => new Map(bullets.map((b) => [b.id, b])), [bullets]);
  const bulletOrder = useMemo(() => ({ bullets: bullets.map((b) => b.id) }), [bullets]);

  const sort = useSortable({
    value: bulletOrder,
    onCommit: (next) =>
      startTransition(() => {
        void reorderBullets(entryId, next.bullets ?? []);
      }),
  });

  const ordered = (sort.order.bullets ?? [])
    .map((id) => bulletById.get(id))
    .filter((b): b is VaultBullet => Boolean(b));

  return (
    <div className="space-y-2">
      {ordered.length > 0 && (
        <ul ref={sort.registerContainer("bullets")} className="space-y-2">
          {ordered.map((b) => (
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
      <BulletComposer entryId={entryId} first={ordered.length === 0} />
    </div>
  );
}
