"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  Copy,
  FolderInput,
  Link2,
  Loader2,
  MapPin,
  Trash2,
  X,
} from "lucide-react";

import { SectionPath } from "@/components/section-path";
import { ConfirmButton } from "@/components/ui";
import type { EntryWithBullets } from "@/db/queries";
import type { VaultSection } from "@/db/schema";
import { cn } from "@/lib/utils";

import { deleteEntry, updateEntry } from "./actions";
import { BulletList } from "./entry-card";
import { EntryBadge } from "./entry-tile";
import { InlineField } from "./inline-field";
import { MoveEntryDialog, type MoveTargetGroup } from "./move-entry-dialog";
import { SkillChips } from "./skill-chips";
import { useAutosave, type SaveState } from "./use-autosave";

const SKILL_LEVELS = ["", "beginner", "intermediate", "advanced", "expert"] as const;

/** Mirrors the server's dateField, so a bad date is caught at the field, not after a round trip. */
const DATE_RE = /^((0[1-9]|1[0-2])\/\d{4}|\d{4})$/;
const validDate = (v: string) => (v === "" || DATE_RE.test(v) ? null : "Use MM/YYYY or YYYY");
const required = (v: string) => (v ? null : "This can't be empty");

function fieldsOf(entry: EntryWithBullets) {
  return {
    title: entry.title,
    nickname: entry.nickname,
    organization: entry.organization,
    subtitle: entry.subtitle,
    location: entry.location,
    startDate: entry.startDate,
    endDate: entry.endDate,
    isCurrent: entry.isCurrent,
    url: entry.url,
    information: entry.information,
    level: entry.level,
  };
}

function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <Loader2 size={12} className="animate-spin" /> Saving…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-700">
        <Check size={12} /> Saved
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-600" title={error ?? undefined}>
        <AlertCircle size={12} /> Not saved
      </span>
    );
  }
  return <span className="text-xs text-muted">Changes save automatically</span>;
}

