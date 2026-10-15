import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUsers } from "drizzle-orm/supabase";

/**
 * vaultCV schema.
 *
 * Three concerns, kept deliberately separate:
 *
 *   1. VAULT   — the canonical record of everything you have ever done.
 *   2. RESUME  — a composition that points at vault content and adds styling.
 *   3. TUNER   — job descriptions and the recommendations derived from them.
 *
 * The seam between (1) and (2) is the `source_*_id` columns. See the note above
 * `resumeBullets` for why they exist even though v1 ships in snapshot mode.
 */

/** Unix seconds, matching what `touch()` in the actions writes. */
const now = sql`extract(epoch from now())::bigint`;
const epoch = (name: string) => bigint(name, { mode: "number" });

/**
 * MULTI-USER ISOLATION
 * --------------------
 * Every table carries `user_id`, defaulting to `auth.uid()` — the signed-in
 * user of the current transaction (see `runAsUser` in client.ts). Inserts never
 * name it, so no action can file a row under the wrong person by mistake.
 *
 * Every table also has the same row-level-security policy: you can see and
 * write only rows whose `user_id` is yours. That is what makes "load the whole
 * table and group in memory", which the queries do throughout, safe: Postgres
 * itself filters to the current user before a row leaves the database.
 *
 * RLS is not optional here. Supabase exposes the public schema over its REST
 * API to anyone holding the publishable key, which ships in the browser. A
 * table without a policy is a table anyone can read.
 *
 * `onDelete: "cascade"` to auth.users means deleting an account (from /admin)
 * deletes everything that person ever stored.
 */
const owner = () =>
  uuid("user_id")
    .notNull()
    .default(sql`auth.uid()`)
    .references(() => authUsers.id, { onDelete: "cascade" });

const ownRows = () =>
  pgPolicy("own_rows", {
    for: "all",
    to: authenticatedRole,
    // `(select auth.uid())` rather than `auth.uid()`: evaluated once per
    // statement instead of once per row — Supabase's documented RLS idiom.
    using: sql`(select auth.uid()) = user_id`,
    withCheck: sql`(select auth.uid()) = user_id`,
  });

/* ------------------------------------------------------------------ */
/* 1. VAULT                                                            */
/* ------------------------------------------------------------------ */

/**
 * One row per user — enforced by the unique index — created on first sign-in by
 * `bootstrap()`. Contact details that head every resume.
 */
export const profile = pgTable(
  "profile",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    fullName: text("full_name").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    location: text("location").notNull().default(""),
    /** JSON: Array<{ label: string; url: string }> — LinkedIn, GitHub, portfolio. */
    links: jsonb("links")
      .$type<Array<{ label: string; url: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Default professional summary. Resumes may override per-application. */
    summary: text("summary").notNull().default(""),
    createdAt: epoch("created_at").notNull().default(now),
    updatedAt: epoch("updated_at").notNull().default(now),
  },
  (t) => [ownRows(), uniqueIndex("idx_profile_user").on(t.userId)],
);

/**
 * User-named groups: the vault's top level ("Work Experience"), each holding
 * sections ("SDE Experience"). Every section belongs to one — enforced by the
 * section actions, not the column, so sections filed before the rule load.
 */
export const vaultGroups = pgTable(
  "vault_groups",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    name: text("name").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: epoch("created_at").notNull().default(now),
  },
  (t) => [ownRows(), index("idx_vault_groups_user").on(t.userId)],
);

/**
 * A vault section, created and named entirely by the user.
 *
 * This replaces the fixed `sectionType` vocabulary the vault used to impose.
 * Predefining "Career / Credentials / Personal" and a closed list of section
 * types decided for the user how their career should be filed; sections are now
 * whatever they say they are, filed in groups they name.
 *
 * `type` is the one structural distinction that remains, because it genuinely
 * changes the shape of an entry:
 *   normal — title, dates, organisation, bullet points
 *   skill  — a label plus a list of sub-skills, rendered as one line
 */
