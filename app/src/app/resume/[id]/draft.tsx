"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Profile, SectionOptions } from "@/db/schema";
import {
  emptyDirty,
  mergeDraft,
  type Dirty,
  type EntryKey,
  type ProfileField,
  type SectionField,
} from "@/lib/draft-merge";
import type { ResolvedBullet, ResolvedEntry, ResolvedResume, ResolvedSection } from "@/lib/resume-model";

import { parseSkillNames } from "@/lib/skill-category";

import {
  removeResumeEntry,
  removeSkillCategory as persistRemoveSkillCategory,
  reorderResumeEntries,
  reorderResumeSections,
  reorderSkillCategories as persistReorderSkillCategories,
  saveSkillCategory,
} from "../actions";
import {
  setEntryVisible as persistEntryVisible,
  setSkillCategoryVisible as persistSkillCategoryVisible,
  syncEntryBullets,
  updateProfileDetails,
  updateResumeEntry,
  updateResumeSection,
  type DescriptionLine,
  type EntryPatch,
  type ProfilePatch,
} from "../editor-actions";

/**
 * The editor's working copy of the resume — the one source the live preview
 * renders from.
 *
 * Why a copy at all: the server is the truth, but a server round trip per
 * keystroke would put the preview a few hundred milliseconds behind the
 * cursor. So every edit lands here first (the preview repaints on the same
 * frame) and is persisted behind it through a serial save queue.
 *
 * Keeping the copy honest:
 *  - Draft-backed saves (fields, visibility, headings, the description) don't
 *    revalidate the page. Their result is already on screen.
 *  - Structural actions (pull from vault, add section, add entry…) still
 *    revalidate, and fresh server data is *merged* in rather than adopted:
 *    whatever was edited here keeps the local value ("dirty"), everything else
 *    — new entries from the vault, a bullet the tuner added — comes from the
 *    server. That is what stops a vault pull from reverting a title you were
 *    typing while it ran.
 *  - Dirty marks are dropped when the save queue is idle and the editor
 *    leaves the Content tab, so a later tuner edit isn't masked by a stale
 *    local value.
 */

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * A thrown action (not an `{ ok: false }` result): offline, a server error,
 * or a dev server whose build no longer matches the page. The message is
 * kept, because "couldn't reach the server" alone hid which one it was.
 */
function describeFailure(err: unknown): string {
  const detail = err instanceof Error && err.message ? err.message : "";
  return detail ? `Couldn't save — ${detail}` : "Couldn't save — check your connection.";
}

/* ------------------------------------------------------------------ */
/* Save queue                                                          */
/* ------------------------------------------------------------------ */

type Result = { ok: true } | { ok: false; error: string };
type Job = () => Promise<Result>;

/**
 * One write at a time, in the order they were made.
 *
 * `schedule(key, job, delay)` debounces by key — typing in a field replaces
 * its pending save rather than queueing one per keystroke. `run(job)` is the
 * same with no delay. Serial rather than parallel so two saves to one row
 * can't land out of order, and so a structural action (which reloads the
 * page) sees every edit made before it.
 */
