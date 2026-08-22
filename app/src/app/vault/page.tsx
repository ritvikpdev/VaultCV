import Link from "next/link";
import { Pin } from "lucide-react";

import { bootstrap } from "@/db/bootstrap";
import {
  allGroups,
  entryCountsBySection,
  searchVault,
  vaultBlocks,
} from "@/db/queries";

import type { MoveTargetGroup } from "./move-entry-dialog";
import { SectionView } from "./section-view";
import { VaultSidebar, type SidebarBlock } from "./sidebar";

export const dynamic = "force-dynamic";

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; q?: string }>;
}) {
  bootstrap();

  const params = await searchParams;
  const query = params.q?.trim() ?? "";

  const blocks = vaultBlocks();
  const groups = allGroups();
  const counts = entryCountsBySection();

  // The sidebar only draws headings and counts, so entries and their bullets
  // are stripped before crossing to the client. Sending the whole vault to
  // render a nav list is a payload that grows with the vault for no gain.
  const sidebarBlocks: SidebarBlock[] = blocks.map((b) => ({
    group: b.group,
    sections: b.sections.map(({ entries, ...section }) => section),
  }));

  const sections = blocks.flatMap((b) => b.sections);
  const requestedId = Number(params.section);
  const active =
    sections.find((s) => s.id === requestedId) ?? sections[0] ?? null;

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
          Everything you have done, entered once, organised however you like.
          Resumes draw from here.
        </p>
      </div>

      <div className="flex gap-8">
        <VaultSidebar
          blocks={sidebarBlocks}
          counts={counts}
          activeId={active?.id ?? null}
        />

        {query ? (
          <SearchResults query={query} />
        ) : active ? (
          <SectionView section={active} groups={groups} moveTargets={moveTargets} />
        ) : (
          <div className="card flex min-h-64 flex-1 flex-col items-center justify-center border-dashed p-10 text-center">
            <p className="font-medium">Your vault is empty</p>
            <p className="hint mt-1 max-w-md">
              Nothing is predefined — create the sections you actually want, or
              import a resume and the sections it contains will be created for
              you.
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

function SearchResults({ query }: { query: string }) {
  const hits = searchVault(query);
  const bulletHits = hits.reduce((n, h) => n + h.bullets.length, 0);

  return (
    <div className="min-w-0 flex-1 space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Results for &ldquo;{query}&rdquo;</h2>
        <p className="hint mt-0.5">
          {hits.length} {hits.length === 1 ? "entry" : "entries"} · {bulletHits}{" "}
          matching {bulletHits === 1 ? "bullet" : "bullets"}
        </p>
      </div>

      {hits.length === 0 ? (
        <div className="card border-dashed p-8 text-center">
          <p className="font-medium">No matches</p>
          <p className="hint mt-1">
            Search covers bullet text, entry titles, organizations, sub-skills
            and tags.
          </p>
        </div>
      ) : (
        hits.map(({ entry, section, bullets, matchedHeader }) => (
          <div key={entry.id} className="card p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold">
                {entry.title}
                {entry.organization && (
                  <span className="font-normal text-muted">, {entry.organization}</span>
                )}
              </p>
              <Link
                href={`/vault?section=${section.id}`}
                className="shrink-0 text-xs font-medium text-accent hover:underline"
              >
                {section.heading} →
              </Link>
            </div>

            {matchedHeader && bullets.length === 0 && (
              <p className="hint mt-1">
                Matched on the title, organization or sub-skills.
              </p>
            )}

            {bullets.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {bullets.map((b) => (
                  <li key={b.id} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink" />
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
