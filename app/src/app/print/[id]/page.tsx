import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ResumeDocument } from "@/components/resume-document";
import { getResumeFull } from "@/db/resume-queries";
import { withVault } from "@/db/session";

import { PrintWhenReady } from "./print-when-ready";

export const dynamic = "force-dynamic";

async function load(id: string) {
  const resumeId = Number(id);
  if (!Number.isInteger(resumeId)) return null;
  return withVault(() => getResumeFull(resumeId));
}

/**
 * The document title is what Chrome's "Save as PDF" proposes as the filename,
 * so it's the resume's name rather than "vaultCV".
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const resume = await load((await params).id);
  return { title: resume?.name || "Resume" };
}

/**
 * The PDF render target — printed by the browser itself.
 *
 * Mounts the identical `ResumeDocument` the editor preview uses — no scaling
 * wrapper, no editing affordances. That sameness is the entire point: a
 * separate print renderer is the single change most likely to make the PDF
 * disagree with what you saw on screen, so there isn't one.
 *
 * This used to be printed by Puppeteer on the server. Headless Chrome doesn't
 * fit a free serverless host, so the Download button now loads this page in a
 * hidden frame and calls the browser's own print — the same Chrome engine
 * Puppeteer drove, producing the same real, selectable text ATS parsers read.
 *
 * The style block:
 *   - strips the app shell (nav, page padding, canvas background) that the
 *     root layout wraps every route in;
 *   - sets the page box to the resume's size with zero margins, exactly as the
 *     Puppeteer call did. The document supplies its own margins via
 *     `--r-margin-x/y`; page margins on top would double them. Zero margins
 *     also leave Chrome no room for its date/URL header and footer;
 *   - forces colours to print, the CSS equivalent of `printBackground: true`.
 */
export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const resume = await load((await params).id);
  if (!resume) notFound();
  const { print } = await searchParams;

  const pageSize = resume.style.pageSize === "a4" ? "A4" : "letter";

  return (
    <>
      <style>{`
        @page { size: ${pageSize}; margin: 0; }
        html, body { background: #fff !important; margin: 0; padding: 0; }
        body > header { display: none !important; }
        body > main { max-width: none !important; margin: 0 !important; padding: 0 !important; }
        .resume-doc { box-shadow: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      `}</style>
      <div id="resume-ready">
        <ResumeDocument resume={resume} />
      </div>
      {print === "1" && <PrintWhenReady />}
    </>
  );
}