function useSaveQueue() {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const waiting = useRef(new Map<string, Job>());
  const ready = useRef<Array<{ key: string; job: Job }>>([]);
  const running = useRef(false);
  const idleListeners = useRef(new Set<() => void>());
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const busy = useCallback(
    () => running.current || ready.current.length > 0 || timers.current.size > 0,
    [],
  );

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setState("saving");
    let failed: string | null = null;

    while (ready.current.length > 0) {
      const { job } = ready.current.shift()!;
      try {
        const result = await job();
        if (!result.ok) failed = result.error;
      } catch (err) {
        failed = describeFailure(err);
      }
    }

    running.current = false;
    if (failed) {
      setError(failed);
      setState("error");
    } else {
      setError(null);
      setState("saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1800);
    }
    if (!busy()) for (const fn of idleListeners.current) fn();
  }, [busy]);

  const enqueue = useCallback(
    (key: string, job: Job) => {
      // A newer save for the same key replaces one still waiting its turn.
      ready.current = ready.current.filter((j) => j.key !== key);
      ready.current.push({ key, job });
      void pump();
    },
    [pump],
  );

  const schedule = useCallback(
    (key: string, job: Job, delay = 350) => {
      const t = timers.current.get(key);
      if (t) clearTimeout(t);
      waiting.current.set(key, job);
      setState("saving");
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          const j = waiting.current.get(key);
          waiting.current.delete(key);
          if (j) enqueue(key, j);
        }, delay),
      );
    },
    [enqueue],
  );

  const run = useCallback((job: Job) => enqueue(`run-${Math.random()}`, job), [enqueue]);

  /** Send everything that's waiting on a timer now — Done, tab switch, leaving. */
  const flush = useCallback(() => {
    for (const [key, t] of timers.current) {
      clearTimeout(t);
      const j = waiting.current.get(key);
      if (j) enqueue(key, j);
    }
    timers.current.clear();
    waiting.current.clear();
  }, [enqueue]);

  const onIdle = useCallback((fn: () => void) => {
    idleListeners.current.add(fn);
    return () => {
      idleListeners.current.delete(fn);
    };
  }, []);

  // Don't let a closing tab drop the last keystrokes.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!busy()) return;
      flush();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, flush]);

  return { schedule, run, flush, busy, onIdle, state, error };
}

/* ------------------------------------------------------------------ */
/* The draft                                                           */
/* ------------------------------------------------------------------ */

export type DraftLine = DescriptionLine;

/** A pending delete, undoable until its timer fires. */
type PendingRemoval = { entryId: number; title: string; timer: ReturnType<typeof setTimeout> };

const UNDO_MS = 6000;

