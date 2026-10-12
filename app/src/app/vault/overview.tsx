import Link from "next/link";
import {
  ArrowRight,
  CalendarX,
  CheckCircle2,
  FileText,
  Layers,
  ListX,
  Pin,
  Sparkles,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";

import type { SectionWithEntries } from "@/db/queries";
import { STRENGTH_COLORS, STRENGTH_LABELS } from "@/lib/bullet-strength";
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
  return (
    <li>
      <Link
        href={`/vault?section=${item.sectionId}&entry=${item.entryId}`}
        className="group flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-canvas"
      >
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${copy.tone}`}>
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{copy.text(item.entryTitle)}</span>
          {item.detail ? (
            <span className="mt-0.5 block truncate text-xs text-muted">&ldquo;{item.detail}&rdquo;</span>
          ) : (
            <span className="mt-0.5 block text-xs text-muted">{item.sectionHeading}</span>
          )}
        </span>
        <ArrowRight
          size={14}
          className="mt-1.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100"
        />
      </Link>
    </li>
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
  sections,
}: {
  overview: VaultOverview;
  sections: SectionWithEntries[];
}) {
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
              <p className="hint">Every entry has content and dates, and no bullet scores weak.</p>
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
        <h3 className="mb-3 font-semibold">Sections</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
          {sections.map((s) => {
            const bullets = s.entries.reduce((n, e) => n + e.bullets.length, 0);
            return (
              <Link
                key={s.id}
                href={`/vault?section=${s.id}`}
                className="card group flex items-center justify-between gap-3 p-4 transition-all hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-lift"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.heading}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {s.type === "skill"
                      ? `${s.entries.length} skill ${s.entries.length === 1 ? "line" : "lines"}`
                      : `${s.entries.length} ${s.entries.length === 1 ? "entry" : "entries"} · ${bullets} ${bullets === 1 ? "bullet" : "bullets"}`}
                  </span>
                </span>
                <ArrowRight size={15} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
              </Link>
            );
          })}
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
