/**
 * Drag-and-drop ordering arithmetic.
 *
 * The interesting case is moving an item *down* within its own list. The target
 * index is measured against the list as rendered — with the item still in it —
 * so removing the item first invalidates that index by one. Getting this wrong
 * produces the classic off-by-one where dropping an item one slot down appears
 * to do nothing at all, which is indistinguishable from a broken drag.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { findContainer, orderedBlocks, place, sameOrder } from "../src/lib/reorder.ts";

describe("moving within one list", () => {
  const order = { a: [1, 2, 3, 4] };

  test("an item moves down to the index it was dropped on", () => {
    // 1 dropped where 3 sits: the result must read 2, 3, 1, 4 — not 2, 1, 3, 4.
    assert.deepEqual(place(order, 1, "a", 2).a, [2, 1, 3, 4]);
    assert.deepEqual(place(order, 1, "a", 3).a, [2, 3, 1, 4]);
  });

  test("an item moves up without any index correction", () => {
    assert.deepEqual(place(order, 4, "a", 0).a, [4, 1, 2, 3]);
    assert.deepEqual(place(order, 3, "a", 1).a, [1, 3, 2, 4]);
  });

  test("dropping an item back on itself changes nothing", () => {
    assert.ok(sameOrder(place(order, 2, "a", 1), order));
  });

  test("an index past the end lands last rather than throwing", () => {
    assert.deepEqual(place(order, 1, "a", 99).a, [2, 3, 4, 1]);
  });
});

describe("moving between lists", () => {
  const order = { a: [1, 2], b: [3, 4] };

  test("the item leaves one list and joins the other at the drop index", () => {
    const next = place(order, 1, "b", 1);
    assert.deepEqual(next.a, [2]);
    assert.deepEqual(next.b, [3, 1, 4]);
  });

  test("no index correction applies across lists", () => {
    // Coming from another list, nothing shifted, so index 0 means first.
    const next = place(order, 4, "a", 0);
    assert.deepEqual(next.a, [4, 1, 2]);
    assert.deepEqual(next.b, [3]);
  });

  test("a list can be emptied completely", () => {
    let next = place(order, 3, "a", 2);
    next = place(next, 4, "a", 3);
    assert.deepEqual(next.a, [1, 2, 3, 4]);
    assert.deepEqual(next.b, []);
  });

  test("an empty list can receive the first item", () => {
    const next = place({ a: [1, 2], b: [] }, 1, "b", 0);
    assert.deepEqual(next.b, [1]);
  });

  test("dropping into a container that does not exist yet creates it", () => {
    const next = place({ a: [1] }, 1, "fresh", 0);
    assert.deepEqual(next.fresh, [1]);
    assert.deepEqual(next.a, []);
  });

  test("the input is never mutated", () => {
    const original = { a: [1, 2], b: [3] };
    place(original, 1, "b", 0);
    assert.deepEqual(original, { a: [1, 2], b: [3] });
  });
});

describe("ids that aren't there", () => {
  test("an unknown id is a no-op, not a throw", () => {
    const order = { a: [1, 2] };
    assert.ok(sameOrder(place(order, 99, "a", 0), order));
  });

  test("findContainer reports null rather than guessing", () => {
    assert.equal(findContainer({ a: [1] }, 99), null);
    assert.equal(findContainer({ a: [1] }, 1), "a");
  });
});

describe("comparing arrangements", () => {
  test("order matters", () => {
    assert.ok(sameOrder({ a: [1, 2] }, { a: [1, 2] }));
    assert.ok(!sameOrder({ a: [1, 2] }, { a: [2, 1] }));
  });

  test("a missing key and an empty list are the same arrangement", () => {
    // The hook drops keys for containers that vanish; that isn't a change the
    // user made, and committing it would write a pointless reorder.
    assert.ok(sameOrder({ a: [1], b: [] }, { a: [1] }));
  });

  test("differing contents are caught", () => {
    assert.ok(!sameOrder({ a: [1], b: [2] }, { a: [1], b: [3] }));
  });
});

describe("sidebar block order", () => {
  const groups = [
    { id: 7, displayOrder: 0 },
    { id: 9, displayOrder: 1 },
  ];

  test("ungrouped leads by default, which is what vaults already look like", () => {
    // -1 is the default the setting ships with, so an existing vault keeps its
    // current appearance without a migration.
    assert.deepEqual(orderedBlocks(groups, -1), [null, 7, 9]);
  });

  test("ungrouped can sit between two groups", () => {
    assert.deepEqual(
      orderedBlocks(
        [
          { id: 7, displayOrder: 0 },
          { id: 9, displayOrder: 2 },
        ],
        1,
      ),
      [7, null, 9],
    );
  });

  test("ungrouped can sit last", () => {
    assert.deepEqual(orderedBlocks(groups, 5), [7, 9, null]);
  });

  test("a tie puts ungrouped first, so a fresh group never displaces it", () => {
    assert.deepEqual(orderedBlocks([{ id: 3, displayOrder: 0 }], 0), [null, 3]);
  });

  test("with no groups at all only the ungrouped block remains", () => {
    assert.deepEqual(orderedBlocks([], -1), [null]);
  });
});
