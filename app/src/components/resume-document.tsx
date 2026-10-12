import {
  formatContactLine,
  formatDateRange,
  type ResolvedEntry,
  type ResolvedResume,
} from "@/lib/resume-model";
import { buildBlocks, pageWidthIn, type ResumeBlock } from "@/lib/resume-blocks";

/**
 * THE resume renderer. There is exactly one.
 *
 * `/resume/[id]` mounts it (paginated) for the live preview and `/print/[id]`
 * mounts it (continuous) for the browser to print. A second renderer for export is the
 * single change most likely to make the PDF disagree with what you saw, so
 * there isn't one — the two callers differ only in how blocks are grouped, not
 * in how any block is drawn.
 *
 * All styling comes from CSS variables written from `resume_styles`, never from
 * Tailwind. The document is a printed artifact, not app chrome.
 */

export function resumeCssVars(style: ResolvedResume["style"]): React.CSSProperties {
  return {
    "--r-font-family": style.fontFamily,
    "--r-base-size": `${style.baseSize}pt`,
    "--r-name-size": `${style.nameSize}pt`,
    "--r-heading-size": `${style.headingSize}pt`,
    "--r-line-height": String(style.lineHeight),
    "--r-section-gap": `${style.sectionGap}pt`,
    "--r-entry-gap": `${style.entryGap}pt`,
    "--r-bullet-gap": `${style.bulletGap}pt`,
    "--r-margin-x": `${style.marginX}in`,
    "--r-margin-y": `${style.marginY}in`,
    "--r-accent": style.accentColor,
  } as React.CSSProperties;
}

/** Renders one block. Identical output whether paginated or continuous. */
export function ResumeBlockView({
  block,
  resume,
}: {
  block: ResumeBlock;
  resume: ResolvedResume;
}) {
  switch (block.kind) {
    case "header": {
      const contact = formatContactLine(resume.profile);
      return (
        <header className="r-block">
          <div className="r-name">{resume.profile.fullName || "Your Name"}</div>
          {contact.length > 0 && (
            <div className="r-contact">
              {contact.map((item, i) => (
                <span key={i}>
                  {i > 0 && "  |  "}
                  {item.href ? (
                    <a href={item.href} target="_blank" rel="noreferrer">
                      {item.text}
                    </a>
                  ) : (
                    item.text
                  )}
                </span>
              ))}
            </div>
          )}
        </header>
      );
    }

    case "summary":
      return (
        <p className="r-block" style={{ marginTop: "var(--r-section-gap)" }}>
          {block.text}
        </p>
      );

    case "heading":
      return (
        <div
          className="r-block r-heading"
          style={{ marginTop: "var(--r-section-gap)" }}
        >
          {block.heading}
        </div>
      );

    case "skills":
      return (
        <div className="r-block" style={{ marginTop: "3pt" }}>
          {block.groups.map((g) => (
            <div key={g.category} className="r-bullet">
              <strong>{g.category}</strong> — {g.names.join(" | ")}
            </div>
          ))}
        </div>
      );

    case "entry":
      return <EntryBlock entry={block.entry} resume={resume} />;

    case "pageBreak":
      return <div className="r-page-break" />;
  }
}

function EntryBlock({
  entry,
  resume,
}: {
  entry: ResolvedEntry;
  resume: ResolvedResume;
}) {
  const { style } = resume;
  const dates = formatDateRange(entry);
  const right = [dates, entry.location].filter(Boolean).join(" | ");
  const bullets = entry.bullets.filter((b) => b.isVisible && b.text.trim());
  const belowTitle = style.datePosition === "below";

  const subtitleStyle: React.CSSProperties = {
    fontStyle: style.subtitleStyle === "italic" ? "italic" : "normal",
    fontWeight: style.subtitleStyle === "bold" ? 700 : 400,
  };

  return (
    <div className="r-block r-entry" style={{ marginTop: "var(--r-entry-gap)" }}>
      <div
        style={
          belowTitle
            ? undefined
            : { display: "flex", justifyContent: "space-between", gap: "12pt" }
        }
      >
        <div style={{ flex: 1 }}>
          <strong>{entry.title}</strong>
          {entry.organization && (
            <>
              , <span style={subtitleStyle}>{entry.organization}</span>
            </>
          )}
          {entry.subtitle && (
            <>
              , <span style={subtitleStyle}>{entry.subtitle}</span>
            </>
          )}
        </div>
        {right && (
          <div style={belowTitle ? undefined : { whiteSpace: "nowrap" }}>{right}</div>
        )}
      </div>

      {bullets.length > 0 && (
        <ul style={{ margin: "2pt 0 0", paddingLeft: "14pt", listStyle: "disc" }}>
          {bullets.map((b) => (
            <li key={b.id} className="r-bullet">
              {b.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Continuous render — every block in one flow. This is what gets printed;
 * Chrome decides the breaks, guided by `break-inside: avoid` on `.r-entry`.
 */
export function ResumeDocument({
  resume,
  className = "",
}: {
  resume: ResolvedResume;
  className?: string;
}) {
  const blocks = buildBlocks(resume);

  return (
    <div
      className={`resume-doc ${className}`}
      style={{ ...resumeCssVars(resume.style), width: `${pageWidthIn(resume.style)}in` }}
      data-heading-style={resume.style.headingStyle}
    >
      {blocks.map((block) => (
        <ResumeBlockView key={block.key} block={block} resume={resume} />
      ))}

      {blocks.length <= 1 && (
        <p style={{ marginTop: "24pt", textAlign: "center", color: "#888" }}>
          No sections yet. Add content from the panel on the left.
        </p>
      )}
    </div>
  );
}