export const vaultSections = pgTable(
  "vault_sections",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    heading: text("heading").notNull(),
    /** normal | skill */
    type: text("type").notNull().default("normal"),
    /** Lucide icon name, or empty for none. */
    icon: text("icon").notNull().default(""),
    groupId: integer("group_id").references(() => vaultGroups.id, {
      onDelete: "set null",
    }),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: epoch("created_at").notNull().default(now),
  },
  (t) => [
    ownRows(),
    index("idx_vault_sections_user").on(t.userId),
    index("idx_vault_sections_group").on(t.groupId, t.displayOrder),
  ],
);

/**
 * Section types for RESUME sections only.
 *
 * The vault no longer uses these — its sections are user-defined. Resumes keep
 * a light vocabulary because the renderer and the tuner still benefit from
 * knowing a section is a skills list rather than a list of jobs.
 */
export const SECTION_TYPES = [
  "summary",
  "experience",
  "education",
  "project",
  "skill",
  "certification",
  "publication",
  "award",
  "course",
  "organization",
  "volunteer",
  "language",
  "interest",
  "reference",
  "custom",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

/**
 * One thing you did: a job, a degree, a project, a paper, a certification.
 * Section-specific extras live in `meta` rather than sprawling nullable columns.
 */
export const vaultEntries = pgTable(
  "vault_entries",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    sectionId: integer("section_id")
      .notNull()
      .references(() => vaultSections.id, { onDelete: "cascade" }),
    /**
     * Job title, degree name, project name — or, in a skill section, the skill
     * label itself ("Languages").
     */
    title: text("title").notNull(),
    /**
     * Skill sections only: the sub-skills list ("Java | C# | Python"). Stored as
     * entered; the derived index in `vault_skills` is what matching reads.
     */
    information: text("information").notNull().default(""),
    /** Skill sections only: beginner | intermediate | advanced | expert. */
    level: text("level").notNull().default(""),
    /** Employer, university, publisher, issuing body. */
    organization: text("organization").notNull().default(""),
    location: text("location").notNull().default(""),
    /** Stored as "MM/YYYY" to match how resumes actually display dates. */
    startDate: text("start_date").notNull().default(""),
    endDate: text("end_date").notNull().default(""),
    isCurrent: boolean("is_current").notNull().default(false),
    url: text("url").notNull().default(""),
    /** Short italic line under the title, e.g. "Distributed LLM inference system built in Go". */
    subtitle: text("subtitle").notNull().default(""),
    /**
     * JSON grab-bag for section-specific fields:
     * education → { gpa }, project → { techStack[] }, certification → { issuer, credentialId },
     * publication → { venue, doi, authors }.
     */
    meta: jsonb("meta")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    displayOrder: integer("display_order").notNull().default(0),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: epoch("created_at").notNull().default(now),
    updatedAt: epoch("updated_at").notNull().default(now),
  },
  (t) => [
    ownRows(),
    index("idx_vault_entries_user").on(t.userId),
    index("idx_vault_entries_section").on(t.sectionId, t.displayOrder),
  ],
);

/**
 * An achievement statement under an entry. The atomic unit the tuner reasons
 * about — everything the matcher scores is a bullet.
 */
export const vaultBullets = pgTable(
  "vault_bullets",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    entryId: integer("entry_id")
      .notNull()
      .references(() => vaultEntries.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    /** JSON string[] — free-form labels used for filtering and match context. */
    tags: jsonb("tags")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * 1–5, computed locally from action verbs, presence of metrics and length.
     * No AI involved — this must work with no API key.
     */
    strength: integer("strength").notNull().default(3),
    /** Pinned bullets are pre-selected when tuning against any JD. */
    isPinned: boolean("is_pinned").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: epoch("created_at").notNull().default(now),
    updatedAt: epoch("updated_at").notNull().default(now),
  },
  (t) => [
    ownRows(),
    index("idx_vault_bullets_user").on(t.userId),
    index("idx_vault_bullets_entry").on(t.entryId, t.displayOrder),
  ],
);

/**
 * DERIVED skill index — not user-editable.
 *
 * You edit skills the way the reference tool does: a section of type `skill`
 * holds entries like "Languages" whose `information` field lists the
 * sub-skills. That's good for writing and useless for matching, because the
 * tuner needs to ask "does this person have Kubernetes?" and get a straight
 * answer rather than searching prose.
 *
 * So every time a skill entry is saved, its sub-skills are split, resolved
 * through the alias taxonomy, and written here. Rows are rebuilt wholesale for
 * the entry — never edited by hand, never surfaced in the UI.
 *
 * `aliases` is what makes deterministic matching work with no API key: a JD
 * saying "k8s" or "container orchestration" still resolves to Kubernetes.
 */