export function useResumeDraft(server: ResolvedResume, activeTab: string) {
  const [draft, setDraft] = useState(server);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirty = useRef<Dirty>(emptyDirty());
  const queue = useSaveQueue();
  const { flush, busy, onIdle, schedule, run } = queue;
  const entryPatches = useRef(new Map<number, EntryPatch>());
  const profilePatch = useRef<ProfilePatch>({});
  const [removals, setRemovals] = useState<PendingRemoval[]>([]);
  const removalsRef = useRef(removals);
  removalsRef.current = removals;

  const update = useCallback((fn: (r: ResolvedResume) => ResolvedResume) => {
    setDraft((prev) => {
      const next = fn(prev);
      draftRef.current = next;
      return next;
    });
  }, []);

  // Fresh server data (a structural action, a tab switch) is merged in.
  const serverRef = useRef(server);
  useEffect(() => {
    serverRef.current = server;
    update((prev) => mergeDraft(server, prev, dirty.current));
  }, [server, update]);

  // Leaving Content with nothing in flight: the server has every edit, so the
  // local marks can go and the next server data is taken as is.
  useEffect(() => {
    if (activeTab === "content") return;
    flush();
    const clear = () => {
      dirty.current = emptyDirty();
      update(() => serverRef.current);
    };
    if (!busy()) {
      clear();
      return;
    }
    return onIdle(clear);
  }, [activeTab, flush, busy, onIdle, update]);

  const mapSection = useCallback(
    (sectionId: number, fn: (s: ResolvedSection) => ResolvedSection) =>
      update((r) => ({ ...r, sections: r.sections.map((s) => (s.id === sectionId ? fn(s) : s)) })),
    [update],
  );

  const mapEntry = useCallback(
    (entryId: number, fn: (e: ResolvedEntry) => ResolvedEntry) =>
      update((r) => ({
        ...r,
        sections: r.sections.map((s) =>
          s.entries.some((e) => e.id === entryId)
            ? { ...s, entries: s.entries.map((e) => (e.id === entryId ? fn(e) : e)) }
            : s,
        ),
      })),
    [update],
  );

  const markEntry = (entryId: number, fields: Array<EntryKey | "isVisible">) => {
    const set = dirty.current.entries.get(entryId) ?? new Set();
    for (const f of fields) set.add(f);
    dirty.current.entries.set(entryId, set);
  };

  /**
   * Run an action after every pending save, and get its result. For actions
   * that read what the editor just wrote — save-to-vault copies the entry as
   * the server has it, so the last keystrokes must land first.
   */
  const runAndWait = useCallback(
    <R extends Result>(job: () => Promise<R>) =>
      new Promise<R>((resolve) => {
        flush();
        run(async () => {
          try {
            const r = await job();
            resolve(r);
            return r;
          } catch (err) {
            const r = { ok: false, error: describeFailure(err) } as R;
            resolve(r);
            return r;
          }
        });
      }),
    [flush, run],
  );

  /* ---- entries ---------------------------------------------------- */

  const patchEntry = useCallback(
    (entryId: number, patch: EntryPatch) => {
      mapEntry(entryId, (e) => ({ ...e, ...patch }) as ResolvedEntry);
      markEntry(entryId, Object.keys(patch) as EntryKey[]);

      // Accumulate: three fields typed within the debounce go as one write.
      entryPatches.current.set(entryId, { ...entryPatches.current.get(entryId), ...patch });
      schedule(`entry:${entryId}`, () => {
        const p = entryPatches.current.get(entryId) ?? {};
        entryPatches.current.delete(entryId);
        return updateResumeEntry(entryId, p);
      });
    },
    [mapEntry, schedule, run],
  );

  const setEntryVisible = useCallback(
    (entryId: number, visible: boolean) => {
      mapEntry(entryId, (e) => ({ ...e, isVisible: visible }));
      markEntry(entryId, ["isVisible"]);
      schedule(`visible:${entryId}`, () => persistEntryVisible(entryId, visible), 0);
    },
    [mapEntry, schedule, run],
  );

  /**
   * The description, as the rich-text editor holds it. The preview gets the
   * lines at once; the save goes through the queue and reports the row id for
   * each new line back to the editor via `onIds`.
   */
  const setEntryLines = useCallback(
    (
      entryId: number,
      lines: DraftLine[],
      knownIds: number[],
      onIds: (ids: Record<string, number>) => void,
    ) => {
      mapEntry(entryId, (e) => ({ ...e, bullets: linesToBullets(withKnownIds(lines), e.bullets) }));
      dirty.current.bullets.add(entryId);
      const knownHere = knownByEntry.get(entryId) ?? new Set<number>();
      for (const id of knownIds) knownHere.add(id);
      knownByEntry.set(entryId, knownHere);
      schedule(
        `bullets:${entryId}`,
        async () => {
          // Resolved now, not when scheduled: an earlier sync may have created
          // rows for some of these lines while this one waited its turn.
          const result = await syncEntryBullets(entryId, withKnownIds(lines), [...knownHere]);
          if (result.ok) {
            for (const [key, id] of Object.entries(result.data)) {
              idsByKey.set(key, id);
              knownHere.add(id);
            }
            onIds(result.data);
            // Swap the temporary ids for real ones in the working copy too.
            mapEntry(entryId, (e) => ({
              ...e,
              bullets: e.bullets.map((b) => {
                const key = tempKeyOf(b.id);
                return key && result.data[key] ? { ...b, id: result.data[key]! } : b;
              }),
            }));
          }
          return result;
        },
        400,
      );
    },
    [mapEntry, schedule, run],
  );

  const reorderEntries = useCallback(
    (sectionId: number, ids: number[]) => {
      mapSection(sectionId, (s) => {
        const byId = new Map(s.entries.map((e) => [e.id, e]));
        return { ...s, entries: ids.map((id) => byId.get(id)).filter((e): e is ResolvedEntry => Boolean(e)) };
      });
      dirty.current.entryOrder.add(sectionId);
      run(() => reorderResumeEntries(sectionId, ids));
    },
    [mapSection, schedule, run],
  );

  /** Hide now, delete after the undo window. */
  const removeEntry = useCallback(
    (entryId: number, title: string) => {
      const timer = setTimeout(() => {
        setRemovals((rs) => rs.filter((r) => r.entryId !== entryId));
        run(() => removeResumeEntry(entryId));
      }, UNDO_MS);
      setRemovals((rs) => [...rs, { entryId, title, timer }]);
    },
    [run],
  );

  const undoRemove = useCallback((entryId: number) => {
    const r = removalsRef.current.find((x) => x.entryId === entryId);
    if (r) clearTimeout(r.timer);
    setRemovals((rs) => rs.filter((x) => x.entryId !== entryId));
  }, []);

  /* ---- sections --------------------------------------------------- */

  const patchSection = useCallback(
    (sectionId: number, patch: { heading?: string; icon?: string | null; options?: SectionOptions }) => {
      mapSection(sectionId, (s) => ({ ...s, ...patch }));
      const fields = dirty.current.sections.get(sectionId) ?? new Set<SectionField>();
      for (const f of Object.keys(patch) as SectionField[]) fields.add(f);
      dirty.current.sections.set(sectionId, fields);

      // Read back at send time, so a burst of edits sends the final state.
      schedule(`section:${sectionId}`, () => {
        const s = draftRef.current.sections.find((x) => x.id === sectionId);
        if (!s) return Promise.resolve({ ok: true } as const);
        const send: { heading?: string; icon?: string | null; options?: SectionOptions } = {};
        for (const f of dirty.current.sections.get(sectionId) ?? []) {
          if (f === "heading" && s.heading.trim()) send.heading = s.heading;
          if (f === "icon") send.icon = s.icon;
          if (f === "options") send.options = s.options;
        }
        return updateResumeSection(sectionId, send);
      });
    },
    [mapSection, schedule, run],
  );

  const reorderSections = useCallback(
    (ids: number[]) => {
      update((r) => {
        const byId = new Map(r.sections.map((s) => [s.id, s]));
        return { ...r, sections: ids.map((id) => byId.get(id)).filter((s): s is ResolvedSection => Boolean(s)) };
      });
      dirty.current.sectionOrder = true;
      run(() => reorderResumeSections(draftRef.current.id, ids));
    },
    [update, schedule, run],
  );

  /* ---- skills ----------------------------------------------------- */

  // Per open skill editor: the category name as shown now, and as last saved
  // (what `saveSkillCategory` finds the rows by). "" means not saved yet.
  const skillNames = useRef(new Map<string, { local: string; saved: string }>());
  const skillJobs = useRef(new Map<number, number>());

  /** After a section's skill writes land, take the server's rows (real ids). */
  const settleSkills = useCallback(
    (sectionId: number) => {
      const left = (skillJobs.current.get(sectionId) ?? 1) - 1;
      skillJobs.current.set(sectionId, left);
      if (left > 0) return;
      dirty.current.skills.delete(sectionId);
      // The revalidated tree arrives with the action's response; merge once
      // it has been committed.
      setTimeout(() => update((prev) => mergeDraft(serverRef.current, prev, dirty.current)), 50);
    },
    [update],
  );

  const skillWrite = useCallback(
    (sectionId: number, key: string, job: Job, delay: number) => {
      dirty.current.skills.add(sectionId);
      skillJobs.current.set(sectionId, (skillJobs.current.get(sectionId) ?? 0) + 1);
      schedule(
        key,
        async () => {
          try {
            return await job();
          } finally {
            settleSkills(sectionId);
          }
        },
        delay,
      );
    },
    [schedule, settleSkills],
  );

  /**
   * One skills line as the editor holds it. `editKey` identifies the open
   * editor; `initialCategory` is the line's name when it opened ("" for new).
   */
  const setSkillCategory = useCallback(
    (sectionId: number, editKey: string, initialCategory: string, category: string, skillsText: string) => {
      const names = parseSkillNames(skillsText);
      const track = skillNames.current.get(editKey) ?? { local: initialCategory, saved: initialCategory };
      const previous = track.local;
      track.local = category;
      skillNames.current.set(editKey, track);

      mapSection(sectionId, (s) => ({
        ...s,
        skills: replaceCategory(s.skills, previous || null, category, names),
      }));

      // The server needs a name and at least one skill; until then the edit
      // is shown but not sent.
      if (!category.trim() || names.length === 0) return;
      skillWrite(
        sectionId,
        `skills:${editKey}`,
        async () => {
          const result = await saveSkillCategory(sectionId, {
            category,
            skills: skillsText,
            previousCategory: track.saved || undefined,
          });
          if (result.ok) track.saved = category;
          return result;
        },
        450,
      );
    },
    [mapSection, skillWrite],
  );

  const setSkillCategoryVisible = useCallback(
    (sectionId: number, category: string, visible: boolean) => {
      let rowIds: number[] = [];
      mapSection(sectionId, (s) => {
        rowIds = s.skills.filter((k) => k.category === category && k.id > 0).map((k) => k.id);
        return { ...s, skills: s.skills.map((k) => (k.category === category ? { ...k, isVisible: visible } : k)) };
      });
      skillWrite(sectionId, `skill-visible:${sectionId}:${category}`, () =>
        persistSkillCategoryVisible(sectionId, rowIds, visible), 0);
    },
    [mapSection, skillWrite],
  );

  const reorderSkillCategories = useCallback(
    (sectionId: number, categories: string[]) => {
      mapSection(sectionId, (s) => ({
        ...s,
        skills: categories.flatMap((c) => s.skills.filter((k) => k.category === c)),
      }));
      skillWrite(sectionId, `skill-order:${sectionId}`, () => persistReorderSkillCategories(sectionId, categories), 0);
    },
    [mapSection, skillWrite],
  );

  const removeSkillCategory = useCallback(
    (sectionId: number, category: string) => {
      mapSection(sectionId, (s) => ({ ...s, skills: s.skills.filter((k) => k.category !== category) }));
      skillWrite(sectionId, `skill-remove:${sectionId}:${category}`, () => persistRemoveSkillCategory(sectionId, category), 0);
    },
    [mapSection, skillWrite],
  );

  /* ---- profile ---------------------------------------------------- */

  const patchProfile = useCallback(
    (patch: ProfilePatch) => {
      update((r) => ({ ...r, profile: { ...r.profile, ...patch } as Profile }));
      for (const f of Object.keys(patch) as ProfileField[]) dirty.current.profile.add(f);
      profilePatch.current = { ...profilePatch.current, ...patch };
      schedule("profile", () => {
        const p = profilePatch.current;
        profilePatch.current = {};
        return updateProfileDetails(p);
      });
    },
    [update, schedule, run],
  );

  // What the preview renders: the draft, minus entries waiting out their undo.
  const removedIds = useMemo(() => new Set(removals.map((r) => r.entryId)), [removals]);
  const visible = useMemo<ResolvedResume>(
    () =>
      removedIds.size === 0
        ? draft
        : {
            ...draft,
            sections: draft.sections.map((s) => ({
              ...s,
              entries: s.entries.filter((e) => !removedIds.has(e.id)),
            })),
          },
    [draft, removedIds],
  );

  return {
    resume: visible,
    saveState: queue.state,
    saveError: queue.error,
    flush,
    run,
    runAndWait,
    patchEntry,
    setEntryVisible,
    setEntryLines,
    reorderEntries,
    removeEntry,
    undoRemove,
    removals,
    patchSection,
    reorderSections,
    patchProfile,
    setSkillCategory,
    setSkillCategoryVisible,
    reorderSkillCategories,
    removeSkillCategory,
  };
}

