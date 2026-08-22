"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Database } from "lucide-react";

import { Modal } from "@/components/ui";
import { parseSkillNames } from "@/lib/skill-category";

import { addSkillsToVault } from "../../vault/actions";
import { saveSkillCategory } from "../actions";

/** A vault skill section the new skills could be filed into. */
export type VaultSkillTarget = { id: number; heading: string };

/**
 * Build or edit one skills line.
 *
 * Two steps, and the second is the point of the feature. Step one writes the
 * category to the resume. Step two offers to put the same skills in the vault.
 *
 * The tuner reads both sides, but asymmetrically: it scans the resume to decide
 * what a job description already covers, and the vault for things it could
 * suggest adding. So a skill invented here still counts as covered on *this*
 * resume — but it can never be offered on another one until it reaches the
 * vault. That is what the second step is for.
 *
 * The offer is a prompt rather than automatic. A resume is a place to try
 * things; not every experiment deserves to land in the master record.
 */
export function SkillCategoryDialog({
  open,
  onClose,
  sectionId,
  initialCategory,
  initialSkills,
  knownSkills,
  vaultTargets,
}: {
  open: boolean;
  onClose: () => void;
  sectionId: number;
  /** Empty when creating. Set when editing, and used to find the rows. */
  initialCategory?: string;
  initialSkills?: string;
  /** Lowercased names already in the vault index, to avoid a pointless offer. */
  knownSkills: string[];
  vaultTargets: VaultSkillTarget[];
}) {
  const [category, setCategory] = useState(initialCategory ?? "");
  const [skills, setSkills] = useState(initialSkills ?? "");
  const [error, setError] = useState<string | null>(null);
  const [vaultNote, setVaultNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * The step-two list, frozen when step two opens.
   *
   * It cannot be derived on each render: saving revalidates the page, which
   * refreshes `knownSkills` from the vault, so a live calculation collapses to
   * "0 skills are new" the instant the write succeeds — directly above a
   * message saying four were added.
   */
  const [pendingForVault, setPendingForVault] = useState<string[] | null>(null);

  const names = useMemo(() => parseSkillNames(skills), [skills]);

  const known = useMemo(
    () => new Set(knownSkills.map((s) => s.toLowerCase())),
    [knownSkills],
  );
  const newToVault = names.filter((n) => !known.has(n.toLowerCase()));

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveSkillCategory(sectionId, {
        category,
        skills,
        previousCategory: initialCategory,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Nothing new for the vault, and nowhere to put it — the second step
      // would be a dead end, so finish here.
      if (newToVault.length === 0 || vaultTargets.length === 0) {
        onClose();
        return;
      }
      setPendingForVault(newToVault);
    });
  }

  function sendToVault(vaultSectionId: number) {
    setError(null);
    startTransition(async () => {
      const result = await addSkillsToVault(vaultSectionId, category, names);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setVaultNote(
        result.data.length === 0
          ? "Your vault already had all of these."
          : `Added ${result.data.length} to your vault: ${result.data.join(", ")}`,
      );
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        pendingForVault
          ? "Save to your vault?"
          : initialCategory
            ? "Edit category"
            : "New category"
      }
    >
      {pendingForVault ? (
        <>
          <p className="text-sm text-muted">
            <span className="font-medium text-ink">{category}</span> is on your
            resume. The tuner can only suggest skills it finds in your vault, so
            adding them there lets it offer them on your other resumes too.
          </p>

          {!vaultNote && (
            <p className="mt-3 text-sm">
              {pendingForVault.length === 1
                ? "1 skill is new to your vault:"
                : `${pendingForVault.length} skills are new to your vault:`}{" "}
              <span className="text-muted">{pendingForVault.join(", ")}</span>
            </p>
          )}

          {vaultNote ? (
            <div className="mt-5">
              <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <Check size={15} className="mt-0.5 shrink-0" />
                {vaultNote}
              </p>
              <button className="btn-accent mt-4" onClick={onClose}>
                Done
              </button>
            </div>
          ) : (
            <>
              <p className="mt-5 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Which skill section?
              </p>
              <div className="space-y-1">
                {vaultTargets.map((t) => (
                  <button
                    key={t.id}
                    disabled={pending}
                    onClick={() => sendToVault(t.id)}
                    className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm transition-colors hover:border-accent hover:bg-accentSoft disabled:opacity-50"
                  >
                    <Database size={14} className="shrink-0 text-muted" />
                    {t.heading}
                  </button>
                ))}
              </div>

              <button className="btn-ghost mt-4" onClick={onClose}>
                Not this time
              </button>
            </>
          )}

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <label className="label" htmlFor="skill-category-name">
            Category
          </label>
          <input
            id="skill-category-name"
            className="field"
            placeholder="AI &amp; LLM"
            value={category}
            autoFocus
            onChange={(e) => setCategory(e.target.value)}
          />

          <label className="label mt-4" htmlFor="skill-category-list">
            Skills
          </label>
          <textarea
            id="skill-category-list"
            className="field min-h-28 resize-y"
            placeholder="Claude, Cursor, Large Language Models, Back Propagation"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
          />
          <p className="hint mt-1">
            Separate with commas or new lines. The order you type is the order
            printed.
          </p>

          {/*
            A preview of the line as the resume renders it, rather than a count
            of chips. The thing being edited is one line of a document, and
            showing it as anything else makes you guess at the result.
          */}
          {(category.trim() || names.length > 0) && (
            <div className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2">
              <p className="hint mb-1">On the resume</p>
              <p className="text-sm">
                <strong>{category.trim() || "Category"}</strong>
                {names.length > 0 && <> — {names.join(" | ")}</>}
              </p>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          <div className="mt-5 flex gap-2">
            <button
              className="btn-accent"
              disabled={pending || !category.trim() || names.length === 0}
              onClick={save}
            >
              {initialCategory ? "Save changes" : "Add category"}
            </button>
            <button className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
