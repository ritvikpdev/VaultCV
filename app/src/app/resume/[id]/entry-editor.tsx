"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Link2, Loader2, Search } from "lucide-react";

import { NicknameChip, SectionPath } from "@/components/section-path";
import { StrengthMeter } from "@/components/ui";
import type { SectionType } from "@/db/schema";
import { sectionOptions, type ResolvedEntry, type ResolvedSection } from "@/lib/resume-model";
import { getSectionDef } from "@/lib/sections";
import { cn } from "@/lib/utils";
import { nicknameOfEntry, pathOfEntry } from "@/lib/vault-path";

import {
  addVaultBulletToEntry,
  bulletOptionsForEntry,
  saveBulletToVault,
} from "../manual-actions";
import { DateField } from "./date-field";
import { idForLine, useDraft } from "./draft";
import { EditorShell, Field, Segmented, tipsFor } from "./editor-shell";
import { RichTextEditor } from "./rich-text-editor";
import { useVaultIndex } from "./vault-index-context";

/** What to call the two main fields, per section type. */
const LABELS: Partial<Record<SectionType, { title: string; org: string }>> = {
  experience: { title: "Job Title", org: "Employer" },
  education: { title: "Degree", org: "School" },
  project: { title: "Project Name", org: "Organization" },
  certification: { title: "Certificate", org: "Issuer" },
  publication: { title: "Title", org: "Publisher" },
  award: { title: "Award", org: "Issuer" },
  course: { title: "Course", org: "Institution" },
  organization: { title: "Role", org: "Organization" },
  volunteer: { title: "Role", org: "Organization" },
  reference: { title: "Name", org: "Company" },
};