export type ResumeDraft = ReturnType<typeof useResumeDraft>;

/* ------------------------------------------------------------------ */
/* Lines ↔ bullets                                                     */
/* ------------------------------------------------------------------ */

// Lines without a row yet get a negative id derived from their key, stable
// across keystrokes so React keys and the preview don't churn.
const tempIds = new Map<string, number>();
const tempKeys = new Map<number, string>();
let nextTemp = -1;

/**
 * Row ids the server has assigned, by line key — shared by every editor
 * instance. If an entry is closed and reopened while its first save is still
 * in flight, the new editor never receives that save's ids; without this, its
 * next save would see the lines as new and insert them a second time.
 */
const idsByKey = new Map<string, number>();
/** Per entry: every row id an editor has shown, i.e. what a sync may delete. */
const knownByEntry = new Map<number, Set<number>>();

function withKnownIds(lines: DraftLine[]): DraftLine[] {
  return lines.map((l) => (l.id === null && idsByKey.has(l.key) ? { ...l, id: idsByKey.get(l.key)! } : l));
}

/** The row id the server gave a line, if its first save has landed. */
export function idForLine(key: string): number | null {
  return idsByKey.get(key) ?? null;
}

/**
 * The key a bullet's line should carry when an editor opens. A line still
 * waiting for its first save keeps the key it was created with, so the save's
 * result can still find it.
 */
