"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

type Result = { ok: true } | { ok: false; error: string };

/**
 * A draft that saves itself.
 *
 * Fields commit on blur, so a quick tab through several of them fires several
 * saves in a row. Each save sends the whole record — that is what the update
 * action takes — so two in flight at once could land out of order and leave
 * the older one as the stored value. Saves are therefore serialised: while one
 * is running, further commits only mark the draft dirty, and when it returns
 * the latest draft is sent once more. Intermediate states are skipped, never
 * reordered.
 *
 * The draft is owned here, not re-read from the server after every save. The
 * panel is keyed on the entry it edits, so a fresh draft comes with a fresh
 * mount; adopting revalidated props mid-edit would clobber a field the user
 * is still typing in.
 */
export function useAutosave<T extends object>(initial: T, save: (value: T) => Promise<Result>) {
  const [draft, setDraft] = useState(initial);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const draftRef = useRef(initial);
  const running = useRef(false);
  const dirty = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;

  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const flush = useCallback(async () => {
    if (running.current) {
      dirty.current = true;
      return;
    }

    running.current = true;
    setState("saving");
    if (idleTimer.current) clearTimeout(idleTimer.current);

    let result: Result = { ok: true };
    do {
      dirty.current = false;
      try {
        result = await saveRef.current(draftRef.current);
      } catch {
        result = { ok: false, error: "Couldn't save — check your connection and try again." };
      }
    } while (dirty.current);

    running.current = false;

    if (result.ok) {
      setError(null);
      setState("saved");
      idleTimer.current = setTimeout(() => setState("idle"), 2000);
    } else {
      setError(result.error);
      setState("error");
    }
  }, []);

  const commit = useCallback(
    (patch: Partial<T>) => {
      const next = { ...draftRef.current, ...patch };
      const changed = (Object.keys(patch) as Array<keyof T>).some(
        (k) => draftRef.current[k] !== next[k],
      );
      if (!changed) return;

      draftRef.current = next;
      setDraft(next);
      void flush();
    },
    [flush],
  );

  return { draft, commit, state, error };
}
