"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, Search } from "lucide-react";

import { StrengthMeter } from "@/components/ui";
import { scoreBullet, STRENGTH_LABELS } from "@/lib/bullet-strength";

import {
  addManualBullet,
  addVaultBulletToEntry,
  bulletOptionsForEntry,
  saveBulletToVault,
} from "../manual-actions";

type Options = Awaited<ReturnType<typeof bulletOptionsForEntry>>;

/**
 * Add a bullet to an entry already on the resume.
 *
 * Typing is the primary action and the vault is a drawer beneath it, because
 * writing a fresh bullet for a specific job is the more common motion — the
 * vault matters when you're reaching for something you've already written.
 *
 * Opening the drawer shows this entry's own unused bullets first, since
 * "add another Accenture bullet" almost always means another Accenture bullet.
 */
export function AddBullet({
  resumeEntryId,
  entryLabel,
}: {
  resumeEntryId: number;
  entryLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [vaultOpen, setVaultOpen] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savePrompt, setSavePrompt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function loadOptions(q = "") {
    startTransition(async () => {
      setOptions(await bulletOptionsForEntry(resumeEntryId, q));
    });
  }

  function toggleVault() {
    const next = !vaultOpen;
    setVaultOpen(next);
    if (next && !options) loadOptions();
  }

  function submitManual() {
    setError(null);
    startTransition(async () => {
      const result = await addManualBullet(resumeEntryId, text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setText("");
      // Only offer the vault when it would actually add something new.
      if (result.data.canSaveToVault) setSavePrompt(result.data.bulletId);
      else setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        className="mt-2 flex items-center gap-1.5 text-xs text-muted hover:text-accent"
        onClick={() => setOpen(true)}
      >
        <Plus size={12} /> Add a bullet
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-line bg-canvas p-3">
      {savePrompt !== null ? (
        <div>
          <p className="text-sm font-medium">Bullet added to this resume.</p>
          <p className="hint mt-1">
            Also save it to your vault under {entryLabel}, so you can reuse it on
            other resumes?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              className="btn-accent px-3 py-1 text-xs"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await saveBulletToVault(savePrompt);
                  setSavePrompt(null);
                  setOpen(false);
                })
              }
            >
              Yes, save to vault
            </button>
            <button
              className="btn-ghost px-3 py-1 text-xs"
              onClick={() => {
                setSavePrompt(null);
                setOpen(false);
              }}
            >
              No, this resume only
            </button>
          </div>
        </div>
      ) : (
        <>
          <textarea
            className="field min-h-16 resize-y bg-surface text-sm"
            placeholder="Write a new bullet…"
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setText("");
                setOpen(false);
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitManual();
            }}
          />

          {text.trim() && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
              <StrengthMeter score={scoreBullet(text).score} />
              {STRENGTH_LABELS[scoreBullet(text).score]}
            </p>
          )}

          {error && <p className="mt-1.5 text-xs text-red-700">{error}</p>}

          <div className="mt-2 flex gap-2">
            <button
              className="btn-accent px-3 py-1 text-xs"
              disabled={pending || !text.trim()}
              onClick={submitManual}
            >
              Add bullet
            </button>
            <button
              className="btn-ghost px-3 py-1 text-xs"
              onClick={() => {
                setText("");
                setOpen(false);
              }}
            >
              Cancel
            </button>
          </div>

          <button
            className="mt-3 flex w-full items-center gap-1.5 border-t border-line pt-2 text-xs text-muted hover:text-accent"
            onClick={toggleVault}
          >
            {vaultOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Or pull one from your vault
          </button>

          {vaultOpen && (
            <div className="mt-2">
              {pending && !options ? (
                <p className="hint flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> Loading…
                </p>
              ) : options?.ok ? (
                <>
                  {options.data.sameEntry.length > 0 && (
                    <>
                      <p className="hint mb-1">From {entryLabel}</p>
                      <ul className="space-y-1">
                        {options.data.sameEntry.map((b) => (
                          <VaultBulletRow
                            key={b.id}
                            bullet={b}
                            onAdd={() =>
                              startTransition(async () => {
                                await addVaultBulletToEntry(resumeEntryId, b.id);
                                loadOptions(query);
                              })
                            }
                          />
                        ))}
                      </ul>
                    </>
                  )}

                  <div className="relative mt-3">
                    <Search
                      size={12}
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                      className="field bg-surface pl-7 text-xs"
                      placeholder="Search the rest of your vault…"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        loadOptions(e.target.value);
                      }}
                    />
                  </div>

                  {options.data.others.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {options.data.others.map((b) => (
                        <VaultBulletRow
                          key={b.id}
                          bullet={b}
                          from={b.from}
                          onAdd={() =>
                            startTransition(async () => {
                              await addVaultBulletToEntry(resumeEntryId, b.id);
                              loadOptions(query);
                            })
                          }
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="hint mt-2">
                      {query ? "No matches." : "Nothing else unused in your vault."}
                    </p>
                  )}
                </>
              ) : (
                <p className="hint">Could not load your vault.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VaultBulletRow({
  bullet,
  from,
  onAdd,
}: {
  bullet: { id: number; text: string; strength: number };
  from?: string;
  onAdd: () => void;
}) {
  return (
    <li className="group flex items-start gap-2 rounded bg-surface p-2">
      <span className="mt-0.5 shrink-0">
        <StrengthMeter score={bullet.strength} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-snug">{bullet.text}</p>
        {from && <p className="hint mt-0.5">{from}</p>}
      </div>
      <button
        className="shrink-0 rounded p-1 text-muted hover:bg-canvas hover:text-accent"
        title="Add to this entry"
        onClick={onAdd}
      >
        <Plus size={12} />
      </button>
    </li>
  );
}
