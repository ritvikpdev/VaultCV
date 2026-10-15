import "server-only";

import { desc } from "drizzle-orm";

import { db, first } from "./client";
import { vaultGroups } from "./schema";

/**
 * The group named `name` (case-insensitive), created if there is none.
 *
 * Every section belongs to a group, so the paths that create sections without
 * asking — import, "save to vault" from a resume, the tuner's skill filing —
 * need somewhere to put them. They file a new section under a group of the
 * same name: importing "Work Experience" yields the group "Work Experience"
 * holding the section "Work Experience", and the user can add "SDE Experience"
 * beside it or regroup by dragging in the sidebar.
 *
 * Must run inside a vault scope, like every other query.
 */
export async function ensureGroupNamed(name: string): Promise<number> {
  const label = name.trim().slice(0, 60) || "General";
  const target = label.toLowerCase();

  const existing = (await db.select().from(vaultGroups)).find(
    (g) => g.name.trim().toLowerCase() === target,
  );
  if (existing) return existing.id;

  const last = await first(
    db
      .select({ o: vaultGroups.displayOrder })
      .from(vaultGroups)
      .orderBy(desc(vaultGroups.displayOrder)),
  );

  return (await first(
    db
      .insert(vaultGroups)
      .values({ name: label, displayOrder: (last?.o ?? -1) + 1 })
      .returning({ id: vaultGroups.id }),
  ))!.id;
}
