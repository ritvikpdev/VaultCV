import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { hasApiKey } from "@/db/bootstrap";
import { allSections, allSkills } from "@/db/queries";
import { getResumeFull, vaultOptionsForSection } from "@/db/resume-queries";

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

  const resume = getResumeFull(resumeId);
  if (!resume) notFound();

  const activeTab: Tab =
    tab === "customize" || tab === "tune" ? (tab as Tab) : "content";

  // Vault options per section, resolved on the server so the picker opens
  // instantly instead of fetching on click.
  const vaultData: SectionVaultData = {};
  for (const section of resume.sections) {
    const opts = vaultOptionsForSection(resumeId, section.id);
    vaultData[section.id] = {
      sections: opts.sections,
      entries: opts.entries,
      skills: opts.skills,
      usedEntryIds: [...opts.usedEntryIds],
      usedSkillIds: section.skills.map((s) => s.id),
    };
  }

  // Where a hand-built category can be filed in the vault, and what the vault
  // already knows — so the save step can offer the right sections and skip
  // skills you demonstrably have.
  const vaultSkills: VaultSkillContext = {
    targets: allSections()
      .filter((s) => s.type === "skill")
      .map((s) => ({ id: s.id, heading: s.heading })),
    known: allSkills().map((s) => s.name),
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
        activeTab={activeTab}
        hasApiKey={hasApiKey()}
      />
    </div>
  );
}
