"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";

import { findAliasSeed } from "@/lib/skill-aliases";
import { joinSkillTokens, splitSkillTokens } from "@/lib/skill-index";
import { useSortable } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";

/**
 * A skill entry's sub-skills, as chips.
 *
 * Storage is unchanged: the chips are `information` split on the same
 * separators the matcher uses, and written back joined with " | ". Chips hold
 * the text as typed — "k8s" stays "k8s" — and only *show* what the alias table
 * resolves it to, so the vault records what the user wrote and the derived
 * index (rebuilt on save) does the canonicalising, as it always has.
 *
 * Chips reorder by dragging their label. They wrap, so the sortable runs in
 * grid mode; a list hit-test can't tell two chips on one line apart.
 */
export function SkillChips({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const tokens = useMemo(() => splitSkillTokens(value), [value]);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  // Ids are positions. The order resets whenever `value` changes, which is
  // after every edit, so a position never outlives the list it indexes.
  const order = useMemo(() => ({ chips: tokens.map((_, i) => i) }), [tokens]);
  const sort = useSortable({
    value: order,
    layout: "grid",
    onCommit: (next) => onChange(joinSkillTokens((next.chips ?? []).map((i) => tokens[i]!))),
  });

  function add(raw: string) {
    const incoming = splitSkillTokens(raw);
    if (incoming.length === 0) return;

    const have = new Set(tokens.map((t) => t.toLowerCase()));
    const fresh = incoming.filter((t) => !have.has(t.toLowerCase()));
    const dupes = incoming.length - fresh.length;

    setNotice(dupes > 0 ? (fresh.length ? `Skipped ${dupes} already listed` : "Already listed") : null);
    setInput("");
    if (fresh.length) onChange(joinSkillTokens([...tokens, ...fresh]));
  }

  function remove(index: number) {
    onChange(joinSkillTokens(tokens.filter((_, i) => i !== index)));
  }

  const recognised = tokens.filter((t) => findAliasSeed(t)).length;

  return (
    <div>
      <div
        ref={sort.registerContainer("chips")}
        className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface p-2 transition-colors focus-within:border-accent"
      >
        {(sort.order.chips ?? []).map((i) => {
          const token = tokens[i];
          if (token === undefined) return null;
          const seed = findAliasSeed(token);
          const renamed = seed && seed.canonical.toLowerCase() !== token.toLowerCase();

          return (
            <span
              key={`${i}-${token}`}
              ref={sort.registerItem(i)}
              className={cn(
                "group inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-sm transition-opacity",
                seed ? "border-accent/30 bg-accentSoft/60" : "border-line bg-canvas",
                sort.draggingId === i && "opacity-40",
              )}
              title={
                seed
                  ? `${renamed ? `Matches ${seed.canonical}` : "Recognised"}${
                      seed.aliases.length ? ` · also ${seed.aliases.join(", ")}` : ""
                    }`
                  : "Not in the alias table — matched as written"
              }
            >
              <span {...sort.handleProps(i, "chips")} className="select-none">
                {token}
                {renamed && <span className="ml-1 text-[11px] text-muted">→ {seed.canonical}</span>}
              </span>
              <button
                type="button"
                className="rounded-full p-0.5 text-muted hover:bg-surface hover:text-red-600"
                aria-label={`Remove ${token}`}
                onClick={() => remove(i)}
              >
                <X size={12} />
              </button>
            </span>
          );
        })}

        <input
          className="min-w-32 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted/70"
          placeholder={tokens.length ? "Add a skill…" : "Type a skill and press Enter — e.g. Python"}
          aria-label="Add a skill"
          value={input}
          onChange={(e) => {
            const v = e.target.value;
            // A typed separator finishes the chip, the way tag inputs behave.
            if (/[,|;]$/.test(v)) add(v.slice(0, -1));
            else setInput(v);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[,|;\n•·]/.test(text)) {
              e.preventDefault();
              add(input + text);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(input);
            }
            if (e.key === "Escape" && input) {
              e.stopPropagation();
              setInput("");
            }
            // No Backspace-removes-last-chip: with autosave, a held key would
            // erase a whole skills line from the vault before anyone noticed.
          }}
          onBlur={() => input.trim() && add(input)}
        />
      </div>

      <p className="hint mt-1.5">
        {notice ??
          (tokens.length
            ? `${tokens.length} skill${tokens.length === 1 ? "" : "s"} · ${recognised} recognised for job matching (tinted). Drag to reorder.`
            : "Enter, comma or | adds a chip. Pasting a list splits it.")}
      </p>
    </div>
  );
}
