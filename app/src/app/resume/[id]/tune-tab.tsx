"use client";

import { useState, useTransition } from "react";
import {
  ArrowUpDown,
  Check,
  EyeOff,
  Loader2,
  Plus,
  Sparkles,
  X,
} from "lucide-react";

import type { Recommendation } from "@/db/schema";
import { cn } from "@/lib/utils";

import {
  applyRecommendation,
  runTune,
  setRecommendationStatus,
  type TuneResult,
} from "../tune-actions";

const TYPE_META: Record<
  Recommendation["type"],
  { icon: typeof Plus; label: string; tone: string }
> = {
  ADD_BULLET: { icon: Plus, label: "Add bullet", tone: "text-emerald-700 bg-emerald-50" },
  ADD_ENTRY: { icon: Plus, label: "Add entry", tone: "text-emerald-700 bg-emerald-50" },
  ADD_SKILL: { icon: Plus, label: "Add skill", tone: "text-emerald-700 bg-emerald-50" },
  REMOVE_BULLET: { icon: EyeOff, label: "Hide", tone: "text-amber-700 bg-amber-50" },
  REORDER: { icon: ArrowUpDown, label: "Reorder", tone: "text-sky-700 bg-sky-50" },
  EDIT_BULLET: { icon: Sparkles, label: "Reword", tone: "text-violet-700 bg-violet-50" },
};

function CoverageBar({ coverage }: { coverage: number }) {
  const pct = Math.round(coverage * 100);
  const tone =
    pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-400";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">Must-have coverage</span>
        <span className="text-sm tabular-nums">{pct}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line">
        <div className={cn("h-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function TuneTab({
  resumeId,
  hasApiKey,
}: {
  resumeId: number;
  hasApiKey: boolean;
}) {
  const [jdText, setJdText] = useState("");
  const [result, setResult] = useState<TuneResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Recommendation["status"]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function analyze() {
    setError(null);
    startTransition(async () => {
      const res = await runTune(resumeId, jdText);
      if (res.ok) {
        setResult(res.data);
        setStatuses({});
      } else {
        setError(res.error);
      }
    });
  }

  function apply(rec: Recommendation) {
    if (!result) return;
    setBusyId(rec.id);
    startTransition(async () => {
      const res = await applyRecommendation(resumeId, rec);
      if (res.ok) {
        setStatuses((prev) => ({ ...prev, [rec.id]: "applied" }));
        await setRecommendationStatus(result.runId, rec.id, "applied");
      } else {
        setError(res.error);
      }
      setBusyId(null);
    });
  }

  function dismiss(rec: Recommendation) {
    if (!result) return;
    setStatuses((prev) => ({ ...prev, [rec.id]: "dismissed" }));
    startTransition(() => void setRecommendationStatus(result.runId, rec.id, "dismissed"));
  }

  if (!result) {
    return (
      <div className="space-y-4">
        <div className="card p-5">
          <h3 className="text-sm font-semibold">Paste the job description</h3>
          <p className="hint mt-1">
            You get a change list, not a rewritten resume. Every row says which
            requirement it covers, and nothing is applied until you click Apply.
          </p>

          <textarea
            className="field mt-3 min-h-64 resize-y font-mono text-xs"
            placeholder="Paste the full job description here…"
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
          />

          {error && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            className="btn-accent mt-3 w-full"
            onClick={analyze}
            disabled={pending || jdText.trim().length < 40}
          >
            {pending ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Analyzing…
              </>
            ) : (
              <>
                <Sparkles size={15} /> Analyze and compare
              </>
            )}
          </button>

          {!hasApiKey && (
            <p className="hint mt-3">
              No API key — requirements are extracted locally. Matching against
              your vault is deterministic either way; a key mainly improves how
              cleanly the JD is broken into requirements.
            </p>
          )}
        </div>
      </div>
    );
  }

  const visible = result.recommendations.filter(
    (r) => (statuses[r.id] ?? r.status) === "pending",
  );
  const appliedCount = Object.values(statuses).filter((s) => s === "applied").length;

  // The heuristic contributes canonical names ("Kubernetes") while a provider
  // returns its own casing ("kubernetes"). Showing both is just noise.
  const keywords = Array.from(
    new Map(result.jd.keywords.map((k) => [k.toLowerCase(), k])).values(),
  ).slice(0, 16);

  const missing = result.jd.requirements.filter((r) =>
    result.missingRequirementIds.includes(r.id),
  );

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <CoverageBar coverage={result.coverage} />

        <p className="hint mt-3">
          {result.jd.requirements.length} requirements found ·{" "}
          {result.missingRequirementIds.length} not yet evidenced · parsed{" "}
          {result.providerName}
        </p>

        {keywords.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {keywords.map((kw) => {
              const present = result.jd.requirements.some(
                (r) =>
                  result.coveredRequirementIds.includes(r.id) &&
                  r.terms.some((t) => t.includes(kw.toLowerCase())),
              );
              return (
                <span
                  key={kw}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px]",
                    present ? "bg-emerald-50 text-emerald-700" : "bg-canvas text-muted",
                  )}
                >
                  {kw}
                </span>
              );
            })}
          </div>
        )}

        <button
          className="btn-ghost mt-4 w-full text-xs"
          onClick={() => {
            setResult(null);
            setJdText("");
          }}
        >
          Tune against a different job
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {appliedCount > 0 && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {appliedCount} change{appliedCount === 1 ? "" : "s"} applied. The preview
          is up to date.
        </p>
      )}

      {visible.length === 0 ? (
        <div className="card p-5">
          <p className="font-medium">No further suggestions</p>

          {missing.length === 0 ? (
            <p className="hint mt-1">
              Every requirement is evidenced on this resume.
            </p>
          ) : (
            <>
              {/* Naming the actual gaps rather than claiming the vault has
                  nothing — the app can't know that, and a dead end with no
                  explanation is the least useful thing it could say. */}
              <p className="hint mt-1">
                Nothing in your vault matches these {missing.length} requirement
                {missing.length === 1 ? "" : "s"}. Adding experience that covers
                them is what would move the number.
              </p>
              <ul className="mt-3 space-y-1.5">
                {missing.slice(0, 8).map((r) => (
                  <li key={r.id} className="flex items-start gap-2 text-sm">
                    <span
                      className={cn(
                        "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                        r.kind === "must_have"
                          ? "bg-red-50 text-red-700"
                          : "bg-canvas text-muted",
                      )}
                    >
                      {r.kind === "must_have" ? "must" : "nice"}
                    </span>
                    <span className="leading-snug">{r.text}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="hint">
            {visible.length} suggestion{visible.length === 1 ? "" : "s"}, most useful first
          </p>

          {visible.map((rec) => {
            const meta = TYPE_META[rec.type];
            const Icon = meta.icon;
            const why = String(rec.payload.why ?? "");

            return (
              <div key={rec.id} className="card p-4">
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                      meta.tone,
                    )}
                  >
                    <Icon size={10} />
                    {meta.label}
                  </span>
                  <p className="flex-1 text-sm leading-snug">{rec.label}</p>
                </div>

                {why && (
                  <p className="hint mt-2 border-l-2 border-line pl-2">
                    Covers: {why}
                  </p>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    className="btn-accent px-3 py-1 text-xs"
                    onClick={() => apply(rec)}
                    disabled={busyId === rec.id}
                  >
                    {busyId === rec.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Check size={12} />
                    )}
                    Apply
                  </button>
                  <button
                    className="btn-ghost px-3 py-1 text-xs"
                    onClick={() => dismiss(rec)}
                  >
                    <X size={12} /> Dismiss
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
