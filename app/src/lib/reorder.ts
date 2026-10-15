/**
 * Pure ordering arithmetic for drag-and-drop.
 *
 * Kept separate from the hook that drives it and the actions that persist it,
 * because this is the only part with edge cases worth testing: the index shift
 * when an item moves down within its own list, and the difference between a
 * move that changes nothing and one that does.
 *
 * An `Order` is every list on screen at once, keyed by container. Sections use
 * the group id (or "none"); entries use the section id; bullets the entry id.
 * Modelling all containers together is what makes dragging between them a
 * single operation rather than a remove paired with an insert that can half-fail.
 */

export type Order = Record<string, number[]>;

/** The container currently holding `id`, or null if no list contains it. */
export function findContainer(order: Order, id: number): string | null {
  for (const [key, ids] of Object.entries(order)) {
    if (ids.includes(id)) return key;
  }
  return null;
}

/**
 * Move `id` to position `index` of `container`, returning a new Order.
 *
 * `index` is interpreted against the list *as currently rendered* — that is,
 * with the dragged item still in it. Callers get this from hit-testing the
 * elements on screen, so any other convention would need them to do the
 * correction themselves, which is exactly the arithmetic that goes wrong.
 *
 * Unknown ids and unknown containers return the input unchanged rather than
 * throwing: a pointer can end up over nothing at all, and that's not an error.
 */
export function place(
  order: Order,
  id: number,
  container: string,
  index: number,
): Order {
  const from = findContainer(order, id);
  if (from === null) return order;

  const next: Order = {};
  for (const [key, ids] of Object.entries(order)) next[key] = [...ids];
  if (!next[container]) next[container] = [];

  const fromIndex = next[from]!.indexOf(id);
  next[from]!.splice(fromIndex, 1);

  // Removing the item first shifts everything after it down one, so an index
  // measured with the item still present is one too high — but only when the
  // item came from this same list and sat before the target.
  let target = index;
  if (from === container && fromIndex < index) target -= 1;
  target = Math.max(0, Math.min(target, next[container]!.length));

  next[container]!.splice(target, 0, id);
  return next;
}

/** The on-screen box of one item, as `getBoundingClientRect` reports it. */
export type Box = { top: number; bottom: number; left: number; right: number };

/**
 * Where a dragged item would land, given the pointer and the items' boxes in
 * their current order.
 *
 * `list` looks only at height: an item counts as "after the pointer" once the
 * pointer is above its midline. That is wrong for anything that wraps — a tile
 * grid, a row of chips — where two items share a height and only the
 * horizontal position separates them. `grid` treats the pointer as reading
 * order: anything on a later row, or on the pointer's row but right of it, is
 * after it. Rows are judged by each box's own vertical span, so uneven tile
 * heights don't confuse it.
 *
 * Returns the index against the list as rendered, the convention `place` takes.
 */
export function dropIndex(
  boxes: Array<Box | null>,
  x: number,
  y: number,
  layout: "list" | "grid" = "list",
): number {
  for (let i = 0; i < boxes.length; i++) {
    const r = boxes[i];
    if (!r) continue;

    if (layout === "list") {
      if (y < r.top + (r.bottom - r.top) / 2) return i;
      continue;
    }

    if (y < r.top) return i;
    if (y <= r.bottom && x < r.left + (r.right - r.left) / 2) return i;
  }
  return boxes.length;
}

/** True when two Orders describe the same arrangement. */
export function sameOrder(a: Order, b: Order): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key] ?? [];
    const right = b[key] ?? [];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return false;
    }
  }
  return true;
}

/**
 * The vault sidebar's top-level blocks, in display order.
 *
 * `null` is the ungrouped block. It has no row of its own to carry an order, so
 * its position is stored as a setting and interleaved here. Ties resolve in the
 * ungrouped block's favour, which is what makes the default of -1 put it first
 * without needing a migration for vaults that predate this feature.
 */
export function orderedBlocks(
  groups: Array<{ id: number; displayOrder: number }>,
  ungroupedOrder: number,
): Array<number | null> {
  const blocks: Array<{ key: number | null; order: number }> = [
    { key: null, order: ungroupedOrder },
    ...groups.map((g) => ({ key: g.id as number | null, order: g.displayOrder })),
  ];

  blocks.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (a.key === null) return -1;
    if (b.key === null) return 1;
    return a.key - b.key;
  });

  return blocks.map((b) => b.key);
}
