"use client";

import { useState, useTransition } from "react";
import { Check, ChevronLeft } from "lucide-react";

import { NicknameChip, SectionPath } from "@/components/section-path";
import { Modal, StrengthMeter } from "@/components/ui";
import type { VaultBullet, VaultEntry, VaultSection, VaultSkill } from "@/db/schema";

import { formatPath, pathOfSection } from "@/lib/vault-path";

import { pullEntryFromVault, pullSkillsFromVault } from "../actions";
import { useVaultIndex } from "./vault-index-context";

export type VaultEntryOption = VaultEntry & { bullets: VaultBullet[] };
export type VaultSkillOption = VaultSkill & { sectionId: number | null };

/**
 * Pull from Vault — the one thing FlowCV has no equivalent for.
 *
 * Entries already used in this section are shown but disabled, which is what
 * `source_entry_id` buys: without the pointer, "have I already added this?"
 * would be a text comparison rather than a lookup.
 *
 * Vault sections are user-defined and unbounded in number, so the picker opens
 * on a list of them rather than every entry at once — you choose a section,
 * then see what's inside it. `activeSectionId` drives that drill-down; it
 * isn't reset by the Modal itself (it stays mounted and just shows/hides), so
 * `close()` resets it explicitly to land back on the section list next open.
 */
export function VaultPicker({
  open,
  onClose,
  sectionId,
  sectionLabel,
  layout,
  vaultSections,
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
  vaultSections: VaultSection[];
  entries: VaultEntryOption[];
  skills: VaultSkillOption[];
  usedEntryIds: number[];
  usedSkillIds: number[];
}) {
  const used = new Set(usedEntryIds);
  const usedSkills = new Set(usedSkillIds);
  const index = useVaultIndex();

  const [activeSectionId, setActiveSectionId] = useState<number | null>(null);

  // Bullet selection per entry. Starts empty: which bullets fit a resume is the
  // user's call, so nothing is opted in for them. "Select all" covers the case
  // where they do want the whole job.
  const [selected, setSelected] = useState<Record<number, Set<number>>>({});
  const [pickedSkills, setPickedSkills] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();

  function close() {
    setActiveSectionId(null);
    setPickedSkills(new Set());
    // Every opening starts with nothing ticked, not the last selection.
    setSelected({});
    onClose();
  }

  function setAll(entryId: number, bulletIds: number[]) {
    setSelected((prev) => ({ ...prev, [entryId]: new Set(bulletIds) }));
  }

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
      close();
    });
  }

  function addSkills() {
    startTransition(async () => {
      await pullSkillsFromVault(sectionId, [...pickedSkills]);
      close();
    });
  }

  // Only sections that actually hold something of the right shape are worth
  // offering — an empty normal section in a skills picker (or vice versa) is
  // never a valid choice.
  const relevantSections = vaultSections.filter((vs) =>
    layout === "skill"
      ? skills.some((s) => s.sectionId === vs.id)
      : entries.some((e) => e.sectionId === vs.id),
  );

  // Sections under their groups. `vaultSections` arrive in sidebar order, so
  // first-seen order of each group reproduces the sidebar's group order.
  const byGroup: Array<{ group: string | null; sections: VaultSection[] }> = [];
  for (const vs of relevantSections) {
    const group = pathOfSection(index, vs.id)?.group ?? null;
    const bucket = byGroup.find((b) => b.group === group);
    if (bucket) bucket.sections.push(vs);
    else byGroup.push({ group, sections: [vs] });
  }

  if (activeSectionId === null) {
    return (
      <Modal open={open} onClose={close} title={`Add to ${sectionLabel} from vault`} wide>
        {relevantSections.length === 0 ? (
          <p className="hint">
            Nothing in your vault yet. Add it in My Vault first, or import a
            resume.
          </p>
        ) : (
          <div className="space-y-5">
            {byGroup.map(({ group, sections }) => (
              <div key={group ?? "__ungrouped"}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {group ?? "Not in a group"}
                </p>
                <div className="space-y-1.5">
                  {sections.map((vs) => {
                    const count =
                      layout === "skill"
                        ? skills.filter((s) => s.sectionId === vs.id && !usedSkills.has(s.id))
                            .length
                        : entries.filter((e) => e.sectionId === vs.id).length;

                    return (
                      <button
                        key={vs.id}
                        onClick={() => setActiveSectionId(vs.id)}
                        className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2.5 text-left text-sm transition-colors hover:border-accent hover:bg-accentSoft"
                      >
                        <span className="font-medium">{vs.heading}</span>
                        <span className="text-xs text-muted">
                          {layout === "skill"
                            ? `${count} available`
                            : `${count} ${count === 1 ? "entry" : "entries"}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button className="btn-ghost" onClick={close}>
            Cancel
          </button>
        </div>
      </Modal>
    );
  }

  const activeSection = vaultSections.find((vs) => vs.id === activeSectionId);
  const activePath = pathOfSection(index, activeSectionId);
  const fromLabel = activePath ? formatPath(activePath) : (activeSection?.heading ?? "vault");
  const backButton = (
    <>
      <button
        onClick={() => setActiveSectionId(null)}
        className="hint mb-4 flex items-center gap-1 hover:text-ink"
      >
        <ChevronLeft size={14} /> Back to sections
      </button>
      {/* Group first: "SDE Experience" alone doesn't say which group it's in. */}
      {activePath && (
        <p className="-mt-2 mb-4 flex items-center gap-1.5 text-xs">
          <span className="text-muted">Pulling from</span>
          <SectionPath path={activePath} tone="ink" />
        </p>
      )}
    </>
  );

  if (layout === "skill") {
    const available = skills.filter(
      (s) => s.sectionId === activeSectionId && !usedSkills.has(s.id),
    );

    return (
      <Modal
        open={open}
        onClose={close}
        title={`Add skills from ${fromLabel}`}
        wide
      >
        {backButton}
        {available.length === 0 ? (
          <p className="hint">
            Every skill in this section is already on this resume.
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
                <button className="btn-ghost" onClick={close}>
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

  const sectionEntries = entries.filter((e) => e.sectionId === activeSectionId);

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Add to ${sectionLabel} from ${fromLabel}`}
      wide
    >
      {backButton}
      {sectionEntries.length === 0 ? (
        <p className="hint">Nothing in this section yet.</p>
      ) : (
        <div className="space-y-4">
          {sectionEntries.map((entry) => {
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
                      {entry.nickname && <NicknameChip nickname={entry.nickname} className="align-middle" />}
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
                      {picked.size === 0
                        ? "Add without bullets"
                        : `Add with ${picked.size} bullet${picked.size === 1 ? "" : "s"}`}
                    </button>
                  )}
                </div>

                {!alreadyUsed && entry.bullets.length > 0 && (
                  <div className="mt-3 flex items-center justify-between">
                    <span className="hint">
                      {picked.size} of {entry.bullets.length} selected
                    </span>
                    <button
                      type="button"
                      className="text-xs font-medium text-violet hover:underline"
                      onClick={() =>
                        setAll(
                          entry.id,
                          picked.size === entry.bullets.length ? [] : entry.bullets.map((b) => b.id),
                        )
                      }
                    >
                      {picked.size === entry.bullets.length ? "Clear" : "Select all"}
                    </button>
                  </div>
                )}

                {!alreadyUsed && entry.bullets.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
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