export const vaultSkills = pgTable(
  "vault_skills",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    /** The skill entry this was extracted from. Cascades on delete. */
    sourceEntryId: integer("source_entry_id")
      .notNull()
      .references(() => vaultEntries.id, { onDelete: "cascade" }),
    /** The entry's own label — "Languages", "Frameworks". */
    category: text("category").notNull().default("General"),
    /** Canonical name where the taxonomy recognised it, else as written. */
    name: text("name").notNull(),
    /** JSON string[] of alternate spellings the JD might use. */
    aliases: jsonb("aliases")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    level: text("level").notNull().default(""),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: epoch("created_at").notNull().default(now),
  },
  (t) => [
    ownRows(),
    index("idx_vault_skills_user").on(t.userId),
    // Deliberately NOT unique on name: the same technology may legitimately
    // appear under two entries, and a unique constraint on derived data would
    // make a save fail for a reason the user can't see or fix.
    index("idx_vault_skills_source").on(t.sourceEntryId),
    index("idx_vault_skills_name").on(t.name),
  ],
);

/* ------------------------------------------------------------------ */
/* 2. RESUME                                                           */
/* ------------------------------------------------------------------ */

/**
 * Presentation settings. Split from `resumes` so a style can be reused or reset
 * without touching content, and so the customize tab writes to one small row.
 */
export const resumeStyles = pgTable(
  "resume_styles",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    fontFamily: text("font_family").notNull().default('"Times New Roman", Times, serif'),
    /** Points. Drives --r-base-size. */
    baseSize: doublePrecision("base_size").notNull().default(10),
    /** Points, absolute (not a delta) so the renderer stays dumb. */
    nameSize: doublePrecision("name_size").notNull().default(21),
    headingSize: doublePrecision("heading_size").notNull().default(11),
    lineHeight: doublePrecision("line_height").notNull().default(1.25),
    /** Points of vertical space between sections / entries / bullets. */
    sectionGap: doublePrecision("section_gap").notNull().default(10),
    entryGap: doublePrecision("entry_gap").notNull().default(6),
    bulletGap: doublePrecision("bullet_gap").notNull().default(2),
    /** Inches. */
    marginX: doublePrecision("margin_x").notNull().default(0.5),
    marginY: doublePrecision("margin_y").notNull().default(0.5),
    /** plain | underline | rule | caps */
    headingStyle: text("heading_style").notNull().default("rule"),
    accentColor: text("accent_color").notNull().default("#000000"),
    /** letter | a4 */
    pageSize: text("page_size").notNull().default("letter"),
    /**
     * Where an entry's dates and location sit.
     *   right — same line as the title, right-aligned (the reference resumes)
     *   below — stacked under the title, left-aligned
     */
    datePosition: text("date_position").notNull().default("right"),
    /** How the employer / subtitle line renders: normal | bold | italic */
    subtitleStyle: text("subtitle_style").notNull().default("italic"),
  },
  (t) => [ownRows(), index("idx_resume_styles_user").on(t.userId)],
);

export const resumes = pgTable(
  "resumes",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    name: text("name").notNull().default("Untitled resume"),
    targetRole: text("target_role").notNull().default(""),
    targetCompany: text("target_company").notNull().default(""),
    styleId: integer("style_id")
      .notNull()
      .references(() => resumeStyles.id, { onDelete: "restrict" }),
    /** Per-resume summary override. Empty string falls back to profile.summary. */
    summaryOverride: text("summary_override").notNull().default(""),
    /** draft | exported | sent */
    status: text("status").notNull().default("draft"),
    createdAt: epoch("created_at").notNull().default(now),
    updatedAt: epoch("updated_at").notNull().default(now),
  },
  (t) => [ownRows(), index("idx_resumes_user").on(t.userId)],
);