/** One labelled row of the details list. */
function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex w-24 shrink-0 items-center gap-2 pt-1.5 text-sm text-muted">
        <Icon size={14} /> {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Slide-over editor for one vault entry. Replaces the old modal form.
 *
 * Every field edits in place and saves on its own (see useAutosave), so there
 * is no Save button and nothing to lose by closing. The parent keys this on
 * the entry id; switching entries mounts a fresh draft.
 *
 * Escape closes — unless a field consumed it to undo, or a confirm/move
 * dialog is open on top, which owns the key first.
 */
export function EntryPanel({
  entry,
  section,
  groupName,
  moveTargets,
  onClose,
  onDuplicate,
}: {
  entry: EntryWithBullets;
  section: VaultSection;
  /** The section's group, for the header path. Null for a pre-groups section. */
  groupName: string | null;
  moveTargets: MoveTargetGroup[];
  onClose: () => void;
  /** Copy this entry; the parent opens the copy. */
  onDuplicate: () => Promise<void>;
}) {
  const isSkill = section.type === "skill";
  const [moveOpen, setMoveOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [, startTransition] = useTransition();

  const { draft, commit, state, error } = useAutosave(fieldsOf(entry), (d) =>
    updateEntry(entry.id, { ...d, endDate: d.isCurrent ? "" : d.endDate, meta: entry.meta }),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);

    // The page behind shouldn't scroll under a panel that has its own scroll.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const canMove = moveTargets.some((g) => g.sections.length > 0);
  const pinned = entry.bullets.filter((b) => b.isPinned).length;

  return (
    <div className="fixed inset-0 z-30">
      <div className="absolute inset-0 animate-fade-in bg-ink/20" onClick={onClose} />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${draft.title}`}
        className="absolute inset-y-0 right-0 flex w-full max-w-xl animate-slide-in flex-col bg-surface shadow-panel"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-3">
          <SectionPath
            path={{ group: groupName, section: section.heading }}
            className="text-xs"
          />
          <div className="flex items-center gap-3">
            <SaveIndicator state={state} error={error} />
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink"
              aria-label="Close"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-6 py-6">
          {state === "error" && error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="flex items-start gap-4">
            <EntryBadge name={draft.organization || draft.title} size="lg" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <InlineField
                label={isSkill ? "Skill label" : "Title"}
                value={draft.title}
                placeholder={isSkill ? "e.g. Languages" : "e.g. Software Engineer"}
                validate={required}
                onCommit={(title) => commit({ title })}
                className="text-xl font-semibold"
              />
              {!isSkill && (
                <InlineField
                  label="Organization"
                  value={draft.organization}
                  placeholder="Add organization"
                  onCommit={(organization) => commit({ organization })}
                  className="text-muted"
                />
              )}
            </div>
          </div>

          {/* Private: tells apart entries that share a title and employer.
              Shown wherever this entry is picked from a resume, never printed. */}
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">
              Nickname <span className="font-normal text-muted">(only you see this — never printed)</span>
            </h3>
            <InlineField
              label="Nickname"
              value={draft.nickname}
              placeholder="e.g. Backend focus, ML version"
              onCommit={(nickname) => commit({ nickname })}
              className="text-sm"
            />
          </section>

          {isSkill ? (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Skills</h3>
                <SkillChips value={draft.information} onChange={(information) => commit({ information })} />
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">
                  Level <span className="font-normal text-muted">(optional)</span>
                </h3>
                <div className="inline-flex flex-wrap gap-1 rounded-lg bg-canvas p-1">
                  {SKILL_LEVELS.map((l) => (
                    <button
                      key={l || "none"}
                      type="button"
                      aria-pressed={draft.level === l}
                      onClick={() => commit({ level: l })}
                      className={cn(
                        "rounded-md px-3 py-1 text-sm capitalize transition-colors",
                        draft.level === l
                          ? "bg-surface font-medium text-ink shadow-sm"
                          : "text-muted hover:text-ink",
                      )}
                    >
                      {l || "None"}
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="space-y-1.5 rounded-xl bg-canvas/60 p-4">
                <Detail icon={CalendarDays} label="When">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-28">
                      <InlineField
                        label="Start date"
                        value={draft.startDate}
                        placeholder="MM/YYYY"
                        validate={validDate}
                        onCommit={(startDate) => commit({ startDate })}
                      />
                    </div>
                    <span className="text-muted">→</span>
                    <div className="w-28">
                      {draft.isCurrent ? (
                        <span className="block px-0 py-1 font-medium text-emerald-700">Present</span>
                      ) : (
                        <InlineField
                          label="End date"
                          value={draft.endDate}
                          placeholder="MM/YYYY"
                          validate={validDate}
                          onCommit={(endDate) => commit({ endDate })}
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={draft.isCurrent}
                      onClick={() =>
                        commit({ isCurrent: !draft.isCurrent, endDate: draft.isCurrent ? draft.endDate : "" })
                      }
                      className="ml-auto flex items-center gap-2 text-xs text-muted"
                    >
                      <span
                        className={cn(
                          "relative h-4 w-7 rounded-full transition-colors",
                          draft.isCurrent ? "bg-emerald-500" : "bg-line",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all",
                            draft.isCurrent ? "left-3.5" : "left-0.5",
                          )}
                        />
                      </span>
                      Current
                    </button>
                  </div>
                </Detail>
                <Detail icon={MapPin} label="Where">
                  <InlineField
                    label="Location"
                    value={draft.location}
                    placeholder="City, Country"
                    onCommit={(location) => commit({ location })}
                  />
                </Detail>
                <Detail icon={Link2} label="Link">
                  <InlineField
                    label="Link"
                    value={draft.url}
                    placeholder="github.com/…"
                    onCommit={(url) => commit({ url })}
                  />
                </Detail>
              </section>

              <section className="space-y-1">
                <h3 className="text-sm font-semibold">
                  Summary <span className="font-normal text-muted">(optional)</span>
                </h3>
                <InlineField
                  label="Summary"
                  value={draft.subtitle}
                  placeholder="One line on what this was — e.g. Distributed LLM inference system built in Go"
                  onCommit={(subtitle) => commit({ subtitle })}
                  className="text-sm"
                />
              </section>

              <section className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold">
                    Description{" "}
                    <span className="font-normal text-muted">{entry.bullets.length || ""}</span>
                  </h3>
                  <p className="hint">
                    {pinned > 0 ? `${pinned} pinned · ` : ""}Click a bullet to edit · drag to reorder
                  </p>
                </div>
                <BulletList entryId={entry.id} bullets={entry.bullets} />
              </section>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-line px-6 py-3">
          <button
            className="btn-ghost px-3 py-1.5"
            disabled={!canMove}
            title={canMove ? "Move to another section" : "No other section of this kind to move into"}
            onClick={() => setMoveOpen(true)}
          >
            <FolderInput size={14} /> Move
          </button>
          <button
            className="btn-ghost mr-auto px-3 py-1.5"
            disabled={duplicating}
            title="Copy this entry and its bullets, then open the copy"
            onClick={() => {
              setDuplicating(true);
              void onDuplicate().finally(() => setDuplicating(false));
            }}
          >
            {duplicating ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />} Duplicate
          </button>
          <ConfirmButton
            className="btn px-3 py-1.5 text-red-600 hover:bg-red-50"
            message={`Delete "${draft.title}"${entry.bullets.length ? ` and its ${entry.bullets.length} bullet(s)` : ""}? This cannot be undone.`}
            onConfirm={() =>
              startTransition(async () => {
                await deleteEntry(entry.id);
                onClose();
              })
            }
          >
            <Trash2 size={14} /> Delete entry
          </ConfirmButton>
        </footer>
      </aside>

      <MoveEntryDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        entryId={entry.id}
        entryTitle={draft.title}
        currentHeading={section.heading}
        targets={moveTargets}
      />
    </div>
  );
}
