"use client";

import { useTransition } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";

import { clearAttentionItem, restoreAttentionItems } from "./actions";

/**
 * The overview is a Server Component; these are its only interactive bits.
 * Clearing hides a reminder and nothing else, so it doesn't confirm.
 */

export function ClearAttentionButton({ itemKey, label }: { itemKey: string; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="mt-1 shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink disabled:opacity-50"
      aria-label={`Clear reminder: ${label}`}
      title="Clear — hide this reminder"
      disabled={pending}
      onClick={() => startTransition(() => void clearAttentionItem(itemKey))}
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
    </button>
  );
}

export function RestoreClearedButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink disabled:opacity-50"
      disabled={pending}
      onClick={() => startTransition(() => void restoreAttentionItems())}
    >
      {pending ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
      {count} cleared · Show again
    </button>
  );
}
