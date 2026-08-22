import type { SectionType } from "../db/schema.ts";

/**
 * The shared section catalogue.
 *
 * One definition drives three things: the vault sidebar, the "Add content"
 * modal, and the default section set for a new resume. When these drifted apart
 * in v1 the vault and the resume disagreed about what a "Certification" was.
 */
export type SectionDef = {
  type: SectionType;
  /** Default heading text as it appears on the resume. */
  heading: string;
  /** Label in the vault sidebar and Add-content modal. */
  label: string;
  /** One-line explanation shown in the Add-content modal. */
  blurb: string;
  /** Sidebar grouping in the vault. */
  group: "Career" | "Credentials" | "Personal";
  /** Skill sections render as inline comma lists; normal ones render bullets. */
  layout: "normal" | "skill";
  /** Entries in this section carry dates. */
  hasDates: boolean;
  /** Entries in this section carry an organization line. */
  hasOrganization: boolean;
  /** Included when a brand-new resume is created. */
  inDefaultResume: boolean;
  /** Extra fields surfaced in the entry form, stored in vault_entries.meta. */
  metaFields?: Array<{ key: string; label: string; placeholder?: string }>;
};

export const SECTION_DEFS: SectionDef[] = [
  {
    type: "summary",
    heading: "SUMMARY",
    label: "Summary",
    blurb: "A short statement of your key strengths, experience and goals.",
    group: "Career",
    layout: "normal",
    hasDates: false,
    hasOrganization: false,
    inDefaultResume: false,
  },
  {
    type: "education",
    heading: "EDUCATION",
    label: "Education",
    blurb: "Degrees and schools. Include focus, honors or exchange terms.",
    group: "Credentials",
    layout: "normal",
    hasDates: true,
    hasOrganization: true,
    inDefaultResume: true,
    metaFields: [{ key: "gpa", label: "GPA / C.G.P.A.", placeholder: "8.9" }],
  },
  {
    type: "skill",
    heading: "TECHNICAL SKILLS",
    label: "Technical Skills",
    blurb: "Hard and soft skills, grouped by category.",
    group: "Career",
    layout: "skill",
    hasDates: false,
    hasOrganization: false,
    inDefaultResume: true,
  },
  {
    type: "experience",
    heading: "WORK EXPERIENCE",
    label: "Work Experience",
    blurb: "Professional roles and employer history, including internships.",
    group: "Career",
    layout: "normal",
    hasDates: true,
    hasOrganization: true,
    inDefaultResume: true,
    metaFields: [
      { key: "employmentType", label: "Employment type", placeholder: "Full-time" },
    ],
  },
  {
    type: "project",
    heading: "PROJECTS",
    label: "Projects",
    blurb: "Key projects, your role, the challenge and the impact.",
    group: "Career",
    layout: "normal",
    hasDates: true,
    hasOrganization: false,
    inDefaultResume: true,
    metaFields: [
      { key: "techStack", label: "Tech stack", placeholder: "Go, Redis, Docker" },
    ],
  },
  {
    type: "certification",
    heading: "CERTIFICATIONS",
    label: "Certificates",
    blurb: "Industry certificates and licences. Include issuer and date earned.",
    group: "Credentials",
    layout: "normal",
    hasDates: true,
    hasOrganization: true,
    inDefaultResume: false,
    metaFields: [
      { key: "credentialId", label: "Credential ID", placeholder: "ABC-123456" },
    ],
  },
  {
    type: "publication",
    heading: "PUBLICATIONS",
    label: "Publications",
    blurb: "Papers, articles or books you wrote or contributed to.",
    group: "Credentials",
    layout: "normal",
    hasDates: true,
    hasOrganization: false,
    inDefaultResume: false,
    metaFields: [
      { key: "venue", label: "Venue / journal" },
      { key: "doi", label: "DOI / link" },
    ],
  },
  {
    type: "award",
    heading: "AWARDS",
    label: "Awards",
    blurb: "Awards and recognitions from industry, competitions or academia.",
    group: "Credentials",
    layout: "normal",
    hasDates: true,
    hasOrganization: true,
    inDefaultResume: false,
  },
  {
    type: "course",
    heading: "COURSES",
    label: "Courses",
    blurb: "Online or in-person courses and trainings you completed.",
    group: "Credentials",
    layout: "normal",
    hasDates: true,
    hasOrganization: true,
    inDefaultResume: false,
  },
  {
    type: "organization",
    heading: "ORGANIZATIONS",
    label: "Organizations",
    blurb: "Memberships or volunteering with organisations, including your role.",
    group: "Personal",
    layout: "normal",
    hasDates: true,
    hasOrganization: true,
    inDefaultResume: false,
  },
  {
    type: "volunteer",
    heading: "VOLUNTEERING",
    label: "Volunteering",
    blurb: "Community work, service and unpaid contributions.",
    group: "Personal",
    layout: "normal",
    hasDates: true,
    hasOrganization: true,
    inDefaultResume: false,
  },
  {
    type: "language",
    heading: "LANGUAGES",
    label: "Languages",
    blurb: "Languages and proficiency level to show your communication range.",
    group: "Personal",
    layout: "skill",
    hasDates: false,
    hasOrganization: false,
    inDefaultResume: false,
  },
  {
    type: "interest",
    heading: "INTERESTS",
    label: "Interests",
    blurb: "Personal interests that support your career story and cultural fit.",
    group: "Personal",
    layout: "skill",
    hasDates: false,
    hasOrganization: false,
    inDefaultResume: false,
  },
  {
    type: "reference",
    heading: "REFERENCES",
    label: "References",
    blurb: "References from managers or coworkers, including contact details.",
    group: "Personal",
    layout: "normal",
    hasDates: false,
    hasOrganization: true,
    inDefaultResume: false,
  },
  {
    type: "custom",
    heading: "CUSTOM",
    label: "Custom",
    blurb: "A custom section for anything else, or to combine sections cleanly.",
    group: "Personal",
    layout: "normal",
    hasDates: true,
    hasOrganization: true,
    inDefaultResume: false,
  },
];

const bySlug = new Map(SECTION_DEFS.map((d) => [d.type, d]));

export function getSectionDef(type: SectionType): SectionDef {
  const def = bySlug.get(type);
  if (!def) throw new Error(`Unknown section type: ${type}`);
  return def;
}

export const SECTION_GROUPS = ["Career", "Credentials", "Personal"] as const;

export function sectionsInGroup(group: SectionDef["group"]): SectionDef[] {
  return SECTION_DEFS.filter((d) => d.group === group);
}

/**
 * Section order for a new resume. Education first matches the reference resumes
 * in vaultCV/reference — a recent-grad ordering. Reorderable in Customize.
 */
export const DEFAULT_RESUME_SECTIONS: SectionType[] = [
  "education",
  "skill",
  "experience",
  "project",
];