export function lineKeyFor(bulletId: number): string {
  return bulletId < 0 ? (tempKeys.get(bulletId) ?? `b${bulletId}`) : `b${bulletId}`;
}

function tempIdFor(key: string): number {
  let id = tempIds.get(key);
  if (id === undefined) {
    id = nextTemp--;
    tempIds.set(key, id);
    tempKeys.set(id, key);
  }
  return id;
}

function tempKeyOf(id: number): string | null {
  return id < 0 ? (tempKeys.get(id) ?? null) : null;
}

function linesToBullets(lines: DraftLine[], previous: ResolvedBullet[]): ResolvedBullet[] {
  const prev = new Map(previous.map((b) => [b.id, b]));
  return lines.map((l) => {
    const id = l.id ?? tempIdFor(l.key);
    const text = plainOf(l.html);
    return {
      id,
      text,
      html: l.html,
      align: l.align,
      isParagraph: l.isParagraph,
      isVisible: l.isVisible,
      sourceBulletId: prev.get(id)?.sourceBulletId ?? null,
    };
  });
}

let nextSkillTemp = -1_000_000;

/**
 * Replace one category's rows with `names`, in place. Rows whose name
 * survives keep their id (and so their vault link, once saved); new names get
 * a temporary negative id until the server's rows arrive.
 */
