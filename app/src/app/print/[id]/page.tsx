import { notFound } from "next/navigation";

import { ResumeDocument } from "@/components/resume-document";
import { getResumeFull } from "@/db/resume-queries";

export const dynamic = "force-dynamic";

/**
 * Puppeteer's render target.
 *
 * Mounts the identical `ResumeDocument` the editor preview uses — no scaling
 * wrapper, no editing affordances. That sameness is the entire point: a
 * separate print renderer is the single change most likely to make the PDF
 * disagree with what you saw on screen, so there isn't one.
 *
 * The style block strips the app shell (nav, page padding, canvas background)
 * that the root layout wraps every route in. Escaping the root layout properly
 * would mean route groups with two `<html>` roots and moving every existing
 * page — a large refactor to save nine lines of CSS that only this route needs.
 *
 * `#resume-ready` is what the export route waits on. Waiting for a definite
 * element beats guessing a timeout and occasionally printing a half-laid-out page.
 */
export default async function PrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const resumeId = Number(id);
  if (!Number.isInteger(resumeId)) notFound();

  const resume = getResumeFull(resumeId);
  if (!resume) notFound();

  return (
    <>
      <style>{`
        html, body { background: #fff !important; margin: 0; padding: 0; }
        body > header { display: none !important; }
        body > main { max-width: none !important; margin: 0 !important; padding: 0 !important; }
        .resume-doc { box-shadow: none; }
      `}</style>
      <div id="resume-ready">
        <ResumeDocument resume={resume} />
      </div>
    </>
  );
}