export function EntryEditor({
  entry,
  section,
  onBack,
}: {
  entry: ResolvedEntry;
  section: ResolvedSection;
  onBack: () => void;
}) {
  const draft = useDraft();
  const index = useVaultIndex();
  const def = getSectionDef(section.sectionType);
  const labels = LABELS[section.sectionType] ?? { title: "Title", org: "Organization" };
  const opts = sectionOptions(section);
  const source = pathOfEntry(index, entry.sourceEntryId);
  const [linkOpen, setLinkOpen] = useState(Boolean(entry.url));
  const [notice, setNotice] = useState<string | null>(null);
  const stampIds = useRef<((ids: Record<string, number>) => void) | null>(null);

  const id = (f: string) => `e${entry.id}-${f}`;
  const patch = (p: Parameters<typeof draft.patchEntry>[1]) => draft.patchEntry(entry.id, p);

  const onLines = useCallback(
    (lines: Parameters<typeof draft.setEntryLines>[1], known: number[]) =>
      draft.setEntryLines(entry.id, lines, known, (ids) => stampIds.current?.(ids)),
    [draft, entry.id],
  );

  /**
   * Save one line. Runs behind pending saves, so a line typed a moment ago
   * has its row by then — its id is looked up at that point, not now.
   */
  const saveBullet = useCallback(
    async (key: string, bulletId: number | null) => {
      const r = await draft.runAndWait(async () => {
        const id = bulletId ?? idForLine(key);
        if (!id) return { ok: false as const, error: "Write something in this line first" };
        return saveBulletToVault(id);
      });
      if (!r.ok) {
        setNotice(r.error);
        return null;
      }
      setNotice(
        r.data.entryCreated
          ? "Line saved — this entry was added to your vault too, with just that line."
          : "Line saved to your vault.",
      );
      return r.data.vaultBulletId;
    },
    [draft],
  );

  return (
    <EditorShell
      title={`Edit ${def.label.replace(/s$/, "")}`}
      onBack={onBack}
      tips={tipsFor(section.sectionType)}
      visible={entry.isVisible}
      onToggleVisible={() => draft.setEntryVisible(entry.id, !entry.isVisible)}
      onDelete={() => {
        draft.removeEntry(entry.id, entry.title || "Entry");
        onBack();
      }}
      deleteMessage={`Remove "${entry.title || "this entry"}" from this resume? Your vault keeps its copy. You can undo for a few seconds.`}
      toolbar={
        source || notice ? (
          <div className="space-y-2">
            {source && (
              <p className="flex min-w-0 items-center gap-1 text-[11px]">
                <span className="shrink-0 text-muted">From</span>
                <SectionPath path={source} nickname={nicknameOfEntry(index, entry.sourceEntryId)} />
              </p>
            )}
            {notice && <p className="rounded-lg bg-violetSoft px-3 py-1.5 text-xs text-violet">{notice}</p>}
          </div>
        ) : undefined
      }
      customizations={
        <div className="space-y-4">
          <Segmented
            label="Title / subtitle order"
            value={opts.titleOrder}
            options={[
              { value: "title-first", label: `${labels.title} – ${labels.org}` },
              { value: "org-first", label: `${labels.org} – ${labels.title}` },
            ]}
            onChange={(titleOrder) => draft.patchSection(section.id, { options: { ...section.options, titleOrder } })}
          />
          <Segmented
            label="Title line"
            value={opts.titleJoin}
            options={[
              { value: "comma", label: "Comma" },
              { value: "dash", label: "Dash" },
              { value: "stacked", label: "Two lines" },
            ]}
            onChange={(titleJoin) => draft.patchSection(section.id, { options: { ...section.options, titleJoin } })}
          />
          <p className="hint">Applies to every entry in {section.heading}. Fonts and spacing live in Customize.</p>
        </div>
      }
    >
      <Field id={id("title")} label={labels.title}>
        <input
          id={id("title")}
          className="field"
          value={entry.title}
          autoFocus={!entry.title}
          onChange={(e) => patch({ title: e.target.value })}
        />
      </Field>

      {def.hasOrganization && (
        <Field
          id={id("org")}
          label={labels.org}
          aside={
            <button
              type="button"
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors",
                entry.url ? "bg-violetSoft text-violet" : "text-muted hover:bg-violetSoft hover:text-violet",
              )}
              onClick={() => setLinkOpen((o) => !o)}
              aria-expanded={linkOpen}
            >
              <Link2 size={12} /> Link
            </button>
          }
        >
          <input
            id={id("org")}
            className="field"
            value={entry.organization}
            onChange={(e) => patch({ organization: e.target.value })}
          />
          {linkOpen && (
            <input
              aria-label={`${labels.org} link`}
              className="field mt-2"
              placeholder="https://… — the name becomes a link on the resume"
              value={entry.url}
              onChange={(e) => patch({ url: e.target.value })}
            />
          )}
        </Field>
      )}

      {!def.hasOrganization && (
        <Field id={id("url")} label="Link" hint="Optional — e.g. the repository or demo.">
          <input
            id={id("url")}
            className="field"
            placeholder="github.com/…"
            value={entry.url}
            onChange={(e) => patch({ url: e.target.value })}
          />
        </Field>
      )}

      <Field id={id("subtitle")} label="Subtitle" hint="Optional — printed after the title line.">
        <input
          id={id("subtitle")}
          className="field"
          value={entry.subtitle}
          onChange={(e) => patch({ subtitle: e.target.value })}
        />
      </Field>

      {def.hasDates && (
        <div className="grid grid-cols-2 gap-3">
          <Field id={id("start")} label="Start Date">
            <DateField id={id("start")} value={entry.startDate} onChange={(startDate) => patch({ startDate })} />
          </Field>
          <Field
            id={id("end")}
            label="End Date"
            aside={
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  className="accent-violet"
                  checked={entry.isCurrent}
                  onChange={(e) => patch({ isCurrent: e.target.checked, ...(e.target.checked ? { endDate: "" } : {}) })}
                />
                Present
              </label>
            }
          >
            {entry.isCurrent ? (
              <div className="field flex items-center text-muted">Present</div>
            ) : (
              <DateField id={id("end")} value={entry.endDate} onChange={(endDate) => patch({ endDate })} />
            )}
          </Field>
        </div>
      )}

      <Field id={id("loc")} label="Location">
        <input
          id={id("loc")}
          className="field"
          placeholder="City, Country"
          value={entry.location}
          onChange={(e) => patch({ location: e.target.value })}
        />
      </Field>

      {def.metaFields?.map((m) => (
        <Field key={m.key} id={id(m.key)} label={m.label}>
          <input
            id={id(m.key)}
            className="field"
            placeholder={m.placeholder}
            value={String(entry.meta[m.key] ?? "")}
            onChange={(e) => patch({ meta: { ...entry.meta, [m.key]: e.target.value } })}
          />
        </Field>
      ))}

      <div>
        <p id={id("desc")} className="mb-1.5 text-sm font-medium">
          Description
        </p>
        <RichTextEditor
          bullets={entry.bullets}
          onChange={onLines}
          onIds={(register) => {
            stampIds.current = register;
          }}
          saveToVault={saveBullet}
          pullFromVault={async (vaultBulletId) => {
            const r = await draft.runAndWait(() => addVaultBulletToEntry(entry.id, vaultBulletId));
            if (!r.ok) {
              setNotice(r.error);
              return null;
            }
            return r.data;
          }}
          renderVaultPicker={({ onPick }) => <VaultBulletDrawer entryId={entry.id} onPick={onPick} autoFocus />}
          labelledBy={id("desc")}
        />
      </div>
    </EditorShell>
  );
}