function replaceCategory(
  skills: ResolvedSection["skills"],
  previous: string | null,
  category: string,
  names: string[],
): ResolvedSection["skills"] {
  const old = previous === null ? [] : skills.filter((k) => k.category === previous);
  const byName = new Map(old.map((k) => [k.name.toLowerCase(), k]));
  const visible = old[0]?.isVisible ?? true;
  const rows = names.map((name) => ({
    id: byName.get(name.toLowerCase())?.id ?? nextSkillTemp--,
    name,
    category,
    isVisible: visible,
  }));

  const at = previous === null ? -1 : skills.findIndex((k) => k.category === previous);
  const rest = skills.filter((k) => previous === null || k.category !== previous);
  if (at < 0) return [...rest, ...rows];
  const before = skills.slice(0, at).filter((k) => k.category !== previous).length;
  return [...rest.slice(0, before), ...rows, ...rest.slice(before)];
}

function plainOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

const DraftContext = createContext<ResumeDraft | null>(null);

export function DraftProvider({ draft, children }: { draft: ResumeDraft; children: React.ReactNode }) {
  return <DraftContext.Provider value={draft}>{children}</DraftContext.Provider>;
}

export function useDraft(): ResumeDraft {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error("useDraft outside DraftProvider");
  return ctx;
}
