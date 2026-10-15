import type { SectionOptions } from "@/db/schema";
import {
  formatContactLine,
  formatDateRange,
  sectionOptions,
  type ResolvedBullet,
  type ResolvedEntry,
  type ResolvedResume,
} from "@/lib/resume-model";
import { buildBlocks, pageWidthIn, type ResumeBlock } from "@/lib/resume-blocks";
import { sanitizeInlineHtml } from "@/lib/rich-text";

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
          {resume.profile.title && <div className="r-title">{resume.profile.title}</div>}
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
      return <SkillsBlock groups={block.groups} options={block.options} />;

    case "entry":
      return <EntryBlock entry={block.entry} resume={resume} options={block.options} />;

    case "pageBreak":
      return <div className="r-page-break" />;
  }
}

/**
 * Skill lines. "lines" is the original look — one line per category,
 * "Category — a | b" — and stays the default.
 */
function SkillsBlock({
  groups,
  options,
}: {
  groups: Array<{ category: string; names: string[] }>;
  options: SectionOptions;
}) {
  const { skillsLayout } = sectionOptions({ options });

  if (skillsLayout === "inline") {
    return (
      <p className="r-block" style={{ marginTop: "3pt" }}>
        {groups.map((g, i) => (
          <span key={g.category}>
            {i > 0 && " · "}
            {g.category && <strong>{g.category}: </strong>}
            {g.names.join(", ")}
          </span>
        ))}
      </p>
    );
  }

  if (skillsLayout === "bullets") {
    return (
      <ul className="r-block" style={{ margin: "3pt 0 0", paddingLeft: "14pt", listStyle: "disc" }}>
        {groups.map((g) => (
          <li key={g.category} className="r-bullet">
            {g.category && <strong>{g.category}: </strong>}
            {g.names.join(", ")}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="r-block" style={{ marginTop: "3pt" }}>
      {groups.map((g) => (
        <div key={g.category} className="r-bullet">
          {skillsLayout === "colon" ? (
            <>
              {g.category && <strong>{g.category}: </strong>}
              {g.names.join(", ")}
            </>
          ) : (
            <>
              <strong>{g.category}</strong> — {g.names.join(" | ")}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** A bullet's content: its sanitised HTML when formatted, else its text. */
function BulletBody({ bullet }: { bullet: ResolvedBullet }) {
  if (bullet.html) {
    // Sanitised again at render, not only at write: whatever is in the column,
    // only strong/em/u/safe links reach the page.
    return <span dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(bullet.html) }} />;
  }
  return <>{bullet.text}</>;
}

/**
 * Consecutive bullets share one list; a paragraph line breaks the list and
 * prints as its own block. An entry with no paragraph lines renders exactly
 * as before: one <ul>.
 */
function groupLines(bullets: ResolvedBullet[]) {
  const runs: Array<{ kind: "list" | "para"; items: ResolvedBullet[] }> = [];
  for (const b of bullets) {
    const kind = b.isParagraph ? "para" : "list";
    const last = runs[runs.length - 1];
    if (last && last.kind === "list" && kind === "list") last.items.push(b);
    else runs.push({ kind, items: [b] });
  }
  return runs;
}

function alignStyle(b: ResolvedBullet): React.CSSProperties | undefined {
  return b.align === "left" ? undefined : { textAlign: b.align };
}

function withScheme(url: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}

function EntryBlock({
  entry,
  resume,
  options,
}: {
  entry: ResolvedEntry;
  resume: ResolvedResume;
  options: SectionOptions;
}) {
  const { style } = resume;
  const { titleOrder, titleJoin } = sectionOptions({ options });
  const dates = formatDateRange(entry);
  const right = [dates, entry.location].filter(Boolean).join(" | ");
  const bullets = entry.bullets.filter((b) => b.isVisible && b.text.trim());
  const belowTitle = style.datePosition === "below";

  const subtitleStyle: React.CSSProperties = {
    fontStyle: style.subtitleStyle === "italic" ? "italic" : "normal",
    fontWeight: style.subtitleStyle === "bold" ? 700 : 400,
  };

  // The organisation, linked when the entry has a URL — set from the editor's
  // Link button, or carried over from the vault entry.
  const org = entry.organization ? (
    entry.url ? (
      <a href={withScheme(entry.url)} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
        {entry.organization}
      </a>
    ) : (
      entry.organization
    )
  ) : null;

  const stacked = titleJoin === "stacked" && org !== null;
  const sep = titleJoin === "dash" ? " – " : ", ";
  const orgFirst = titleOrder === "org-first" && org !== null;

  // Title line. The defaults ("title-first", "comma") are the original look:
  // **Title**, *Org*, *Subtitle*.
  let titleLine: React.ReactNode;
  if (stacked) {
    titleLine = <strong>{orgFirst ? org : entry.title}</strong>;
  } else if (orgFirst) {
    titleLine = (
      <>
        <strong>{org}</strong>
        {entry.title && (
          <>
            {sep}
            <span style={subtitleStyle}>{entry.title}</span>
          </>
        )}
      </>
    );
  } else {
    titleLine = (
      <>
        <strong>{entry.title}</strong>
        {org !== null && (
          <>
            {entry.title ? sep : null}
            <span style={subtitleStyle}>{org}</span>
          </>
        )}
      </>
    );
  }

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
          {titleLine}
          {!stacked && entry.subtitle && (
            <>
              , <span style={subtitleStyle}>{entry.subtitle}</span>
            </>
          )}
        </div>
        {right && (
          <div style={belowTitle ? undefined : { whiteSpace: "nowrap" }}>{right}</div>
        )}
      </div>

      {stacked && (
        <div style={subtitleStyle}>
          {orgFirst ? entry.title : org}
          {entry.subtitle && <>, {entry.subtitle}</>}
        </div>
      )}

      {groupLines(bullets).map((run) =>
        run.kind === "list" ? (
          <ul
            key={`l-${run.items[0]!.id}`}
            style={{ margin: "2pt 0 0", paddingLeft: "14pt", listStyle: "disc" }}
          >
            {run.items.map((b) => (
              <li key={b.id} className="r-bullet" style={alignStyle(b)} data-bullet-id={b.id}>
                <BulletBody bullet={b} />
              </li>
            ))}
          </ul>
        ) : (
          <p
            key={`p-${run.items[0]!.id}`}
            className="r-bullet"
            // Lets the editor's preview find each bullet on the page (the
            // strength strip beside it). Invisible in print.
            data-bullet-id={run.items[0]!.id}
            style={{ margin: "2pt 0 0", ...alignStyle(run.items[0]!) }}
          >
            <BulletBody bullet={run.items[0]!} />
          </p>
        ),
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
