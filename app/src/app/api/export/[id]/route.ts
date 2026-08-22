import { NextResponse } from "next/server";
import type { Browser } from "puppeteer";

import { getResumeFull } from "@/db/resume-queries";

export const dynamic = "force-dynamic";
/** Puppeteer needs the full Node runtime, not the edge one. */
export const runtime = "nodejs";

/**
 * PDF export.
 *
 * Drives headless Chrome against `/print/[id]` — the page that mounts the same
 * `ResumeDocument` as the editor preview — so the file you download is the
 * layout you were just looking at, not a reimplementation of it.
 *
 * Margins are set to zero here on purpose: the document supplies its own via
 * `--r-margin-x/y` from `resume_styles`. Letting Chrome add page margins on top
 * would double them, and the Customize sliders would stop meaning anything.
 */

function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return `${cleaned || "resume"}.pdf`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const resumeId = Number(id);

  if (!Number.isInteger(resumeId)) {
    return NextResponse.json({ error: "Invalid resume id" }, { status: 400 });
  }

  const resume = getResumeFull(resumeId);
  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  let browser: Browser | undefined;

  try {
    // Imported lazily so a missing Chromium download breaks only this route,
    // not every page that happens to share a module graph with it.
    const puppeteer = (await import("puppeteer")).default;

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();

    // Same-origin as the request, so this works on whatever port dev picked.
    const origin = new URL(request.url).origin;
    await page.goto(`${origin}/print/${resumeId}`, {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });

    // Definite readiness signal rather than a hopeful sleep.
    await page.waitForSelector("#resume-ready", { timeout: 10_000 });
    // Web fonts resolve after first paint; printing before they settle gives
    // you a PDF laid out in a fallback face.
    await page.evaluate(() => document.fonts.ready);

    const pdf = await page.pdf({
      format: resume.style.pageSize === "a4" ? "a4" : "letter",
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename(resume.name)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // The overwhelmingly common failure is Chromium never having downloaded.
    // Say that plainly instead of surfacing a stack trace about a missing exe.
    const missingChromium =
      /Could not find (Chrome|Chromium|browser)|Browser was not found|ENOENT/i.test(message);

    return NextResponse.json(
      {
        error: missingChromium
          ? "Chromium isn't installed. Run `npm install` in the app folder — Puppeteer downloads it on install."
          : `PDF export failed: ${message}`,
      },
      { status: 500 },
    );
  } finally {
    await browser?.close();
  }
}
