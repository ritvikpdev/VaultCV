"use client";

import { useEffect } from "react";

/**
 * Opens the print dialog once the document is truly laid out.
 *
 * Waits on `document.fonts.ready` for the same reason the Puppeteer route did:
 * web fonts resolve after first paint, and printing before they settle gives a
 * PDF laid out in a fallback face. The extra animation frame lets layout catch
 * up with the font swap before the snapshot is taken.
 */
export function PrintWhenReady() {
  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      requestAnimationFrame(() => {
        if (!cancelled) window.print();
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
