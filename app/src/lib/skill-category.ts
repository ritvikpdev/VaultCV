/**
 * Reconciling a hand-edited skills category against the rows that back it.
 *
 * A category on a resume is not a stored thing. `resume_skills` holds one row
 * per skill, each carrying a category string, and the renderer collapses rows
 * that share one into a line: "AI & LLM — Claude | Cursor | …". Editing a
 * category therefore means editing a *set of rows*, which is where this comes in.
 *
 * The naive save is "delete the group, insert the new list". That works and is
 * wrong: rows pulled from the vault carry `source_skill_id`, which linked mode
 * reads through and the tuner uses to tell "already on this resume" from
 * "available in the vault". Blanket reinsertion severs every one of those
 * pointers, silently, on an edit as harmless as fixing a typo in the label.
 *
 * So the save diffs by name instead. A row whose name survives keeps its
 * identity and its vault pointer; only genuinely new names are inserted and
 * genuinely removed ones deleted.
 */

/** Separators people actually type between skills. Mirrors the vault's parser. */
const SPLIT_RE = /[,|•·;\n]+|\s+\/\s+/;

/**
 * Turn the free-text skills box into a clean, ordered, de-duplicated list.
 *
 * Order is the user's, not sorted — a skills line reads as a deliberate
 * sequence, and alphabetising it would quietly rewrite their emphasis.
 */
export function parseSkillNames(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of (input ?? "").split(SPLIT_RE)) {
    const name = raw.trim().replace(/^[-–—*]\s*/, "");
    // One character is never a skill; past 60 the line wasn't really a list.
    if (name.length < 2 || name.length > 60) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }

  return out;
}

/** A row as it exists now: its id and the name it currently resolves to. */
export type ExistingSkillRow = { id: number; name: string };

export type SkillPlan = {
  /** Rows to keep, in their new order. `name` is set only when it changed. */
  keep: Array<{ id: number; order: number; name: string | null }>;
  /** Names with no row to reuse. */
  insert: Array<{ name: string; order: number }>;
  /** Rows whose name is gone from the list. */
  remove: number[];
};

/**
 * Work out the minimal set of writes to make `rows` read as `names`.
 *
 * Matching is case-insensitive so that correcting "cursor" to "Cursor" is a
 * rename of the existing row rather than a delete plus an insert — which would
 * cost the row its vault pointer for a change of one letter. When the name did
 * change, `name` carries the new spelling so the caller can write it as an
 * override; when it did not, `name` is null and the caller leaves it alone.
 *
 * A row can only be claimed once, so a list containing the same skill twice
 * still reduces to one row — `parseSkillNames` already de-duplicates, but this
 * holds even when called with a list that did not come through it.
 */
export function planSkillRows(
  rows: ExistingSkillRow[],
  names: string[],
): SkillPlan {
  const available = new Map<string, number[]>();
  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    const list = available.get(key);
    if (list) list.push(row.id);
    else available.set(key, [row.id]);
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const claimed = new Set<number>();
  const plan: SkillPlan = { keep: [], insert: [], remove: [] };

  names.forEach((name, order) => {
    const key = name.trim().toLowerCase();
    const candidates = available.get(key);
    const id = candidates?.shift();

    if (id === undefined) {
      plan.insert.push({ name, order });
      return;
    }

    claimed.add(id);
    const previous = byId.get(id)!.name;
    plan.keep.push({ id, order, name: previous === name ? null : name });
  });

  for (const row of rows) {
    if (!claimed.has(row.id)) plan.remove.push(row.id);
  }

  return plan;
}
