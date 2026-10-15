"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Check, Database } from "lucide-react";

import { sectionOptions, type ResolvedSection } from "@/lib/resume-model";
import { parseSkillNames } from "@/lib/skill-category";

import { addSkillsToVault } from "../../vault/actions";
import { useDraft } from "./draft";
import { EditorShell, Field, Segmented, tipsFor } from "./editor-shell";
import type { VaultSkillTarget } from "./skill-category-dialog";

/**
 * One skills line in the editor view: a label and the skills under it.
 *
 * Writes go through the draft (live preview) to the same `saveSkillCategory`
 * the dialog used, which diffs by name so rows keep their vault links. The
 * dialog's second step — offering skills that are new to the vault — is kept,
 * shown when you press Done.
 */
export function SkillEditor({
  section,
  initialCategory,
  onBack,
  knownSkills,
  vaultTargets,
}: {
  section: ResolvedSection;
  /** "" for a new line. */
  initialCategory: string;
  onBack: () => void;
  knownSkills: string[];
  vaultTargets: VaultSkillTarget[];
}) {
  const draft = useDraft();
  const editKey = useRef(`${section.id}:${initialCategory || "new"}:${Math.random().toString(36).slice(2, 7)}`).current;
  // Seeded once, when the editor opens; after that this component owns the text.
  const [category, setCategory] = useState(initialCategory);
  const [skills, setSkills] = useState(() =>
    section.skills.filter((k) => k.category === initialCategory).map((k) => k.name).join(", "),
  );
  const [vaultStep, setVaultStep] = useState<string[] | null>(null);
  const [vaultNote, setVaultNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const names = useMemo(() => parseSkillNames(skills), [skills]);
  const rows = section.skills.filter((k) => k.category === category);
  const visible = rows.length === 0 || rows.some((k) => k.isVisible);
  const opts = sectionOptions(section);

  function change(nextCategory: string, nextSkills: string) {
    setCategory(nextCategory);
    setSkills(nextSkills);
    draft.setSkillCategory(section.id, editKey, initialCategory, nextCategory, nextSkills);
  }

  function done() {
    draft.flush();
    // Step two: skills that the vault doesn't know yet, if there's somewhere to put them.
    const known = new Set(knownSkills.map((s) => s.toLowerCase()));
    const fresh = names.filter((n) => !known.has(n.toLowerCase()));
    if (!vaultStep && category.trim() && fresh.length > 0 && vaultTargets.length > 0) {
      setVaultStep(fresh);
      return;
    }
    onBack();
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

  if (vaultStep) {
    return (
      <div className="card animate-slide-in-left space-y-4 p-5">
        <h2 className="text-lg font-semibold tracking-tight">Save to your vault?</h2>
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">{category}</span> is on your resume. The tuner can only
          suggest skills it finds in your vault, so adding them there lets it offer them on your other
          resumes too.
        </p>
        {vaultNote ? (
          <>
            <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <Check size={15} className="mt-0.5 shrink-0" /> {vaultNote}
            </p>
            <button className="btn-gradient w-full py-3" onClick={onBack}>
              Done
            </button>
          </>
        ) : (
          <>
            <p className="text-sm">
              {vaultStep.length === 1 ? "1 skill is new to your vault:" : `${vaultStep.length} skills are new to your vault:`}{" "}
              <span className="text-muted">{vaultStep.join(", ")}</span>
            </p>
            <div className="space-y-1.5">
              {vaultTargets.map((t) => (
                <button
                  key={t.id}
                  disabled={pending}
                  onClick={() => sendToVault(t.id)}
                  className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-left text-sm transition-colors hover:border-violet/50 hover:bg-violetSoft disabled:opacity-50"
                >
                  <Database size={14} className="shrink-0 text-muted" />
                  {t.heading}
                </button>
              ))}
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button className="btn-ghost w-full" onClick={onBack}>
              Not this time
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <EditorShell
      title={initialCategory ? "Edit Skill" : "Add Skill"}
      onBack={done}
      tips={tipsFor("skill")}
      visible={visible}
      onToggleVisible={rows.length ? () => draft.setSkillCategoryVisible(section.id, category, !visible) : undefined}
      onDelete={
        rows.length
          ? () => {
              draft.removeSkillCategory(section.id, category);
              onBack();
            }
          : undefined
      }
      deleteMessage={`Remove the "${category}" line from this resume? Your vault keeps everything.`}
      customizations={
        <div className="space-y-3">
          <Segmented
            label="Skills layout"
            value={opts.skillsLayout}
            options={[
              { value: "lines", label: "Lines" },
              { value: "colon", label: "Name: skills" },
              { value: "bullets", label: "Bullets" },
              { value: "inline", label: "One paragraph" },
            ]}
            onChange={(skillsLayout) => draft.patchSection(section.id, { options: { ...section.options, skillsLayout } })}
          />
          <p className="hint">Applies to the whole {section.heading} section.</p>
        </div>
      }
    >
      <Field id="skill-name" label="Skill" hint="The label for this line — e.g. Languages, Frameworks, Cloud.">
        <input
          id="skill-name"
          className="field"
          autoFocus={!initialCategory}
          value={category}
          onChange={(e) => change(e.target.value, skills)}
        />
      </Field>
      <Field
        id="skill-items"
        label="Information / Sub-skills"
        hint="Separate with commas, | or new lines. The preview updates as you type."
      >
        <textarea
          id="skill-items"
          className="field min-h-28 resize-y leading-relaxed"
          placeholder="Java, Python, Go, TypeScript"
          value={skills}
          onChange={(e) => change(category, e.target.value)}
        />
      </Field>
      {names.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {names.map((n) => (
            <span key={n} className="rounded-full bg-violetSoft px-2.5 py-0.5 text-xs text-violet">
              {n}
            </span>
          ))}
        </div>
      )}
      {(!category.trim() || names.length === 0) && (
        <p className="hint">Needs a label and at least one skill before it&rsquo;s saved.</p>
      )}
    </EditorShell>
  );
}