export const resumeSections = pgTable(
  "resume_sections",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    resumeId: integer("resume_id")
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    sectionType: text("section_type").$type<SectionType>().notNull(),
    /** Editable display heading, e.g. "WORK EXPERIENCE" or a custom label. */
    heading: text("heading").notNull(),
    /** normal | skill — skill sections render inline comma lists, not bullets. */
    layout: text("layout").notNull().default("normal"),
    displayOrder: integer("display_order").notNull().default(0),
    isVisible: boolean("is_visible").notNull().default(true),
    /** Insert a hard page break after this section. */
    pageBreakAfter: boolean("page_break_after").notNull().default(false),
  },
  (t) => [
    ownRows(),
    index("idx_resume_sections_user").on(t.userId),
    index("idx_resume_sections_resume").on(t.resumeId, t.displayOrder),
  ],
);

/**
 * An entry as it appears in one resume.
 *
 * Every override column is nullable on purpose: NULL means "whatever the vault
 * says", a value means "this resume disagrees". In snapshot mode the app writes
 * these eagerly; in linked mode it leaves them NULL until you type.
 */
export const resumeEntries = pgTable(
  "resume_entries",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    sectionId: integer("section_id")
      .notNull()
      .references(() => resumeSections.id, { onDelete: "cascade" }),
    /** NULL for ad-hoc entries typed straight into the resume. */
    sourceEntryId: integer("source_entry_id").references(() => vaultEntries.id, {
      onDelete: "set null",
    }),
    titleOverride: text("title_override"),
    organizationOverride: text("organization_override"),
    subtitleOverride: text("subtitle_override"),
    locationOverride: text("location_override"),
    startDateOverride: text("start_date_override"),
    endDateOverride: text("end_date_override"),
    displayOrder: integer("display_order").notNull().default(0),
    isVisible: boolean("is_visible").notNull().default(true),
  },
  (t) => [
    ownRows(),
    index("idx_resume_entries_user").on(t.userId),
    index("idx_resume_entries_section").on(t.sectionId, t.displayOrder),
    index("idx_resume_entries_source").on(t.sourceEntryId),
  ],
);

/**
 * A bullet as it appears in one resume.
 *
 * THE LINKAGE HOOK
 * ----------------
 * `sourceBulletId` is recorded even though v1 runs in snapshot mode, where
 * `text` is always populated and authoritative. Keeping the pointer costs one
 * integer and buys three things:
 *
 *   - "which resumes use this vault bullet?" becomes a query, not a text search
 *   - the tuner can tell "already in this resume" from "available in vault"
 *   - linked mode later becomes a read-time rule (text IS NULL → read through
 *     to the vault) rather than a schema migration
 *
 * That is the whole cost of deferring the snapshot-vs-linked decision.
 */
export const resumeBullets = pgTable(
  "resume_bullets",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    resumeEntryId: integer("resume_entry_id")
      .notNull()
      .references(() => resumeEntries.id, { onDelete: "cascade" }),
    /** NULL for bullets written directly into this resume. */
    sourceBulletId: integer("source_bullet_id").references(() => vaultBullets.id, {
      onDelete: "set null",
    }),
    /** Snapshot mode: always set. Linked mode: NULL means "read from vault". */
    text: text("text"),
    displayOrder: integer("display_order").notNull().default(0),
    isVisible: boolean("is_visible").notNull().default(true),
  },
  (t) => [
    ownRows(),
    index("idx_resume_bullets_user").on(t.userId),
    index("idx_resume_bullets_entry").on(t.resumeEntryId, t.displayOrder),
    index("idx_resume_bullets_source").on(t.sourceBulletId),
  ],
);

/** Skills chosen for one resume, in display order, grouped by category. */
export const resumeSkills = pgTable(
  "resume_skills",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    sectionId: integer("section_id")
      .notNull()
      .references(() => resumeSections.id, { onDelete: "cascade" }),
    sourceSkillId: integer("source_skill_id").references(() => vaultSkills.id, {
      onDelete: "set null",
    }),
    /** NULL → read the name from the vault. Set → ad-hoc or renamed. */
    nameOverride: text("name_override"),
    categoryOverride: text("category_override"),
    displayOrder: integer("display_order").notNull().default(0),
    isVisible: boolean("is_visible").notNull().default(true),
  },
  (t) => [
    ownRows(),
    index("idx_resume_skills_user").on(t.userId),
    index("idx_resume_skills_section").on(t.sectionId, t.displayOrder),
  ],
);

