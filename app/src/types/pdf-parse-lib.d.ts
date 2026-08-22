/**
 * `@types/pdf-parse` only declares the package's root entry point. We import
 * `pdf-parse/lib/pdf-parse.js` directly instead (see `src/lib/pdf-extract.ts`
 * for why), so it needs its own ambient declaration.
 */
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PDFParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }

  function pdfParse(
    dataBuffer: Buffer,
    options?: Record<string, unknown>,
  ): Promise<PDFParseResult>;

  export default pdfParse;
}
