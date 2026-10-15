"use client";

import { useMemo, useState } from "react";
import { Camera, GripVertical, Info, Plus, X } from "lucide-react";

import type { ContactKey, Profile } from "@/db/schema";
import { contactOrder } from "@/lib/resume-model";
import { useSortable } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";

import { useDraft } from "./draft";
import { EditorShell, Field } from "./editor-shell";

/** Chips that add a link (printed as its label, linked) vs. a plain detail. */
const LINK_CHIPS = ["LinkedIn", "GitHub", "Website", "Portfolio", "Medium", "X"];
const DETAIL_CHIPS = ["Nationality", "Date of Birth", "Visa", "Availability"];
const MORE_DETAIL_CHIPS = ["Driving Licence", "Pronouns", "Citizenship", "Notice Period", "Languages", "Security Clearance"];

const CONTACT_LABELS: Record<ContactKey, string> = {
  email: "Email",
  phone: "Phone",
  location: "Location",
  links: "Links",
  details: "Details",
};

/**
 * Personal details — the account profile, edited in place.
 *
 * Shared by every resume (the header reads one profile), and the editor says
 * so up front. Everything writes to the draft as you type, so the preview's
 * header follows each keystroke.
 */
export function PersonalEditor({ onBack }: { onBack: () => void }) {
  const draft = useDraft();
  const p = draft.resume.profile;
  const [more, setMore] = useState(false);
  const patch = (x: Parameters<typeof draft.patchProfile>[0]) => draft.patchProfile(x);

  const usedLabels = new Set([...p.links.map((l) => l.label), ...(p.details ?? []).map((d) => d.label)]);

  return (
    <EditorShell
      title="Personal Details"
      onBack={onBack}
      tips={[
        "Use a professional email address.",
        "A city and country is enough for location.",
        "Link to LinkedIn and one place that shows your work.",
        "Leave out photo, age and marital status unless the country expects them.",
      ]}
    >
      <p className="flex items-start gap-2 rounded-xl bg-violetSoft px-3 py-2 text-xs text-violet">
        <Info size={14} className="mt-0.5 shrink-0" />
        These are your profile details — they appear on every resume, and are also editable in Settings.
      </p>

      <div className="flex items-start gap-4">
        <div className="flex-1 space-y-4">
          <Field id="pd-name" label="Full name">
            <input id="pd-name" className="field" value={p.fullName} onChange={(e) => patch({ fullName: e.target.value })} />
          </Field>
          <Field id="pd-title" label="Professional title" hint="Optional — printed under your name.">
            <input
              id="pd-title"
              className="field"
              placeholder="e.g. Software Engineer"
              value={p.title ?? ""}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </Field>
        </div>
        {/* Photo is a stub: there's no file storage yet, and single-column
            ATS resumes usually leave it off. */}
        <div className="flex flex-col items-center gap-1.5 pt-6">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-line bg-canvas text-muted"
            title="Photo upload is coming soon"
          >
            <Camera size={20} />
          </div>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Photo · soon</span>
        </div>
      </div>

      <Field id="pd-email" label="Email">
        <input id="pd-email" type="email" className="field" value={p.email} onChange={(e) => patch({ email: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="pd-phone" label="Phone">
          <input id="pd-phone" type="tel" className="field" value={p.phone} onChange={(e) => patch({ phone: e.target.value })} />
        </Field>
        <Field id="pd-loc" label="Location">
          <input
            id="pd-loc"
            className="field"
            placeholder="City, Country"
            value={p.location}
            onChange={(e) => patch({ location: e.target.value })}
          />
        </Field>
      </div>

      <RowList
        title="Links"
        rows={p.links.map((l) => ({ label: l.label, value: l.url }))}
        valuePlaceholder="linkedin.com/in/you"
        onChange={(rows) => patch({ links: rows.map((r) => ({ label: r.label, url: r.value })) })}
      />

      <RowList
        title="Details"
        rows={(p.details ?? []).map((d) => ({ label: d.label, value: d.value }))}
        valuePlaceholder="Value"
        onChange={(rows) => patch({ details: rows })}
      />

      <div>
        <p className="mb-1.5 text-sm font-medium">Add details</p>
        <div className="flex flex-wrap gap-1.5">
          {[...LINK_CHIPS, ...DETAIL_CHIPS, ...(more ? MORE_DETAIL_CHIPS : [])]
            .filter((label) => !usedLabels.has(label))
            .map((label) => (
              <button
                key={label}
                type="button"
                className="inline-flex items-center gap-1 rounded-full bg-violetSoft px-2.5 py-1 text-xs font-medium text-violet transition-colors hover:bg-violet/15"
                onClick={() =>
                  LINK_CHIPS.includes(label)
                    ? patch({ links: [...p.links, { label, url: "" }] })
                    : patch({ details: [...(p.details ?? []), { label, value: "" }] })
                }
              >
                <Plus size={11} /> {label}
              </button>
            ))}
          <button type="button" className="px-2 py-1 text-xs font-medium text-muted hover:text-ink" onClick={() => setMore((m) => !m)}>
            {more ? "Show less" : "Show more"}
          </button>
        </div>
      </div>

      <ContactOrder profile={p} onChange={(order) => patch({ contactOrder: order })} />

      <Field id="pd-summary" label="Summary" hint="Printed above your first section when set.">
        <textarea
          id="pd-summary"
          className="field min-h-28 resize-y leading-relaxed"
          value={p.summary}
          onChange={(e) => patch({ summary: e.target.value })}
        />
      </Field>
    </EditorShell>
  );
}

/** Label/value rows, draggable, removable. Used for links and details. */
function RowList({
  title,
  rows,
  valuePlaceholder,
  onChange,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
  valuePlaceholder: string;
  onChange: (rows: Array<{ label: string; value: string }>) => void;
}) {
  const order = useMemo(() => ({ rows: rows.map((_, i) => i) }), [rows]);
  const sort = useSortable({
    value: order,
    onCommit: (next) => onChange((next.rows ?? []).map((i) => rows[i]!)),
  });

  if (rows.length === 0) return null;

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{title}</p>
      <div ref={sort.registerContainer("rows")} className="space-y-2">
        {(sort.order.rows ?? []).map((i) => {
          const row = rows[i];
          if (!row) return null;
          return (
            <div
              key={i}
              ref={sort.registerItem(i)}
              className={cn("group flex items-center gap-2", sort.draggingId === i && "opacity-40")}
            >
              <span {...sort.handleProps(i, "rows")} className="text-muted" aria-label="Drag to reorder" title="Drag to reorder">
                <GripVertical size={14} />
              </span>
              <input
                aria-label={`${title} label`}
                className="field w-32"
                placeholder="Label"
                value={row.label}
                onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
              />
              <input
                aria-label={`${row.label || title} value`}
                className="field flex-1"
                placeholder={valuePlaceholder}
                value={row.value}
                onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
              />
              <button
                type="button"
                aria-label={`Remove ${row.label || "row"}`}
                className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The order of the contact line under the name, by group. */
function ContactOrder({ profile, onChange }: { profile: Profile; onChange: (order: ContactKey[]) => void }) {
  // Keyed on the joined string so a re-render with the same order doesn't
  // rebuild the sortable's value.
  const joined = contactOrder(profile.contactOrder).join("|");
  const keys = useMemo(() => joined.split("|") as ContactKey[], [joined]);
  const ids = useMemo(() => ({ keys: keys.map((_, i) => i) }), [keys]);
  const sort = useSortable({
    value: ids,
    // Chips wrap, so hit-test in reading order.
    layout: "grid",
    onCommit: (next) => onChange((next.keys ?? []).map((i) => keys[i]!)),
  });

  return (
    <div>
      <p className="mb-1 text-sm font-medium">Contact line order</p>
      <p className="hint mb-2">Drag to change the order these appear under your name.</p>
      <div ref={sort.registerContainer("keys")} className="flex flex-wrap gap-1.5">
        {(sort.order.keys ?? []).map((i) => (
          <span
            key={keys[i]}
            ref={sort.registerItem(i)}
            {...sort.handleProps(i, "keys")}
            className={cn(
              "inline-flex select-none items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs",
              sort.draggingId === i && "opacity-40",
            )}
          >
            <GripVertical size={11} className="text-muted" />
            {CONTACT_LABELS[keys[i]!]}
          </span>
        ))}
      </div>
    </div>
  );
}
