"use client";

import { useState, useTransition } from "react";
import { Link2, Scissors } from "lucide-react";

import { cn } from "@/lib/utils";

import { saveVaultLinkMode } from "./actions";

/**
 * Snapshot vs linked.
 *
 * The decision this app deferred from day one. Both modes have always shared
 * one schema — `resume_bullets` carries `source_bullet_id` plus a nullable
 * `text` — so switching is a settings write, not a migration, and nothing
 * already on a resume changes when you flip it.
 *
 * What the switch affects is bullets pulled *after* it. That's deliberate:
 * silently rewriting existing resumes to match a new mode would be a
 * destructive edit disguised as a preference.
 */
const MODES = [
  {
    value: "snapshot" as const,
    icon: Scissors,
    title: "Snapshot",
    blurb: "Pulling from the vault copies the text. The resume is frozen.",
    good: "A resume you sent in March still says what you sent.",
    bad: "Fixing a typo means fixing it in every resume that used it.",
  },
  {
    value: "linked" as const,
    icon: Link2,
    title: "Linked",
    blurb: "Resume bullets read through to the vault until you edit them.",
    good: "Fix a bullet once and every resume using it updates.",
    bad: "An old resume's wording can change under you after you've sent it.",
  },
];

export function LinkModeSwitch({ mode }: { mode: "snapshot" | "linked" }) {
  const [current, setCurrent] = useState(mode);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: "snapshot" | "linked") {
    if (next === current) return;
    setError(null);
    setCurrent(next);

    startTransition(async () => {
      const result = await saveVaultLinkMode(next);
      if (!result.ok) {
        setCurrent(mode);
        setError(result.error);
      }
    });
  }

  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold">Vault link mode</h2>
      <p className="hint mt-1">
        How resume content relates to the vault it came from. Affects bullets
        pulled from now on — nothing already on a resume changes.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = current === m.value;

          return (
            <button
              key={m.value}
              onClick={() => choose(m.value)}
              disabled={pending}
              className={cn(
                "rounded-lg border p-4 text-left transition-colors",
                active ? "border-accent bg-accentSoft" : "border-line hover:border-muted",
              )}
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                <Icon size={14} />
                {m.title}
                {active && <span className="text-xs font-normal text-accent">· active</span>}
              </p>
              <p className="hint mt-1.5">{m.blurb}</p>
              <p className="mt-2 text-xs text-emerald-700">+ {m.good}</p>
              <p className="mt-0.5 text-xs text-amber-700">− {m.bad}</p>
            </button>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <p className="hint mt-4">
        No wrong answer. Snapshot suits sending a lot of tailored resumes;
        linked suits keeping one master that you keep improving.
      </p>
    </section>
  );
}
