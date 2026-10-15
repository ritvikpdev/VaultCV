import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { hasApiKey } from "@/db/ai-config";
import { allGroups, allSections, allSkills } from "@/db/queries";
import { getResumeFull, vaultOptionsForResume } from "@/db/resume-queries";
import { withVault } from "@/db/session";
import { buildVaultIndex, formatPath, pathOfSection } from "@/lib/vault-path";

import { type SectionVaultData, type VaultSkillContext } from "./content-tab";
import { ResumeEditor, type Tab } from "./editor";
import { ResumeHeader } from "./resume-header";

export const dynamic = "force-dynamic";

export default async function ResumePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;

  const resumeId = Number(id);
  if (!Number.isInteger(resumeId)) notFound();

  const loaded = await withVault(async () => {
    const resume = await getResumeFull(resumeId);
    if (!resume) return null;
    const [opts, sections, skills, groups, keyPresent] = await Promise.all([
      vaultOptionsForResume(resume.sections.map((s) => s.id)),
      allSections(),
      allSkills(),
      allGroups(),
      hasApiKey(),
    ]);
    return { resume, opts, sections, skills, groups, keyPresent };
  });
  if (!loaded) notFound();
  const { resume, opts, sections, skills, groups, keyPresent } = loaded;

  // "Group → Section" for every vault item the editor might mention.
  const vaultIndex = buildVaultIndex({
    groups,
    sections: opts.sections,
    entries: opts.entries,
    skills: opts.skills,
  });

  const activeTab: Tab = tab === "customize" || tab === "tune" ? (tab as Tab) : "content";

  // Vault options per section, resolved on the server so the picker opens
  // instantly instead of fetching on click.
  const vaultData: SectionVaultData = {};
  for (const section of resume.sections) {
    vaultData[section.id] = {
      sections: opts.sections,
      entries: opts.entries,
      skills: opts.skills,
      usedEntryIds: [...(opts.usedEntryIds.get(section.id) ?? [])],
      usedSkillIds: section.skills.map((s) => s.id),
    };
  }

  // Where a hand-built category can be filed in the vault, and what the vault
  // already knows — so the save step can offer the right sections and skip
  // skills you demonstrably have.
  const vaultSkills: VaultSkillContext = {
    targets: sections
      .filter((s) => s.type === "skill")
      // Named with their group: two groups can each hold a section called "Skills".
      .map((s) => {
        const path = pathOfSection(vaultIndex, s.id);
        return { id: s.id, heading: path ? formatPath(path) : s.heading };
      }),
    known: skills.map((s) => s.name),
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/" className="hint inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft size={14} /> My Resumes
        </Link>
        <ResumeHeader
          resumeId={resume.id}
          name={resume.name}
          targetRole={resume.targetRole}
          targetCompany={resume.targetCompany}
        />
      </div>

      <ResumeEditor
        resume={resume}
        vaultData={vaultData}
        vaultSkills={vaultSkills}
        vaultIndex={vaultIndex}
        activeTab={activeTab}
        hasApiKey={keyPresent}
      />
    </div>
  );
}
