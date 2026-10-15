import Link from "next/link";
import { ArrowRight, Pin } from "lucide-react";

import {
  allGroups,
  entryCountsBySection,
  searchVault,
  vaultBlocks,
  type SearchHit,
} from "@/db/queries";
import { SectionPath } from "@/components/section-path";
import { getSetting, SETTING_KEYS } from "@/db/bootstrap";
import { withVault } from "@/db/session";
import { STRENGTH_COLORS } from "@/lib/bullet-strength";
import { cn } from "@/lib/utils";
import { summarizeVault } from "@/lib/vault-overview";

import type { MoveTargetGroup } from "./move-entry-dialog";
import { VaultOverviewView } from "./overview";
import { SectionView } from "./section-view";
import { VaultSidebar, type SidebarBlock } from "./sidebar";

export const dynamic = "force-dynamic";

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; q?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";

  const { blocks, groups, counts, hits, clearedRaw } = await withVault(async () => ({
    blocks: await vaultBlocks(),
    groups: await allGroups(),
    counts: await entryCountsBySection(),
    // Loaded here rather than inside <SearchResults>: a child component renders
    // after this function returns, outside the vault scope.
    hits: query ? await searchVault(query) : [],
    clearedRaw: await getSetting(SETTING_KEYS.dismissedAttention),
  }));

  // Reminders the user cleared on the overview. A bad value means none.
  let cleared = new Set<string>();
  try {
    const parsed = JSON.parse(clearedRaw ?? "[]");
    if (Array.isArray(parsed)) cleared = new Set(parsed.filter((k): k is string => typeof k === "string"));
  } catch {
    cleared = new Set();
  }

  // The sidebar only draws headings and counts, so entries and their bullets
  // are stripped before crossing to the client. Sending the whole vault to
  // render a nav list is a payload that grows with the vault for no gain.
  const sidebarBlocks: SidebarBlock[] = blocks.map((b) => ({
    group: b.group,
    sections: b.sections.map(({ entries, ...section }) => section),
  }));

  const sections = blocks.flatMap((b) => b.sections);
  const requestedId = Number(params.section);
  // No section asked for (or one that no longer exists) means the overview,
  // not the first section — the overview is the vault's front page now.
  const active = sections.find((s) => s.id === requestedId) ?? null;

  // Where an entry in the open section may be moved: same kind only, itself
  // excluded, grouped the way the sidebar files them. Built here because the
  // page is the only place that already holds every block. Groups that end up
  // with no candidate are dropped rather than rendered empty.
  const moveTargets: MoveTargetGroup[] = active
    ? blocks
        .map((b) => ({
          groupName: b.group?.name ?? null,
          sections: b.sections
            .filter((s) => s.type === active.type && s.id !== active.id)
            .map(({ entries, ...section }) => section),
        }))
        .filter((g) => g.sections.length > 0)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Vault</h1>
        <p className="hint mt-1">
          Everything you have done, entered once, organised however you like. Resumes draw from
          here.
        </p>
      </div>

      <div className="flex gap-8">
        <VaultSidebar
          blocks={sidebarBlocks}
          counts={counts}
          activeId={active?.id ?? null}
          overviewActive={!query && !active && sections.length > 0}
        />

        {query ? (
          <SearchResults
            query={query}
            hits={hits}
            groupNames={Object.fromEntries(groups.map((g) => [g.id, g.name]))}
          />
        ) : active ? (
          // Keyed so per-section UI state (an open "add" tile) doesn't follow
          // you into the next section.
          <SectionView key={active.id} section={active} groups={groups} moveTargets={moveTargets} />
        ) : sections.length > 0 ? (
          <VaultOverviewView
            overview={summarizeVault(
              blocks.flatMap((b) =>
                b.sections.map((s) => ({ ...s, groupName: b.group?.name ?? null })),
              ),
              cleared,
            )}
            blocks={blocks}
          />
        ) : (
          <div className="card flex min-h-64 flex-1 flex-col items-center justify-center border-dashed p-10 text-center">
            <p className="font-medium">Your vault is empty</p>
            <p className="hint mt-1 max-w-md">
              Nothing is predefined — create the sections you actually want, or import a resume and
              the sections it contains will be created for you.
            </p>
            <Link href="/vault/import" className="btn-accent mt-5">
              Import a resume
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function SearchResults({
  query,
  hits,
  groupNames,
}: {
  query: string;
  hits: SearchHit[];
  groupNames: Record<number, string>;
}) {
  const bulletHits = hits.reduce((n, h) => n + h.bullets.length, 0);

  return (
    <div className="min-w-0 flex-1 space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Results for &ldquo;{query}&rdquo;</h2>
        <p className="hint mt-0.5">
          {hits.length} {hits.length === 1 ? "entry" : "entries"} · {bulletHits} matching{" "}
          {bulletHits === 1 ? "bullet" : "bullets"}
        </p>
      </div>

      {hits.length === 0 ? (
        <div className="card border-dashed p-8 text-center">
          <p className="font-medium">No matches</p>
          <p className="hint mt-1">
            Search covers bullet text, entry titles, organizations, sub-skills and tags.
          </p>
        </div>
      ) : (
        hits.map(({ entry, section, bullets, matchedHeader }) => (
          <div key={entry.id} className="card p-5">
            <div className="flex items-baseline justify-between gap-3">
              <Link
                href={`/vault?section=${section.id}&entry=${entry.id}`}
                className="group min-w-0 font-semibold hover:text-accent"
              >
                {entry.title}
                {entry.organization && (
                  <span className="font-normal text-muted">, {entry.organization}</span>
                )}
                <ArrowRight
                  size={13}
                  className="ml-1 inline opacity-0 transition-opacity group-hover:opacity-100"
                />
              </Link>
              <Link
                href={`/vault?section=${section.id}`}
                className="flex min-w-0 shrink-0 rounded-full bg-canvas px-2 py-0.5 text-xs hover:bg-accentSoft"
              >
                <SectionPath
                  path={{
                    group: section.groupId === null ? null : (groupNames[section.groupId] ?? null),
                    section: section.heading,
                  }}
                />
              </Link>
            </div>

            {matchedHeader && bullets.length === 0 && (
              <p className="hint mt-1">Matched on the title, organization or sub-skills.</p>
            )}

            {bullets.length > 0 && (
              <ul className="mt-3 space-y-2">
                {bullets.map((b) => (
                  <li
                    key={b.id}
                    className="relative flex items-start gap-2 overflow-hidden rounded-lg border border-line py-2 pl-3.5 pr-2 text-sm"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-y-0 left-0 w-1",
                        STRENGTH_COLORS[Math.max(1, Math.min(5, b.strength)) - 1],
                      )}
                    />
                    <span className="flex-1 leading-relaxed">{b.text}</span>
                    {b.isPinned && (
                      <Pin size={12} className="mt-1 shrink-0 text-accent" fill="currentColor" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}
    </div>
  );
}
