import Link from "next/link";
import {
  ArrowRight,
  CalendarX,
  CheckCircle2,
  FileText,
  FolderOpen,
  FolderX,
  Layers,
  ListX,
  Pin,
  Sparkles,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";

import { SectionPath } from "@/components/section-path";
import type { SectionWithEntries, VaultBlock } from "@/db/queries";
import { STRENGTH_COLORS, STRENGTH_LABELS } from "@/lib/bullet-strength";
import { cn } from "@/lib/utils";
import type { AttentionItem, AttentionKind, VaultOverview } from "@/lib/vault-overview";

/**
 * The vault's landing view: what's in it, how well it's written, what's
 * unfinished. Server-rendered from data the page already holds; the only
 * interactivity is links, so it ships no client JavaScript of its own.
 */

/** Tallest bar in the strength chart; the h-36 plot leaves room for its label. */
const BAR_MAX_PX = 112;

/** How many flags to show before folding the rest away. */
const ATTENTION_VISIBLE = 6;

const ATTENTION_COPY: Record<AttentionKind, { icon: LucideIcon; tone: string; text: (title: string) => string }> = {
  "no-group": {
    icon: FolderX,
    tone: "bg-amber-50 text-amber-700",
    text: (t) => `${t} isn’t in a group`,
  },
  "no-bullets": {
    icon: ListX,
    tone: "bg-amber-50 text-amber-700",
    text: (t) => `${t} has no bullets yet`,
  },
  "no-skills": {
    icon: ListX,
    tone: "bg-amber-50 text-amber-700",
    text: (t) => `${t} lists no skills`,
  },
  "weak-bullet": {
    icon: TrendingDown,
    tone: "bg-orange-50 text-orange-700",
    text: (t) => `Weak bullet in ${t}`,
  },
  "no-dates": {
    icon: CalendarX,
    tone: "bg-sky-50 text-sky-700",
    text: (t) => `${t} has no dates`,
  },
};

function Stat({ icon: Icon, value, label }: { icon: LucideIcon; value: number; label: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accentSoft text-accent">
        <Icon size={17} />
      </span>
      <div>
        <p className="text-2xl font-semibold leading-none tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted">{label}</p>
      </div>
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const copy = ATTENTION_COPY[item.kind];
  const Icon = copy.icon;
  const isSection = item.entryId === undefined;

  return (
    <li>
      <Link
        href={
          isSection
            ? `/vault?section=${item.sectionId}`
            : `/vault?section=${item.sectionId}&entry=${item.entryId}`
        }
        className="group flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-canvas"
      >
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${copy.tone}`}>
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {copy.text(isSection ? item.sectionHeading : (item.entryTitle ?? ""))}
          </span>
          {item.detail && (
            <span className="mt-0.5 block truncate text-xs text-muted">&ldquo;{item.detail}&rdquo;</span>
          )}
          <span className="mt-0.5 flex text-xs">
            {isSection ? (
              <span className="text-muted">
                Drag it into a group in the sidebar, or rename it to choose one
              </span>
            ) : (
              <SectionPath path={{ group: item.groupName, section: item.sectionHeading }} />
            )}
          </span>
        </span>
        <ArrowRight
          size={14}
          className="mt-1.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100"
        />
      </Link>
    </li>
  );
}

function sectionSummary(s: SectionWithEntries): string {
  if (s.type === "skill") {
    return `${s.entries.length} skill ${s.entries.length === 1 ? "line" : "lines"}`;
  }
  const bullets = s.entries.reduce((n, e) => n + e.bullets.length, 0);
  return `${s.entries.length} ${s.entries.length === 1 ? "entry" : "entries"} · ${bullets} ${bullets === 1 ? "bullet" : "bullets"}`;
}

/**
 * One group and the sections filed in it. Groups lead because they are how
 * the user thinks about their history ("Work Experience"); sections are the
 * finer shelves inside ("SDE Experience", "AI/ML Experience").
 */
function GroupCard({ block }: { block: VaultBlock }) {
  const legacy = block.group === null;
  const entries = block.sections.reduce((n, s) => n + s.entries.length, 0);

  return (
    <div className={cn("card overflow-hidden", legacy && "border-amber-300")}>
      <div
        className={cn(
          "flex items-center gap-3 border-b px-4 py-3",
          legacy ? "border-amber-200 bg-amber-50" : "border-line bg-canvas/50",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            legacy ? "bg-amber-100 text-amber-700" : "bg-accentSoft text-accent",
          )}
        >
          {legacy ? <FolderX size={15} /> : <FolderOpen size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className={cn("truncate font-semibold", legacy && "text-amber-800")}>
            {block.group?.name ?? "Not in a group"}
          </h4>
          <p className={cn("text-xs", legacy ? "text-amber-700" : "text-muted")}>
            {legacy
              ? "Every section needs a group — drag these into one in the sidebar"
              : `${block.sections.length} ${block.sections.length === 1 ? "section" : "sections"} · ${entries} ${entries === 1 ? "entry" : "entries"}`}
          </p>
        </div>
      </div>

      {block.sections.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">
          No sections yet — use the <span className="font-medium">+</span> beside this group in
          the sidebar.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {block.sections.map((s) => (
            <li key={s.id}>
              <Link
                href={`/vault?section=${s.id}`}
                className="group flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-canvas"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium group-hover:text-accent">
                      {s.heading}
                    </span>
                    {s.type === "skill" && (
                      <span className="shrink-0 rounded-full bg-accentSoft px-1.5 text-[10px] font-medium text-accent">
                        Skills
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-muted">{sectionSummary(s)}</span>
                </span>
                <ArrowRight
                  size={14}
                  className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Bullets per strength level. One series over an ordinal scale, so it is plain
 * columns: counts labelled on top, level named underneath, colour matching the
 * strength meter used everywhere else — never the only cue.
 */
function StrengthChart({ counts }: { counts: VaultOverview["strength"] }) {
  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...counts);
  const strong = counts[3] + counts[4];

  return (
    <div className="card p-5">
      <h3 className="font-semibold">Bullet strength</h3>
      <p className="hint mt-0.5">Writing quality only — fit for a job is the tuner&rsquo;s call.</p>

      {total === 0 ? (
        <p className="mt-6 text-sm text-muted">No bullets yet. Add some to see how they score.</p>
      ) : (
        <>
          <div className="mt-5 flex h-36 items-end gap-3 border-b border-line" role="img" aria-label="Bullets by strength">
            {counts.map((n, i) => {
              const label = STRENGTH_LABELS[i + 1];
              return (
                <div
                  key={i}
                  className="group flex h-full flex-1 flex-col items-center justify-end"
                  title={`${n} ${n === 1 ? "bullet" : "bullets"} rated ${label}`}
                >
                  <span className="mb-1 text-xs font-medium tabular-nums">{n}</span>
                  <span
                    className={`w-full max-w-9 rounded-t transition-opacity group-hover:opacity-80 ${STRENGTH_COLORS[i]}`}
                    // Pixels, not a percentage of the column: the count label
                    // shares the column, so a 100% bar would push it off the top.
                    style={{ height: n ? Math.max(4, (n / max) * BAR_MAX_PX) : 0 }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex gap-3">
            {counts.map((_, i) => (
              <span key={i} className="flex-1 text-center text-[11px] text-muted">
                {STRENGTH_LABELS[i + 1]}
              </span>
            ))}
          </div>
          <p className="mt-4 text-sm">
            <span className="font-semibold">{strong}</span> of {total} bullets are Strong or better.
          </p>
        </>
      )}
    </div>
  );
}

export function VaultOverviewView({
  overview,
  blocks,
}: {
  overview: VaultOverview;
  /** Groups in sidebar order, each with its sections; the ungrouped block may be among them. */
  blocks: VaultBlock[];
}) {
  // Real groups in their own order, and the legacy ungrouped block — only if it
  // holds anything — last, where it reads as leftovers rather than a group.
  const groups = blocks.filter((b) => b.group !== null);
  const unfiled = blocks.find((b) => b.group === null && b.sections.length > 0);
  const { totals, attention, skills } = overview;
  const visible = attention.slice(0, ATTENTION_VISIBLE);
  const folded = attention.slice(ATTENTION_VISIBLE);

  return (
    <div className="min-w-0 flex-1 space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Layers} value={totals.entries} label={totals.entries === 1 ? "Entry" : "Entries"} />
        <Stat icon={FileText} value={totals.bullets} label={totals.bullets === 1 ? "Bullet" : "Bullets"} />
        <Stat icon={Pin} value={totals.pinned} label="Pinned" />
        <Stat icon={Sparkles} value={totals.skills} label={totals.skills === 1 ? "Skill" : "Skills"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="card p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="font-semibold">Needs attention</h3>
            {attention.length > 0 && <span className="text-xs text-muted">{attention.length}</span>}
          </div>

          {attention.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 size={28} className="text-emerald-500" />
              <p className="text-sm font-medium">Nothing unfinished</p>
              <p className="hint">
                Every section is in a group, every entry has content and dates, and no bullet scores weak.
              </p>
            </div>
          ) : (
            <>
              <ul className="-mx-2 mt-3 space-y-0.5">
                {visible.map((item, i) => (
                  <AttentionRow key={`${item.kind}-${item.entryId}-${i}`} item={item} />
                ))}
              </ul>
              {folded.length > 0 && (
                <details className="group mt-1">
                  <summary className="cursor-pointer list-none px-0 py-1.5 text-xs font-medium text-accent hover:underline">
                    <span className="group-open:hidden">Show {folded.length} more</span>
                    <span className="hidden group-open:inline">Show fewer</span>
                  </summary>
                  <ul className="-mx-2 space-y-0.5">
                    {folded.map((item, i) => (
                      <AttentionRow key={`${item.kind}-${item.entryId}-f${i}`} item={item} />
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        <StrengthChart counts={overview.strength} />
      </div>

      <div>
        <h3 className="mb-3 font-semibold">Groups</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((b) => (
            <GroupCard key={b.group!.id} block={b} />
          ))}
          {unfiled && <GroupCard block={unfiled} />}
        </div>
      </div>

      {skills.length > 0 && (
        <div className="card p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="font-semibold">Skills</h3>
            <span className="hint">Click one to find where it appears</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <Link
                key={s}
                href={`/vault?q=${encodeURIComponent(s)}`}
                className="rounded-full border border-line bg-canvas px-2.5 py-1 text-sm transition-colors hover:border-accent/40 hover:bg-accentSoft hover:text-accent"
              >
                {s}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
