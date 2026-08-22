"use client";

import { useState, useTransition } from "react";

import { Modal } from "@/components/ui";
import type { VaultEntry, VaultSection } from "@/db/schema";
import { extractSkills } from "@/lib/skill-index";

import { createEntry, updateEntry } from "./actions";

const SKILL_LEVELS = ["", "beginner", "intermediate", "advanced", "expert"] as const;

/**
 * One dialog, two shapes — matching the reference tool's Edit Entry.
 *
 *   normal — Title, Subtitle, Start / End / Location, then bullets on the card
 *   skill  — Skill, Information / Sub-skills, Skill level
 *
 * Which fields appear is driven by the section's `type`, so a section the user
 * invented gets the right form without anything being predefined about it.
 */
export function EntryDialog({
  open,
  onClose,
  section,
  entry,
}: {
  open: boolean;
  onClose: () => void;
  section: VaultSection;
  entry?: VaultEntry;
}) {
  const isSkill = section.type === "skill";
  const editing = Boolean(entry);

  const [title, setTitle] = useState(entry?.title ?? "");
  const [organization, setOrganization] = useState(entry?.organization ?? "");
  const [subtitle, setSubtitle] = useState(entry?.subtitle ?? "");
  const [location, setLocation] = useState(entry?.location ?? "");
  const [startDate, setStartDate] = useState(entry?.startDate ?? "");
  const [endDate, setEndDate] = useState(entry?.endDate ?? "");
  const [isCurrent, setIsCurrent] = useState(entry?.isCurrent ?? false);
  const [url, setUrl] = useState(entry?.url ?? "");
  const [information, setInformation] = useState(entry?.information ?? "");
  const [level, setLevel] = useState(entry?.level ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Live feedback on what the matcher will extract, so the effect of writing
  // "k8s" instead of "Kubernetes" is visible rather than silent.
  const extracted = isSkill ? extractSkills(information) : [];

  function submit() {
    setError(null);
    const input = {
      title,
      organization,
      subtitle,
      location,
      startDate,
      endDate: isCurrent ? "" : endDate,
      isCurrent,
      url,
      information,
      level,
      meta: entry?.meta ?? {},
    };

    startTransition(async () => {
      const result = entry
        ? await updateEntry(entry.id, input)
        : await createEntry(section.id, input);

      if (result.ok) onClose();
      else setError(result.error);
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${editing ? "Edit" : "Add"} entry — ${section.heading}`}
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="e-title">
            {isSkill ? "Skill" : "Title"}
          </label>
          <input
            id="e-title"
            className="field"
            value={title}
            autoFocus
            placeholder={isSkill ? "e.g. Languages, Frameworks" : "e.g. Software Engineer"}
            onChange={(e) => setTitle(e.target.value)}
          />
          {isSkill && (
            <p className="hint mt-1">
              The label for this line — the sub-skills below sit next to it.
            </p>
          )}
        </div>

        {isSkill ? (
          <>
            <div>
              <label className="label" htmlFor="e-info">
                Information / Sub-skills
              </label>
              <textarea
                id="e-info"
                className="field min-h-24 resize-y"
                value={information}
                placeholder="Java | C# | Python | JavaScript"
                onChange={(e) => setInformation(e.target.value)}
              />
              <p className="hint mt-1">
                Separate with <code>|</code>, commas or new lines.
              </p>

              {extracted.length > 0 && (
                <div className="mt-2 rounded-lg bg-canvas p-2.5">
                  <p className="hint">
                    {extracted.length} skill{extracted.length === 1 ? "" : "s"} recognised
                    for job matching:
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {extracted.map((s) => (
                      <span
                        key={s.name}
                        className="rounded bg-surface px-1.5 py-0.5 text-[11px]"
                        title={
                          s.aliases.length
                            ? `Also matches: ${s.aliases.join(", ")}`
                            : undefined
                        }
                      >
                        {s.name}
                        {s.aliases.length > 0 && (
                          <span className="ml-1 text-muted">+{s.aliases.length}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="label" htmlFor="e-level">
                Skill level <span className="font-normal text-muted">(optional)</span>
              </label>
              <select
                id="e-level"
                className="field"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                {SKILL_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l ? l[0]!.toUpperCase() + l.slice(1) : "Select skill level"}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="e-org">
                Organization <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="e-org"
                className="field"
                value={organization}
                placeholder="e.g. Accenture, George Washington University"
                onChange={(e) => setOrganization(e.target.value)}
              />
            </div>

            <div>
              <label className="label" htmlFor="e-subtitle">
                Subtitle <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="e-subtitle"
                className="field"
                value={subtitle}
                placeholder="Distributed LLM inference system built in Go"
                onChange={(e) => setSubtitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label" htmlFor="e-start">
                  Start date
                </label>
                <input
                  id="e-start"
                  className="field"
                  value={startDate}
                  placeholder="MM/YYYY"
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="e-end">
                  End date
                </label>
                <input
                  id="e-end"
                  className="field"
                  value={endDate}
                  placeholder="MM/YYYY"
                  disabled={isCurrent}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="e-loc">
                  Location
                </label>
                <input
                  id="e-loc"
                  className="field"
                  value={location}
                  placeholder="City, Country"
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isCurrent}
                onChange={(e) => setIsCurrent(e.target.checked)}
                className="accent-accent"
              />
              Currently here (shows as &ldquo;Present&rdquo;)
            </label>

            <div>
              <label className="label" htmlFor="e-url">
                Link <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="e-url"
                className="field"
                value={url}
                placeholder="github.com/…"
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            {!editing && (
              <p className="hint">
                Bullet points are added on the entry card once it exists.
              </p>
            )}
          </>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-accent"
            onClick={submit}
            disabled={pending || !title.trim()}
          >
            {pending ? "Saving…" : editing ? "Save changes" : "Add entry"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