type Options = Extract<Awaited<ReturnType<typeof bulletOptionsForEntry>>, { ok: true }>["data"];

/** Unused vault bullets: this entry's own first, everything else by search. */
function VaultBulletDrawer({
  entryId,
  onPick,
  autoFocus = false,
}: {
  entryId: number;
  onPick: (vaultBulletId: number) => Promise<void>;
  /** Focus the search box — when opened from a line, so typing searches. */
  autoFocus?: boolean;
}) {
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [loading, startLoad] = useTransition();

  const load = useCallback((q: string) => {
    startLoad(async () => {
      const r = await bulletOptionsForEntry(entryId, q);
      if (r.ok) setOptions(r.data);
      else setError(r.error);
    });
  }, [entryId]);

  useEffect(() => {
    load("");
  }, [load]);

  async function pick(id: number) {
    setBusy(id);
    await onPick(id);
    setBusy(null);
    // Drop it from the list so it can't be added twice.
    setOptions((o) =>
      o ? { sameEntry: o.sameEntry.filter((b) => b.id !== id), others: o.others.filter((b) => b.id !== id) } : o,
    );
  }

  const rows = options
    ? [...options.sameEntry.map((b) => ({ ...b, from: "", nickname: "" })), ...options.others]
    : [];

  return (
    <div className="animate-fade-in rounded-xl border border-line bg-canvas/60 p-2">
      <div className="relative mb-2">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="field bg-surface py-1.5 pl-8 text-xs"
          placeholder="Search your vault bullets…"
          aria-label="Search vault bullets"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(query)}
        />
      </div>
      {error && <p className="px-1 text-xs text-red-600">{error}</p>}
      {loading && !options && <p className="px-1 py-2 text-xs text-muted">Loading…</p>}
      {options && rows.length === 0 && (
        <p className="px-1 py-2 text-xs text-muted">{query ? "No matches." : "Nothing unused in your vault."}</p>
      )}
      <ul className="max-h-60 space-y-1 overflow-y-auto">
        {rows.map((b) => (
          <li key={b.id}>
            <button
              className="flex w-full items-start gap-2 rounded-lg bg-surface px-2.5 py-2 text-left text-xs transition-colors hover:bg-violetSoft"
              onClick={() => pick(b.id)}
              disabled={busy !== null}
            >
              <span className="flex-1 leading-relaxed">
                {b.text}
                {b.from && (
                  <span className="mt-0.5 block text-[10px] text-muted">
                    {b.from}
                    {b.nickname && <NicknameChip nickname={b.nickname} />}
                  </span>
                )}
              </span>
              {busy === b.id ? (
                <Loader2 size={12} className="mt-0.5 animate-spin" />
              ) : (
                <StrengthMeter score={b.strength} />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
