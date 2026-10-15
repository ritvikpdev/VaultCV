import { ChevronRight } from "lucide-react";

import { formatPath, type VaultPath } from "@/lib/vault-path";
import { cn } from "@/lib/utils";

/**
 * "Work Experience › SDE Experience" — a vault section named with its group.
 *
 * No hooks and no "use client", so Server and Client Components share it. The
 * group reads quieter than the section: the section is what you act on, the
 * group is where to find it.
 */
export function SectionPath({
  path,
  className,
  tone = "muted",
}: {
  path: VaultPath;
  className?: string;
  /** `muted` for tags and captions; `ink` where the path is the label itself. */
  tone?: "muted" | "ink";
}) {
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1", className)}
      title={formatPath(path)}
    >
      {path.group && (
        <>
          <span className="truncate text-muted">{path.group}</span>
          <ChevronRight size={12} aria-label="then" className="shrink-0 text-muted/70" />
        </>
      )}
      <span className={cn("truncate font-medium", tone === "ink" ? "text-ink" : "text-ink/80")}>
        {path.section}
      </span>
    </span>
  );
}
