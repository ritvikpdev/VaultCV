"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";

import { Modal, StrengthMeter } from "@/components/ui";
import type { VaultBullet, VaultEntry, VaultSkill } from "@/db/schema";

import { pullEntryFromVault, pullSkillsFromVault } from "../actions";

export type VaultEntryOption = VaultEntry & { bullets: VaultBullet[] };

/**
 * Pull from Vault — the one thing FlowCV has no equivalent for.
 *
 * Entries already used in this section are shown but disabled, which is what
 * `source_entry_id` buys: without the pointer, "have I already added this?"
 * would be a text comparison rather than a lookup.
 */
export function VaultPicker({
  open,
  onClose,
  sectionId,
  sectionLabel,
  layout,
  entries,
  skills,
  usedEntryIds,
  usedSkillIds,
}: {
  open: boolean;
  onClose: () => void;
  sectionId: number;
  sectionLabel: string;
  layout: "normal" | "skill";
  entries: VaultEntryOption[];
  skills: VaultSkill[];
  usedEntryIds: number[];
  usedSkillIds: number[];
}) {
  const used = new Set(usedEntryIds);
  const usedSkills = new Set(usedSkillIds);

  // Bullet selection per entry. Defaults to every bullet checked — pulling a job
  // and then trimming is the common motion; opting each bullet in is not.
  const [selected, setSelected] = useState<Record<number, Set<number>>>(() =>
    Object.fromEntries(
      entries.map((e) => [e.id, new Set(e.bullets.map((b) => b.id))]),
    ),
  );
  const [pickedSkills, setPickedSkills] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();

  function toggleBullet(entryId: number, bulletId: number) {
    setSelected((prev) => {
      const next = new Set(prev[entryId] ?? []);
      if (next.has(bulletId)) next.delete(bulletId);
      else next.add(bulletId);
      return { ...prev, [entryId]: next };
    });
  }

  function addEntry(entryId: number) {
    startTransition(async () => {
      await pullEntryFromVault(sectionId, entryId, [...(selected[entryId] ?? [])]);
      onClose();
    });
  }

  function addSkills() {
    startTransition(async () => {
      await pullSkillsFromVault(sectionId, [...pickedSkills]);
      onClose();
    });
  }

  if (layout === "skill") {
    const available = skills.filter((s) => !usedSkills.has(s.id));

    return (
      <Modal open={open} onClose={onClose} title={`Add skills to ${sectionLabel}`} wide>
        {available.length === 0 ? (
          <p className="hint">
            Every skill in your vault is already on this resume.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {available.map((s) => {
                const picked = pickedSkills.has(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() =>
                      setPickedSkills((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.id)) next.delete(s.id);
                        else next.add(s.id);
                        return next;
                      })
                    }
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      picked
                        ? "border-accent bg-accentSoft text-accent"
                        : "border-line hover:border-muted"
                    }`}
                  >
                    {picked && <Check size={12} className="mr-1 inline" />}
                    {s.name}
                    <span className="ml-1 text-xs text-muted">· {s.category}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
              <button
                className="hint hover:text-ink"
                onClick={() => setPickedSkills(new Set(available.map((s) => s.id)))}
              >
                Select all {available.length}
              </button>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="btn-accent"
                  disabled={pending || pickedSkills.size === 0}
                  onClick={addSkills}
                >
                  Add {pickedSkills.size || ""} skill{pickedSkills.size === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          </>
        )}
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={`Add to ${sectionLabel} from vault`} wide>
      {entries.length === 0 ? (
        <p className="hint">
          Nothing in your vault for this section yet. Add it in My Vault first,
          or import a resume.
        </p>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => {
            const alreadyUsed = used.has(entry.id);
            const picked = selected[entry.id] ?? new Set<number>();

            return (
              <div
                key={entry.id}
                className={`rounded-lg border p-4 ${
                  alreadyUsed ? "border-line bg-canvas opacity-60" : "border-line"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {entry.title}
                      {entry.organization && (
                        <span className="font-normal text-muted">
                          , {entry.organization}
                        </span>
                      )}
                    </p>
                    <p className="hint mt-0.5">
                      {[entry.startDate, entry.isCurrent ? "Present" : entry.endDate]
                        .filter(Boolean)
                        .join(" – ")}
                      {entry.location ? ` · ${entry.location}` : ""}
                    </p>
                  </div>

                  {alreadyUsed ? (
                    <span className="shrink-0 rounded bg-line px-2 py-1 text-xs text-muted">
                      Already added
                    </span>
                  ) : (
                    <button
                      className="btn-accent shrink-0 px-3 py-1 text-xs"
                      disabled={pending}
                      onClick={() => addEntry(entry.id)}
                    >
                      Add with {picked.size} bullet{picked.size === 1 ? "" : "s"}
                    </button>
                  )}
                </div>

                {!alreadyUsed && entry.bullets.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {entry.bullets.map((b) => (
                      <li key={b.id} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1 accent-accent"
                          checked={picked.has(b.id)}
                          onChange={() => toggleBullet(entry.id, b.id)}
                        />
                        <span className="flex-1 leading-relaxed">{b.text}</span>
                        <span className="mt-1 shrink-0">
                          <StrengthMeter score={b.strength} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