/* ------------------------------------------------------------------ */
/* 3. TUNER                                                            */
/* ------------------------------------------------------------------ */

export type JdRequirement = {
  id: string;
  text: string;
  kind: "must_have" | "nice_to_have";
  category: "technical" | "domain" | "soft" | "experience";
  /** Normalized terms to match against vault skills and bullet text. */
  terms: string[];
};

export type JdParsed = {
  role: string;
  company: string;
  seniority: string;
  requirements: JdRequirement[];
  keywords: string[];
  /** How much this role cares about each vault section, 0–1. */
  sectionWeights: Partial<Record<SectionType, number>>;
  /** "claude" when the API parsed it, "heuristic" when the fallback did. */
  source: "claude" | "heuristic";
};

export const jobDescriptions = pgTable(
  "job_descriptions",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    rawText: text("raw_text").notNull(),
    parsed: jsonb("parsed").$type<JdParsed | null>(),
    createdAt: epoch("created_at").notNull().default(now),
  },
  (t) => [ownRows(), index("idx_job_descriptions_user").on(t.userId)],
);

export type Recommendation = {
  id: string;
  type: "ADD_BULLET" | "REMOVE_BULLET" | "ADD_ENTRY" | "ADD_SKILL" | "REORDER" | "EDIT_BULLET";
  /** Human-readable statement of the change. */
  label: string;
  /** Why — which requirement ids this addresses. */
  coversRequirementIds: string[];
  /** 0–1 confidence, drives sort order. */
  score: number;
  /** Ids the apply-handler needs, shape depends on `type`. */
  payload: Record<string, unknown>;
  status: "pending" | "applied" | "dismissed";
};

/**
 * One tuning pass of a resume against a JD. Recommendations are stored rather
 * than recomputed so dismissing a suggestion sticks across page reloads.
 */
export const tuneRuns = pgTable(
  "tune_runs",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    resumeId: integer("resume_id")
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    jdId: integer("jd_id")
      .notNull()
      .references(() => jobDescriptions.id, { onDelete: "cascade" }),
    recommendations: jsonb("recommendations")
      .$type<Recommendation[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Fraction of must-have requirements covered at the time of the run, 0–1. */
    coverage: doublePrecision("coverage").notNull().default(0),
    createdAt: epoch("created_at").notNull().default(now),
  },
  (t) => [
    ownRows(),
    index("idx_tune_runs_user").on(t.userId),
    index("idx_tune_runs_resume").on(t.resumeId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* 4. APP SETTINGS                                                     */
/* ------------------------------------------------------------------ */

/**
 * Key/value settings that belong in the DB rather than localStorage, because
 * server code reads them too (e.g. vaultLinkMode during resume render).
 */
export const settings = pgTable(
  "settings",
  {
    userId: owner(),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  // Keys are per user, so the key alone can't be the primary key.
  (t) => [ownRows(), primaryKey({ columns: [t.userId, t.key] })],
);

/* ------------------------------------------------------------------ */
/* Inferred types                                                      */
/* ------------------------------------------------------------------ */

export type Profile = typeof profile.$inferSelect;
export type VaultGroup = typeof vaultGroups.$inferSelect;
export type VaultSection = typeof vaultSections.$inferSelect;
export type VaultEntry = typeof vaultEntries.$inferSelect;
export type VaultBullet = typeof vaultBullets.$inferSelect;
export type VaultSkill = typeof vaultSkills.$inferSelect;
export type Resume = typeof resumes.$inferSelect;
export type ResumeStyle = typeof resumeStyles.$inferSelect;
export type ResumeSection = typeof resumeSections.$inferSelect;
export type ResumeEntry = typeof resumeEntries.$inferSelect;
export type ResumeBullet = typeof resumeBullets.$inferSelect;
export type ResumeSkill = typeof resumeSkills.$inferSelect;
export type JobDescription = typeof jobDescriptions.$inferSelect;
export type TuneRun = typeof tuneRuns.$inferSelect;

export type NewVaultEntry = typeof vaultEntries.$inferInsert;
export type NewVaultBullet = typeof vaultBullets.$inferInsert;
export type NewVaultSkill = typeof vaultSkills.$inferInsert;
