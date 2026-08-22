"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { place, sameOrder, type Order } from "./reorder";

/**
 * Drag-to-reorder, built on pointer events with no dependency.
 *
 * Three decisions worth knowing about:
 *
 * **Live reorder, not a drop indicator.** The list rearranges under the pointer
 * as you drag, so what you see mid-drag is what you get on release. A separate
 * indicator line means maintaining two representations of the same intent.
 *
 * **Optimistic, with the server as the eventual truth.** The new arrangement
 * renders immediately and the action is fired after release. Server state is
 * adopted whenever a drag is not in progress — so a failed write corrects
 * itself on the next revalidate instead of leaving the UI quietly lying.
 *
 * **A movement threshold before anything counts as a drag.** Below it, a
 * press is just a click. Without this every twitchy click on the grip would
 * commit a reorder, and the write is invisible enough that you would not
 * notice until the order was wrong.
 *
 * The hook deliberately does not do auto-scroll. The vault's lists fit on
 * screen; a list long enough to need scrolling during a drag is the point to
 * reach for a real library rather than extend this.
 */

const DRAG_THRESHOLD_PX = 4;

/** Horizontal slack around a container, so a slightly off-target drop still lands. */
const CONTAINER_SLOP_PX = 48;

export type SortableHandleProps = {
  onPointerDown: (e: React.PointerEvent) => void;
  style: { cursor: string; touchAction: string };
};

export function useSortable({
  value,
  onCommit,
  disabled = false,
}: {
  /** The authoritative arrangement from the server. */
  value: Order;
  /** Fired once, on release, only when the arrangement actually changed. */
  onCommit: (next: Order) => void;
  disabled?: boolean;
}) {
  const [order, setOrder] = useState<Order>(value);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  /**
   * The in-flight arrangement, updated synchronously.
   *
   * This cannot be derived from render. `setOrder` is asynchronous, so a drag
   * whose move and release land in the same task — a fast flick, or synthetic
   * input — would reach the release handler with a ref still holding the
   * pre-drag order, conclude nothing had changed, and silently drop the write.
   * The drag looked right on screen and vanished on reload.
   */
  const orderRef = useRef(order);

  const applyOrder = useCallback((next: Order) => {
    orderRef.current = next;
    setOrder(next);
  }, []);

  const activeRef = useRef(false);
  const itemEls = useRef(new Map<number, HTMLElement>());
  const containerEls = useRef(new Map<string, HTMLElement>());

  // Adopt server state, but never mid-drag — that would yank the list out from
  // under the pointer every time an unrelated revalidation lands.
  //
  // Compared as a string because `value` is rebuilt on every parent render;
  // depending on the object identity would re-run this forever.
  const signature = useMemo(() => JSON.stringify(value), [value]);
  useEffect(() => {
    if (!activeRef.current) applyOrder(JSON.parse(signature) as Order);
  }, [applyOrder, signature]);

  const registerItem = useCallback(
    (id: number) => (el: HTMLElement | null) => {
      if (el) itemEls.current.set(id, el);
      else itemEls.current.delete(id);
    },
    [],
  );

  const registerContainer = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) containerEls.current.set(key, el);
      else containerEls.current.delete(key);
    },
    [],
  );

  /**
   * Which container the pointer is over, and where in it the dragged item
   * would land. Measured live rather than cached: the list moves as you drag,
   * so any snapshot of the geometry is stale by the next frame.
   */
  const locate = useCallback(
    (x: number, y: number, fallback: string): { container: string; index: number } => {
      let container: string | null = null;
      let bestArea = Infinity;

      for (const [key, el] of containerEls.current) {
        const r = el.getBoundingClientRect();
        const inside =
          y >= r.top &&
          y <= r.bottom &&
          x >= r.left - CONTAINER_SLOP_PX &&
          x <= r.right + CONTAINER_SLOP_PX;
        // Smallest matching box wins, so a nested container beats its parent.
        if (inside && r.width * r.height < bestArea) {
          container = key;
          bestArea = r.width * r.height;
        }
      }

      const key = container ?? fallback;
      const ids = orderRef.current[key] ?? [];

      let index = ids.length;
      for (let i = 0; i < ids.length; i++) {
        const el = itemEls.current.get(ids[i]!);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          index = i;
          break;
        }
      }

      return { container: key, index };
    },
    [],
  );

  const handleProps = useCallback(
    (id: number, container: string): SortableHandleProps => ({
      style: { cursor: disabled ? "default" : "grab", touchAction: "none" },
      onPointerDown: (e: React.PointerEvent) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();

        const startX = e.clientX;
        const startY = e.clientY;
        let started = false;

        const move = (ev: PointerEvent) => {
          if (!started) {
            const far =
              Math.abs(ev.clientX - startX) > DRAG_THRESHOLD_PX ||
              Math.abs(ev.clientY - startY) > DRAG_THRESHOLD_PX;
            if (!far) return;

            started = true;
            activeRef.current = true;
            setDraggingId(id);
            document.body.style.userSelect = "none";
            document.body.style.cursor = "grabbing";
          }

          const { container: over, index } = locate(ev.clientX, ev.clientY, container);
          const next = place(orderRef.current, id, over, index);
          if (!sameOrder(next, orderRef.current)) applyOrder(next);
        };

        const finish = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
          document.body.style.userSelect = "";
          document.body.style.cursor = "";

          if (!started) return;
          activeRef.current = false;
          setDraggingId(null);

          // A drag that wandered and came back is not a change worth writing.
          if (!sameOrder(orderRef.current, JSON.parse(signature) as Order)) {
            onCommit(orderRef.current);
          }
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
      },
    }),
    [disabled, locate, onCommit, signature],
  );

  // Releasing outside the window fires pointercancel in most browsers but not
  // all; this is the backstop that stops the page being stuck un-selectable.
  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  return { order, draggingId, handleProps, registerItem, registerContainer };
}
